/**
 * monitorAllTerminals — verifica o status de todos os terminais ativos.
 *
 * Lógica por tipo de conexão:
 *   PASSIVOS (dependem de push externo — verificar apenas timeout do último ping):
 *     - ip_local   → Agente Local (agentReport) — timeout 150s
 *     - heartbeat  → NOC Server TCP heartbeat — timeout 150s
 *     - adms_push  → NOC Server HTTP ADMS — timeout 300s (ciclo mais lento)
 *     - sdk_tcp    → NOC Server polling SDK — timeout 150s
 *     - p2s        → P2S Server (conexão inversa) — timeout 150s
 *     - websocket_cloud → Timmy WS Server — timeout 150s
 *
 *   ATIVOS (sondagem direta via TCP/HTTP):
 *     - ip_publico → TCP direto ao terminal (timeout 7s)
 *     - dns        → TCP direto ao terminal via hostname (timeout 10s — DNS resolve lento)
 *     - api        → HTTP GET ao endpoint configurado (timeout 8s)
 *
 * ANTI-FLAP (debounce):
 *   Terminais ATIVOS só mudam para "offline" após 2 falhas consecutivas.
 *   Uma única falha TCP/DNS transitória NÃO cria incidente — apenas incrementa contador.
 *   Ao recuperar (1 sucesso), o contador é zerado imediatamente.
 *   Isto elimina falsos positivos causados por:
 *     - TTL de DNS expirado momentaneamente
 *     - Latência de rede transitória
 *     - Congestionamento pontual
 *
 * THROTTLE do histórico: só grava StatusHistory quando:
 *   - há mudança de status confirmada, OU
 *   - passou mais de 1 hora desde o último registo
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Timeout para terminais passivos (segundos sem ping → offline)
const PASSIVE_TIMEOUT = {
    ip_local:         150,  // agente reporta a cada 30s → 5× margem
    heartbeat:        150,  // noc_server heartbeat TCP
    sdk_tcp:          150,  // noc_server SDK polling
    p2s:              150,  // p2s_server conexão inversa
    adms_push:        300,  // ADMS ciclo mais lento (pode ser até 2min)
    websocket_cloud:  150,  // timmy_ws_server reporta via WS heartbeat
};

// Timeout de sondagem TCP/HTTP por tipo ativo (ms)
const ACTIVE_TIMEOUT = {
    ip_publico: 7000,   // IP direto — mais rápido
    dns:        10000,  // DNS/No-IP — resolução DNS pode demorar
    api:        8000,   // HTTP API endpoint
};

// Número de falhas consecutivas necessárias para confirmar offline (anti-flap)
const OFFLINE_CONFIRM_THRESHOLD = 2;

const PASSIVE_TYPES = new Set(['ip_local', 'heartbeat', 'adms_push', 'sdk_tcp', 'p2s', 'websocket_cloud']);
const ACTIVE_TYPES  = new Set(['ip_publico', 'dns', 'api']);

const HISTORY_THROTTLE_SECONDS = 3600;

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const isAuthenticated = await base44.auth.isAuthenticated();
        if (isAuthenticated) {
            const user = await base44.auth.me();
            if (user?.role !== 'admin') {
                return Response.json({ error: 'Forbidden: acesso apenas para administradores' }, { status: 403 });
            }
        }

        const terminals = await base44.asServiceRole.entities.Terminal.filter({ ativo: true });
        const agora = new Date();
        const results = [];

        const chunkSize = 10;
        for (let i = 0; i < terminals.length; i += chunkSize) {
            const chunk = terminals.slice(i, i + chunkSize);
            const chunkResults = await Promise.all(chunk.map(async (terminal) => {
                try {
                    const tipo = terminal.tipo_conexao;
                    const cacheResults = await base44.asServiceRole.entities.StatusCache.filter({ terminal_id: terminal.id });
                    const cache = cacheResults[0] || null;
                    const statusAnterior = cache?.ultimo_status || null;
                    // falhas_consecutivas armazenado no campo observacoes do cache (reutilizado como JSON)
                    let falhasConsecutivas = 0;
                    try {
                        const extra = cache?.falhas_consecutivas ? parseInt(cache.falhas_consecutivas) : 0;
                        falhasConsecutivas = isNaN(extra) ? 0 : extra;
                    } catch {}

                    let novoStatus;
                    let latencia_ms = null;
                    let timestampOffline = agora;
                    let checkOnline = null; // resultado bruto da sondagem (só ativos)

                    if (PASSIVE_TYPES.has(tipo)) {
                        // ── PASSIVO: verificar timeout do último ping ──────────────
                        const timeoutSec = PASSIVE_TIMEOUT[tipo] || 150;
                        if (terminal.ultimo_ping) {
                            const ultimoPing = new Date(terminal.ultimo_ping);
                            const segundosSemPing = Math.floor((agora - ultimoPing) / 1000);
                            novoStatus = segundosSemPing > timeoutSec ? 'offline' : 'online';
                            if (novoStatus === 'offline') {
                                const calculado = new Date(ultimoPing.getTime() + timeoutSec * 1000);
                                timestampOffline = calculado < agora ? calculado : agora;
                            }
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                status: novoStatus,
                                segundos_sem_ping: segundosSemPing,
                                ultimo_check: agora.toISOString(),
                            });
                        } else {
                            novoStatus = 'offline';
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                status: 'offline',
                                ultimo_check: agora.toISOString(),
                            });
                        }

                    } else if (ACTIVE_TYPES.has(tipo)) {
                        // ── ATIVO: sondagem direta TCP/HTTP com anti-flap ──────────
                        const timeout = ACTIVE_TIMEOUT[tipo] || 8000;
                        const checkResult = await checkTerminalActive(terminal, timeout);
                        checkOnline = checkResult.online;
                        latencia_ms = checkResult.latencia_ms || null;

                        if (checkOnline) {
                            // Sucesso → online imediato, zera contador de falhas
                            novoStatus = 'online';
                            falhasConsecutivas = 0;
                            await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                status: 'online',
                                latencia_ms,
                                ultimo_check: agora.toISOString(),
                                ultimo_ping: agora.toISOString(),
                            });
                        } else {
                            // Falha → incrementar contador; só confirmar offline após threshold
                            falhasConsecutivas += 1;
                            console.log(`[monitorAllTerminals] ${terminal.nome} (${tipo}) falha ${falhasConsecutivas}/${OFFLINE_CONFIRM_THRESHOLD}`);

                            if (falhasConsecutivas >= OFFLINE_CONFIRM_THRESHOLD) {
                                // Offline confirmado
                                novoStatus = 'offline';
                                await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                    status: 'offline',
                                    latencia_ms: null,
                                    ultimo_check: agora.toISOString(),
                                });
                            } else {
                                // Ainda não confirmado — manter status atual, não criar incidente
                                novoStatus = statusAnterior || terminal.status || 'offline';
                                await base44.asServiceRole.entities.Terminal.update(terminal.id, {
                                    ultimo_check: agora.toISOString(),
                                });
                                // Actualizar cache com novo contador mas sem mudar status
                                if (cache) {
                                    await base44.asServiceRole.entities.StatusCache.update(cache.id, {
                                        ultimo_status: novoStatus,
                                        atualizado_em: agora.toISOString(),
                                        falhas_consecutivas: falhasConsecutivas,
                                    });
                                } else {
                                    await base44.asServiceRole.entities.StatusCache.create({
                                        terminal_id: terminal.id,
                                        ultimo_status: novoStatus,
                                        atualizado_em: agora.toISOString(),
                                        falhas_consecutivas: falhasConsecutivas,
                                    });
                                }
                                return { terminal_id: terminal.id, terminal_nome: terminal.nome, tipo, success: true, status: novoStatus, statusMudou: false, pending_fail: falhasConsecutivas };
                            }
                        }
                    } else {
                        console.warn(`[monitorAllTerminals] tipo desconhecido: ${tipo} (terminal: ${terminal.nome})`);
                        return { terminal_id: terminal.id, terminal_nome: terminal.nome, tipo, success: true, status: terminal.status, statusMudou: false, skipped: true };
                    }

                    const statusMudou = statusAnterior !== novoStatus;

                    // Actualizar cache (incluindo reset de falhas_consecutivas)
                    if (cache) {
                        await base44.asServiceRole.entities.StatusCache.update(cache.id, {
                            ultimo_status: novoStatus,
                            atualizado_em: agora.toISOString(),
                            falhas_consecutivas: checkOnline === false ? falhasConsecutivas : 0,
                        });
                    } else {
                        await base44.asServiceRole.entities.StatusCache.create({
                            terminal_id: terminal.id,
                            ultimo_status: novoStatus,
                            atualizado_em: agora.toISOString(),
                            falhas_consecutivas: checkOnline === false ? falhasConsecutivas : 0,
                        });
                    }

                    // Criar incidente e EscalationAlert se transitou → offline (confirmado)
                    if (statusMudou && novoStatus === 'offline') {
                        await base44.asServiceRole.entities.AlertIncident.create({
                            terminal_id: terminal.id,
                            terminal_nome: terminal.nome,
                            local: terminal.local || '',
                            cliente: terminal.cliente_nome || '',
                            tipo: 'offline',
                            timestamp: timestampOffline.toISOString(),
                            resolvido: false,
                            notificado: false,
                        });

                        await base44.asServiceRole.entities.EscalationAlert.create({
                            terminal_id: terminal.id,
                            terminal_nome: terminal.nome,
                            local: terminal.local || '',
                            cliente: terminal.cliente_nome || '',
                            owner_email: terminal.created_by || '',
                            offline_desde: timestampOffline.toISOString(),
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
                        const [openIncidents, openEscalations] = await Promise.all([
                            base44.asServiceRole.entities.AlertIncident.filter({ terminal_id: terminal.id, resolvido: false }).catch(() => []),
                            base44.asServiceRole.entities.EscalationAlert.filter({ terminal_id: terminal.id, resolvido: false }).catch(() => []),
                        ]);
                        for (const inc of openIncidents) {
                            const duracao = Math.round((agora - new Date(inc.timestamp)) / 60000);
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

                    // THROTTLE histórico
                    const ultimoCheck = terminal.ultimo_check ? new Date(terminal.ultimo_check) : null;
                    const segundosDesdeUltimoCheck = ultimoCheck
                        ? Math.floor((agora - ultimoCheck) / 1000)
                        : HISTORY_THROTTLE_SECONDS + 1;

                    if (statusMudou || segundosDesdeUltimoCheck >= HISTORY_THROTTLE_SECONDS) {
                        const tsHistorico = (statusMudou && novoStatus === 'offline') ? timestampOffline : agora;
                        await base44.asServiceRole.entities.StatusHistory.create({
                            terminal_id: terminal.id,
                            terminal_nome: terminal.nome,
                            status: novoStatus,
                            timestamp: tsHistorico.toISOString(),
                            local: terminal.local || '',
                            cliente: terminal.cliente_nome || '',
                        }).catch(() => {});
                    }

                    return { terminal_id: terminal.id, terminal_nome: terminal.nome, tipo, success: true, status: novoStatus, statusMudou };
                } catch (error) {
                    return { terminal_id: terminal.id, terminal_nome: terminal.nome, success: false, error: error.message };
                }
            }));
            results.push(...chunkResults);
        }

        return Response.json({
            success: true,
            total: terminals.length,
            monitored: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            statusChanged: results.filter(r => r.statusMudou).length,
            results,
        });

    } catch (error) {
        console.error('Erro monitorAllTerminals:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});

/**
 * Sondagem ativa por TCP (principal) + HTTP (fallback apenas para api).
 * DNS/No-IP: usa timeout maior para acomodar resolução DNS lenta.
 * ip_publico: TCP direto, sem HTTP fallback (terminais biométricos não têm HTTP).
 */
async function checkTerminalActive(terminal, timeoutMs) {
    const porta = terminal.porta || 5005;
    const inicio = Date.now();

    try {
        // API → HTTP puro
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

        // ip_publico / dns → TCP puro (terminais biométricos não respondem HTTP)
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