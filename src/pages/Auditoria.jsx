import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import { ClipboardList, Search, Filter, User, Calendar, RefreshCw, Download } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import moment from 'moment';

const ACAO_LABELS = {
  terminal_criado:     { label: 'Terminal Criado',     color: 'bg-emerald-100 text-emerald-700' },
  terminal_editado:    { label: 'Terminal Editado',     color: 'bg-blue-100 text-blue-700' },
  terminal_excluido:   { label: 'Terminal Excluído',    color: 'bg-red-100 text-red-700' },
  terminal_verificado: { label: 'Terminal Verificado',  color: 'bg-slate-100 text-slate-600' },
  incidente_resolvido: { label: 'Incidente Resolvido',  color: 'bg-emerald-100 text-emerald-700' },
  incidente_excluido:  { label: 'Incidente Excluído',   color: 'bg-red-100 text-red-700' },
  cliente_criado:      { label: 'Cliente Criado',       color: 'bg-purple-100 text-purple-700' },
  cliente_editado:     { label: 'Cliente Editado',      color: 'bg-blue-100 text-blue-700' },
  cliente_excluido:    { label: 'Cliente Excluído',     color: 'bg-red-100 text-red-700' },
  manutencao_criada:   { label: 'Manutenção Criada',    color: 'bg-orange-100 text-orange-700' },
  manutencao_editada:  { label: 'Manutenção Editada',   color: 'bg-blue-100 text-blue-700' },
  manutencao_cancelada:{ label: 'Manutenção Cancelada', color: 'bg-red-100 text-red-700' },
  alerta_criado:       { label: 'Alerta Criado',        color: 'bg-yellow-100 text-yellow-700' },
  alerta_editado:      { label: 'Alerta Editado',       color: 'bg-blue-100 text-blue-700' },
  alerta_excluido:     { label: 'Alerta Excluído',      color: 'bg-red-100 text-red-700' },
  alerta_ativado:      { label: 'Alerta Ativado',       color: 'bg-emerald-100 text-emerald-700' },
  alerta_desativado:   { label: 'Alerta Desativado',    color: 'bg-slate-100 text-slate-600' },
  api_key_gerada:      { label: 'API Key Gerada',       color: 'bg-indigo-100 text-indigo-700' },
  usuario_convidado:   { label: 'Utilizador Convidado', color: 'bg-purple-100 text-purple-700' },
  permissao_atualizada:{ label: 'Permissão Atualizada', color: 'bg-indigo-100 text-indigo-700' },
};

