/**
 * agentGetTerminals — devolve os terminais ao Agente Local
 * Autenticação: apenas X-Api-Key pessoal (header obrigatório)
 * Retorna apenas os terminais do utilizador dono da API Key.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    try {
        const apiKey = req.headers.get('X-Api-Key');
        if (!apiKey || apiKey.length < 10) {
            return Response.json({ error: 'API Key ausente ou inválida' }, { status: 401 });
        }

        const base44 = createClientFromRequest(req);

        // Procurar utilizador com esta api_key (pode estar em data.api_key)
        let users = await base44.asServiceRole.entities.User.filter({ api_key: apiKey });
        if (!users || users.length === 0) {
            users = await base44.asServiceRole.entities.User.filter({ 'data.api_key': apiKey });
        }
        const owner = users.length > 0 ? users[0] : null;

        if (!owner) {
            return Response.json({ error: 'API Key inválida' }, { status: 401 });
        }

        // Devolver apenas terminais activos do dono da key
        const terminals = await base44.asServiceRole.entities.Terminal.filter({
            ativo: true,
            created_by: owner.email,
        });

        const result = terminals.map(t => ({
            id: t.id,
            nome: t.nome,
            local: t.local,
            tipo_conexao: t.tipo_conexao,
            ip_local: t.ip_local,
            ip_publico: t.ip_publico,
            dns: t.dns,
            porta: t.porta || 5005,
            api_endpoint: t.api_endpoint,
        }));

        return Response.json({ success: true, terminals: result, owner: owner.email });

    } catch (error) {
        console.error('agentGetTerminals erro:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});