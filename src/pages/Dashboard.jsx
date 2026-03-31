import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { 
  Monitor, 
  Wifi, 
  WifiOff, 
  MapPin, 
  Building2, 
  RefreshCw,
  Activity,
  AlertTriangle,
  ArrowUpDown,
  LayoutDashboard,
  Settings2,
  LogOut,
  User
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { Tv } from 'lucide-react';
import KPICard from '../components/dashboard/KPICard';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import TerminalsTable from '../components/dashboard/TerminalsTable';
import StatusPieChart from '../components/dashboard/StatusPieChart';
import FilterDropdown from '../components/dashboard/FilterDropdown';
import AlertsList from '../components/dashboard/AlertsList';
import PullToRefresh from '../components/dashboard/PullToRefresh';
import TerminalStatusWidget from '../components/dashboard/TerminalStatusWidget';
import AlertRulesWidget from '../components/dashboard/AlertRulesWidget';
import RecentAuditWidget from '../components/dashboard/RecentAuditWidget';
import { useTerminalWatchdog } from '../hooks/useTerminalWatchdog';
const DEFAULT_WIDGETS = {
  terminalStatus: true,
  alertRules: true,
  recentAudit: true,
};

export default function Dashboard() {
  const [localFilter, setLocalFilter] = useState(null);
  const [clienteFilter, setClienteFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [sortBy, setSortBy] = useState('status');
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [showWidgetConfig, setShowWidgetConfig] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const [widgets, setWidgets] = useState(() => {
    try {
      const saved = localStorage.getItem('dashboard-widgets');
      return saved ? { ...DEFAULT_WIDGETS, ...JSON.parse(saved) } : DEFAULT_WIDGETS;
    } catch { return DEFAULT_WIDGETS; }
  });

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

  const toggleWidget = (key) => {
    setWidgets(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem('dashboard-widgets', JSON.stringify(next));
      return next;
    });
  };

  const perms = resolvePermissions(currentUser);
  const canSeeAll = currentUser?.role === 'admin' || currentUser?.role === 'editor';

  // Watchdog local: marca terminais offline sem depender de automações
  useTerminalWatchdog({ currentUser, onUpdate: () => { refetch(); setLastRefresh(new Date()); } });

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

  // Monitorar todos os terminais
  const handleMonitorAll = async () => {
    setIsMonitoring(true);
    try {
      await base44.functions.invoke('monitorAllTerminals', {});
      setLastRefresh(new Date());
      setTimeout(() => refetch(), 2000);
    } catch (error) {
      console.error('Erro ao monitorar:', error);
    } finally {
      setIsMonitoring(false);
    }
  };

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

  const clientes = useMemo(() => 
    [...new Set(terminals.map(t => t.cliente_nome || t.cliente).filter(Boolean))].sort(),
    [terminals]
  );

  // Apply filters
  const filteredTerminals = useMemo(() => {
    let list = terminals.filter(t => {
      if (localFilter && t.local !== localFilter) return false;
      if (clienteFilter && t.cliente_nome !== clienteFilter && t.cliente !== clienteFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      return true;
    });
    if (sortBy === 'status') {
      list = [...list].sort((a, b) => a.status === 'offline' ? -1 : 1);
    } else if (sortBy === 'nome') {
      list = [...list].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    } else if (sortBy === 'ping') {
      list = [...list].sort((a, b) => (b.segundos_sem_ping || 0) - (a.segundos_sem_ping || 0));
    }
    return list;
  }, [terminals, localFilter, clienteFilter, statusFilter, sortBy]);

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
    const filters = { local: localFilter, cliente: clienteFilter, status: statusFilter, sort: sortBy };
    localStorage.setItem('dashboard-filters', JSON.stringify(filters));
  }, [localFilter, clienteFilter, statusFilter, sortBy]);

  const handlePullRefresh = async () => {
    await refetch();
    setLastRefresh(new Date());
  };

  return (
    <PullToRefresh onRefresh={handlePullRefresh}>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Header */}
      <div className="bg-slate-900 text-white px-3 sm:px-6 py-3 sm:py-4">
        <div className="max-w-[1920px] mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2 bg-emerald-500/20 rounded-lg shrink-0">
              <Activity className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold tracking-tight truncate">NOC Monitor</h1>
              <p className="text-xs text-slate-400 truncate">Terminais Biométricos</p>
              <p className="text-xs text-slate-400/70 mt-0.5 hidden sm:block">Sistema de Monitoramento</p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
            {currentUser && (
              <div className="hidden sm:flex items-center gap-2 text-sm text-slate-300 whitespace-nowrap">
                <User className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="truncate">{currentUser.full_name || currentUser.email}</span>
              </div>
            )}
            <div className="text-right hidden sm:block whitespace-nowrap">
              <p className="text-xs text-slate-400">Última atualização</p>
              <p className="text-xs sm:text-sm font-mono text-slate-200">
                {lastRefresh.toLocaleTimeString('pt-PT')}
              </p>
            </div>
            {/* Mobile: single refresh button + menu; Desktop: full buttons */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleMonitorAll}
              disabled={isMonitoring}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20 gap-1.5"
            >
              <RefreshCw className={cn("h-4 w-4", isMonitoring && "animate-spin")} />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowWidgetConfig(v => !v)}
              className={cn("hidden sm:flex bg-white/10 border-white/20 text-white hover:bg-white/20 gap-1.5", showWidgetConfig && "bg-white/20")}
            >
              <Settings2 className="h-4 w-4" />
              Widgets
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => base44.auth.logout()}
              className="hidden sm:flex text-slate-300 hover:text-white hover:bg-white/10 gap-1"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </div>

      {/* Widget Config Panel */}
      {showWidgetConfig && (
        <div className="bg-slate-800 border-b border-slate-700 px-4 sm:px-6 py-3">
          <div className="max-w-[1920px] mx-auto flex flex-wrap items-center gap-4 sm:gap-6">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <LayoutDashboard className="h-3.5 w-3.5" /> Widgets visíveis
            </span>
            {[
              { key: 'terminalStatus', label: 'Status de Terminais' },
              { key: 'alertRules', label: 'Regras de Alerta' },
              { key: 'recentAudit', label: 'Auditoria Recente' },

            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={widgets[key]}
                  onCheckedChange={() => toggleWidget(key)}
                  className="data-[state=checked]:bg-emerald-500"
                />
                <span className="text-sm text-slate-300">{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-[1920px] mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Filters */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-3 sm:gap-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            <FilterDropdown
              label="Filtrar por Local"
              icon={MapPin}
              value={localFilter}
              onChange={setLocalFilter}
              options={locais}
              placeholder="Todos os locais"
            />
            <FilterDropdown
              label="Filtrar por Cliente"
              icon={Building2}
              value={clienteFilter}
              onChange={setClienteFilter}
              options={clientes}
              placeholder="Todos os clientes"
            />
            <FilterDropdown
              label="Status"
              icon={Activity}
              value={statusFilter}
              onChange={setStatusFilter}
              options={['online', 'offline']}
              placeholder="Todos os status"
            />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <ArrowUpDown className="h-3.5 w-3.5" />
                Ordenar por
              </label>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="h-9 px-3 rounded-md border border-slate-200 bg-white/80 text-xs sm:text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300 w-full"
              >
                <option value="status">Status</option>
                <option value="nome">Nome</option>
                <option value="ping">Sem ping</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
            {(localFilter || clienteFilter || statusFilter) && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => { setLocalFilter(null); setClienteFilter(null); setStatusFilter(null); }}
                className="text-slate-500 hover:text-slate-700"
              >
                Limpar filtros
              </Button>
            )}
            <Link
              to={`/TVMode${localFilter || clienteFilter ? `?${new URLSearchParams([...(localFilter ? [['local', localFilter]] : []), ...(clienteFilter ? [['cliente', clienteFilter]] : [])]).toString()}` : ''}`}
              className="w-full sm:w-auto"
            >
              <Button variant="outline" size="sm" className="gap-1.5 text-slate-600 w-full sm:w-auto">
                <Tv className="h-4 w-4" />
                Modo TV
              </Button>
            </Link>
          </div>
        </motion.div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <KPICard
            title="Total de Terminais"
            value={stats.total}
            icon={Monitor}
            color="blue"
          />
          <KPICard
            title="Online"
            value={stats.online}
            icon={Wifi}
            color="green"
            trend="up"
            trendValue={`${stats.onlinePercentage}% disponível`}
          />
          <KPICard
            title="Offline"
            value={stats.offline}
            icon={WifiOff}
            color="red"
          />
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          {/* Chart */}
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
              <CardContent>
                <StatusPieChart 
                  online={stats.online} 
                  offline={stats.offline}
                />
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
                <CardTitle className="text-xs sm:text-sm font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  Incidentes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AlertsList alerts={alerts} maxItems={5} />
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Custom Widgets Row */}
        {(widgets.terminalStatus || widgets.alertRules || widgets.recentAudit) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {widgets.terminalStatus && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <TerminalStatusWidget total={stats.total} online={stats.online} offline={stats.offline} />
              </motion.div>
            )}
            {widgets.alertRules && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <AlertRulesWidget />
              </motion.div>
            )}
            {widgets.recentAudit && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <RecentAuditWidget currentUser={currentUser} />
              </motion.div>
            )}
          </div>
        )}
        </div>
      </div>
    </PullToRefresh>
  );
}