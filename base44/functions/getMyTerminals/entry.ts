import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Admin sees all terminals
    if (user.role === 'admin') {
      const terminals = await base44.asServiceRole.entities.Terminal.list('-created_date');
      return Response.json({ terminals });
    }

    // Regular users: fetch terminals by created_by OR usuario_email using service role (bypasses RLS)
    const [byCreator, byAssigned] = await Promise.all([
      base44.asServiceRole.entities.Terminal.filter({ created_by: user.email }, '-created_date'),
      base44.asServiceRole.entities.Terminal.filter({ usuario_email: user.email }, '-created_date'),
    ]);

    // Merge and deduplicate
    const map = new Map();
    [...byCreator, ...byAssigned].forEach(t => map.set(t.id, t));
    const terminals = [...map.values()].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

    return Response.json({ terminals });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});