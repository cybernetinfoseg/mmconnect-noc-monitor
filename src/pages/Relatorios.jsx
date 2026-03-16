import React, { useState, useMemo, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { resolvePermissions } from '../components/auth/usePermissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
    FileBarChart2, Download, TrendingUp, AlertTriangle, Activity,
    CheckCircle2, XCircle, Calendar, Printer
} from 'lucide-react';
import { format, subDays, subWeeks, startOfDay, startOfWeek, startOfMonth, eachDayOfInterval, eachWeekOfInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import UptimeTrendChart from '@/components/relatorios/UptimeTrendChart';
import IncidentsTrendChart from '@/components/relatorios/IncidentsTrendChart';
import AvailabilityHeatmap from '@/components/relatorios/AvailabilityHeatmap';
import { jsPDF } from 'jspdf';

export default function Relatorios() {
    const [period, setPeriod] = useState('7d');
    const [currentUser, setCurrentUser] = useState(null);
    const printRef = useRef();

    useEffect(() => {
        base44.auth.me().then(setCurrentUser).catch(() => {});
    }, []);

    const perms = resolvePermissions(currentUser);
    const canSeeAll = perms.isAdmin || perms.isEditor;

    const { data: history = [], isLoading: historyLoading } = useQuery({
        queryKey: ['rel-history', period],
        queryFn: () => base44.entities.StatusHistory.list('-timestamp', 2000),
        enabled: !!currentUser,
    });

    const { data: allTerminals = [] } = useQuery({
        queryKey: ['rel-terminals'],
        queryFn: () => base44.entities.Terminal.filter({ ativo: true }),
        enabled: !!currentUser,
    });

    const { data: allIncidents = [] } = useQuery({
        queryKey: ['rel-incidents', period],
        queryFn: () => base44.entities.AlertIncident.list('-timestamp', 1000),
        enabled: !!currentUser,
    });

    const terminals = useMemo(() => {
        if (!currentUser) return [];
        if (canSeeAll) return allTerminals;
        return allTerminals.filter(t => t.created_by === currentUser.email);
    }, [allTerminals, currentUser, canSeeAll]);

    const incidents = useMemo(() => {
        if (!currentUser) return [];
        if (canSeeAll) return allIncidents;
        const myIds = new Set(terminals.map(t => t.id));
        return allIncidents.filter(i => myIds.has(i.terminal_id));
    }, [allIncidents, currentUser, canSeeAll, terminals]);

    // Define buckets based on period
    const { buckets, bucketFormat, cutoff } = useMemo(() => {
        const now = new Date();
        if (period === '7d') {
            const cut = subDays(now, 7);
            const days = eachDayOfInterval({ start: cut, end: now });
            return {
                cutoff: cut,
                bucketFormat: (d) => format(d, 'EEE dd/MM', { locale: ptBR }),
                buckets: days.map(d => ({ date: d, label: format(d, 'EEE dd', { locale: ptBR }) })),
            };
        } else {
            const cut = subDays(now, 30);
            const weeks = eachWeekOfInterval({ start: cut, end: now });
            return {
                cutoff: cut,
                bucketFormat: (d) => format(d, "'Sem' II", { locale: ptBR }),
                buckets: weeks.map(d => ({ date: d, label: format(d, "dd/MM", { locale: ptBR }) })),
            };
        }
    }, [period]);

    // Uptime trend data per bucket per terminal
    const uptimeTrendData = useMemo(() => {
        return buckets.map(({ date, label }) => {
            const bucketStart = startOfDay(date);
            const bucketEnd = new Date(bucketStart.getTime() + (period === '7d' ? 86400000 : 7 * 86400000));
            const bucketHistory = history.filter(h => {
                const t = new Date(h.timestamp);
                return t >= bucketStart && t < bucketEnd;
            });

            const row = { label };
            terminals.forEach(t => {
                const termRecords = bucketHistory.filter(h => h.terminal_id === t.id);
                if (termRecords.length === 0) { row[t.id] = null; return; }
                const online = termRecords.filter(h => h.status === 'online').length;
                row[t.id] = (online / termRecords.length) * 100;
            });
            return row;
        });
    }, [buckets, history, terminals, period]);

    // Incidents trend per bucket
    const incidentsTrendData = useMemo(() => {
        return buckets.map(({ date, label }) => {
            const bucketStart = startOfDay(date);
            const bucketEnd = new Date(bucketStart.getTime() + (period === '7d' ? 86400000 : 7 * 86400000));
            const bucketIncidents = incidents.filter(inc => {
                const t = new Date(inc.timestamp);
                return t >= bucketStart && t < bucketEnd;
            });
            return {
                label,
                offline: bucketIncidents.filter(i => i.tipo === 'offline').length,
                restored: bucketIncidents.filter(i => i.tipo === 'restored').length,
            };
        });
    }, [buckets, incidents, period]);

    // Summary KPIs
    const kpis = useMemo(() => {
        const filtered = history.filter(h => new Date(h.timestamp) >= cutoff);
        const totalOnline = filtered.filter(h => h.status === 'online').length;
        const avgUptime = filtered.length > 0 ? (totalOnline / filtered.length) * 100 : 0;

        const filteredInc = incidents.filter(i => new Date(i.timestamp) >= cutoff);
        const totalOfflineInc = filteredInc.filter(i => i.tipo === 'offline').length;
        const resolved = filteredInc.filter(i => i.tipo === 'offline' && i.resolvido).length;

        // MTTR: média de duração dos incidentes resolvidos
        const withDuration = filteredInc.filter(i => i.tipo === 'offline' && i.duracao_minutos > 0);
        const avgMttr = withDuration.length > 0
            ? withDuration.reduce((a, b) => a + b.duracao_minutos, 0) / withDuration.length
            : 0;

        return { avgUptime, totalOfflineInc, resolved, avgMttr };
    }, [history, incidents, cutoff]);

    // Terminal uptime ranking
    const terminalRanking = useMemo(() => {
        return terminals.map(t => {
            const records = history.filter(h => h.terminal_id === t.id && new Date(h.timestamp) >= cutoff);
            const online = records.filter(h => h.status === 'online').length;
            const uptime = records.length > 0 ? (online / records.length) * 100 : null;
            const termIncidents = incidents.filter(i => i.terminal_id === t.id && new Date(i.timestamp) >= cutoff && i.tipo === 'offline');
            return { ...t, uptime, totalIncidents: termIncidents.length };
        }).sort((a, b) => (a.uptime ?? 101) - (b.uptime ?? 101));
    }, [terminals, history, incidents, cutoff]);

    // PDF Export
    const handleExportPDF = async () => {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const now = format(new Date(), "dd/MM/yyyy HH:mm");
        const periodLabel = period === '7d' ? 'Últimos 7 dias' : 'Últimos 30 dias';

        // Header
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 210, 28, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('NOC Monitor — Relatório Analítico', 14, 12);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`Período: ${periodLabel}  |  Gerado em: ${now}`, 14, 21);

        // KPIs
        doc.setTextColor(30, 30, 50);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Resumo Executivo', 14, 38);

        const kpiItems = [
            { label: 'Uptime Médio', value: `${kpis.avgUptime.toFixed(2)}%` },
            { label: 'Incidentes de Queda', value: `${kpis.totalOfflineInc}` },
            { label: 'Incidentes Resolvidos', value: `${kpis.resolved}` },
            { label: 'MTTR Médio', value: kpis.avgMttr > 0 ? `${kpis.avgMttr.toFixed(0)} min` : 'N/A' },
            { label: 'Terminais Monitorados', value: `${terminals.length}` },
        ];

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        kpiItems.forEach((k, i) => {
            const x = 14 + (i % 3) * 62;
            const y = 46 + Math.floor(i / 3) * 14;
            doc.setFillColor(248, 250, 252);
            doc.roundedRect(x, y - 5, 58, 12, 2, 2, 'F');
            doc.setTextColor(100, 116, 139);
            doc.text(k.label, x + 3, y + 1);
            doc.setTextColor(15, 23, 42);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.text(k.value, x + 3, y + 7);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
        });

        // Terminal Ranking
        let y = 82;
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 50);
        doc.text('Ranking de Uptime por Terminal', 14, y);
        y += 6;

        // Table header
        doc.setFillColor(241, 245, 249);
        doc.rect(14, y, 182, 7, 'F');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text('Terminal', 16, y + 5);
        doc.text('Local', 80, y + 5);
        doc.text('Uptime', 140, y + 5);
        doc.text('Incidentes', 168, y + 5);
        y += 8;

        terminalRanking.slice(0, 20).forEach((t, i) => {
            if (y > 270) { doc.addPage(); y = 20; }
            if (i % 2 === 0) {
                doc.setFillColor(250, 252, 254);
                doc.rect(14, y - 2, 182, 7, 'F');
            }
            doc.setTextColor(30, 30, 50);
            doc.setFont('helvetica', 'normal');
            doc.text((t.nome || '').substring(0, 30), 16, y + 3);
            doc.text((t.local || '—').substring(0, 25), 80, y + 3);

            const upStr = t.uptime != null ? `${t.uptime.toFixed(1)}%` : 'N/A';
            if (t.uptime != null) {
                doc.setTextColor(t.uptime >= 99 ? 16 : t.uptime >= 95 ? 202 : 239,
                    t.uptime >= 99 ? 185 : t.uptime >= 95 ? 138 : 68,
                    t.uptime >= 99 ? 129 : t.uptime >= 95 ? 4 : 68);
            }
            doc.setFont('helvetica', 'bold');
            doc.text(upStr, 140, y + 3);
            doc.setTextColor(30, 30, 50);
            doc.setFont('helvetica', 'normal');
            doc.text(`${t.totalIncidents}`, 172, y + 3);
            y += 7;
        });

        // Footer
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.text('NOC Monitor — Terminais Biométricos', 14, 290);
        doc.text(`Página 1  |  ${now}`, 160, 290);

        doc.save(`relatorio-noc-${period}-${format(new Date(), 'yyyyMMdd')}.pdf`);
    };

    const loading = historyLoading && !history.length;

    return (
        <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-6" ref={printRef}>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-violet-100 rounded-xl">
                        <FileBarChart2 className="h-5 w-5 text-violet-600" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">Relatórios Analíticos</h1>
                        <p className="text-sm text-slate-500">Tendências de uptime e incidentes ao longo do tempo</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <Tabs value={period} onValueChange={setPeriod}>
                        <TabsList className="bg-white shadow-sm border border-slate-200">
                            <TabsTrigger value="7d" className="text-xs gap-1.5">
                                <Calendar className="h-3.5 w-3.5" />7 dias
                            </TabsTrigger>
                            <TabsTrigger value="30d" className="text-xs gap-1.5">
                                <Calendar className="h-3.5 w-3.5" />30 dias
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <Button onClick={handleExportPDF} variant="outline" size="sm" className="gap-2">
                        <Download className="h-4 w-4" />
                        <span className="hidden sm:inline">Exportar PDF</span>
                        <span className="sm:hidden">PDF</span>
                    </Button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                    { label: 'Uptime Médio', value: `${kpis.avgUptime.toFixed(1)}%`, icon: TrendingUp, color: kpis.avgUptime >= 99 ? 'text-emerald-600' : kpis.avgUptime >= 95 ? 'text-yellow-600' : 'text-red-600', bg: kpis.avgUptime >= 99 ? 'bg-emerald-50' : kpis.avgUptime >= 95 ? 'bg-yellow-50' : 'bg-red-50' },
                    { label: 'Quedas', value: kpis.totalOfflineInc, icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
                    { label: 'Restaurações', value: kpis.resolved, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                    { label: 'MTTR Médio', value: kpis.avgMttr > 0 ? `${Math.round(kpis.avgMttr)}min` : 'N/A', icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50' },
                ].map((kpi, i) => (
                    <Card key={i} className="bg-white border-slate-200">
                        <CardContent className="p-4">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${kpi.bg}`}>
                                <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                            </div>
                            <p className="text-xs text-slate-500">{kpi.label}</p>
                            <p className={`text-2xl font-bold mt-0.5 ${kpi.color}`}>{kpi.value}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Uptime Trend */}
            <Card className="bg-white border-slate-200">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-slate-700">Tendência de Uptime por Terminal</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="h-64 flex items-center justify-center text-slate-400 text-sm">A carregar...</div>
                    ) : (
                        <UptimeTrendChart data={uptimeTrendData} terminals={terminals} />
                    )}
                </CardContent>
            </Card>

            {/* Incidents Trend */}
            <Card className="bg-white border-slate-200">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-slate-700">Incidentes ao Longo do Tempo</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="h-64 flex items-center justify-center text-slate-400 text-sm">A carregar...</div>
                    ) : (
                        <IncidentsTrendChart data={incidentsTrendData} />
                    )}
                </CardContent>
            </Card>

            {/* Availability Heatmap */}
            <Card className="bg-white border-slate-200">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-slate-700">
                        Mapa de Disponibilidade
                        <span className="ml-2 text-xs font-normal text-slate-400">(% uptime por período)</span>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="h-32 flex items-center justify-center text-slate-400 text-sm">A carregar...</div>
                    ) : (
                        <AvailabilityHeatmap
                            data={uptimeTrendData}
                            terminals={terminals}
                            labels={buckets.map(b => b.label)}
                        />
                    )}
                </CardContent>
            </Card>

            {/* Terminal Ranking Table */}
            <Card className="bg-white border-slate-200">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-slate-700">Ranking de Terminais</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-100 bg-slate-50">
                                    <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">#</th>
                                    <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Terminal</th>
                                    <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden sm:table-cell">Local</th>
                                    <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden md:table-cell">Cliente</th>
                                    <th className="text-right text-xs text-slate-500 font-medium px-4 py-3">Uptime</th>
                                    <th className="text-right text-xs text-slate-500 font-medium px-4 py-3">Incidentes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {terminalRanking.map((t, i) => (
                                    <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                        <td className="px-4 py-3 text-slate-400 text-xs">{i + 1}</td>
                                        <td className="px-4 py-3 font-medium text-slate-800">{t.nome}</td>
                                        <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{t.local || '—'}</td>
                                        <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{t.cliente_nome || '—'}</td>
                                        <td className="px-4 py-3 text-right">
                                            {t.uptime != null ? (
                                                <Badge variant="outline" className={
                                                    t.uptime >= 99 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                    t.uptime >= 95 ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                                    'bg-red-50 text-red-700 border-red-200'
                                                }>
                                                    {t.uptime.toFixed(1)}%
                                                </Badge>
                                            ) : (
                                                <span className="text-slate-400 text-xs">Sem dados</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className={t.totalIncidents > 0 ? 'text-red-600 font-semibold' : 'text-slate-400'}>
                                                {t.totalIncidents}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {terminalRanking.length === 0 && (
                            <div className="text-center py-12 text-slate-400 text-sm">Sem dados para o período</div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}