export default function Auditoria() {
  const [search, setSearch] = useState('');
  const [acaoFilter, setAcaoFilter] = useState('all');
  const [usuarioFilter, setUsuarioFilter] = useState('all');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms = resolvePermissions(currentUser);
  const isAdmin = perms.isAdmin;

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ['audit-logs', currentUser?.email],
    queryFn: () => base44.entities.AuditLog.list('-timestamp', 500),
    refetchInterval: 15000,
    enabled: !!currentUser,
  });

  const usuarios = useMemo(() =>
    [...new Set(logs.map(l => l.usuario_email).filter(Boolean))].sort(),
    [logs]
  );

  const filtered = useMemo(() => {
    return logs.filter(log => {
      if (acaoFilter !== 'all' && log.acao !== acaoFilter) return false;
      if (usuarioFilter !== 'all' && log.usuario_email !== usuarioFilter) return false;
      if (dataInicio && log.timestamp < dataInicio) return false;
      if (dataFim && log.timestamp > dataFim + 'T23:59:59') return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !log.usuario_email?.toLowerCase().includes(q) &&
          !log.descricao?.toLowerCase().includes(q) &&
          !log.entidade?.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [logs, acaoFilter, usuarioFilter, dataInicio, dataFim, search]);

  // Declarado APÓS filtered para evitar referência antes da declaração
  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const now = new Date().toLocaleString('pt-PT');

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 297, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('NOC Monitor — Auditoria', 10, 13);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Gerado em: ${now}  |  ${filtered.length} registros`, 160, 13);

    let y = 28;
    doc.setFillColor(241, 245, 249);
    doc.rect(10, y - 5, 277, 8, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Data/Hora', 12, y);
    doc.text('Utilizador', 55, y);
    doc.text('Ação', 115, y);
    doc.text('Descrição', 175, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    filtered.forEach((log, i) => {
      if (y > 185) { doc.addPage(); y = 20; }
      if (i % 2 === 0) {
        doc.setFillColor(250, 252, 254);
        doc.rect(10, y - 4, 277, 7, 'F');
      }
      doc.setTextColor(30, 30, 50);
      doc.setFontSize(7.5);
      doc.text((log.timestamp ? new Date(log.timestamp).toLocaleString('pt-PT') : '—').substring(0, 22), 12, y);
      doc.text((log.usuario_email || '—').substring(0, 30), 55, y);
      const acaoLabel = ACAO_LABELS[log.acao]?.label || log.acao || '—';
      doc.text(acaoLabel.substring(0, 25), 115, y);
      doc.text((log.descricao || '—').substring(0, 45), 175, y);
      y += 7;
    });

    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('NOC Monitor — Terminais Biométricos', 10, 200);
    doc.text(now, 220, 200);
    doc.save(`auditoria-noc-${new Date().toISOString().slice(0,10)}.pdf`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 w-full overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-6xl">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-slate-900 rounded-xl">
              <ClipboardList className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Auditoria</h1>
              <p className="text-sm text-slate-500">Registo de ações dos utilizadores no sistema</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={filtered.length === 0} className="gap-2">
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Exportar PDF</span>
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
          <CardContent className="p-3 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-wrap sm:flex-row sm:gap-3">
              <div className="relative w-full sm:flex-1 sm:min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Pesquisar por utilizador, descrição..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>

              <Select value={acaoFilter} onValueChange={setAcaoFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <Filter className="h-4 w-4 mr-2 text-slate-400 shrink-0" />
                  <SelectValue placeholder="Tipo de ação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as ações</SelectItem>
                  {Object.entries(ACAO_LABELS).map(([key, val]) => (
                    <SelectItem key={key} value={key}>{val.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {isAdmin && (
                <Select value={usuarioFilter} onValueChange={setUsuarioFilter}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <User className="h-4 w-4 mr-2 text-slate-400 shrink-0" />
                    <SelectValue placeholder="Utilizador" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os utilizadores</SelectItem>
                    {usuarios.map(u => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                <Input
                  type="date"
                  value={dataInicio}
                  onChange={e => setDataInicio(e.target.value)}
                  className="flex-1 sm:w-[130px] text-sm"
                />
                <span className="text-slate-400 text-sm shrink-0">–</span>
                <Input
                  type="date"
                  value={dataFim}
                  onChange={e => setDataFim(e.target.value)}
                  className="flex-1 sm:w-[130px] text-sm"
                />
              </div>

              {(search || acaoFilter !== 'all' || usuarioFilter !== 'all' || dataInicio || dataFim) && (
                <Button variant="ghost" size="sm" onClick={() => {
                  setSearch(''); setAcaoFilter('all'); setUsuarioFilter('all');
                  setDataInicio(''); setDataFim('');
                }} className="text-slate-500 w-full sm:w-auto">
                  Limpar filtros
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span className="font-medium text-slate-700">{filtered.length}</span> registos encontrados
          {filtered.length !== logs.length && <span>de {logs.length} total</span>}
        </div>

        {/* Logs — cards on mobile, table on desktop */}
        {isLoading ? (
          <div className="text-center py-8 text-slate-400">A carregar...</div>
        ) : filtered.length === 0 ? (
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
            <CardContent className="py-12 text-center text-slate-400">
              <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>Nenhum registo encontrado</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="sm:hidden space-y-2">
              {filtered.map(log => {
                const acaoInfo = ACAO_LABELS[log.acao] || { label: log.acao, color: 'bg-slate-100 text-slate-600' };
                return (
                  <Card key={log.id} className="bg-white/80 border-slate-200/50">
                    <CardContent className="p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Badge className={cn("text-xs shrink-0", acaoInfo.color)}>{acaoInfo.label}</Badge>
                        <span className="font-mono text-xs text-slate-400">{moment(log.timestamp).format('DD/MM/YY HH:mm')}</span>
                      </div>
                      <p className="text-xs text-slate-600 truncate">{log.usuario_email}</p>
                      {log.descricao && <p className="text-xs text-slate-500 line-clamp-2">{log.descricao}</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            {/* Desktop table */}
            <Card className="hidden sm:block bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Data/Hora</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Utilizador</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Ação</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600 hidden md:table-cell">Descrição</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600 hidden lg:table-cell">Entidade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filtered.map(log => {
                        const acaoInfo = ACAO_LABELS[log.acao] || { label: log.acao, color: 'bg-slate-100 text-slate-600' };
                        return (
                          <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">
                              {moment(log.timestamp).format('DD/MM/YY HH:mm:ss')}
                            </td>
                            <td className="px-4 py-3 text-slate-700 max-w-[160px] truncate">{log.usuario_email}</td>
                            <td className="px-4 py-3">
                              <Badge className={cn("text-xs whitespace-nowrap", acaoInfo.color)}>{acaoInfo.label}</Badge>
                            </td>
                            <td className="px-4 py-3 text-slate-600 hidden md:table-cell max-w-xs truncate">{log.descricao || '—'}</td>
                            <td className="px-4 py-3 text-slate-500 text-xs hidden lg:table-cell">
                              {log.entidade && (
                                <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                                  {log.entidade}{log.entidade_id ? ` #${log.entidade_id.slice(-6)}` : ''}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}