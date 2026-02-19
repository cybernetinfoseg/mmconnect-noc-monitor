import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Monitor, 
  Wifi, 
  WifiOff, 
  Activity,
  AlertTriangle,
  CheckCircle,
  RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatusBadge from '../components/dashboard/StatusBadge';
import LiveClock from '../components/dashboard/LiveClock';
import TerminalDetailModal from '../components/tv/TerminalDetailModal';
import { cn } from '@/lib/utils';
import moment from 'moment';

export default function TVMode() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Read filters from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const localFilter = urlParams.get('local') || null;
  const clienteFilter = urlParams.get('cliente') || null;

  // Fetch terminals with auto-refresh every 5 seconds
  const { data: allTerminals = [], refetch } = useQuery({
    queryKey: ['terminals-tv'],
    queryFn: () => base44.entities.Terminal.filter({ ativo: true }),
    refetchInterval: 5000,
  });

  // Manual refresh
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // Fetch alerts
  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts-tv'],
    queryFn: () => base44.entities.AlertIncident.filter(
      { resolvido: false },
      '-created_date',
      10
    ),
    refetchInterval: 10000,
  });

  // Apply filters
  const terminals = useMemo(() => {
    return allTerminals.filter(t => {
      if (localFilter && t.local !== localFilter) return false;
      if (clienteFilter && t.cliente_nome !== clienteFilter && t.cliente !== clienteFilter) return false;
      return true;
    });
  }, [allTerminals, localFilter, clienteFilter]);

  // Sort terminals - offline first, then by time without ping
  const sortedTerminals = useMemo(() => {
    return [...terminals].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'offline' ? -1 : 1;
      }
      return (b.segundos_sem_ping || 0) - (a.segundos_sem_ping || 0);
    });
  }, [terminals]);

  // Calculate stats
  const stats = useMemo(() => {
    const online = terminals.filter(t => t.status === 'online').length;
    const offline = terminals.filter(t => t.status === 'offline').length;
    return { total: terminals.length, online, offline };
  }, [terminals]);

  const formatTimeSince = (seconds) => {
    if (!seconds || seconds < 0) return '—';
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  };

  const hasActiveAlerts = alerts.filter(a => !a.resolvido).length > 0;

  return (
    <div className="min-h-screen bg-slate-900 text-white overflow-hidden">
      {/* Header */}
      <div className={cn(
        "px-4 sm:px-8 py-3 sm:py-4 transition-colors duration-500",
        hasActiveAlerts ? "bg-red-900/50" : "bg-slate-800/50"
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className={cn(
                "p-3 rounded-xl",
                hasActiveAlerts ? "bg-red-500/20" : "bg-emerald-500/20"
              )}>
                <Activity className={cn(
                  "h-8 w-8",
                  hasActiveAlerts ? "text-red-400" : "text-emerald-400"
                )} />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">NOC Monitor</h1>
                <p className="text-sm text-slate-400">
                  Terminais Biométricos • Modo TV
                  {(localFilter || clienteFilter) && (
                    <span className="ml-2 text-emerald-400">
                      {[localFilter, clienteFilter].filter(Boolean).join(' • ')}
                    </span>
                  )}
                </p>
              </div>
            </div>
            
            {/* Live indicator */}
            <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-sm font-medium text-emerald-400">LIVE • 5min</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20"
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
              Atualizar
            </Button>
            <LiveClock />
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="px-4 sm:px-8 py-4 bg-slate-800/30 border-y border-slate-700/50">
        <div className="flex items-center justify-center gap-6 sm:gap-16 flex-wrap">
          <motion.div 
            className="flex items-center gap-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Monitor className="h-8 w-8 text-blue-400" />
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider">Total</p>
              <p className="text-4xl font-bold text-blue-400 tabular-nums">{stats.total}</p>
            </div>
          </motion.div>
          
          <motion.div 
            className="flex items-center gap-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Wifi className="h-8 w-8 text-emerald-400" />
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider">Online</p>
              <p className="text-4xl font-bold text-emerald-400 tabular-nums">{stats.online}</p>
            </div>
          </motion.div>
          
          <motion.div 
            className="flex items-center gap-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <WifiOff className="h-8 w-8 text-red-400" />
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider">Offline</p>
              <p className="text-4xl font-bold text-red-400 tabular-nums">{stats.offline}</p>
            </div>
          </motion.div>

          <motion.div 
            className="flex items-center gap-4 pl-8 border-l border-slate-700"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            {stats.offline === 0 ? (
              <>
                <CheckCircle className="h-8 w-8 text-emerald-400" />
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider">Status</p>
                  <p className="text-lg font-bold text-emerald-400">OPERACIONAL</p>
                </div>
              </>
            ) : (
              <>
                <AlertTriangle className="h-8 w-8 text-red-400 animate-pulse" />
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider">Status</p>
                  <p className="text-lg font-bold text-red-400">ALERTA</p>
                </div>
              </>
            )}
          </motion.div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-4 sm:p-8">
        {/* Alert Banner */}
        <AnimatePresence>
          {hasActiveAlerts && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6"
            >
              <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
                <div className="flex items-center gap-4">
                  <AlertTriangle className="h-6 w-6 text-red-400 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-red-400 font-semibold">Incidentes Ativos</p>
                    <p className="text-sm text-red-400/70">
                      {alerts.filter(a => !a.resolvido).length} terminal(is) offline requerem atenção
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Terminals Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4">
          <AnimatePresence mode="popLayout">
            {sortedTerminals.map((terminal, index) => (
              <motion.div
                key={terminal.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: index * 0.02 }}
                className={cn(
                  "relative overflow-hidden rounded-2xl p-5 transition-all duration-300",
                  terminal.status === 'offline'
                    ? "bg-red-500/10 border border-red-500/30"
                    : "bg-slate-800/50 border border-slate-700/50 hover:border-slate-600/50"
                )}
              >
                {/* Pulse effect for offline */}
                {terminal.status === 'offline' && (
                  <motion.div
                    className="absolute inset-0 bg-red-500/5"
                    animate={{ opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                )}
                
                <div className="relative">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-bold text-white truncate flex-1 mr-2">
                      {terminal.nome}
                    </h3>
                    <StatusBadge status={terminal.status} />
                  </div>
                  
                  <div className="space-y-1.5 text-sm">
                    <p className="text-slate-400 truncate">
                      <span className="text-slate-500">Local:</span> {terminal.local}
                    </p>
                    <p className="text-slate-400 truncate">
                      <span className="text-slate-500">Cliente:</span> {terminal.cliente}
                    </p>
                  </div>
                  
                  <div className="mt-4 pt-3 border-t border-slate-700/50 flex items-center justify-between">
                    <span className="text-xs text-slate-500">Último ping</span>
                    <span className={cn(
                      "text-sm font-mono",
                      terminal.status === 'offline' ? "text-red-400 font-semibold" : "text-slate-400"
                    )}>
                      {formatTimeSince(terminal.segundos_sem_ping)}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-slate-500 text-sm">
          <p>Auto-refresh a cada 5 segundos • Modo NOC 24/7</p>
        </div>
      </div>
    </div>
  );
}