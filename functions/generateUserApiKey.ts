import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Only admin can generate for other users; users can regenerate their own
        const { targetUserId } = await req.json();

        if (targetUserId && targetUserId !== user.id && user.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const userId = targetUserId || user.id;

        // Generate a secure random API key
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        const apiKey = 'noc_' + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');

        await base44.asServiceRole.entities.User.update(userId, { api_key: apiKey });

        return Response.json({ success: true, api_key: apiKey });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});