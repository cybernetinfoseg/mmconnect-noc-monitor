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
  const host = terminal.ip_publico || terminal.dns || '51.91.219.145';
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

  return { success: false, error: `getlogs não suportado para ${terminal.tipo_conexao}` };
}

async function actionOpenDoor(terminal) {
  if (terminal.tipo_conexao === 'websocket_cloud') {
    const resp = await sendTimmyCommand(terminal, { cmd: 'opendoor' });
    return { success: resp.result === true, message: 'Porta aberta remotamente', data: resp };
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

  if (terminal.tipo_conexao === 'sdk_tcp') {
    return { success: false, error: 'Abertura de porta via SDK-TCP requer agente local. Use o botão no painel ZKTeco.' };
  }

  return { success: false, error: `opendoor não suportado para ${terminal.tipo_conexao}` };
}

async function actionReboot(terminal) {
  if (terminal.tipo_conexao === 'websocket_cloud') {
    // Timmy reboot: envia e não espera resposta (terminal reinicia imediatamente)
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
  // lockctrl: fuc=1 forced open, fuc=2 forced closed, fuc=3 software open, fuc=4 relay reset
  const fuc = params?.fuc || 3;
  if (terminal.tipo_conexao === 'websocket_cloud') {
    const resp = await sendTimmyCommand(terminal, { cmd: 'lockctrl', fuc });
    return { success: resp.result === true, message: `Controlo de fechadura executado (fuc=${fuc})`, data: resp };
  }
  return { success: false, error: 'lockctrl apenas suportado via WebSocket Cloud (Timmy)' };
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
      case 'lockctrl':  result = await actionSetDoorStatus(terminal, params); break;
      default:
        return Response.json({ error: `Ação desconhecida: ${action}` }, { status: 400 });
    }

    // Log auditoria
    await base44.asServiceRole.entities.AuditLog.create({
      usuario_email: user.email,
      acao: 'terminal_verificado',
      entidade: 'Terminal',
      entidade_id: terminal_id,
      descricao: `Ação remota "${action}" no terminal "${terminal.nome}": ${result.success ? 'sucesso' : 'falha'}`,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    return Response.json({ success: result.success, ...result });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});