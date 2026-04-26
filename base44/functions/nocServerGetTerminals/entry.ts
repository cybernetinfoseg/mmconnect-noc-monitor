/**
 * nocServerGetTerminals — retorna terminais para o NOC Server Windows
 * Tipos suportados: heartbeat, adms_push, sdk_tcp, websocket_cloud
 * Autenticação: X-Api-Key pessoal (no header)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const apiKey = (req.headers.get('X-Api-Key') || req.headers.get('x-api-key') || '').trim();

        if (!apiKey || apiKey.length < 16) {
            return Response.json({ error: 'API Key ausente ou inválida' }, { status: 401 });
        }

        // Usar asServiceRole para validar a key — não depende de sessão do utilizador
        const base44 = createClientFromRequest(req);
        const allKeys = await base44.asServiceRole.entities.ApiKey.filter({ ativo: true });
        const match = allKeys.find(k => k.key === apiKey);

        if (!match) {
            console.error(`nocServerGetTerminals: API Key não encontrada (key=${apiKey.substring(0,8)}...)`);
            return Response.json({ error: 'API Key inválida' }, { status: 401 });
        }

        const ownerEmail = match.user_email;
        console.log(`nocServerGetTerminals: autenticado como ${ownerEmail}`);

        // Verificar se o utilizador é admin
        const allUsers = await base44.asServiceRole.entities.User.filter({ email: ownerEmail });
        const ownerUser = allUsers[0];
        const isAdmin = ownerUser?.role === 'admin';

        let allTerminals = [];

        if (isAdmin) {
            // Admin vê TODOS os terminais ativos de todos os utilizadores
            allTerminals = await base44.asServiceRole.entities.Terminal.filter({ ativo: true });
            console.log(`nocServerGetTerminals: ADMIN ${ownerEmail} → todos os terminais (${allTerminals.length})`);
        } else {
            // Utilizador normal vê apenas os seus terminais
            const [byUsuario, byCreated] = await Promise.all([
                base44.asServiceRole.entities.Terminal.filter({ ativo: true, usuario_email: ownerEmail }),
                base44.asServiceRole.entities.Terminal.filter({ ativo: true, created_by: ownerEmail }),
            ]);
            const seen = new Set();
            allTerminals = [...byUsuario, ...byCreated].filter(t => {
                if (seen.has(t.id)) return false;
                seen.add(t.id);
                return true;
            });
        }

        console.log(`nocServerGetTerminals: ${ownerEmail} tem ${allTerminals.length} terminais ativos total`);

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

        console.log(`nocServerGetTerminals OK: ${ownerEmail} → ${result.length} terminais (${terminals.map(t => t.tipo_conexao).join(', ')})`);
        return Response.json({ success: true, terminals: result, owner: ownerEmail });

    } catch (error) {
        console.error('nocServerGetTerminals erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});