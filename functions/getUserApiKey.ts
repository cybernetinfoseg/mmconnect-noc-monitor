import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// Retorna a api_key do utilizador autenticado
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const fullUser = await base44.asServiceRole.entities.User.get(user.id);
        return Response.json({ api_key: fullUser?.api_key || null });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});