/**
 * monitorAllTerminals — verifica o heartbeat de todos os terminais ativos.
 *
 * Lógica: O status de cada terminal depende EXCLUSIVAMENTE dos reports do Agente Local.
 * Se o agente não reportou há mais de AGENT_TIMEOUT_SECONDS → marca como Offline.
 * Chamado pelo scheduler a cada 5 minutos.
 *
 * THROTTLE do histórico: só grava StatusHistory quando:
 *   - há mudança de status, OU
 *   - passou mais de 1 hora desde o último registo
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const AGENT_TIMEOUT_SECONDS = 150; // 2.5x o intervalo do agente (30s) — evita falsos alarmes
const HISTORY_THROTTLE_SECONDS = 3600; // só grava histórico a cada 1h se status não mudou

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Permite chamada do scheduler (sem auth) ou de admin autenticado
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

        // Processar em paralelo (máx 10 simultâneos)
        const chunkSize = 10;
        for (let i = 0; i < terminals.length; i += chunkSize) {
            const chunk = terminals.slice(i, i + chunkSize);
            const chunkResults = await Promise.all(chunk.map(async (terminal) => {
                try {
                    let novoStatus = terminal.status || 'offline';
                    let statusMudou = false;

                    // Buscar cache de status actual
                    const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id: terminal.id });
                    const cache = cacheResults[0] || null;
                    const statusAnterior = cache?.ultimo_status || null;

                    if (terminal.ultimo_ping) {
                        const segundosSemPing = Math.floor((agora - new Date(terminal.ultimo_ping)) / 1000);

                        if (segundosSemPing > AGENT_TIMEOUT_SECONDS) {
                            // Agente silencioso → Offline
                            novoStatus = 'offline';
                            statusMudou = statusAnterior !== 'offline';

                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                status: 'offline',
                                segundos_sem_ping: segundosSemPing,
                                ultimo_check: agora.toISOString(),
                            });

                            // Criar incidente APENAS se transitou online → offline
                            // (evitar duplicado com agentReport)
                            if (statusMudou) {
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

                                // Telegram: notificar utilizadores com bot configurado
                                const users = await base44.asServiceRole.entities.User.list().catch(() => []);
                                const admins = users.filter(u => u.role === 'admin' || u.email === terminal.created_by);
                                for (const u of admins) {
                                    if (u.telegram_bot_token && u.telegram_chat_id) {
                                        const msg = `🔴 <b>Terminal Offline</b>\n\n` +
                                            `📟 <b>${terminal.nome}</b>\n` +
                                            `📍 Local: ${terminal.local || '—'}\n` +
                                            `🏢 Cliente: ${terminal.cliente_nome || '—'}\n` +
                                            `🕐 ${agora.toLocaleString('pt-PT', { timeZone: 'UTC' })} UTC\n` +
                                            `⏱ Sem ping há ${Math.round(segundosSemPing / 60)} min`;
                                        await base44.asServiceRole.functions.invoke('telegramNotify', {
                                            bot_token: u.telegram_bot_token,
                                            chat_id: u.telegram_chat_id,
                                            message: msg,
                                        }).catch(() => {});
                                    }
                                }
                            }

                            // Actualizar cache
                            if (cache) {
                                await base44.asServiceRole.entities.StatusCache.update(cache.id, {
                                    ultimo_status: 'offline',
                                    atualizado_em: agora.toISOString(),
                                });
                            } else {
                                await base44.asServiceRole.entities.StatusCache.create({
                                    terminal_id: terminal.id,
                                    ultimo_status: 'offline',
                                    atualizado_em: agora.toISOString(),
                                });
                            }

                        } else {
                            // Agente ativo
                            novoStatus = terminal.status || 'online';
                            statusMudou = statusAnterior !== novoStatus;
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                segundos_sem_ping: segundosSemPing,
                                ultimo_check: agora.toISOString(),
                            });
                        }
                    } else {
                        // Nunca recebeu ping do agente → Offline
                        novoStatus = 'offline';
                        statusMudou = statusAnterior !== 'offline';
                        await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                            status: 'offline',
                            ultimo_check: agora.toISOString(),
                        });
                        if (!cache) {
                            await base44.asServiceRole.entities.StatusCache.create({
                                terminal_id: terminal.id,
                                ultimo_status: 'offline',
                                atualizado_em: agora.toISOString(),
                            });
                        }
                    }

                    // Resolver escalações abertas se terminal voltou Online
                    if (novoStatus === 'online') {
                        const openAlerts = await base44.asServiceRole.entities.EscalationAlert.filter({
                            terminal_id: terminal.id,
                            resolvido: false,
                        }).catch(() => []);
                        for (const alert of openAlerts) {
                            await base44.asServiceRole.entities.EscalationAlert.update(alert.id, { resolvido: true }).catch(() => {});
                        }
                    }

                    // THROTTLE: só grava histórico se status mudou OU passou >1h desde último registo
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

                    return { terminal_id: terminal.id, terminal_nome: terminal.nome, success: true, status: novoStatus, statusMudou };
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