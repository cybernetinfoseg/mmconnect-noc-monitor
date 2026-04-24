// p2sGetTerminals — Devolve lista de terminais P2S para o p2s_server.py
// Autenticado via X-Api-Key do utilizador

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Autenticação via API Key
    const apiKey = req.headers.get("X-Api-Key") || "";
    if (!apiKey || apiKey.length < 16) {
      return Response.json({ error: "API Key ausente ou inválida" }, { status: 401 });
    }

    const apiKeys = await base44.asServiceRole.entities.ApiKey.filter({ key: apiKey, ativo: true });
    if (!apiKeys || apiKeys.length === 0) {
      return Response.json({ error: "API Key não autorizada" }, { status: 401 });
    }

    const ownerEmail = apiKeys[0].user_email;
    if (!ownerEmail) {
      return Response.json({ error: "API Key sem utilizador associado" }, { status: 401 });
    }

    // is_admin está guardado diretamente na ApiKey — sem necessidade de consultar User
    const isAdmin = apiKeys[0].is_admin === true;

    // Admin → todos os terminais P2S; utilizador normal → apenas os seus
    const filterParams = isAdmin
      ? { tipo_conexao: "p2s", ativo: true }
      : { tipo_conexao: "p2s", ativo: true, created_by: ownerEmail };
    const terminais = await base44.asServiceRole.entities.Terminal.filter(filterParams);

    const result = terminais.map(t => ({
      id:            t.id,
      nome:          t.nome,
      local:         t.local || "",
      porta:         t.porta || 5100,
      fabricante:    t.fabricante || "zkteco",
      modelo:        t.modelo || "",
      numero_serie:  t.numero_serie || "",
      observacoes:   t.observacoes || "",
      status_atual:  t.status || "offline",
      tipo_conexao:  t.tipo_conexao,
    }));

    console.log(`[p2sGetTerminals] user=${ownerEmail} terminais=${result.length}`);

    return Response.json({ success: true, terminals: result, count: result.length });

  } catch (error) {
    console.error("[p2sGetTerminals] Erro:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});