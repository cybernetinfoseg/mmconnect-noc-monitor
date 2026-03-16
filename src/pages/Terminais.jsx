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
  Eye
} from 'lucide-react';
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
import NovoClienteModal from '../components/clientes/NovoClienteModal';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';

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

  // Fetch terminals with auto-refresh based on config
  const { data: allTerminals = [], isLoading } = useQuery({
    queryKey: ['terminals-manage'],
    queryFn: () => base44.entities.Terminal.list('-created_date'),
    refetchInterval: refreshInterval,
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
      toast.success(isEdit ? 'Terminal actualizado' : 'Terminal criado');
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

  const [showNovoClienteModal, setShowNovoClienteModal] = useState(false);
  const [selectedTerminal, setSelectedTerminal] = useState(null);

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
    if (atLimit) {
      toast.error(`Limite de ${limiteTerminais} terminais atingido. Contacte o administrador.`);
      return;
    }
    setEditingTerminal(null);
    setFormData({ tipo_conexao: 'ip_local', porta: 5005, ativo: true });
    setDialogOpen(true);
  };

  const handleDelete = (id) => {
    if (confirm('Tem a certeza que deseja eliminar este terminal?')) {
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
    <div className="min-h-screen bg-background p-3 sm:p-6">
      <div className="max-w-[1920px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-accent/20 rounded-xl shrink-0">
              <Monitor className="h-6 w-6 text-accent" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">Gestão de Terminais</h1>
              <p className="text-xs sm:text-sm text-accent flex items-center gap-1">
                <span className="w-2 h-2 bg-accent rounded-full animate-pulse shrink-0 inline-block"></span>
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
              className="border-accent text-accent"
            >
              <RefreshCw className={cn("h-4 w-4 sm:mr-2", verificandoTodos && "animate-spin")} />
              <span className="hidden sm:inline">{verificandoTodos ? 'A verificar...' : 'Verificar Todos'}</span>
            </Button>
            <Button
              onClick={handleNew}
              size="sm"
              className={cn("bg-accent hover:bg-accent/90 text-accent-foreground", atLimit && "opacity-50 cursor-not-allowed")}
            >
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Novo Terminal</span>
            </Button>
          </div>
        </div>

        {/* Limit warning */}
        {atLimit && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-sm">
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
                  className="pl-10 bg-card text-foreground border-border"
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
                  <Card className={cn("bg-card border-border hover:shadow-lg transition-all", !terminal.ativo && "opacity-60")}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg flex items-center gap-2 text-foreground">
                            {terminal.nome}
                            {!terminal.ativo && <Badge variant="outline" className="text-xs">Inativo</Badge>}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">{terminal.local}</p>
                          {isAdmin && terminal.created_by && (
                            <p className="text-xs text-muted-foreground/70 mt-0.5">{terminal.created_by}</p>
                          )}
                        </div>
                        <StatusBadge status={terminal.status} pulse={false} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <TipoIcon className="h-4 w-4 text-muted-foreground" />
                        <span>{getTipoLabel(terminal.tipo_conexao)}</span>
                        <span className="text-muted-foreground">•</span>
                        <span className="font-mono text-xs">:{terminal.porta || 5005}</span>
                      </div>
                      {terminal.cliente_nome && (
                        <div className="text-sm text-foreground">
                          <span className="text-muted-foreground">Cliente:</span> {terminal.cliente_nome}
                        </div>
                      )}
                      {terminal.latencia_ms && (
                        <div className="text-sm text-foreground">
                          <span className="text-muted-foreground">Latência:</span> {terminal.latencia_ms}ms
                        </div>
                      )}
                      <div className="flex gap-2 pt-2 border-t border-slate-100">
                        <Button size="sm" variant="outline" onClick={() => setSelectedTerminal(terminal)} className="flex-1">
                          <Eye className="h-3 w-3 mr-1" />
                          Detalhes
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => monitorMutation.mutate(terminal)} disabled={monitorMutation.isPending}>
                          <RefreshCw className={cn("h-3 w-3", monitorMutation.isPending && "animate-spin")} />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleEdit(terminal)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDelete(terminal.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
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
          <Card className="bg-card border-border">
            <CardContent className="py-12 text-center text-muted-foreground">
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

      <NovoClienteModal
        open={showNovoClienteModal}
        onClose={() => setShowNovoClienteModal(false)}
        onCreated={(novoCliente) => setFormData(prev => ({ ...prev, cliente_id: novoCliente.id, cliente_nome: novoCliente.nome }))}
      />

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
                <Input value={formData.local || ''} onChange={(e) => setFormData({...formData, local: e.target.value})} placeholder="Matriz - Recepção" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Cliente</Label>
              <div className="flex gap-2">
                <Select value={formData.cliente_id || ''} onValueChange={(v) => setFormData({...formData, cliente_id: v})}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
                  <SelectContent>
                    {clientes.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowNovoClienteModal(true)} title="Cadastrar novo cliente">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
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
              <Button onClick={() => saveMutation.mutate(formData)} disabled={saveMutation.isPending} className="flex-1 bg-accent hover:bg-accent/90 text-accent-foreground">
                {saveMutation.isPending ? 'A guardar...' : 'Guardar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}