import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

/**
 * cleanupOldHistory — apaga registos de StatusHistory com mais de 30 dias.
 * Chamado pelo scheduler 1x por dia para manter a base de dados saudável.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const isAuthenticated = await base44.auth.isAuthenticated();
        if (isAuthenticated) {
            const user = await base44.auth.me();
            if (user?.role !== 'admin') {
                return Response.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        // Buscar registos antigos (em batches de 200)
        const oldRecords = await base44.asServiceRole.entities.StatusHistory.list('-timestamp', 200);
        const toDelete = oldRecords.filter(r => r.timestamp < cutoff);

        let deleted = 0;
        for (const record of toDelete) {
            await base44.asServiceRole.entities.StatusHistory.delete(record.id).catch(() => {});
            deleted++;
        }

        // Limpar também AlertIncidents resolvidos há mais de 60 dias
        const oldIncidents = await base44.asServiceRole.entities.AlertIncident.list('-timestamp', 200);
        const cutoff60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
        const incidentsToDelete = oldIncidents.filter(i => i.resolvido && i.timestamp < cutoff60);

        let deletedIncidents = 0;
        for (const incident of incidentsToDelete) {
            await base44.asServiceRole.entities.AlertIncident.delete(incident.id).catch(() => {});
            deletedIncidents++;
        }

        return Response.json({
            success: true,
            deleted_history: deleted,
            deleted_incidents: deletedIncidents,
            cutoff_history: cutoff,
            cutoff_incidents: cutoff60,
        });

    } catch (error) {
        console.error('cleanupOldHistory erro:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});