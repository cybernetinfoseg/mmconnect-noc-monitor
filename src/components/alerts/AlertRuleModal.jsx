import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { X, Bell, Mail, Save, Slack } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const GATILHOS = [
  { value: 'terminal_offline', label: 'Terminal fica offline' },
  { value: 'terminal_online', label: 'Terminal volta online' },
  { value: 'sem_ping_minutos', label: 'Sem ping por X minutos' },
  { value: 'multiplos_offline', label: 'Múltiplos terminais offline (quantidade)' },
];

export default function AlertRuleModal({ rule, currentUser, onClose, onSaved }) {
  const isEdit = !!rule;
  const isAdmin = currentUser?.role === 'admin';
  const [saving, setSaving] = useState(false);
  const [filterUser, setFilterUser] = useState('');
  const [form, setForm] = useState({
    nome: '',
    ativo: true,
    gatilho: 'terminal_offline',
    condicao_valor: '',
    filtro_local: '',
    filtro_terminal_id: '',
    canal: 'email',
    destinatarios_email: '',
    slack_webhook_url: '',
    cooldown_minutos: 30,
  });

  useEffect(() => {
    if (rule) {
      setForm({
        nome: rule.nome || '',
        ativo: rule.ativo !== false,
        gatilho: rule.gatilho || 'terminal_offline',
        condicao_valor: rule.condicao_valor || '',
        filtro_local: rule.filtro_local || '',
        filtro_terminal_id: rule.filtro_terminal_id || '',
        canal: rule.canal || 'email',
        destinatarios_email: rule.destinatarios_email || '',
        slack_webhook_url: rule.slack_webhook_url || '',
        cooldown_minutos: rule.cooldown_minutos || 30,
      });
    }
  }, [rule]);

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users-alert-modal'],
    queryFn: () => base44.entities.User.list(),
    enabled: isAdmin,
  });

  const { data: terminals = [] } = useQuery({
    queryKey: ['terminals-for-filter'],
    queryFn: () => base44.entities.Terminal.list(),
  });

  // Terminals filtered by selected user (admin) or own terminals (non-admin)
  const filteredTerminals = isAdmin && filterUser
    ? terminals.filter(t => t.usuario_email === filterUser || t.created_by === filterUser)
    : terminals;

  // Locais with owner email shown
  const locaisComOwner = [...new Map(
    filteredTerminals
      .filter(t => t.local)
      .map(t => [t.local, { local: t.local, email: t.usuario_email || t.created_by }])
  ).values()].sort((a, b) => a.local.localeCompare(b.local));

  const needsValue = form.gatilho === 'sem_ping_minutos' || form.gatilho === 'multiplos_offline';
  const needsEmail = form.canal === 'email' || form.canal === 'ambos';
  const needsSlack = form.canal === 'slack' || form.canal === 'ambos';

  const isValid = form.nome &&
    (needsEmail ? form.destinatarios_email : true) &&
    (needsSlack ? form.slack_webhook_url : true);

  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    const data = {
      ...form,
      condicao_valor: form.condicao_valor ? Number(form.condicao_valor) : undefined,
      cooldown_minutos: Number(form.cooldown_minutos),
    };
    let result;
    if (isEdit) {
      result = await base44.entities.AlertRule.update(rule.id, data);
    } else {
      result = await base44.entities.AlertRule.create(data);
    }
    setSaving(false);
    onSaved(result || { ...data, id: rule?.id });
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <Bell className="h-5 w-5 text-orange-600" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">
              {isEdit ? 'Editar Regra' : 'Nova Regra de Alerta'}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Nome + Ativo */}
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-1.5">
              <Label>Nome da regra *</Label>
              <Input
                placeholder="Ex: Alerta terminal offline"
                value={form.nome}
                onChange={e => set('nome', e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch checked={form.ativo} onCheckedChange={v => set('ativo', v)} />
              <span className="text-sm text-slate-600">{form.ativo ? 'Ativa' : 'Inativa'}</span>
            </div>
          </div>

          {/* Gatilho */}
          <div className="space-y-1.5">
            <Label>Gatilho *</Label>
            <Select value={form.gatilho} onValueChange={v => set('gatilho', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GATILHOS.map(g => (
                  <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Valor da condição */}
          {needsValue && (
            <div className="space-y-1.5">
              <Label>
                {form.gatilho === 'sem_ping_minutos' ? 'Minutos sem ping' : 'Quantidade mínima de terminais offline'}
              </Label>
              <Input
                type="number"
                min={1}
                placeholder={form.gatilho === 'sem_ping_minutos' ? '5' : '3'}
                value={form.condicao_valor}
                onChange={e => set('condicao_valor', e.target.value)}
              />
            </div>
          )}

          {/* Filtros */}
          <div className="grid grid-cols-1 gap-3">
            {/* Filtro por utilizador (admin only) */}
            {isAdmin && (
              <div className="space-y-1.5">
                <Label>Filtrar por utilizador</Label>
                <select
                  value={filterUser}
                  onChange={e => {
                    setFilterUser(e.target.value);
                    set('filtro_local', '');
                    set('filtro_terminal_id', '');
                  }}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Todos os utilizadores</option>
                  {allUsers.map(u => (
                    <option key={u.email} value={u.email}>
                      {u.full_name ? `${u.full_name} (${u.email})` : u.email}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Filtrar por local */}
            <div className="space-y-1.5">
              <Label>Filtrar por local</Label>
              <Select value={form.filtro_local || 'todos'} onValueChange={v => { set('filtro_local', v === 'todos' ? '' : v); set('filtro_terminal_id', ''); }}>
                <SelectTrigger><SelectValue placeholder="Todos os locais" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os locais</SelectItem>
                  {locaisComOwner.map(({ local, email }) => (
                    <SelectItem key={local} value={local}>
                      <div className="flex flex-col leading-tight">
                        <span>{local}</span>
                        {email && <span className="text-xs text-slate-400">{email}</span>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filtrar por terminal */}
            <div className="space-y-1.5">
              <Label>Filtrar por terminal (opcional)</Label>
              <Select value={form.filtro_terminal_id || 'todos'} onValueChange={v => { set('filtro_terminal_id', v === 'todos' ? '' : v); set('filtro_local', ''); }}>
                <SelectTrigger><SelectValue placeholder="Todos os terminais" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os terminais</SelectItem>
                  {filteredTerminals.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex flex-col leading-tight">
                        <span>{t.nome}</span>
                        {(t.usuario_email || t.created_by) && (
                          <span className="text-xs text-slate-400">{t.usuario_email || t.created_by}</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Canal */}
          <div className="space-y-1.5">
            <Label>Canal de notificação *</Label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'email', label: 'E-mail', icon: '📧' },
                { value: 'slack', label: 'Slack', icon: '💬' },
                { value: 'ambos', label: 'Ambos', icon: '📡' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('canal', opt.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-sm font-medium transition-all",
                    form.canal === opt.value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 hover:border-slate-300 text-slate-600"
                  )}
                >
                  <span className="text-lg">{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Email */}
          {needsEmail && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-slate-400" />
                Destinatários de e-mail *
              </Label>
              <Input
                placeholder="email@empresa.com, outro@empresa.com"
                value={form.destinatarios_email}
                onChange={e => set('destinatarios_email', e.target.value)}
              />
              <p className="text-xs text-slate-400">Separe múltiplos e-mails por vírgula</p>
            </div>
          )}

          {/* Slack webhook */}
          {needsSlack && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-2">
                <span className="text-sm">💬</span>
                Slack Webhook URL *
              </Label>
              <Input
                placeholder="https://hooks.slack.com/services/..."
                value={form.slack_webhook_url}
                onChange={e => set('slack_webhook_url', e.target.value)}
              />
              <p className="text-xs text-slate-400">
                Crie um Incoming Webhook em{' '}
                <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="text-blue-500 underline">
                  api.slack.com/apps
                </a>
              </p>
            </div>
          )}

          {/* Cooldown */}
          <div className="space-y-1.5">
            <Label>Cooldown entre disparos (minutos)</Label>
            <Input
              type="number"
              min={1}
              value={form.cooldown_minutos}
              onChange={e => set('cooldown_minutos', e.target.value)}
            />
            <p className="text-xs text-slate-400">Evita spam: tempo mínimo entre dois disparos da mesma regra</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !isValid}
            className="bg-slate-900 hover:bg-slate-800 text-white gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Salvando...' : 'Salvar Regra'}
          </Button>
        </div>
      </div>
    </div>
  );
}