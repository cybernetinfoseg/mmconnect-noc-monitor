/**
 * agentGetTerminals — devolve os terminais ao Agente Local
 *
 * SEGURANÇA: autenticação EXCLUSIVAMENTE por X-Api-Key pessoal.
 * Usa asServiceRole para queries — mas a key é validada antes de qualquer acesso.
 * Sem key válida → 401 imediato, sem dados expostos.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
    try {
        // 1. Extrair API Key — EXCLUSIVAMENTE pelo header X-Api-Key
        const apiKey = (req.headers.get('X-Api-Key') || req.headers.get('x-api-key') || '').trim();

        // 2. Rejeitar IMEDIATAMENTE — antes de qualquer inicialização de cliente ou query
        if (!apiKey || apiKey.length < 16) {
            return Response.json({ error: 'API Key ausente ou inválida' }, { status: 401 });
        }

        // 3. Usar asServiceRole exclusivamente — ignora qualquer sessão de utilizador
        const base44 = createClientFromRequest(req);
        const allKeys = await base44.asServiceRole.entities.ApiKey.filter({ ativo: true });
        const match = allKeys.find(k => k.key === apiKey);

        if (!match) {
            return Response.json({ error: 'API Key inválida' }, { status: 401 });
        }

        const ownerEmail = match.user_email;

        // 4. Retornar apenas os terminais do dono da key
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

        console.log(`agentGetTerminals OK: ${ownerEmail} → ${result.length} terminais`);
        return Response.json({ success: true, terminals: result, owner: ownerEmail });

    } catch (error) {
        console.error('agentGetTerminals erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});