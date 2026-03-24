/**
 * agentGetTerminals — devolve os terminais ao Agente Local
 * Autenticação: X-Api-Key no header (lida da entidade ApiKey)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
    try {
        // Aceitar key no header ou body — NUNCA em query string (segurança)
        let apiKey = (req.headers.get('X-Api-Key') || req.headers.get('x-api-key') || '').trim();

        if (!apiKey && req.method === 'POST') {
            try {
                const body = await req.json();
                apiKey = (body?.api_key || '').trim();
            } catch (_) {}
        }

        // Validar ANTES de qualquer operação — key vazia ou curta é rejeitada imediatamente
        if (!apiKey || apiKey.length < 16) {
            return Response.json({ error: 'API Key ausente ou inválida' }, { status: 401 });
        }

        const base44 = createClientFromRequest(req);

        // Procurar chave activa na entidade ApiKey
        const allKeys = await base44.asServiceRole.entities.ApiKey.filter({ ativo: true });
        const match = allKeys.find(k => k.key === apiKey);

        if (!match) {
            console.error('agentGetTerminals: API Key não encontrada');
            return Response.json({ error: 'API Key inválida' }, { status: 401 });
        }

        const ownerEmail = match.user_email;

        const terminals = await base44.asServiceRole.entities.Terminal.filter({
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