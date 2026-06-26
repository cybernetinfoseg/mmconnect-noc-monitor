/**
 * mainScheduler — executa a cada 5 minutos:
 *   1. monitorAllTerminals  — verifica status de todos os terminais
 *   2. processAlertRules    — avalia regras de alerta e envia notificações
 *   3. executeScheduledActions — executa ações remotas agendadas
 *   4. checkEscalations     — a cada hora (quando minutes % 60 < 5)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Constantes de monitorização ────────────────────────────────────────────
const PASSIVE_TIMEOUT = {
    ip_local:        150,
    heartbeat:       150,
    sdk_tcp:         150,
    p2s:             150,
    adms_push:       300,
    websocket_cloud: 150,
};
const PASSIVE_TYPES = new Set(['ip_local', 'heartbeat', 'adms_push', 'sdk_tcp', 'p2s', 'websocket_cloud']);
const ACTIVE_TYPES  = new Set(['ip_publico', 'dns', 'api']);
const HISTORY_THROTTLE_SECONDS = 3600;
const CHECK_TIMEOUT_MS = 5000;

// ─── Helpers de conexão activa ───────────────────────────────────────────────
async function checkTerminalActive(terminal) {
    const porta = terminal.porta || 5005;
    const inicio = Date.now();
    try {
        if (terminal.tipo_conexao === 'api' && terminal.api_endpoint) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
            try {
                const res = await fetch(terminal.api_endpoint, { signal: controller.signal });
                clearTimeout(timer);
                return { online: res.ok || res.status < 500, latencia_ms: Date.now() - inicio };
            } catch { clearTimeout(timer); return { online: false }; }
        }
        const host = terminal.tipo_conexao === 'ip_publico' ? terminal.ip_publico :
                     terminal.tipo_conexao === 'dns' ? terminal.dns : null;
        if (!host) return { online: false };
        try {
            const conn = await Promise.race([
                Deno.connect({ hostname: host, port: Number(porta) }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('tcp_timeout')), CHECK_TIMEOUT_MS))
            ]);
            conn.close();
            return { online: true, latencia_ms: Date.now() - inicio };
        } catch {}
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
            await fetch(`http://${host}:${porta}`, { signal: controller.signal });
            clearTimeout(timer);
            return { online: true, latencia_ms: Date.now() - inicio };
        } catch { return { online: false }; }
    } catch { return { online: false }; }
}

// ─── Helpers para ações agendadas ────────────────────────────────────────────
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

async function runScheduledAction(terminal, action) {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const tipo = terminal.tipo_conexao;
    const fab = terminal.fabricante || '';

    if (action === 'settime') {
        if (tipo === 'websocket_cloud') {
            const r = await sendTimmyCommand(terminal, { cmd: 'settime', cloudtime: now });
            return { success: r.result === true, message: `Relógio acertado para ${now}`, data: r };
        }
        if (tipo === 'adms_push' || tipo === 'sdk_tcp') {
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
            return { success: true, message: `Relógio será acertado na próxima sincronização ADMS (${now})` };
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
        if (tipo === 'adms_push') return { success: true, message: 'Terminais ADMS enviam marcações automaticamente.' };
        if (tipo === 'sdk_tcp') {
            const ip = terminal.ip_publico || terminal.dns || terminal.ip_local;
            if (!ip) return { success: false, error: 'IP do terminal não configurado' };
            const port = terminal.porta || 80;
            const r = await fetch(`http://${ip}:${port}/iclock/cdata?SN=${terminal.numero_serie || ''}&table=ATTLOG&Stamp=0000-00-00+00:00:00`).catch(() => null);
            if (!r) return { success: false, error: 'Terminal não respondeu' };
            const body = await r.text().catch(() => '');
            const lines = body.split('\n').filter(l => l.trim());
            return { success: r.status < 400, message: `${lines.length} marcações obtidas`, count: lines.length };
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
            if (!ip) return { success: false, error: 'IP não configurado' };
            const port = terminal.porta || 80;
            const sn = terminal.numero_serie || '';
            const r = await fetch(`http://${ip}:${port}/iclock/cdata`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `SN=${sn}&CMD=OPEN_DOOR&Lock=1`,
            }).catch(() => ({ status: 0 }));
            return { success: r.status < 400, message: 'Comando de abertura enviado' };
        }
        if (fab === 'hikvision') {
            const r = await hikvisionRequest(terminal, 'PUT', '/ISAPI/AccessControl/RemoteControl/door/1');
            return { success: true, message: 'Porta aberta (Hikvision)', data: r };
        }
        if (fab === 'dahua') {
            const r = await dahuaRequest(terminal, '/cgi-bin/accessControl.cgi?action=openDoor&channel=1');
            return { success: r.status === 200, message: 'Porta aberta (Dahua)' };
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
            if (!ip) return { success: false, error: 'IP não configurado' };
            const port = terminal.porta || 80;
            const sn = terminal.numero_serie || '';
            const r = await fetch(`http://${ip}:${port}/iclock/cdata`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `SN=${sn}&CMD=REBOOT`,
            }).catch(() => ({ status: 0 }));
            return { success: r.status < 400, message: 'Reinício enviado' };
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
            if (!ip) return { success: false, error: 'IP não configurado' };
            const port = terminal.porta || 80;
            const r = await fetch(`http://${ip}:${port}/iclock/getrequest?action=getinfo`).catch(() => null);
            if (!r) return { success: false, error: 'Terminal não respondeu' };
            const body = await r.text().catch(() => '');
            return { success: r.status < 400, message: 'Info obtida', data: { sn: terminal.numero_serie, modelo: terminal.modelo, raw: body.substring(0, 500) } };
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

function shouldRunNow(schedule, now) {
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const [schedHour, schedMin] = (schedule.hora || '00:00').split(':').map(Number);
    const nowMins = hour * 60 + minute;
    const schedMins = schedHour * 60 + schedMin;
    if (Math.abs(nowMins - schedMins) > 4) return false;
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
    if (freq === 'mensal') return now.getUTCDate() === (schedule.dia_mes || 1);
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

        const isAuthenticated = await base44.auth.isAuthenticated();
        if (isAuthenticated) {
            const user = await base44.auth.me();
            if (user?.role !== 'admin') {
                return Response.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const now = new Date();
        const summary = {};

        // ── 1. MONITORIZAR TERMINAIS ─────────────────────────────────────────
        const terminals = await base44.asServiceRole.entities.Terminal.filter({ ativo: true });
        const monitorResults = [];

        const chunkSize = 10;
        for (let i = 0; i < terminals.length; i += chunkSize) {
            const chunk = terminals.slice(i, i + chunkSize);
            const chunkResults = await Promise.all(chunk.map(async (terminal) => {
                try {
                    const tipo = terminal.tipo_conexao;
                    const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id: terminal.id });
                    const cache = cacheResults[0] || null;
                    const statusAnterior = cache?.ultimo_status || null;
                    let novoStatus;
                    let latencia_ms = null;
                    let timestampOffline = now;

                    if (PASSIVE_TYPES.has(tipo)) {
                        const timeoutSec = PASSIVE_TIMEOUT[tipo] || 150;
                        if (terminal.ultimo_ping) {
                            const ultimoPing = new Date(terminal.ultimo_ping);
                            const segundosSemPing = Math.floor((now - ultimoPing) / 1000);
                            novoStatus = segundosSemPing > timeoutSec ? 'offline' : 'online';
                            if (novoStatus === 'offline') {
                                timestampOffline = new Date(ultimoPing.getTime() + timeoutSec * 1000);
                            }
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                status: novoStatus,
                                segundos_sem_ping: segundosSemPing,
                                ultimo_check: now.toISOString(),
                            });
                        } else {
                            novoStatus = 'offline';
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                status: 'offline',
                                ultimo_check: now.toISOString(),
                            });
                        }
                    } else if (ACTIVE_TYPES.has(tipo)) {
                        const checkResult = await checkTerminalActive(terminal);
                        novoStatus = checkResult.online ? 'online' : 'offline';
                        latencia_ms = checkResult.latencia_ms || null;
                        await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                            status: novoStatus,
                            latencia_ms,
                            ultimo_check: now.toISOString(),
                            ...(checkResult.online ? { ultimo_ping: now.toISOString() } : {}),
                        });
                    } else {
                        return { terminal_id: terminal.id, terminal_nome: terminal.nome, skipped: true };
                    }

                    const statusMudou = statusAnterior !== novoStatus;

                    // Actualizar cache
                    if (cache) {
                        await base44.asServiceRole.entities.StatusCache.update(cache.id, {
                            ultimo_status: novoStatus, atualizado_em: now.toISOString(),
                        });
                    } else {
                        await base44.asServiceRole.entities.StatusCache.create({
                            terminal_id: terminal.id, ultimo_status: novoStatus, atualizado_em: now.toISOString(),
                        });
                    }

                    if (statusMudou && novoStatus === 'offline') {
                        await base44.asServiceRole.entities.AlertIncident.create({
                            terminal_id: terminal.id, terminal_nome: terminal.nome,
                            local: terminal.local, cliente: terminal.cliente_nome,
                            tipo: 'offline', timestamp: timestampOffline.toISOString(),
                            resolvido: false, notificado: false,
                        });
                        await base44.asServiceRole.entities.EscalationAlert.create({
                            terminal_id: terminal.id, terminal_nome: terminal.nome,
                            local: terminal.local || '', cliente: terminal.cliente_nome || '',
                            owner_email: terminal.created_by || '',
                            offline_desde: timestampOffline.toISOString(),
                            escalado: false, resolvido: false, notificacao_inicial_enviada: false,
                        }).catch(() => {});
                        await base44.asServiceRole.functions.invoke('pushNotify', {
                            action: 'notify_offline', terminal_id: terminal.id,
                            terminal_nome: terminal.nome, local: terminal.local || '',
                            cliente: terminal.cliente_nome || '', owner_email: terminal.created_by || '',
                        }).catch(() => {});
                        const users = await base44.asServiceRole.entities.User.list().catch(() => []);
                        const targets = users.filter(u => u.role === 'admin' || u.email === terminal.created_by);
                        for (const u of targets) {
                            if (u.telegram_bot_token && u.telegram_chat_id) {
                                const msg = `🔴 <b>Terminal Offline</b>\n\n📟 <b>${terminal.nome}</b>\n📍 Local: ${terminal.local || '—'}\n🏢 Cliente: ${terminal.cliente_nome || '—'}\n🕐 ${now.toLocaleString('pt-PT', { timeZone: 'UTC' })} UTC`;
                                await base44.asServiceRole.functions.invoke('telegramNotify', {
                                    bot_token: u.telegram_bot_token, chat_id: u.telegram_chat_id, message: msg,
                                }).catch(() => {});
                            }
                        }
                    }

                    if (statusMudou && novoStatus === 'online') {
                        const [openIncidents, openEscalations] = await Promise.all([
                            base44.asServiceRole.entities.AlertIncident.filter({ terminal_id: terminal.id, resolvido: false }).catch(() => []),
                            base44.asServiceRole.entities.EscalationAlert.filter({ terminal_id: terminal.id, resolvido: false }).catch(() => []),
                        ]);
                        for (const inc of openIncidents) {
                            const duracao = Math.round((now - new Date(inc.timestamp)) / 60000);
                            await base44.asServiceRole.entities.AlertIncident.update(inc.id, {
                                resolvido: true, resolvido_em: now.toISOString(), duracao_minutos: duracao,
                            }).catch(() => {});
                        }
                        for (const esc of openEscalations) {
                            await base44.asServiceRole.entities.EscalationAlert.update(esc.id, { resolvido: true }).catch(() => {});
                        }
                        await base44.asServiceRole.entities.AlertIncident.create({
                            terminal_id: terminal.id, terminal_nome: terminal.nome,
                            local: terminal.local || '', cliente: terminal.cliente_nome || '',
                            tipo: 'restored', timestamp: now.toISOString(),
                            resolvido: true, notificado: false,
                        }).catch(() => {});
                    }

                    const ultimoCheck = terminal.ultimo_check ? new Date(terminal.ultimo_check) : null;
                    const segundosDesdeUltimoCheck = ultimoCheck ? Math.floor((now - ultimoCheck) / 1000) : HISTORY_THROTTLE_SECONDS + 1;
                    if (statusMudou || segundosDesdeUltimoCheck >= HISTORY_THROTTLE_SECONDS) {
                        const tsHistorico = (statusMudou && novoStatus === 'offline') ? timestampOffline : now;
                        await base44.asServiceRole.entities.StatusHistory.create({
                            terminal_id: terminal.id, terminal_nome: terminal.nome,
                            status: novoStatus, timestamp: tsHistorico.toISOString(),
                            local: terminal.local || '', cliente: terminal.cliente_nome || '',
                        }).catch(() => {});
                    }

                    return { terminal_id: terminal.id, terminal_nome: terminal.nome, status: novoStatus, statusMudou, success: true };
                } catch (error) {
                    return { terminal_id: terminal.id, terminal_nome: terminal.nome, success: false, error: error.message };
                }
            }));
            monitorResults.push(...chunkResults);
        }

        summary.monitor = {
            total: terminals.length,
            monitored: monitorResults.filter(r => r.success).length,
            statusChanged: monitorResults.filter(r => r.statusMudou).length,
        };

        // ── 2. PROCESSAR REGRAS DE ALERTA ────────────────────────────────────
        const agora_ms = now.getTime();
        const ts = now.toLocaleString('pt-PT', { timeZone: 'UTC' }) + ' UTC';

        const [rules, allTerminals, janelasAtivas] = await Promise.all([
            base44.asServiceRole.entities.AlertRule.filter({ ativo: true }),
            base44.asServiceRole.entities.Terminal.list(),
            base44.asServiceRole.entities.MaintenanceWindow.filter({ ativo: true }),
        ]);

        const terminaisEmManutencao = new Set(
            janelasAtivas
                .filter(j => {
                    const ini = new Date(j.inicio).getTime();
                    const fim = new Date(j.fim).getTime();
                    return !isNaN(ini) && !isNaN(fim) && agora_ms >= ini && agora_ms <= fim;
                })
                .map(j => j.terminal_id)
        );
        const terminaisParaAlertas = allTerminals.filter(t => !terminaisEmManutencao.has(t.id));
        const alertsFired = [];

        for (const rule of rules) {
            if (rule.ultima_disparada) {
                const lastFired = new Date(rule.ultima_disparada);
                if (!isNaN(lastFired.getTime()) && (agora_ms - lastFired.getTime()) / 60000 < (rule.cooldown_minutos || 30)) continue;
            }

            let filteredTerminals = terminaisParaAlertas;
            if (rule.filtro_local) filteredTerminals = filteredTerminals.filter(t => t.local === rule.filtro_local);
            if (rule.filtro_cliente) filteredTerminals = filteredTerminals.filter(t => t.cliente_nome === rule.filtro_cliente || t.cliente === rule.filtro_cliente);

            let shouldFire = false;
            let messageBody = '';
            let slackText = '';

            if (rule.gatilho === 'terminal_offline') {
                const offline = filteredTerminals.filter(t => t.status === 'offline');
                if (offline.length > 0) {
                    shouldFire = true;
                    const list = offline.map(t => `• ${t.nome} (${t.local || '—'})`).join('\n');
                    messageBody = `Terminais offline detectados em ${ts}:\n\n${list}`;
                    slackText = `🔴 *Terminais offline* (${offline.length}):\n` + offline.map(t => `• \`${t.nome}\` — ${t.local || '—'}`).join('\n');
                }
            } else if (rule.gatilho === 'terminal_online') {
                const online = filteredTerminals.filter(t => t.status === 'online');
                if (online.length > 0) {
                    shouldFire = true;
                    const list = online.map(t => `• ${t.nome} (${t.local || '—'})`).join('\n');
                    messageBody = `Terminais online detectados em ${ts}:\n\n${list}`;
                    slackText = `🟢 *Terminais online* (${online.length}):\n` + online.map(t => `• \`${t.nome}\` — ${t.local || '—'}`).join('\n');
                }
            } else if (rule.gatilho === 'sem_ping_minutos') {
                const threshold = (rule.condicao_valor || 5) * 60;
                const stale = filteredTerminals.filter(t => t.ativo && (t.segundos_sem_ping || 0) >= threshold);
                if (stale.length > 0) {
                    shouldFire = true;
                    messageBody = `Terminais sem ping há mais de ${rule.condicao_valor} minutos:\n\n` + stale.map(t => `• ${t.nome} — ${Math.floor((t.segundos_sem_ping || 0) / 60)} min`).join('\n');
                    slackText = `⚠️ *Sem ping há +${rule.condicao_valor} min* (${stale.length}):\n` + stale.map(t => `• \`${t.nome}\` — ${Math.floor((t.segundos_sem_ping || 0) / 60)} min`).join('\n');
                }
            } else if (rule.gatilho === 'multiplos_offline') {
                const offlineCount = filteredTerminals.filter(t => t.status === 'offline').length;
                if (offlineCount >= (rule.condicao_valor || 2)) {
                    shouldFire = true;
                    messageBody = `${offlineCount} terminais estão offline em ${ts}.`;
                    slackText = `🚨 *Alerta crítico:* ${offlineCount} terminais offline simultaneamente em ${ts}`;
                }
            }

            if (!shouldFire) continue;

            const canal = rule.canal || 'email';
            if ((canal === 'email' || canal === 'ambos') && rule.destinatarios_email) {
                const emails = rule.destinatarios_email.split(',').map(e => e.trim()).filter(Boolean);
                await Promise.all(emails.map(email =>
                    base44.asServiceRole.integrations.Core.SendEmail({
                        to: email,
                        subject: `[NOC Monitor] Alerta: ${rule.nome}`,
                        body: `Regra disparada: ${rule.nome}\n\n${messageBody}\n\n---\nNOC Monitor • Terminais Biométricos`,
                    }).catch(() => {})
                ));
            }
            if ((canal === 'slack' || canal === 'ambos') && rule.slack_webhook_url) {
                await fetch(rule.slack_webhook_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        blocks: [
                            { type: 'header', text: { type: 'plain_text', text: `🚨 NOC Monitor: ${rule.nome}` } },
                            { type: 'section', text: { type: 'mrkdwn', text: slackText || messageBody } },
                            { type: 'context', elements: [{ type: 'mrkdwn', text: `*Regra:* ${rule.nome} • ${ts}` }] },
                        ],
                    }),
                }).catch(() => {});
            }

            await base44.asServiceRole.entities.AlertRule.update(rule.id, {
                ultima_disparada: now.toISOString(),
                total_disparos: (rule.total_disparos || 0) + 1,
            });
            alertsFired.push(rule.nome);
        }

        summary.alerts = { processed: rules.length, fired: alertsFired.length };

        // ── 3. EXECUTAR AÇÕES AGENDADAS ──────────────────────────────────────
        const schedules = await base44.asServiceRole.entities.ScheduledAction.filter({ ativo: true });
        let scheduledExecuted = 0;

        for (const schedule of schedules) {
            if (!shouldRunNow(schedule, now)) continue;

            let result;
            try {
                const terminal = await base44.asServiceRole.entities.Terminal.get(schedule.terminal_id);
                if (!terminal || !terminal.ativo) {
                    result = { success: false, error: 'Terminal não encontrado ou inativo' };
                } else {
                    result = await runScheduledAction(terminal, schedule.acao);
                }
            } catch (err) {
                result = { success: false, error: err.message };
            }

            const sucesso = result.success !== false;
            await base44.asServiceRole.entities.OperationLog.create({
                terminal_id: schedule.terminal_id, terminal_nome: schedule.terminal_nome,
                acao: schedule.acao, executado_por: `cron:${schedule.nome}`,
                sucesso, mensagem: result.message || result.error || 'Executado via agendamento',
                resposta_raw: JSON.stringify(result), timestamp: now.toISOString(),
            }).catch(() => {});

            const updates = {
                ultima_execucao: now.toISOString(),
                ultimo_resultado: sucesso ? 'sucesso' : 'falha',
                total_execucoes: (schedule.total_execucoes || 0) + 1,
            };
            if (schedule.frequencia === 'unica') updates.ativo = false;
            await base44.asServiceRole.entities.ScheduledAction.update(schedule.id, updates).catch(() => {});
            scheduledExecuted++;
        }

        summary.scheduled = { checked: schedules.length, executed: scheduledExecuted };

        // ── 4. ESCALAÇÕES (apenas quando minutos são múltiplos de 60) ────────
        const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
        if (minuteOfDay % 60 < 5) {
            const threshold24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const [openAlerts, admins, allUsersEsc, terminalsEsc] = await Promise.all([
                base44.asServiceRole.entities.EscalationAlert.filter({ resolvido: false, escalado: false }),
                base44.asServiceRole.entities.User.filter({ role: 'admin' }),
                base44.asServiceRole.entities.User.list().catch(() => []),
                base44.asServiceRole.entities.Terminal.list(),
            ]);
            const adminEmails = admins.map(a => a.email).filter(Boolean);
            const usersWithTelegram = allUsersEsc.filter(u => u.telegram_bot_token && u.telegram_chat_id);
            const onlineIds = new Set(terminalsEsc.filter(t => t.status === 'online').map(t => t.id));
            const escalated = [];

            for (const alert of openAlerts) {
                const offlineSince = new Date(alert.offline_desde);
                if (isNaN(offlineSince.getTime()) || offlineSince > threshold24h) continue;
                const duracao = Math.round((now - offlineSince) / 60000);
                await Promise.all([
                    ...adminEmails.map(email =>
                        base44.asServiceRole.integrations.Core.SendEmail({
                            to: email,
                            subject: `[ESCALAÇÃO] Terminal ${alert.terminal_nome} offline há +24h`,
                            body: `ALERTA ESCALADO\n\nO terminal "${alert.terminal_nome}" localizado em "${alert.local || '—'}" (cliente: ${alert.cliente || '—'}) está OFFLINE há mais de 24 horas.\n\nOffline desde: ${new Date(alert.offline_desde).toLocaleString('pt-PT', { timeZone: 'UTC' })} UTC\nDuração: ~${duracao} minutos\nDono: ${alert.owner_email || '—'}\n\n---\nNOC Monitor`,
                        }).catch(() => {})
                    ),
                    ...usersWithTelegram
                        .filter(u => adminEmails.includes(u.email) || u.email === alert.owner_email)
                        .map(u => base44.asServiceRole.functions.invoke('telegramNotify', {
                            bot_token: u.telegram_bot_token, chat_id: u.telegram_chat_id,
                            message: `🚨 <b>Escalação: Terminal Crítico Offline +24h</b>\n\n📟 <b>${alert.terminal_nome}</b>\n📍 ${alert.local || '—'}\n🏢 ${alert.cliente || '—'}\n⏱ Desde: ${new Date(alert.offline_desde).toLocaleString('pt-PT', { timeZone: 'UTC' })} UTC\n⌛ ~${duracao} min\n👤 ${alert.owner_email || '—'}`,
                        }).catch(() => {})),
                ]);
                await base44.asServiceRole.entities.EscalationAlert.update(alert.id, {
                    escalado: true, escalado_em: now.toISOString(),
                });
                escalated.push(alert.terminal_nome);
            }

            const allOpen = await base44.asServiceRole.entities.EscalationAlert.filter({ resolvido: false });
            const toResolve = allOpen.filter(a => onlineIds.has(a.terminal_id));
            await Promise.all(toResolve.map(a =>
                base44.asServiceRole.entities.EscalationAlert.update(a.id, { resolvido: true }).catch(() => {})
            ));

            summary.escalations = { escalated: escalated.length, resolved: toResolve.length };
        }

        console.log('[mainScheduler]', JSON.stringify(summary));
        return Response.json({ success: true, summary, timestamp: now.toISOString() });

    } catch (error) {
        console.error('[mainScheduler] erro:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});