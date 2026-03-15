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
import { resolvePermissions } from '../components/auth/usePermissions';
import TerminalsTable from '../components/dashboard/TerminalsTable';
import StatusPieChart from '../components/dashboard/StatusPieChart';
import FilterDropdown from '../components/dashboard/FilterDropdown';
import AlertsList from '../components/dashboard/AlertsList';
import PullToRefresh from '../components/dashboard/PullToRefresh';
import TerminalStatusWidget from '../components/dashboard/TerminalStatusWidget';
import AlertRulesWidget from '../components/dashboard/AlertRulesWidget';
import RecentAuditWidget from '../components/dashboard/RecentAuditWidget';
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
  const [widgets, setWidgets] = useState(() => {
    try {
      const saved = localStorage.getItem('dashboard-widgets');
      return saved ? { ...DEFAULT_WIDGETS, ...JSON.parse(saved) } : DEFAULT_WIDGETS;
    } catch { return DEFAULT_WIDGETS; }
  });

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
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

  // Fetch terminals with auto-refresh every 5 seconds
  const { data: allTerminals = [], isLoading, refetch } = useQuery({
    queryKey: ['terminals'],
    queryFn: () => base44.entities.Terminal.list(),
    refetchInterval: 5000,
    enabled: !!currentUser,
  });

  const terminals = useMemo(() => {
    if (!currentUser) return [];
    if (canSeeAll) return allTerminals;
    return allTerminals.filter(t => t.created_by === currentUser.email);
  }, [allTerminals, currentUser, canSeeAll]);

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

  // Fetch alerts
  const { data: allAlerts = [] } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => base44.entities.AlertIncident.list('-created_date', 50),
    refetchInterval: 5000,
  });

  const alerts = useMemo(() => {
    if (!currentUser) return [];
    if (canSeeAll) return allAlerts;
    // Viewers see only alerts from their own terminals
    const myTerminalIds = new Set(terminals.map(t => t.id));
    return allAlerts.filter(a => myTerminalIds.has(a.terminal_id));
  }, [allAlerts, currentUser, canSeeAll, terminals]);

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
      <div className="bg-slate-900 text-white px-4 sm:px-6 py-4">
        <div className="max-w-[1920px] mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 rounded-lg shrink-0">
              <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight">NOC Monitor</h1>
              <p className="text-xs text-slate-400">Terminais Biométricos</p>
              <p className="text-xs text-emerald-400/70 font-mono mt-0.5 hidden sm:block">App ID: 697aa46c9998c30665e2e19a</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            {currentUser && (
              <div className="hidden sm:flex items-center gap-2 text-sm text-slate-300">
                <User className="h-4 w-4 text-slate-400" />
                <span>{currentUser.full_name || currentUser.email}</span>
              </div>
            )}
            <div className="text-right hidden sm:block">
              <p className="text-xs text-slate-400">Última atualização</p>
              <p className="text-sm font-mono text-slate-200">
                {lastRefresh.toLocaleTimeString('pt-BR')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowWidgetConfig(v => !v)}
              className={cn("bg-white/10 border-white/20 text-white hover:bg-white/20 gap-1.5", showWidgetConfig && "bg-white/20")}
            >
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">Widgets</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isMonitoring}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20"
            >
              <RefreshCw className={cn("h-4 w-4 sm:mr-2", isMonitoring && "animate-spin")} />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
            <Button
              size="sm"
              onClick={handleMonitorAll}
              disabled={isMonitoring}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Activity className={cn("h-4 w-4 sm:mr-2", isMonitoring && "animate-pulse")} />
              <span className="hidden sm:inline">Verificar Agora</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => base44.auth.logout()}
              className="text-slate-300 hover:text-white hover:bg-white/10"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Sair</span>
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
          className="flex flex-wrap items-end gap-3"
        >
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
              className="h-9 px-3 rounded-md border border-slate-200 bg-white/80 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="status">Status (offline primeiro)</option>
              <option value="nome">Nome (A-Z)</option>
              <option value="ping">Sem ping (maior primeiro)</option>
            </select>
          </div>
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
              className="ml-auto"
            >
              <Button variant="outline" size="sm" className="gap-1.5 text-slate-600">
                <Tv className="h-4 w-4" />
                <span className="hidden sm:inline">Modo TV</span>
              </Button>
            </Link>
        </motion.div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
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
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* Chart */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="h-full bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
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
            className="lg:col-span-2"
          >
            <Card className="h-full bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wider flex items-center justify-between">
                  <span>Terminais</span>
                  <span className="text-xs font-normal text-emerald-600 flex items-center gap-1">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    Tempo Real (5s)
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
          >
            <Card className="h-full bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  Incidentes Recentes
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