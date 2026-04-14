// p2sReport — Recebe status de terminais P2S do p2s_server.py
// Integrado com sistema de alertas, incidentes e histórico do NOC Monitor

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

    const body = await req.json();
    const { terminal_id, status, addr, conn_count } = body;

    if (!terminal_id || !status) {
      return Response.json({ error: "terminal_id e status são obrigatórios" }, { status: 400 });
    }
    if (!["online", "offline"].includes(status)) {
      return Response.json({ error: "status deve ser 'online' ou 'offline'" }, { status: 400 });
    }

    // Verificar se o terminal pertence ao utilizador
    const terminais = await base44.asServiceRole.entities.Terminal.filter({ id: terminal_id });
    if (!terminais || terminais.length === 0) {
      return Response.json({ error: "Terminal não encontrado" }, { status: 404 });
    }

    const terminal = terminais[0];
    if (terminal.created_by !== ownerEmail) {
      return Response.json({ error: "Sem permissão para este terminal" }, { status: 403 });
    }

    const agora = new Date().toISOString();
    const statusAnterior = terminal.status;

    // Verificar janela de manutenção activa
    const manutencoes = await base44.asServiceRole.entities.MaintenanceWindow.filter({
      terminal_id: terminal_id,
      ativo: true,
    });
    const emManutencao = manutencoes.some(m => {
      const inicio = new Date(m.inicio).getTime();
      const fim    = new Date(m.fim).getTime();
      const agora_ = Date.now();
      return agora_ >= inicio && agora_ <= fim;
    });

    if (emManutencao && status === "offline") {
      console.log(`[p2sReport] Terminal '${terminal.nome}' em manutenção — ignorado`);
      return Response.json({ success: true, ignored: "em_manutencao" });
    }

    // Actualizar terminal
    const updateData = {
      status:           status,
      ultimo_check:     agora,
      ultimo_ping:      status === "online" ? agora : terminal.ultimo_ping,
      segundos_sem_ping: status === "online" ? 0 : (terminal.segundos_sem_ping || 0),
    };

    if (addr) updateData.observacoes_p2s = `Última conexão de: ${addr} | Total conexões: ${conn_count || 0}`;

    await base44.asServiceRole.entities.Terminal.update(terminal_id, updateData);

    // Detectar mudança de estado
    const mudouDeEstado = statusAnterior !== status;

    if (mudouDeEstado) {
      console.log(`[p2sReport] '${terminal.nome}' mudou: ${statusAnterior} → ${status}`);

      // Registar no histórico
      await base44.asServiceRole.entities.StatusHistory.create({
        terminal_id:    terminal_id,
        terminal_nome:  terminal.nome,
        status:         status,
        timestamp:      agora,
        local:          terminal.local || "",
        cliente:        terminal.cliente_nome || "",
      });

      // Actualizar StatusCache
      const caches = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id });
      if (caches.length > 0) {
        await base44.asServiceRole.entities.StatusCache.update(caches[0].id, {
          ultimo_status: status,
          atualizado_em: agora,
        });
      } else {
        await base44.asServiceRole.entities.StatusCache.create({
          terminal_id,
          ultimo_status: status,
          atualizado_em: agora,
        });
      }

      // Criar / resolver incidente
      if (status === "offline") {
        // Criar novo incidente
        await base44.asServiceRole.entities.AlertIncident.create({
          terminal_id:   terminal_id,
          terminal_nome: terminal.nome,
          local:         terminal.local || "",
          cliente:       terminal.cliente_nome || "",
          tipo:          "offline",
          timestamp:     agora,
          resolvido:     false,
          notificado:    false,
        });

        // Criar EscalationAlert para notificações push
        await base44.asServiceRole.entities.EscalationAlert.create({
          terminal_id:   terminal_id,
          terminal_nome: terminal.nome,
          local:         terminal.local || "",
          cliente:       terminal.cliente_nome || "",
          owner_email:   ownerEmail,
          offline_desde: agora,
          escalado:      false,
          resolvido:     false,
          notificacao_inicial_enviada: false,
        });

      } else if (status === "online") {
        // Resolver incidentes abertos
        const incidentes = await base44.asServiceRole.entities.AlertIncident.filter({
          terminal_id,
          resolvido: false,
        });

        for (const inc of incidentes) {
          const inicio    = new Date(inc.timestamp).getTime();
          const duracao   = Math.round((Date.now() - inicio) / 60000);
          await base44.asServiceRole.entities.AlertIncident.update(inc.id, {
            resolvido:        true,
            resolvido_em:     agora,
            duracao_minutos:  duracao,
          });
        }

        // Marcar EscalationAlerts como resolvidos
        const escalations = await base44.asServiceRole.entities.EscalationAlert.filter({
          terminal_id,
          resolvido: false,
        });
        for (const esc of escalations) {
          await base44.asServiceRole.entities.EscalationAlert.update(esc.id, { resolvido: true });
        }
      }
    }

    return Response.json({
      success:       true,
      terminal_nome: terminal.nome,
      status,
      mudou:         mudouDeEstado,
    });

  } catch (error) {
    console.error("[p2sReport] Erro:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});