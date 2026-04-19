/**
 * monitorTerminal — verificação manual/pontual de terminal via TCP/HTTP.
 *
 * Apenas terminais ATIVOS (ip_publico, dns, api) podem ser sondados diretamente.
 * Terminais PASSIVOS dependem de push externo:
 *   - ip_local   → Agente Local (agentReport)
 *   - heartbeat  → NOC Server
 *   - adms_push  → NOC Server
 *   - sdk_tcp    → NOC Server
 *   - p2s        → P2S Server
 *   - websocket_cloud → Timmy WS Server
 *
 * NOTA: verificação manual não aplica debounce (é ação explícita do utilizador).
 * Timeout por tipo:
 *   ip_publico → 7s (TCP direto)
 *   dns        → 10s (resolução DNS pode ser lenta)
 *   api        → 8s (HTTP endpoint)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PASSIVE_TYPES = ['ip_local', 'heartbeat', 'adms_push', 'sdk_tcp', 'p2s', 'websocket_cloud'];

const ACTIVE_TIMEOUT = {
    ip_publico: 7000,
    dns:        10000,
    api:        8000,
};

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const terminal_id = body.terminal_id || body.terminalId;
        if (!terminal_id) {
            return Response.json({ error: 'terminal_id obrigatório' }, { status: 400 });
        }

        const terminal = await base44.asServiceRole.entities.Terminal.get(terminal_id);
        if (!terminal) {
            return Response.json({ error: 'Terminal não encontrado' }, { status: 404 });
        }

        if (user.role !== 'admin' && terminal.created_by !== user.email) {
            return Response.json({ error: 'Forbidden: não é dono deste terminal' }, { status: 403 });
        }

        if (PASSIVE_TYPES.includes(terminal.tipo_conexao)) {
            const agente = terminal.tipo_conexao === 'ip_local' ? 'Agente Local' :
                           terminal.tipo_conexao === 'p2s' ? 'P2S Server' :
                           terminal.tipo_conexao === 'websocket_cloud' ? 'Timmy WS Server' : 'NOC Server';
            return Response.json({
                error: `Terminais do tipo "${terminal.tipo_conexao}" são monitorizados pelo ${agente} (push) — não é possível sondagem direta.`
            }, { status: 400 });
        }

        const timeout = ACTIVE_TIMEOUT[terminal.tipo_conexao] || 8000;
        const result = await checkTerminal(terminal, timeout);
        const agora = new Date();
        const novoStatus = result.online ? 'online' : 'offline';

        // Buscar status anterior e resetar contador de falhas (ação manual)
        const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id: terminal.id });
        const cache = cacheResults[0] || null;
        const statusAnterior = cache?.ultimo_status || null;
        const statusMudou = statusAnterior !== novoStatus;

        // Actualizar terminal
        await base44.asServiceRole.entities.Terminal.update(terminal.id, {
            status: novoStatus,
            latencia_ms: result.latencia_ms || null,
            ultimo_check: agora.toISOString(),
            ...(result.online ? { ultimo_ping: agora.toISOString() } : {}),
        });

        // Actualizar cache — reset de falhas_consecutivas (verificação manual é definitiva)
        if (cache) {
            await base44.asServiceRole.entities.StatusCache.update(cache.id, {
                ultimo_status: novoStatus,
                atualizado_em: agora.toISOString(),
                falhas_consecutivas: 0,
            });
        } else {
            await base44.asServiceRole.entities.StatusCache.create({
                terminal_id: terminal.id,
                ultimo_status: novoStatus,
                atualizado_em: agora.toISOString(),
                falhas_consecutivas: 0,
            });
        }

        // Criar incidente se mudou para offline
        if (statusMudou && novoStatus === 'offline') {
            await base44.asServiceRole.entities.AlertIncident.create({
                terminal_id: terminal.id,
                terminal_nome: terminal.nome,
                local: terminal.local || '',
                cliente: terminal.cliente_nome || '',
                tipo: 'offline',
                timestamp: agora.toISOString(),
                resolvido: false,
                notificado: false,
            });
            await base44.asServiceRole.entities.EscalationAlert.create({
                terminal_id: terminal.id,
                terminal_nome: terminal.nome,
                local: terminal.local || '',
                cliente: terminal.cliente_nome || '',
                owner_email: terminal.created_by || '',
                offline_desde: agora.toISOString(),
                escalado: false,
                resolvido: false,
                notificacao_inicial_enviada: false,
            }).catch(() => {});
            await base44.asServiceRole.functions.invoke('pushNotify', {
                action: 'notify_offline',
                terminal_id: terminal.id,
                terminal_nome: terminal.nome,
                local: terminal.local || '',
                cliente: terminal.cliente_nome || '',
                owner_email: terminal.created_by || '',
            }).catch(() => {});
        }

        // Resolver incidentes e escalações se voltou online
        if (statusMudou && novoStatus === 'online') {
            const [incidentes, openEscalations] = await Promise.all([
                base44.asServiceRole.entities.AlertIncident.filter({ terminal_id: terminal.id, resolvido: false }).catch(() => []),
                base44.asServiceRole.entities.EscalationAlert.filter({ terminal_id: terminal.id, resolvido: false }).catch(() => []),
            ]);
            for (const inc of incidentes) {
                const duracao = Math.round((agora.getTime() - new Date(inc.timestamp).getTime()) / 60000);
                await base44.asServiceRole.entities.AlertIncident.update(inc.id, {
                    resolvido: true, resolvido_em: agora.toISOString(), duracao_minutos: duracao,
                }).catch(() => {});
            }
            for (const esc of openEscalations) {
                await base44.asServiceRole.entities.EscalationAlert.update(esc.id, { resolvido: true }).catch(() => {});
            }
            await base44.asServiceRole.entities.AlertIncident.create({
                terminal_id: terminal.id,
                terminal_nome: terminal.nome,
                local: terminal.local || '',
                cliente: terminal.cliente_nome || '',
                tipo: 'restored',
                timestamp: agora.toISOString(),
                resolvido: true,
                notificado: false,
            }).catch(() => {});
        }

        // Gravar histórico em mudanças de estado
        if (statusMudou) {
            await base44.asServiceRole.entities.StatusHistory.create({
                terminal_id: terminal.id,
                terminal_nome: terminal.nome,
                status: novoStatus,
                timestamp: agora.toISOString(),
                local: terminal.local || '',
                cliente: terminal.cliente_nome || '',
            }).catch(() => {});
        }

        return Response.json({ success: true, terminal_id, status: novoStatus, latencia_ms: result.latencia_ms, statusMudou });
    } catch (error) {
        console.error('Erro monitorTerminal:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});

/**
 * Sondagem TCP pura para ip_publico/dns, HTTP para api.
 * Sem fallback HTTP para ip_publico/dns — terminais biométricos não têm HTTP.
 */
async function checkTerminal(terminal, timeoutMs) {
    const porta = terminal.porta || 5005;
    const inicio = Date.now();

    try {
        if (terminal.tipo_conexao === 'api' && terminal.api_endpoint) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await fetch(terminal.api_endpoint, { signal: controller.signal });
                clearTimeout(timer);
                return { online: res.ok || res.status < 500, latencia_ms: Date.now() - inicio };
            } catch {
                clearTimeout(timer);
                return { online: false };
            }
        }

        const host = terminal.tipo_conexao === 'ip_publico' ? terminal.ip_publico :
                     terminal.tipo_conexao === 'dns' ? terminal.dns : null;

        if (!host || host.trim() === '') return { online: false };

        try {
            const conn = await Promise.race([
                Deno.connect({ hostname: host.trim(), port: Number(porta) }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('tcp_timeout')), timeoutMs))
            ]);
            conn.close();
            return { online: true, latencia_ms: Date.now() - inicio };
        } catch {
            return { online: false };
        }
    } catch {
        return { online: false };
    }
}