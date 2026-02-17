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
  AlertTriangle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import KPICard from '../components/dashboard/KPICard';
import TerminalsTable from '../components/dashboard/TerminalsTable';
import StatusPieChart from '../components/dashboard/StatusPieChart';
import FilterDropdown from '../components/dashboard/FilterDropdown';
import AlertsList from '../components/dashboard/AlertsList';

export default function Dashboard() {
  const [localFilter, setLocalFilter] = useState(null);
  const [clienteFilter, setClienteFilter] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isMonitoring, setIsMonitoring] = useState(false);

  // Fetch terminals with auto-refresh every 5 seconds
  const { data: terminals = [], isLoading, refetch } = useQuery({
    queryKey: ['terminals'],
    queryFn: () => base44.entities.Terminal.list(),
    refetchInterval: 5000, // Atualização em tempo real
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

  // Fetch alerts
  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => base44.entities.AlertIncident.list('-created_date', 50),
    refetchInterval: 5000,
  });

  // Get unique values for filters
  const locais = useMemo(() => 
    [...new Set(terminals.map(t => t.local).filter(Boolean))].sort(),
    [terminals]
  );

  const clientes = useMemo(() => 
    [...new Set(terminals.map(t => t.cliente).filter(Boolean))].sort(),
    [terminals]
  );

  // Apply filters
  const filteredTerminals = useMemo(() => {
    return terminals.filter(t => {
      if (localFilter && t.local !== localFilter) return false;
      if (clienteFilter && t.cliente !== clienteFilter) return false;
      return true;
    });
  }, [terminals, localFilter, clienteFilter]);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-4">
        <div className="max-w-[1920px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/20 rounded-lg">
                <Activity className="h-6 w-6 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">NOC Monitor</h1>
                <p className="text-xs text-slate-400">Monitoramento de Terminais Biométricos</p>
                <p className="text-xs text-emerald-400/70 font-mono mt-0.5">App ID: 697aa46c9998c30665e2e19a</p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-slate-400">Última atualização</p>
              <p className="text-sm font-mono text-slate-200">
                {lastRefresh.toLocaleTimeString('pt-BR')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isMonitoring}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20"
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", isMonitoring && "animate-spin")} />
              Atualizar
            </Button>
            <Button
              size="sm"
              onClick={handleMonitorAll}
              disabled={isMonitoring}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Activity className={cn("h-4 w-4 mr-2", isMonitoring && "animate-pulse")} />
              Verificar Agora
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1920px] mx-auto p-6 space-y-6">
        {/* Filters */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-end gap-4"
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
          {(localFilter || clienteFilter) && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => { setLocalFilter(null); setClienteFilter(null); }}
              className="text-slate-500 hover:text-slate-700"
            >
              Limpar filtros
            </Button>
          )}
        </motion.div>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
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
      </div>
    </div>
  );
}