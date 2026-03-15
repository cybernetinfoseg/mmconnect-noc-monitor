// REMOVIDO: O monitoramento ativo por TCP/HTTP foi substituído pelo modelo de Agente Local.
// Todos os terminais reportam o seu estado via agentReport com X-Api-Key + X-App-Id.
Deno.serve(() => new Response(JSON.stringify({ error: 'Endpoint removido. Use o Agente Local (agentReport).' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
}));