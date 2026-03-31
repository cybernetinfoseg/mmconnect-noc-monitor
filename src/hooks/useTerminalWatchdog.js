import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

const AGENT_TIMEOUT_SECONDS = 150; // 2.5 minutos sem ping → offline
const WATCHDOG_INTERVAL_MS = 60 * 1000; // corre a cada 1 minuto

/**
 * Watchdog que verifica localmente os terminais e marca como offline
 * aqueles que não enviaram ping há mais de AGENT_TIMEOUT_SECONDS.
 * Substitui a dependência da automação "Monitor All Terminals".
 */
export function useTerminalWatchdog({ currentUser, onUpdate }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!currentUser) return;

    const runWatchdog = async () => {
      try {
        const canSeeAll = currentUser.role === 'admin' || currentUser.role === 'editor';
        const terminals = canSeeAll
          ? await base44.entities.Terminal.list()
          : await base44.entities.Terminal.filter({ created_by: currentUser.email });

        const now = new Date();
        const staleTerminals = terminals.filter(t => {
          if (!t.ativo) return false;
          if (t.tipo_conexao !== 'ip_local' && t.tipo_conexao !== 'api') return false;
          if (!t.ultimo_ping) return t.status === 'online'; // nunca recebeu ping mas está marcado online
          const secondsSinceLastPing = (now - new Date(t.ultimo_ping)) / 1000;
          return secondsSinceLastPing > AGENT_TIMEOUT_SECONDS && t.status === 'online';
        });

        for (const terminal of staleTerminals) {
          await base44.entities.Terminal.update(terminal.id, {
            status: 'offline',
            ultimo_check: now.toISOString(),
          });
        }

        if (staleTerminals.length > 0 && onUpdate) {
          onUpdate();
        }
      } catch (err) {
        console.warn('[Watchdog] Erro ao verificar terminais:', err);
      }
    };

    // Primeira execução imediata
    runWatchdog();

    // Execuções periódicas
    timerRef.current = setInterval(runWatchdog, WATCHDOG_INTERVAL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentUser?.email]);
}