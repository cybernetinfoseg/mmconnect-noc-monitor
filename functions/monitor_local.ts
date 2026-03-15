// REMOVIDO: Este ficheiro foi substituído pelo agente Python disponível em Configurações.
// O agente usa os endpoints agentGetTerminals (GET) e agentReport (POST)
// com os headers X-Api-Key e X-App-Id obrigatórios.
Deno.serve(() => new Response(JSON.stringify({ error: 'Endpoint removido. Use agentGetTerminals e agentReport.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
}));