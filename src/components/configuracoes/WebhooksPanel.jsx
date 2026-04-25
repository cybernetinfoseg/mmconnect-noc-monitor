import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Webhook,
  Plus,
  Trash2,
  Send,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Zap,
} from 'lucide-react';

const ALL_EVENTS = [
  { key: 'terminal_offline',   label: 'Terminal Offline',   color: 'bg-red-100 text-red-700 border-red-200' },
  { key: 'terminal_restored',  label: 'Terminal Restaurado', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { key: 'incident_created',   label: 'Incidente Criado',   color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { key: 'incident_resolved',  label: 'Incidente Resolvido', color: 'bg-blue-100 text-blue-700 border-blue-200' },
];

const EMPTY_FORM = { nome: '', url: '', secret: '', eventos: [] };

function WebhookForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const [showSecret, setShowSecret] = useState(false);

  const toggleEvento = (key) => {
    setForm(f => ({
      ...f,
      eventos: f.eventos.includes(key)
        ? f.eventos.filter(e => e !== key)
        : [...f.eventos, key],
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.nome.trim() || !form.url.trim()) {
      toast.error('Nome e URL são obrigatórios');
      return;
    }
    if (form.eventos.length === 0) {
      toast.error('Seleccione pelo menos um evento');
      return;
    }
    try { new URL(form.url); } catch {
      toast.error('URL inválido');
      return;
    }
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">Nome *</Label>
          <Input
            value={form.nome}
            onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
            placeholder="Ex: Alertas para Zapier"
            className="text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">URL de Destino *</Label>
          <Input
            value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            placeholder="https://hooks.zapier.com/..."
            className="text-sm font-mono"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-slate-600 flex items-center justify-between">
          <span>Segredo HMAC (opcional)</span>
          <button type="button" onClick={() => setShowSecret(v => !v)} className="text-slate-400 hover:text-slate-600 flex items-center gap-1 text-xs">
            {showSecret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showSecret ? 'Ocultar' : 'Mostrar'}
          </button>
        </Label>
        <Input
          type={showSecret ? 'text' : 'password'}
          value={form.secret}
          onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
          placeholder="Segredo para validar assinatura X-NOC-Signature"
          className="text-sm font-mono"
        />
        <p className="text-xs text-slate-400">O payload será assinado com HMAC-SHA256. Verifique o header <code className="bg-slate-200 px-1 rounded">X-NOC-Signature</code> no seu endpoint.</p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-slate-600">Eventos *</Label>
        <div className="flex flex-wrap gap-2">
          {ALL_EVENTS.map(ev => (
            <button
              key={ev.key}
              type="button"
              onClick={() => toggleEvento(ev.key)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                form.eventos.includes(ev.key)
                  ? ev.color + ' shadow-sm'
                  : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {form.eventos.includes(ev.key) && <CheckCircle className="inline h-3 w-3 mr-1" />}
              {ev.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
          {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
          Guardar
        </Button>
      </div>
    </form>
  );
}

function WebhookRow({ webhook, onDelete, onTest, onToggle, testing }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${webhook.ativo ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-70'}`}>
      <div className="flex items-center justify-between px-4 py-3 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-1.5 rounded-lg ${webhook.ativo ? 'bg-emerald-100' : 'bg-slate-100'}`}>
            <Webhook className={`h-4 w-4 ${webhook.ativo ? 'text-emerald-600' : 'text-slate-400'}`} />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-sm text-slate-900 truncate">{webhook.nome}</p>
            <p className="text-xs text-slate-400 font-mono truncate">{webhook.url}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {webhook.ultimo_status_http && (
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${webhook.ultimo_status_http < 300 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
              {webhook.ultimo_status_http}
            </span>
          )}
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7"
            title="Expandir"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-blue-600 hover:bg-blue-50"
            title="Enviar teste"
            disabled={testing}
            onClick={() => onTest(webhook.id)}
          >
            {testing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-slate-500 hover:bg-slate-100"
            title={webhook.ativo ? 'Desactivar' : 'Activar'}
            onClick={() => onToggle(webhook)}
          >
            <Zap className={`h-3.5 w-3.5 ${webhook.ativo ? 'text-emerald-500' : 'text-slate-300'}`} />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-red-500 hover:bg-red-50"
            title="Eliminar"
            onClick={() => onDelete(webhook.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 border-t border-slate-100 pt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {ALL_EVENTS.map(ev => (
              webhook.eventos?.includes(ev.key) && (
                <span key={ev.key} className={`px-2 py-0.5 rounded-full border text-xs font-medium ${ev.color}`}>
                  {ev.label}
                </span>
              )
            ))}
          </div>
          <div className="flex gap-4 text-xs text-slate-400">
            <span>Disparos: <strong className="text-slate-600">{webhook.total_disparos || 0}</strong></span>
            {webhook.ultimo_disparo && (
              <span>Último: <strong className="text-slate-600">{new Date(webhook.ultimo_disparo).toLocaleString('pt-PT')}</strong></span>
            )}
            {webhook.secret && <span className="text-emerald-600">🔐 HMAC activo</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function WebhooksPanel() {
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => { setCurrentUser(u); loadWebhooks(u); }).catch(() => setLoading(false));
  }, []);

  const loadWebhooks = async (user) => {
    setLoading(true);
    const u = user || currentUser;
    if (!u) { setLoading(false); return; }
    const all = await base44.entities.WebhookConfig.filter({ user_email: u.email }, '-created_date');
    setWebhooks(all);
    setLoading(false);
  };

  const handleSave = async (form) => {
    setSaving(true);
    await base44.entities.WebhookConfig.create({
      ...form,
      user_email: currentUser.email,
      ativo: true,
      total_disparos: 0,
    });
    toast.success('Webhook criado!');
    setShowForm(false);
    await loadWebhooks();
    setSaving(false);
  };

  const handleDelete = async (id) => {
    await base44.entities.WebhookConfig.delete(id);
    toast.success('Webhook eliminado');
    setWebhooks(w => w.filter(x => x.id !== id));
  };

  const handleToggle = async (webhook) => {
    await base44.entities.WebhookConfig.update(webhook.id, { ativo: !webhook.ativo });
    setWebhooks(w => w.map(x => x.id === webhook.id ? { ...x, ativo: !x.ativo } : x));
  };

  const handleTest = async (id) => {
    setTestingId(id);
    try {
      const res = await base44.functions.invoke('webhookDispatch', { action: 'test', webhook_id: id });
      const data = res.data;
      if (data?.success) {
        toast.success(`Teste enviado! HTTP ${data.http_status}`);
        await loadWebhooks();
      } else {
        toast.error(data?.error || 'Falha no teste');
      }
    } catch (e) {
      toast.error('Erro ao testar webhook');
    } finally {
      setTestingId(null);
    }
  };

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-violet-600" />
            Webhooks & Integrações Externas
          </span>
          {!showForm && (
            <Button size="sm" onClick={() => setShowForm(true)} className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Novo Webhook
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          Envie eventos em tempo real para qualquer URL externo — Zapier, Make, n8n, Slack, etc.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Formato do payload */}
        <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg text-xs text-violet-800 space-y-1">
          <p className="font-semibold">📦 Formato do payload enviado</p>
          <pre className="bg-violet-100 rounded p-2 text-[11px] overflow-x-auto font-mono leading-relaxed">{`{
  "event": "terminal_offline",
  "timestamp": "2026-04-19T10:00:00Z",
  "data": {
    "terminal_id": "abc123",
    "terminal_nome": "Terminal 01",
    "local": "Recepção",
    "cliente": "Empresa X",
    "tipo": "offline",
    "timestamp": "2026-04-19T10:00:00Z"
  }
}`}</pre>
        </div>

        {showForm && (
          <WebhookForm
            onSave={handleSave}
            onCancel={() => setShowForm(false)}
            saving={saving}
          />
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : webhooks.length === 0 ? (
          <div className="text-center py-8 text-slate-400 space-y-2">
            <Webhook className="h-10 w-10 mx-auto opacity-30" />
            <p className="text-sm">Nenhum webhook configurado.</p>
            <p className="text-xs">Clique em "Novo Webhook" para integrar com serviços externos.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {webhooks.map(wh => (
              <WebhookRow
                key={wh.id}
                webhook={wh}
                onDelete={handleDelete}
                onTest={handleTest}
                onToggle={handleToggle}
                testing={testingId === wh.id}
              />
            ))}
          </div>
        )}

        {/* Integrações sugeridas */}
        <div className="pt-2 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-500 mb-2">Compatível com</p>
          <div className="flex flex-wrap gap-2">
            {['Zapier', 'Make (Integromat)', 'n8n', 'Pipedream', 'Slack', 'Microsoft Teams', 'PagerDuty', 'Opsgenie', 'Custom API'].map(s => (
              <span key={s} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full border border-slate-200">{s}</span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}