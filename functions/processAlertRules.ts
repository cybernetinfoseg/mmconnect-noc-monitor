import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rules = await base44.asServiceRole.entities.AlertRule.filter({ ativo: true });
    const allTerminals = await base44.asServiceRole.entities.Terminal.list();

    // Filtrar terminais em manutenção
    const agora = new Date().toISOString();
    const janelasAtivas = await base44.asServiceRole.entities.MaintenanceWindow.filter({ ativo: true });
    const terminaisEmManutencao = new Set(
        janelasAtivas.filter(j => j.inicio <= agora && j.fim >= agora).map(j => j.terminal_id)
    );
    const terminals = allTerminals.filter(t => !terminaisEmManutencao.has(t.id));

    const now = new Date();
    const results = [];
    // now is used below; agora (ISO string) was computed above for maintenance filter

    for (const rule of rules) {
      // Check cooldown
      if (rule.ultima_disparada) {
        const lastFired = new Date(rule.ultima_disparada);
        const minutesSince = (now - lastFired) / 60000;
        if (minutesSince < (rule.cooldown_minutos || 30)) continue;
      }

      // Filter terminals
      let filteredTerminals = terminals;
      if (rule.filtro_local) {
        filteredTerminals = filteredTerminals.filter(t => t.local === rule.filtro_local);
      }
      if (rule.filtro_cliente) {
        filteredTerminals = filteredTerminals.filter(t =>
          t.cliente_nome === rule.filtro_cliente || t.cliente === rule.filtro_cliente
        );
      }

      let shouldFire = false;
      let messageBody = '';
      let slackText = '';
      const ts = now.toLocaleString('pt-BR');

      if (rule.gatilho === 'terminal_offline') {
        const offlineTerminals = filteredTerminals.filter(t => t.status === 'offline');
        if (offlineTerminals.length > 0) {
          shouldFire = true;
          const list = offlineTerminals.map(t => `• ${t.nome} (${t.local || '—'})`).join('\n');
          messageBody = `Terminais offline detectados em ${ts}:\n\n${list}`;
          slackText = `🔴 *Terminais offline* (${offlineTerminals.length}) detectados:\n` +
            offlineTerminals.map(t => `• \`${t.nome}\` — ${t.local || '—'}`).join('\n');
        }
      } else if (rule.gatilho === 'terminal_online') {
        const onlineTerminals = filteredTerminals.filter(t => t.status === 'online');
        if (onlineTerminals.length > 0) {
          shouldFire = true;
          const list = onlineTerminals.map(t => `• ${t.nome} (${t.local || '—'})`).join('\n');
          messageBody = `Terminais online detectados em ${ts}:\n\n${list}`;
          slackText = `🟢 *Terminais restaurados* (${onlineTerminals.length}):\n` +
            onlineTerminals.map(t => `• \`${t.nome}\` — ${t.local || '—'}`).join('\n');
        }
      } else if (rule.gatilho === 'sem_ping_minutos') {
        const threshold = (rule.condicao_valor || 5) * 60;
        const staleTerminals = filteredTerminals.filter(t =>
          t.ativo && (t.segundos_sem_ping || 0) >= threshold
        );
        if (staleTerminals.length > 0) {
          shouldFire = true;
          const list = staleTerminals.map(t => `• ${t.nome} — sem ping há ${Math.floor((t.segundos_sem_ping || 0) / 60)} min`).join('\n');
          messageBody = `Terminais sem ping há mais de ${rule.condicao_valor} minutos:\n\n${list}`;
          slackText = `⚠️ *Sem ping há mais de ${rule.condicao_valor} min* (${staleTerminals.length}):\n` +
            staleTerminals.map(t => `• \`${t.nome}\` — ${Math.floor((t.segundos_sem_ping || 0) / 60)} min sem ping`).join('\n');
        }
      } else if (rule.gatilho === 'multiplos_offline') {
        const offlineCount = filteredTerminals.filter(t => t.status === 'offline').length;
        if (offlineCount >= (rule.condicao_valor || 2)) {
          shouldFire = true;
          messageBody = `${offlineCount} terminais estão offline em ${ts}.`;
          slackText = `🚨 *Alerta crítico:* ${offlineCount} terminais offline simultaneamente em ${ts}`;
        }
      }

      if (shouldFire) {
        const canal = rule.canal || 'email';
        const sentTo = [];

        // Send email
        if ((canal === 'email' || canal === 'ambos') && rule.destinatarios_email) {
          const emails = rule.destinatarios_email.split(',').map(e => e.trim()).filter(Boolean);
          for (const email of emails) {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: email,
              subject: `[NOC Monitor] Alerta: ${rule.nome}`,
              body: `Regra disparada: ${rule.nome}\n\n${messageBody}\n\n---\nNOC Monitor • Terminais Biométricos`,
            });
            sentTo.push(`email:${email}`);
          }
        }

        // Send Slack
        if ((canal === 'slack' || canal === 'ambos') && rule.slack_webhook_url) {
          const slackPayload = {
            blocks: [
              {
                type: 'header',
                text: { type: 'plain_text', text: `🚨 NOC Monitor: ${rule.nome}` }
              },
              {
                type: 'section',
                text: { type: 'mrkdwn', text: slackText || messageBody }
              },
              {
                type: 'context',
                elements: [
                  { type: 'mrkdwn', text: `*Regra:* ${rule.nome} • *Gatilho:* ${rule.gatilho} • ${ts}` }
                ]
              }
            ]
          };
          await fetch(rule.slack_webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(slackPayload),
          });
          sentTo.push('slack');
        }

        await base44.asServiceRole.entities.AlertRule.update(rule.id, {
          ultima_disparada: now.toISOString(),
          total_disparos: (rule.total_disparos || 0) + 1,
        });

        results.push({ rule: rule.nome, fired: true, sentTo });
      }
    }

    return Response.json({ success: true, processed: rules.length, fired: results });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});