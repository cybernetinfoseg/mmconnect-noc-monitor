/**
 * processAlertRules — avalia regras de alerta e envia notificações.
 * Chamado pelo scheduler a cada 5 minutos.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Aceita chamadas do scheduler (sem auth) e de qualquer utilizador autenticado

        const now = new Date();
        const agora_ms = now.getTime();

        const [rules, allTerminals, janelasAtivas, statusCaches] = await Promise.all([
            base44.asServiceRole.entities.AlertRule.filter({ ativo: true }),
            base44.asServiceRole.entities.Terminal.list(),
            base44.asServiceRole.entities.MaintenanceWindow.filter({ ativo: true }),
            base44.asServiceRole.entities.StatusCache.list().catch(() => []),
        ]);

        // Filtrar terminais em manutenção — comparação temporal correcta com timestamps
        const terminaisEmManutencao = new Set(
            janelasAtivas
                .filter(j => {
                    const ini = new Date(j.inicio).getTime();
                    const fim = new Date(j.fim).getTime();
                    return !isNaN(ini) && !isNaN(fim) && agora_ms >= ini && agora_ms <= fim;
                })
                .map(j => j.terminal_id)
        );
        const terminals = allTerminals.filter(t => !terminaisEmManutencao.has(t.id));

        const ts = now.toLocaleString('pt-PT', { timeZone: 'UTC' }) + ' UTC';
        const results = [];

        for (const rule of rules) {
            // Verificar cooldown
            if (rule.ultima_disparada) {
                const lastFired = new Date(rule.ultima_disparada);
                if (!isNaN(lastFired.getTime())) {
                    const minutesSince = (agora_ms - lastFired.getTime()) / 60000;
                    if (minutesSince < (rule.cooldown_minutos || 30)) continue;
                }
            }

            // Filtrar terminais da regra
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

            if (rule.gatilho === 'terminal_offline') {
                const offline = filteredTerminals.filter(t => t.status === 'offline');
                if (offline.length > 0) {
                    shouldFire = true;
                    const list = offline.map(t => `• ${t.nome} (${t.local || '—'})`).join('\n');
                    messageBody = `Terminais offline detectados em ${ts}:\n\n${list}`;
                    slackText = `🔴 *Terminais offline* (${offline.length}):\n` +
                        offline.map(t => `• \`${t.nome}\` — ${t.local || '—'}`).join('\n');
                }
            } else if (rule.gatilho === 'terminal_online') {
                // Disparar apenas para terminais que VOLTARAM online recentemente (últimos 10 min)
                const tenMinAgo = new Date(agora_ms - 10 * 60 * 1000).toISOString();
                const recentlyRestored = filteredTerminals.filter(t =>
                    t.status === 'online' && t.ultimo_ping && t.ultimo_ping > tenMinAgo
                );
                if (recentlyRestored.length > 0) {
                    shouldFire = true;
                    const list = recentlyRestored.map(t => `• ${t.nome} (${t.local || '—'})`).join('\n');
                    messageBody = `Terminais que voltaram online em ${ts}:\n\n${list}`;
                    slackText = `🟢 *Terminais restaurados* (${recentlyRestored.length}):\n` +
                        recentlyRestored.map(t => `• \`${t.nome}\` — ${t.local || '—'}`).join('\n');
                }
            } else if (rule.gatilho === 'sem_ping_minutos') {
                const threshold = (rule.condicao_valor || 5) * 60;
                const stale = filteredTerminals.filter(t =>
                    t.ativo && (t.segundos_sem_ping || 0) >= threshold
                );
                if (stale.length > 0) {
                    shouldFire = true;
                    const list = stale.map(t => `• ${t.nome} — sem ping há ${Math.floor((t.segundos_sem_ping || 0) / 60)} min`).join('\n');
                    messageBody = `Terminais sem ping há mais de ${rule.condicao_valor} minutos:\n\n${list}`;
                    slackText = `⚠️ *Sem ping há +${rule.condicao_valor} min* (${stale.length}):\n` +
                        stale.map(t => `• \`${t.nome}\` — ${Math.floor((t.segundos_sem_ping || 0) / 60)} min`).join('\n');
                }
            } else if (rule.gatilho === 'multiplos_offline') {
                const offlineCount = filteredTerminals.filter(t => t.status === 'offline').length;
                if (offlineCount >= (rule.condicao_valor || 2)) {
                    shouldFire = true;
                    messageBody = `${offlineCount} terminais estão offline em ${ts}.`;
                    slackText = `🚨 *Alerta crítico:* ${offlineCount} terminais offline simultaneamente em ${ts}`;
                }
            }

            if (!shouldFire) continue;

            const canal = rule.canal || 'email';
            const sentTo = [];

            // Email
            if ((canal === 'email' || canal === 'ambos') && rule.destinatarios_email) {
                const emails = rule.destinatarios_email.split(',').map(e => e.trim()).filter(Boolean);
                await Promise.all(emails.map(email =>
                    base44.asServiceRole.integrations.Core.SendEmail({
                        to: email,
                        subject: `[NOC Monitor] Alerta: ${rule.nome}`,
                        body: `Regra disparada: ${rule.nome}\n\n${messageBody}\n\n---\nNOC Monitor • Terminais Biométricos`,
                    }).catch(err => console.warn(`Email falhou para ${email}:`, err.message))
                ));
                sentTo.push(`email(${emails.length})`);
            }

            // Slack
            if ((canal === 'slack' || canal === 'ambos') && rule.slack_webhook_url) {
                const slackPayload = {
                    blocks: [
                        { type: 'header', text: { type: 'plain_text', text: `🚨 NOC Monitor: ${rule.nome}` } },
                        { type: 'section', text: { type: 'mrkdwn', text: slackText || messageBody } },
                        { type: 'context', elements: [{ type: 'mrkdwn', text: `*Regra:* ${rule.nome} • *Gatilho:* ${rule.gatilho} • ${ts}` }] },
                    ],
                };
                const slackRes = await fetch(rule.slack_webhook_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(slackPayload),
                }).catch(() => null);
                if (slackRes?.ok) sentTo.push('slack');
            }

            await base44.asServiceRole.entities.AlertRule.update(rule.id, {
                ultima_disparada: now.toISOString(),
                total_disparos: (rule.total_disparos || 0) + 1,
            });

            results.push({ rule: rule.nome, fired: true, sentTo });
        }

        console.log(`[processAlertRules] processed=${rules.length} fired=${results.length}`);
        return Response.json({ success: true, processed: rules.length, fired: results });

    } catch (error) {
        console.error('[processAlertRules] erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});