import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Monitor, Wifi, WifiOff } from 'lucide-react';
import StatusBadge from '../dashboard/StatusBadge';
import { cn } from '@/lib/utils';
import moment from 'moment';

export default function ClienteTerminaisModal({ cliente, onClose }) {
  const { data: terminals = [], isLoading } = useQuery({
    queryKey: ['terminals-cliente', cliente?.id],
    queryFn: () => base44.entities.Terminal.filter({ cliente_id: cliente.id }),
    enabled: !!cliente,
    refetchInterval: 10000,
  });

  // Fallback: buscar por nome caso cliente_id não esteja populado
  const { data: terminalsByNome = [] } = useQuery({
    queryKey: ['terminals-cliente-nome', cliente?.nome],
    queryFn: () => base44.entities.Terminal.list(),
    enabled: !!cliente && terminals.length === 0 && !isLoading,
    select: (all) => all.filter(t => t.cliente_nome === cliente.nome || t.cliente === cliente.nome),
  });

  const allTerminals = terminals.length > 0 ? terminals : terminalsByNome;

  const online = allTerminals.filter(t => t.status === 'online').length;
  const offline = allTerminals.filter(t => t.status === 'offline').length;

  const formatTimeSince = (seconds) => {
    if (!seconds || seconds < 0) return '—';
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  return (
    <Dialog open={!!cliente} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-purple-600" />
            Terminais — {cliente?.nome}
          </DialogTitle>
        </DialogHeader>

        {/* KPIs */}
        <div className="flex gap-4 py-2">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg">
            <Monitor className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-semibold text-slate-700">{allTerminals.length} total</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 rounded-lg">
            <Wifi className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-semibold text-emerald-700">{online} online</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 rounded-lg">
            <WifiOff className="h-4 w-4 text-red-500" />
            <span className="text-sm font-semibold text-red-700">{offline} offline</span>
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <p className="text-center text-slate-400 py-8">Carregando...</p>
          ) : allTerminals.length === 0 ? (
            <p className="text-center text-slate-400 py-8">Nenhum terminal encontrado para este cliente</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Terminal</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Local</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Status</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Sem Ping</th>
                </tr>
              </thead>
              <tbody>
                {[...allTerminals]
                  .sort((a, b) => (a.status === 'offline' ? -1 : 1))
                  .map(terminal => (
                  <tr key={terminal.id} className={cn(
                    "border-b border-slate-50",
                    terminal.status === 'offline' ? 'bg-red-50/40' : 'hover:bg-slate-50'
                  )}>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{terminal.nome}</td>
                    <td className="px-3 py-2.5 text-slate-500">{terminal.local || '—'}</td>
                    <td className="px-3 py-2.5 text-center">
                      <StatusBadge status={terminal.status} />
                    </td>
                    <td className={cn(
                      "px-3 py-2.5 text-right font-mono",
                      terminal.status === 'offline' ? 'text-red-600 font-semibold' : 'text-slate-400'
                    )}>
                      {formatTimeSince(terminal.segundos_sem_ping)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}