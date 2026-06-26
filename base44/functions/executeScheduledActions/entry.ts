/**
 * executeScheduledActions — Executa ações remotas agendadas nos terminais
 * Chamado pelo cron a cada 5 minutos
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Helpers de conexão (espelhados de terminalControl) ─────────────────────

function buildTimmyWsUrl(terminal) {
  const host = terminal.ip_publico || terminal.dns || '0.0.0.0';
  const port = terminal.porta || 7788;
  return `ws://${host}:${port}`;
}

async function sendTimmyCommand(terminal, command) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(buildTimmyWsUrl(terminal));
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 8000);
    ws.onopen = () => ws.send(JSON.stringify(command));
    ws.onmessage = (event) => {
      clearTimeout(timeout); ws.close();
      try { resolve(JSON.parse(event.data)); } catch { resolve({ result: true, raw: event.data }); }
    };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error('WS connection failed')); };
  });
}

function buildBaseUrl(terminal) {
  const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
  return `http://${ip}:${terminal.porta || 80}`;
}

async function hikvisionRequest(terminal, method, path, body = null) {
  const creds = btoa(`admin:${terminal.observacoes || 'admin'}`);
  const opts = { method, headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${buildBaseUrl(terminal)}${path}`, opts);
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: resp.status }; }
}

async function dahuaRequest(terminal, cgiPath) {
  const creds = btoa(`admin:${terminal.observacoes || 'admin'}`);
  const resp = await fetch(`${buildBaseUrl(terminal)}${cgiPath}`, { headers: { 'Authorization': `Basic ${creds}` } });
  return { status: resp.status, body: await resp.text() };
}

// ─── Executores de ação ──────────────────────────────────────────────────────

async function runAction(terminal, action) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const tipo = terminal.tipo_conexao;
  const fab = terminal.fabricante || '';

  if (action === 'settime') {
    if (tipo === 'websocket_cloud') {
      const r = await sendTimmyCommand(terminal, { cmd: 'settime', cloudtime: now });
      return { success: r.result === true, message: `Relógio acertado para ${now}`, data: r };
    }
    if (tipo === 'adms_push' || tipo === 'sdk_tcp') {
      // ZKTeco: tentar via HTTP direto se IP disponível
      const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
      if (ip) {
        const port = terminal.porta || 80;
        const sn = terminal.numero_serie || '';
        const r = await fetch(`http://${ip}:${port}/iclock/cdata`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `SN=${sn}&CMD=SET_TIME&TIME=${encodeURIComponent(now)}`,
        }).catch(() => ({ status: 0 }));
        return { success: r.status < 400, message: `Relógio acertado (ZKTeco) para ${now}` };
      }
      return { success: true, message: `Relógio será acertado na próxima sincronização ADMS (${now})`, note: 'IP não configurado — comando pendente' };
    }
    if (fab === 'hikvision') {
      const r = await hikvisionRequest(terminal, 'PUT', '/ISAPI/System/time', { timeMode: 'manual', localTime: now });
      return { success: true, message: 'Relógio acertado (Hikvision)', data: r };
    }
    if (fab === 'dahua') {
      const r = await dahuaRequest(terminal, `/cgi-bin/global.cgi?action=setCurrentTime&time=${encodeURIComponent(now)}`);
      return { success: r.status === 200, message: 'Relógio acertado (Dahua)', data: r };
    }
    return { success: false, error: `settime não suportado para ${tipo}/${fab}` };
  }

  if (action === 'getlogs') {
    if (tipo === 'websocket_cloud') {
      const r = await sendTimmyCommand(terminal, { cmd: 'getnewlog', stn: true });
      return { success: r.result === true, message: `${r.count || 0} marcações recolhidas`, data: r };
    }
    if (tipo === 'adms_push') {
      return { success: true, message: 'Terminais ADMS enviam marcações automaticamente ao servidor.' };
    }
    if (tipo === 'sdk_tcp') {
      const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
      if (!ip) return { success: false, error: 'IP do terminal não configurado' };
      const port = terminal.porta || 80;
      const r = await fetch(`http://${ip}:${port}/iclock/cdata?SN=${terminal.numero_serie || ''}&table=ATTLOG&Stamp=0000-00-00+00:00:00`).catch(() => null);
      if (!r) return { success: false, error: 'Terminal não respondeu' };
      const body = await r.text().catch(() => '');
      const lines = body.split('\n').filter(l => l.trim());
      return { success: r.status < 400, message: `${lines.length} marcações obtidas (ZKTeco SDK)`, count: lines.length };
    }
    if (fab === 'hikvision') {
      const r = await hikvisionRequest(terminal, 'POST', '/ISAPI/AccessControl/AcsEvent?format=json', { AcsEventCond: { searchID: '1', searchResultPosition: 0, maxResults: 50 } });
      return { success: true, message: 'Marcações Hikvision recolhidas', data: r };
    }
    if (fab === 'dahua') {
      const r = await dahuaRequest(terminal, '/cgi-bin/recordFinder.cgi?action=find&name=AttendanceRecord&StartTime=2000-01-01%2000:00:00&EndTime=2099-12-31%2023:59:59');
      return { success: r.status === 200, message: 'Marcações Dahua recolhidas' };
    }
    return { success: false, error: `getlogs não suportado para ${tipo}/${fab}` };
  }

  if (action === 'opendoor') {
    if (tipo === 'websocket_cloud') {
      const r = await sendTimmyCommand(terminal, { cmd: 'opendoor' });
      return { success: r.result === true, message: 'Porta aberta', data: r };
    }
    if (tipo === 'adms_push' || tipo === 'sdk_tcp') {
      const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
      if (!ip) return { success: false, error: 'IP do terminal não configurado' };
      const port = terminal.porta || 80;
      const sn = terminal.numero_serie || '';
      const r = await fetch(`http://${ip}:${port}/iclock/cdata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `SN=${sn}&CMD=OPEN_DOOR&Lock=1`,
      }).catch(() => ({ status: 0 }));
      return { success: r.status < 400, message: 'Comando de abertura enviado ao ZKTeco' };
    }
    if (fab === 'hikvision') {
      const r = await hikvisionRequest(terminal, 'PUT', '/ISAPI/AccessControl/RemoteControl/door/1');
      return { success: true, message: 'Porta aberta (Hikvision)', data: r };
    }
    if (fab === 'dahua') {
      const r = await dahuaRequest(terminal, '/cgi-bin/accessControl.cgi?action=openDoor&channel=1');
      return { success: r.status === 200, message: 'Porta aberta (Dahua)', data: r };
    }
    return { success: false, error: `opendoor não suportado para ${tipo}/${fab}` };
  }

  if (action === 'reboot') {
    if (tipo === 'websocket_cloud') {
      await new Promise((resolve) => {
        const ws = new WebSocket(buildTimmyWsUrl(terminal));
        ws.onopen = () => { ws.send(JSON.stringify({ cmd: 'reboot' })); setTimeout(() => { ws.close(); resolve(); }, 1000); };
        ws.onerror = () => resolve();
        setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 5000);
      });
      return { success: true, message: 'Comando de reinício enviado' };
    }
    if (tipo === 'adms_push' || tipo === 'sdk_tcp') {
      const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
      if (!ip) return { success: false, error: 'IP do terminal não configurado' };
      const port = terminal.porta || 80;
      const sn = terminal.numero_serie || '';
      const r = await fetch(`http://${ip}:${port}/iclock/cdata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `SN=${sn}&CMD=REBOOT`,
      }).catch(() => ({ status: 0 }));
      return { success: r.status < 400, message: 'Comando de reinício enviado ao ZKTeco' };
    }
    if (fab === 'hikvision') {
      const r = await hikvisionRequest(terminal, 'PUT', '/ISAPI/System/reboot');
      return { success: true, message: 'Reinício enviado (Hikvision)', data: r };
    }
    if (fab === 'dahua') {
      const r = await dahuaRequest(terminal, '/cgi-bin/magicBox.cgi?action=reboot');
      return { success: r.status === 200, message: 'Reinício enviado (Dahua)' };
    }
    return { success: false, error: `reboot não suportado para ${tipo}/${fab}` };
  }

  if (action === 'getdevinfo') {
    if (tipo === 'websocket_cloud') {
      const r = await sendTimmyCommand(terminal, { cmd: 'getdevcap' });
      return { success: r.result === true, message: 'Info do dispositivo obtida', data: r };
    }
    if (tipo === 'adms_push' || tipo === 'sdk_tcp') {
      const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
      if (!ip) return { success: false, error: 'IP do terminal não configurado' };
      const port = terminal.porta || 80;
      const r = await fetch(`http://${ip}:${port}/iclock/getrequest?action=getinfo`).catch(() => null);
      if (!r) return { success: false, error: 'Terminal não respondeu' };
      const body = await r.text().catch(() => '');
      return { success: r.status < 400, message: 'Info do dispositivo ZKTeco obtida', data: { sn: terminal.numero_serie, modelo: terminal.modelo, raw: body.substring(0, 500) } };
    }
    if (fab === 'hikvision') {
      const r = await hikvisionRequest(terminal, 'GET', '/ISAPI/System/deviceInfo');
      return { success: true, message: 'Info Hikvision obtida', data: r };
    }
    if (fab === 'dahua') {
      const r = await dahuaRequest(terminal, '/cgi-bin/magicBox.cgi?action=getSystemInfo');
      return { success: r.status === 200, message: 'Info Dahua obtida', data: r.body };
    }
    return { success: false, error: `getdevinfo não suportado para ${tipo}/${fab}` };
  }

  if (action === 'lockctrl') {
    if (tipo === 'websocket_cloud') {
      const r = await sendTimmyCommand(terminal, { cmd: 'lockctrl', fuc: 1 });
      return { success: r.result === true, message: 'Porta forçada aberta', data: r };
    }
    return { success: false, error: 'lockctrl apenas suportado via WebSocket Cloud' };
  }

  return { success: false, error: `Ação desconhecida: ${action}` };
}

// ─── Verificar se um agendamento deve ser executado agora ────────────────────

function shouldRunNow(schedule, now) {
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  const [schedHour, schedMin] = (schedule.hora || '00:00').split(':').map(Number);

  // Janela de 5 minutos (o cron corre a cada 5 min)
  const nowMins = hour * 60 + minute;
  const schedMins = schedHour * 60 + schedMin;
  if (Math.abs(nowMins - schedMins) > 4) return false;

  // Evitar re-execução na mesma janela (se já executou nos últimos 6 minutos)
  if (schedule.ultima_execucao) {
    const lastRun = new Date(schedule.ultima_execucao);
    const diffMins = (now - lastRun) / 60000;
    if (diffMins < 6) return false;
  }

  const freq = schedule.frequencia;
  if (freq === 'diaria') return true;

  if (freq === 'semanal') {
    const dias = JSON.parse(schedule.dias_semana || '[1,2,3,4,5]');
    return dias.includes(now.getUTCDay());
  }

  if (freq === 'mensal') {
    return now.getUTCDate() === (schedule.dia_mes || 1);
  }

  if (freq === 'unica' && schedule.data_unica) {
    const target = new Date(schedule.data_unica);
    const diffMins = Math.abs((target - now) / 60000);
    return diffMins <= 4 && !schedule.ultima_execucao;
  }

  return false;
}

// ─── Handler Principal ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Permitir chamada sem autenticação (cron) mas verificar se é admin se houver sessão
    let callerEmail = 'sistema@cron';
    try {
      const user = await base44.auth.me();
      if (user) {
        if (user.role !== 'admin') {
          return Response.json({ error: 'Acesso negado' }, { status: 403 });
        }
        callerEmail = user.email;
      }
    } catch {}

    const now = new Date();
    const schedules = await base44.asServiceRole.entities.ScheduledAction.filter({ ativo: true });
    
    const results = [];
    let executed = 0;

    for (const schedule of schedules) {
      if (!shouldRunNow(schedule, now)) continue;

      let result;
      try {
        const terminal = await base44.asServiceRole.entities.Terminal.get(schedule.terminal_id);
        if (!terminal || !terminal.ativo) {
          result = { success: false, error: 'Terminal não encontrado ou inativo' };
        } else {
          result = await runAction(terminal, schedule.acao);
        }
      } catch (err) {
        result = { success: false, error: err.message };
      }

      const ts = now.toISOString();
      const sucesso = result.success !== false;

      // Gravar OperationLog
      await base44.asServiceRole.entities.OperationLog.create({
        terminal_id: schedule.terminal_id,
        terminal_nome: schedule.terminal_nome,
        acao: schedule.acao,
        executado_por: `cron:${schedule.nome}`,
        sucesso,
        mensagem: result.message || result.error || 'Executado via agendamento',
        resposta_raw: JSON.stringify(result),
        timestamp: ts,
      }).catch(() => {});

      // Atualizar agendamento
      const updates = {
        ultima_execucao: ts,
        ultimo_resultado: sucesso ? 'sucesso' : 'falha',
        total_execucoes: (schedule.total_execucoes || 0) + 1,
      };

      // Se é execução única, desativar após executar
      if (schedule.frequencia === 'unica') {
        updates.ativo = false;
      }

      await base44.asServiceRole.entities.ScheduledAction.update(schedule.id, updates).catch(() => {});

      results.push({ id: schedule.id, nome: schedule.nome, acao: schedule.acao, terminal: schedule.terminal_nome, sucesso, msg: result.message || result.error });
      executed++;
    }

    return Response.json({ ok: true, executed, results, checkedAt: now.toISOString() });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});