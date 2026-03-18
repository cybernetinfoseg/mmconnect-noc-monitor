/**
 * monitorAllTerminals — verifica o status de todos os terminais ativos.
 *
 * Lógica por tipo de conexão:
 *   - ip_local  → depende EXCLUSIVAMENTE do Agente Local (heartbeat via agentReport).
 *                 Se o agente não reportou há mais de AGENT_TIMEOUT_SECONDS → Offline.
 *   - ip_publico, dns, api → monitoramento ativo via HTTP/TCP (independente do agente).
 *
 * THROTTLE do histórico: só grava StatusHistory quando:
 *   - há mudança de status, OU
 *   - passou mais de 1 hora desde o último registo
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const AGENT_TIMEOUT_SECONDS = 150; // 2.5x o intervalo do agente (30s)
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
                    const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id: terminal.id });
                    const cache = cacheResults[0] || null;
                    const statusAnterior = cache?.ultimo_status || null;
                    let novoStatus;
                    let latencia_ms = null;

                    if (terminal.tipo_conexao === 'ip_local') {
                        // ── Lógica AGENTE LOCAL ──────────────────────────────
                        if (terminal.ultimo_ping) {
                            const segundosSemPing = Math.floor((agora - new Date(terminal.ultimo_ping)) / 1000);
                            novoStatus = segundosSemPing > AGENT_TIMEOUT_SECONDS ? 'offline' : (terminal.status || 'online');
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                status: novoStatus,
                                segundos_sem_ping: segundosSemPing,
                                ultimo_check: agora.toISOString(),
                            });
                        } else {
                            // Nunca recebeu ping
                            novoStatus = 'offline';
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                status: 'offline',
                                ultimo_check: agora.toISOString(),
                            });
                        }
                    } else {
                        // ── Lógica MONITORAMENTO ACTIVO ──────────────────────
                        const checkResult = await checkTerminalActive(terminal);
                        novoStatus = checkResult.online ? 'online' : 'offline';
                        latencia_ms = checkResult.latencia_ms || null;
                        await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                            status: novoStatus,
                            latencia_ms,
                            ultimo_check: agora.toISOString(),
                            ...(checkResult.online ? { ultimo_ping: agora.toISOString() } : {}),
                        });
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

                    // Criar incidente se transitou → offline
                    if (statusMudou && novoStatus === 'offline') {
                        await base44.asServiceRole.entities.AlertIncident.create({
                            terminal_id: terminal.id,
                            terminal_nome: terminal.nome,
                            local: terminal.local,
                            cliente: terminal.cliente_nome,
                            tipo: 'offline',
                            timestamp: agora.toISOString(),
                            resolvido: false,
                            notificado: false,
                        });

                        await base44.asServiceRole.functions.invoke('pushNotify', {
                            action: 'notify_offline',
                            terminal_id: terminal.id,
                            terminal_nome: terminal.nome,
                            local: terminal.local || '',
                            cliente: terminal.cliente_nome || '',
                            owner_email: terminal.created_by || '',
                        }).catch(() => {});

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

                    // Resolver escalações se voltou online
                    if (novoStatus === 'online') {
                        const openAlerts = await base44.asServiceRole.entities.EscalationAlert.filter({
                            terminal_id: terminal.id,
                            resolvido: false,
                        }).catch(() => []);
                        for (const alert of openAlerts) {
                            await base44.asServiceRole.entities.EscalationAlert.update(alert.id, { resolvido: true }).catch(() => {});
                        }
                    }

                    // THROTTLE histórico
                    const ultimoHistorico = terminal.ultimo_check ? new Date(terminal.ultimo_check) : null;
                    const segundosDesdeUltimoCheck = ultimoHistorico
                        ? Math.floor((agora - ultimoHistorico) / 1000)
                        : HISTORY_THROTTLE_SECONDS + 1;

                    if (statusMudou || segundosDesdeUltimoCheck >= HISTORY_THROTTLE_SECONDS) {
                        await base44.asServiceRole.entities.StatusHistory.create({
                            terminal_id: terminal.id,
                            terminal_nome: terminal.nome,
                            status: novoStatus === 'warning' ? 'online' : (novoStatus || 'offline'),
                            timestamp: agora.toISOString(),
                            local: terminal.local || '',
                            cliente: terminal.cliente_nome || '',
                        }).catch(() => {});
                    }

                    return { terminal_id: terminal.id, terminal_nome: terminal.nome, tipo: terminal.tipo_conexao, success: true, status: novoStatus, statusMudou };
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

        const host = terminal.tipo_conexao === 'ip_publico' ? terminal.ip_publico :
                     terminal.tipo_conexao === 'dns' ? terminal.dns : null;

        if (!host) return { online: false };

        // Tentar TCP primeiro
        try {
            const conn = await Promise.race([
                Deno.connect({ hostname: host, port: Number(porta) }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('tcp_timeout')), CHECK_TIMEOUT_MS))
            ]);
            conn.close();
            console.log(`[TCP OK] ${host}:${porta} latencia=${Date.now() - inicio}ms`);
            return { online: true, latencia_ms: Date.now() - inicio };
        } catch (tcpErr) {
            console.log(`[TCP FAIL] ${host}:${porta} → ${tcpErr.message}`);
        }

        // Fallback HTTP: qualquer resposta (mesmo erro HTTP) = servidor vivo
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
            const res = await fetch(`http://${host}:${porta}`, { signal: controller.signal });
            clearTimeout(timer);
            console.log(`[HTTP OK] ${host}:${porta} → status ${res.status}`);
            return { online: true, latencia_ms: Date.now() - inicio };
        } catch (httpErr) {
            console.log(`[HTTP FAIL] ${host}:${porta} → ${httpErr.message}`);
            return { online: false };
        }
    } catch {
        return { online: false };
    }
}