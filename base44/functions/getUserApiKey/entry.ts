import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

// Retorna a api_key do utilizador autenticado
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // api_key pode estar em data.api_key (campo personalizado) ou no nível raiz
        const api_key = user?.api_key || user?.data?.api_key || null;
        return Response.json({ api_key });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});