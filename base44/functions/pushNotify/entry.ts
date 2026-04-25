/**
 * pushNotify — Notificações Web Push + gestão de subscrições.
 *
 * Acções:
 *   subscribe        — registar subscrição Web Push do utilizador
 *   unsubscribe      — desactivar subscrição
 *   notify_offline   — notificar dono + admins que terminal ficou offline
 *
 * NOTA: Web Push real requer VAPID keys configuradas no servidor.
 * Esta implementação faz best-effort push para os endpoints registados.
 * Se o push falhar (endpoint expirado), a subscrição é desactivada automaticamente.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        const { action } = body;

        // ─── SUBSCRIBE ────────────────────────────────────────────────
        if (action === 'subscribe') {
            const user = await base44.auth.me();
            if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

            const { endpoint, p256dh, auth: authKey } = body;
            if (!endpoint) return Response.json({ error: 'endpoint obrigatório' }, { status: 400 });

            // Desactivar subscrições anteriores para este endpoint
            const existing = await base44.asServiceRole.entities.PushSubscription.filter({ endpoint });
            await Promise.all(existing.map(sub =>
                base44.asServiceRole.entities.PushSubscription.update(sub.id, { ativo: false })
            ));

            await base44.asServiceRole.entities.PushSubscription.create({
                user_email: user.email,
                endpoint,
                p256dh: p256dh || '',
                auth: authKey || '',
                ativo: true,
                user_agent: req.headers.get('user-agent') || '',
            });

            return Response.json({ success: true });
        }

        // ─── UNSUBSCRIBE ──────────────────────────────────────────────
        if (action === 'unsubscribe') {
            const user = await base44.auth.me();
            if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

            const { endpoint } = body;
            const subs = await base44.asServiceRole.entities.PushSubscription.filter({
                user_email: user.email,
                endpoint,
            });
            await Promise.all(subs.map(sub =>
                base44.asServiceRole.entities.PushSubscription.update(sub.id, { ativo: false })
            ));
            return Response.json({ success: true });
        }

        // ─── NOTIFY OFFLINE ───────────────────────────────────────────
        // Chamado internamente pelos reporters (agentReport, nocServerReport, etc.)
        if (action === 'notify_offline') {
            const { terminal_id, terminal_nome, local, cliente, owner_email } = body;

            if (!terminal_id || !terminal_nome) {
                return Response.json({ error: 'terminal_id e terminal_nome obrigatórios' }, { status: 400 });
            }

            // Verificar escalation existente (criado pelo reporter antes de chamar pushNotify)
            const existing = await base44.asServiceRole.entities.EscalationAlert.filter({
                terminal_id,
                resolvido: false,
            });

            // Já notificado anteriormente — não duplicar
            if (existing.length > 0 && existing[0].notificacao_inicial_enviada) {
                return Response.json({ success: true, skipped: true, reason: 'já notificado' });
            }

            // Usar escalation existente ou criar um de emergência se o reporter falhou
            const escalationAlert = existing[0] || await base44.asServiceRole.entities.EscalationAlert.create({
                terminal_id,
                terminal_nome,
                local: local || '',
                cliente: cliente || '',
                owner_email: owner_email || '',
                offline_desde: new Date().toISOString(),
                escalado: false,
                resolvido: false,
                notificacao_inicial_enviada: false,
            });

            // Obter subscrições activas
            const [allSubs, admins] = await Promise.all([
                base44.asServiceRole.entities.PushSubscription.filter({ ativo: true }),
                base44.asServiceRole.entities.User.filter({ role: 'admin' }),
            ]);

            const adminEmails = new Set(admins.map(a => a.email));
            const targetSubs = allSubs.filter(s =>
                s.user_email === owner_email || adminEmails.has(s.user_email)
            );

            const payload = JSON.stringify({
                title: '🔴 Terminal Offline',
                body: `${terminal_nome}${local ? ' — ' + local : ''} ficou offline.`,
                tag: `offline-${terminal_id}`,
                data: { terminal_id, url: '/Terminais' },
            });

            let notified = 0;
            const failedEndpoints = [];

            for (const sub of targetSubs) {
                const success = await sendWebPush(sub, payload);
                if (success) {
                    notified++;
                } else {
                    failedEndpoints.push(sub.id);
                }
            }

            // Desactivar subscrições expiradas/inválidas
            if (failedEndpoints.length > 0) {
                await Promise.all(failedEndpoints.map(id =>
                    base44.asServiceRole.entities.PushSubscription.update(id, { ativo: false }).catch(() => {})
                ));
            }

            // Notificações Telegram para dono + admins
            const allUsers = await base44.asServiceRole.entities.User.list().catch(() => []);
            const telegramTargets = allUsers.filter(u =>
                u.telegram_bot_token && u.telegram_chat_id &&
                (adminEmails.has(u.email) || u.email === owner_email)
            );
            const telegramMsg = `🔴 <b>Terminal Offline</b>\n\n📟 <b>${terminal_nome}</b>\n📍 Local: ${local || '—'}\n🏢 Cliente: ${cliente || '—'}\n🕐 ${new Date().toLocaleString('pt-PT', { timeZone: 'UTC' })} UTC`;
            await Promise.all(telegramTargets.map(u =>
                base44.asServiceRole.functions.invoke('telegramNotify', {
                    bot_token: u.telegram_bot_token,
                    chat_id: u.telegram_chat_id,
                    message: telegramMsg,
                }).catch(() => {})
            ));

            // Marcar notificação inicial como enviada
            await base44.asServiceRole.entities.EscalationAlert.update(escalationAlert.id, {
                notificacao_inicial_enviada: true,
            });

            console.log(`[pushNotify] notify_offline: ${terminal_nome} → ${notified} push(es) + ${telegramTargets.length} telegram(s)`);
            return Response.json({ success: true, notified, telegram: telegramTargets.length });
        }

        return Response.json({ error: `Acção desconhecida: ${action}` }, { status: 400 });

    } catch (error) {
        console.error('[pushNotify] erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

/**
 * Envia Web Push para uma subscrição.
 * Retorna true se sucesso, false se endpoint inválido/expirado.
 *
 * NOTA: Push sem VAPID funciona apenas com alguns browsers (Firefox) em modo permissivo.
 * Para produção com Chrome, é necessário configurar VAPID keys no servidor de push dedicado.
 * Esta implementação é best-effort — o Telegram é o canal principal de notificações em tempo real.
 */
async function sendWebPush(sub, payloadStr) {
    try {
        const res = await fetch(sub.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'TTL': '86400',
            },
            body: payloadStr,
        });
        if (res.status === 404 || res.status === 410 || res.status === 400 || res.status === 401) {
            // Endpoint expirado, removido ou inválido sem VAPID
            console.warn(`[pushNotify] Subscrição inválida para ${sub.user_email}: HTTP ${res.status}`);
            return false;
        }
        return res.ok || res.status === 201;
    } catch {
        return false;
    }
}