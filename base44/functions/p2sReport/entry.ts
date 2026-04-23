/**
 * p2sReport — Recebe status de terminais P2S do p2s_server.py
 * Tipos geridos: p2s
 * Autenticação: X-Api-Key pessoal
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const apiKey = (req.headers.get('X-Api-Key') || req.headers.get('x-api-key') || '').trim();
        if (!apiKey || apiKey.length < 16) {
            return Response.json({ error: 'API Key ausente ou inválida' }, { status: 401 });
        }

        const allApiKeys = await base44.asServiceRole.entities.ApiKey.filter({ ativo: true });
        const keyRecord = allApiKeys.find(k => k.key === apiKey);
        if (!keyRecord) {
            return Response.json({ error: 'API Key não autorizada' }, { status: 401 });
        }

        const ownerEmail = keyRecord.user_email;
        const body = await req.json();
        const { terminal_id, status, addr, conn_count } = body;

        if (!terminal_id || !status) {
            return Response.json({ error: 'terminal_id e status são obrigatórios' }, { status: 400 });
        }
        if (!['online', 'offline'].includes(status)) {
            return Response.json({ error: "status deve ser 'online' ou 'offline'" }, { status: 400 });
        }

        // Verificar se o dono da key é admin
        const ownerUsers = await base44.asServiceRole.entities.User.filter({ email: ownerEmail });
        const isAdmin = ownerUsers.length > 0 && ownerUsers[0].role === 'admin';

        // Verificar que o terminal existe; admin pode reportar qualquer um
        const terminal = await base44.asServiceRole.entities.Terminal.get(terminal_id).catch(() => null);
        if (!terminal) {
            return Response.json({ error: 'Terminal não encontrado' }, { status: 404 });
        }
        if (!isAdmin && terminal.created_by !== ownerEmail) {
            return Response.json({ error: 'Sem permissão para este terminal' }, { status: 403 });
        }
        if (terminal.tipo_conexao !== 'p2s') {
            return Response.json({ error: `Tipo "${terminal.tipo_conexao}" não é gerido pelo P2S Server` }, { status: 400 });
        }

        const agora = new Date().toISOString();
        const agora_ms = Date.now();

        // Verificar janela de manutenção (comparação temporal correcta)
        const janelasManu = await base44.asServiceRole.entities.MaintenanceWindow.filter({ terminal_id, ativo: true });
        const emManutencao = janelasManu.some(j => {
            const ini = new Date(j.inicio).getTime();
            const fim = new Date(j.fim).getTime();
            return agora_ms >= ini && agora_ms <= fim;
        });

        if (emManutencao && status === 'offline') {
            console.log(`[p2sReport] '${terminal.nome}' em manutenção — ignorado`);
            return Response.json({ success: true, ignored: 'em_manutencao' });
        }

        // Atualizar terminal
        const updateData = {
            status,
            ultimo_check: agora,
            segundos_sem_ping: status === 'online' ? 0 : (terminal.segundos_sem_ping || 0),
            ...(status === 'online' && { ultimo_ping: agora }),
        };
        if (addr) updateData.observacoes = `Última conexão de: ${addr} | Total ligações: ${conn_count || 0}`;
        await base44.asServiceRole.entities.Terminal.update(terminal_id, updateData);

        // Verificar cache de status
        const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id });
        const cache = cacheResults.length > 0 ? cacheResults[0] : null;
        const statusAnterior = cache?.ultimo_status ?? null;
        // Se não há cache anterior, criar incidente apenas se chegar offline (evitar "restored" espúrio)
        const mudouDeEstado = statusAnterior === null
            ? status === 'offline'
            : statusAnterior !== status;

        if (mudouDeEstado) {
            console.log(`[p2sReport] '${terminal.nome}' mudou: ${statusAnterior} → ${status}`);

            // Histórico
            await base44.asServiceRole.entities.StatusHistory.create({
                terminal_id,
                terminal_nome: terminal.nome,
                status,
                timestamp: agora,
                local: terminal.local || '',
                cliente: terminal.cliente_nome || '',
            });

            if (status === 'offline') {
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
                await base44.asServiceRole.functions.invoke('pushNotify', {
                    action: 'notify_offline',
                    terminal_id,
                    terminal_nome: terminal.nome,
                    local: terminal.local || '',
                    cliente: terminal.cliente_nome || '',
                    owner_email: terminal.created_by || '',
                }).catch(() => {});

            } else if (status === 'online') {
                const incidentes = await base44.asServiceRole.entities.AlertIncident.filter({
                    terminal_id, resolvido: false,
                }).catch(() => []);
                for (const inc of incidentes) {
                    const duracao = Math.round((agora_ms - new Date(inc.timestamp).getTime()) / 60000);
                    await base44.asServiceRole.entities.AlertIncident.update(inc.id, {
                        resolvido: true,
                        resolvido_em: agora,
                        duracao_minutos: duracao,
                    });
                }
                const escalations = await base44.asServiceRole.entities.EscalationAlert.filter({
                    terminal_id, resolvido: false,
                }).catch(() => []);
                for (const esc of escalations) {
                    await base44.asServiceRole.entities.EscalationAlert.update(esc.id, { resolvido: true }).catch(() => {});
                }
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
                ultimo_status: status,
                atualizado_em: agora,
            });
        } else {
            await base44.asServiceRole.entities.StatusCache.create({
                terminal_id,
                ultimo_status: status,
                atualizado_em: agora,
            });
        }

        console.log(`[p2sReport] ${ownerEmail} → "${terminal.nome}" → ${status}`);
        return Response.json({ success: true, terminal_nome: terminal.nome, status, mudou: mudouDeEstado });

    } catch (error) {
        console.error('[p2sReport] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});