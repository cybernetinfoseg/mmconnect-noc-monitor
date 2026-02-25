import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const FETCH_TIMEOUT_MS = 15000; // 15s max for external API call
const BATCH_SIZE = 10;          // Process terminals in parallel batches

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timer);
    }
}

async function processBatch(base44, batch) {
    return Promise.all(batch.map(async (data) => {
        try {
            const existing = await base44.asServiceRole.entities.Terminal.filter({ nome: data.nome });
            if (existing.length > 0) {
                await base44.asServiceRole.entities.Terminal.update(existing[0].id, {
                    ultimo_ping: data.ultimo_ping || new Date().toISOString(),
                    status: data.status || 'offline',
                    ip_local: data.ip_local,
                    ip_publico: data.ip_publico,
                    porta: data.porta,
                    local: data.local,
                    cliente_nome: data.cliente
                });
            } else {
                await base44.asServiceRole.entities.Terminal.create({
                    nome: data.nome,
                    local: data.local || 'Não especificado',
                    cliente_nome: data.cliente || 'Não especificado',
                    tipo_conexao: data.tipo_conexao || 'ip_local',
                    ip_local: data.ip_local,
                    ip_publico: data.ip_publico,
                    porta: data.porta || 5005,
                    status: data.status || 'offline',
                    ultimo_ping: data.ultimo_ping || new Date().toISOString(),
                    ativo: true
                });
            }
            return { nome: data.nome, success: true };
        } catch (err) {
            return { nome: data.nome, success: false, error: err.message };
        }
    }));
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Allow both scheduled (no user) and manual (admin) invocations
        const isAuthenticated = await base44.auth.isAuthenticated();
        if (isAuthenticated) {
            const user = await base44.auth.me();
            if (user?.role !== 'admin') {
                return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
            }
        }

        // Fetch active configs
        const configs = await base44.asServiceRole.entities.MonitorConfig.filter({ ativo: true });

        if (configs.length === 0) {
            return Response.json({ success: true, message: 'Nenhuma configuração ativa encontrada' });
        }

        const results = [];

        for (const config of configs) {
            try {
                let terminalsData = [];

                if (config.tipo === 'api_externa') {
                    const headers = { 'Content-Type': 'application/json' };

                    if (config.api_auth_type === 'bearer') {
                        headers['Authorization'] = `Bearer ${config.api_auth_token}`;
                    } else if (config.api_auth_type === 'api_key') {
                        headers['X-API-Key'] = config.api_auth_token;
                    } else if (config.api_auth_type === 'basic') {
                        headers['Authorization'] = `Basic ${config.api_auth_token}`;
                    }

                    const response = await fetchWithTimeout(config.api_url, { headers });

                    if (!response.ok) {
                        throw new Error(`API retornou status ${response.status}`);
                    }

                    terminalsData = await response.json();

                } else if (config.tipo === 'sql_server') {
                    throw new Error('Conexão direta SQL Server requer configuração adicional. Use API intermediária.');
                }

                // Process in parallel batches
                let synced = 0;
                let failed = 0;

                for (let i = 0; i < terminalsData.length; i += BATCH_SIZE) {
                    const batch = terminalsData.slice(i, i + BATCH_SIZE);
                    const batchResults = await processBatch(base44, batch);
                    synced += batchResults.filter(r => r.success).length;
                    failed += batchResults.filter(r => !r.success).length;
                }

                await base44.asServiceRole.entities.MonitorConfig.update(config.id, {
                    ultima_sync: new Date().toISOString(),
                    ultima_sync_status: `success: ${synced} sincronizados`
                });

                results.push({ config_id: config.id, tipo: config.tipo, success: true, synced, failed });

            } catch (error) {
                await base44.asServiceRole.entities.MonitorConfig.update(config.id, {
                    ultima_sync: new Date().toISOString(),
                    ultima_sync_status: `error: ${error.message}`
                });

                results.push({ config_id: config.id, tipo: config.tipo, success: false, error: error.message });
            }
        }

        return Response.json({ success: true, configs_processadas: configs.length, results });

    } catch (error) {
        console.error('Erro ao sincronizar dados externos:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});