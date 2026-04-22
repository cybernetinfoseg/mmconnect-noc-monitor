import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { terminalId, data } = await req.json();

    if (terminalId) {
      // UPDATE — verify the user owns this terminal (created_by OR usuario_email)
      const terminal = await base44.asServiceRole.entities.Terminal.get(terminalId);
      if (!terminal) {
        return Response.json({ error: 'Terminal não encontrado' }, { status: 404 });
      }
      const isOwner = terminal.created_by === user.email || terminal.usuario_email === user.email;
      const isAdmin = user.role === 'admin';
      if (!isOwner && !isAdmin) {
        return Response.json({ error: 'Sem permissão para editar este terminal' }, { status: 403 });
      }
      const updated = await base44.asServiceRole.entities.Terminal.update(terminalId, data);
      return Response.json({ terminal: updated });
    } else {
      // CREATE — check terminal limit for non-admins
      const createData = { ...data };
      if (user.role !== 'admin') {
        createData.usuario_email = user.email;

        // Validate terminal limit
        const userEntity = await base44.asServiceRole.entities.User.filter({ email: user.email });
        const limite = userEntity[0]?.limite_terminais ?? 0;
        // limite === 0 significa sem permissão para adicionar terminais
        if (limite === 0) {
          return Response.json({ error: 'Sem permissão para adicionar terminais. Contacte o administrador.' }, { status: 403 });
        }
        // Count terminals owned by this user
        const [byCreator, byAssigned] = await Promise.all([
          base44.asServiceRole.entities.Terminal.filter({ created_by: user.email }),
          base44.asServiceRole.entities.Terminal.filter({ usuario_email: user.email }),
        ]);
        const ids = new Set([...byCreator, ...byAssigned].map(t => t.id));
        if (ids.size >= limite) {
          return Response.json({ error: `Limite de ${limite} terminais atingido` }, { status: 403 });
        }
      }
      const created = await base44.asServiceRole.entities.Terminal.create(createData);
      return Response.json({ terminal: created });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});