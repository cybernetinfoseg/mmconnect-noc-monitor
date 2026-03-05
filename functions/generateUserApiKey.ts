import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { targetUserId, customKey } = await req.json();

        if (targetUserId && targetUserId !== user.id && user.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const userId = targetUserId || user.id;

        // Fetch target user info for audit
        const targetUser = await base44.asServiceRole.entities.User.get(userId);

        // Use custom key if provided, otherwise generate a secure random API key
        let apiKey;
        if (customKey && customKey.trim()) {
            apiKey = customKey.trim();
        } else {
            const array = new Uint8Array(32);
            crypto.getRandomValues(array);
            apiKey = 'noc_' + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
        }

        await base44.asServiceRole.entities.User.update(userId, { api_key: apiKey });

        // Audit log
        await base44.asServiceRole.entities.AuditLog.create({
            usuario_email: user.email,
            acao: 'api_key_gerada',
            entidade: 'User',
            entidade_id: userId,
            descricao: `API Key gerada para ${targetUser?.email || userId}`,
            timestamp: new Date().toISOString(),
        });

        return Response.json({ success: true, api_key: apiKey });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});