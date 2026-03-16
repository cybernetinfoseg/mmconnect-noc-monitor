import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

export default function NovoClienteModal({ open, onClose, onCreated }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({ ativo: true });

  const saveMutation = useMutation({
    mutationFn: (data) => base44.entities.Cliente.create(data),
    onSuccess: (novoCliente) => {
      queryClient.invalidateQueries(['clientes']);
      queryClient.invalidateQueries(['clientes-manage']);
      queryClient.invalidateQueries(['my-clientes']);
      queryClient.invalidateQueries(['my-terminals-for-clientes']);
      toast.success(`Cliente "${novoCliente.nome}" criado!`);
      onCreated(novoCliente);
      setFormData({ ativo: true });
      onClose();
    },
    onError: () => toast.error('Erro ao criar cliente'),
  });

  const handleClose = () => {
    setFormData({ ativo: true });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Cliente</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                autoFocus
                value={formData.nome || ''}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Razão Social</Label>
              <Input
                value={formData.razao_social || ''}
                onChange={(e) => setFormData({ ...formData, razao_social: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>CNPJ</Label>
            <Input
              value={formData.cnpj || ''}
              onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome do Contato</Label>
              <Input
                value={formData.contato_nome || ''}
                onChange={(e) => setFormData({ ...formData, contato_nome: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Email do Contato</Label>
              <Input
                type="email"
                value={formData.contato_email || ''}
                onChange={(e) => setFormData({ ...formData, contato_email: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Telefone do Contato</Label>
            <Input
              value={formData.contato_telefone || ''}
              onChange={(e) => setFormData({ ...formData, contato_telefone: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Endereço</Label>
            <Textarea
              value={formData.endereco || ''}
              onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={formData.observacoes || ''}
              onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
              rows={3}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={formData.ativo !== false}
              onCheckedChange={(checked) => setFormData({ ...formData, ativo: checked })}
            />
            <Label>Cliente ativo</Label>
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="outline" onClick={handleClose} className="flex-1">
              Cancelar
            </Button>
            <Button
              onClick={() => saveMutation.mutate(formData)}
              disabled={!formData.nome?.trim() || saveMutation.isPending}
              className="flex-1 bg-purple-600 hover:bg-purple-700"
            >
              {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}