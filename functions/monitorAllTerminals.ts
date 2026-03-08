import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// Tempo máximo (em segundos) sem receber ping do agente antes de marcar Offline
const AGENT_TIMEOUT_SECONDS = 180; // 3 minutos

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Se há utilizador autenticado, tem de ser admin
        const isAuthenticated = await base44.auth.isAuthenticated();
        if (isAuthenticated) {
            const user = await base44.auth.me();
            if (user?.role !== 'admin') {
                return Response.json({ error: 'Forbidden: acesso apenas para administradores' }, { status: 403 });
            }
        }
        // Se não há utilizador (chamada do scheduler), continua com service role

        // Buscar todos os terminais ativos
        const terminals = await base44.asServiceRole.entities.Terminal.filter({ ativo: true });

        const results = [];

        // Monitorar cada terminal em paralelo (máx 10 simultâneos)
        const agora = new Date();

        const chunkSize = 10;
        for (let i = 0; i < terminals.length; i += chunkSize) {
            const chunk = terminals.slice(i, i + chunkSize);
            const chunkResults = await Promise.all(chunk.map(async (terminal) => {
                try {
                    let status = terminal.status || 'offline';

                    // Para terminais que usam API externa, fazer verificação activa
                    if (terminal.tipo_conexao === 'api' && terminal.api_endpoint) {
                        const monitorResult = await base44.asServiceRole.functions.invoke('monitorTerminal', {
                            terminalId: terminal.id
                        });
                        status = monitorResult.data?.status || 'offline';
                    } else {
                        // Para todos os outros tipos (ip_local, ip_publico, dns, p2s):
                        // O status depende EXCLUSIVAMENTE do agente local.
                        // Se o agente não reportou há mais de AGENT_TIMEOUT_SECONDS → Offline.
                        if (terminal.ultimo_ping) {
                            const segundosSemPing = Math.floor((agora - new Date(terminal.ultimo_ping)) / 1000);
                            if (segundosSemPing > AGENT_TIMEOUT_SECONDS) {
                                status = 'offline';
                                // Atualizar o terminal com o tempo real sem ping
                                await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                    status: 'offline',
                                    segundos_sem_ping: segundosSemPing,
                                    ultimo_check: agora.toISOString(),
                                });

                                // Verificar mudança de status no cache
                                const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id: terminal.id });
                                const cache = cacheResults.length > 0 ? cacheResults[0] : null;
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
                                // Agente está ativo, manter status conforme último reporte
                                status = terminal.status || 'online';
                            }
                        } else {
                            // Nunca recebeu ping → offline
                            status = 'offline';
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                status: 'offline',
                                ultimo_check: agora.toISOString(),
                            });
                        }
                    }

                    // Resolver escalações se online
                    if (status === 'online') {
                        const openAlerts = await base44.asServiceRole.entities.EscalationAlert.filter({
                            terminal_id: terminal.id,
                            resolvido: false,
                        }).catch(() => []);
                        for (const alert of openAlerts) {
                            await base44.asServiceRole.entities.EscalationAlert.update(alert.id, { resolvido: true }).catch(() => {});
                        }
                    }

                    return {
                        terminal_id: terminal.id,
                        terminal_nome: terminal.nome,
                        success: true,
                        status,
                    };
                } catch (error) {
                    return {
                        terminal_id: terminal.id,
                        terminal_nome: terminal.nome,
                        success: false,
                        error: error.message
                    };
                }
            }));
            results.push(...chunkResults);
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        return Response.json({
            success: true,
            total: terminals.length,
            monitored: successCount,
            failed: failCount,
            results
        });

    } catch (error) {
        console.error('Erro ao monitorar terminais:', error);
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});