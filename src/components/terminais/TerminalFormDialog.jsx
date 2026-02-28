import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Wifi, Globe, Server, Link, Plus, Clock, Activity, Bell } from 'lucide-react';

const TIPOS_CONEXAO = [
  { value: 'ip_local',   label: 'IP Local',    icon: Wifi,   desc: 'IP na rede local (ex: 192.168.1.100)' },
  { value: 'ip_publico', label: 'IP Público',  icon: Globe,  desc: 'IP público/externo (ex: 203.0.113.1)' },
  { value: 'dns',        label: 'DNS / No-IP', icon: Server, desc: 'Hostname dinâmico (ex: host.no-ip.org)' },
  { value: 'api',        label: 'API HTTP',    icon: Link,   desc: 'Endpoint HTTP/HTTPS de status' },
];

// Mini form for quick client creation
function NewClienteInline({ onCreated, onCancel }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Cliente.create(data),
    onSuccess: (created) => {
      qc.invalidateQueries(['clientes']);
      toast.success('Cliente criado!');
      onCreated(created);
    },
    onError: () => toast.error('Erro ao criar cliente'),
  });

  return (
    <div className="border-2 border-blue-200 rounded-lg p-3 bg-blue-50 space-y-3">
      <p className="text-sm font-semibold text-blue-700 flex items-center gap-1">
        <Plus className="h-4 w-4" /> Novo Cliente
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Nome *</Label>
          <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do cliente" className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">E-mail</Label>
          <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@cliente.com" className="h-8 text-sm" type="email" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1">Cancelar</Button>
        <Button size="sm" onClick={() => createMutation.mutate({ nome, contato_email: email, ativo: true })}
          disabled={!nome || createMutation.isPending} className="flex-1 bg-blue-600 hover:bg-blue-700">
          {createMutation.isPending ? 'Criando...' : 'Criar Cliente'}
        </Button>
      </div>
    </div>
  );
}

