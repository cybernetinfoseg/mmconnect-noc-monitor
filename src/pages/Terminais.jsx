import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTerminals, TERMINALS_QUERY_KEY } from '@/hooks/useTerminals';
import LocalSelectField from '../components/terminais/LocalSelectField';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Monitor, 
  Plus, 
  Pencil, 
  Trash2, 
  Search,
  RefreshCw,
  Wifi,
  Globe,
  Server,
  AlertTriangle,
  Eye
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import TerminalDetailModal from '../components/tv/TerminalDetailModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import StatusBadge from '../components/dashboard/StatusBadge';
import TerminalControlPanel from '../components/terminais/TerminalControlPanel';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import { User as UserIcon, Zap } from 'lucide-react';

export default function Terminais() {
  const [searchTerm, setSearchTerm] = useState('');
  const [tipoFilter, setTipoFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');

  // Limpar filtros ao montar a página (evita persistência ao navegar)
  useEffect(() => {
    setSearchTerm('');
    setTipoFilter('all');
    setStatusFilter('all');
    setUserFilter('all');
  }, []);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTerminal, setEditingTerminal] = useState(null);
  const [formData, setFormData] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms = resolvePermissions(currentUser);
  const isAdmin = perms.isAdmin;
  const limiteTerminais = perms.limite_terminais;

  // Terminais — hook centralizado, query key partilhada com todas as páginas
  const { data: terminals = [], isLoading } = useTerminals({ enabled: !!currentUser });

  const terminalCount = terminals.length;
  // limiteTerminais === 0 significa "sem permissão para adicionar" (igual à lógica do backend)
  const atLimit = !isAdmin && terminalCount >= limiteTerminais;


  const logAudit = (acao, entidade_id, descricao) =>
    base44.functions.invoke('auditLog', { acao, entidade: 'Terminal', entidade_id, descricao }).catch(() => {});

  const saveMutation = useMutation({
     mutationFn: async (data) => {
       const response = await base44.functions.invoke('saveTerminal', {
         terminalId: editingTerminal?.id || null,
         data: editingTerminal ? data : { ...data, usuario_email: data.usuario_email || currentUser?.email },
       });
       return response.data?.terminal;
     },
     onMutate: async (data) => {
       await queryClient.cancelQueries({ queryKey: TERMINALS_QUERY_KEY });
        const prev = queryClient.getQueryData(TERMINALS_QUERY_KEY);
        if (editingTerminal) {
          queryClient.setQueryData(TERMINALS_QUERY_KEY, (old = []) =>
            old.map(t => t.id === editingTerminal.id ? { ...t, ...data } : t)
          );
        } else {
          queryClient.setQueryData(TERMINALS_QUERY_KEY, (old = []) => [
            ...old,
            { ...data, id: 'temp_' + Date.now(), usuario_email: data.usuario_email || currentUser?.email, status: 'offline' }
          ]);
        }
        return { prev };
       },
       onSuccess: async (result, data) => {
        const isEdit = !!editingTerminal;
        const nome = data.nome || editingTerminal?.nome || '';
        const terminalId = editingTerminal?.id || result?.id || '';
        logAudit(
          isEdit ? 'terminal_editado' : 'terminal_criado',
          terminalId,
          isEdit ? `Terminal "${nome}" editado` : `Terminal "${nome}" criado`
        );
        setDialogOpen(false);
        setEditingTerminal(null);
        setFormData({});
        toast.success(isEdit ? 'Terminal atualizado' : 'Terminal criado');
        const tipo = data.tipo_conexao || 'ip_local';
        if (tipo !== 'ip_local' && terminalId) {
          await base44.functions.invoke('monitorTerminal', { terminalId }).catch(() => {});
        }
        queryClient.invalidateQueries({ queryKey: TERMINALS_QUERY_KEY });
       },
       onError: (error, _, context) => {
        if (context?.prev) {
          queryClient.setQueryData(TERMINALS_QUERY_KEY, context.prev);
        }
       toast.error(`Erro: ${error.message}`);
     },
   });

  const deleteMutation = useMutation({
     mutationFn: (id) => base44.functions.invoke('deleteTerminal', { terminalId: id }),
     onMutate: async (id) => {
       await queryClient.cancelQueries({ queryKey: TERMINALS_QUERY_KEY });
       const prev = queryClient.getQueryData(TERMINALS_QUERY_KEY);
       queryClient.setQueryData(TERMINALS_QUERY_KEY, (old = []) =>
         old.filter(t => t.id !== id)
       );
       return { prev };
     },
     onSuccess: async (_, id) => {
       const terminal = terminals.find(t => t.id === id);
       logAudit('terminal_excluido', id, `Terminal "${terminal?.nome || id}" excluído`);
       toast.success('Terminal eliminado');
       await queryClient.invalidateQueries({ queryKey: TERMINALS_QUERY_KEY });
     },
     onError: (error, _, context) => {
       if (context?.prev) {
         queryClient.setQueryData(TERMINALS_QUERY_KEY, context.prev);
       }
       toast.error('Erro ao eliminar terminal');
     },
   });

  const [refreshingTerminalId, setRefreshingTerminalId] = useState(null);

  const monitorMutation = useMutation({
     mutationFn: async (terminal) => {
       setRefreshingTerminalId(terminal.id);
       if (terminal.tipo_conexao === 'ip_local') {
         return { success: true, status: terminal.status, info: 'ip_local usa agente local' };
       }
       const response = await base44.functions.invoke('monitorTerminal', { terminalId: terminal.id });
       return response.data;
     },
     onMutate: async (terminal) => {
       await queryClient.cancelQueries({ queryKey: TERMINALS_QUERY_KEY });
       const prev = queryClient.getQueryData(TERMINALS_QUERY_KEY);
       queryClient.setQueryData(TERMINALS_QUERY_KEY, (old = []) =>
         old.map(t => t.id === terminal.id ? { ...t, status: 'loading' } : t)
       );
       return { prev };
     },
     onSuccess: (data, terminal) => {
       setRefreshingTerminalId(null);
       if (data?.status) {
         queryClient.setQueryData(TERMINALS_QUERY_KEY, (old = []) =>
           old.map(t => t.id === terminal.id ? { ...t, status: data.status, latencia_ms: data.latencia } : t)
         );
       }
       if (data?.success) {
         if (data.status === 'online') {
           toast.success(`${terminal.nome}: ✅ ONLINE${data.latencia ? ' (' + data.latencia + 'ms)' : ''}`);
         } else {
           toast.error(`${terminal.nome}: ❌ OFFLINE${data.error ? ' - ' + data.error : ''}`);
         }
       } else if (data?.error) {
         toast.info(`${terminal.nome}: ${data.error}`);
       }
     },
     onError: (error, _, context) => {
       setRefreshingTerminalId(null);
       if (context?.prev) {
         queryClient.setQueryData(TERMINALS_QUERY_KEY, context.prev);
       }
       toast.error(`Erro: ${error.message}`);
     },
   });

  const [selectedTerminal, setSelectedTerminal] = useState(null);
  const [controlTerminal, setControlTerminal] = useState(null);

  const { data: locaisDB = [], refetch: refetchLocais } = useQuery({
    queryKey: ['locais', currentUser?.email],
    queryFn: () => base44.entities.Local.list('nome'),
    enabled: !!currentUser,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users-for-assign'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!currentUser && isAdmin,
  });



  const [verificandoTodos, setVerificandoTodos] = useState(false);
  const verificarTodos = async () => {
    setVerificandoTodos(true);
    const terminaisAtivos = terminals.filter(t => t.ativo);
    for (const terminal of terminaisAtivos) {
      await base44.functions.invoke('monitorTerminal', { terminalId: terminal.id }).catch(() => {});
    }
    queryClient.invalidateQueries({ queryKey: TERMINALS_QUERY_KEY });
    setVerificandoTodos(false);
    toast.success('Verificação concluída!');
  };

  const usuarios = useMemo(() =>
    [...new Set(terminals.map(t => t.usuario_email || t.created_by).filter(Boolean))].sort(),
    [terminals]
  );

  const filteredTerminals = useMemo(() => {
    return terminals.filter(t => {
      const matchSearch = !searchTerm || 
        t.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.local?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.cliente_nome?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchTipo = tipoFilter === 'all' || t.tipo_conexao === tipoFilter;
      const matchStatus = statusFilter === 'all' || t.status === statusFilter;
      const matchUser = userFilter === 'all' || (t.usuario_email || t.created_by) === userFilter;
      return matchSearch && matchTipo && matchStatus && matchUser;
    });
  }, [terminals, searchTerm, tipoFilter, statusFilter, userFilter]);

  const handleEdit = (terminal) => {
    setEditingTerminal(terminal);
    setFormData(terminal);
    setDialogOpen(true);
  };

  const handleNew = () => {
    if (atLimit) {
      toast.error(`Limite de ${limiteTerminais} terminais atingido. Contacte o administrador.`);
      return;
    }
    setEditingTerminal(null);
    setFormData({ tipo_conexao: 'ip_local', porta: 5005, ativo: true, usuario_email: currentUser?.email });
    setDialogOpen(true);
  };

  const handleDelete = (id) => {
    setDeleteConfirmId(id);
  };

  const getTipoIcon = (tipo) => {
    switch (tipo) {
      case 'ip_local': return Wifi;
      case 'ip_publico': return Globe;
      default: return Server;
    }
  };

  const getTipoLabel = (tipo) => {
    const labels = { ip_local: 'IP Local', ip_publico: 'IP Público', dns: 'DNS/No-IP', p2s: 'P2S VPN', heartbeat: 'Heartbeat TCP', adms_push: 'ADMS/Push', sdk_tcp: 'SDK-TCP', websocket_cloud: 'WebSocket Cloud', api: 'API' };
    return labels[tipo] || tipo;
  };

  const getConexaoEndereco = (terminal) => {
    switch (terminal.tipo_conexao) {
      case 'ip_local': return terminal.ip_local ? `${terminal.ip_local}:${terminal.porta || 5005}` : null;
      case 'ip_publico': return terminal.ip_publico ? `${terminal.ip_publico}:${terminal.porta || 5005}` : null;
      case 'dns': return terminal.dns ? `${terminal.dns}:${terminal.porta || 5005}` : null;
      case 'p2s': return `Escuta TCP :${terminal.porta || 5005}`;
      case 'heartbeat': return `${terminal.ip_publico || '127.0.0.1'}:${terminal.porta || 5005}`;
      case 'adms_push': return terminal.numero_serie ? `SN: ${terminal.numero_serie} | ADMS :8080` : 'ADMS :8080 (sem SN)';
      case 'sdk_tcp': return terminal.ip_publico ? `${terminal.ip_publico}:${terminal.porta || 5005}` : null;
      case 'websocket_cloud': return terminal.numero_serie ? `SN: ${terminal.numero_serie} | WS :${terminal.porta || 7788}` : `WS :${terminal.porta || 7788} (sem SN)`;
      case 'api': return terminal.api_endpoint || null;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 w-full overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-[1920px]">
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
                Auto-refresh
                <span className="ml-2 font-semibold text-slate-600">
                  • {filteredTerminals.length !== terminalCount ? `${filteredTerminals.length} de ` : ''}{terminalCount} terminal{terminalCount !== 1 ? 'is' : ''}
                </span>
                {!isAdmin && (
                  <span className={cn("ml-2 font-semibold", atLimit ? "text-red-600" : "text-slate-500")}>
                    • {terminalCount}/{limiteTerminais === 0 ? '0' : limiteTerminais} terminais
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={verificarTodos}
              disabled={verificandoTodos || terminals.length === 0}
              variant="outline"
              size="sm"
              className="border-emerald-600 text-emerald-700 hover:bg-emerald-50"
            >
              <RefreshCw className={cn("h-4 w-4 sm:mr-2", verificandoTodos && "animate-spin")} />
              <span className="hidden sm:inline">{verificandoTodos ? 'A verificar...' : 'Verificar Tudo'}</span>
            </Button>
            <Button
              onClick={handleNew}
              size="sm"
              className={cn("bg-blue-600 hover:bg-blue-700", atLimit && "opacity-50 cursor-not-allowed")}
            >
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Novo Terminal</span>
            </Button>
          </div>
        </div>

        {/* Limit warning */}
        {atLimit && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Atingiu o limite de {limiteTerminais} terminais. Contacte o administrador para aumentar o seu limite.
          </div>
        )}

        {/* Filters */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
           <CardContent className="p-3 sm:p-4 space-y-3">
             <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3">
               <div className="w-full sm:flex-1 sm:min-w-[180px] relative">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                 <Input
                   placeholder="Pesquisar por nome ou local..."
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                   className="pl-10"
                 />
               </div>
               <Select value={tipoFilter} onValueChange={setTipoFilter}>
                 <SelectTrigger className="w-full sm:w-[160px]">
                   <SelectValue placeholder="Tipo de conexão" />
                 </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="ip_local">IP Local</SelectItem>
                  <SelectItem value="ip_publico">IP Público</SelectItem>
                  <SelectItem value="dns">DNS/No-IP</SelectItem>
                  <SelectItem value="p2s">P2S VPN</SelectItem>
                  <SelectItem value="heartbeat">Heartbeat TCP</SelectItem>
                  <SelectItem value="adms_push">ADMS / Push</SelectItem>
                  <SelectItem value="sdk_tcp">SDK-TCP</SelectItem>
                  <SelectItem value="websocket_cloud">WebSocket Cloud</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                </SelectContent>
              </Select>
              {isAdmin && (
                 <select
                   value={userFilter}
                   onChange={(e) => setUserFilter(e.target.value)}
                   className="h-9 w-full sm:w-auto rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                 >
                  <option value="all">Todos os utilizadores</option>
                  {usuarios.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Status filter badges + clear */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Status:</span>
              {['all', 'online', 'offline'].map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-semibold select-none transition-colors border",
                    statusFilter === s
                      ? s === 'online'
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : s === 'offline'
                          ? "bg-red-600 text-white border-red-600"
                          : "bg-slate-800 text-white border-slate-800"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                  )}
                >
                  {s === 'all' ? 'Todos' : s === 'online' ? '🟢 Online' : '🔴 Offline'}
                </button>
              ))}
              <button
                onClick={() => { setSearchTerm(''); setTipoFilter('all'); setStatusFilter('all'); setUserFilter('all'); }}
                disabled={!searchTerm && tipoFilter === 'all' && statusFilter === 'all' && userFilter === 'all'}
                className="ml-auto text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30 select-none transition-colors"
              >
                Limpar filtros
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Terminals Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredTerminals.map((terminal, index) => {
              const TipoIcon = getTipoIcon(terminal.tipo_conexao);
              return (
                <motion.div
                  key={terminal.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ delay: index * 0.02 }}
                >
                  <Card className={cn("bg-white/80 backdrop-blur-sm border-slate-200/50 hover:shadow-lg transition-all", !terminal.ativo && "opacity-60")}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg flex items-center gap-2">
                            {terminal.nome}
                            {!terminal.ativo && <Badge variant="outline" className="text-xs">Inativo</Badge>}
                          </CardTitle>
                          <p className="text-sm text-slate-500 mt-1">{terminal.local}</p>
                          {(terminal.usuario_email || terminal.created_by) && (
                            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                              <UserIcon className="h-3 w-3 shrink-0" />
                              {terminal.usuario_email || terminal.created_by}
                            </p>
                          )}
                        </div>
                        <StatusBadge status={terminal.status} pulse={false} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-2 text-sm">
                        <TipoIcon className="h-4 w-4 text-slate-400" />
                        <span className="text-slate-600 font-medium">{getTipoLabel(terminal.tipo_conexao)}</span>
                      </div>
                      {getConexaoEndereco(terminal) && (
                        <div className="text-sm text-slate-600 font-mono bg-slate-50 px-2 py-1 rounded truncate">
                          {getConexaoEndereco(terminal)}
                        </div>
                      )}
                      {terminal.latencia_ms && (
                        <div className="text-sm text-slate-600">
                          <span className="text-slate-500">Latência:</span> {terminal.latencia_ms}ms
                        </div>
                      )}
                      <div className="flex gap-2 pt-2 border-t border-slate-100">
                        <Button size="sm" variant="outline" onClick={() => setSelectedTerminal(terminal)} className="flex-1">
                          <Eye className="h-3 w-3 mr-1" />
                          Detalhes
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setControlTerminal(terminal)}
                          className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                          title="Controlo Remoto"
                        >
                          <Zap className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => monitorMutation.mutate(terminal)} disabled={refreshingTerminalId === terminal.id}>
                           <RefreshCw className={cn("h-3 w-3", refreshingTerminalId === terminal.id && "animate-spin")} />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleEdit(terminal)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDelete(terminal.id)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
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

        {filteredTerminals.length === 0 && (
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
            <CardContent className="py-12 text-center text-slate-400">
              <Monitor className="h-12 w-12 mx-auto mb-3" />
              <p>Nenhum terminal encontrado</p>
            </CardContent>
          </Card>
        )}
      </div>

      {selectedTerminal && (
        <TerminalDetailModal
          terminal={selectedTerminal}
          onClose={() => setSelectedTerminal(null)}
        />
      )}

      {controlTerminal && (
        <TerminalControlPanel
          terminal={controlTerminal}
          open={!!controlTerminal}
          onClose={() => setControlTerminal(null)}
        />
      )}

      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente. O terminal e todo o seu histórico serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => { deleteMutation.mutate(deleteConfirmId); setDeleteConfirmId(null); }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
         <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTerminal ? 'Editar Terminal' : 'Novo Terminal'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={formData.nome || ''} onChange={(e) => setFormData({...formData, nome: e.target.value})} placeholder="BIO-001" />
              </div>
              <div className="space-y-2">
                <Label>Local *</Label>
                <LocalSelectField
                  locais={locaisDB}
                  value={formData.local || ''}
                  onChange={val => setFormData(f => ({...f, local: val}))}
                  onRefresh={refetchLocais}
                />
              </div>
            </div>


            <div className="space-y-2">
              <Label>Utilizador do Sistema</Label>
              {isAdmin ? (
                <Select
                  value={formData.usuario_email || currentUser?.email || ''}
                  onValueChange={(v) => setFormData(f => ({ ...f, usuario_email: v }))}
                >
                  <SelectTrigger>
                    <UserIcon className="h-4 w-4 text-slate-400 shrink-0 mr-2" />
                    <SelectValue placeholder="Selecionar utilizador" />
                  </SelectTrigger>
                  <SelectContent>
                    {allUsers.map(u => (
                      <SelectItem key={u.id} value={u.email}>{u.full_name ? `${u.full_name} (${u.email})` : u.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-slate-50 text-sm text-slate-600">
                  <UserIcon className="h-4 w-4 text-slate-400 shrink-0" />
                  {currentUser?.email || '—'}
                </div>
              )}
              <p className="text-xs text-slate-400">{isAdmin ? 'Selecione o utilizador responsável pelo terminal' : 'Preenchido automaticamente — identifica o responsável pelo terminal'}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo de Conexão *</Label>
                <Select
                  value={formData.tipo_conexao || 'ip_local'}
                  onValueChange={(v) => {
                    const defaults = {
                      websocket_cloud: { fabricante: 'timmy', porta: 7788 },
                      sdk_tcp: { fabricante: 'zkteco', porta: 4370 },
                      adms_push: { fabricante: 'zkteco' },
                    };
                    setFormData({ ...formData, tipo_conexao: v, ...(defaults[v] || {}) });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ip_local">IP Local</SelectItem>
                    <SelectItem value="ip_publico">IP Público</SelectItem>
                    <SelectItem value="dns">DNS/No-IP</SelectItem>
                    <SelectItem value="p2s">P2S (Push to Server)</SelectItem>
                    <SelectItem value="heartbeat">Heartbeat TCP (Windows Server)</SelectItem>
                    <SelectItem value="adms_push">ADMS / Push (ZKTeco, Anviz)</SelectItem>
                    <SelectItem value="sdk_tcp">SDK-TCP (ZKTeco porta 4370)</SelectItem>
                    <SelectItem value="websocket_cloud">WebSocket Cloud (Timmy/THbio)</SelectItem>
                    <SelectItem value="api">API</SelectItem>
                    </SelectContent>
                    </Select>
                    </div>
                    {formData.tipo_conexao !== 'p2s' && formData.tipo_conexao !== 'adms_push' && formData.tipo_conexao !== 'websocket_cloud' && (
                <div className="space-y-2">
                  <Label>Porta</Label>
                  <Input type="number" value={formData.porta || 5005} onChange={(e) => setFormData({...formData, porta: parseInt(e.target.value)})} />
                </div>
              )}
            </div>

            {formData.tipo_conexao === 'ip_local' && (
              <div className="space-y-2">
                <Label>IP Local <span className="text-red-500">*</span></Label>
                <Input value={formData.ip_local || ''} onChange={(e) => setFormData({...formData, ip_local: e.target.value})} placeholder="192.168.1.100" />
                <p className="text-xs text-slate-500">Endereço IP do terminal na rede local (ex: 192.168.1.100)</p>
              </div>
            )}
            {formData.tipo_conexao === 'ip_publico' && (
              <div className="space-y-2">
                <Label>IP Público <span className="text-red-500">*</span></Label>
                <Input value={formData.ip_publico || ''} onChange={(e) => setFormData({...formData, ip_publico: e.target.value})} placeholder="203.0.113.1" />
                <p className="text-xs text-slate-500">Endereço IP público/externo do terminal ou do router com redirecionamento de porta</p>
              </div>
            )}
            {formData.tipo_conexao === 'dns' && (
              <div className="space-y-2">
                <Label>DNS / Hostname <span className="text-red-500">*</span></Label>
                <Input value={formData.dns || ''} onChange={(e) => setFormData({...formData, dns: e.target.value})} placeholder="meuhost.no-ip.org" />
                <p className="text-xs text-slate-500">Nome de domínio dinâmico (ex: No-IP, DynDNS) que aponta para o terminal</p>
              </div>
            )}
            {formData.tipo_conexao === 'p2s' && (
              <div className="space-y-3">
                <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg text-xs text-violet-700 space-y-1">
                  <p className="font-semibold">📡 Modo P2S — Push to Server (Conexão Inversa)</p>
                  <p>O <strong>terminal conecta TCP ao servidor</strong> — não é o servidor que tenta alcançar o terminal. Ideal para terminais em rede privada/NAT.</p>
                  <p>Compatível com: <strong>ZKTeco</strong> (SetServerPortAndTick), <strong>Anviz</strong> (Server Mode), <strong>Suprema</strong> (Server Connection), <strong>Hikvision/Dahua</strong> (Active Registration), <strong>Nitgen</strong>.</p>
                  <p>Configure o terminal para conectar a <strong>127.0.0.1:PORTA</strong> e instale o <strong>p2s_server.py</strong> no Windows Server (Configurações → P2S Server).</p>
                  <p className="text-violet-600">⚙️ Abra a porta TCP configurada no Firewall do Windows Server (Regras de Entrada).</p>
                </div>
                <div className="space-y-2">
                  <Label>Porta TCP do Servidor <span className="text-red-500">*</span></Label>
                  <Input
                    type="number"
                    value={formData.porta || 5005}
                    onChange={(e) => setFormData({...formData, porta: parseInt(e.target.value)})}
                    placeholder="5005"
                  />
                  <p className="text-xs text-slate-500">Porta TCP onde o agente local escuta. O terminal conecta-se a esta porta (ex: 5005). Corresponde ao valor usado em <code>SetServerPortandtick(porta, 7)</code>.</p>
                </div>
                <div className="space-y-2">
                  <Label>Observações / Identificação do Terminal</Label>
                  <Textarea
                    value={formData.p2s_config || ''}
                    onChange={(e) => setFormData({...formData, p2s_config: e.target.value})}
                    rows={2}
                    placeholder="Número de série, modelo, ou outras notas de identificação do terminal..."
                    className="text-xs"
                  />
                  <p className="text-xs text-slate-500">Opcional. Informação de identificação do terminal (número de série, modelo, etc.).</p>
                </div>
              </div>
            )}
            {formData.tipo_conexao === 'heartbeat' && (
              <div className="space-y-3">
                <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg text-xs text-violet-700 space-y-1">
                  <p className="font-semibold">📡 Heartbeat TCP — Windows Server com IP Público</p>
                  <p>O <strong>NOC Server</strong> corre no Windows Server (<code className="bg-violet-100 px-1 rounded">127.0.0.1</code>) e escuta na porta configurada.</p>
                  <p>O terminal <strong>conecta TCP ao servidor</strong> — conexão recebida = online. Sem conexão no timeout = offline.</p>
                  <p className="text-violet-600">⚙️ Abra a porta TCP no Firewall do Windows Server (regra de entrada).</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>IP do Servidor</Label>
                    <Input value={formData.ip_publico || ''} onChange={(e) => setFormData({...formData, ip_publico: e.target.value})} placeholder="127.0.0.1" />
                  </div>
                  <div className="space-y-2">
                    <Label>Porta TCP <span className="text-red-500">*</span></Label>
                    <Input type="number" value={formData.porta || 5005} onChange={(e) => setFormData({...formData, porta: parseInt(e.target.value)})} placeholder="5005" />
                  </div>
                </div>
                <p className="text-xs text-slate-500">Cada terminal deve usar uma porta diferente (ex: 5005, 5006, 5007...).</p>
              </div>
            )}
            {formData.tipo_conexao === 'adms_push' && (
              <div className="space-y-3">
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 space-y-1">
                  <p className="font-semibold">📲 ADMS / Push — ZKTeco, Anviz, Hikvision</p>
                  <p>O terminal faz <strong>HTTP POST para o servidor ADMS</strong> a cada evento. Compatível com protocolo ZKTeco iClock/ADMS e Anviz CrossChex.</p>
                  <p>Configure no terminal: <code className="bg-blue-100 px-1 rounded">Servidor = http://127.0.0.1:8080</code></p>
                  <p className="text-blue-600">⚠️ O <strong>Número de Série (SN)</strong> do terminal é obrigatório — é usado para identificar o terminal no servidor ADMS.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Número de Série (SN) <span className="text-red-500">*</span></Label>
                    <Input value={formData.numero_serie || ''} onChange={(e) => setFormData({...formData, numero_serie: e.target.value})} placeholder="ACD1234567890" />
                    <p className="text-xs text-slate-500">Visível em: Menu → Info. → Número de Série</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Fabricante</Label>
                    <select value={formData.fabricante || 'zkteco'} onChange={(e) => setFormData({...formData, fabricante: e.target.value})}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                      <option value="zkteco">ZKTeco</option>
                      <option value="timmy">Timmy / THbio</option>
                      <option value="anviz">Anviz</option>
                      <option value="hikvision">Hikvision</option>
                      <option value="dahua">Dahua</option>
                      <option value="nitgen">Nitgen</option>
                      <option value="outro">Outro</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Modelo do Terminal</Label>
                  <Input value={formData.modelo || ''} onChange={(e) => setFormData({...formData, modelo: e.target.value})} placeholder="ZKTeco MB20VL, ZKTeco F22, Anviz C2..." />
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono space-y-0.5">
                  <p className="font-sans text-slate-600 font-semibold mb-1">Configuração no terminal ZKTeco:</p>
                  <p className="text-slate-700">Comm → Cloud Server / ADMS</p>
                  <p className="text-blue-700">Server Address: <strong>127.0.0.1</strong></p>
                  <p className="text-blue-700">Server Port: <strong>8080</strong></p>
                  <p className="text-blue-700">HTTPS: <strong>Off</strong> | Push: <strong>On</strong></p>
                </div>
              </div>
            )}
            {formData.tipo_conexao === 'sdk_tcp' && (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 space-y-1">
                  <p className="font-semibold">🔌 SDK-TCP — ZKTeco porta 4370</p>
                  <p>O servidor faz <strong>polling TCP activo</strong> na porta 4370 do terminal (porta padrão SDK ZKTeco). O terminal precisa de ser acessível via IP.</p>
                  <p>Suporta terminais ZKTeco com SDK ZKAccess3.5 / ZKLib. Ideal quando o terminal tem IP público ou está na mesma rede que o servidor.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>IP do Terminal <span className="text-red-500">*</span></Label>
                    <Input value={formData.ip_publico || ''} onChange={(e) => setFormData({...formData, ip_publico: e.target.value})} placeholder="203.0.113.10" />
                    <p className="text-xs text-slate-500">IP público/privado do terminal</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Porta SDK</Label>
                    <Input type="number" value={formData.porta || 4370} onChange={(e) => setFormData({...formData, porta: parseInt(e.target.value)})} placeholder="4370" />
                    <p className="text-xs text-slate-500">Padrão ZKTeco: 4370</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Número de Série (SN)</Label>
                    <Input value={formData.numero_serie || ''} onChange={(e) => setFormData({...formData, numero_serie: e.target.value})} placeholder="ACD1234567890" />
                  </div>
                  <div className="space-y-2">
                    <Label>Modelo</Label>
                    <Input value={formData.modelo || ''} onChange={(e) => setFormData({...formData, modelo: e.target.value})} placeholder="ZKTeco F22" />
                  </div>
                </div>
              </div>
            )}
            {formData.tipo_conexao === 'websocket_cloud' && (
              <div className="space-y-3">
                <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg text-xs text-violet-700 space-y-1">
                  <p className="font-semibold">📡 WebSocket Cloud — Timmy / THbio</p>
                  <p>O terminal conecta-se ao servidor via <strong>WebSocket persistente</strong> (protocolo JSON). Compatível com: <strong>Timmy TM-AI07F, TM-AIFace11F, TFS30, TFS50</strong> e outros modelos THbio.</p>
                  <p>O servidor <code className="bg-violet-100 px-1 rounded">timmy_ws_server.py</code> corre no Windows Server e escuta na porta configurada (padrão: 7788).</p>
                  <p className="text-violet-600">⚠️ O <strong>Número de Série (SN)</strong> é obrigatório — é como o servidor identifica o terminal. Aceda via: <em>MENU → Sys Info → Info → SN</em></p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Número de Série (SN) <span className="text-red-500">*</span></Label>
                    <Input
                      value={formData.numero_serie || ''}
                      onChange={(e) => setFormData({...formData, numero_serie: e.target.value})}
                      placeholder="ABC1234567890"
                    />
                    <p className="text-xs text-slate-500">Visível em: MENU → Sys Info → Info → SN</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Porta WebSocket</Label>
                    <Input
                      type="number"
                      value={formData.porta || 7788}
                      onChange={(e) => setFormData({...formData, porta: parseInt(e.target.value)})}
                      placeholder="7788"
                    />
                    <p className="text-xs text-slate-500">Porta configurada no timmy_ws_server.py (padrão: 7788)</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Modelo do Terminal</Label>
                    <Input
                      value={formData.modelo || ''}
                      onChange={(e) => setFormData({...formData, modelo: e.target.value})}
                      placeholder="TM-AI07F, TM-AIFace11F, TFS30..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Fabricante</Label>
                    <select
                      value={formData.fabricante || 'timmy'}
                      onChange={(e) => setFormData({...formData, fabricante: e.target.value})}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="timmy">Timmy / THbio</option>
                      <option value="outro">Outro</option>
                    </select>
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono space-y-0.5">
                  <p className="font-sans text-slate-600 font-semibold mb-1">Configuração no terminal Timmy:</p>
                  <p className="text-slate-700">MENU → Comm Set → Server</p>
                  <p className="text-violet-700">Server Req: <strong>Yes</strong> | Use domainNm: <strong>Yes</strong></p>
                  <p className="text-violet-700">DomainNm: <strong>IP_DO_SERVIDOR</strong> | SerPortNo: <strong>7788</strong></p>
                  <p className="text-violet-700">Heartbeat: <strong>3s</strong> | Server approval: <strong>No</strong></p>
                </div>
              </div>
            )}
            {formData.tipo_conexao === 'api' && (
              <div className="space-y-2">
                <Label>Endpoint da API <span className="text-red-500">*</span></Label>
                <Input
                  value={formData.api_endpoint || ''}
                  onChange={(e) => setFormData({...formData, api_endpoint: e.target.value})}
                  placeholder="https://api.exemplo.com/terminal/ping"
                />
                <p className="text-xs text-slate-500">URL HTTP/HTTPS acessível publicamente (GET). O sistema verifica periodicamente se retorna HTTP 2xx/3xx — considera online se sim. Útil para terminais com API REST própria.</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea value={formData.observacoes || ''} onChange={(e) => setFormData({...formData, observacoes: e.target.value})} rows={3} />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={formData.ativo !== false} onCheckedChange={(checked) => setFormData({...formData, ativo: checked})} />
              <Label>Terminal ativo para monitoramento</Label>
            </div>

            <div className="flex gap-2 pt-4">
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">Cancelar</Button>
              <Button onClick={() => saveMutation.mutate(formData)} disabled={saveMutation.isPending} className="flex-1 bg-blue-600 hover:bg-blue-700">
                {saveMutation.isPending ? 'A guardar...' : 'Guardar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}