import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { UserPlus, UserX, X, Loader2 } from 'lucide-react';

/**
 * Formulário inline para ações que requerem dados do utilizador:
 * - adduser: nome, ID, tipo de acesso (FP/Card/Face/Password)
 * - blockuser: ID do utilizador a bloquear/desbloquear
 */
export default function UserActionForm({ action, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState({
    enrollid: '',
    name: '',
    password: '',
    card: '',
    privilege: '0',       // 0=user, 14=admin
    accgroup: '1',
    timezone: '1',
    block: false,
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  if (action === 'adduser') {
    return (
      <div className="bg-white border border-blue-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-blue-700">
            <UserPlus className="h-4 w-4" />
            <span className="font-semibold text-sm">Adicionar Utilizador</span>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">ID / Número *</Label>
            <Input
              placeholder="Ex: 1001"
              value={form.enrollid}
              onChange={e => set('enrollid', e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Nome *</Label>
            <Input
              placeholder="Nome do utilizador"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Palavra-passe</Label>
            <Input
              type="password"
              placeholder="Opcional"
              value={form.password}
              onChange={e => set('password', e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Nº Cartão</Label>
            <Input
              placeholder="Opcional"
              value={form.card}
              onChange={e => set('card', e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Privilégio</Label>
          <Select value={form.privilege} onValueChange={v => set('privilege', v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Utilizador normal</SelectItem>
              <SelectItem value="14">Administrador</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={onCancel}>Cancelar</Button>
          <Button
            size="sm"
            className="flex-1"
            disabled={loading || !form.enrollid || !form.name}
            onClick={() => onSubmit({ ...form, enrollid: Number(form.enrollid) || form.enrollid })}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Adicionar'}
          </Button>
        </div>
      </div>
    );
  }

  if (action === 'blockuser') {
    return (
      <div className="bg-white border border-rose-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-700">
            <UserX className="h-4 w-4" />
            <span className="font-semibold text-sm">Bloquear / Desbloquear Utilizador</span>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">ID / Número do Utilizador *</Label>
          <Input
            placeholder="Ex: 1001"
            value={form.enrollid}
            onChange={e => set('enrollid', e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
          <Switch
            checked={form.block}
            onCheckedChange={v => set('block', v)}
          />
          <div>
            <p className="text-sm font-medium text-slate-700">{form.block ? 'Bloquear acesso' : 'Desbloquear acesso'}</p>
            <p className="text-xs text-slate-400">{form.block ? 'O utilizador não poderá entrar' : 'Restaurar acesso ao utilizador'}</p>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={onCancel}>Cancelar</Button>
          <Button
            size="sm"
            className={`flex-1 ${form.block ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
            disabled={loading || !form.enrollid}
            onClick={() => onSubmit({ enrollid: Number(form.enrollid) || form.enrollid, block: form.block })}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : form.block ? 'Bloquear' : 'Desbloquear'}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}