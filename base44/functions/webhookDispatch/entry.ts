/**
 * webhookDispatch — dispara webhooks outbound para integrações externas.
 * Chamado por automação de entidade em AlertIncident (create/update).
 *
 * Payload da automação:
 *   { event: { type, entity_name, entity_id }, data: {...incident}, old_data: {...} }
 *
 * Também pode ser chamado manualmente com:
 *   { action: "test", webhook_id: "..." }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function signPayload(secret, body) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendWebhook(webhook, eventName, payload) {
  const body = JSON.stringify({
    event: eventName,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const headers = {
    'Content-Type': 'application/json',
    'X-NOC-Event': eventName,
    'X-NOC-Webhook-Id': webhook.id,
  };

  if (webhook.secret) {
    const sig = await signPayload(webhook.secret, body);
    headers['X-NOC-Signature'] = `sha256=${sig}`;
  }

  const res = await fetch(webhook.url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(10000),
  });

  return res.status;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    // ── Teste manual de webhook ──────────────────────────────
    if (body.action === 'test') {
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

      const webhook = await base44.asServiceRole.entities.WebhookConfig.get(body.webhook_id).catch(() => null);
      if (!webhook) return Response.json({ error: 'Webhook não encontrado' }, { status: 404 });
      if (webhook.user_email !== user.email && user.role !== 'admin') {
        return Response.json({ error: 'Sem permissão' }, { status: 403 });
      }

      const status = await sendWebhook(webhook, 'test', {
        message: 'Este é um teste do NOC Monitor Webhook',
        webhook_nome: webhook.nome,
      });

      await base44.asServiceRole.entities.WebhookConfig.update(webhook.id, {
        ultimo_disparo: new Date().toISOString(),
        ultimo_status_http: status,
        total_disparos: (webhook.total_disparos || 0) + 1,
      });

      return Response.json({ success: true, http_status: status });
    }

    // ── Chamada por automação de entidade ────────────────────
    const { event, data: incident, old_data } = body;
    if (!event || !incident) {
      return Response.json({ success: true, skipped: 'no_event_data' });
    }

    const entityEvent = event.type; // 'create' or 'update'
    const tipo = incident.tipo;     // 'offline' or 'restored'

    // Mapear para evento NOC
    let nocEvent = null;
    if (entityEvent === 'create' && tipo === 'offline') nocEvent = 'terminal_offline';
    if (entityEvent === 'create' && tipo === 'restored') nocEvent = 'terminal_restored';
    if (entityEvent === 'update' && incident.resolvido && !old_data?.resolvido) nocEvent = 'incident_resolved';
    if (entityEvent === 'create' && tipo === 'offline') {
      // Also fire incident_created
    }

    if (!nocEvent) return Response.json({ success: true, skipped: 'no_matching_event' });

    // Buscar webhooks activos para o owner do terminal
    const ownerEmail = incident.created_by || '';
    const allWebhooks = await base44.asServiceRole.entities.WebhookConfig.filter({ ativo: true });
    // Filter: webhook owned by incident terminal owner OR admin-owned webhooks
    const matching = allWebhooks.filter(w =>
      w.eventos && w.eventos.includes(nocEvent) &&
      (w.user_email === ownerEmail || w.user_email === incident.cliente)
    );

    if (matching.length === 0) return Response.json({ success: true, dispatched: 0 });

    const results = await Promise.all(matching.map(async (webhook) => {
      try {
        const status = await sendWebhook(webhook, nocEvent, {
          terminal_id: incident.terminal_id,
          terminal_nome: incident.terminal_nome,
          local: incident.local,
          cliente: incident.cliente,
          tipo: incident.tipo,
          timestamp: incident.timestamp,
          resolvido: incident.resolvido,
          duracao_minutos: incident.duracao_minutos,
        });
        await base44.asServiceRole.entities.WebhookConfig.update(webhook.id, {
          ultimo_disparo: new Date().toISOString(),
          ultimo_status_http: status,
          total_disparos: (webhook.total_disparos || 0) + 1,
        }).catch(() => {});
        return { webhook_id: webhook.id, status };
      } catch (e) {
        return { webhook_id: webhook.id, error: e.message };
      }
    }));

    return Response.json({ success: true, dispatched: results.length, results });

  } catch (error) {
    console.error('[webhookDispatch] erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});