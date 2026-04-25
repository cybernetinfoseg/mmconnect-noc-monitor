import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, UserPlus, Pencil, X, Check, Clock, UserCheck, Settings, Activity, AlertCircle, Mail, Trash2, Ban, Terminal, Bot, Key, Radio, Save } from 'lucide-react';
import AgentSourceCode from '../components/configuracoes/AgentSourceCode';
import NocServerCode from '../components/configuracoes/NocServerCode';
import P2sServerCode from '../components/configuracoes/P2sServerCode';
import TimmyWsServerCode from '../components/configuracoes/TimmyWsServerCode';
import PendingUserRow from '../components/admin/PendingUserRow';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ROLE_LABELS, ROLE_COLORS } from '@/components/auth/usePermissions.jsx';
import ContactMessagesPanel from '../components/admin/ContactMessagesPanel';

const EMPTY_FORM = {
  email: '',
  role: 'user',
  limite_terminais: 10,
};

export default function Administracao() {
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [currentUser, setCurrentUser] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState('5');
  const [savingInterval, setSavingInterval] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const queryClient = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    refetchInterval: 15000,
  });

  const pendingUsers = users.filter(u => u.role !== 'admin' && !u.aprovado);
  const approvedUsers = users.filter(u => u.role === 'admin' || u.aprovado);

  const approveMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const u = users.find(u => u.id === id);
      
      // Atualiza usuário
      await base44.entities.User.update(id, data);
      
      // Envia email de aprovação
      if (u?.email && u?.nome) {
        try {
          await base44.functions.invoke('notifyUserApproved', {
            email: u.email,
            nome: u.nome,
            role: data.role
          });
        } catch (error) {
          console.error('Erro ao enviar email de aprovação:', error);
          // Continua mesmo se email falhar
        }
      }
      
      return { id, data };
    },
    onSuccess: (_, { id, data }) => {
      const u = users.find(u => u.id === id);
      logAudit('permissao_atualizada', id, `Utilizador ${u?.email || id} aprovado com role "${data.role}"`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Utilizador aprovado e email enviado!');
    },
    onError: () => toast.error('Erro ao aprovar utilizador'),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id) => {
      const u = users.find(u => u.id === id);
      
      // Envia email de recusa via backend
      if (u?.email) {
        await base44.functions.invoke('notifyUserApproved', {
          email: u.email,
          nome: u.nome || u.full_name || '',
          role: 'rejected',
        }).catch(() => {});
      }
      
      // Deleta utilizador
      await base44.entities.User.delete(id);
      return id;
    },
    onSuccess: (_, id) => {
      const u = users.find(u => u.id === id);
      logAudit('permissao_atualizada', id, `Solicitação de ${u?.email || id} recusada e usuário excluído`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Solicitação recusada e usuário removido');
    },
    onError: () => toast.error('Erro ao recusar solicitação'),
  });

  const deletePendingMutation = useMutation({
    mutationFn: (id) => base44.entities.User.delete(id),
    onSuccess: (_, id) => {
      const u = users.find(u => u.id === id);
      logAudit('permissao_atualizada', id, `Usuário pendente ${u?.email || id} excluído`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuário removido');
    },
    onError: () => toast.error('Erro ao remover usuário'),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id) => base44.entities.User.delete(id),
    onSuccess: (_, id) => {
      const u = users.find(u => u.id === id);
      logAudit('permissao_atualizada', id, `Usuário ${u?.email || id} excluído pelo admin`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuário excluído');
    },
    onError: () => toast.error('Erro ao excluir usuário'),
  });

  // Count terminals per user
  const { data: terminals = [] } = useQuery({
    queryKey: ['terminals-admin'],
    queryFn: () => base44.entities.Terminal.list(),
  });

  // Conta por usuario_email (ownership real definido pelo admin) com fallback para created_by
  const terminalCountByUser = terminals.reduce((acc, t) => {
    const owner = t.usuario_email || t.created_by;
    if (owner) acc[owner] = (acc[owner] || 0) + 1;
    return acc;
  }, {});

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.User.update(id, data),
    onSuccess: (_, { id, data }) => {
      const u = users.find(u => u.id === id);
      logAudit('permissao_atualizada', id, `Permissões de ${u?.email || id} atualizadas (role: ${data.role}, limite: ${data.limite_terminais})`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Permissões atualizadas');
      handleCancel();
    },
    onError: () => toast.error('Erro ao atualizar permissões'),
  });

  // Fetch system config
  const { data: monitorConfig = [], refetch: refetchMonitorConfig } = useQuery({
    queryKey: ['monitor-config-admin'],
    queryFn: () => base44.entities.MonitorConfig.list(),
  });

  useEffect(() => {
    if (monitorConfig[0]?.intervalo_sync_minutos) {
      setRefreshInterval(String(monitorConfig[0].intervalo_sync_minutos));
    }
  }, [monitorConfig]);

  const handleSaveInterval = async () => {
    setSavingInterval(true);
    try {
      const interval = Math.max(1, parseInt(refreshInterval) || 5);
      if (monitorConfig[0]?.id) {
        await base44.entities.MonitorConfig.update(monitorConfig[0].id, { intervalo_sync_minutos: interval });
      } else {
        await base44.entities.MonitorConfig.create({ tipo: 'api_externa', intervalo_sync_minutos: interval, ativo: true });
      }
      toast.success('Intervalo de sincronização atualizado!');
      refetchMonitorConfig();
    } catch {
      toast.error('Erro ao salvar configuração');
    } finally {
      setSavingInterval(false);
    }
  };

  const { data: alertRules = [] } = useQuery({
    queryKey: ['alert-rules-admin'],
    queryFn: () => base44.entities.AlertRule.list(),
  });

  const logAudit = (acao, entidade_id, descricao) =>
    base44.functions.invoke('auditLog', { acao, entidade: 'User', entidade_id, descricao }).catch(() => {});

  const inviteMutation = useMutation({
    mutationFn: async ({ email, role, limite_terminais }) => {
      const user = await base44.users.inviteUser(email, role === 'admin' ? 'admin' : 'user');
      // Atualizar limite de terminais conforme definido pelo admin
      if (user?.id && !role?.includes('admin')) {
        await base44.entities.User.update(user.id, { limite_terminais: Number(limite_terminais) || 10 });
      }
      return user;
    },
    onSuccess: (_, { email, role, limite_terminais }) => {
      logAudit('usuario_convidado', '', `Usuário ${email} convidado com role "${role}" e limite ${limite_terminais}`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(`Convite enviado! Limite: ${role === 'admin' ? 'ilimitado' : limite_terminais} terminais.`);
      handleCancel();
    },
    onError: () => toast.error('Erro ao enviar convite'),
  });

  const handleEdit = (user) => {
    setEditingUser(user);
    setForm({
      email: user.email,
      role: user.role || 'user',
      limite_terminais: user.limite_terminais ?? 10,
    });
    setShowForm(true);
  };

  const handleNew = () => {
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingUser(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = () => {
    if (editingUser) {
      updateMutation.mutate({
        id: editingUser.id,
        data: {
          role: form.role,
          limite_terminais: Number(form.limite_terminais),
        },
      });
    } else {
      inviteMutation.mutate({ email: form.email, role: form.role === 'admin' ? 'admin' : 'user', limite_terminais: Number(form.limite_terminais) || 10 });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 w-full overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-6xl">

        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-slate-900 rounded-xl">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Administração</h1>
            <p className="text-sm text-slate-500">Gerencie usuários, permissões e configurações do sistema</p>
          </div>
        </div>

        {/* System Configuration Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Intervalo Sync</p>
                  <p className="text-2xl font-bold text-blue-900 mt-2">{monitorConfig[0]?.intervalo_sync_minutos || 5}m</p>
                  <p className="text-xs text-blue-600 mt-1">Atualização automática</p>
                </div>
                <Activity className="h-8 w-8 text-blue-400 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Usuários</p>
                  <p className="text-2xl font-bold text-emerald-900 mt-2">{approvedUsers.length}</p>
                  <p className="text-xs text-emerald-600 mt-1">{pendingUsers.length} pendentes</p>
                </div>
                <UserCheck className="h-8 w-8 text-emerald-400 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-orange-700 uppercase tracking-wider">Regras Alerta</p>
                  <p className="text-2xl font-bold text-orange-900 mt-2">{alertRules.filter(r => r.ativo).length}</p>
                  <p className="text-xs text-orange-600 mt-1">Ativas de {alertRules.length}</p>
                </div>
                <AlertCircle className="h-8 w-8 text-orange-400 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Contact Messages */}
        <ContactMessagesPanel />

        {/* Pending Approvals */}
        {pendingUsers.length > 0 && (
          <Card className="bg-amber-50 border-amber-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-amber-800">
                <Clock className="h-5 w-5 text-amber-600" />
                Aprovações Pendentes
                <span className="ml-1 bg-amber-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {pendingUsers.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {pendingUsers.map(user => (
          <PendingUserRow
            key={user.id}
            user={user}
            approveMutation={approveMutation}
            rejectMutation={rejectMutation}
            deletePendingMutation={deletePendingMutation}
          />
        ))}
            </CardContent>
          </Card>
        )}

        {/* User Management Card */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-5 w-5 text-slate-600" />
              Gerenciamento de Usuários
            </CardTitle>
            {!showForm && (
              <Button onClick={handleNew} size="sm" className="bg-blue-600 hover:bg-blue-700 gap-2">
                <UserPlus className="h-4 w-4" />
                <span className="hidden sm:inline">Adicionar Usuário</span>
                <span className="sm:hidden">Adicionar</span>
              </Button>
            )}
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Form */}
            {showForm && (
              <div className="border border-slate-200 rounded-xl p-5 bg-slate-50 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>Email do Usuário</Label>
                    <Input
                      value={form.email}
                      onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="usuario@email.com"
                      disabled={!!editingUser}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Select
                      value={form.role}
                      onValueChange={v => setForm(prev => ({ ...prev, role: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">⊙ Administrador — acesso total</SelectItem>
                        <SelectItem value="user">👤 Utilizador — acesso aos próprios dados</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Limite de Terminais</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.limite_terminais}
                      onChange={e => setForm(prev => ({ ...prev, limite_terminais: e.target.value }))}
                      placeholder="10"
                    />
                  </div>

                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={handleCancel} className="gap-1">
                    <X className="h-4 w-4" /> Cancelar
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={updateMutation.isPending || inviteMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700 gap-1"
                  >
                    <Check className="h-4 w-4" />
                    {editingUser ? 'Salvar' : 'Enviar Convite'}
                  </Button>
                </div>
              </div>
            )}

            {/* Users — cards on mobile, table on desktop */}
            {isLoading ? (
              <div className="text-center py-8 text-slate-400">Carregando...</div>
            ) : approvedUsers.length === 0 ? (
              <div className="text-center py-8 text-slate-400">Nenhum usuário encontrado</div>
            ) : (
              <>
                {/* Mobile cards */}
                <div className="sm:hidden space-y-2">
                  {approvedUsers.map(user => {
                    const count = terminalCountByUser[user.email] || 0;
                    const limit = user.limite_terminais ?? 0;
                    return (
                      <div key={user.id} className="border border-slate-200 rounded-xl p-3 bg-white space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-900 truncate">{user.email}</p>
                          <Badge className={cn("text-xs shrink-0", ROLE_COLORS[user.role] || ROLE_COLORS.user)}>
                            {ROLE_LABELS[user.role] || 'Utilizador'}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={cn("font-mono text-xs font-semibold", limit > 0 && count >= limit ? "text-red-600" : "text-emerald-600")}>
                            {count}{limit > 0 ? `/${limit}` : ''} terminais
                          </span>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(user)} className="h-7 w-7 text-slate-400 hover:text-blue-600">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {user.email !== currentUser?.email && (
                              <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Excluir ${user.email}?`)) deleteUserMutation.mutate(user.id); }} className="h-7 w-7 text-slate-400 hover:text-red-600">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Email</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Role</th>
                        <th className="text-center px-4 py-3 font-semibold text-slate-600">Terminais</th>
                        <th className="text-center px-4 py-3 font-semibold text-slate-600">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {approvedUsers.map(user => {
                        const count = terminalCountByUser[user.email] || 0;
                        const limit = user.limite_terminais ?? 0;
                        return (
                          <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-900 max-w-[200px] truncate">{user.email}</td>
                            <td className="px-4 py-3">
                              <Badge className={cn("text-xs", ROLE_COLORS[user.role] || ROLE_COLORS.user)}>
                                {user.role === 'admin' ? '⊙ ' : '👤 '}
                                {ROLE_LABELS[user.role] || 'Utilizador'}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={cn("font-mono text-xs font-semibold", limit > 0 && count >= limit ? "text-red-600" : "text-emerald-600")}>
                                {count}{limit > 0 ? `/${limit}` : ''}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Button variant="ghost" size="icon" onClick={() => handleEdit(user)} className="h-8 w-8 text-slate-400 hover:text-blue-600">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                {user.email !== currentUser?.email && (
                                  <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Excluir o usuário ${user.email}?`)) deleteUserMutation.mutate(user.id); }} className="h-8 w-8 text-slate-400 hover:text-red-600">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      {/* Intervalo de Sincronização */}
      <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-blue-600" />
            Intervalo de Sincronização
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">Frequência de atualização dos dados em Dashboard, Terminais e Modo TV.</p>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min="1"
              max="60"
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(e.target.value)}
              className="max-w-[120px]"
            />
            <span className="text-sm text-slate-500">minuto(s)</span>
            <Button onClick={handleSaveInterval} disabled={savingInterval} size="sm" className="bg-blue-600 hover:bg-blue-700 gap-2">
              <Save className="h-4 w-4" />
              {savingInterval ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* NOC Server */}
      <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-violet-600" />
            NOC Server — Windows Server (51.91.219.145)
          </CardTitle>
          <p className="text-sm text-slate-500">Servidor unificado para terminais: Heartbeat TCP, ADMS/Push (ZKTeco, Anviz) e SDK-TCP.</p>
        </CardHeader>
        <CardContent>
          <NocServerCode />
        </CardContent>
      </Card>

      {/* P2S Server */}
      <Card className="bg-white/80 backdrop-blur-sm border-violet-200/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-violet-600" />
            P2S Server — Push to Server (Windows Server)
          </CardTitle>
          <p className="text-sm text-slate-500">Serviço dedicado para terminais P2S: ZKTeco, Anviz, Suprema, Hikvision, Dahua, Nitgen.</p>
        </CardHeader>
        <CardContent>
          <P2sServerCode />
        </CardContent>
      </Card>

      {/* Timmy WebSocket Cloud Server */}
      <Card className="bg-white/80 backdrop-blur-sm border-violet-200/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-violet-600" />
            Timmy WebSocket Cloud Server
          </CardTitle>
          <p className="text-sm text-slate-500">Servidor WebSocket para terminais Timmy/THbio: TM-AI07F, TM-AIFace11F, TFS30, TFS50 e outros modelos com protocolo WebSocket+JSON.</p>
        </CardHeader>
        <CardContent>
          <TimmyWsServerCode />
        </CardContent>
      </Card>

      {/* Agent Installation Guide — admin only */}
      <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-emerald-600" />
            Instalação do Agente Local
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 text-sm">
            <div className="flex gap-3 items-start">
              <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">1</span>
              <div>
                <p className="font-medium text-slate-700">Baixe o NSSM (gerenciador de serviços Windows)</p>
                <a href="https://nssm.cc/download" target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs">nssm.cc/download</a>
                <p className="text-xs text-slate-500 mt-1">Extraia e copie <code className="bg-slate-100 px-1 rounded">nssm.exe</code> para <code className="bg-slate-100 px-1 rounded">C:\Program Files\Base44Agent\</code></p>
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">2</span>
              <div>
                <p className="font-medium text-slate-700">Copie o código fonte para <code className="bg-slate-100 px-1 rounded">C:\Program Files\Base44Agent\core_agent.py</code></p>
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">3</span>
              <div>
                <p className="font-medium text-slate-700">Crie o ficheiro de configuração:</p>
                <pre className="bg-slate-900 text-emerald-400 p-2 rounded text-xs mt-1 overflow-x-auto whitespace-pre-wrap">{`{\n  "API_KEY": "SUA_API_KEY",\n  "APP_ID": "697aa46c9998c30665e2e19a"\n}`}</pre>
                <p className="text-xs text-slate-500 mt-1">Guarde em <code className="bg-slate-100 px-1 rounded">C:\ProgramData\Base44Agent\config.json</code></p>
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">4</span>
              <div>
                <p className="font-medium text-slate-700">Instale como serviço Windows:</p>
                <pre className="bg-slate-900 text-emerald-400 p-1.5 rounded text-xs mt-1 overflow-x-auto whitespace-pre-wrap">{`nssm install Base44Agent python "C:\\Program Files\\Base44Agent\\core_agent.py"\nnssm start Base44Agent`}</pre>
              </div>
            </div>
          </div>
          <AgentSourceCode />
        </CardContent>
      </Card>

      </div>
    </div>
  );
}