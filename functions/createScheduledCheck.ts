import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// This function saves a scheduled check preference on the terminal.
// A scheduled automation (monitorAllTerminals) handles the actual periodic monitoring.

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { terminalId, interval, unit } = await req.json();

        if (!terminalId || !interval || !unit) {
            return Response.json({ error: 'Parâmetros inválidos' }, { status: 400 });
        }

        const terminal = await base44.asServiceRole.entities.Terminal.get(terminalId);
        if (!terminal) {
            return Response.json({ error: 'Terminal não encontrado' }, { status: 404 });
        }

        // Save schedule preference as observacoes metadata tag
        const scheduleTag = `[CHECK:${interval}${unit.charAt(0)}]`;
        // Remove existing schedule tag if any, then add new
        const baseObs = (terminal.observacoes || '').replace(/\[CHECK:[^\]]+\]/g, '').trim();
        const newObs = baseObs ? `${baseObs} ${scheduleTag}` : scheduleTag;

        await base44.asServiceRole.entities.Terminal.update(terminalId, {
            observacoes: newObs
        });

        // Log this action in history
        await base44.asServiceRole.entities.StatusHistory.create({
            terminal_id: terminalId,
            terminal_nome: terminal.nome,
            status: terminal.status || 'offline',
            timestamp: new Date().toISOString(),
            local: terminal.local,
            cliente: terminal.cliente_nome,
        });

        return Response.json({
            success: true,
            message: `Verificação agendada a cada ${interval} ${unit} para ${terminal.nome}`,
        });

    } catch (error) {
        console.error('Erro ao criar agendamento:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});