import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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
        const terminals = await base44.asServiceRole.entities.Terminal.filter({ ativo: true });

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
                    return {
                        terminal_id: terminal.id,
                        terminal_nome: terminal.nome,
                        success: true,
                        status: monitorResult.data?.status
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