/**
 * monitorAllTerminals — verifica o status de todos os terminais ativos.
 *
 * Lógica por tipo de conexão:
 *   PASSIVOS (dependem de push externo — verificar apenas timeout do último ping):
 *     - ip_local   → Agente Local (agentReport) — timeout 150s
 *     - heartbeat  → NOC Server TCP heartbeat — timeout 150s
 *     - adms_push  → NOC Server HTTP ADMS — timeout 300s (ciclo mais lento)
 *     - sdk_tcp    → NOC Server polling SDK — timeout 150s
 *     - p2s        → P2S Server (conexão inversa) — timeout 150s
 *
 *   ATIVOS (sondagem direta via TCP/HTTP):
 *     - ip_publico → TCP/HTTP direto ao terminal
 *     - dns        → TCP/HTTP direto ao terminal (via hostname)
 *     - api        → HTTP GET ao endpoint configurado
 *
 * THROTTLE do histórico: só grava StatusHistory quando:
 *   - há mudança de status, OU
 *   - passou mais de 1 hora desde o último registo
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Timeout para terminais passivos (segundos sem ping → offline)
const PASSIVE_TIMEOUT = {
    ip_local:         150,  // agente reporta a cada 30s → 5× margem
    heartbeat:        150,  // noc_server heartbeat TCP
    sdk_tcp:          150,  // noc_server SDK polling
    p2s:              150,  // p2s_server conexão inversa
    adms_push:        300,  // ADMS ciclo mais lento (pode ser até 2min)
    websocket_cloud:  300,  // timmy_ws_server: heartbeat pode ser 60-90s → 5× margem
};

const PASSIVE_TYPES = new Set(['ip_local', 'heartbeat', 'adms_push', 'sdk_tcp', 'p2s', 'websocket_cloud']);
const ACTIVE_TYPES  = new Set(['ip_publico', 'dns', 'api']);

const HISTORY_THROTTLE_SECONDS = 3600;
const CHECK_TIMEOUT_MS = 5000;

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const isAuthenticated = await base44.auth.isAuthenticated();
        if (isAuthenticated) {
            const user = await base44.auth.me();
            if (user?.role !== 'admin') {
                return Response.json({ error: 'Forbidden: acesso apenas para administradores' }, { status: 403 });
            }
        }

        const terminals = await base44.asServiceRole.entities.Terminal.filter({ ativo: true });
        const agora = new Date();
        const results = [];

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
                    let timestampOffline = agora;

                    if (PASSIVE_TYPES.has(tipo)) {
                        // ── PASSIVO: verificar timeout do último ping ──────────────
                        const timeoutSec = PASSIVE_TIMEOUT[tipo] || 150;
                        if (terminal.ultimo_ping) {
                            const ultimoPing = new Date(terminal.ultimo_ping);
                            const segundosSemPing = Math.floor((agora - ultimoPing) / 1000);
                            novoStatus = segundosSemPing > timeoutSec ? 'offline' : 'online';
                            if (novoStatus === 'offline') {
                                timestampOffline = new Date(ultimoPing.getTime() + timeoutSec * 1000);
                            }
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                status: novoStatus,
                                segundos_sem_ping: segundosSemPing,
                                ultimo_check: agora.toISOString(),
                            });
                        } else {
                            novoStatus = 'offline';
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                status: 'offline',
                                ultimo_check: agora.toISOString(),
                            });
                        }
                    } else if (ACTIVE_TYPES.has(tipo)) {
                        // ── ATIVO: sondagem direta TCP/HTTP ───────────────────────
                        const checkResult = await checkTerminalActive(terminal);
                        novoStatus = checkResult.online ? 'online' : 'offline';
                        latencia_ms = checkResult.latencia_ms || null;
                        await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                            status: novoStatus,
                            latencia_ms,
                            ultimo_check: agora.toISOString(),
                            ...(checkResult.online ? { ultimo_ping: agora.toISOString() } : {}),
                        });
                    } else {
                        // Tipo desconhecido — ignorar
                        console.warn(`[monitorAllTerminals] tipo desconhecido: ${tipo} (terminal: ${terminal.nome})`);
                        return { terminal_id: terminal.id, terminal_nome: terminal.nome, tipo, success: true, status: terminal.status, statusMudou: false, skipped: true };
                    }

                    const statusMudou = statusAnterior !== novoStatus;

                    // Actualizar cache
                    if (cache) {
                        await base44.asServiceRole.entities.StatusCache.update(cache.id, {
                            ultimo_status: novoStatus,
                            atualizado_em: agora.toISOString(),
                        });
                    } else {
                        await base44.asServiceRole.entities.StatusCache.create({
                            terminal_id: terminal.id,
                            ultimo_status: novoStatus,
                            atualizado_em: agora.toISOString(),
                        });
                    }

                    // Criar incidente e EscalationAlert se transitou → offline
                    if (statusMudou && novoStatus === 'offline') {
                        await base44.asServiceRole.entities.AlertIncident.create({
                            terminal_id: terminal.id,
                            terminal_nome: terminal.nome,
                            local: terminal.local,
                            cliente: terminal.cliente_nome,
                            tipo: 'offline',
                            timestamp: timestampOffline.toISOString(),
                            resolvido: false,
                            notificado: false,
                        });

                        // Criar EscalationAlert para escalonamento automático após 24h
                        await base44.asServiceRole.entities.EscalationAlert.create({
                            terminal_id: terminal.id,
                            terminal_nome: terminal.nome,
                            local: terminal.local || '',
                            cliente: terminal.cliente_nome || '',
                            owner_email: terminal.created_by || '',
                            offline_desde: timestampOffline.toISOString(),
                            escalado: false,
                            resolvido: false,
                            notificacao_inicial_enviada: false,
                        }).catch(() => {});

                        await base44.asServiceRole.functions.invoke('pushNotify', {
                            action: 'notify_offline',
                            terminal_id: terminal.id,
                            terminal_nome: terminal.nome,
                            local: terminal.local || '',
                            cliente: terminal.cliente_nome || '',
                            owner_email: terminal.created_by || '',
                        }).catch(() => {});

                        // Notificação Telegram
                        const users = await base44.asServiceRole.entities.User.list().catch(() => []);
                        const targets = users.filter(u => u.role === 'admin' || u.email === terminal.created_by);
                        for (const u of targets) {
                            if (u.telegram_bot_token && u.telegram_chat_id) {
                                const msg = `🔴 <b>Terminal Offline</b>\n\n` +
                                    `📟 <b>${terminal.nome}</b>\n` +
                                    `📍 Local: ${terminal.local || '—'}\n` +
                                    `🏢 Cliente: ${terminal.cliente_nome || '—'}\n` +
                                    `🕐 ${agora.toLocaleString('pt-PT', { timeZone: 'UTC' })} UTC`;
                                await base44.asServiceRole.functions.invoke('telegramNotify', {
                                    bot_token: u.telegram_bot_token,
                                    chat_id: u.telegram_chat_id,
                                    message: msg,
                                }).catch(() => {});
                            }
                        }
                    }

                    // Resolver incidentes e escalações se voltou online
                    if (statusMudou && novoStatus === 'online') {
                        const [openIncidents, openEscalations] = await Promise.all([
                            base44.asServiceRole.entities.AlertIncident.filter({ terminal_id: terminal.id, resolvido: false }).catch(() => []),
                            base44.asServiceRole.entities.EscalationAlert.filter({ terminal_id: terminal.id, resolvido: false }).catch(() => []),
                        ]);
                        for (const inc of openIncidents) {
                            const duracao = Math.round((agora - new Date(inc.timestamp)) / 60000);
                            await base44.asServiceRole.entities.AlertIncident.update(inc.id, {
                                resolvido: true, resolvido_em: agora.toISOString(), duracao_minutos: duracao,
                            }).catch(() => {});
                        }
                        for (const esc of openEscalations) {
                            await base44.asServiceRole.entities.EscalationAlert.update(esc.id, { resolvido: true }).catch(() => {});
                        }
                        // Incidente "restored"
                        await base44.asServiceRole.entities.AlertIncident.create({
                            terminal_id: terminal.id,
                            terminal_nome: terminal.nome,
                            local: terminal.local || '',
                            cliente: terminal.cliente_nome || '',
                            tipo: 'restored',
                            timestamp: agora.toISOString(),
                            resolvido: true,
                            notificado: false,
                        }).catch(() => {});
                    }

                    // THROTTLE histórico
                    const ultimoCheck = terminal.ultimo_check ? new Date(terminal.ultimo_check) : null;
                    const segundosDesdeUltimoCheck = ultimoCheck
                        ? Math.floor((agora - ultimoCheck) / 1000)
                        : HISTORY_THROTTLE_SECONDS + 1;

                    if (statusMudou || segundosDesdeUltimoCheck >= HISTORY_THROTTLE_SECONDS) {
                        const tsHistorico = (statusMudou && novoStatus === 'offline') ? timestampOffline : agora;
                        await base44.asServiceRole.entities.StatusHistory.create({
                            terminal_id: terminal.id,
                            terminal_nome: terminal.nome,
                            status: novoStatus,
                            timestamp: tsHistorico.toISOString(),
                            local: terminal.local || '',
                            cliente: terminal.cliente_nome || '',
                        }).catch(() => {});
                    }

                    return { terminal_id: terminal.id, terminal_nome: terminal.nome, tipo, success: true, status: novoStatus, statusMudou };
                } catch (error) {
                    return { terminal_id: terminal.id, terminal_nome: terminal.nome, success: false, error: error.message };
                }
            }));
            results.push(...chunkResults);
        }

        return Response.json({
            success: true,
            total: terminals.length,
            monitored: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            statusChanged: results.filter(r => r.statusMudou).length,
            results,
        });

    } catch (error) {
        console.error('Erro monitorAllTerminals:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});

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
            } catch {
                clearTimeout(timer);
                return { online: false };
            }
        }

        // ip_publico ou dns → TCP primeiro, fallback HTTP
        const host = terminal.tipo_conexao === 'ip_publico' ? terminal.ip_publico :
                     terminal.tipo_conexao === 'dns' ? terminal.dns : null;

        if (!host) return { online: false };

        // TCP
        try {
            const conn = await Promise.race([
                Deno.connect({ hostname: host, port: Number(porta) }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('tcp_timeout')), CHECK_TIMEOUT_MS))
            ]);
            conn.close();
            return { online: true, latencia_ms: Date.now() - inicio };
        } catch {}

        // Fallback HTTP
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
            await fetch(`http://${host}:${porta}`, { signal: controller.signal });
            clearTimeout(timer);
            return { online: true, latencia_ms: Date.now() - inicio };
        } catch {
            return { online: false };
        }
    } catch {
        return { online: false };
    }
}