/**
 * exportMarcacoes.js — Exportação de Marcações para API REST ou SQL externo
 *
 * Suporta:
 *   - api_rest: HTTP POST/PUT com payload JSON para endpoint externo
 *   - sql_server: INSERT via mssql (SQL Server)
 *   - mysql: INSERT via mysql2
 *   - postgresql: INSERT via postgres
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

    const { config_id } = await req.json();
    if (!config_id) return Response.json({ error: 'config_id é obrigatório' }, { status: 400 });

    // Buscar configuração
    const config = await base44.entities.ExportConfig.get(config_id);
    if (!config) return Response.json({ error: 'Configuração não encontrada' }, { status: 404 });

    // Verificar permissão
    const isAdmin = user.role === 'admin';
    if (!isAdmin && config.owner_email !== user.email) {
      return Response.json({ error: 'Sem permissão' }, { status: 403 });
    }

    // Buscar marcações a exportar
    let marcacoes;
    if (config.apenas_novos !== false) {
      marcacoes = await base44.asServiceRole.entities.Marcacao.filter({ exportado: false }, 'timestamp', 1000);
    } else {
      marcacoes = await base44.asServiceRole.entities.Marcacao.list('timestamp', 1000);
    }

    if (!marcacoes || marcacoes.length === 0) {
      return Response.json({ success: true, exported: 0, message: 'Sem marcações para exportar' });
    }

    let exported = 0;
    let errors = [];

    if (config.tipo === 'api_rest') {
      const result = await exportToApi(config, marcacoes);
      exported = result.exported;
      errors = result.errors;
    } else if (['sql_server', 'mysql', 'postgresql'].includes(config.tipo)) {
      const result = await exportToSql(config, marcacoes);
      exported = result.exported;
      errors = result.errors;
    } else {
      return Response.json({ error: `Tipo não suportado: ${config.tipo}` }, { status: 400 });
    }

    // Marcar como exportadas
    if (exported > 0 && config.apenas_novos !== false) {
      const exportedIds = marcacoes.slice(0, exported).map(m => m.id).filter(Boolean);
      for (const id of exportedIds) {
        await base44.asServiceRole.entities.Marcacao.update(id, {
          exportado: true,
          exportado_em: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    // Atualizar config com stats
    await base44.asServiceRole.entities.ExportConfig.update(config_id, {
      ultima_exportacao: new Date().toISOString(),
      total_exportado: (config.total_exportado || 0) + exported,
    }).catch(() => {});

    return Response.json({
      success: errors.length === 0,
      exported,
      errors: errors.slice(0, 5),
      message: `${exported} marcação(ões) exportada(s)${errors.length ? ` (${errors.length} erro(s))` : ''}`,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ── API REST Export ────────────────────────────────────────────────────────

async function exportToApi(config, marcacoes) {
  const exported_list = [];
  const errors = [];

  // Parse headers
  let headers = { 'Content-Type': 'application/json' };
  if (config.api_headers) {
    try {
      const extra = JSON.parse(config.api_headers);
      headers = { ...headers, ...extra };
    } catch {
      // headers inválidos — ignorar
    }
  }

  // Enviar em batch (todas de uma vez)
  const payload = marcacoes.map(m => mapRecord(m, config.sql_mapping));
  try {
    const resp = await fetch(config.api_url, {
      method: config.api_method || 'POST',
      headers,
      body: JSON.stringify({ marcacoes: payload, total: payload.length }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      errors.push(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    } else {
      return { exported: marcacoes.length, errors: [] };
    }
  } catch (e) {
    errors.push(e.message);
  }

  return { exported: 0, errors };
}

// ── SQL Export ────────────────────────────────────────────────────────────

async function exportToSql(config, marcacoes) {
  const tipo = config.tipo;
  const table = config.sql_table || 'marcacoes_biometrico';
  const connStr = config.sql_connection_string;

  if (!connStr) return { exported: 0, errors: ['String de conexão não configurada'] };

  let mapping = {};
  try { mapping = JSON.parse(config.sql_mapping || '{}'); } catch {}

  const records = marcacoes.map(m => mapRecord(m, config.sql_mapping));

  try {
    if (tipo === 'sql_server') {
      return await insertMssql(connStr, table, records, mapping);
    } else if (tipo === 'mysql') {
      return await insertMysql(connStr, table, records, mapping);
    } else if (tipo === 'postgresql') {
      return await insertPostgres(connStr, table, records, mapping);
    }
  } catch (e) {
    return { exported: 0, errors: [e.message] };
  }

  return { exported: 0, errors: ['Tipo SQL não suportado'] };
}

async function insertMssql(connStr, table, records, mapping) {
  const mssql = await import('npm:mssql@10.0.2');

  // Parse connection string
  let config;
  if (connStr.startsWith('Server=') || connStr.startsWith('server=')) {
    const parts = {};
    connStr.split(';').forEach(p => {
      const [k, ...v] = p.split('=');
      if (k && v.length) parts[k.trim().toLowerCase()] = v.join('=').trim();
    });
    config = {
      server: parts['server'] || parts['data source'] || 'localhost',
      database: parts['database'] || parts['initial catalog'] || '',
      user: parts['user id'] || parts['uid'] || '',
      password: parts['password'] || parts['pwd'] || '',
      options: { encrypt: true, trustServerCertificate: true },
    };
  } else {
    config = connStr;
  }

  const pool = await mssql.connect(config);
  let exported = 0;
  const errors = [];

  for (const rec of records) {
    try {
      const cols = Object.keys(rec);
      const vals = Object.values(rec);
      const query = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `@p${i}`).join(',')})`;
      const req2 = pool.request();
      vals.forEach((v, i) => req2.input(`p${i}`, v));
      await req2.query(query);
      exported++;
    } catch (e) {
      errors.push(e.message);
    }
  }
  await pool.close();
  return { exported, errors };
}

async function insertMysql(connStr, table, records, mapping) {
  const mysql = await import('npm:mysql2@3.6.0/promise');
  const conn = await mysql.createConnection(connStr);
  let exported = 0;
  const errors = [];
  for (const rec of records) {
    try {
      const cols = Object.keys(rec);
      const vals = Object.values(rec);
      await conn.execute(`INSERT INTO \`${table}\` (${cols.map(c => `\`${c}\``).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
      exported++;
    } catch (e) { errors.push(e.message); }
  }
  await conn.end();
  return { exported, errors };
}

async function insertPostgres(connStr, table, records, mapping) {
  const { Client } = await import('npm:pg@8.11.3');
  const client = new Client({ connectionString: connStr });
  await client.connect();
  let exported = 0;
  const errors = [];
  for (const rec of records) {
    try {
      const cols = Object.keys(rec);
      const vals = Object.values(rec);
      await client.query(
        `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
        vals
      );
      exported++;
    } catch (e) { errors.push(e.message); }
  }
  await client.end();
  return { exported, errors };
}

// ── Field Mapper ────────────────────────────────────────────────────────────

function mapRecord(m, sqlMappingJson) {
  let fieldMap = {};
  try { fieldMap = JSON.parse(sqlMappingJson || '{}'); } catch {}

  // Default direct mapping
  const source = {
    enrollid: m.enrollid,
    timestamp: m.timestamp,
    terminal_nome: m.terminal_nome,
    terminal_id: m.terminal_id,
    utilizador_nome: m.utilizador_nome,
    modo: m.modo,
    tipo: m.tipo,
    local: m.local,
  };

  if (!Object.keys(fieldMap).length) return source;

  const result = {};
  Object.entries(fieldMap).forEach(([src, dest]) => {
    if (source[src] !== undefined) result[dest] = source[src];
  });
  return result;
}