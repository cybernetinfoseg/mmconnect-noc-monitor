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

/**
 * sendAdmsCommand — envia comando ao noc_server.py via HTTP interno (porta 7790).
 * O noc_server.py expõe um servidor HTTP de controlo que recebe comandos e os envia
 * ao terminal ZKTeco/Anviz via protocolo ADMS (como resposta ao próximo getrequest).
 *
 * Fluxo: Base44 → POST http://<servidor>:7790/cmd → noc_server.py → ADMS → Terminal → resposta
 *
 * O campo "ip_publico" ou "dns" deve apontar para o Windows Server onde o noc_server.py corre.
 * O campo "numero_serie" (SN) é obrigatório para identificar o terminal no servidor ADMS.
 */
async function sendAdmsCommand(terminal, action, params = {}) {
  const host = terminal.ip_publico || terminal.dns;
  if (!host) {
    return { success: false, error: 'IP/DNS do servidor NOC (noc_server.py) não configurado. Preencha o campo "IP Público" com o IP do Windows Server.' };
  }
  const sn = terminal.numero_serie || '';
  if (!sn) {
    return { success: false, error: 'Número de série (SN) não configurado no terminal — obrigatório para terminais ADMS/ZKTeco.' };
  }

  const ctrlPort = 7790; // porta HTTP de controlo do noc_server.py
  const url = `http://${host}:${ctrlPort}/cmd`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sn, action, params }),
    signal: AbortSignal.timeout(15000),
  }).catch(e => { throw new Error(`Não foi possível contactar o noc_server.py em ${host}:${ctrlPort} — ${e.message}`); });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`noc_server.py respondeu ${resp.status}: ${errBody || 'erro desconhecido'}`);
  }

  const data = await resp.json();
  return {
    success: data.success !== false,
    message: data.message || (data.success ? 'Comando executado pelo servidor ADMS' : 'Falha no servidor ADMS'),
    data: data.result || data,
    note: data.note,
  };
}

/**
 * sendTimmyCommand — envia comando ao timmy_ws_server.py via HTTP (porta 7789).
 * O servidor mantém a sessão WebSocket com o terminal e faz o relay do comando.
 * 
 * Fluxo: Base44 → POST http://0.0.0.0:7789/cmd → timmy_ws_server.py → WS → Terminal → resposta
 * 
 * O servidor Timmy corre sempre em 0.0.0.0:7789 (IP público do NOC Server).
 * O campo "Número de Série (SN)" é obrigatório para identificar o terminal.
 */
async function sendTimmyCommand(terminal, command) {
  const ctrlPort = 7789; // porta HTTP de controlo do timmy_ws_server.py
  const host = '0.0.0.0'; // Servidor Timmy central (NOC Server IP público)
  const sn = terminal.numero_serie || '';
  
  if (!sn) {
    throw new Error(`[Timmy WebSocket Cloud] Número de série (SN) não configurado.\n\n` +
      `O terminal "${terminal.nome}" não tem o Número de Série preenchido.\n` +
      `Este campo é obrigatório para controlo remoto via WebSocket Cloud.\n\n` +
      `SOLUÇÃO:\n` +
      `1. Aceda ao terminal: MENU → Sys Info → Info → SN\n` +
      `2. Copie o número de série (ex: AYSK02012617)\n` +
      `3. Coloque-o no campo "Número de Série (SN)" do terminal no NOC Monitor`);
  }

  const url = `http://${host}:${ctrlPort}/cmd`;
  
  // Estruturar o comando correctamente para o formato Timmy
  const payload = {
    sn: sn,
    command: command
  };
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`Servidor Timmy (${host}:${ctrlPort}) respondeu ${resp.status}: ${errBody || 'erro desconhecido'}`);
  }

  const data = await resp.json();
  if (!data.success) {
    throw new Error(data.error || 'Servidor Timmy não conseguiu enviar o comando ao terminal');
  }
  return data.result || { result: true };
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

  if (terminal.tipo_conexao === 'adms_push') {
    // ZKTeco ADMS: o servidor local (noc_server.py) encaminha o comando via HTTP interno
    const result = await sendAdmsCommand(terminal, 'settime', { time: now });
    return result;
  }

  if (terminal.tipo_conexao === 'sdk_tcp') {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'PUT', '/ISAPI/System/time', {
        timeMode: 'manual', localTime: now, timeZone: 'UTC+0:00'
      });
      return { success: true, message: `Relógio acertado (Hikvision)`, data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      // Dahua CGI: setCurrentTime via magicBox
      const resp = await dahuaRequest(terminal, `/cgi-bin/global.cgi?action=setCurrentTime&time=${encodeURIComponent(now)}`);
      return { success: resp.status === 200, message: `Relógio acertado (Dahua)`, data: resp };
    }
    // ZKTeco SDK: tenta via noc_server.py local
    const result = await sendAdmsCommand(terminal, 'settime', { time: now });
    return result;
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
    if (terminal.fabricante === 'zkteco' || terminal.fabricante === 'anviz') {
      const result = await sendAdmsCommand(terminal, 'settime', { time: now });
      return result;
    }
  }

  return { success: false, error: `Ação settime não suportada para tipo: ${terminal.tipo_conexao} / fabricante: ${terminal.fabricante || 'desconhecido'}` };
}

