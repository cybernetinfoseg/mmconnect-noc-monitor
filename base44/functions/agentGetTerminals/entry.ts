/**
 * agentGetTerminals — devolve os terminais ao Agente Local
 *
 * SEGURANÇA: autenticação EXCLUSIVAMENTE por X-Api-Key pessoal.
 * Cada utilizador vê apenas os terminais que criou (created_by).
 * Admin vê todos.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
    try {
        // 1. Extrair API Key
        const apiKey = (req.headers.get('X-Api-Key') || req.headers.get('x-api-key') || '').trim();

        if (!apiKey || apiKey.length < 16) {
            return Response.json({ error: 'API Key ausente ou inválida' }, { status: 401 });
        }

        // 2. Validar key
        const base44 = createClientFromRequest(req);
        const allKeys = await base44.asServiceRole.entities.ApiKey.filter({ ativo: true });
        const match = allKeys.find(k => k.key === apiKey);

        if (!match) {
            return Response.json({ error: 'API Key inválida' }, { status: 401 });
        }

        const ownerEmail = match.user_email;

        // 3. Filtrar terminais pelo dono da API Key (sempre por created_by)
        // Cada utilizador, incluindo admin, vê apenas os seus próprios terminais via agente
        const terminals = await base44.asServiceRole.entities.Terminal.filter({
            ativo: true,
            tipo_conexao: 'ip_local',
            created_by: ownerEmail,
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
            ativo: t.ativo,
        }));

        console.log(`agentGetTerminals OK: ${ownerEmail} → ${result.length} terminais`);
        return Response.json({ success: true, terminals: result, owner: ownerEmail });

    } catch (error) {
        console.error('agentGetTerminals erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});