export default function TerminalFormDialog({ open, onOpenChange, editingTerminal, clientes, onSuccess }) {
  const [formData, setFormData] = useState(() => editingTerminal || {
    tipo_conexao: 'ip_local',
    porta: 5005,
    ativo: true,
    monitoramento_ativo: true,
    notificar_offline: true,
    timeout_segundos: 30,
    intervalo_ping_segundos: 60,
  });
  const [showNewCliente, setShowNewCliente] = useState(false);
  const qc = useQueryClient();

  // Sync when editingTerminal changes
  React.useEffect(() => {
    if (open) {
      setFormData(editingTerminal || {
        tipo_conexao: 'ip_local',
        porta: 5005,
        ativo: true,
        monitoramento_ativo: true,
        notificar_offline: true,
        timeout_segundos: 30,
        intervalo_ping_segundos: 60,
      });
      setShowNewCliente(false);
    }
  }, [open, editingTerminal]);

  const set = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const cliente = clientes.find(c => c.id === data.cliente_id);
      const payload = { ...data, cliente_nome: cliente?.nome || data.cliente_nome || '' };
      if (editingTerminal) return base44.entities.Terminal.update(editingTerminal.id, payload);
      return base44.entities.Terminal.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries(['terminals-manage']);
      toast.success(editingTerminal ? 'Terminal atualizado' : 'Terminal criado');
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  const tipo = formData.tipo_conexao || 'ip_local';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingTerminal ? 'Editar Terminal' : 'Novo Terminal'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Identificação básica */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Identificação</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Nome *</Label>
                <Input value={formData.nome || ''} onChange={e => set('nome', e.target.value)} placeholder="BIO-001" />
              </div>
              <div className="space-y-1">
                <Label>Local *</Label>
                <Input value={formData.local || ''} onChange={e => set('local', e.target.value)} placeholder="Matriz - Recepção" />
              </div>
              <div className="space-y-1">
                <Label>Fabricante</Label>
                <Input value={formData.fabricante || ''} onChange={e => set('fabricante', e.target.value)} placeholder="Henry, Control iD, Intelbras..." />
              </div>
              <div className="space-y-1">
                <Label>Modelo</Label>
                <Input value={formData.modelo || ''} onChange={e => set('modelo', e.target.value)} placeholder="Ex: Argus X" />
              </div>
              <div className="space-y-1">
                <Label>Nº Série</Label>
                <Input value={formData.numero_serie || ''} onChange={e => set('numero_serie', e.target.value)} placeholder="SN123456789" />
              </div>
              <div className="space-y-1">
                <Label>Firmware</Label>
                <Input value={formData.firmware || ''} onChange={e => set('firmware', e.target.value)} placeholder="v2.3.1" />
              </div>
            </div>
          </div>

          <Separator />

          {/* Cliente */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Cliente</p>
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Select value={formData.cliente_id || ''} onValueChange={v => set('cliente_id', v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {clientes.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" variant="outline" size="icon" title="Cadastrar novo cliente"
                  onClick={() => setShowNewCliente(v => !v)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {showNewCliente && (
                <NewClienteInline
                  onCreated={(c) => { set('cliente_id', c.id); setShowNewCliente(false); }}
                  onCancel={() => setShowNewCliente(false)}
                />
              )}
            </div>
          </div>

          <Separator />

          {/* Tipo de Conexão */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Tipo de Conexão</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {TIPOS_CONEXAO.map(t => {
                const Icon = t.icon;
                const selected = tipo === t.value;
                return (
                  <button key={t.value} type="button" onClick={() => set('tipo_conexao', t.value)}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all",
                      selected ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300 bg-white"
                    )}>
                    <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", selected ? "text-blue-600" : "text-slate-400")} />
                    <div>
                      <p className={cn("text-sm font-medium", selected ? "text-blue-700" : "text-slate-700")}>{t.label}</p>
                      <p className="text-xs text-slate-400 leading-tight">{t.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Campos por tipo */}
            {(tipo === 'ip_local' || tipo === 'ip_publico' || tipo === 'dns') && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{tipo === 'ip_local' ? 'IP Local *' : tipo === 'ip_publico' ? 'IP Público *' : 'DNS / Hostname *'}</Label>
                  <Input
                    value={tipo === 'ip_local' ? formData.ip_local || '' : tipo === 'ip_publico' ? formData.ip_publico || '' : formData.dns || ''}
                    onChange={e => set(tipo === 'ip_local' ? 'ip_local' : tipo === 'ip_publico' ? 'ip_publico' : 'dns', e.target.value)}
                    placeholder={tipo === 'dns' ? 'meuhost.no-ip.org' : tipo === 'ip_publico' ? '203.0.113.1' : '192.168.1.100'}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Porta TCP</Label>
                  <Input type="number" value={formData.porta || 5005} onChange={e => set('porta', parseInt(e.target.value))} />
                </div>
              </div>
            )}

            {tipo === 'api' && (
              <div className="space-y-1">
                <Label>API Endpoint *</Label>
                <Input value={formData.api_endpoint || ''} onChange={e => set('api_endpoint', e.target.value)}
                  placeholder="https://api.exemplo.com/terminal/status" />
                <p className="text-xs text-slate-400">Deve retornar HTTP 200 quando online.</p>
              </div>
            )}
          </div>

          <Separator />

          {/* Configurações de Monitoramento */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Configurações de Monitoramento</p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-slate-400" />Timeout (segundos)</Label>
                  <Input type="number" min={5} max={120} value={formData.timeout_segundos ?? 30}
                    onChange={e => set('timeout_segundos', parseInt(e.target.value))} />
                  <p className="text-xs text-slate-400">Tempo máximo de espera por resposta</p>
                </div>
                <div className="space-y-1">
                  <Label className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-slate-400" />Intervalo de Ping (segundos)</Label>
                  <Input type="number" min={30} max={3600} value={formData.intervalo_ping_segundos ?? 60}
                    onChange={e => set('intervalo_ping_segundos', parseInt(e.target.value))} />
                  <p className="text-xs text-slate-400">Frequência de verificação do terminal</p>
                </div>
              </div>

              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-emerald-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-700">Monitoramento Ativo</p>
                      <p className="text-xs text-slate-400">Habilitar monitoramento em tempo real</p>
                    </div>
                  </div>
                  <Switch checked={formData.monitoramento_ativo !== false}
                    onCheckedChange={v => set('monitoramento_ativo', v)} />
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-amber-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-700">Notificar Offline</p>
                      <p className="text-xs text-slate-400">Enviar alerta quando terminal ficar offline</p>
                    </div>
                  </div>
                  <Switch checked={formData.notificar_offline !== false}
                    onCheckedChange={v => set('notificar_offline', v)} />
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Outros */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Outros</p>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Observações</Label>
                <Textarea value={formData.observacoes || ''} onChange={e => set('observacoes', e.target.value)} rows={2} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={formData.ativo !== false} onCheckedChange={v => set('ativo', v)} />
                <Label>Terminal ativo para monitoramento</Label>
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">Cancelar</Button>
            <Button onClick={() => saveMutation.mutate(formData)} disabled={saveMutation.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-700">
              {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}