/**
 * telegramNotify — envia mensagem de alerta via Telegram Bot API
 * Chamado internamente por agentReport/monitorAllTerminals
 * Payload: { bot_token, chat_id, message }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const body = await req.json();
        const { bot_token, chat_id, message } = body;

        if (!bot_token || !chat_id || !message) {
            return Response.json({ error: 'bot_token, chat_id e message são obrigatórios' }, { status: 400 });
        }

        const url = `https://api.telegram.org/bot${bot_token}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id,
                text: message,
                parse_mode: 'HTML',
            }),
        });

        const data = await res.json();

        if (!res.ok) {
            return Response.json({ error: data.description || 'Erro Telegram' }, { status: 400 });
        }

        return Response.json({ success: true, message_id: data.result?.message_id });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});