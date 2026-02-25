import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        // Validar API Key do script Python local
        const apiKey = req.headers.get('X-Monitor-API-Key');
        const expectedKey = Deno.env.get('MONITOR_API_KEY');

        if (!apiKey || apiKey !== expectedKey) {
            return Response.json({ error: 'Unauthorized - Invalid API Key' }, { status: 401 });
        }

        const base44 = createClientFromRequest(req);

        // Buscar terminais com ip_local ativos
        const terminals = await base44.asServiceRole.entities.Terminal.filter({
            tipo_conexao: 'ip_local',
            ativo: true
        });

        return Response.json({ terminals });

    } catch (error) {
        console.error('Erro ao buscar terminais locais:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});