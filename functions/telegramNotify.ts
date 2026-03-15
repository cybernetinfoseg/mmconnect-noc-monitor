/**
 * telegramNotify — envia mensagens de alerta para um grupo/canal Telegram.
 *
 * Secrets necessários (configurar em Dashboard → Settings → Environment Variables):
 *   TELEGRAM_BOT_TOKEN  — token do bot (via @BotFather)
 *   TELEGRAM_CHAT_ID    — ID do grupo/canal (ex: -1001234567890)
 *
 * Payload esperado:
 *   { action: 'notify_offline' | 'notify_restored', terminal_nome, local, cliente }
 */

Deno.serve(async (req) => {
    try {
        const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
        const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

        if (!BOT_TOKEN || !CHAT_ID) {
            console.warn('telegramNotify: TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados. Ignorando.');
            return Response.json({ success: false, reason: 'secrets_not_configured' });
        }

        const body = await req.json();
        const { action, terminal_nome, local, cliente } = body;

        const agora = new Date().toLocaleString('pt-PT', { timeZone: 'UTC', hour12: false });

        let text = '';
        if (action === 'notify_offline') {
            text = [
                `🔴 *TERMINAL OFFLINE*`,
                ``,
                `📟 *Terminal:* ${terminal_nome || 'Desconhecido'}`,
                `📍 *Local:* ${local || '—'}`,
                `🏢 *Cliente:* ${cliente || '—'}`,
                `🕐 *Hora:* ${agora} UTC`,
                ``,
                `⚠️ O terminal deixou de responder. Verificar ligação.`,
            ].join('\n');
        } else if (action === 'notify_restored') {
            text = [
                `✅ *TERMINAL RESTAURADO*`,
                ``,
                `📟 *Terminal:* ${terminal_nome || 'Desconhecido'}`,
                `📍 *Local:* ${local || '—'}`,
                `🏢 *Cliente:* ${cliente || '—'}`,
                `🕐 *Hora:* ${agora} UTC`,
                ``,
                `✔️ Terminal voltou a ficar online.`,
            ].join('\n');
        } else {
            return Response.json({ success: false, reason: 'unknown_action' });
        }

        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text,
                parse_mode: 'Markdown',
            }),
        });

        const result = await res.json();

        if (!result.ok) {
            console.error('telegramNotify erro Telegram API:', result);
            return Response.json({ success: false, error: result.description }, { status: 500 });
        }

        return Response.json({ success: true, message_id: result.result?.message_id });

    } catch (error) {
        console.error('telegramNotify erro:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});