// REMOVIDO: A sincronização por API externa foi substituída pelo modelo de Agente Local.
// Os terminais são geridos manualmente no painel e monitorizados via agentReport.
Deno.serve(() => new Response(JSON.stringify({ error: 'Endpoint removido.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
}));