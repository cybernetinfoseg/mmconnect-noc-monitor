import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  MapPin, 
  Building2,
  Filter,
  RefreshCw,
  Bell,
  BellOff,
  FileDown
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import FilterDropdown from '../components/dashboard/FilterDropdown';
import { cn } from '@/lib/utils';
import moment from 'moment';

export default function Incidents() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [tipoFilter, setTipoFilter] = useState('all');
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms = resolvePermissions(currentUser);
  const canSeeAll = perms.isAdmin || perms.isEditor;

  const queryClient = useQueryClient();

  // Fetch terminals to know which ones belong to this user
  const { data: allTerminals = [] } = useQuery({
    queryKey: ['terminals-incidents-user'],
    queryFn: () => base44.entities.Terminal.list(),
    enabled: !!currentUser,
  });

  const myTerminalIds = useMemo(() => {
    if (!currentUser || canSeeAll) return null;
    return new Set(allTerminals.filter(t => t.created_by === currentUser.email).map(t => t.id));
  }, [allTerminals, currentUser, canSeeAll]);

  // Fetch incidents
  const { data: allIncidents = [], isLoading, refetch } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => base44.entities.AlertIncident.list('-created_date', 200),
    refetchInterval: 30000,
    enabled: !!currentUser,
  });

  const handleRefresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['terminals-incidents-user'] });
  };

  const incidents = useMemo(() => {
    if (!currentUser) return [];
    if (canSeeAll) return allIncidents;
    return allIncidents.filter(i => myTerminalIds?.has(i.terminal_id));
  }, [allIncidents, currentUser, canSeeAll, myTerminalIds]);

  const [checkingId, setCheckingId] = useState(null);
  const [checkError, setCheckError] = useState(null);

  // Resolve incident mutation
  const resolveMutation = useMutation({
    mutationFn: async (incident) => {
      return base44.entities.AlertIncident.update(incident.id, {
        resolvido: true,
        resolvido_em: new Date().toISOString(),
        duracao_minutos: Math.round(
          (new Date() - new Date(incident.timestamp)) / 60000
        )
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    }
  });

  // Filter incidents
  const filteredIncidents = useMemo(() => {
    return incidents.filter(incident => {
      if (statusFilter === 'active' && incident.resolvido) return false;
      if (statusFilter === 'resolved' && !incident.resolvido) return false;
      if (tipoFilter === 'offline' && incident.tipo !== 'offline') return false;
      if (tipoFilter === 'restored' && incident.tipo !== 'restored') return false;
      return true;
    });
  }, [incidents, statusFilter, tipoFilter]);

  // Stats
  const stats = useMemo(() => {
    const active = incidents.filter(i => !i.resolvido && i.tipo === 'offline').length;
    const resolved = incidents.filter(i => i.resolvido).length;
    const today = incidents.filter(i => 
      moment(i.timestamp).isSame(moment(), 'day')
    ).length;
    return { active, resolved, today };
  }, [incidents]);

  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 20;

    // Header
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 16, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('NOC Monitor — Relatório de Incidentes', margin, 11);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Gerado em: ${moment().format('DD/MM/YYYY HH:mm')}`, pageW - margin, 11, { align: 'right' });

    y = 26;
    doc.setTextColor(30, 41, 59);

    // Filtros aplicados
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    const filterDesc = [
      `Status: ${statusFilter === 'all' ? 'Todos' : statusFilter === 'active' ? 'Ativos' : 'Resolvidos'}`,
      `Tipo: ${tipoFilter === 'all' ? 'Todos' : tipoFilter === 'offline' ? 'Offline' : 'Restaurado'}`,
      `Total: ${filteredIncidents.length} incidente(s)`,
    ].join('   |   ');
    doc.text(filterDesc, margin, y);
    y += 6;

    // Linha separadora
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, y, pageW - margin, y);
    y += 5;

    // Resumo KPI
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('Resumo', margin, y);
    y += 5;

    const kpis = [
      { label: 'Incidentes Ativos', value: String(stats.active), color: [220, 38, 38] },
      { label: 'Resolvidos', value: String(stats.resolved), color: [5, 150, 105] },
      { label: 'Hoje', value: String(stats.today), color: [37, 99, 235] },
    ];
    const kpiW = (pageW - margin * 2) / 3;
    kpis.forEach((kpi, i) => {
      const x = margin + i * kpiW;
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, kpiW - 3, 14, 2, 2, 'F');
      doc.setTextColor(...kpi.color);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(kpi.value, x + 4, y + 9);
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(kpi.label, x + 4, y + 13);
    });
    y += 20;

    // Linha separadora
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, y, pageW - margin, y);
    y += 6;

    // Título tabela
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('Histórico de Incidentes', margin, y);
    y += 5;

    // Cabeçalho tabela
    const cols = [
      { label: 'Terminal', x: margin, w: 42 },
      { label: 'Tipo', x: margin + 42, w: 22 },
      { label: 'Local', x: margin + 64, w: 38 },
      { label: 'Cliente', x: margin + 102, w: 38 },
      { label: 'Data/Hora', x: margin + 140, w: 30 },
      { label: 'Duração', x: margin + 170, w: 26 },
    ];

    doc.setFillColor(30, 41, 59);
    doc.rect(margin, y, pageW - margin * 2, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    cols.forEach(col => doc.text(col.label, col.x + 1, y + 4.8));
    y += 7;

    // Linhas da tabela
    doc.setFont('helvetica', 'normal');
    filteredIncidents.forEach((incident, idx) => {
      if (y > 270) {
        doc.addPage();
        y = 14;
      }
      const rowBg = idx % 2 === 0 ? [248, 250, 252] : [255, 255, 255];
      doc.setFillColor(...rowBg);
      doc.rect(margin, y, pageW - margin * 2, 7, 'F');

      // Cor por tipo/status
      if (incident.tipo === 'offline' && !incident.resolvido) {
        doc.setTextColor(185, 28, 28);
      } else if (incident.tipo === 'restored' || incident.resolvido) {
        doc.setTextColor(4, 120, 87);
      } else {
        doc.setTextColor(51, 65, 85);
      }

      const tipo = incident.tipo === 'offline' ? 'Offline' : 'Restaurado';
      const status = incident.resolvido ? ' ✓' : '';
      const duracao = incident.duracao_minutos ? `${incident.duracao_minutos} min` : '-';
      const data = moment(incident.timestamp).format('DD/MM/YY HH:mm');

      const truncate = (str, max) => str?.length > max ? str.slice(0, max - 1) + '…' : (str || '-');

      doc.setFontSize(7);
      doc.text(truncate(incident.terminal_nome, 22), cols[0].x + 1, y + 4.8);
      doc.text(tipo + status, cols[1].x + 1, y + 4.8);
      doc.setTextColor(51, 65, 85);
      doc.text(truncate(incident.local, 20), cols[2].x + 1, y + 4.8);
      doc.text(truncate(incident.cliente, 20), cols[3].x + 1, y + 4.8);
      doc.text(data, cols[4].x + 1, y + 4.8);
      doc.text(duracao, cols[5].x + 1, y + 4.8);
      y += 7;
    });

    // Rodapé
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(7);
    doc.text('NOC Monitor — Relatório gerado automaticamente', margin, 292);
    doc.text(`Página 1`, pageW - margin, 292, { align: 'right' });

    const filename = `incidentes_${moment().format('YYYYMMDD_HHmm')}.pdf`;
    doc.save(filename);
  };

  const handleResolve = async (incident) => {
    setCheckingId(incident.id);
    setCheckError(null);
    try {
      const terminal = await base44.entities.Terminal.get(incident.terminal_id);
      if (!terminal || terminal.status !== 'online') {
        setCheckError(incident.id);
        setTimeout(() => setCheckError(null), 4000);
        return;
      }
      resolveMutation.mutate(incident);
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-6">
      <div className="max-w-[1920px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-3 rounded-xl shrink-0",
              stats.active > 0 ? "bg-red-100" : "bg-emerald-100"
            )}>
              {stats.active > 0 ? (
                <Bell className="h-5 w-5 sm:h-6 sm:w-6 text-red-600 animate-pulse" />
              ) : (
                <BellOff className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-600" />
              )}
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Incidentes</h1>
              <p className="text-xs sm:text-sm text-slate-500">Gerenciamento de alertas e incidentes</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPDF}
              disabled={filteredIncidents.length === 0}
              className="flex items-center gap-1.5"
            >
              <FileDown className="h-4 w-4" />
              <span className="hidden sm:inline">Exportar PDF</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="flex items-center gap-1.5"
            >
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className={cn(
              "bg-white/80 backdrop-blur-sm border-slate-200/50",
              stats.active > 0 && "border-red-200 bg-red-50/50"
            )}>
              <CardContent className="p-3 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className={cn(
                    "p-2 sm:p-3 rounded-xl w-fit",
                    stats.active > 0 ? "bg-red-100" : "bg-slate-100"
                  )}>
                    <AlertTriangle className={cn(
                      "h-4 w-4 sm:h-6 sm:w-6",
                      stats.active > 0 ? "text-red-600 animate-pulse" : "text-slate-400"
                    )} />
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">Ativos</p>
                    <p className={cn(
                      "text-2xl sm:text-3xl font-bold",
                      stats.active > 0 ? "text-red-600" : "text-slate-400"
                    )}>
                      {stats.active}
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
                  <div className="p-2 sm:p-3 bg-emerald-100 rounded-xl w-fit">
                    <CheckCircle className="h-4 w-4 sm:h-6 sm:w-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">Resolvidos</p>
                    <p className="text-2xl sm:text-3xl font-bold text-emerald-600">
                      {stats.resolved}
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
                  <div className="p-2 sm:p-3 bg-blue-100 rounded-xl w-fit">
                    <Clock className="h-4 w-4 sm:h-6 sm:w-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">Hoje</p>
                    <p className="text-2xl sm:text-3xl font-bold text-blue-600">
                      {stats.today}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3">
          <Tabs value={statusFilter} onValueChange={setStatusFilter}>
            <TabsList className="bg-white shadow-sm">
              <TabsTrigger value="all">Todos</TabsTrigger>
              <TabsTrigger value="active" className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                Ativos
              </TabsTrigger>
              <TabsTrigger value="resolved">Resolvidos</TabsTrigger>
            </TabsList>
          </Tabs>

          <Tabs value={tipoFilter} onValueChange={setTipoFilter}>
            <TabsList className="bg-white shadow-sm">
              <TabsTrigger value="all">Tipos</TabsTrigger>
              <TabsTrigger value="offline">Offline</TabsTrigger>
              <TabsTrigger value="restored">Restaurado</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Incidents List */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
              {filteredIncidents.length} incidente(s) encontrado(s)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {filteredIncidents.map((incident, index) => (
                  <motion.div
                    key={incident.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ delay: index * 0.02 }}
                    className={cn(
                      "relative overflow-hidden rounded-xl border p-5 transition-all",
                      incident.tipo === 'offline' && !incident.resolvido
                        ? "bg-red-50/50 border-red-200"
                        : incident.tipo === 'restored'
                          ? "bg-emerald-50/50 border-emerald-200"
                          : "bg-slate-50/50 border-slate-200"
                    )}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "rounded-xl p-3",
                          incident.tipo === 'offline' && !incident.resolvido
                            ? "bg-red-100 text-red-600"
                            : incident.tipo === 'restored'
                              ? "bg-emerald-100 text-emerald-600"
                              : "bg-slate-100 text-slate-600"
                        )}>
                          {incident.tipo === 'offline' && !incident.resolvido 
                            ? <AlertTriangle className="h-5 w-5" />
                            : <CheckCircle className="h-5 w-5" />
                          }
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-slate-900">
                              {incident.terminal_nome}
                            </p>
                            <Badge variant="outline" className={cn(
                              incident.tipo === 'offline' && !incident.resolvido
                                ? "border-red-300 text-red-700 bg-red-50"
                                : incident.tipo === 'restored'
                                  ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                                  : "border-slate-300 text-slate-700"
                            )}>
                              {incident.tipo === 'offline' ? 'Offline' : 'Restaurado'}
                            </Badge>
                            {incident.resolvido && (
                              <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50">
                                Resolvido
                              </Badge>
                            )}
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {incident.local}
                            </span>
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {incident.cliente}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-4 text-xs text-slate-400 mt-2">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {moment(incident.timestamp).format('DD/MM/YYYY HH:mm:ss')}
                            </span>
                            {incident.duracao_minutos && (
                              <span>
                                Duração: {incident.duracao_minutos} min
                              </span>
                            )}
                            {incident.resolvido_em && (
                              <span>
                                Resolvido em: {moment(incident.resolvido_em).format('DD/MM HH:mm')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {!incident.resolvido && incident.tipo === 'offline' && (
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className={cn(
                              checkError === incident.id
                                ? "border-red-300 text-red-700 hover:bg-red-50"
                                : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            )}
                            onClick={() => handleResolve(incident)}
                            disabled={checkingId === incident.id || resolveMutation.isPending}
                          >
                            {checkingId === incident.id
                              ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                              : <CheckCircle className="h-4 w-4 mr-1" />
                            }
                            {checkingId === incident.id ? 'A verificar...' : 'Resolver'}
                          </Button>
                          {checkError === incident.id && (
                            <p className="text-xs text-red-600 font-medium">Terminal ainda offline</p>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {filteredIncidents.length === 0 && (
                <div className="text-center py-12 text-slate-400">
                  <CheckCircle className="h-12 w-12 mx-auto mb-3" />
                  <p>Nenhum incidente encontrado</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}