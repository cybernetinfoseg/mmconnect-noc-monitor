import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    try {
        // Validate API key from header
        const apiKey = req.headers.get('api_key') || req.headers.get('x-agent-api-key');

        if (!apiKey) {
            return Response.json({ error: 'API Key ausente' }, { status: 401 });
        }

        const base44 = createClientFromRequest(req);

        // Validate API key — fetch all users and find matching api_key
        // (filter by nested field may not work reliably, so we search manually)
        const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 500);
        const agentUser = allUsers.find(u => u.api_key === apiKey);

        if (!agentUser) {
            return Response.json({ error: 'API Key inválida ou revogada' }, { status: 401 });
        }

        const method = req.method.toUpperCase();

        // GET — listar terminais do usuário (ip_local e p2s apenas)
        if (method === 'GET') {
            const terminais = await base44.asServiceRole.entities.Terminal.filter({
                created_by: agentUser.email,
                ativo: true
            });
            const agentTerminais = terminais.filter(t =>
                t.tipo_conexao === 'ip_local' || t.tipo_conexao === 'p2s'
            );
            return Response.json(agentTerminais);
        }

        // PUT — atualizar status de um terminal
        if (method === 'PUT') {
            const body = await req.json();
            const { terminal_id, status, latencia_ms, ultimo_check, ultimo_ping } = body;

            if (!terminal_id) {
                return Response.json({ error: 'terminal_id obrigatório' }, { status: 400 });
            }

            // Verify terminal belongs to this user
            const terminal = await base44.asServiceRole.entities.Terminal.get(terminal_id);
            if (!terminal) {
                return Response.json({ error: 'Terminal não encontrado' }, { status: 404 });
            }
            if (terminal.created_by !== agentUser.email) {
                return Response.json({ error: 'Sem permissão para este terminal' }, { status: 403 });
            }

            const agora = new Date().toISOString();
            const updateData = {
                status: status || 'offline',
                ultimo_check: ultimo_check || agora,
                latencia_ms: latencia_ms || null,
                segundos_sem_ping: status === 'online' ? 0 :
                    (terminal.ultimo_ping ? Math.floor((Date.now() - new Date(terminal.ultimo_ping)) / 1000) : 999999),
                ...(status === 'online' && { ultimo_ping: ultimo_ping || agora })
            };

            await base44.asServiceRole.entities.Terminal.update(terminal_id, updateData);

            // Update status cache and create incidents on transition
            const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id });
            const cache = cacheResults.length > 0 ? cacheResults[0] : null;
            const previousStatus = cache?.ultimo_status;

            if (previousStatus === 'online' && status === 'offline') {
                await base44.asServiceRole.entities.AlertIncident.create({
                    terminal_id,
                    terminal_nome: terminal.nome,
                    local: terminal.local,
                    cliente: terminal.cliente_nome,
                    tipo: 'offline',
                    timestamp: agora,
                    resolvido: false,
                    notificado: false
                });
            } else if (previousStatus === 'offline' && status === 'online') {
                await base44.asServiceRole.entities.AlertIncident.create({
                    terminal_id,
                    terminal_nome: terminal.nome,
                    local: terminal.local,
                    cliente: terminal.cliente_nome,
                    tipo: 'restored',
                    timestamp: agora,
                    resolvido: true,
                    notificado: false
                });
            }

            if (cache) {
                await base44.asServiceRole.entities.StatusCache.update(cache.id, {
                    ultimo_status: status,
                    atualizado_em: agora
                });
            } else {
                await base44.asServiceRole.entities.StatusCache.create({
                    terminal_id,
                    ultimo_status: status,
                    atualizado_em: agora
                });
            }

            await base44.asServiceRole.entities.StatusHistory.create({
                terminal_id,
                terminal_nome: terminal.nome,
                status,
                timestamp: agora,
                local: terminal.local,
                cliente: terminal.cliente_nome
            });

            return Response.json({ success: true });
        }

        return Response.json({ error: 'Método não suportado' }, { status: 405 });

    } catch (error) {
        console.error('agentSync error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});