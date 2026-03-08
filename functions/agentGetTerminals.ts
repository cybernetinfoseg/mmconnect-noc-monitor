/**
 * agentGetTerminals — devolve os terminais do utilizador ao Agente Local
 *
 * Headers obrigatórios:
 *   X-Api-Key: <api_key do utilizador>
 *   X-App-Id:  <app_id>
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const APP_ID = Deno.env.get('BASE44_APP_ID') || '697aa46c9998c30665e2e19a';

Deno.serve(async (req) => {
    try {
        const appIdHeader = req.headers.get('X-App-Id');
        if (!appIdHeader || appIdHeader !== APP_ID) {
            return Response.json({ error: 'APP ID inválido ou ausente' }, { status: 403 });
        }

        const apiKey = req.headers.get('X-Api-Key');
        if (!apiKey || !apiKey.startsWith('noc_')) {
            return Response.json({ error: 'API Key inválida ou ausente' }, { status: 401 });
        }

        const base44 = createClientFromRequest(req);

        const allUsers = await base44.asServiceRole.entities.User.filter({ api_key: apiKey });
        if (!allUsers || allUsers.length === 0) {
            return Response.json({ error: 'API Key não reconhecida' }, { status: 401 });
        }
        const owner = allUsers[0];

        // Admins veem todos, utilizadores normais só os seus
        let terminals;
        if (owner.role === 'admin') {
            terminals = await base44.asServiceRole.entities.Terminal.filter({ ativo: true });
        } else {
            terminals = await base44.asServiceRole.entities.Terminal.filter({ ativo: true, created_by: owner.email });
        }

        // Devolver apenas os campos necessários ao agente
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

        return Response.json({ success: true, terminals: result });

    } catch (error) {
        console.error('agentGetTerminals erro:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});