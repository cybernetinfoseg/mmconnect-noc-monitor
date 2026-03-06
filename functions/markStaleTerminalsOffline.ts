import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// Marks agent-managed terminals (ip_local / p2s) as offline
// if they haven't received a ping in more than 2 minutes.
// This runs on a schedule to handle agents that go silent without sending an offline update.

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Allow admin users or internal scheduled calls (no user token)
        let isAuthorized = false;
        try {
            const user = await base44.auth.me();
            if (user && user.role === 'admin') isAuthorized = true;
        } catch (_) {
            // No user token — allow if called internally by scheduler
            isAuthorized = true;
        }

        if (!isAuthorized) {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const agora = Date.now();
        const TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes without ping = offline

        // Get all active agent-managed terminals
        const allTerminals = await base44.asServiceRole.entities.Terminal.list('-updated_date', 500);
        const agentTerminals = allTerminals.filter(t =>
            t.ativo &&
            (t.tipo_conexao === 'ip_local' || t.tipo_conexao === 'p2s')
        );

        let markedOffline = 0;

        for (const terminal of agentTerminals) {
            // Skip already-offline terminals
            if (terminal.status === 'offline') continue;

            const lastPing = terminal.ultimo_ping ? new Date(terminal.ultimo_ping).getTime() :
                             terminal.ultimo_check ? new Date(terminal.ultimo_check).getTime() : 0;

            const secondsAgo = Math.floor((agora - lastPing) / 1000);

            if (secondsAgo > TIMEOUT_MS / 1000) {
                const agoraISO = new Date().toISOString();

                // Mark as offline
                await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                    status: 'offline',
                    segundos_sem_ping: secondsAgo,
                    ultimo_check: agoraISO
                });

                // Create incident if was online
                const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id: terminal.id });
                const cache = cacheResults.length > 0 ? cacheResults[0] : null;
                const previousStatus = cache?.ultimo_status;

                if (previousStatus === 'online' || !previousStatus) {
                    await base44.asServiceRole.entities.AlertIncident.create({
                        terminal_id: terminal.id,
                        terminal_nome: terminal.nome,
                        local: terminal.local,
                        cliente: terminal.cliente_nome,
                        tipo: 'offline',
                        timestamp: agoraISO,
                        resolvido: false,
                        notificado: false
                    });
                }

                // Update status cache
                if (cache) {
                    await base44.asServiceRole.entities.StatusCache.update(cache.id, {
                        ultimo_status: 'offline',
                        atualizado_em: agoraISO
                    });
                } else {
                    await base44.asServiceRole.entities.StatusCache.create({
                        terminal_id: terminal.id,
                        ultimo_status: 'offline',
                        atualizado_em: agoraISO
                    });
                }

                await base44.asServiceRole.entities.StatusHistory.create({
                    terminal_id: terminal.id,
                    terminal_nome: terminal.nome,
                    status: 'offline',
                    timestamp: agoraISO,
                    local: terminal.local,
                    cliente: terminal.cliente_nome
                });

                markedOffline++;
                console.log(`Terminal ${terminal.nome} marcado offline (${secondsAgo}s sem ping)`);
            }
        }

        return Response.json({
            success: true,
            checked: agentTerminals.length,
            markedOffline
        });

    } catch (error) {
        console.error('markStaleTerminalsOffline error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});