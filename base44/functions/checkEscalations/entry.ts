/**
 * checkEscalations — scheduler horário.
 * Escala terminais offline há +24h e resolve alertas de terminais online.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Scheduler chama sem auth; utilizador autenticado deve ser admin
        const isAuthenticated = await base44.auth.isAuthenticated();
        if (isAuthenticated) {
            const user = await base44.auth.me();
            if (user?.role !== 'admin') {
                return Response.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const now = new Date();
        const threshold24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // Buscar dados em paralelo
        const [openAlerts, admins, allUsers, terminals] = await Promise.all([
            base44.asServiceRole.entities.EscalationAlert.filter({ resolvido: false }),
            base44.asServiceRole.entities.User.filter({ role: 'admin' }),
            base44.asServiceRole.entities.User.list().catch(() => []),
            base44.asServiceRole.entities.Terminal.list(),
        ]);

        const adminEmails = admins.map(a => a.email).filter(Boolean);
        const usersWithTelegram = allUsers.filter(u => u.telegram_bot_token && u.telegram_chat_id);
        const onlineIds = new Set(terminals.filter(t => t.status === 'online').map(t => t.id));

        const escalated = [];
        // Separar: não escalados (candidatos a escalação) e todos os abertos (para resolver)
        const naoEscalados = openAlerts.filter(a => !a.escalado);

        for (const alert of naoEscalados) {
            const offlineSince = new Date(alert.offline_desde);
            if (isNaN(offlineSince.getTime())) continue; // guard contra datas inválidas
            if (offlineSince <= threshold24h) {
                const duracao = Math.round((now - offlineSince) / 60000);
                const emailPromises = adminEmails.map(email =>
                    base44.asServiceRole.integrations.Core.SendEmail({
                        to: email,
                        subject: `[ESCALAÇÃO] Terminal ${alert.terminal_nome} offline há +24h`,
                        body: `ALERTA ESCALADO\n\nO terminal "${alert.terminal_nome}" localizado em "${alert.local || '—'}" (cliente: ${alert.cliente || '—'}) está OFFLINE há mais de 24 horas sem resolução.\n\nOffline desde: ${new Date(alert.offline_desde).toLocaleString('pt-PT', { timeZone: 'UTC' })} UTC\nDuração: ~${duracao} minutos\nDono: ${alert.owner_email || '—'}\n\n---\nNOC Monitor • Sistema de Escalação Automática`,
                    }).catch(() => {})
                );

                const telegramPromises = usersWithTelegram
                    .filter(u => adminEmails.includes(u.email) || u.email === alert.owner_email)
                    .map(u => {
                        const msg = `🚨 <b>Escalação: Terminal Crítico Offline +24h</b>\n\n` +
                            `📟 <b>${alert.terminal_nome}</b>\n` +
                            `📍 Local: ${alert.local || '—'}\n` +
                            `🏢 Cliente: ${alert.cliente || '—'}\n` +
                            `⏱ Offline desde: ${new Date(alert.offline_desde).toLocaleString('pt-PT', { timeZone: 'UTC' })} UTC\n` +
                            `⌛ Duração: ~${duracao} min\n` +
                            `👤 Dono: ${alert.owner_email || '—'}`;
                        return base44.asServiceRole.functions.invoke('telegramNotify', {
                            bot_token: u.telegram_bot_token,
                            chat_id: u.telegram_chat_id,
                            message: msg,
                        }).catch(() => {});
                    });

                await Promise.all([...emailPromises, ...telegramPromises]);

                await base44.asServiceRole.entities.EscalationAlert.update(alert.id, {
                    escalado: true,
                    escalado_em: now.toISOString(),
                });

                escalated.push(alert.terminal_nome);
            }
        }

        // Resolver alertas de terminais que voltaram online (usar openAlerts já carregado)
        const toResolve = openAlerts.filter(a => onlineIds.has(a.terminal_id));
        await Promise.all(toResolve.map(a =>
            base44.asServiceRole.entities.EscalationAlert.update(a.id, { resolvido: true }).catch(() => {})
        ));

        console.log(`[checkEscalations] escalated=${escalated.length} resolved=${toResolve.length}`);
        return Response.json({ success: true, escalated, checked: openAlerts.length, resolved: toResolve.length });

    } catch (error) {
        console.error('checkEscalations erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});