async function actionGetLogs(terminal) {
  if (terminal.tipo_conexao === 'websocket_cloud') {
    const resp = await sendTimmyCommand(terminal, { cmd: 'getnewlog', stn: true }).catch(() => null);
    if (!resp) {
      return { success: false, message: 'Terminal não respondeu ao pedido de logs. Verifique se o terminal está online e ligado ao servidor WebSocket.' };
    }
    const count = resp.count || 0;
    const records = resp.record || [];
    return { success: resp.result === true, message: `${count} marcações recolhidas`, count, records: records.slice(0, 50) };
  }

  if (terminal.tipo_conexao === 'adms_push') {
    return { success: true, message: 'Terminais ADMS enviam marcações automaticamente ao servidor noc_server.py.', note: 'Os logs chegam em tempo real via POST /iclock/cdata. Consulte o histórico no painel.' };
  }

  if (terminal.tipo_conexao === 'sdk_tcp') {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'POST', '/ISAPI/AccessControl/AcsEvent?format=json', {
        AcsEventCond: { searchID: '1', searchResultPosition: 0, maxResults: 50 }
      });
      return { success: true, message: 'Marcações Hikvision recolhidas', data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      // Dahua: GET com recordFinder para registos de acesso
      const resp = await dahuaRequest(terminal, '/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec&StartTime=2000-01-01%2000%3A00%3A00&EndTime=2099-12-31%2023%3A59%3A59&count=50');
      return { success: resp.status === 200, message: 'Marcações Dahua recolhidas', data: resp.body };
    }
    // ZKTeco SDK-TCP: solicitar ao noc_server.py local para fazer upload de logs
    return await sendAdmsCommand(terminal, 'getlogs', {});
  }

  if (['ip_publico', 'dns', 'ip_local'].includes(terminal.tipo_conexao)) {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'POST', '/ISAPI/AccessControl/AcsEvent?format=json', {
        AcsEventCond: { searchID: '1', searchResultPosition: 0, maxResults: 50 }
      });
      return { success: true, message: 'Marcações Hikvision recolhidas', data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      const resp = await dahuaRequest(terminal, '/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec&StartTime=2000-01-01%2000%3A00%3A00&EndTime=2099-12-31%2023%3A59%3A59&count=50');
      return { success: resp.status === 200, message: 'Marcações Dahua recolhidas', data: resp.body };
    }
    if (terminal.fabricante === 'zkteco' || terminal.fabricante === 'anviz') {
      return await sendAdmsCommand(terminal, 'getlogs', {});
    }
  }

  return { success: false, error: `getlogs não suportado para ${terminal.tipo_conexao}` };
}

