import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ClipboardList, Search, Download, RefreshCw, Filter,
  Calendar, User, Monitor, Fingerprint, Loader2,
  Upload, CheckCircle2, XCircle, BarChart2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const MODO_LABELS = {
  fp: '🖐️ Impressão Digital',
  face: '😊 Facial',
  card: '💳 Cartão',
  pw: '🔑 Senha',
  1: '🖐️ FP', 3: '💳 Cartão', 8: '😊 Face', 15: '🔑 Senha',
};

const TIPO_COLORS = {
  entrada: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  saida:   'bg-rose-100 text-rose-700 border-rose-200',
  desconhecido: 'bg-slate-100 text-slate-600 border-slate-200',
};

export default function Marcacoes() {
  const [search, setSearch] = useState('');
  const [terminalFilter, setTerminalFilter] = useState('all');
  const [tipoFilter, setTipoFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [currentUser, setCurrentUser] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const isAdmin = currentUser?.role === 'admin';

  const { data: marcacoes = [], isLoading, refetch } = useQuery({
    queryKey: ['marcacoes', dateFrom, dateTo],
    queryFn: () => base44.entities.Marcacao.list('-timestamp', 500),
    enabled: !!currentUser,
    refetchInterval: 30000,
  });

  const { data: terminals = [] } = useQuery({
    queryKey: ['terminals-marcacoes'],
    queryFn: async () => {
      if (isAdmin) return base44.entities.Terminal.list('nome');
      const [a, b] = await Promise.all([
        base44.entities.Terminal.filter({ usuario_email: currentUser?.email }, 'nome'),
        base44.entities.Terminal.filter({ created_by: currentUser?.email }, 'nome'),
      ]);
      const seen = new Set();
      return [...a, ...b].filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
    },
    enabled: !!currentUser,
  });

  const { data: terminalUsers = [] } = useQuery({
    queryKey: ['terminal-users-map'],
    queryFn: () => base44.entities.TerminalUser.list('enrollid', 500),
    enabled: !!currentUser,
  });

  // Map enrollid → nome
  const userMap = useMemo(() => {
    const m = {};
    terminalUsers.forEach(u => { m[u.enrollid] = u.nome; });
    return m;
  }, [terminalUsers]);

  const filtered = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
    const to = dateTo ? new Date(dateTo + 'T23:59:59') : null;
    return marcacoes.filter(m => {
      const ts = m.timestamp ? new Date(m.timestamp) : null;
      if (from && ts && ts < from) return false;
      if (to && ts && ts > to) return false;
      if (terminalFilter !== 'all' && m.terminal_id !== terminalFilter) return false;
      if (tipoFilter !== 'all' && m.tipo !== tipoFilter) return false;
      if (search) {
        const name = m.utilizador_nome || userMap[m.enrollid] || '';
        if (!name.toLowerCase().includes(search.toLowerCase()) && !String(m.enrollid).includes(search)) return false;
      }
      return true;
    });
  }, [marcacoes, dateFrom, dateTo, terminalFilter, tipoFilter, search, userMap]);

  // Stats
  const stats = useMemo(() => ({
    total: filtered.length,
    entradas: filtered.filter(m => m.tipo === 'entrada').length,
    saidas: filtered.filter(m => m.tipo === 'saida').length,
    naoExportadas: filtered.filter(m => !m.exportado).length,
  }), [filtered]);

  // Recolher marcações de um terminal
  const handleCollect = async (terminal) => {
    setCollecting(terminal.id);
    try {
      const resp = await base44.functions.invoke('terminalControl', {
        terminal_id: terminal.id,
        action: 'getlogs',
      });
      const data = resp.data;
      if (data?.success && data.records?.length) {
        // Guardar marcações recolhidas
        const toSave = data.records.map(r => ({
          terminal_id: terminal.id,
          terminal_nome: terminal.nome,
          enrollid: r.enrollid,
          utilizador_nome: userMap[r.enrollid] || '',
          timestamp: r.time || new Date().toISOString(),
          modo: r.mode === 1 ? 'fp' : r.mode === 3 ? 'card' : r.mode === 8 ? 'face' : r.mode === 15 ? 'pw' : String(r.mode),
          raw_mode: r.mode,
          tipo: 'desconhecido',
          local: terminal.local || '',
          exportado: false,
        }));
        await base44.entities.Marcacao.bulkCreate(toSave);
        toast.success(`${toSave.length} marcação(ões) recolhida(s) de ${terminal.nome}`);
        refetch();
      } else {
        toast.info(data?.message || 'Sem novas marcações');
      }
    } catch (e) {
      toast.error(`Erro: ${e?.response?.data?.error || e.message}`);
    } finally {
      setCollecting(null);
    }
  };

  // Exportar para CSV
  const handleExportCSV = () => {
    const headers = ['Data/Hora', 'Terminal', 'ID Utilizador', 'Nome', 'Tipo', 'Modo', 'Local', 'Exportado'];
    const rows = filtered.map(m => [
      m.timestamp ? format(new Date(m.timestamp), 'dd/MM/yyyy HH:mm:ss') : '',
      m.terminal_nome || '',
      m.enrollid,
      m.utilizador_nome || userMap[m.enrollid] || '',
      m.tipo || '',
      m.modo || '',
      m.local || '',
      m.exportado ? 'Sim' : 'Não',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marcacoes_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exportado!');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 w-full overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-6xl">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-xl shrink-0">
              <ClipboardList className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Marcações</h1>
              <p className="text-xs sm:text-sm text-slate-500">Registos de ponto dos terminais biométricos</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={filtered.length === 0}>
              <Download className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Exportar CSV</span>
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total', value: stats.total, color: 'blue', icon: ClipboardList },
            { label: 'Entradas', value: stats.entradas, color: 'emerald', icon: User },
            { label: 'Saídas', value: stats.saidas, color: 'rose', icon: User },
            { label: 'Por Exportar', value: stats.naoExportadas, color: 'amber', icon: Upload },
          ].map(s => (
            <Card key={s.label} className="bg-white/80 border-slate-200/50">
              <CardContent className="p-3 flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-${s.color}-100`}>
                  <s.icon className={`h-4 w-4 text-${s.color}-600`} />
                </div>
                <div>
                  <p className="text-xs text-slate-500">{s.label}</p>
                  <p className="text-xl font-bold text-slate-800">{s.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Recolher de terminais */}
        {terminals.length > 0 && (
          <Card className="bg-white/80 border-slate-200/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Upload className="h-4 w-4 text-teal-600" />
                Recolher Marcações dos Terminais
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {terminals.map(t => (
                  <Button
                    key={t.id}
                    variant="outline"
                    size="sm"
                    disabled={collecting === t.id}
                    onClick={() => handleCollect(t)}
                    className={cn(
                      'text-xs gap-1.5',
                      t.status === 'online' ? 'border-emerald-300 text-emerald-700' : 'border-slate-200 text-slate-500'
                    )}
                  >
                    {collecting === t.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Download className="h-3 w-3" />
                    }
                    {t.nome}
                    {t.status === 'online' && <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card className="bg-white/80 border-slate-200/50">
          <CardContent className="p-3">
            <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Pesquisar utilizador ou ID..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="w-full sm:w-[150px]"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="w-full sm:w-[150px]"
              />
              <Select value={terminalFilter} onValueChange={setTerminalFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Terminal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os terminais</SelectItem>
                  {terminals.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={tipoFilter} onValueChange={setTipoFilter}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="entrada">Entrada</SelectItem>
                  <SelectItem value="saida">Saída</SelectItem>
                  <SelectItem value="desconhecido">Desconhecido</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : (
          <Card className="bg-white/80 border-slate-200/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Data/Hora</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Terminal</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase">ID</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Utilizador</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase hidden sm:table-cell">Modo</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Tipo</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase hidden md:table-cell">Exportado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.slice(0, 200).map((m, i) => {
                    const nome = m.utilizador_nome || userMap[m.enrollid] || `ID:${m.enrollid}`;
                    const modoLabel = MODO_LABELS[m.modo] || MODO_LABELS[m.raw_mode] || m.modo || '—';
                    return (
                      <tr key={m.id || i} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {m.timestamp ? format(new Date(m.timestamp), 'dd/MM/yy HH:mm:ss') : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-800 text-xs truncate max-w-[120px]">{m.terminal_nome || '—'}</p>
                          {m.local && <p className="text-xs text-slate-400 truncate">{m.local}</p>}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{m.enrollid}</td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-700 text-xs">{nome}</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500 hidden sm:table-cell">{modoLabel}</td>
                        <td className="px-4 py-2.5">
                          <Badge className={cn('text-xs', TIPO_COLORS[m.tipo] || TIPO_COLORS.desconhecido)}>
                            {m.tipo || 'desconhecido'}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 hidden md:table-cell">
                          {m.exportado
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            : <XCircle className="h-4 w-4 text-slate-300" />
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="py-12 text-center text-slate-400">
                  <ClipboardList className="h-10 w-10 mx-auto mb-2" />
                  <p>Sem marcações para o período selecionado</p>
                </div>
              )}
              {filtered.length > 200 && (
                <p className="text-center text-xs text-slate-400 py-2">A mostrar 200 de {filtered.length} registos. Use o filtro de datas para refinar.</p>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}