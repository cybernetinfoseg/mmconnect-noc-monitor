/**
 * monitorAllTerminals — verifica o heartbeat de todos os terminais ativos.
 *
 * Lógica: O status de cada terminal depende EXCLUSIVAMENTE dos reports do Agente Local.
 * Se o agente não reportou há mais de AGENT_TIMEOUT_SECONDS → marca como Offline.
 * Chamado pelo scheduler a cada minuto.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const AGENT_TIMEOUT_SECONDS = 60;

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

                    if (terminal.ultimo_ping) {
                        const segundosSemPing = Math.floor((agora - new Date(terminal.ultimo_ping)) / 1000);

                        if (segundosSemPing > AGENT_TIMEOUT_SECONDS) {
                            // Agente silencioso → Offline
                            novoStatus = 'offline';
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                status: 'offline',
                                segundos_sem_ping: segundosSemPing,
                                ultimo_check: agora.toISOString(),
                            });

                            // Criar incidente se transitou de Online → Offline
                            const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id: terminal.id });
                            const cache = cacheResults[0] || null;
                            if (cache && cache.ultimo_status === 'online') {
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
                                await base44.asServiceRole.entities.StatusCache.update(cache.id, {
                                    ultimo_status: 'offline',
                                    atualizado_em: agora.toISOString(),
                                });
                            }
                        } else {
                            // Agente ativo → atualizar contador
                            novoStatus = terminal.status || 'online';
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                segundos_sem_ping: segundosSemPing,
                                ultimo_check: agora.toISOString(),
                            });
                        }
                    } else {
                        // Nunca recebeu ping do agente → Offline
                        novoStatus = 'offline';
                        await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                            status: 'offline',
                            ultimo_check: agora.toISOString(),
                        });
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

                    return { terminal_id: terminal.id, terminal_nome: terminal.nome, success: true, status: novoStatus };
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
            results,
        });

    } catch (error) {
        console.error('Erro monitorAllTerminals:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});