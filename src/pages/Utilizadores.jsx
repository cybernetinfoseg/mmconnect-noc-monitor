import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Plus, Pencil, Trash2, Search, RefreshCw,
  Upload, Download, CheckCircle2, XCircle, Loader2,
  UserCheck, UserX, Send, ChevronDown, ChevronUp
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function Utilizadores() {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [formData, setFormData] = useState({});
  const [sendingTo, setSendingTo] = useState(null); // userId being sent
  const [sendResults, setSendResults] = useState({}); // userId -> result
  const [selectedTerminals, setSelectedTerminals] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [expandedUser, setExpandedUser] = useState(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const isAdmin = currentUser?.role === 'admin';

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['terminal-users'],
    queryFn: () => base44.entities.TerminalUser.list('-created_date', 200),
  });

  const { data: terminals = [] } = useQuery({
    queryKey: ['terminals-for-users'],
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

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        ...data,
        owner_email: data.owner_email || currentUser?.email,
        terminais_ids: selectedTerminals.length ? JSON.stringify(selectedTerminals) : '[]',
      };
      if (editingUser) return base44.entities.TerminalUser.update(editingUser.id, payload);
      return base44.entities.TerminalUser.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['terminal-users']);
      setDialogOpen(false);
      setEditingUser(null);
      setFormData({});
      setSelectedTerminals([]);
      toast.success(editingUser ? 'Utilizador atualizado' : 'Utilizador criado');
    },
    onError: (e) => toast.error(`Erro: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TerminalUser.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['terminal-users']);
      toast.success('Utilizador eliminado');
    },
    onError: (e) => toast.error(`Erro: ${e.message}`),
  });

  // Enviar utilizador para um ou mais terminais
  const handleSendToTerminals = async (user, terminalIds) => {
    if (!terminalIds?.length) { toast.error('Selecione pelo menos um terminal'); return; }
    setSendingTo(user.id);
    const results = {};
    for (const tid of terminalIds) {
      try {
        const resp = await base44.functions.invoke('terminalControl', {
          terminal_id: tid,
          action: 'adduser',
          params: {
            enrollid: user.enrollid,
            name: user.nome,
            password: user.password || '',
            card: user.card || '',
            privilege: user.privilege || 0,
          },
        });
        results[tid] = { success: resp.data?.success, message: resp.data?.message || resp.data?.error };
      } catch (e) {
        results[tid] = { success: false, message: e?.response?.data?.error || e.message };
      }
    }
    setSendResults(prev => ({ ...prev, [user.id]: results }));
    setSendingTo(null);
    const ok = Object.values(results).filter(r => r.success).length;
    const fail = Object.values(results).filter(r => !r.success).length;
    if (fail === 0) toast.success(`Utilizador enviado para ${ok} terminal(is) com sucesso`);
    else toast.error(`${ok} OK / ${fail} erro(s)`);
  };

  const handleNew = () => {
    setEditingUser(null);
    setFormData({ privilege: 0, ativo: true });
    setSelectedTerminals([]);
    setDialogOpen(true);
  };

  const handleEdit = (u) => {
    setEditingUser(u);
    setFormData(u);
    try { setSelectedTerminals(JSON.parse(u.terminais_ids || '[]')); } catch { setSelectedTerminals([]); }
    setDialogOpen(true);
  };

  const toggleTerminal = (tid) => {
    setSelectedTerminals(prev =>
      prev.includes(tid) ? prev.filter(id => id !== tid) : [...prev, tid]
    );
  };

  const filtered = useMemo(() =>
    users.filter(u =>
      !search ||
      u.nome?.toLowerCase().includes(search.toLowerCase()) ||
      String(u.enrollid)?.includes(search) ||
      u.departamento?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase())
    ), [users, search]
  );

  const getModoLabel = (mode) => {
    const m = { fp: '🖐️ FP', face: '😊 Face', card: '💳 Cartão', pw: '🔑 Senha' };
    return m[mode] || mode;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 w-full overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-5xl">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-teal-100 rounded-xl shrink-0">
              <Users className="h-6 w-6 text-teal-600" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Utilizadores dos Terminais</h1>
              <p className="text-xs sm:text-sm text-slate-500">{users.length} utilizador(es) cadastrados</p>
            </div>
          </div>
          <Button onClick={handleNew} size="sm" className="bg-teal-600 hover:bg-teal-700">
            <Plus className="h-4 w-4 mr-2" /> Novo Utilizador
          </Button>
        </div>

        {/* Search */}
        <Card className="bg-white/80 border-slate-200/50">
          <CardContent className="p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Pesquisar por nome, ID, departamento..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Users List */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {filtered.map((u) => {
                const termIds = (() => { try { return JSON.parse(u.terminais_ids || '[]'); } catch { return []; } })();
                const userTerminals = terminals.filter(t => termIds.includes(t.id));
                const isExpanded = expandedUser === u.id;
                const sendResult = sendResults[u.id];

                return (
                  <motion.div key={u.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Card className={cn('bg-white/80 border-slate-200/50', !u.ativo && 'opacity-60')}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                              <span className="text-teal-700 font-bold text-sm">{u.enrollid}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-slate-800">{u.nome}</p>
                                {!u.ativo && <Badge variant="outline" className="text-xs text-slate-400">Inativo</Badge>}
                                {u.privilege === 14 && <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200">Admin</Badge>}
                              </div>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {u.departamento && <span className="text-xs text-slate-500">{u.departamento}</span>}
                                {u.cargo && <span className="text-xs text-slate-400">• {u.cargo}</span>}
                                {u.email && <span className="text-xs text-slate-400">• {u.email}</span>}
                              </div>
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {u.card && <Badge variant="outline" className="text-xs">💳 Cartão</Badge>}
                                {u.password && <Badge variant="outline" className="text-xs">🔑 Senha</Badge>}
                                {userTerminals.length > 0 && (
                                  <Badge className="text-xs bg-teal-50 text-teal-700 border-teal-200">
                                    {userTerminals.length} terminal(is)
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              size="sm" variant="outline"
                              className="text-teal-600 hover:bg-teal-50 text-xs gap-1"
                              onClick={() => setExpandedUser(isExpanded ? null : u.id)}
                            >
                              <Send className="h-3 w-3" />
                              <span className="hidden sm:inline">Enviar</span>
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleEdit(u)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm" variant="outline"
                              onClick={() => setDeleteId(u.id)}
                              className="text-red-500 hover:bg-red-50"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        {/* Painel de envio para terminais */}
                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-slate-100">
                            <p className="text-sm font-semibold text-slate-700 mb-3">Enviar para terminais:</p>
                            {terminals.length === 0 ? (
                              <p className="text-xs text-slate-400">Nenhum terminal disponível.</p>
                            ) : (
                              <div className="space-y-2">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {terminals.map(t => {
                                    const res = sendResult?.[t.id];
                                    return (
                                      <div key={t.id} className="flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-slate-50">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <input
                                            type="checkbox"
                                            className="rounded"
                                            checked={termIds.includes(t.id)}
                                            onChange={() => {
                                              // Toggle inscription in memory (não salva — apenas para envio pontual)
                                            }}
                                          />
                                          <div className="min-w-0">
                                            <p className="text-xs font-medium text-slate-700 truncate">{t.nome}</p>
                                            <p className="text-xs text-slate-400 truncate">{t.local}</p>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          {res && (
                                            res.success
                                              ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                              : <XCircle className="h-4 w-4 text-red-400" title={res.message} />
                                          )}
                                          <Button
                                            size="sm"
                                            className="h-7 px-2 text-xs bg-teal-600 hover:bg-teal-700"
                                            disabled={sendingTo === u.id}
                                            onClick={() => handleSendToTerminals(u, [t.id])}
                                          >
                                            {sendingTo === u.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                                          </Button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                <Button
                                  size="sm"
                                  className="w-full bg-teal-600 hover:bg-teal-700 gap-2"
                                  disabled={sendingTo === u.id || terminals.length === 0}
                                  onClick={() => handleSendToTerminals(u, terminals.map(t => t.id))}
                                >
                                  {sendingTo === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                  Enviar para Todos os Terminais
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {filtered.length === 0 && !isLoading && (
              <Card className="bg-white/80 border-slate-200/50">
                <CardContent className="py-12 text-center text-slate-400">
                  <Users className="h-12 w-12 mx-auto mb-3" />
                  <p>Nenhum utilizador encontrado</p>
                  <Button onClick={handleNew} className="mt-4 bg-teal-600 hover:bg-teal-700">
                    <Plus className="h-4 w-4 mr-2" /> Criar primeiro utilizador
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Dialog: Create / Edit */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Editar Utilizador' : 'Novo Utilizador'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>ID de Inscrição *</Label>
                <Input
                  type="number"
                  placeholder="Ex: 1001"
                  value={formData.enrollid || ''}
                  onChange={e => setFormData(f => ({ ...f, enrollid: Number(e.target.value) }))}
                />
                <p className="text-xs text-slate-400">ID único no terminal</p>
              </div>
              <div className="space-y-1">
                <Label>Nome *</Label>
                <Input
                  placeholder="Nome completo"
                  value={formData.nome || ''}
                  onChange={e => setFormData(f => ({ ...f, nome: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="email@empresa.com"
                  value={formData.email || ''}
                  onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Departamento</Label>
                <Input
                  placeholder="RH, TI, Produção..."
                  value={formData.departamento || ''}
                  onChange={e => setFormData(f => ({ ...f, departamento: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Cargo / Função</Label>
                <Input
                  placeholder="Engenheiro, Operador..."
                  value={formData.cargo || ''}
                  onChange={e => setFormData(f => ({ ...f, cargo: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Privilégio</Label>
                <Select
                  value={String(formData.privilege ?? 0)}
                  onValueChange={v => setFormData(f => ({ ...f, privilege: Number(v) }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Utilizador Normal</SelectItem>
                    <SelectItem value="14">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Nº Cartão RFID</Label>
                <Input
                  placeholder="Opcional"
                  value={formData.card || ''}
                  onChange={e => setFormData(f => ({ ...f, card: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Senha Numérica</Label>
                <Input
                  type="password"
                  placeholder="Opcional"
                  value={formData.password || ''}
                  onChange={e => setFormData(f => ({ ...f, password: e.target.value }))}
                />
              </div>
            </div>

            {/* Terminais */}
            {terminals.length > 0 && (
              <div className="space-y-2">
                <Label>Terminais Associados</Label>
                <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2">
                  {terminals.map(t => (
                    <label key={t.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                      <input
                        type="checkbox"
                        checked={selectedTerminals.includes(t.id)}
                        onChange={() => toggleTerminal(t.id)}
                        className="rounded"
                      />
                      <span className="text-sm">{t.nome}</span>
                      <span className="text-xs text-slate-400">{t.local}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-400">Selecione os terminais onde este utilizador terá acesso.</p>
              </div>
            )}

            <div className="space-y-1">
              <Label>Observações</Label>
              <Textarea
                rows={2}
                placeholder="Notas adicionais..."
                value={formData.observacoes || ''}
                onChange={e => setFormData(f => ({ ...f, observacoes: e.target.value }))}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={formData.ativo !== false}
                onCheckedChange={v => setFormData(f => ({ ...f, ativo: v }))}
              />
              <Label>Utilizador ativo</Label>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700"
                disabled={saveMutation.isPending || !formData.enrollid || !formData.nome}
                onClick={() => saveMutation.mutate(formData)}
              >
                {saveMutation.isPending ? 'A guardar...' : 'Guardar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete */}
      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar utilizador?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação é permanente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700"
              onClick={() => { deleteMutation.mutate(deleteId); setDeleteId(null); }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}