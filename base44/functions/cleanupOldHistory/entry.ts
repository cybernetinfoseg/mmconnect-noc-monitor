import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * cleanupOldHistory — apaga registos antigos em múltiplos passes até não restar nenhum.
 * Sem limite de 500 — continua até limpar tudo.
 * Chamado pelo scheduler 1x por dia para manter a base de dados saudável.
 */

async function deleteAllOld(entity, sortField, filterFn, label) {
    let totalDeleted = 0;
    let passes = 0;
    while (true) {
        passes++;
        const batch = await entity.list(sortField, 500).catch(() => []);
        const toDelete = batch.filter(filterFn);
        if (toDelete.length === 0) break;

        for (let i = 0; i < toDelete.length; i += 20) {
            const chunk = toDelete.slice(i, i + 20);
            await Promise.all(chunk.map(r => entity.delete(r.id).catch(() => {})));
        }
        totalDeleted += toDelete.length;
        console.log(`[cleanup] ${label}: pass ${passes} → apagados ${toDelete.length} (total: ${totalDeleted})`);

        // Se o batch retornou menos de 500, não há mais registos antigos
        if (batch.length < 500) break;
    }
    return totalDeleted;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const isAuthenticated = await base44.auth.isAuthenticated();
        if (isAuthenticated) {
            const user = await base44.auth.me();
            if (user?.role !== 'admin') {
                return Response.json({ error: 'Forbidden: apenas admins' }, { status: 403 });
            }
        }

        const now = Date.now();
        const cutoff30  = new Date(now - 30  * 86400000).toISOString();
        const cutoff60  = new Date(now - 60  * 86400000).toISOString();
        const cutoff90  = new Date(now - 90  * 86400000).toISOString();

        const db = base44.asServiceRole.entities;

        // Executar todas as limpezas em paralelo (cada uma faz os seus próprios passes)
        const [
            deletedHistory,
            deletedIncidents,
            deletedEscalations,
            deletedAuditLogs,
            deletedOpLogs,
            deletedSubs,
        ] = await Promise.all([
            // StatusHistory > 30 dias
            deleteAllOld(db.StatusHistory, '-timestamp',
                r => r.timestamp < cutoff30, 'StatusHistory'),

            // AlertIncidents resolvidos > 60 dias
            deleteAllOld(db.AlertIncident, '-timestamp',
                r => r.resolvido && r.timestamp < cutoff60, 'AlertIncident'),

            // EscalationAlerts resolvidos > 30 dias
            deleteAllOld(db.EscalationAlert, '-offline_desde',
                e => e.resolvido && e.offline_desde < cutoff30, 'EscalationAlert'),

            // AuditLogs > 90 dias
            deleteAllOld(db.AuditLog, '-timestamp',
                l => l.timestamp < cutoff90, 'AuditLog'),

            // OperationLogs > 90 dias
            deleteAllOld(db.OperationLog, '-timestamp',
                l => l.timestamp < cutoff90, 'OperationLog'),

            // PushSubscriptions inativas > 90 dias
            deleteAllOld(db.PushSubscription, '-updated_date',
                s => !s.ativo && s.updated_date < cutoff90, 'PushSubscription'),
        ]);

        console.log(`[cleanup] Concluído — History:${deletedHistory} Incidents:${deletedIncidents} Escalations:${deletedEscalations} AuditLogs:${deletedAuditLogs} OpLogs:${deletedOpLogs} Subs:${deletedSubs}`);

        return Response.json({
            success: true,
            deleted_history: deletedHistory,
            deleted_incidents: deletedIncidents,
            deleted_escalations: deletedEscalations,
            deleted_audit_logs: deletedAuditLogs,
            deleted_operation_logs: deletedOpLogs,
            deleted_push_subscriptions: deletedSubs,
            cutoffs: { history: cutoff30, incidents: cutoff60, audit_logs: cutoff90 },
        });

    } catch (error) {
        console.error('cleanupOldHistory erro:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});