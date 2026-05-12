import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { 
  Monitor, 
  Wifi, 
  WifiOff, 
  MapPin, 
  AlertTriangle,
  User,
  LayoutList,
  X
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import KPICard from '../components/dashboard/KPICard';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import TerminalsTable from '../components/dashboard/TerminalsTable';
import StatusPieChart from '../components/dashboard/StatusPieChart';
import AlertsList from '../components/dashboard/AlertsList';
import PullToRefresh from '../components/dashboard/PullToRefresh';
import AlertRulesWidget from '../components/dashboard/AlertRulesWidget';
import RecentAuditWidget from '../components/dashboard/RecentAuditWidget';

export default function Dashboard() {
  const [localFilter, setLocalFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [userFilter, setUserFilter] = useState(null);

  const [showExtrasModal, setShowExtrasModal] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(5000);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  // Fetch monitor config to get actual refresh interval
  useEffect(() => {
    base44.entities.MonitorConfig.list()
      .then((configs) => {
        const config = configs[0];
        if (config?.intervalo_sync_minutos) {
          setRefreshInterval(config.intervalo_sync_minutos * 60 * 1000);
        }
      })
      .catch(() => setRefreshInterval(30000));
  }, []);

  const perms = resolvePermissions(currentUser);
  const canSeeAll = currentUser?.role === 'admin';

  // Fetch terminals with server-side filtering for security
  const { data: terminals = [], isLoading, refetch } = useQuery({
    queryKey: ['terminals', currentUser?.email, canSeeAll],
    queryFn: async () => {
      if (canSeeAll) {
        return await base44.entities.Terminal.list();
      }
      return await base44.entities.Terminal.filter(
        { created_by: currentUser?.email },
        '-created_date'
      );
    },
    refetchInterval: refreshInterval,
    enabled: !!currentUser,
  });

  // Fetch alerts with server-side filtering for security
  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts', currentUser?.email, canSeeAll],
    queryFn: async () => {
      if (canSeeAll) {
        return await base44.entities.AlertIncident.list('-created_date', 50);
      }
      // Non-admins: fetch alerts from their own terminals only
      const myTerminals = await base44.entities.Terminal.filter(
        { created_by: currentUser?.email }
      );
      const myTerminalIds = myTerminals.map(t => t.id);
      if (myTerminalIds.length === 0) return [];
      // Fetch alerts and filter by owned terminals
      const allAlerts = await base44.entities.AlertIncident.list('-created_date', 50);
      return allAlerts.filter(a => myTerminalIds.includes(a.terminal_id));
    },
    refetchInterval: refreshInterval,
    enabled: !!currentUser,
  });

  // Get unique values for filters
  const locais = useMemo(() => 
    [...new Set(terminals.map(t => t.local).filter(Boolean))].sort(),
    [terminals]
  );

  const usuarios = useMemo(() =>
    [...new Set(terminals.map(t => t.usuario_email || t.created_by).filter(Boolean))].sort(),
    [terminals]
  );

  // Apply filters
  const filteredTerminals = useMemo(() => {
    return terminals.filter(t => {
      if (localFilter && t.local !== localFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (userFilter && (t.usuario_email || t.created_by) !== userFilter) return false;
      return true;
    });
  }, [terminals, localFilter, statusFilter, userFilter]);

  // Calculate KPIs
  const stats = useMemo(() => {
    const online = filteredTerminals.filter(t => t.status === 'online').length;
    const offline = filteredTerminals.filter(t => t.status === 'offline').length;
    return {
      total: filteredTerminals.length,
      online,
      offline,
      onlinePercentage: filteredTerminals.length > 0 
        ? ((online / filteredTerminals.length) * 100).toFixed(1) 
        : 0
    };
  }, [filteredTerminals]);

  // Sync filters to localStorage so TV Mode mirrors them in real-time
  useEffect(() => {
    const filters = { local: localFilter, status: statusFilter, user: userFilter };
    localStorage.setItem('dashboard-filters', JSON.stringify(filters));
  }, [localFilter, statusFilter, userFilter]);

  const handlePullRefresh = async () => {
    await refetch();
  };

  return (
    <PullToRefresh onRefresh={handlePullRefresh}>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 w-full overflow-x-hidden">


      {/* Main Content */}
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 max-w-[1920px]">
        {/* Filters */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/80 backdrop-blur-sm border border-slate-200/50 rounded-xl p-3 sm:p-4 space-y-3"
        >
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Filtros</span>
            {(localFilter || statusFilter || userFilter) && (
              <Button variant="ghost" size="sm" onClick={() => { setLocalFilter(null); setStatusFilter(null); setUserFilter(null); }} className="text-slate-500 hover:text-slate-700 h-7 px-2 text-xs">
                Limpar
              </Button>
            )}
          </div>

          <div className={`grid grid-cols-1 ${canSeeAll ? 'sm:grid-cols-2' : ''} gap-2`}>
            {/* Local */}
            <div>
              <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1">
                <MapPin className="h-3 w-3" /> Local
              </label>
              <select
                value={localFilter || ''}
                onChange={e => setLocalFilter(e.target.value || null)}
                className="h-8 px-2 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300 w-full"
              >
                <option value="">Todos</option>
                {locais.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            {/* Utilizador (admin only) */}
            {canSeeAll && (
              <div>
                <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1">
                  <User className="h-3 w-3" /> Utilizador
                </label>
                <select
                  value={userFilter || ''}
                  onChange={e => setUserFilter(e.target.value || null)}
                  className="h-8 px-2 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300 w-full"
                >
                  <option value="">Todos</option>
                  {usuarios.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            )}
          </div>


        </motion.div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <KPICard
            title="Total de Terminais"
            value={stats.total}
            icon={Monitor}
            color="blue"
            onClick={() => { setStatusFilter(null); setLocalFilter(null); setUserFilter(null); }}
            active={!statusFilter && !localFilter && !userFilter}
          />
          <KPICard
            title="Online"
            value={stats.online}
            icon={Wifi}
            color="green"
            trend="up"
            trendValue={`${stats.onlinePercentage}% disponível`}
            onClick={() => setStatusFilter(statusFilter === 'online' ? null : 'online')}
            active={statusFilter === 'online'}
          />
          <KPICard
            title="Offline"
            value={stats.offline}
            icon={WifiOff}
            color="red"
            onClick={() => setStatusFilter(statusFilter === 'offline' ? null : 'offline')}
            active={statusFilter === 'offline'}
          />
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          {/* Chart + Status Widget */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="md:col-span-1"
          >
            <Card className="h-full bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs sm:text-sm font-semibold text-slate-600 uppercase tracking-wider">
                  Distribuição de Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <StatusPieChart 
                  online={stats.online} 
                  offline={stats.offline}
                  compact
                />
                {/* Status bar */}
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  {(() => {
                    const pct = stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0;
                    const color = pct >= 80 ? 'emerald' : pct >= 50 ? 'amber' : 'red';
                    const barClass = color === 'emerald' ? 'bg-emerald-500' : color === 'amber' ? 'bg-amber-500' : 'bg-red-500';
                    const textClass = color === 'emerald' ? 'text-emerald-600' : color === 'amber' ? 'text-amber-600' : 'text-red-600';
                    return (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-slate-500">Disponibilidade</span>
                          <span className={cn("text-sm font-bold", textClass)}>{pct}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className={cn("h-full rounded-full transition-all duration-500", barClass)} style={{ width: `${pct}%` }} />
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-center pt-1">
                          <div>
                            <p className="text-base font-bold text-slate-700">{stats.total}</p>
                            <p className="text-[10px] text-slate-400">Total</p>
                          </div>
                          <div>
                            <p className="text-base font-bold text-emerald-600">{stats.online}</p>
                            <p className="text-[10px] text-slate-400 flex items-center justify-center gap-0.5"><Wifi className="h-2.5 w-2.5" /> Online</p>
                          </div>
                          <div>
                            <p className="text-base font-bold text-red-500">{stats.offline}</p>
                            <p className="text-[10px] text-slate-400 flex items-center justify-center gap-0.5"><WifiOff className="h-2.5 w-2.5" /> Offline</p>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Table */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="md:col-span-1 lg:col-span-2"
          >
            <Card className="h-full bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs sm:text-sm font-semibold text-slate-600 uppercase tracking-wider flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span>Terminais</span>
                  <span className="text-xs font-normal text-emerald-600 flex items-center gap-1">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    Tempo Real ({refreshInterval >= 60000 ? (refreshInterval / 60000).toFixed(0) + 'm' : (refreshInterval / 1000).toFixed(0) + 's'})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <TerminalsTable 
                  terminals={filteredTerminals} 
                  maxRows={12}
                  compact
                />
              </CardContent>
            </Card>
          </motion.div>

          {/* Alerts */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="md:col-span-1 lg:col-span-1"
          >
            <Card className="h-full bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs sm:text-sm font-semibold text-slate-600 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                    Incidentes
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowExtrasModal(true)}
                    className="h-6 px-2 text-[10px] text-slate-400 hover:text-slate-600 gap-1"
                  >
                    <LayoutList className="h-3 w-3" />
                    Ver mais
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AlertsList alerts={alerts} maxItems={5} />
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Extras Modal */}
        {showExtrasModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <h2 className="text-base font-semibold text-slate-800">Auditoria &amp; Alertas</h2>
                <button onClick={() => setShowExtrasModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                  <X className="h-5 w-5 text-slate-500" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <RecentAuditWidget currentUser={currentUser} />
                  <AlertRulesWidget />
                </div>
              </div>
            </motion.div>
          </div>
        )}
        </div>
      </div>
    </PullToRefresh>
  );
}