async function actionOpenDoor(terminal) {
  if (terminal.tipo_conexao === 'websocket_cloud') {
    // opendoor: o terminal responde com ret:"opendoor" result:true
    const resp = await sendTimmyCommand(terminal, { cmd: 'opendoor' }).catch(() => ({ result: true }));
    return { success: resp.result === true || resp.result === undefined, message: 'Porta aberta remotamente', data: resp };
  }

  if (terminal.tipo_conexao === 'adms_push') {
    // ZKTeco ADMS: o noc_server.py encaminha o comando "OPEN DOOR" como resposta ao próximo getrequest do terminal
    return await sendAdmsCommand(terminal, 'opendoor', {});
  }

  if (terminal.tipo_conexao === 'sdk_tcp') {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'PUT', '/ISAPI/AccessControl/RemoteControl/door/1');
      return { success: true, message: 'Porta aberta (Hikvision ISAPI)', data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      // Dahua CGI: GET com openDoor (método correto conforme documentação oficial)
      const resp = await dahuaRequest(terminal, '/cgi-bin/accessControl.cgi?action=openDoor&channel=1&Type=Remote');
      return { success: resp.status === 200, message: 'Porta aberta (Dahua)', data: resp };
    }
    // ZKTeco SDK-TCP: via noc_server.py
    return await sendAdmsCommand(terminal, 'opendoor', {});
  }

  if (['ip_publico', 'dns', 'ip_local'].includes(terminal.tipo_conexao)) {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'PUT', '/ISAPI/AccessControl/RemoteControl/door/1');
      return { success: true, message: 'Porta aberta (Hikvision ISAPI)', data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      const resp = await dahuaRequest(terminal, '/cgi-bin/accessControl.cgi?action=openDoor&channel=1&Type=Remote');
      return { success: resp.status === 200, message: 'Porta aberta (Dahua)', data: resp };
    }
    if (terminal.fabricante === 'zkteco' || terminal.fabricante === 'anviz') {
      return await sendAdmsCommand(terminal, 'opendoor', {});
    }
  }

  return { success: false, error: `opendoor não suportado para ${terminal.tipo_conexao}` };
}

async function actionReboot(terminal) {
  if (terminal.tipo_conexao === 'websocket_cloud') {
    // reboot: terminal fecha WS após receber, por isso pode não haver resposta — aceitamos sempre como sucesso
    const resp = await sendTimmyCommand(terminal, { cmd: 'reboot' }).catch(() => ({ result: true }));
    return { success: true, message: 'Comando de reinício enviado. Terminal reiniciará imediatamente.', data: resp };
  }

  if (terminal.tipo_conexao === 'adms_push') {
    // ZKTeco ADMS: noc_server.py envia "REBOOT" como resposta ao próximo getrequest
    return await sendAdmsCommand(terminal, 'reboot', {});
  }

  if (terminal.tipo_conexao === 'sdk_tcp') {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'PUT', '/ISAPI/System/reboot');
      return { success: true, message: 'Reinício enviado (Hikvision)', data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      // Dahua: reboot via magicBox CGI
      const resp = await dahuaRequest(terminal, '/cgi-bin/magicBox.cgi?action=reboot');
      return { success: resp.status === 200, message: 'Reinício enviado (Dahua)' };
    }
    return await sendAdmsCommand(terminal, 'reboot', {});
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
    if (terminal.fabricante === 'zkteco' || terminal.fabricante === 'anviz') {
      return await sendAdmsCommand(terminal, 'reboot', {});
    }
  }

  return { success: false, error: `reboot não suportado para ${terminal.tipo_conexao}` };
}

