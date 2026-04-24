/**
 * nocServerGetTerminals — retorna terminais para o NOC Server Windows
 * Tipos suportados: heartbeat, adms_push, sdk_tcp
 * Autenticação: X-Api-Key pessoal
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const apiKey = (req.headers.get('X-Api-Key') || req.headers.get('x-api-key') || '').trim();

        if (!apiKey || apiKey.length < 16) {
            return Response.json({ error: 'API Key ausente ou inválida' }, { status: 401 });
        }

        const base44 = createClientFromRequest(req);
        const allKeys = await base44.asServiceRole.entities.ApiKey.filter({ ativo: true });
        const match = allKeys.find(k => k.key === apiKey);

        if (!match) {
            return Response.json({ error: 'API Key inválida' }, { status: 401 });
        }

        const ownerEmail = match.user_email;

        // is_admin está guardado diretamente na ApiKey — sem necessidade de consultar User
        const isAdmin = match.is_admin === true;

        // Admin → todos os terminais; utilizador normal → apenas os seus
        let allTerminals;
        if (isAdmin) {
            allTerminals = await base44.asServiceRole.entities.Terminal.filter({ ativo: true });
        } else {
            const [byCreator, byEmail] = await Promise.all([
                base44.asServiceRole.entities.Terminal.filter({ ativo: true, created_by: ownerEmail }),
                base44.asServiceRole.entities.Terminal.filter({ ativo: true, usuario_email: ownerEmail }),
            ]);
            const seen = new Set();
            allTerminals = [...byCreator, ...byEmail].filter(t => {
                if (seen.has(t.id)) return false;
                seen.add(t.id);
                return true;
            });
        }

        const supported = ['heartbeat', 'adms_push', 'sdk_tcp', 'websocket_cloud'];
        const terminals = allTerminals.filter(t => supported.includes(t.tipo_conexao));

        const result = terminals.map(t => ({
            id: t.id,
            nome: t.nome,
            local: t.local,
            tipo_conexao: t.tipo_conexao,
            ip_publico: t.ip_publico,
            ip_local: t.ip_local,
            dns: t.dns,
            porta: t.porta || 5005,
            numero_serie: t.numero_serie || '',
            fabricante: t.fabricante || 'zkteco',
            ativo: t.ativo,
        }));

        console.log(`nocServerGetTerminals OK: ${ownerEmail} → ${result.length} terminais (${terminals.map(t=>t.tipo_conexao).join(', ')})`);
        return Response.json({ success: true, terminals: result, owner: ownerEmail });

    } catch (error) {
        console.error('nocServerGetTerminals erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});