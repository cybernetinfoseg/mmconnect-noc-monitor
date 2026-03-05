import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// Esta função pode ser chamada tanto pelo scheduler (sem user) quanto por admins logados
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Se há usuário logado, verificar se é admin
        const isAuthenticated = await base44.auth.isAuthenticated();
        if (isAuthenticated) {
            const user = await base44.auth.me();
            if (user?.role !== 'admin') {
                return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
            }
        }
        // Se não há usuário (chamada do scheduler), continua com service role

        // Buscar todos os terminais ativos
        // Terminais IP Local e P2S são geridos pelo Agente Local - não monitorizar pelo cloud
        const allTerminals = await base44.asServiceRole.entities.Terminal.filter({ ativo: true });
        const agentTerminals = allTerminals.filter(t => t.tipo_conexao === 'ip_local' || t.tipo_conexao === 'p2s');
        const terminals = allTerminals.filter(t => t.tipo_conexao !== 'ip_local' && t.tipo_conexao !== 'p2s');

        const results = [];

        // Monitorar cada terminal em paralelo (máx 10 simultâneos)
        const chunkSize = 10;
        for (let i = 0; i < terminals.length; i += chunkSize) {
            const chunk = terminals.slice(i, i + chunkSize);
            const chunkResults = await Promise.all(chunk.map(async (terminal) => {
                try {
                    const monitorResult = await base44.asServiceRole.functions.invoke('monitorTerminal', {
                        terminalId: terminal.id
                    });
                    const status = monitorResult.data?.status;

                    // If terminal went offline, trigger push notification
                    if (status === 'offline') {
                        await base44.asServiceRole.functions.invoke('pushNotify', {
                            action: 'notify_offline',
                            terminal_id: terminal.id,
                            terminal_nome: terminal.nome,
                            local: terminal.local || '',
                            cliente: terminal.cliente_nome || terminal.cliente || '',
                            owner_email: terminal.created_by || '',
                        }).catch(() => {});
                    } else if (status === 'online') {
                        // Mark any open escalation alerts as resolved
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
            total: allTerminals.length,
            monitored: successCount,
            failed: failCount,
            agent_managed: agentTerminals.length,
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