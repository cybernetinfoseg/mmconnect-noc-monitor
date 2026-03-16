import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { resolvePermissions } from '../components/auth/usePermissions.jsx';
import { motion } from 'framer-motion';
import { 
  Clock, 
  TrendingUp, 
  Calendar,
  BarChart3,
  Activity
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import UptimeChart from '../components/dashboard/UptimeChart';
import { cn } from '@/lib/utils';
import moment from 'moment';

export default function History() {
  const [period, setPeriod] = useState('24h');
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms = resolvePermissions(currentUser);
  const canSeeAll = perms.isAdmin || perms.isEditor;

  // Fetch status history
  const { data: allHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ['status-history', period],
    queryFn: () => base44.entities.StatusHistory.list('-created_date', 1000),
    enabled: !!currentUser,
  });

  const history = useMemo(() => {
    if (!currentUser) return [];
    if (canSeeAll) return allHistory;
    const myIds = new Set(terminals.map(t => t.id));
    return allHistory.filter(h => myIds.has(h.terminal_id));
  }, [allHistory, currentUser, canSeeAll, terminals]);

  // Fetch terminals
  const { data: allTerminals = [] } = useQuery({
    queryKey: ['terminals-history'],
    queryFn: () => base44.entities.Terminal.list(),
    enabled: !!currentUser,
  });

  const terminals = useMemo(() => {
    if (!currentUser) return [];
    if (canSeeAll) return allTerminals;
    return allTerminals.filter(t => t.created_by === currentUser.email);
  }, [allTerminals, currentUser, canSeeAll]);

  // Calculate uptime per terminal based on period
  const uptimeData = useMemo(() => {
    const periodHours = {
      '24h': 24,
      '7d': 168,
      '30d': 720
    };
    
    const hours = periodHours[period] || 24;
    const cutoff = moment().subtract(hours, 'hours').toDate();
    
    const filteredHistory = history.filter(h => new Date(h.timestamp) >= cutoff);
    
    // Group by terminal
    const terminalStats = {};
    
    terminals.forEach(t => {
      terminalStats[t.id] = {
        id: t.id,
        nome: t.nome,
        local: t.local,
        cliente: t.cliente,
        totalRecords: 0,
        onlineRecords: 0,
        uptime: 100
      };
    });
    
    filteredHistory.forEach(h => {
      if (terminalStats[h.terminal_id]) {
        terminalStats[h.terminal_id].totalRecords++;
        if (h.status === 'online') {
          terminalStats[h.terminal_id].onlineRecords++;
        }
      }
    });
    
    // Calculate uptime percentage
    Object.values(terminalStats).forEach(t => {
      if (t.totalRecords > 0) {
        t.uptime = (t.onlineRecords / t.totalRecords) * 100;
      }
    });
    
    return Object.values(terminalStats).sort((a, b) => a.uptime - b.uptime);
  }, [history, terminals, period]);

  // Calculate average uptime
  const avgUptime = useMemo(() => {
    if (uptimeData.length === 0) return 0;
    return uptimeData.reduce((acc, t) => acc + t.uptime, 0) / uptimeData.length;
  }, [uptimeData]);

  // Get worst performers
  const worstPerformers = uptimeData.filter(t => t.uptime < 99).slice(0, 5);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-6">
      <div className="max-w-[1920px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-100 rounded-xl shrink-0">
              <BarChart3 className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Histórico de Uptime</h1>
              <p className="text-sm text-slate-500">Análise de disponibilidade por período</p>
            </div>
          </div>
          
          <Tabs value={period} onValueChange={setPeriod}>
            <TabsList className="bg-white shadow-sm">
              <TabsTrigger value="24h" className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                <span className="hidden sm:inline">24 horas</span>
                <span className="sm:hidden">24h</span>
              </TabsTrigger>
              <TabsTrigger value="7d" className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                <span className="hidden sm:inline">7 dias</span>
                <span className="sm:hidden">7d</span>
              </TabsTrigger>
              <TabsTrigger value="30d" className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                <span className="hidden sm:inline">30 dias</span>
                <span className="sm:hidden">30d</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-emerald-100 rounded-xl">
                    <TrendingUp className="h-6 w-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Uptime Médio</p>
                    <p className={cn(
                      "text-3xl font-bold",
                      avgUptime >= 99 ? "text-emerald-600" : 
                      avgUptime >= 95 ? "text-yellow-600" : "text-red-600"
                    )}>
                      {avgUptime.toFixed(2)}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-100 rounded-xl">
                    <Activity className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Terminais Monitorados</p>
                    <p className="text-3xl font-bold text-blue-600">
                      {terminals.length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "p-3 rounded-xl",
                    worstPerformers.length === 0 ? "bg-emerald-100" : "bg-orange-100"
                  )}>
                    <Clock className={cn(
                      "h-6 w-6",
                      worstPerformers.length === 0 ? "text-emerald-600" : "text-orange-600"
                    )} />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Abaixo de 99%</p>
                    <p className={cn(
                      "text-3xl font-bold",
                      worstPerformers.length === 0 ? "text-emerald-600" : "text-orange-600"
                    )}>
                      {worstPerformers.length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Uptime Chart */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="h-full bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
                  Terminais com Menor Uptime
                </CardTitle>
              </CardHeader>
              <CardContent>
                {uptimeData.length > 0 ? (
                  <UptimeChart data={uptimeData} />
                ) : (
                  <div className="flex items-center justify-center h-64 text-slate-400">
                    <p>Nenhum dado disponível</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Worst Performers Table */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
          >
            <Card className="h-full bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
                  Ranking de Uptime
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {uptimeData.slice(0, 10).map((terminal, index) => (
                    <motion.div
                      key={terminal.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={cn(
                        "flex items-center gap-4 p-3 rounded-xl transition-colors",
                        terminal.uptime < 95 ? "bg-red-50" :
                        terminal.uptime < 99 ? "bg-yellow-50" : "bg-slate-50"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold",
                        terminal.uptime < 95 ? "bg-red-100 text-red-600" :
                        terminal.uptime < 99 ? "bg-yellow-100 text-yellow-600" : 
                        "bg-emerald-100 text-emerald-600"
                      )}>
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 truncate">
                          {terminal.nome}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {terminal.local} • {terminal.cliente}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={cn(
                          "text-lg font-bold",
                          terminal.uptime < 95 ? "text-red-600" :
                          terminal.uptime < 99 ? "text-yellow-600" : "text-emerald-600"
                        )}>
                          {terminal.uptime.toFixed(2)}%
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}