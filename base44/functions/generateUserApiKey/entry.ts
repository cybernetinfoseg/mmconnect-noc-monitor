import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { targetUserId } = await req.json().catch(() => ({}));

        if (targetUserId && targetUserId !== user.id && user.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const userId = targetUserId || user.id;
        const userEmail = targetUserId
            ? (await base44.asServiceRole.entities.User.get(userId))?.email || userId
            : user.email;

        // Generate secure random API key
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        const apiKey = 'noc_' + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');

        // Upsert: desactivar chaves antigas e criar nova na entidade ApiKey
        const existing = await base44.asServiceRole.entities.ApiKey.filter({ user_id: userId });
        for (const k of existing) {
            await base44.asServiceRole.entities.ApiKey.update(k.id, { ativo: false });
        }
        // Determinar role do utilizador alvo
        const targetRole = targetUserId
            ? (await base44.asServiceRole.entities.User.get(userId))?.role || 'user'
            : user.role;

        await base44.asServiceRole.entities.ApiKey.create({
            user_email: userEmail,
            user_id: userId,
            key: apiKey,
            ativo: true,
            is_admin: targetRole === 'admin',
        });

        // Audit log
        await base44.asServiceRole.entities.AuditLog.create({
            usuario_email: user.email,
            acao: 'api_key_gerada',
            entidade: 'User',
            entidade_id: userId,
            descricao: `API Key gerada para ${userEmail}`,
            timestamp: new Date().toISOString(),
        });

        return Response.json({ success: true, api_key: apiKey });
    } catch (error) {
        console.error('generateUserApiKey erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});