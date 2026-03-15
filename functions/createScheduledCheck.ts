// REMOVIDO: Verificações agendadas por terminal foram removidas.
// O scheduler global (monitorAllTerminals) trata todos os terminais automaticamente.
Deno.serve(() => new Response(JSON.stringify({ error: 'Endpoint removido.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
}));