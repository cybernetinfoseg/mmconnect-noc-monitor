import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { resolvePermissions } from '../components/auth/usePermissions';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Monitor,
  Wifi,
  WifiOff,
  Activity,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Settings,
  Filter,
  X,
  MapPin,
  ArrowUpDown,
  User } from
'lucide-react';
import FilterDropdown from '../components/dashboard/FilterDropdown';
import { Button } from '@/components/ui/button';
import StatusBadge from '../components/dashboard/StatusBadge';
import LiveClock from '../components/dashboard/LiveClock';
import TVSettingsPanel from '../components/tv/TVSettingsPanel';
import { cn } from '@/lib/utils';
import moment from 'moment';

const DEFAULT_SETTINGS = {
  gridCols: 'auto',
  cardSize: 'md',
  onlyOffline: false,
  showLocal: true,
  showConexao: true,
  showLastPing: true,
  showLatencia: false,
  showKPIs: true,
  showAlertBanner: true
};

export default function TVMode() {
  const [currentUser, setCurrentUser] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(5000);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  // Fetch monitor config to get actual refresh interval
  useEffect(() => {
    base44.entities.MonitorConfig.list().
    then((configs) => {
      const config = configs[0];
      if (config?.intervalo_sync_minutos) {
        setRefreshInterval(config.intervalo_sync_minutos * 60 * 1000);
      }
    }).
    catch(() => setRefreshInterval(5000));
  }, []);

  const perms = resolvePermissions(currentUser);
  const canSeeAll = perms.isAdmin;

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [tvLocalFilter, setTvLocalFilter] = useState(null);
  const [tvStatusFilter, setTvStatusFilter] = useState(null);
  const [tvUserFilter, setTvUserFilter] = useState(null);
  const [tvSortBy, setTvSortBy] = useState('status');
  const [tvSettings, setTvSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('tv-settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch (e) {return DEFAULT_SETTINGS;}
  });

  const handleSettingsChange = (newSettings) => {
    setTvSettings(newSettings);
    localStorage.setItem('tv-settings', JSON.stringify(newSettings));
  };

  // Mirror filters from Dashboard via localStorage (updates every 2s)
  const [mirrorFilters, setMirrorFilters] = useState(() => {
    try {
      const saved = localStorage.getItem('dashboard-filters');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {return {};}
  });

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const saved = localStorage.getItem('dashboard-filters');
        if (saved) setMirrorFilters(JSON.parse(saved));
      } catch (e) {}
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // URL params override localStorage — TV local filters take priority
  const urlParams = new URLSearchParams(window.location.search);
  const localFilter = tvLocalFilter || urlParams.get('local') || null;
  const statusFilterMirror = tvStatusFilter || null;

  // Fetch terminals with auto-refresh based on config
  const { data: allTerminalsRaw = [], refetch } = useQuery({
    queryKey: ['terminals-tv', currentUser?.email, canSeeAll],
    queryFn: async () => {
      const baseFilter = { ativo: true };
      if (canSeeAll) {
        return await base44.entities.Terminal.filter(baseFilter);
      }
      return await base44.entities.Terminal.filter({
        ...baseFilter,
        created_by: currentUser?.email
      });
    },
    refetchInterval: refreshInterval,
    enabled: !!currentUser
  });

  const allTerminals = useMemo(() => {
    if (!currentUser) return [];
    return allTerminalsRaw;
  }, [allTerminalsRaw, currentUser]);

  // Manual refresh
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // Fetch alerts — filtrar apenas incidentes dos terminais visíveis ao utilizador
  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts-tv', currentUser?.email, canSeeAll],
    queryFn: async () => {
      const allAlerts = await base44.entities.AlertIncident.filter(
        { resolvido: false },
        '-created_date',
        50
      );
      if (canSeeAll) return allAlerts.slice(0, 10);
      // Filtrar apenas incidentes de terminais do utilizador
      const myTerminalIds = new Set(allTerminalsRaw.map((t) => t.id));
      return allAlerts.filter((a) => myTerminalIds.has(a.terminal_id)).slice(0, 10);
    },
    enabled: !!currentUser,
    refetchInterval: 10000
  });

  // Unique values for filter options
  const tvLocais = useMemo(() => [...new Set(allTerminals.map((t) => t.local).filter(Boolean))].sort(), [allTerminals]);
  const tvUsuarios = useMemo(() => [...new Set(allTerminals.map((t) => t.usuario_email || t.created_by).filter(Boolean))].sort(), [allTerminals]);

  // Apply filters
  const terminals = useMemo(() => {
    return allTerminals.filter((t) => {
      if (localFilter && t.local !== localFilter) return false;
      if (statusFilterMirror && t.status !== statusFilterMirror) return false;
      if (tvUserFilter && (t.usuario_email || t.created_by) !== tvUserFilter) return false;
      if (tvSettings.onlyOffline && t.status !== 'offline') return false;
      return true;
    });
  }, [allTerminals, localFilter, statusFilterMirror, tvUserFilter, tvSettings.onlyOffline]);

  // Sort terminals
  const sortedTerminals = useMemo(() => {
    return [...terminals].sort((a, b) => {
      if (tvSortBy === 'status') {
        if (a.status !== b.status) return a.status === 'offline' ? -1 : 1;
        return (b.segundos_sem_ping || 0) - (a.segundos_sem_ping || 0);
      } else if (tvSortBy === 'nome') {
        return (a.nome || '').localeCompare(b.nome || '');
      } else if (tvSortBy === 'ping') {
        return (b.segundos_sem_ping || 0) - (a.segundos_sem_ping || 0);
      }
      return 0;
    });
  }, [terminals, tvSortBy]);

  // Calculate stats
  const stats = useMemo(() => {
    const online = terminals.filter((t) => t.status === 'online').length;
    const offline = terminals.filter((t) => t.status === 'offline').length;
    return { total: terminals.length, online, offline };
  }, [terminals]);

  const formatTimeSince = (seconds) => {
    if (!seconds || seconds < 0) return '—';
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
    return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`;
  };

  const hasActiveAlerts = alerts.filter((a) => !a.resolvido).length > 0;

  return (
    <div className="min-h-screen bg-slate-900 text-white overflow-hidden">
      {/* Header */}
      <div className={cn(
        "px-3 sm:px-8 py-2 sm:py-4 transition-colors duration-500",
        hasActiveAlerts ? "bg-red-900/50" : "bg-slate-800/50"
      )}>
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <div className={cn(
              "p-2 sm:p-3 rounded-lg sm:rounded-xl flex-shrink-0",
              hasActiveAlerts ? "bg-red-500/20" : "bg-emerald-500/20"
            )}>
              <Activity className={cn(
                "h-5 w-5 sm:h-8 sm:w-8",
                hasActiveAlerts ? "text-red-400" : "text-emerald-400"
              )} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold tracking-tight truncate">NOC Monitor</h1>
              <p className="text-xs sm:text-sm text-slate-400 truncate flex items-center gap-2">
                <span>{localFilter ? localFilter : 'Terminais Biométricos'}</span>
                <span className="bg-slate-700 text-slate-300 text-xs font-semibold rounded-full tabular-nums">
                  {stats.total} terminal{stats.total !== 1 ? 'is' : ''}
                </span>
              </p>
            </div>
            
            {/* Live indicator */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 flex-shrink-0">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs text-emerald-400 font-medium hidden sm:inline">LIVE</span>
            </div>
          </div>
          
          <div className="pt-2 flex items-center gap-1 sm:gap-3 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((v) => !v)} className="bg-white/10 text-white mt-1 pr-2 pl-2 px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border shadow-sm hover:text-accent-foreground border-white/20 h-8 sm:h-9 sm:px-3 sm:text-sm hover:bg-white/20">
              
              <Filter className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline ml-1">Filtros</span>
              {(tvLocalFilter || tvStatusFilter || tvUserFilter) &&
              <span className="ml-1 w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center font-bold">
                  {[tvLocalFilter, tvStatusFilter, tvUserFilter].filter(Boolean).length}
                </span>
              }
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20 h-8 px-2 sm:h-9 sm:px-3 text-xs sm:text-sm">

              <RefreshCw className={cn("h-3 w-3 sm:h-4 sm:w-4", isRefreshing && "animate-spin")} />
              <span className="hidden sm:inline ml-1">Atualizar</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettings(true)}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20 h-8 w-8 sm:h-9 sm:w-9 p-0">

              <Settings className="h-3 w-3 sm:h-4 sm:w-4" />
            </Button>
            <div className="hidden sm:block">
              <LiveClock />
            </div>
          </div>
        </div>
        {/* Mobile clock */}
        <div className="sm:hidden mt-2 text-right">
          <LiveClock />
        </div>
      </div>

      {/* Filter Bar */}
      <AnimatePresence>
        {showFilters &&
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="bg-slate-800/80 border-b border-slate-700/50 px-4 sm:px-8 py-3">
          
            <div className="flex flex-wrap items-center gap-3">
              {/* Local */}
              <div className="space-y-1 min-w-[160px]">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Local
                </label>
                <select
                value={tvLocalFilter || ''}
                onChange={(e) => setTvLocalFilter(e.target.value || null)}
                className="h-8 px-2 rounded-md border border-slate-600 bg-slate-700 text-xs text-slate-200 focus:outline-none w-full">
                
                  <option value="">Todos os locais</option>
                  {tvLocais.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              {/* Status */}
              <div className="space-y-1 min-w-[140px]">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Wifi className="h-3 w-3" /> Status
                </label>
                <select
                value={tvStatusFilter || ''}
                onChange={(e) => setTvStatusFilter(e.target.value || null)}
                className="h-8 px-2 rounded-md border border-slate-600 bg-slate-700 text-xs text-slate-200 focus:outline-none w-full">
                
                  <option value="">Todos os status</option>
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
              {/* Utilizador (admin only) */}
              {canSeeAll &&
            <div className="space-y-1 min-w-[180px]">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <User className="h-3 w-3" /> Utilizador
                  </label>
                  <select
                value={tvUserFilter || ''}
                onChange={(e) => setTvUserFilter(e.target.value || null)}
                className="h-8 px-2 rounded-md border border-slate-600 bg-slate-700 text-xs text-slate-200 focus:outline-none w-full">
                
                    <option value="">Todos os utilizadores</option>
                    {tvUsuarios.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
            }
              {/* Ordenar */}
              <div className="space-y-1 min-w-[140px]">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <ArrowUpDown className="h-3 w-3" /> Ordenar
                </label>
                <select
                value={tvSortBy}
                onChange={(e) => setTvSortBy(e.target.value)}
                className="h-8 px-2 rounded-md border border-slate-600 bg-slate-700 text-xs text-slate-200 focus:outline-none w-full">
                
                  <option value="status">Status</option>
                  <option value="nome">Nome</option>
                  <option value="ping">Sem ping</option>
                </select>
              </div>
              {/* Clear filters */}
              {(tvLocalFilter || tvStatusFilter || tvUserFilter) &&
            <button
              onClick={() => {setTvLocalFilter(null);setTvStatusFilter(null);setTvUserFilter(null);}}
              className="mt-4 flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors">
              
                  <X className="h-3 w-3" /> Limpar filtros
                </button>
            }
            </div>
          </motion.div>
        }
      </AnimatePresence>

      {/* KPI Strip */}
      {tvSettings.showKPIs &&
      <div className="px-3 sm:px-8 py-3 sm:py-4 bg-slate-800/30 border-y border-slate-700/50 overflow-x-auto">
          <div className="flex items-center justify-center gap-3 sm:gap-8 lg:gap-16 flex-wrap whitespace-nowrap">
            <motion.div className="flex items-center gap-2 sm:gap-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
               <Monitor className="h-6 sm:h-8 w-6 sm:w-8 text-blue-400 shrink-0" />
               <div className="whitespace-nowrap">
                 <p className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider">Total</p>
                 <p className="text-2xl sm:text-4xl font-bold text-blue-400 tabular-nums">{stats.total}</p>
               </div>
             </motion.div>
             <motion.div className="flex items-center gap-2 sm:gap-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
               <Wifi className="h-6 sm:h-8 w-6 sm:w-8 text-emerald-400 shrink-0" />
               <div className="whitespace-nowrap">
                 <p className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider">Online</p>
                 <p className="text-2xl sm:text-4xl font-bold text-emerald-400 tabular-nums">{stats.online}</p>
               </div>
             </motion.div>
             <motion.div className="flex items-center gap-2 sm:gap-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
               <WifiOff className="h-6 sm:h-8 w-6 sm:w-8 text-red-400 shrink-0" />
               <div className="whitespace-nowrap">
                 <p className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider">Offline</p>
                 <p className="text-2xl sm:text-4xl font-bold text-red-400 tabular-nums">{stats.offline}</p>
               </div>
             </motion.div>
             <motion.div className="flex items-center gap-2 sm:gap-4 pl-3 sm:pl-8 border-l border-slate-700" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              {stats.offline === 0 ?
            <><CheckCircle className="h-8 w-8 text-emerald-400" /><div><p className="text-xs text-slate-400 uppercase tracking-wider">Status</p><p className="text-lg font-bold text-emerald-400">OPERACIONAL</p></div></> :

            <><AlertTriangle className="h-8 w-8 text-red-400 animate-pulse" /><div><p className="text-xs text-slate-400 uppercase tracking-wider">Status</p><p className="text-lg font-bold text-red-400">ALERTA</p></div></>
            }
            </motion.div>
          </div>
        </div>
      }

      {/* Main Content */}
      <div className="p-4 sm:p-8">
        {/* Alert Banner */}
        {tvSettings.showAlertBanner &&
        <AnimatePresence>
            {hasActiveAlerts &&
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6">

                <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
                  <div className="flex items-center gap-4">
                    <AlertTriangle className="h-6 w-6 text-red-400 animate-pulse" />
                    <div className="flex-1">
                      <p className="text-red-400 font-semibold">Incidentes Ativos</p>
                      <p className="text-sm text-red-400/70">
                        {stats.offline} terminal(is) offline {stats.offline === 1 ? 'requer' : 'requerem'} atenção
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
          }
          </AnimatePresence>
        }

        {/* Terminals Grid */}
        {(() => {
          const cols = tvSettings.gridCols;
          const gridColsMap = {
            auto: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
            2: 'grid-cols-2',
            3: 'grid-cols-3',
            4: 'grid-cols-4',
            5: 'grid-cols-5',
            6: 'grid-cols-6'
          };
          const gridClass = gridColsMap[cols] || gridColsMap.auto;
          const cardPad = tvSettings.cardSize === 'sm' ? 'p-3' : tvSettings.cardSize === 'lg' ? 'p-7' : 'p-5';
          const titleSize = tvSettings.cardSize === 'sm' ? 'text-base' : tvSettings.cardSize === 'lg' ? 'text-2xl' : 'text-lg';

          return (
            <div className={cn('grid gap-3 sm:gap-4', gridClass)}>
              <AnimatePresence mode="popLayout">
                {sortedTerminals.map((terminal, index) =>
                <motion.div
                  key={terminal.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: index * 0.02 }}
                  className={cn(
                    "relative overflow-hidden rounded-2xl transition-all duration-300",
                    cardPad,
                    terminal.status === 'offline' ?
                    "bg-red-500/10 border border-red-500/30" :
                    "bg-slate-800/50 border border-slate-700/50 hover:border-slate-600/50"
                  )}>

                    {terminal.status === 'offline' &&
                  <motion.div
                    className="absolute inset-0 bg-red-500/5"
                    animate={{ opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }} />

                  }
                    <div className="relative">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className={cn("font-bold text-white truncate flex-1 mr-2", titleSize)}>
                          {terminal.nome}
                        </h3>
                        <StatusBadge status={terminal.status} />
                      </div>
                      <div className="space-y-1.5 text-sm">
                        {tvSettings.showLocal !== false &&
                      <p className="text-slate-400 truncate">
                            <span className="text-slate-500">Local:</span> {terminal.local}
                          </p>
                      }
                        {tvSettings.showConexao !== false && (() => {
                        const tipo = terminal.tipo_conexao;
                        let conexaoLabel = null;
                        let conexaoVal = null;
                        if (tipo === 'ip_local' && terminal.ip_local) {conexaoLabel = 'IP Local';conexaoVal = `${terminal.ip_local}:${terminal.porta || 5005}`;} else
                        if (tipo === 'ip_publico' && terminal.ip_publico) {conexaoLabel = 'IP Público';conexaoVal = `${terminal.ip_publico}:${terminal.porta || 5005}`;} else
                        if (tipo === 'dns' && terminal.dns) {conexaoLabel = 'DNS';conexaoVal = `${terminal.dns}:${terminal.porta || 5005}`;} else
                        if (tipo === 'p2s' && terminal.ip_local) {conexaoLabel = 'VPN';conexaoVal = terminal.ip_local;} else
                        if (tipo === 'api' && terminal.api_endpoint) {conexaoLabel = 'API';conexaoVal = terminal.api_endpoint;}
                        return conexaoVal ?
                        <p className="text-slate-400 truncate">
                              <span className="text-slate-500">{conexaoLabel}:</span> <span className="font-mono text-xs text-emerald-300">{conexaoVal}</span>
                            </p> :
                        null;
                      })()}
                        {tvSettings.showLatencia && terminal.latencia_ms &&
                      <p className="text-slate-400 truncate">
                            <span className="text-slate-500">Latência:</span> {terminal.latencia_ms}ms
                          </p>
                      }
                      </div>
                      {tvSettings.showLastPing !== false &&
                    <div className="mt-4 pt-3 border-t border-slate-700/50 flex items-center justify-between">
                          <span className="text-xs text-slate-500">Último ping</span>
                          <span className={cn(
                        "text-sm font-mono",
                        terminal.status === 'offline' ? "text-red-400 font-semibold" : "text-slate-400"
                      )}>
                            {formatTimeSince(terminal.segundos_sem_ping)}
                          </span>
                        </div>
                    }
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>);

        })()}

        {/* Footer */}
        <div className="mt-8 text-center text-slate-500 text-sm">
          
        </div>
      </div>

      {/* TV Settings Panel */}
      {showSettings &&
      <TVSettingsPanel
        settings={tvSettings}
        onChange={handleSettingsChange}
        onClose={() => setShowSettings(false)} />

      }
    </div>);

}