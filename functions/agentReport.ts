/**
 * agentReport — endpoint seguro para o Agente Local
 *
 * O agente DEVE enviar obrigatoriamente:
 *   Header:  X-Api-Key: <api_key do utilizador>
 *   Header:  X-App-Id:  <app_id>
 *   Body:    { terminal_id, status, latencia_ms, ultimo_ping, segundos_sem_ping }
 *
 * Sem estes dois headers a resposta é 401 / 403.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const APP_ID = Deno.env.get('BASE44_APP_ID') || '697aa46c9998c30665e2e19a';

Deno.serve(async (req) => {
    try {
        // 1. Validar APP ID
        const appIdHeader = req.headers.get('X-App-Id');
        if (!appIdHeader || appIdHeader !== APP_ID) {
            return Response.json({ error: 'APP ID inválido ou ausente' }, { status: 403 });
        }

        // 2. Validar API Key do utilizador
        const apiKey = req.headers.get('X-Api-Key');
        if (!apiKey || !apiKey.startsWith('noc_')) {
            return Response.json({ error: 'API Key inválida ou ausente' }, { status: 401 });
        }

        const base44 = createClientFromRequest(req);

        // Procurar o utilizador que tem esta API Key
        const allUsers = await base44.asServiceRole.entities.User.filter({ api_key: apiKey });
        if (!allUsers || allUsers.length === 0) {
            return Response.json({ error: 'API Key não reconhecida' }, { status: 401 });
        }
        const owner = allUsers[0];

        // 3. Ler payload
        const body = await req.json();
        const { terminal_id, status, latencia_ms, segundos_sem_ping } = body;

        if (!terminal_id || !status) {
            return Response.json({ error: 'terminal_id e status são obrigatórios' }, { status: 400 });
        }

        // 4. Verificar que o terminal pertence ao utilizador (ou é admin)
        const terminal = await base44.asServiceRole.entities.Terminal.get(terminal_id);
        if (!terminal) {
            return Response.json({ error: 'Terminal não encontrado' }, { status: 404 });
        }
        if (owner.role !== 'admin' && terminal.created_by !== owner.email) {
            return Response.json({ error: 'Sem permissão para este terminal' }, { status: 403 });
        }

        const agora = new Date().toISOString();
        const statusValido = ['online', 'offline', 'warning'].includes(status) ? status : 'offline';

        // 5. Atualizar terminal
        await base44.asServiceRole.entities.Terminal.update(terminal_id, {
            status: statusValido,
            ultimo_check: agora,
            latencia_ms: latencia_ms ?? null,
            segundos_sem_ping: segundos_sem_ping ?? 0,
            ...(statusValido === 'online' && { ultimo_ping: agora }),
        });

        // 6. Verificar mudança de status para criar incidentes/alertas
        const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id });
        const cache = cacheResults.length > 0 ? cacheResults[0] : null;

        if (cache && cache.ultimo_status === 'online' && statusValido === 'offline') {
            await base44.asServiceRole.entities.AlertIncident.create({
                terminal_id,
                terminal_nome: terminal.nome,
                local: terminal.local,
                cliente: terminal.cliente_nome,
                tipo: 'offline',
                timestamp: agora,
                resolvido: false,
                notificado: false,
            });
            // Push notification
            await base44.asServiceRole.functions.invoke('pushNotify', {
                action: 'notify_offline',
                terminal_id,
                terminal_nome: terminal.nome,
                local: terminal.local || '',
                cliente: terminal.cliente_nome || '',
                owner_email: terminal.created_by || '',
            }).catch(() => {});
        } else if (cache && cache.ultimo_status === 'offline' && statusValido === 'online') {
            await base44.asServiceRole.entities.AlertIncident.create({
                terminal_id,
                terminal_nome: terminal.nome,
                local: terminal.local,
                cliente: terminal.cliente_nome,
                tipo: 'restored',
                timestamp: agora,
                resolvido: true,
                notificado: false,
            });
            // Resolver escalações
            const openAlerts = await base44.asServiceRole.entities.EscalationAlert.filter({
                terminal_id, resolvido: false,
            }).catch(() => []);
            for (const alert of openAlerts) {
                await base44.asServiceRole.entities.EscalationAlert.update(alert.id, { resolvido: true }).catch(() => {});
            }
        }

        // 7. Atualizar cache
        if (cache) {
            await base44.asServiceRole.entities.StatusCache.update(cache.id, {
                ultimo_status: statusValido,
                atualizado_em: agora,
            });
        } else {
            await base44.asServiceRole.entities.StatusCache.create({
                terminal_id,
                ultimo_status: statusValido,
                atualizado_em: agora,
            });
        }

        // 8. Histórico
        await base44.asServiceRole.entities.StatusHistory.create({
            terminal_id,
            terminal_nome: terminal.nome,
            status: statusValido,
            timestamp: agora,
            local: terminal.local,
            cliente: terminal.cliente_nome,
        });

        return Response.json({ success: true, terminal: terminal.nome, status: statusValido });

    } catch (error) {
        console.error('agentReport erro:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});