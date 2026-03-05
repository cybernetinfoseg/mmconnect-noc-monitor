import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  X
} from 'lucide-react';
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
import { resolvePermissions } from '../components/auth/usePermissions';

export default function Terminais() {
  const [searchTerm, setSearchTerm] = useState('');
  const [tipoFilter, setTipoFilter] = useState('all');
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

  // Fetch terminals with auto-refresh every 5 seconds
  const { data: allTerminals = [], isLoading } = useQuery({
    queryKey: ['terminals-manage'],
    queryFn: () => base44.entities.Terminal.list('-created_date'),
    refetchInterval: 5000,
  });

  // Filter: admin/editor sees all, viewer sees only their own
  const terminals = useMemo(() => {
    if (perms.canEdit) return allTerminals;
    return allTerminals.filter(t => t.created_by === currentUser?.email);
  }, [allTerminals, perms.canEdit, currentUser]);

  const terminalCount = terminals.length;
  const atLimit = !isAdmin && limiteTerminais > 0 && terminalCount >= limiteTerminais;

  // Fetch clientes
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list(),
  });

  const logAudit = (acao, entidade_id, descricao) =>
    base44.functions.invoke('auditLog', { acao, entidade: 'Terminal', entidade_id, descricao }).catch(() => {});

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const cliente = clientes.find(c => c.id === data.cliente_id);
      const dataWithCliente = { ...data, cliente_nome: cliente?.nome || '' };
      if (editingTerminal) {
        return base44.entities.Terminal.update(editingTerminal.id, dataWithCliente);
      }
      return base44.entities.Terminal.create(dataWithCliente);
    },
    onSuccess: (result, data) => {
      const isEdit = !!editingTerminal;
      const nome = data.nome || editingTerminal?.nome || '';
      logAudit(
        isEdit ? 'terminal_editado' : 'terminal_criado',
        editingTerminal?.id || result?.id || '',
        isEdit ? `Terminal "${nome}" editado` : `Terminal "${nome}" criado`
      );
      queryClient.invalidateQueries(['terminals-manage']);
      setDialogOpen(false);
      setEditingTerminal(null);
      setFormData({});
      setShowNovoCliente(false);
      setNovoClienteNome('');
      toast.success(isEdit ? 'Terminal atualizado' : 'Terminal criado');
    },
    onError: (error) => toast.error(`Erro: ${error.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Terminal.delete(id),
    onSuccess: (_, id) => {
      const terminal = terminals.find(t => t.id === id);
      logAudit('terminal_excluido', id, `Terminal "${terminal?.nome || id}" excluído`);
      queryClient.invalidateQueries(['terminals-manage']);
      toast.success('Terminal excluído');
    },
    onError: () => toast.error('Erro ao excluir terminal'),
  });

  const monitorMutation = useMutation({
    mutationFn: async (terminal) => {
      const response = await base44.functions.invoke('monitorTerminal', { terminalId: terminal.id });
      return response.data;
    },
    onSuccess: (data, terminal) => {
      queryClient.invalidateQueries(['terminals-manage']);
      if (data.success) {
        if (data.status === 'online') {
          toast.success(`${terminal.nome}: ✅ ONLINE (${data.latencia}ms)`);
        } else {
          toast.error(`${terminal.nome}: ❌ OFFLINE${data.error ? ' - ' + data.error : ''}`);
        }
      }
    },
    onError: (error) => toast.error(`Erro: ${error.message}`),
  });

  const [showNovoCliente, setShowNovoCliente] = useState(false);
  const [novoClienteNome, setNovoClienteNome] = useState('');

  const criarClienteMutation = useMutation({
    mutationFn: (nome) => base44.entities.Cliente.create({ nome, ativo: true }),
    onSuccess: (novoCliente) => {
      queryClient.invalidateQueries(['clientes']);
      setFormData(prev => ({ ...prev, cliente_id: novoCliente.id, cliente_nome: novoCliente.nome }));
      setShowNovoCliente(false);
      setNovoClienteNome('');
      toast.success(`Cliente "${novoCliente.nome}" criado!`);
    },
    onError: () => toast.error('Erro ao criar cliente'),
  });

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

  const handleEdit = (terminal) => {
    setEditingTerminal(terminal);
    setFormData(terminal);
    setDialogOpen(true);
  };

  const handleNew = () => {
    if (!perms.pode_editar_terminais && !isAdmin) {
      toast.error('Você não tem permissão para criar terminais.');
      return;
    }
    if (atLimit) {
      toast.error(`Limite de ${limiteTerminais} terminais atingido. Contate o administrador.`);
      return;
    }
    setEditingTerminal(null);
    setFormData({ tipo_conexao: 'ip_local', porta: 5005, ativo: true });
    setDialogOpen(true);
  };

  const handleDelete = (id) => {
    if (confirm('Tem certeza que deseja excluir este terminal?')) {
      deleteMutation.mutate(id);
    }
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
                Auto-refresh 5s
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
              <span className="hidden sm:inline">{verificandoTodos ? 'Verificando...' : 'Verificar Todos'}</span>
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
            Você atingiu o limite de {limiteTerminais} terminais. Contate o administrador para aumentar seu limite.
          </div>
        )}

        {/* Filters */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px] relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Buscar por nome, local ou cliente..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={tipoFilter} onValueChange={setTipoFilter}>
                <SelectTrigger className="w-[200px]">
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
                          {isAdmin && terminal.created_by && (
                            <p className="text-xs text-slate-400 mt-0.5">{terminal.created_by}</p>
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
                        <Button size="sm" variant="outline" onClick={() => monitorMutation.mutate(terminal)} disabled={monitorMutation.isPending} className="flex-1">
                          <RefreshCw className={cn("h-3 w-3 mr-1", monitorMutation.isPending && "animate-spin")} />
                          Verificar
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

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTerminal ? 'Editar Terminal' : 'Novo Terminal'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={formData.nome || ''} onChange={(e) => setFormData({...formData, nome: e.target.value})} placeholder="BIO-001" />
              </div>
              <div className="space-y-2">
                <Label>Local *</Label>
                <Input value={formData.local || ''} onChange={(e) => setFormData({...formData, local: e.target.value})} placeholder="Matriz - Recepção" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Cliente</Label>
              {!showNovoCliente ? (
                <div className="flex gap-2">
                  <Select value={formData.cliente_id || ''} onValueChange={(v) => setFormData({...formData, cliente_id: v})}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
                    <SelectContent>
                      {clientes.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowNovoCliente(true)} title="Cadastrar novo cliente">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    placeholder="Nome do novo cliente"
                    value={novoClienteNome}
                    onChange={e => setNovoClienteNome(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && novoClienteNome.trim()) criarClienteMutation.mutate(novoClienteNome.trim()); }}
                    className="flex-1"
                  />
                  <Button type="button" size="sm" onClick={() => criarClienteMutation.mutate(novoClienteNome.trim())} disabled={!novoClienteNome.trim() || criarClienteMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
                    {criarClienteMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Criar'}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setShowNovoCliente(false); setNovoClienteNome(''); }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
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

            {(formData.tipo_conexao === 'ip_local' || formData.tipo_conexao === 'p2s') && (
              <div className="space-y-2">
                <Label>IP Local</Label>
                <Input value={formData.ip_local || ''} onChange={(e) => setFormData({...formData, ip_local: e.target.value})} placeholder="192.168.1.100" />
              </div>
            )}
            {formData.tipo_conexao === 'ip_publico' && (
              <div className="space-y-2">
                <Label>IP Público</Label>
                <Input value={formData.ip_publico || ''} onChange={(e) => setFormData({...formData, ip_publico: e.target.value})} placeholder="203.0.113.1" />
              </div>
            )}
            {formData.tipo_conexao === 'dns' && (
              <div className="space-y-2">
                <Label>DNS/Hostname</Label>
                <Input value={formData.dns || ''} onChange={(e) => setFormData({...formData, dns: e.target.value})} placeholder="meuhost.no-ip.org" />
              </div>
            )}
            {formData.tipo_conexao === 'api' && (
              <div className="space-y-2">
                <Label>API Endpoint</Label>
                <Input value={formData.api_endpoint || ''} onChange={(e) => setFormData({...formData, api_endpoint: e.target.value})} placeholder="https://api.exemplo.com/terminal/status" />
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
                {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}