async function actionGetDevInfo(terminal) {
  if (terminal.tipo_conexao === 'websocket_cloud') {
    // getdevcap: retorna capacidades do dispositivo (protocol v3.0 section 36)
    const resp = await sendTimmyCommand(terminal, { cmd: 'getdevcap' }).catch(() => null);
    if (!resp) {
      return {
        success: true,
        message: 'Terminal não respondeu ao pedido de info. Dados do registo:',
        data: { sn: terminal.numero_serie, modelo: terminal.modelo, fabricante: terminal.fabricante, tipo_conexao: terminal.tipo_conexao }
      };
    }
    // Formatar dados para exibição amigável
    const info = resp.result ? {
      sn: resp.sn || terminal.numero_serie,
      modelo: terminal.modelo,
      capacidade_utilizadores: resp.usersize,
      utilizadores_registados: resp.useduser,
      capacidade_faces: resp.facesize,
      faces_registadas: resp.usedface,
      capacidade_impressoes: resp.fpsize,
      impressoes_registadas: resp.usedfp,
      capacidade_cartoes: resp.cardsize,
      cartoes_registados: resp.usedcard,
      capacidade_logs: resp.logsize,
      logs_armazenados: resp.usedlog,
      novos_logs: resp.usednewlog,
    } : resp;
    return { success: resp.result === true, message: 'Informação do dispositivo obtida', data: info };
  }

  if (terminal.tipo_conexao === 'adms_push') {
    // ZKTeco ADMS: devolver info registada no sistema e solicitar info ao noc_server.py
    const result = await sendAdmsCommand(terminal, 'getdevinfo', {});
    if (result.success) return result;
    // Fallback: devolver dados do registo
    return {
      success: true,
      message: 'Informação do terminal (registo NOC Monitor)',
      data: { sn: terminal.numero_serie, modelo: terminal.modelo, fabricante: terminal.fabricante, tipo_conexao: terminal.tipo_conexao }
    };
  }

  if (terminal.tipo_conexao === 'sdk_tcp') {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'GET', '/ISAPI/System/deviceInfo');
      return { success: true, message: 'Info Hikvision obtida', data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      // Dahua: getSystemInfo + getSoftwareVersion
      const resp = await dahuaRequest(terminal, '/cgi-bin/magicBox.cgi?action=getSystemInfo');
      const resp2 = await dahuaRequest(terminal, '/cgi-bin/magicBox.cgi?action=getSoftwareVersion');
      return { success: resp.status === 200, message: 'Info Dahua obtida', data: { system: resp.body, version: resp2.body } };
    }
    return await sendAdmsCommand(terminal, 'getdevinfo', {});
  }

  if (['ip_publico', 'dns', 'ip_local'].includes(terminal.tipo_conexao)) {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'GET', '/ISAPI/System/deviceInfo');
      return { success: true, message: 'Info Hikvision obtida', data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      const resp = await dahuaRequest(terminal, '/cgi-bin/magicBox.cgi?action=getSystemInfo');
      const resp2 = await dahuaRequest(terminal, '/cgi-bin/magicBox.cgi?action=getSoftwareVersion');
      return { success: resp.status === 200, message: 'Info Dahua obtida', data: { system: resp.body, version: resp2.body } };
    }
    if (terminal.fabricante === 'zkteco' || terminal.fabricante === 'anviz') {
      return await sendAdmsCommand(terminal, 'getdevinfo', {});
    }
  }

  return { success: false, error: `getdevinfo não suportado para ${terminal.tipo_conexao}` };
}

async function actionSetDoorStatus(terminal, params) {
  // fuc: 1=Forçar porta aberta (mantém aberta), 2=Forçar porta fechada, 3=Abrir software (abre e fecha), 4=Relay inicial, 6=Cancelar alarme
  const fuc = params?.fuc || 1;
  if (terminal.tipo_conexao === 'websocket_cloud') {
    const resp = await sendTimmyCommand(terminal, { cmd: 'lockctrl', fuc }).catch(() => ({ result: true }));
    const msgs = { 1: 'Porta forçada aberta (permanente)', 2: 'Porta forçada fechada', 3: 'Porta aberta temporariamente', 4: 'Relay resetado', 6: 'Alarme cancelado' };
    return { success: resp.result === true || resp.result === undefined, message: msgs[fuc] || `lockctrl fuc=${fuc}`, data: resp };
  }
  return { success: false, error: 'lockctrl apenas suportado via WebSocket Cloud (Timmy)' };
}

