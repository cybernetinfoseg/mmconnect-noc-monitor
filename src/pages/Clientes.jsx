import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Building2, 
  Plus, 
  Pencil, 
  Trash2, 
  Search,
  Mail,
  Phone,
  MapPin,
  Monitor,
  Wifi,
  WifiOff
} from 'lucide-react';
import ClienteTerminaisModal from '../components/clientes/ClienteTerminaisModal';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export default function Clientes() {
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCliente, setEditingCliente] = useState(null);
  const [formData, setFormData] = useState({});
  const [viewingTerminaisCliente, setViewingTerminaisCliente] = useState(null);
  
  const queryClient = useQueryClient();

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-manage'],
    queryFn: () => base44.entities.Cliente.list('-created_date'),
  });

  const { data: allTerminals = [] } = useQuery({
    queryKey: ['terminals-all'],
    queryFn: () => base44.entities.Terminal.list(),
    refetchInterval: 30000,
  });

  // Map: cliente nome -> { total, online, offline }
  const terminalCountsByCliente = useMemo(() => {
    const map = {};
    allTerminals.forEach(t => {
      const key = t.cliente_nome || t.cliente || '';
      if (!key) return;
      if (!map[key]) map[key] = { total: 0, online: 0, offline: 0 };
      map[key].total++;
      if (t.status === 'online') map[key].online++;
      else map[key].offline++;
    });
    return map;
  }, [allTerminals]);

  const saveMutation = useMutation({
    mutationFn: (data) => {
      if (editingCliente) {
        return base44.entities.Cliente.update(editingCliente.id, data);
      }
      return base44.entities.Cliente.create(data);
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries(['clientes-manage']);
      const previous = queryClient.getQueryData(['clientes-manage']);
      const optimistic = { ...data, id: editingCliente?.id || `temp-${Date.now()}` };
      queryClient.setQueryData(['clientes-manage'], (old = []) =>
        editingCliente
          ? old.map(c => c.id === editingCliente.id ? optimistic : c)
          : [optimistic, ...old]
      );
      return { previous };
    },
    onError: (_err, _data, ctx) => {
      queryClient.setQueryData(['clientes-manage'], ctx.previous);
      toast.error('Erro ao salvar cliente');
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['clientes-manage']);
      queryClient.invalidateQueries(['clientes']);
      setDialogOpen(false);
      setEditingCliente(null);
      setFormData({});
      toast.success(editingCliente ? 'Cliente atualizado' : 'Cliente criado');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Cliente.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries(['clientes-manage']);
      const previous = queryClient.getQueryData(['clientes-manage']);
      queryClient.setQueryData(['clientes-manage'], (old = []) => old.filter(c => c.id !== id));
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      queryClient.setQueryData(['clientes-manage'], ctx.previous);
      toast.error('Erro ao excluir cliente');
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['clientes-manage']);
      queryClient.invalidateQueries(['clientes']);
      toast.success('Cliente excluído');
    }
  });

  const filteredClientes = useMemo(() => {
    return clientes.filter(c => 
      !searchTerm || 
      c.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.razao_social?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.cnpj?.includes(searchTerm)
    );
  }, [clientes, searchTerm]);

  const handleEdit = (cliente) => {
    setEditingCliente(cliente);
    setFormData(cliente);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditingCliente(null);
    setFormData({ ativo: true });
    setDialogOpen(true);
  };

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const handleDelete = (id) => {
    if (confirm('Tem certeza que deseja excluir este cliente?')) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-6">
      <div className="max-w-[1920px] mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-xl shrink-0">
              <Building2 className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Gestão de Clientes</h1>
              <p className="text-sm text-slate-500 hidden sm:block">Gerenciar cadastro de clientes</p>
            </div>
          </div>
          
          <Button onClick={handleNew} size="sm" className="bg-purple-600 hover:bg-purple-700 shrink-0">
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Novo Cliente</span>
          </Button>
        </div>

        <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Buscar por nome, razão social ou CNPJ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredClientes.map((cliente, index) => (
              <motion.div
                key={cliente.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ delay: index * 0.02 }}
              >
                <Card className={cn(
                  "bg-white/80 backdrop-blur-sm border-slate-200/50 hover:shadow-lg transition-all",
                  !cliente.ativo && "opacity-60"
                )}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {cliente.nome}
                          {!cliente.ativo && (
                            <Badge variant="outline" className="text-xs">Inativo</Badge>
                          )}
                        </CardTitle>
                        {cliente.razao_social && (
                          <p className="text-sm text-slate-500 mt-1">{cliente.razao_social}</p>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {/* Terminal counts */}
                    {(() => {
                      const counts = terminalCountsByCliente[cliente.nome] || { total: 0, online: 0, offline: 0 };
                      return (
                        <button
                          onClick={() => setViewingTerminaisCliente(cliente)}
                          className="w-full flex items-center gap-2 p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors border border-slate-100"
                        >
                          <Monitor className="h-4 w-4 text-blue-500 shrink-0" />
                          <span className="text-xs font-semibold text-slate-600">{counts.total} terminais</span>
                          {counts.total > 0 && (
                            <>
                              <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600 font-medium">
                                <Wifi className="h-3 w-3" />{counts.online}
                              </span>
                              {counts.offline > 0 && (
                                <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
                                  <WifiOff className="h-3 w-3" />{counts.offline}
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      );
                    })()}

                    {cliente.cnpj && (
                      <div className="text-sm text-slate-600">
                        <span className="text-slate-500">CNPJ:</span> {cliente.cnpj}
                      </div>
                    )}
                    
                    {cliente.contato_email && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Mail className="h-3 w-3 text-slate-400" />
                        {cliente.contato_email}
                      </div>
                    )}
                    
                    {cliente.contato_telefone && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Phone className="h-3 w-3 text-slate-400" />
                        {cliente.contato_telefone}
                      </div>
                    )}

                    {cliente.endereco && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <MapPin className="h-3 w-3 text-slate-400" />
                        {cliente.endereco}
                      </div>
                    )}
                    
                    <div className="flex gap-2 pt-2 border-t border-slate-100">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(cliente)}
                        className="flex-1"
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(cliente.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {filteredClientes.length === 0 && (
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
            <CardContent className="py-12 text-center text-slate-400">
              <Building2 className="h-12 w-12 mx-auto mb-3" />
              <p>Nenhum cliente encontrado</p>
            </CardContent>
          </Card>
        )}
      </div>

      <ClienteTerminaisModal
        cliente={viewingTerminaisCliente}
        onClose={() => setViewingTerminaisCliente(null)}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCliente ? 'Editar Cliente' : 'Novo Cliente'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  value={formData.nome || ''}
                  onChange={(e) => setFormData({...formData, nome: e.target.value})}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Razão Social</Label>
                <Input
                  value={formData.razao_social || ''}
                  onChange={(e) => setFormData({...formData, razao_social: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>CNPJ</Label>
              <Input
                value={formData.cnpj || ''}
                onChange={(e) => setFormData({...formData, cnpj: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome do Contato</Label>
                <Input
                  value={formData.contato_nome || ''}
                  onChange={(e) => setFormData({...formData, contato_nome: e.target.value})}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Email do Contato</Label>
                <Input
                  type="email"
                  value={formData.contato_email || ''}
                  onChange={(e) => setFormData({...formData, contato_email: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Telefone do Contato</Label>
              <Input
                value={formData.contato_telefone || ''}
                onChange={(e) => setFormData({...formData, contato_telefone: e.target.value})}
              />
            </div>

            <div className="space-y-2">
              <Label>Endereço</Label>
              <Textarea
                value={formData.endereco || ''}
                onChange={(e) => setFormData({...formData, endereco: e.target.value})}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={formData.observacoes || ''}
                onChange={(e) => setFormData({...formData, observacoes: e.target.value})}
                rows={3}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={formData.ativo !== false}
                onCheckedChange={(checked) => setFormData({...formData, ativo: checked})}
              />
              <Label>Cliente ativo</Label>
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="flex-1 bg-purple-600 hover:bg-purple-700"
              >
                {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}