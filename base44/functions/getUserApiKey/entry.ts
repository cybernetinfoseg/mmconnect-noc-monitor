import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Retorna a api_key activa do utilizador autenticado (lida da entidade ApiKey)
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const keys = await base44.asServiceRole.entities.ApiKey.filter({ user_id: user.id, ativo: true });
        const activeKey = keys[0]?.key || null;

        return Response.json({ api_key: activeKey });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});