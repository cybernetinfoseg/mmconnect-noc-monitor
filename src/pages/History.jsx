import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import { motion } from 'framer-motion';
import { 
  Clock, 
  TrendingUp, 
  Calendar,
  BarChart3,
  Activity,
  Monitor,
  MapPin,
  Filter,
  X
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import UptimeChart from '../components/dashboard/UptimeChart';
import { cn } from '@/lib/utils';
import { format, subHours, parseISO, startOfDay, endOfDay } from 'date-fns';

export default function History() {
  const [terminalFilter, setTerminalFilter] = useState('all');
  const [localFilter, setLocalFilter] = useState('all');

  const [uptimeFilter, setUptimeFilter] = useState('all');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms = resolvePermissions(currentUser);
  const canSeeAll = perms.isAdmin || perms.isEditor;

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

  // Fetch status history
  const { data: allHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ['status-history'],
    queryFn: () => base44.entities.StatusHistory.list('-created_date', 1000),
    enabled: !!currentUser,
  });

  const history = useMemo(() => {
    if (!currentUser) return [];
    if (canSeeAll) return allHistory;
    const myIds = new Set(terminals.map(t => t.id));
    return allHistory.filter(h => myIds.has(h.terminal_id));
  }, [allHistory, currentUser, canSeeAll, terminals]);

  // Calculate uptime per terminal based on date range
  const uptimeData = useMemo(() => {
    const now = new Date();
    const cutoff = dataInicio ? startOfDay(parseISO(dataInicio)) : subHours(now, 24);
    const cutoffEnd = dataFim ? endOfDay(parseISO(dataFim)) : now;
    
    const filteredHistory = history.filter(h => {
      const t = new Date(h.timestamp);
      return t >= cutoff && t <= cutoffEnd;
    });
    
    // Group by terminal
    const terminalStats = {};
    
    terminals.forEach(t => {
      terminalStats[t.id] = {
        id: t.id,
        nome: t.nome,
        local: t.local,
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
  }, [history, terminals, dataInicio, dataFim]);

  // Calculate average uptime
  const avgUptime = useMemo(() => {
    if (uptimeData.length === 0) return 0;
    return uptimeData.reduce((acc, t) => acc + t.uptime, 0) / uptimeData.length;
  }, [uptimeData]);

  // Get worst performers
  const worstPerformers = uptimeData.filter(t => t.uptime < 99).slice(0, 5);

  const locais = useMemo(() => [...new Set(terminals.map(t => t.local).filter(Boolean))].sort(), [terminals]);


  const filteredUptimeData = useMemo(() => {
    return uptimeData.filter(t => {
      if (terminalFilter !== 'all' && t.id !== terminalFilter) return false;
      const terminal = terminals.find(ter => ter.id === t.id);
      if (localFilter !== 'all' && terminal?.local !== localFilter) return false;

      if (uptimeFilter === 'critical' && t.uptime >= 95) return false;
      if (uptimeFilter === 'warning' && (t.uptime < 95 || t.uptime >= 99)) return false;
      if (uptimeFilter === 'good' && t.uptime < 99) return false;
      return true;
    });
  }, [uptimeData, terminalFilter, localFilter, uptimeFilter, terminals]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-3 sm:p-6">
      <div className="max-w-[1920px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-100 rounded-xl shrink-0">
              <BarChart3 className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Histórico de Uptime</h1>
              <p className="text-sm text-slate-500">Análise de disponibilidade por período</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 w-full">
            {/* Date range */}
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
              <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className="flex-1 sm:w-[130px] text-sm bg-white" />
              <span className="text-slate-400 text-sm shrink-0">–</span>
              <Input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} className="flex-1 sm:w-[130px] text-sm bg-white" />
              {(dataInicio || dataFim) && (
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => { setDataInicio(''); setDataFim(''); }}>
                  <X className="h-4 w-4 text-slate-400" />
                </Button>
              )}
            </div>
            {/* Other filters */}
            <div className="flex flex-wrap gap-2">
              <Select value={terminalFilter} onValueChange={setTerminalFilter}>
                <SelectTrigger className="w-full sm:w-[150px] bg-white shadow-sm text-xs h-8">
                  <Monitor className="h-3 w-3 mr-1 text-slate-400 shrink-0" />
                  <SelectValue placeholder="Terminal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os terminais</SelectItem>
                  {terminals.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              {locais.length > 0 && (
                <Select value={localFilter} onValueChange={setLocalFilter}>
                  <SelectTrigger className="w-full sm:w-[130px] bg-white shadow-sm text-xs h-8">
                    <MapPin className="h-3 w-3 mr-1 text-slate-400 shrink-0" />
                    <SelectValue placeholder="Local" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os locais</SelectItem>
                    {locais.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}

              <Select value={uptimeFilter} onValueChange={setUptimeFilter}>
                <SelectTrigger className="w-full sm:w-[140px] bg-white shadow-sm text-xs h-8">
                  <Filter className="h-3 w-3 mr-1 text-slate-400 shrink-0" />
                  <SelectValue placeholder="Uptime" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os uptimes</SelectItem>
                  <SelectItem value="critical">Crítico (&lt;95%)</SelectItem>
                  <SelectItem value="warning">Atenção (95-99%)</SelectItem>
                  <SelectItem value="good">Bom (≥99%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
             <CardContent className="p-3 sm:p-6">
               <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                 <div className="p-2 sm:p-3 bg-emerald-100 rounded-xl w-fit">
                   <TrendingUp className="h-4 w-4 sm:h-6 sm:w-6 text-emerald-600" />
                 </div>
                 <div>
                   <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">Uptime Médio</p>
                   <p className={cn(
                     "text-xl sm:text-3xl font-bold",
                     avgUptime >= 99 ? "text-emerald-600" : 
                     avgUptime >= 95 ? "text-yellow-600" : "text-red-600"
                   )}>
                     {avgUptime.toFixed(1)}%
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
              <CardContent className="p-3 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="p-2 sm:p-3 bg-blue-100 rounded-xl w-fit">
                    <Activity className="h-4 w-4 sm:h-6 sm:w-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">Terminais</p>
                    <p className="text-xl sm:text-3xl font-bold text-blue-600">
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
              <CardContent className="p-3 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className={cn(
                    "p-2 sm:p-3 rounded-xl w-fit",
                    worstPerformers.length === 0 ? "bg-emerald-100" : "bg-orange-100"
                  )}>
                    <Clock className={cn(
                      "h-4 w-4 sm:h-6 sm:w-6",
                      worstPerformers.length === 0 ? "text-emerald-600" : "text-orange-600"
                    )} />
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">Abaixo 99%</p>
                    <p className={cn(
                      "text-xl sm:text-3xl font-bold",
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
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
                {filteredUptimeData.length > 0 ? (
                 <UptimeChart data={filteredUptimeData} />
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
                  {filteredUptimeData.slice(0, 10).map((terminal, index) => (
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
                          {terminal.local}
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