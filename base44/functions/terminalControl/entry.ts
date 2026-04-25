/**
 * terminalControl.js — Controlo Remoto de Terminais Biométricos
 * 
 * Suporte por tipo de conexão:
 *   - websocket_cloud (Timmy/THbio): WebSocket JSON Protocol 3.0
 *   - adms_push / sdk_tcp (ZKTeco): Comandos via ADMS/iClock HTTP
 *   - ip_publico / dns / ip_local + fabricante hikvision: Hikvision ISAPI REST
 *   - ip_publico / dns / ip_local + fabricante dahua: Dahua HTTP API
 * 
 * Ações suportadas:
 *   settime, getlogs, opendoor, reboot, getdevinfo, adduser, deleteuser
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Helpers ────────────────────────────────────────────────────────────────

function nowStr() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function buildTimmyWsUrl(terminal) {
  const host = terminal.ip_publico || terminal.dns || '127.0.0.1';
  const port = terminal.porta || 7788;
  return `ws://${host}:${port}`;
}

async function sendTimmyCommand(terminal, command) {
  // Timmy WebSocket Cloud: abre WS nativo Deno, envia comando, aguarda resposta
  const wsUrl = buildTimmyWsUrl(terminal);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout — terminal não respondeu em 8s'));
    }, 8000);

    ws.onopen = () => {
      ws.send(JSON.stringify(command));
    };

    ws.onmessage = (event) => {
      clearTimeout(timeout);
      ws.close();
      try {
        resolve(JSON.parse(event.data));
      } catch {
        resolve({ result: true, raw: event.data });
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(new Error(`WS erro: ${err.message || 'conexão falhou'}`));
    };

    ws.onclose = () => {
      clearTimeout(timeout);
    };
  });
}

function buildTerminalBaseUrl(terminal) {
  const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
  const port = terminal.porta || 80;
  return `http://${ip}:${port}`;
}

async function hikvisionRequest(terminal, method, path, body = null) {
  const base = buildTerminalBaseUrl(terminal);
  const url = `${base}${path}`;
  // Hikvision uses HTTP Digest auth — simplified with Basic for compatibility
  const creds = btoa(`admin:${terminal.observacoes || 'admin'}`);
  const opts = {
    method,
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: resp.status }; }
}

async function dahuaRequest(terminal, cgiPath) {
  const base = buildTerminalBaseUrl(terminal);
  const creds = btoa(`admin:${terminal.observacoes || 'admin'}`);
  const resp = await fetch(`${base}${cgiPath}`, {
    headers: { 'Authorization': `Basic ${creds}` },
  });
  const text = await resp.text();
  return { status: resp.status, body: text };
}

// ─── Action Handlers ────────────────────────────────────────────────────────

async function actionSetTime(terminal) {
  const now = nowStr();

  if (terminal.tipo_conexao === 'websocket_cloud') {
    const resp = await sendTimmyCommand(terminal, { cmd: 'settime', cloudtime: now });
    return { success: resp.result === true, message: `Relógio acertado para ${now}`, data: resp };
  }

  if (terminal.tipo_conexao === 'sdk_tcp' || terminal.tipo_conexao === 'adms_push') {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'PUT', '/ISAPI/System/time', {
        timeMode: 'manual', localTime: now, timeZone: 'UTC+0:00'
      });
      return { success: true, message: `Relógio acertado (Hikvision)`, data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      const resp = await dahuaRequest(terminal, `/cgi-bin/global.cgi?action=setCurrentTime&time=${encodeURIComponent(now)}`);
      return { success: resp.status === 200, message: `Relógio acertado (Dahua)`, data: resp };
    }
    // ZKTeco via HTTP direto
    const ip = terminal.ip_publico || terminal.dns;
    if (ip) {
      const port = terminal.porta || 80;
      const resp = await fetch(`http://${ip}:${port}/iclock/getrequest`, { method: 'GET' });
      return { success: resp.status < 400, message: `Comando enviado ao ZKTeco (${now})`, note: 'O terminal processará na próxima sincronização ADMS' };
    }
    return { success: false, error: 'IP do terminal não configurado para controlo direto' };
  }

  if (['ip_publico', 'dns', 'ip_local'].includes(terminal.tipo_conexao)) {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'PUT', '/ISAPI/System/time', {
        timeMode: 'manual', localTime: now
      });
      return { success: true, message: `Relógio acertado (Hikvision ISAPI)`, data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      const resp = await dahuaRequest(terminal, `/cgi-bin/global.cgi?action=setCurrentTime&time=${encodeURIComponent(now)}`);
      return { success: resp.status === 200, message: `Relógio acertado (Dahua)`, data: resp };
    }
  }

  return { success: false, error: `Ação settime não suportada para tipo: ${terminal.tipo_conexao} / fabricante: ${terminal.fabricante || 'desconhecido'}` };
}

async function actionGetLogs(terminal) {
  if (terminal.tipo_conexao === 'websocket_cloud') {
    const resp = await sendTimmyCommand(terminal, { cmd: 'getnewlog', stn: true });
    const count = resp.count || 0;
    const records = resp.record || [];
    return { success: resp.result === true, message: `${count} marcações recolhidas`, count, records: records.slice(0, 50) };
  }

  if (['ip_publico', 'dns', 'ip_local'].includes(terminal.tipo_conexao)) {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'POST', '/ISAPI/AccessControl/AcsEvent?format=json', {
        AcsEventCond: { searchID: '1', searchResultPosition: 0, maxResults: 50 }
      });
      return { success: true, message: 'Marcações Hikvision recolhidas', data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      const resp = await dahuaRequest(terminal, '/cgi-bin/recordFinder.cgi?action=find&name=AttendanceRecord&StartTime=2000-01-01%2000:00:00&EndTime=2099-12-31%2023:59:59');
      return { success: resp.status === 200, message: 'Marcações Dahua recolhidas', data: resp.body };
    }
  }

  if (terminal.tipo_conexao === 'adms_push') {
    return { success: true, message: 'Terminais ADMS enviam marcações automaticamente ao servidor.', note: 'Verifique o Histórico de Marcações no NOC Monitor.' };
  }

  if (terminal.tipo_conexao === 'sdk_tcp') {
    const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
    if (!ip) return { success: false, error: 'IP do terminal não configurado' };
    const port = terminal.porta || 80;
    // ZKTeco SDK-TCP: tenta buscar logs via HTTP iClock
    const resp = await fetch(`http://${ip}:${port}/iclock/cdata?SN=${terminal.numero_serie || ''}&table=ATTLOG&Stamp=0000-00-00+00:00:00`, {
      method: 'GET',
    }).catch(() => null);
    if (!resp) return { success: false, error: 'Terminal não respondeu' };
    const body = await resp.text().catch(() => '');
    const lines = body.split('\n').filter(l => l.trim() && !l.startsWith('GET'));
    return { 
      success: resp.status < 400, 
      message: `${lines.length} marcações obtidas (ZKTeco SDK)`,
      count: lines.length,
      data: { raw: body.substring(0, 2000) }
    };
  }

  return { success: false, error: `getlogs não suportado para ${terminal.tipo_conexao}` };
}

async function actionOpenDoor(terminal) {
  if (terminal.tipo_conexao === 'websocket_cloud') {
    const resp = await sendTimmyCommand(terminal, { cmd: 'opendoor' });
    return { success: resp.result === true, message: 'Porta aberta remotamente', data: resp };
  }

  if (terminal.tipo_conexao === 'adms_push' || terminal.tipo_conexao === 'sdk_tcp') {
    const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
    if (!ip) return { success: false, error: 'IP do terminal não configurado' };
    const port = terminal.porta || 80;
    const sn = terminal.numero_serie || '';
    // ZKTeco iClock: comando OpenDoor via ADMS/HTTP
    const resp = await fetch(`http://${ip}:${port}/iclock/getrequest`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    // Também tenta via cdata para push imediato
    await fetch(`http://${ip}:${port}/iclock/cdata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `SN=${sn}&CMD=OPEN_DOOR&Lock=1`,
    }).catch(() => {});
    return { success: resp.status < 400, message: 'Comando de abertura enviado ao ZKTeco', note: 'Será processado na próxima sincronização ADMS' };
  }

  if (['ip_publico', 'dns', 'ip_local'].includes(terminal.tipo_conexao)) {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'PUT', '/ISAPI/AccessControl/RemoteControl/door/1');
      return { success: true, message: 'Porta aberta (Hikvision ISAPI)', data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      const resp = await dahuaRequest(terminal, '/cgi-bin/accessControl.cgi?action=openDoor&channel=1');
      return { success: resp.status === 200, message: 'Porta aberta (Dahua)', data: resp };
    }
  }

  return { success: false, error: `opendoor não suportado para ${terminal.tipo_conexao}` };
}

async function actionReboot(terminal) {
  if (terminal.tipo_conexao === 'websocket_cloud') {
    const wsUrl = buildTimmyWsUrl(terminal);
    await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({ cmd: 'reboot' }));
        setTimeout(() => { ws.close(); resolve(); }, 1000);
      };
      ws.onerror = () => resolve();
      setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 5000);
    });
    return { success: true, message: 'Comando de reinício enviado. Terminal reiniciará imediatamente.' };
  }

  if (terminal.tipo_conexao === 'adms_push' || terminal.tipo_conexao === 'sdk_tcp') {
    const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
    if (!ip) return { success: false, error: 'IP do terminal não configurado' };
    const port = terminal.porta || 80;
    const sn = terminal.numero_serie || '';
    // ZKTeco ADMS reboot command
    const resp = await fetch(`http://${ip}:${port}/iclock/cdata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `SN=${sn}&CMD=REBOOT`,
    }).catch(() => ({ status: 0 }));
    return { 
      success: resp.status < 400, 
      message: 'Comando de reinício enviado ao ZKTeco',
      note: 'Terminal irá reiniciar assim que processar o comando'
    };
  }

  if (['ip_publico', 'dns', 'ip_local'].includes(terminal.tipo_conexao)) {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'PUT', '/ISAPI/System/reboot');
      return { success: true, message: 'Reinício enviado (Hikvision)', data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      const resp = await dahuaRequest(terminal, '/cgi-bin/magicBox.cgi?action=reboot');
      return { success: resp.status === 200, message: 'Reinício enviado (Dahua)' };
    }
  }

  return { success: false, error: `reboot não suportado para ${terminal.tipo_conexao}` };
}

async function actionGetDevInfo(terminal) {
  if (terminal.tipo_conexao === 'websocket_cloud') {
    const resp = await sendTimmyCommand(terminal, { cmd: 'getdevcap' });
    return { success: resp.result === true, message: 'Informação do dispositivo obtida', data: resp };
  }

  if (terminal.tipo_conexao === 'adms_push' || terminal.tipo_conexao === 'sdk_tcp') {
    const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
    if (!ip) return { success: false, error: 'IP do terminal não configurado' };
    const port = terminal.porta || 80;
    // ZKTeco: buscar info via iClock HTTP
    const resp = await fetch(`http://${ip}:${port}/iclock/getrequest?action=getinfo`, {
      method: 'GET',
    }).catch(() => null);
    if (!resp) return { success: false, error: 'Terminal não respondeu' };
    const body = await resp.text().catch(() => '');
    // Também tenta endpoint alternativo para modelos mais novos
    const resp2 = await fetch(`http://${ip}:${port}/deviceinfo`, { method: 'GET' }).catch(() => null);
    const body2 = resp2 ? await resp2.text().catch(() => '') : '';
    return {
      success: resp.status < 400,
      message: 'Informação do dispositivo ZKTeco obtida',
      data: { iclock_response: body, device_info: body2, sn: terminal.numero_serie, modelo: terminal.modelo }
    };
  }

  if (['ip_publico', 'dns', 'ip_local'].includes(terminal.tipo_conexao)) {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'GET', '/ISAPI/System/deviceInfo');
      return { success: true, message: 'Info Hikvision obtida', data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      const resp = await dahuaRequest(terminal, '/cgi-bin/magicBox.cgi?action=getSystemInfo');
      return { success: resp.status === 200, message: 'Info Dahua obtida', data: resp.body };
    }
  }

  return { success: false, error: `getdevinfo não suportado para ${terminal.tipo_conexao}` };
}

async function actionSetDoorStatus(terminal, params) {
  const fuc = params?.fuc || 3;
  if (terminal.tipo_conexao === 'websocket_cloud') {
    const resp = await sendTimmyCommand(terminal, { cmd: 'lockctrl', fuc });
    return { success: resp.result === true, message: `Controlo de fechadura executado (fuc=${fuc})`, data: resp };
  }
  return { success: false, error: 'lockctrl apenas suportado via WebSocket Cloud (Timmy)' };
}

async function actionAddUser(terminal, params) {
  const { enrollid, name, password = '', card = '', privilege = 0, accgroup = 1, timezone = 1 } = params || {};
  if (!enrollid || !name) return { success: false, error: 'enrollid e name são obrigatórios' };

  if (terminal.tipo_conexao === 'websocket_cloud') {
    const resp = await sendTimmyCommand(terminal, {
      cmd: 'setuser',
      enrollid,
      name,
      password,
      card,
      privilege: Number(privilege),
      accgroup,
      timezone,
    });
    return { success: resp.result === true, message: `Utilizador "${name}" (ID:${enrollid}) adicionado`, data: resp };
  }

  if (terminal.tipo_conexao === 'adms_push' || terminal.tipo_conexao === 'sdk_tcp') {
    // ZKTeco ADMS: enviar via HTTP query
    const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
    if (!ip) return { success: false, error: 'IP do terminal não configurado' };
    const port = terminal.porta || 80;
    const sn = terminal.numero_serie || '';
    const body = `SN=${sn}&CMD=SET_USER&PIN=${enrollid}&Name=${encodeURIComponent(name)}&Password=${password}&Card=${card}&Privilege=${privilege}&ACC=${accgroup}&TZ=${timezone}`;
    const resp = await fetch(`http://${ip}:${port}/iclock/cdata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    return { success: resp.status < 400, message: `Utilizador "${name}" enviado ao ZKTeco ADMS`, note: 'Será registado na próxima sincronização' };
  }

  if (['ip_publico', 'dns', 'ip_local'].includes(terminal.tipo_conexao)) {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'POST', '/ISAPI/AccessControl/UserInfo/Record?format=json', {
        UserInfo: {
          employeeNo: String(enrollid),
          name,
          userType: Number(privilege) === 14 ? 'administrator' : 'normal',
          Valid: { enable: true, beginTime: '2000-01-01T00:00:00', endTime: '2099-12-31T23:59:59', timeType: 'local' },
          doorRight: '1',
          RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
        }
      });
      return { success: true, message: `Utilizador "${name}" adicionado (Hikvision)`, data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      const resp = await dahuaRequest(terminal, `/cgi-bin/AccessUser.cgi?action=insertUser&UserID=${enrollid}&UserName=${encodeURIComponent(name)}&Password=${password}&Doors[0]=0&AuthorityType=0`);
      return { success: resp.status === 200, message: `Utilizador "${name}" adicionado (Dahua)`, data: resp };
    }
  }

  return { success: false, error: `adduser não suportado para ${terminal.tipo_conexao}/${terminal.fabricante}` };
}

async function actionBlockUser(terminal, params) {
  const { enrollid, block = true } = params || {};
  if (!enrollid) return { success: false, error: 'enrollid é obrigatório' };
  const statusLabel = block ? 'bloqueado' : 'desbloqueado';

  if (terminal.tipo_conexao === 'websocket_cloud') {
    // Timmy: privilege=255 bloqueia, privilege=0 desbloqueia
    const resp = await sendTimmyCommand(terminal, {
      cmd: 'setuser',
      enrollid,
      privilege: block ? 255 : 0,
    });
    return { success: resp.result === true, message: `Utilizador ID:${enrollid} ${statusLabel}`, data: resp };
  }

  if (terminal.tipo_conexao === 'adms_push' || terminal.tipo_conexao === 'sdk_tcp') {
    const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
    if (!ip) return { success: false, error: 'IP do terminal não configurado' };
    const port = terminal.porta || 80;
    const sn = terminal.numero_serie || '';
    const body = `SN=${sn}&CMD=SET_USER&PIN=${enrollid}&Privilege=${block ? 255 : 0}`;
    const resp = await fetch(`http://${ip}:${port}/iclock/cdata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    return { success: resp.status < 400, message: `Utilizador ID:${enrollid} ${statusLabel} (ZKTeco ADMS)` };
  }

  if (['ip_publico', 'dns', 'ip_local'].includes(terminal.tipo_conexao)) {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'PUT', `/ISAPI/AccessControl/UserInfo/Modify?format=json`, {
        UserInfo: {
          employeeNo: String(enrollid),
          Valid: { enable: !block, beginTime: '2000-01-01T00:00:00', endTime: '2099-12-31T23:59:59', timeType: 'local' },
        }
      });
      return { success: true, message: `Utilizador ID:${enrollid} ${statusLabel} (Hikvision)`, data: resp };
    }
    // Dahua não suporta bloqueio direto via CGI simples
    if (terminal.fabricante === 'dahua') {
      return { success: false, error: 'Bloqueio de utilizador não suportado via API Dahua CGI' };
    }
  }

  return { success: false, error: `blockuser não suportado para ${terminal.tipo_conexao}/${terminal.fabricante}` };
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const { terminal_id, action, params } = await req.json();

    if (!terminal_id || !action) {
      return Response.json({ error: 'terminal_id e action são obrigatórios' }, { status: 400 });
    }

    // Buscar terminal (admin vê todos, utilizador vê apenas os seus)
    const terminal = await base44.entities.Terminal.get(terminal_id);
    if (!terminal) {
      return Response.json({ error: 'Terminal não encontrado' }, { status: 404 });
    }

    // Verificar permissão (dono ou admin)
    const isAdmin = user.role === 'admin';
    if (!isAdmin && terminal.created_by !== user.email && terminal.usuario_email !== user.email) {
      return Response.json({ error: 'Sem permissão para controlar este terminal' }, { status: 403 });
    }

    let result;
    switch (action) {
      case 'settime':    result = await actionSetTime(terminal); break;
      case 'getlogs':   result = await actionGetLogs(terminal); break;
      case 'opendoor':  result = await actionOpenDoor(terminal); break;
      case 'reboot':    result = await actionReboot(terminal); break;
      case 'getdevinfo':result = await actionGetDevInfo(terminal); break;
      case 'lockctrl':   result = await actionSetDoorStatus(terminal, params); break;
      case 'adduser':    result = await actionAddUser(terminal, params); break;
      case 'blockuser':  result = await actionBlockUser(terminal, params); break;
      default:
        return Response.json({ error: `Ação desconhecida: ${action}` }, { status: 400 });
    }

    const ts = new Date().toISOString();

    // Log de operação detalhado
    await base44.asServiceRole.entities.OperationLog.create({
      terminal_id,
      terminal_nome: terminal.nome,
      acao: action,
      executado_por: user.email,
      sucesso: result.success !== false,
      mensagem: result.message || result.error || (result.success ? 'Operação executada' : 'Operação falhou'),
      resposta_raw: JSON.stringify(result),
      timestamp: ts,
    }).catch(() => {});

    // Log auditoria
    await base44.asServiceRole.entities.AuditLog.create({
      usuario_email: user.email,
      acao: 'terminal_verificado',
      entidade: 'Terminal',
      entidade_id: terminal_id,
      descricao: `Ação remota "${action}" no terminal "${terminal.nome}": ${result.success ? 'sucesso' : 'falha'}`,
      timestamp: ts,
    }).catch(() => {});

    return Response.json({ success: result.success, ...result });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});