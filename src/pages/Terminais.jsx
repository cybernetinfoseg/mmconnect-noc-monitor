import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Monitor, Plus, Pencil, Trash2, Search, RefreshCw,
  Wifi, Globe, Server, Link, Clock, Activity
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import StatusBadge from '../components/dashboard/StatusBadge';
import TerminalFormDialog from '../components/terminais/TerminalFormDialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const TIPOS_CONEXAO = [
  { value: 'ip_local',   label: 'IP Local',    icon: Wifi },
  { value: 'ip_publico', label: 'IP Público',  icon: Globe },
  { value: 'dns',        label: 'DNS / No-IP', icon: Server },
  { value: 'api',        label: 'API HTTP',    icon: Link },
];

export default function Terminais() {
  const [searchTerm, setSearchTerm] = useState('');
  const [tipoFilter, setTipoFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTerminal, setEditingTerminal] = useState(null);
  const [verificandoTodos, setVerificandoTodos] = useState(false);

  const queryClient = useQueryClient();

  const { data: terminals = [], isLoading } = useQuery({
    queryKey: ['terminals-manage'],
    queryFn: () => base44.entities.Terminal.list('-created_date'),
    refetchInterval: 30000,
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Terminal.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['terminals-manage']);
      toast.success('Terminal excluído');
    },
    onError: () => toast.error('Erro ao excluir terminal'),
  });

  const monitorMutation = useMutation({
    mutationFn: async (terminal) => {
      const response = await base44.functions.invoke('monitorTerminal', { terminalId: terminal.id });
      return { data: response.data, terminal };
    },
    onSuccess: ({ data, terminal }) => {
      queryClient.invalidateQueries(['terminals-manage']);
      if (data?.status === 'online') {
        toast.success(`${terminal.nome}: ONLINE${data.latencia ? ` (${data.latencia}ms)` : ''}`);
      } else {
        toast.error(`${terminal.nome}: OFFLINE${data?.error ? ` - ${data.error}` : ''}`);
      }
    },
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  const verificarTodos = async () => {
    setVerificandoTodos(true);
    toast.info('Verificando todos os terminais...');
    try {
      const response = await base44.functions.invoke('monitorAllTerminals', {});
      queryClient.invalidateQueries(['terminals-manage']);
      const d = response.data;
      toast.success(`Verificação concluída: ${d.online ?? 0} online, ${d.offline ?? 0} offline`);
    } catch (error) {
      toast.error(`Erro: ${error.message}`);
    }
    setVerificandoTodos(false);
  };

  const filteredTerminals = useMemo(() => {
    return terminals.filter(t => {
      const matchSearch = !searchTerm ||
        t.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.local?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.cliente_nome?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchTipo = tipoFilter === 'all' || t.tipo_conexao === tipoFilter;
      return matchSearch && matchTipo;
    });
  }, [terminals, searchTerm, tipoFilter]);

  const getTipoInfo = (tipo) => TIPOS_CONEXAO.find(t => t.value === tipo) || { label: tipo, icon: Monitor };

  const getHostDisplay = (terminal) => {
    switch (terminal.tipo_conexao) {
      case 'ip_local':   return terminal.ip_local   ? `${terminal.ip_local}:${terminal.porta || 5005}` : '—';
      case 'ip_publico': return terminal.ip_publico ? `${terminal.ip_publico}:${terminal.porta || 5005}` : '—';
      case 'dns':        return terminal.dns        ? `${terminal.dns}:${terminal.porta || 5005}` : '—';
      case 'api':        return terminal.api_endpoint || '—';
      default:           return '—';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-6">
      <div className="max-w-[1920px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-xl shrink-0">
              <Monitor className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Gestão de Terminais</h1>
              <p className="text-xs sm:text-sm text-emerald-600 flex items-center gap-1">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0 inline-block"></span>
                TCP Socket • Auto-refresh 30s
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={verificarTodos} disabled={verificandoTodos || terminals.length === 0}
              variant="outline" size="sm" className="border-emerald-600 text-emerald-700 hover:bg-emerald-50">
              <RefreshCw className={cn("h-4 w-4 sm:mr-2", verificandoTodos && "animate-spin")} />
              <span className="hidden sm:inline">{verificandoTodos ? 'Verificando...' : 'Verificar Todos'}</span>
            </Button>
            <Button onClick={() => { setEditingTerminal(null); setDialogOpen(true); }} size="sm" className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Novo Terminal</span>
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input placeholder="Buscar por nome, local ou cliente..."
                    value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
                </div>
              </div>
              <Select value={tipoFilter} onValueChange={setTipoFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Tipo de conexão" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  {TIPOS_CONEXAO.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Terminals Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredTerminals.map((terminal, index) => {
              const tipoInfo = getTipoInfo(terminal.tipo_conexao);
              const TipoIcon = tipoInfo.icon;
              return (
                <motion.div key={terminal.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }} transition={{ delay: index * 0.02 }}>
                  <Card className={cn(
                    "bg-white/80 backdrop-blur-sm border-slate-200/50 hover:shadow-lg transition-all",
                    !terminal.ativo && "opacity-60"
                  )}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                            {terminal.nome}
                            {!terminal.ativo && <Badge variant="outline" className="text-xs">Inativo</Badge>}
                            {terminal.monitoramento_ativo === false && (
                              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Sem monitor</Badge>
                            )}
                          </CardTitle>
                          <p className="text-sm text-slate-500 mt-0.5">{terminal.local}</p>
                          {(terminal.fabricante || terminal.modelo) && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {[terminal.fabricante, terminal.modelo].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                        <StatusBadge status={terminal.status} pulse={false} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <TipoIcon className="h-4 w-4 text-slate-400 shrink-0" />
                        <span className="text-slate-600 font-medium">{tipoInfo.label}</span>
                      </div>
                      <div className="text-xs font-mono text-slate-500 bg-slate-50 rounded px-2 py-1 truncate">
                        {getHostDisplay(terminal)}
                      </div>
                      {terminal.cliente_nome && (
                        <div className="text-sm text-slate-600">
                          <span className="text-slate-500">Cliente:</span> {terminal.cliente_nome}
                        </div>
                      )}
                      {/* Monitoring config badges */}
                      <div className="flex gap-2 flex-wrap">
                        {terminal.timeout_segundos != null && (
                          <div className="flex items-center gap-1 text-xs text-slate-500">
                            <Clock className="h-3 w-3" />{terminal.timeout_segundos}s
                          </div>
                        )}
                        {terminal.intervalo_ping_segundos != null && (
                          <div className="flex items-center gap-1 text-xs text-slate-500">
                            <Activity className="h-3 w-3" />{terminal.intervalo_ping_segundos}s
                          </div>
                        )}
                        {terminal.latencia_ms != null && (
                          <div className="text-xs text-slate-500">{terminal.latencia_ms}ms</div>
                        )}
                      </div>
                      <div className="flex gap-2 pt-2 border-t border-slate-100">
                        <Button size="sm" variant="outline" onClick={() => monitorMutation.mutate(terminal)}
                          disabled={monitorMutation.isPending} className="flex-1">
                          <RefreshCw className={cn("h-3 w-3 mr-1", monitorMutation.isPending && "animate-spin")} />
                          Verificar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditingTerminal(terminal); setDialogOpen(true); }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="outline"
                          onClick={() => { if (confirm('Excluir este terminal?')) deleteMutation.mutate(terminal.id); }}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {filteredTerminals.length === 0 && !isLoading && (
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
            <CardContent className="py-12 text-center text-slate-400">
              <Monitor className="h-12 w-12 mx-auto mb-3" />
              <p>Nenhum terminal encontrado</p>
            </CardContent>
          </Card>
        )}
      </div>

      <TerminalFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingTerminal={editingTerminal}
        clientes={clientes}
      />
    </div>
  );
}