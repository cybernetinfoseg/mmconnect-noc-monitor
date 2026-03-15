// REMOVIDO: A lógica de escalações foi consolidada em pushNotify (action: check_escalations).
// Use: base44.functions.invoke('pushNotify', { action: 'check_escalations' })
Deno.serve(() => new Response(JSON.stringify({ error: 'Endpoint removido. Use pushNotify com action: check_escalations.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
}));