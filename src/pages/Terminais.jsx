import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import { User as UserIcon } from 'lucide-react';

export default function Terminais() {
  const [searchTerm, setSearchTerm] = useState('');
  const [tipoFilter, setTipoFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
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

  const [refreshInterval, setRefreshInterval] = useState(5000);

  // Fetch monitor config to get actual refresh interval
  useEffect(() => {
    base44.entities.MonitorConfig.list()
      .then((configs) => {
        const config = configs[0];
        if (config?.intervalo_sync_minutos) {
          setRefreshInterval(config.intervalo_sync_minutos * 60 * 1000);
        }
      })
      .catch(() => setRefreshInterval(5000));
  }, []);

  // Fetch terminals with server-side filtering for security
  const { data: terminals = [], isLoading } = useQuery({
    queryKey: ['terminals-manage', currentUser?.email, isAdmin],
    queryFn: async () => {
      if (isAdmin) {
        return await base44.entities.Terminal.list('-created_date');
      }
      // Non-admins only see their own terminals
      return await base44.entities.Terminal.filter(
        { created_by: currentUser?.email },
        '-created_date'
      );
    },
    enabled: !!currentUser, // Only run when user is loaded
    refetchInterval: refreshInterval,
  });

  const terminalCount = terminals.length;
  const atLimit = !isAdmin && (limiteTerminais === 0 || (limiteTerminais > 0 && terminalCount >= limiteTerminais));


  const logAudit = (acao, entidade_id, descricao) =>
    base44.functions.invoke('auditLog', { acao, entidade: 'Terminal', entidade_id, descricao }).catch(() => {});

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editingTerminal) {
        return base44.entities.Terminal.update(editingTerminal.id, data);
      }
      // Preencher automaticamente o email do utilizador ao criar
      return base44.entities.Terminal.create({ ...data, usuario_email: currentUser?.email });
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
      // Para tipos não-locais, verificar status imediatamente após criação/edição
      const tipo = data.tipo_conexao || 'ip_local';
      if (tipo !== 'ip_local' && terminalId) {
        await base44.functions.invoke('monitorTerminal', { terminalId }).catch(() => {});
      }
      queryClient.invalidateQueries(['terminals-manage']);
    },
    onError: (error) => toast.error(`Erro: ${error.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Terminal.delete(id),
    onSuccess: (_, id) => {
      const terminal = terminals.find(t => t.id === id);
      logAudit('terminal_excluido', id, `Terminal "${terminal?.nome || id}" excluído`);
      queryClient.invalidateQueries(['terminals-manage']);
      toast.success('Terminal eliminado');
    },
    onError: () => toast.error('Erro ao eliminar terminal'),
  });

  const [refreshingTerminalId, setRefreshingTerminalId] = useState(null);

  const monitorMutation = useMutation({
    mutationFn: async (terminal) => {
      setRefreshingTerminalId(terminal.id);
      if (terminal.tipo_conexao === 'ip_local') {
        // ip_local: apenas recarregar dados sem chamar monitorTerminal
        return { success: true, status: terminal.status, info: 'ip_local usa agente local' };
      }
      const response = await base44.functions.invoke('monitorTerminal', { terminalId: terminal.id });
      return response.data;
    },
    onSuccess: (data, terminal) => {
      setRefreshingTerminalId(null);
      queryClient.invalidateQueries(['terminals-manage']);
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
    onError: (error) => { setRefreshingTerminalId(null); toast.error(`Erro: ${error.message}`); },
  });

  const [selectedTerminal, setSelectedTerminal] = useState(null);
  const [newLocalInput, setNewLocalInput] = useState('');
  const [showNewLocalInput, setShowNewLocalInput] = useState(false);
  const [editingLocal, setEditingLocal] = useState(null);
  const [editLocalInput, setEditLocalInput] = useState('');

  const { data: locaisDB = [], refetch: refetchLocais } = useQuery({
    queryKey: ['locais', currentUser?.email],
    queryFn: () => base44.entities.Local.list('nome'),
    enabled: !!currentUser,
  });

  const handleCreateLocal = async () => {
    if (!newLocalInput.trim()) return;
    await base44.entities.Local.create({ nome: newLocalInput.trim(), ativo: true });
    setFormData(prev => ({ ...prev, local: newLocalInput.trim() }));
    setNewLocalInput('');
    setShowNewLocalInput(false);
    refetchLocais();
  };

  const handleSaveEditLocal = async () => {
    if (!editLocalInput.trim() || !editingLocal) return;
    await base44.entities.Local.update(editingLocal.id, { nome: editLocalInput.trim() });
    if (formData.local === editingLocal.nome) {
      setFormData(prev => ({ ...prev, local: editLocalInput.trim() }));
    }
    setEditingLocal(null);
    setEditLocalInput('');
    refetchLocais();
  };

  const handleDeleteLocal = async (local) => {
    if (!confirm(`Eliminar local "${local.nome}"?`)) return;
    await base44.entities.Local.delete(local.id);
    if (formData.local === local.nome) setFormData(prev => ({ ...prev, local: '' }));
    refetchLocais();
  };

  const [verificandoTodos, setVerificandoTodos] = useState(false);
  const verificarTodos = async () => {
    setVerificandoTodos(true);
    const terminaisAtivos = terminals.filter(t => t.ativo);
    for (const terminal of terminaisAtivos) {
      await base44.functions.invoke('monitorTerminal', { terminalId: terminal.id }).catch(() => {});
    }
    queryClient.invalidateQueries(['terminals-manage']);
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
    setFormData({ tipo_conexao: 'ip_local', porta: 5005, ativo: true });
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
    const labels = { ip_local: 'IP Local', ip_publico: 'IP Público', dns: 'DNS/No-IP', p2s: 'P2S VPN', api: 'API' };
    return labels[tipo] || tipo;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-3 sm:p-6">
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
                Auto-refresh {refreshInterval >= 60000 ? (refreshInterval / 60000).toFixed(0) + 'm' : (refreshInterval / 1000).toFixed(0) + 's'}
                {!isAdmin && (
                  <span className={cn("ml-2 font-semibold", atLimit ? "text-red-600" : "text-slate-500")}>
                    • {terminalCount}/{limiteTerminais} terminais
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
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px] relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Pesquisar por nome, local ou cliente..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={tipoFilter} onValueChange={setTipoFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Tipo de conexão" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="ip_local">IP Local</SelectItem>
                  <SelectItem value="ip_publico">IP Público</SelectItem>
                  <SelectItem value="dns">DNS/No-IP</SelectItem>
                  <SelectItem value="p2s">P2S VPN</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                </SelectContent>
              </Select>
              {isAdmin && (
                <select
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="all">Todos os utilizadores</option>
                  {usuarios.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              )}

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
                        <span className="text-slate-600">{getTipoLabel(terminal.tipo_conexao)}</span>
                        <span className="text-slate-400">•</span>
                        <span className="text-slate-600 font-mono text-xs">:{terminal.porta || 5005}</span>
                      </div>
                      {terminal.cliente_nome && (
                        <div className="text-sm text-slate-600">
                          <span className="text-slate-500">Cliente:</span> {terminal.cliente_nome}
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                <div className="flex gap-2">
                  <select
                    value={formData.local || ''}
                    onChange={(e) => setFormData({...formData, local: e.target.value})}
                    className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Selecionar local...</option>
                    {locaisDB.filter(l => l.ativo).map(l => (
                      <option key={l.id} value={l.nome}>{l.nome}</option>
                    ))}
                  </select>
                  <Button type="button" variant="outline" size="sm" onClick={() => { setShowNewLocalInput(v => !v); setEditingLocal(null); }} title="Novo local">
                    <MapPin className="h-4 w-4" />
                  </Button>
                </div>
                {showNewLocalInput && (
                  <div className="flex gap-2">
                    <Input
                      value={newLocalInput}
                      onChange={e => setNewLocalInput(e.target.value)}
                      placeholder="Nome do novo local..."
                      onKeyDown={e => e.key === 'Enter' && handleCreateLocal()}
                      autoFocus
                    />
                    <Button type="button" size="sm" onClick={handleCreateLocal} className="bg-emerald-600 hover:bg-emerald-700 shrink-0">Criar</Button>
                  </div>
                )}
                {locaisDB.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-400">Gerir locais:</p>
                    {locaisDB.map(l => (
                      <div key={l.id} className="flex items-center gap-2">
                        {editingLocal?.id === l.id ? (
                          <>
                            <Input value={editLocalInput} onChange={e => setEditLocalInput(e.target.value)} className="flex-1 h-7 text-xs" onKeyDown={e => e.key === 'Enter' && handleSaveEditLocal()} autoFocus />
                            <Button type="button" size="sm" onClick={handleSaveEditLocal} className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700">Guardar</Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => setEditingLocal(null)} className="h-7 px-2 text-xs">✕</Button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-xs text-slate-700 truncate">{l.nome}</span>
                            <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingLocal(l); setEditLocalInput(l.nome); setShowNewLocalInput(false); }} className="h-6 w-6 p-0 text-slate-400 hover:text-blue-600"><Pencil className="h-3 w-3" /></Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => handleDeleteLocal(l)} className="h-6 w-6 p-0 text-slate-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Cliente / Referência</Label>
              <Input value={formData.cliente_nome || ''} onChange={(e) => setFormData({...formData, cliente_nome: e.target.value})} placeholder="Nome do cliente ou referência (opcional)" />
            </div>

            <div className="space-y-2">
              <Label>Utilizador do Sistema</Label>
              <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-slate-50 text-sm text-slate-600">
                <UserIcon className="h-4 w-4 text-slate-400 shrink-0" />
                {currentUser?.email || '—'}
              </div>
              <p className="text-xs text-slate-400">Preenchido automaticamente — identifica o responsável pelo terminal</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo de Conexão *</Label>
                <Select value={formData.tipo_conexao || 'ip_local'} onValueChange={(v) => setFormData({...formData, tipo_conexao: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ip_local">IP Local</SelectItem>
                    <SelectItem value="ip_publico">IP Público</SelectItem>
                    <SelectItem value="dns">DNS/No-IP</SelectItem>
                    <SelectItem value="p2s">P2S VPN</SelectItem>
                    <SelectItem value="api">API</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Porta</Label>
                <Input type="number" value={formData.porta || 5005} onChange={(e) => setFormData({...formData, porta: parseInt(e.target.value)})} />
              </div>
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
                <div className="space-y-2">
                  <Label>IP Local (rede VPN) <span className="text-red-500">*</span></Label>
                  <Input value={formData.ip_local || ''} onChange={(e) => setFormData({...formData, ip_local: e.target.value})} placeholder="10.8.0.10" />
                  <p className="text-xs text-slate-500">IP do terminal dentro do túnel VPN P2S (ex: 10.8.0.x atribuído pelo servidor VPN)</p>
                </div>
                <div className="space-y-2">
                  <Label>Configuração P2S (JSON)</Label>
                  <Textarea
                    value={formData.p2s_config || ''}
                    onChange={(e) => setFormData({...formData, p2s_config: e.target.value})}
                    rows={4}
                    placeholder={`{\n  "server": "vpn.empresa.com",\n  "port": 1194,\n  "protocol": "udp"\n}`}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-slate-500">Opcional. Informações de referência da ligação VPN em formato JSON (não é usada para autenticação — apenas documentação)</p>
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
                <p className="text-xs text-slate-500">URL HTTP/HTTPS que o Agente Local irá chamar (GET) para verificar se o terminal está online. Deve retornar HTTP 200 quando operacional.</p>
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