/**
 * monitorTerminal — monitoramento ativo via HTTP/TCP para terminais não-locais.
 * Usado apenas para terminais com tipo_conexao != 'ip_local'.
 * Terminais ip_local dependem exclusivamente do Agente Local (agentReport).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

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

        const { terminal_id } = await req.json().catch(() => ({}));
        if (!terminal_id) {
            return Response.json({ error: 'terminal_id obrigatório' }, { status: 400 });
        }

        const terminal = await base44.asServiceRole.entities.Terminal.get(terminal_id);
        if (!terminal) {
            return Response.json({ error: 'Terminal não encontrado' }, { status: 404 });
        }

        // Terminais ip_local dependem do agente — não monitorar activamente aqui
        if (terminal.tipo_conexao === 'ip_local') {
            return Response.json({ error: 'Terminais ip_local são monitorizados pelo Agente Local' }, { status: 400 });
        }

        const result = await checkTerminal(terminal);
        const agora = new Date();
        const novoStatus = result.online ? 'online' : 'offline';

        // Buscar status anterior
        const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id: terminal.id });
        const cache = cacheResults[0] || null;
        const statusAnterior = cache?.ultimo_status || null;
        const statusMudou = statusAnterior !== novoStatus;

        // Actualizar terminal
        await base44.asServiceRole.entities.Terminal.update(terminal.id, {
            status: novoStatus,
            latencia_ms: result.latencia_ms || null,
            ultimo_check: agora.toISOString(),
            ultimo_ping: result.online ? agora.toISOString() : terminal.ultimo_ping,
        });

        // Actualizar cache
        if (cache) {
            await base44.asServiceRole.entities.StatusCache.update(cache.id, {
                ultimo_status: novoStatus,
                atualizado_em: agora.toISOString(),
            });
        } else {
            await base44.asServiceRole.entities.StatusCache.create({
                terminal_id: terminal.id,
                ultimo_status: novoStatus,
                atualizado_em: agora.toISOString(),
            });
        }

        // Criar incidente se mudou para offline
        if (statusMudou && novoStatus === 'offline') {
            await base44.asServiceRole.entities.AlertIncident.create({
                terminal_id: terminal.id,
                terminal_nome: terminal.nome,
                local: terminal.local,
                cliente: terminal.cliente_nome,
                tipo: 'offline',
                timestamp: agora.toISOString(),
                resolvido: false,
                notificado: false,
            });
            await base44.asServiceRole.functions.invoke('pushNotify', {
                action: 'notify_offline',
                terminal_id: terminal.id,
                terminal_nome: terminal.nome,
                local: terminal.local || '',
                cliente: terminal.cliente_nome || '',
                owner_email: terminal.created_by || '',
            }).catch(() => {});
        }

        // Resolver escalações se voltou online
        if (novoStatus === 'online') {
            const openAlerts = await base44.asServiceRole.entities.EscalationAlert.filter({
                terminal_id: terminal.id,
                resolvido: false,
            }).catch(() => []);
            for (const alert of openAlerts) {
                await base44.asServiceRole.entities.EscalationAlert.update(alert.id, { resolvido: true }).catch(() => {});
            }
        }

        // Gravar histórico
        await base44.asServiceRole.entities.StatusHistory.create({
            terminal_id: terminal.id,
            terminal_nome: terminal.nome,
            status: novoStatus,
            timestamp: agora.toISOString(),
            local: terminal.local || '',
            cliente: terminal.cliente_nome || '',
        }).catch(() => {});

        return Response.json({ success: true, terminal_id, status: novoStatus, latencia_ms: result.latencia_ms, statusMudou });
    } catch (error) {
        console.error('Erro monitorTerminal:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});

async function checkTerminal(terminal) {
    const porta = terminal.porta || 5005;
    const timeout = 5000;
    const inicio = Date.now();

    try {
        if (terminal.tipo_conexao === 'api' && terminal.api_endpoint) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            try {
                const res = await fetch(terminal.api_endpoint, { signal: controller.signal });
                clearTimeout(timer);
                return { online: res.ok || res.status < 500, latencia_ms: Date.now() - inicio };
            } catch {
                clearTimeout(timer);
                return { online: false };
            }
        }

        // ip_publico ou dns → HTTP probe
        const host = terminal.tipo_conexao === 'ip_publico' ? terminal.ip_publico :
                     terminal.tipo_conexao === 'dns' ? terminal.dns : null;

        if (!host) return { online: false };

        // TCP primeiro
        try {
            const conn = await Promise.race([
                Deno.connect({ hostname: host, port: Number(porta) }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('tcp_timeout')), timeout))
            ]);
            conn.close();
            return { online: true, latencia_ms: Date.now() - inicio };
        } catch {}

        // Fallback HTTP
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            await fetch(`http://${host}:${porta}`, { signal: controller.signal });
            clearTimeout(timer);
            return { online: true, latencia_ms: Date.now() - inicio };
        } catch {
            return { online: false };
        }
    } catch {
        return { online: false };
    }
}