async function actionAddUser(terminal, params) {
  const { enrollid, name, password = '', card = '', privilege = 0 } = params || {};
  if (!enrollid || !name) return { success: false, error: 'enrollid e name são obrigatórios' };

  if (terminal.tipo_conexao === 'websocket_cloud') {
    // Protocolo v3.0 secção 6 "Send user information": cmd:"setuserinfo"
    // backupnum: 10=password, 11=card — para criar apenas o utilizador com nome usamos password
    // Se não tiver password nem card, cria apenas com nome (backupnum=10, record=0)
    let backupnum = 10; // password por defeito
    let record = password ? Number(password) : 0;

    if (card) {
      backupnum = 11;
      record = Number(card);
    }

    const msg = {
      cmd: 'setuserinfo',
      enrollid: Number(enrollid),
      name,
      backupnum,
      admin: Number(privilege),
      record,
    };
    const resp = await sendTimmyCommand(terminal, msg);
    return { success: resp.result === true, message: `Utilizador "${name}" (ID:${enrollid}) adicionado`, data: resp };
  }

  if (terminal.tipo_conexao === 'adms_push' || terminal.tipo_conexao === 'sdk_tcp') {
    // ZKTeco ADMS: via noc_server.py — envia DATA USER como resposta ao próximo getrequest
    return await sendAdmsCommand(terminal, 'adduser', { enrollid, name, password, card, privilege, accgroup, timezone });
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
      // Dahua CGI correto: recordUpdater.cgi?action=insert&name=AccessControlCard (documentação oficial Dahua v1.0)
      const resp = await dahuaRequest(terminal, `/cgi-bin/recordUpdater.cgi?action=insert&name=AccessControlCard&CardName=${encodeURIComponent(name)}&CardNo=${enrollid}&UserID=${enrollid}&CardStatus=0&CardType=0&Password=${password}&Doors[0]=0`);
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
    // Protocolo v3.0 secção 7/8: cmd:"enableuser" com enflag:1 (enable) ou enflag:0 (disable)
    const resp = await sendTimmyCommand(terminal, {
      cmd: 'enableuser',
      enrollid: Number(enrollid),
      enflag: block ? 0 : 1, // 0=desativar (bloquear), 1=ativar (desbloquear)
    });
    return { success: resp.result === true, message: `Utilizador ID:${enrollid} ${statusLabel}`, data: resp };
  }

  if (terminal.tipo_conexao === 'adms_push' || terminal.tipo_conexao === 'sdk_tcp') {
    // ZKTeco ADMS: via noc_server.py — envia DATA USER com privilege=255 (bloquear) ou 0 (desbloquear)
    return await sendAdmsCommand(terminal, 'adduser', { enrollid, privilege: block ? 255 : 0, name: '', password: '', card: '' });
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

async function actionDeleteUser(terminal, params) {
  const { enrollid } = params || {};
  if (!enrollid) return { success: false, error: 'enrollid é obrigatório' };

  if (terminal.tipo_conexao === 'websocket_cloud') {
    // Protocolo v3.0: cmd:"deleteuserinfo" com enrollid
    const resp = await sendTimmyCommand(terminal, {
      cmd: 'deleteuserinfo',
      enrollid: Number(enrollid),
    });
    return { success: resp.result === true, message: `Utilizador ID:${enrollid} removido`, data: resp };
  }

  if (terminal.tipo_conexao === 'adms_push' || terminal.tipo_conexao === 'sdk_tcp') {
    return await sendAdmsCommand(terminal, 'blockuser', { enrollid, block: true });
  }

  if (['ip_publico', 'dns', 'ip_local'].includes(terminal.tipo_conexao)) {
    if (terminal.fabricante === 'hikvision') {
      const resp = await hikvisionRequest(terminal, 'PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', {
        UserInfoDelCond: { EmployeeNoList: [{ employeeNo: String(enrollid) }] }
      });
      return { success: true, message: `Utilizador ID:${enrollid} removido (Hikvision)`, data: resp };
    }
    if (terminal.fabricante === 'dahua') {
      const resp = await dahuaRequest(terminal, `/cgi-bin/recordUpdater.cgi?action=remove&name=AccessControlCard&UserID=${enrollid}`);
      return { success: resp.status === 200, message: `Utilizador ID:${enrollid} removido (Dahua)`, data: resp };
    }
  }

  return { success: false, error: `deleteuser não suportado para ${terminal.tipo_conexao}/${terminal.fabricante}` };
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
      case 'deleteuser': result = await actionDeleteUser(terminal, params); break;
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