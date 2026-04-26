import React, { useState, useMemo, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    FileBarChart2, Download, TrendingUp, Activity,
    CheckCircle2, XCircle, Calendar, Printer, Loader2, X, User
} from 'lucide-react';
import html2canvas from 'html2canvas';
import {
    format, subDays, startOfDay, endOfDay, parseISO,
    eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval,
    addDays, addWeeks, addMonths, differenceInDays
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import UptimeTrendChart from '@/components/relatorios/UptimeTrendChart';
import IncidentsTrendChart from '@/components/relatorios/IncidentsTrendChart';
import AvailabilityHeatmap from '@/components/relatorios/AvailabilityHeatmap';
import { jsPDF } from 'jspdf';

export default function Relatorios() {
    const today = format(new Date(), 'yyyy-MM-dd');
    const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');

    const [dataInicio, setDataInicio] = useState(sevenDaysAgo);
    const [dataFim, setDataFim] = useState(today);
    const [userFilter, setUserFilter] = useState('all');
    const [currentUser, setCurrentUser] = useState(null);
    const [printing, setPrinting] = useState(false);
    const printRef = useRef();

    useEffect(() => {
        base44.auth.me().then(setCurrentUser).catch(() => {});
    }, []);

    const perms = resolvePermissions(currentUser);
    const canSeeAll = perms.isAdmin;

    const { data: allHistory = [], isLoading: historyLoading } = useQuery({
        queryKey: ['rel-history'],
        queryFn: () => base44.entities.StatusHistory.list('-timestamp', 2000),
        enabled: !!currentUser,
    });

    const { data: allTerminals = [] } = useQuery({
        queryKey: ['rel-terminals'],
        queryFn: () => base44.entities.Terminal.filter({ ativo: true }),
        enabled: !!currentUser,
    });

    const { data: allIncidents = [] } = useQuery({
        queryKey: ['rel-incidents'],
        queryFn: () => base44.entities.AlertIncident.list('-timestamp', 1000),
        enabled: !!currentUser,
    });

    const allUsersRelatorios = useMemo(() =>
        [...new Set(allTerminals.map(t => t.created_by).filter(Boolean))].sort(),
        [allTerminals]
    );

    const terminals = useMemo(() => {
        if (!currentUser) return [];
        if (canSeeAll) {
            if (userFilter !== 'all') return allTerminals.filter(t => t.created_by === userFilter);
            return allTerminals;
        }
        return allTerminals.filter(t => t.created_by === currentUser.email);
    }, [allTerminals, currentUser, canSeeAll, userFilter]);

    // Computed date range
    const { cutoff, cutoffEnd } = useMemo(() => {
        const c = dataInicio ? startOfDay(parseISO(dataInicio)) : startOfDay(subDays(new Date(), 7));
        const e = dataFim ? endOfDay(parseISO(dataFim)) : endOfDay(new Date());
        return { cutoff: c, cutoffEnd: e };
    }, [dataInicio, dataFim]);

    const history = useMemo(() => {
        if (!currentUser) return [];
        const myIds = canSeeAll ? null : new Set(terminals.map(t => t.id));
        return allHistory.filter(h => {
            if (myIds && !myIds.has(h.terminal_id)) return false;
            const t = new Date(h.timestamp);
            return t >= cutoff && t <= cutoffEnd;
        });
    }, [allHistory, currentUser, canSeeAll, terminals, cutoff, cutoffEnd]);

    const incidents = useMemo(() => {
        if (!currentUser) return [];
        const myIds = canSeeAll ? null : new Set(terminals.map(t => t.id));
        return allIncidents.filter(i => {
            if (myIds && !myIds.has(i.terminal_id)) return false;
            const t = new Date(i.timestamp);
            return t >= cutoff && t <= cutoffEnd;
        });
    }, [allIncidents, currentUser, canSeeAll, terminals, cutoff, cutoffEnd]);

    // Auto-select bucket size based on date range
    const { buckets, bucketSize } = useMemo(() => {
        const diff = differenceInDays(cutoffEnd, cutoff);
        const dailyBuckets = () => {
            const days = eachDayOfInterval({ start: cutoff, end: cutoffEnd });
            return days.map(d => ({ date: d, label: format(d, 'dd/MM', { locale: ptBR }) }));
        };
        const weeklyBuckets = () => {
            const weeks = eachWeekOfInterval({ start: cutoff, end: cutoffEnd });
            return weeks.map(d => ({ date: d, label: format(d, 'dd/MM', { locale: ptBR }) }));
        };
        const monthlyBuckets = () => {
            const months = eachMonthOfInterval({ start: cutoff, end: cutoffEnd });
            return months.map(d => ({ date: d, label: format(d, 'MMM yy', { locale: ptBR }) }));
        };

        if (diff <= 31)  return { bucketSize: 'day',   buckets: dailyBuckets() };
        if (diff <= 120) return { bucketSize: 'week',  buckets: weeklyBuckets() };
        return              { bucketSize: 'month', buckets: monthlyBuckets() };
    }, [cutoff, cutoffEnd]);

    const getBucketEnd = (date) => {
        if (bucketSize === 'day')   return addDays(date, 1);
        if (bucketSize === 'week')  return addWeeks(date, 1);
        return addMonths(date, 1);
    };

    const uptimeTrendData = useMemo(() => {
        return buckets.map(({ date, label }) => {
            const bucketStart = startOfDay(date);
            const bucketEnd = getBucketEnd(bucketStart);
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
    }, [buckets, history, terminals, bucketSize]);

    const incidentsTrendData = useMemo(() => {
        return buckets.map(({ date, label }) => {
            const bucketStart = startOfDay(date);
            const bucketEnd = getBucketEnd(bucketStart);
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
    }, [buckets, incidents, bucketSize]);

    const kpis = useMemo(() => {
        const totalOnline = history.filter(h => h.status === 'online').length;
        const avgUptime = history.length > 0 ? (totalOnline / history.length) * 100 : 0;
        const totalOfflineInc = incidents.filter(i => i.tipo === 'offline').length;
        const resolved = incidents.filter(i => i.tipo === 'offline' && i.resolvido).length;
        const withDuration = incidents.filter(i => i.tipo === 'offline' && i.duracao_minutos > 0);
        const avgMttr = withDuration.length > 0
            ? withDuration.reduce((a, b) => a + b.duracao_minutos, 0) / withDuration.length
            : 0;
        return { avgUptime, totalOfflineInc, resolved, avgMttr };
    }, [history, incidents]);

    const terminalRanking = useMemo(() => {
        return terminals.map(t => {
            const records = history.filter(h => h.terminal_id === t.id);
            const online = records.filter(h => h.status === 'online').length;
            const uptime = records.length > 0 ? (online / records.length) * 100 : null;
            const termIncidents = incidents.filter(i => i.terminal_id === t.id && i.tipo === 'offline');
            return { ...t, uptime, totalIncidents: termIncidents.length };
        }).sort((a, b) => (a.uptime ?? 101) - (b.uptime ?? 101));
    }, [terminals, history, incidents]);

    const periodLabel = dataInicio && dataFim
        ? `${format(parseISO(dataInicio), 'dd/MM/yyyy')} – ${format(parseISO(dataFim), 'dd/MM/yyyy')}`
        : 'Período personalizado';

    const handlePrint = async () => {
        setPrinting(true);
        try {
            const canvas = await html2canvas(printRef.current, {
                scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff',
            });
            const imgData = canvas.toDataURL('image/png');
            const win = window.open('', '_blank');
            win.document.write(`<!DOCTYPE html><html><head><title>Relatório NOC Monitor</title>
                <style>body{margin:0;padding:0;}img{width:100%;display:block;}
                @media print{@page{margin:0;size:A4 portrait;}body{margin:0;}}</style></head>
                <body><img src="${imgData}"/>
                <script>window.onload=function(){setTimeout(function(){window.print();window.close();},500);};</script>
                </body></html>`);
            win.document.close();
        } finally {
            setPrinting(false);
        }
    };

    const handleExportPDF = () => {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const now = format(new Date(), "dd/MM/yyyy HH:mm");

        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 210, 28, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('NOC Monitor — Relatório Analítico', 14, 12);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`Período: ${periodLabel}  |  Gerado em: ${now}`, 14, 21);

        doc.setTextColor(30, 30, 50);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Resumo Executivo', 14, 38);

        const kpiItems = [
            { label: 'Uptime Médio', value: `${kpis.avgUptime.toFixed(2)}%` },
            { label: 'Incidentes de Queda', value: `${kpis.totalOfflineInc}` },
            { label: 'Resolvidos', value: `${kpis.resolved}` },
            { label: 'MTTR Médio', value: kpis.avgMttr > 0 ? `${kpis.avgMttr.toFixed(0)} min` : 'N/A' },
            { label: 'Terminais', value: `${terminals.length}` },
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

        let y = 82;
        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 50);
        doc.text('Tendência de Incidentes', 14, y); y += 6;
        doc.setFillColor(241, 245, 249); doc.rect(14, y, 182, 7, 'F');
        doc.setFontSize(8); doc.setTextColor(71, 85, 105);
        doc.text('Período', 16, y + 5); doc.text('Quedas', 100, y + 5); doc.text('Restaurações', 145, y + 5);
        y += 8;
        incidentsTrendData.forEach((row, i) => {
            if (y > 270) { doc.addPage(); y = 20; }
            if (i % 2 === 0) { doc.setFillColor(250, 252, 254); doc.rect(14, y - 2, 182, 7, 'F'); }
            doc.setTextColor(30, 30, 50); doc.setFont('helvetica', 'normal');
            doc.text(row.label, 16, y + 3);
            doc.setTextColor(row.offline > 0 ? 239 : 30, row.offline > 0 ? 68 : 30, row.offline > 0 ? 68 : 50);
            doc.setFont('helvetica', 'bold'); doc.text(`${row.offline}`, 100, y + 3);
            doc.setTextColor(row.restored > 0 ? 16 : 30, row.restored > 0 ? 185 : 30, row.restored > 0 ? 129 : 50);
            doc.text(`${row.restored}`, 145, y + 3); y += 7;
        });

        doc.addPage(); y = 20;
        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 50);
        doc.text('Ranking de Uptime por Terminal', 14, y); y += 6;
        doc.setFillColor(241, 245, 249); doc.rect(14, y, 182, 7, 'F');
        doc.setFontSize(8); doc.setTextColor(71, 85, 105);
        doc.text('Terminal', 16, y + 5); doc.text('Local', 80, y + 5);
        doc.text('Uptime', 140, y + 5); doc.text('Incidentes', 168, y + 5); y += 8;
        terminalRanking.slice(0, 20).forEach((t, i) => {
            if (y > 270) { doc.addPage(); y = 20; }
            if (i % 2 === 0) { doc.setFillColor(250, 252, 254); doc.rect(14, y - 2, 182, 7, 'F'); }
            doc.setTextColor(30, 30, 50); doc.setFont('helvetica', 'normal');
            doc.text((t.nome || '').substring(0, 30), 16, y + 3);
            doc.text((t.local || '—').substring(0, 25), 80, y + 3);
            const upStr = t.uptime != null ? `${t.uptime.toFixed(1)}%` : 'N/A';
            if (t.uptime != null) {
                doc.setTextColor(t.uptime >= 99 ? 16 : t.uptime >= 95 ? 202 : 239,
                    t.uptime >= 99 ? 185 : t.uptime >= 95 ? 138 : 68,
                    t.uptime >= 99 ? 129 : t.uptime >= 95 ? 4 : 68);
            }
            doc.setFont('helvetica', 'bold'); doc.text(upStr, 140, y + 3);
            doc.setTextColor(30, 30, 50); doc.setFont('helvetica', 'normal');
            doc.text(`${t.totalIncidents}`, 172, y + 3); y += 7;
        });

        const pageCount = doc.getNumberOfPages();
        for (let p = 1; p <= pageCount; p++) {
            doc.setPage(p); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
            doc.text('NOC Monitor — Terminais Biométricos', 14, 290);
            doc.text(`Página ${p} de ${pageCount}  |  ${now}`, 140, 290);
        }
        doc.save(`relatorio-noc-${format(new Date(), 'yyyyMMdd')}.pdf`);
    };

    const loading = historyLoading && !history.length;

    return (
        <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-6xl overflow-x-hidden" ref={printRef}>
            {/* Header */}
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-violet-100 rounded-xl shrink-0">
                        <FileBarChart2 className="h-5 w-5 text-violet-600" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">Relatórios Analíticos</h1>
                        <p className="text-sm text-slate-500">Tendências de uptime e incidentes ao longo do tempo</p>
                    </div>
                </div>

                {/* Controls row */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
                    {/* Date range */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                        <Input
                            type="date"
                            value={dataInicio}
                            onChange={e => setDataInicio(e.target.value)}
                            className="flex-1 sm:w-[130px] text-sm bg-white"
                        />
                        <span className="text-slate-400 text-sm shrink-0">–</span>
                        <Input
                            type="date"
                            value={dataFim}
                            onChange={e => setDataFim(e.target.value)}
                            className="flex-1 sm:w-[130px] text-sm bg-white"
                        />
                        {(dataInicio !== sevenDaysAgo || dataFim !== today) && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                                onClick={() => { setDataInicio(sevenDaysAgo); setDataFim(today); }}>
                                <X className="h-4 w-4 text-slate-400" />
                            </Button>
                        )}
                    </div>
                    {/* Action buttons */}
                    <div className="flex gap-2 shrink-0 flex-wrap items-center">
                        {canSeeAll && allUsersRelatorios.length > 0 && (
                            <select
                                value={userFilter}
                                onChange={e => setUserFilter(e.target.value)}
                                className="h-9 px-3 rounded-md border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
                            >
                                <option value="all">Todos os utilizadores</option>
                                {allUsersRelatorios.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                        )}
                        <Button onClick={handlePrint} variant="outline" size="sm" className="gap-2 h-9" disabled={printing}>
                            {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                            <span className="hidden sm:inline">{printing ? 'A preparar...' : 'Imprimir'}</span>
                        </Button>
                        <Button onClick={handleExportPDF} variant="outline" size="sm" className="gap-2 h-9">
                            <Download className="h-4 w-4" />
                            <span className="hidden sm:inline">Exportar PDF</span>
                        </Button>
                    </div>
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
                            <p className={`text-xl sm:text-2xl font-bold mt-0.5 ${kpi.color}`}>{kpi.value}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Uptime Trend */}
            <Card className="bg-white border-slate-200">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-slate-700">Tendência de Uptime por Terminal</CardTitle>
                </CardHeader>
                <CardContent className="px-2 sm:px-6">
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
                <CardContent className="px-2 sm:px-6">
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
                <CardContent className="px-2 sm:px-6">
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
                                    <th className="text-left text-xs text-slate-500 font-medium px-3 sm:px-4 py-3">#</th>
                                    <th className="text-left text-xs text-slate-500 font-medium px-3 sm:px-4 py-3">Terminal</th>
                                    <th className="text-left text-xs text-slate-500 font-medium px-3 sm:px-4 py-3 hidden sm:table-cell">Local</th>
                                    <th className="text-right text-xs text-slate-500 font-medium px-3 sm:px-4 py-3">Uptime</th>
                                    <th className="text-right text-xs text-slate-500 font-medium px-3 sm:px-4 py-3">Inc.</th>
                                </tr>
                            </thead>
                            <tbody>
                                {terminalRanking.map((t, i) => (
                                    <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                        <td className="px-3 sm:px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
                                        <td className="px-3 sm:px-4 py-2.5 font-medium text-slate-800 max-w-[120px] sm:max-w-none truncate">{t.nome}</td>
                                        <td className="px-3 sm:px-4 py-2.5 text-slate-500 hidden sm:table-cell">{t.local || '—'}</td>
                                        <td className="px-3 sm:px-4 py-2.5 text-right">
                                            {t.uptime != null ? (
                                                <Badge variant="outline" className={
                                                    t.uptime >= 99 ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-xs' :
                                                    t.uptime >= 95 ? 'bg-yellow-50 text-yellow-700 border-yellow-200 text-xs' :
                                                    'bg-red-50 text-red-700 border-red-200 text-xs'
                                                }>
                                                    {t.uptime.toFixed(1)}%
                                                </Badge>
                                            ) : (
                                                <span className="text-slate-400 text-xs">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 sm:px-4 py-2.5 text-right">
                                            <span className={t.totalIncidents > 0 ? 'text-red-600 font-semibold text-sm' : 'text-slate-400 text-sm'}>
                                                {t.totalIncidents}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {terminalRanking.length === 0 && (
                            <div className="text-center py-12 text-slate-400 text-sm">Sem dados para o período selecionado</div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}