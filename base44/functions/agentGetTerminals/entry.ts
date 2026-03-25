/**
 * agentGetTerminals — devolve os terminais ao Agente Local
 *
 * SEGURANÇA: autenticação EXCLUSIVAMENTE por X-Api-Key pessoal.
 * Não usa sessão da plataforma. Qualquer pedido sem key válida → 401.
 */
import { createClient } from 'npm:@base44/sdk@0.8.21';

// Client de serviço — sem contexto de utilizador/sessão
const serviceClient = createClient({
    appId: Deno.env.get('BASE44_APP_ID'),
    serviceRoleKey: true,
});

Deno.serve(async (req) => {
    try {
        // Aceitar key no header ou body — NUNCA em query string
        let apiKey = (req.headers.get('X-Api-Key') || req.headers.get('x-api-key') || '').trim();

        if (!apiKey && req.method === 'POST') {
            try {
                const body = await req.json();
                apiKey = (body?.api_key || '').trim();
            } catch (_) {}
        }

        // Rejeitar IMEDIATAMENTE antes de qualquer query
        if (!apiKey || apiKey.length < 16) {
            return Response.json({ error: 'API Key ausente ou inválida' }, { status: 401 });
        }

        // Procurar chave activa na entidade ApiKey
        const allKeys = await serviceClient.entities.ApiKey.filter({ ativo: true });
        const match = allKeys.find(k => k.key === apiKey);

        if (!match) {
            console.error('agentGetTerminals: API Key não encontrada');
            return Response.json({ error: 'API Key inválida' }, { status: 401 });
        }

        const ownerEmail = match.user_email;

        const terminals = await serviceClient.entities.Terminal.filter({
            ativo: true,
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

        console.log(`agentGetTerminals: ${ownerEmail} → ${result.length} terminais`);
        return Response.json({ success: true, terminals: result, owner: ownerEmail });

    } catch (error) {
        console.error('agentGetTerminals erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});