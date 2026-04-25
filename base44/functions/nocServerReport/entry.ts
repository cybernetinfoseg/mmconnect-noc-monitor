/**
 * nocServerReport — endpoint unificado para o NOC Server (noc_server.py)
 *                   e Timmy WebSocket Server (timmy_ws_server.py)
 *
 * Tipos geridos: heartbeat, adms_push, sdk_tcp, websocket_cloud
 * Autenticação: X-Api-Key pessoal
 * Payload: { terminal_id, status, latencia_ms?, segundos_sem_ping? }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const NOC_TYPES = ['heartbeat', 'adms_push', 'sdk_tcp', 'websocket_cloud'];

Deno.serve(async (req) => {
    try {
        const apiKey = (req.headers.get('X-Api-Key') || req.headers.get('x-api-key') || '').trim();
        if (!apiKey || apiKey.length < 16) {
            return Response.json({ error: 'API Key ausente ou inválida' }, { status: 401 });
        }

        const base44 = createClientFromRequest(req);
        const allApiKeys = await base44.asServiceRole.entities.ApiKey.filter({ ativo: true });
        const keyRecord = allApiKeys.find(k => k.key === apiKey);

        if (!keyRecord) {
            return Response.json({ error: 'API Key inválida' }, { status: 401 });
        }

        const ownerEmail = keyRecord.user_email;
        const body = await req.json();
        const { terminal_id, status, latencia_ms, segundos_sem_ping } = body;

        if (!terminal_id || !status) {
            return Response.json({ error: 'terminal_id e status são obrigatórios' }, { status: 400 });
        }

        // Verificar ownership — usa usuario_email (ownership real) com fallback para created_by
        const byUsuario = await base44.asServiceRole.entities.Terminal.filter({ ativo: true, usuario_email: ownerEmail });
        const byCreated = await base44.asServiceRole.entities.Terminal.filter({ ativo: true, created_by: ownerEmail });
        const seen = new Set();
        const terminaisDoUtilizador = [...byUsuario, ...byCreated].filter(t => {
            if (seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
        });

        const terminal = terminaisDoUtilizador.find(t => t.id === terminal_id);

        if (!terminal) {
            const terminalExiste = await base44.asServiceRole.entities.Terminal.get(terminal_id).catch(() => null);
            if (!terminalExiste) {
                return Response.json({ error: 'Terminal não encontrado' }, { status: 404 });
            }
            return Response.json({ error: 'Sem permissão para reportar este terminal' }, { status: 403 });
        }

        // Validar tipo
        if (!NOC_TYPES.includes(terminal.tipo_conexao)) {
            return Response.json({ error: `Tipo "${terminal.tipo_conexao}" não é gerido pelo NOC Server` }, { status: 400 });
        }

        const agora = new Date().toISOString();
        const statusValido = ['online', 'offline', 'warning'].includes(status) ? status : 'offline';
        const statusEfetivo = statusValido === 'warning' ? 'online' : statusValido;

        // Atualizar terminal
        await base44.asServiceRole.entities.Terminal.update(terminal_id, {
            status: statusValido,
            ultimo_check: agora,
            latencia_ms: latencia_ms ?? null,
            segundos_sem_ping: segundos_sem_ping ?? 0,
            ...(statusEfetivo === 'online' && { ultimo_ping: agora }),
        });

        // Verificar janela de manutenção (comparação temporal correcta)
        const janelasManu = await base44.asServiceRole.entities.MaintenanceWindow.filter({ terminal_id, ativo: true });
        const agora_ms = Date.now();
        const emManutencao = janelasManu.some(j => {
            const ini = new Date(j.inicio).getTime();
            const fim = new Date(j.fim).getTime();
            return agora_ms >= ini && agora_ms <= fim;
        });

        // Ignorar offline durante manutenção
        if (emManutencao && statusEfetivo === 'offline') {
            console.log(`[nocServerReport] '${terminal.nome}' em manutenção — ignorado`);
            return Response.json({ success: true, ignored: 'em_manutencao' });
        }

        // Verificar cache de status
        const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id });
        const cache = cacheResults.length > 0 ? cacheResults[0] : null;
        const statusAnterior = cache?.ultimo_status ?? null;
        const mudouDeEstado = statusAnterior !== null && statusAnterior !== statusEfetivo;

        if (mudouDeEstado) {
            console.log(`[nocServerReport] '${terminal.nome}' mudou: ${statusAnterior} → ${statusEfetivo}`);

            // Histórico apenas em mudanças de estado
            await base44.asServiceRole.entities.StatusHistory.create({
                terminal_id,
                terminal_nome: terminal.nome,
                status: statusEfetivo,
                timestamp: agora,
                local: terminal.local || '',
                cliente: terminal.cliente_nome || '',
            });

            if (statusEfetivo === 'offline') {
                // Criar incidente
                await base44.asServiceRole.entities.AlertIncident.create({
                    terminal_id,
                    terminal_nome: terminal.nome,
                    local: terminal.local || '',
                    cliente: terminal.cliente_nome || '',
                    tipo: 'offline',
                    timestamp: agora,
                    resolvido: false,
                    notificado: false,
                });
                // Criar EscalationAlert para notificações push
                await base44.asServiceRole.entities.EscalationAlert.create({
                    terminal_id,
                    terminal_nome: terminal.nome,
                    local: terminal.local || '',
                    cliente: terminal.cliente_nome || '',
                    owner_email: ownerEmail,
                    offline_desde: agora,
                    escalado: false,
                    resolvido: false,
                    notificacao_inicial_enviada: false,
                });
                // Notificação push
                await base44.asServiceRole.functions.invoke('pushNotify', {
                    action: 'notify_offline',
                    terminal_id,
                    terminal_nome: terminal.nome,
                    local: terminal.local || '',
                    cliente: terminal.cliente_nome || '',
                    owner_email: terminal.created_by || '',
                }).catch(() => {});

            } else if (statusEfetivo === 'online') {
                // Resolver incidentes abertos com duração calculada
                const incidentes = await base44.asServiceRole.entities.AlertIncident.filter({
                    terminal_id, resolvido: false,
                }).catch(() => []);
                for (const inc of incidentes) {
                    const duracao = Math.round((Date.now() - new Date(inc.timestamp).getTime()) / 60000);
                    await base44.asServiceRole.entities.AlertIncident.update(inc.id, {
                        resolvido: true,
                        resolvido_em: agora,
                        duracao_minutos: duracao,
                    });
                }
                // Resolver EscalationAlerts
                const escalations = await base44.asServiceRole.entities.EscalationAlert.filter({
                    terminal_id, resolvido: false,
                }).catch(() => []);
                for (const esc of escalations) {
                    await base44.asServiceRole.entities.EscalationAlert.update(esc.id, { resolvido: true }).catch(() => {});
                }
                // Incidente "restored"
                await base44.asServiceRole.entities.AlertIncident.create({
                    terminal_id,
                    terminal_nome: terminal.nome,
                    local: terminal.local || '',
                    cliente: terminal.cliente_nome || '',
                    tipo: 'restored',
                    timestamp: agora,
                    resolvido: true,
                    notificado: false,
                });
            }
        }

        // Atualizar cache
        if (cache) {
            await base44.asServiceRole.entities.StatusCache.update(cache.id, {
                ultimo_status: statusEfetivo,
                atualizado_em: agora,
            });
        } else {
            await base44.asServiceRole.entities.StatusCache.create({
                terminal_id,
                ultimo_status: statusEfetivo,
                atualizado_em: agora,
            });
        }

        console.log(`[nocServerReport] ${ownerEmail} → "${terminal.nome}" (${terminal.tipo_conexao}) → ${statusValido}`);
        return Response.json({ success: true, terminal: terminal.nome, status: statusValido, mudou: mudouDeEstado });

    } catch (error) {
        console.error('nocServerReport erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});