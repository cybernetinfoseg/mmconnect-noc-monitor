import React, { useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Wifi,
  WifiOff,
  MapPin,
  Server,
  Clock,
  Activity,
  AlertTriangle,
  CheckCircle,
  Network,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import moment from 'moment';
import StatusBadge from '../dashboard/StatusBadge';

const formatTimeSince = (seconds) => {
  if (!seconds || seconds < 0) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
};

const InfoRow = ({ icon: Icon, label, value, mono }) => (
  <div className="flex items-center gap-3 py-2.5 border-b border-slate-700/40 last:border-0">
    <Icon className="h-4 w-4 text-slate-400 shrink-0" />
    <span className="text-sm text-slate-400 w-32 shrink-0">{label}</span>
    <span className={cn("text-sm text-white truncate", mono && "font-mono text-emerald-300")}>
      {value || '—'}
    </span>
  </div>
);

export default function TerminalDetailModal({ terminal, onClose }) {
  const { data: history = [] } = useQuery({
    queryKey: ['terminal-history', terminal.id],
    queryFn: () => base44.entities.StatusHistory.filter(
      { terminal_id: terminal.id },
      '-created_date',
      50
    ),
    enabled: !!terminal.id,
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['terminal-incidents', terminal.id],
    queryFn: () => base44.entities.AlertIncident.filter(
      { terminal_id: terminal.id },
      '-created_date',
      20
    ),
    enabled: !!terminal.id,
  });

  const connectionInfo = useMemo(() => {
    const tipo = terminal.tipo_conexao;
    const entries = [];
    if (tipo === 'ip_local' && terminal.ip_local) entries.push({ label: 'IP Local', value: terminal.ip_local });
    if (tipo === 'ip_publico' && terminal.ip_publico) entries.push({ label: 'IP Público', value: terminal.ip_publico });
    if (tipo === 'dns' && terminal.dns) entries.push({ label: 'DNS/Hostname', value: terminal.dns });
    if (tipo === 'api' && terminal.api_endpoint) entries.push({ label: 'API Endpoint', value: terminal.api_endpoint });
    if (terminal.porta) entries.push({ label: 'Porta', value: String(terminal.porta) });
    return entries;
  }, [terminal]);

  const uptimePercent = useMemo(() => {
    if (history.length === 0) return null;
    const online = history.filter(h => h.status === 'online').length;
    return ((online / history.length) * 100).toFixed(1);
  }, [history]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

        <motion.div
          className="relative w-full sm:max-w-2xl max-h-[90vh] sm:max-h-[85vh] bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
          initial={{ y: 60, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 60, opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className={cn(
            "px-5 py-4 flex items-center justify-between border-b border-slate-700",
            terminal.status === 'offline' ? "bg-red-900/30" : "bg-slate-800/60"
          )}>
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn(
                "p-2 rounded-xl shrink-0",
                terminal.status === 'offline' ? "bg-red-500/20" : "bg-emerald-500/20"
              )}>
                {terminal.status === 'offline'
                  ? <WifiOff className="h-5 w-5 text-red-400" />
                  : <Wifi className="h-5 w-5 text-emerald-400" />
                }
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-white truncate">{terminal.nome}</h2>
                <p className="text-xs text-slate-400 truncate">{terminal.local}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={terminal.status} pulse />
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 p-5 space-y-5">

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Último Ping</p>
                <p className={cn(
                  "text-xl font-bold font-mono",
                  terminal.status === 'offline' ? "text-red-400" : "text-emerald-400"
                )}>
                  {formatTimeSince(terminal.segundos_sem_ping)}
                </p>
              </div>
              <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Latência</p>
                <p className="text-xl font-bold font-mono text-blue-400">
                  {terminal.latencia_ms != null ? `${terminal.latencia_ms}ms` : '—'}
                </p>
              </div>
              <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Uptime</p>
                <p className={cn(
                  "text-xl font-bold font-mono",
                  uptimePercent >= 99 ? "text-emerald-400" :
                  uptimePercent >= 95 ? "text-yellow-400" : "text-red-400"
                )}>
                  {uptimePercent != null ? `${uptimePercent}%` : '—'}
                </p>
              </div>
            </div>

            {/* Info */}
            <div className="bg-slate-800/40 rounded-xl px-4 py-1">
              <InfoRow icon={MapPin} label="Local" value={terminal.local} />
              <InfoRow icon={Network} label="Tipo Conexão" value={terminal.tipo_conexao?.replace('_', ' ').toUpperCase()} />
              {connectionInfo.map(({ label, value }) => (
                <InfoRow key={label} icon={Server} label={label} value={value} mono />
              ))}
              {terminal.ultimo_ping && (
                <InfoRow icon={Clock} label="Último Ping" value={moment(terminal.ultimo_ping).format('DD/MM/YY HH:mm:ss')} mono />
              )}
              {terminal.observacoes && (
                <InfoRow icon={FileText} label="Observações" value={terminal.observacoes} />
              )}
            </div>

            {/* Recent Incidents */}
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
                Incidentes Recentes
              </h3>
              {incidents.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 rounded-xl px-4 py-3">
                  <CheckCircle className="h-4 w-4" />
                  Nenhum incidente registado
                </div>
              ) : (
                <div className="space-y-2">
                  {incidents.slice(0, 5).map((inc) => (
                    <div key={inc.id} className={cn(
                      "flex items-center justify-between px-4 py-2.5 rounded-xl text-sm",
                      inc.tipo === 'offline' ? "bg-red-500/10 border border-red-500/20" : "bg-emerald-500/10 border border-emerald-500/20"
                    )}>
                      <div className="flex items-center gap-2">
                        {inc.tipo === 'offline'
                          ? <WifiOff className="h-4 w-4 text-red-400 shrink-0" />
                          : <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                        }
                        <span className={cn("font-medium", inc.tipo === 'offline' ? "text-red-300" : "text-emerald-300")}>
                          {inc.tipo === 'offline' ? 'Ficou offline' : 'Restaurado'}
                        </span>
                        {inc.duracao_minutos && (
                          <span className="text-slate-400 text-xs">({inc.duracao_minutos}min)</span>
                        )}
                      </div>
                      <span className="text-slate-400 text-xs font-mono">
                        {moment(inc.timestamp).format('DD/MM HH:mm')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Status History Log */}
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-blue-400" />
                Log de Status ({history.length} registos)
              </h3>
              {history.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">Sem histórico disponível</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {history.slice(0, 30).map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-slate-800/40">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          h.status === 'online' ? "bg-emerald-400" : "bg-red-400"
                        )} />
                        <span className={h.status === 'online' ? "text-emerald-400" : "text-red-400"}>
                          {h.status.toUpperCase()}
                        </span>
                      </div>
                      <span className="text-slate-500 font-mono">
                        {moment(h.timestamp).format('DD/MM/YY HH:mm:ss')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}