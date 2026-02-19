import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, MapPin, Building2, Clock, AlertTriangle, Zap } from 'lucide-react';
import StatusBadge from './StatusBadge';
import MonitorStatus from './MonitorStatus';
import { cn } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import moment from 'moment';

export default function TerminalsTable({ terminals, maxRows = 15, compact = false }) {
  const queryClient = useQueryClient();
  const [pingingId, setPingingId] = useState(null);

  const handlePing = async (e, terminal) => {
    e.stopPropagation();
    if (pingingId) return;
    setPingingId(terminal.id);
    try {
      await base44.functions.invoke('monitorTerminal', { terminalId: terminal.id });
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
    } finally {
      setPingingId(null);
    }
  };
  const sortedTerminals = [...terminals].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'offline' ? -1 : 1;
    }
    return (b.segundos_sem_ping || 0) - (a.segundos_sem_ping || 0);
  });

  const displayTerminals = maxRows ? sortedTerminals.slice(0, maxRows) : sortedTerminals;

  const formatTimeSince = (seconds) => {
    if (!seconds || seconds < 0) return '—';
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/50 bg-white/80 backdrop-blur-sm">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className={cn(
                "text-left font-semibold text-slate-600 uppercase tracking-wider",
                compact ? "px-4 py-3 text-xs" : "px-6 py-4 text-xs"
              )}>
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4" />
                  Terminal
                </div>
              </th>
              <th className={cn(
                "text-left font-semibold text-slate-600 uppercase tracking-wider",
                compact ? "px-4 py-3 text-xs" : "px-6 py-4 text-xs"
              )}>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Local
                </div>
              </th>
              <th className={cn(
                "text-left font-semibold text-slate-600 uppercase tracking-wider",
                compact ? "px-4 py-3 text-xs" : "px-6 py-4 text-xs"
              )}>
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Cliente
                </div>
              </th>
              <th className={cn(
                "text-center font-semibold text-slate-600 uppercase tracking-wider",
                compact ? "px-4 py-3 text-xs" : "px-6 py-4 text-xs"
              )}>
                Status
              </th>
              <th className={cn(
                "text-left font-semibold text-slate-600 uppercase tracking-wider",
                compact ? "px-4 py-3 text-xs" : "px-6 py-4 text-xs"
              )}>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Último Ping
                </div>
              </th>
              <th className={cn(
                "text-right font-semibold text-slate-600 uppercase tracking-wider",
                compact ? "px-4 py-3 text-xs" : "px-6 py-4 text-xs"
              )}>
                <div className="flex items-center gap-2 justify-end">
                  <AlertTriangle className="h-4 w-4" />
                  Sem Ping
                </div>
              </th>
              <th className={cn(
                "text-center font-semibold text-slate-600 uppercase tracking-wider",
                compact ? "px-4 py-3 text-xs" : "px-6 py-4 text-xs"
              )}>
                Ação
              </th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence mode="popLayout">
              {displayTerminals.map((terminal, index) => (
                <motion.tr
                  key={terminal.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: index * 0.02 }}
                  className={cn(
                    "border-b border-slate-50 transition-colors",
                    terminal.status === 'offline' && "bg-red-50/30",
                    "hover:bg-slate-50/50"
                  )}
                >
                  <td className={cn(
                    "font-medium text-slate-900",
                    compact ? "px-4 py-3 text-sm" : "px-6 py-4"
                  )}>
                    {terminal.nome}
                  </td>
                  <td className={cn(
                    "text-slate-600",
                    compact ? "px-4 py-3 text-sm" : "px-6 py-4"
                  )}>
                    {terminal.local}
                  </td>
                  <td className={cn(
                    "text-slate-600",
                    compact ? "px-4 py-3 text-sm" : "px-6 py-4"
                  )}>
                    {terminal.cliente}
                  </td>
                  <td className={cn(
                    compact ? "px-4 py-3" : "px-6 py-4"
                  )}>
                    <MonitorStatus terminal={terminal} />
                  </td>
                  <td className={cn(
                    "text-slate-500",
                    compact ? "px-4 py-3 text-sm" : "px-6 py-4"
                  )}>
                    {terminal.ultimo_ping 
                      ? moment(terminal.ultimo_ping).format('DD/MM HH:mm:ss')
                      : '—'
                    }
                  </td>
                  <td className={cn(
                    "text-right font-mono",
                    compact ? "px-4 py-3 text-sm" : "px-6 py-4",
                    terminal.status === 'offline' ? 'text-red-600 font-semibold' : 'text-slate-500'
                  )}>
                    {formatTimeSince(terminal.segundos_sem_ping)}
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
      
      {terminals.length > maxRows && (
        <div className="px-6 py-3 text-center text-sm text-slate-500 bg-slate-50/50 border-t border-slate-100">
          Exibindo {maxRows} de {terminals.length} terminais
        </div>
      )}
    </div>
  );
}