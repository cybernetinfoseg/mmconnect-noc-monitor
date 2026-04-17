import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Helper backend function to create audit log entries from the frontend
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { acao, entidade, entidade_id, descricao, dados_extras } = await req.json();

        await base44.asServiceRole.entities.AuditLog.create({
            usuario_email: user.email,
            acao,
            entidade: entidade || '',
            entidade_id: entidade_id || '',
            descricao: descricao || '',
            timestamp: new Date().toISOString(),
            dados_extras: dados_extras ? JSON.stringify(dados_extras) : '',
        });

        return Response.json({ success: true });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});