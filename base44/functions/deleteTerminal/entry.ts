import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { terminalId } = await req.json();

    if (!terminalId) {
      return Response.json({ error: 'terminalId obrigatório' }, { status: 400 });
    }

    // Verify ownership — only creator or admin can delete
    const terminal = await base44.asServiceRole.entities.Terminal.get(terminalId);
    if (!terminal) {
      return Response.json({ error: 'Terminal não encontrado' }, { status: 404 });
    }

    const isOwner = terminal.created_by === user.email;
    const isAdmin = user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return Response.json({ error: 'Sem permissão para eliminar este terminal' }, { status: 403 });
    }

    await base44.asServiceRole.entities.Terminal.delete(terminalId);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});