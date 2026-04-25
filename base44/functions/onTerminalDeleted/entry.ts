/**
 * onTerminalDeleted — limpeza automática ao eliminar um terminal.
 * Chamado pela automation "Limpar dados ao excluir terminal" (entity event: delete).
 * Remove: StatusCache, StatusHistory, AlertIncident, EscalationAlert do terminal.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json().catch(() => ({}));

        // Payload da entity automation: { event: { type, entity_name, entity_id }, data, old_data }
        const terminal_id = body?.event?.entity_id || body?.data?.id || body?.terminal_id;

        if (!terminal_id) {
            console.warn('[onTerminalDeleted] terminal_id não encontrado no payload:', JSON.stringify(body));
            return Response.json({ success: true, skipped: 'sem terminal_id' });
        }

        console.log(`[onTerminalDeleted] Limpando dados do terminal: ${terminal_id}`);

        // Buscar todos os dados relacionados em paralelo
        const [caches, history, incidents, escalations, opLogs, maintenance, scheduled] = await Promise.all([
            base44.asServiceRole.entities.StatusCache.filter({ terminal_id }).catch(() => []),
            base44.asServiceRole.entities.StatusHistory.filter({ terminal_id }).catch(() => []),
            base44.asServiceRole.entities.AlertIncident.filter({ terminal_id }).catch(() => []),
            base44.asServiceRole.entities.EscalationAlert.filter({ terminal_id }).catch(() => []),
            base44.asServiceRole.entities.OperationLog.filter({ terminal_id }).catch(() => []),
            base44.asServiceRole.entities.MaintenanceWindow.filter({ terminal_id }).catch(() => []),
            base44.asServiceRole.entities.ScheduledAction.filter({ terminal_id }).catch(() => []),
        ]);

        // Apagar tudo em paralelo
        const deleteAll = [
            ...caches.map(r => base44.asServiceRole.entities.StatusCache.delete(r.id).catch(() => {})),
            ...history.map(r => base44.asServiceRole.entities.StatusHistory.delete(r.id).catch(() => {})),
            ...incidents.map(r => base44.asServiceRole.entities.AlertIncident.delete(r.id).catch(() => {})),
            ...escalations.map(r => base44.asServiceRole.entities.EscalationAlert.delete(r.id).catch(() => {})),
            ...opLogs.map(r => base44.asServiceRole.entities.OperationLog.delete(r.id).catch(() => {})),
            ...maintenance.map(r => base44.asServiceRole.entities.MaintenanceWindow.delete(r.id).catch(() => {})),
            ...scheduled.map(r => base44.asServiceRole.entities.ScheduledAction.delete(r.id).catch(() => {})),
        ];
        await Promise.all(deleteAll);

        const summary = {
            terminal_id,
            deleted: {
                cache: caches.length,
                history: history.length,
                incidents: incidents.length,
                escalations: escalations.length,
                operation_logs: opLogs.length,
                maintenance_windows: maintenance.length,
                scheduled_actions: scheduled.length,
            }
        };

        console.log(`[onTerminalDeleted] OK:`, JSON.stringify(summary.deleted));
        return Response.json({ success: true, ...summary });

    } catch (error) {
        console.error('[onTerminalDeleted] erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});