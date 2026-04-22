/**
 * expireMaintenanceWindows — desativa janelas de manutenção cujo fim já passou.
 * Chamado pelo scheduler a cada 15 minutos.
 * Garante que terminais voltam a ser monitorizados após o fim da manutenção.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Aceita chamadas do scheduler (sem auth) e de qualquer utilizador autenticado

        const agora = new Date().toISOString();

        // Buscar janelas ativas
        const janelasAtivas = await base44.asServiceRole.entities.MaintenanceWindow.filter({ ativo: true });

        // Filtrar as que já expiraram
        const expiradas = janelasAtivas.filter(j => {
            const fim = new Date(j.fim);
            return !isNaN(fim.getTime()) && fim.toISOString() < agora;
        });

        // Desativar as expiradas
        await Promise.all(expiradas.map(j =>
            base44.asServiceRole.entities.MaintenanceWindow.update(j.id, { ativo: false }).catch(() => {})
        ));

        console.log(`[expireMaintenance] verificadas=${janelasAtivas.length} expiradas=${expiradas.length}`);

        return Response.json({
            success: true,
            checked: janelasAtivas.length,
            expired: expiradas.length,
            expired_names: expiradas.map(j => j.titulo || j.terminal_nome),
        });

    } catch (error) {
        console.error('expireMaintenanceWindows erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});