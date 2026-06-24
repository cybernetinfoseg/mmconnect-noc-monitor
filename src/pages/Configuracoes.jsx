import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import {
  Settings, Trash2, AlertTriangle, Bot, Key, Copy,
  Info, RefreshCw, Eye, EyeOff, CheckCircle, XCircle,
  Plug, Radio, Save, Shield, Server, Bell, Clock
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import TelegramConfig from '../components/configuracoes/TelegramConfig';
import AdmsServerCode from '../components/configuracoes/AdmsServerCode';
import AgentSourceCode from '../components/configuracoes/AgentSourceCode';
import NocServerCode from '../components/configuracoes/NocServerCode';
import P2sServerCode from '../components/configuracoes/P2sServerCode';
import TimmyWsServerCode from '../components/configuracoes/TimmyWsServerCode';
import MbioWsServerCode from '../components/configuracoes/MbioWsServerCode';

const APP_ID = '6a03a4a955920c15fb675d2a';

export default function Configuracoes() {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState('5');
  const [savingInterval, setSavingInterval] = useState(false);

  useEffect(() => {
    base44.auth.me().then(async (me) => {
      if (!me) return;
      try {
        const fullUser = await base44.entities.User.get(me.id);
        setCurrentUser({ ...me, ...fullUser });
      } catch {
        setCurrentUser(me);
      }
      try {
        const res = await base44.functions.invoke('getUserApiKey', {});
        if (res.data?.api_key) setCurrentUser(prev => ({ ...prev, api_key: res.data.api_key }));
      } catch { /* silent */ }
    }).catch(() => {});
  }, []);

  const isAdmin = currentUser?.role === 'admin';

  const { data: monitorConfig = [], refetch: refetchMonitorConfig } = useQuery({
    queryKey: ['monitor-config'],
    queryFn: () => base44.entities.MonitorConfig.list(),
    enabled: isAdmin,
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

  const copyToClipboard = (value, label) => {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copiado!`);
  };

  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestResult(null);
    try {
      const res = await base44.functions.invoke('testApiKey', { api_key: currentUser?.api_key });
      const data = res.data;
      if (data?.success) {
        setTestResult({ ok: true, msg: `API Key válida — ${data.terminals ?? 0} terminal(is) associado(s)` });
      } else {
        setTestResult({ ok: false, msg: data?.error || 'API Key inválida ou sem terminais' });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e.message || 'Erro de ligação' });
    } finally {
      setTestingConn(false);
    }
  };

  const handleGenerateApiKey = async () => {
    setGeneratingKey(true);
    try {
      const res = await base44.functions.invoke('generateUserApiKey', {});
      const newApiKey = res.data?.api_key;
      if (newApiKey) {
        setCurrentUser(prev => ({ ...prev, api_key: newApiKey }));
        setShowApiKey(true);
        toast.success('Nova API Key gerada! Copie e configure no seu agente.');
      }
    } catch {
      toast.error('Erro ao gerar API Key');
    } finally {
      setGeneratingKey(false);
    }
  };

  // Decide tabs available
  const tabs = isAdmin
    ? ['agente', 'servidores', 'notificacoes', 'sistema', 'conta']
    : ['agente', 'notificacoes', 'conta'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 w-full overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-5xl">

        {/* Header */}
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="p-2 sm:p-3 bg-slate-900 rounded-xl shrink-0">
            <Settings className="h-5 sm:h-6 w-5 sm:w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Configurações</h1>
            <p className="text-xs sm:text-sm text-slate-500">
              {isAdmin ? 'Agente local, servidores e configurações do sistema' : 'Agente local e preferências de conta'}
            </p>
          </div>
        </div>

        <Tabs defaultValue="agente">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-slate-100 p-1 rounded-xl">
            <TabsTrigger value="agente" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Bot className="h-3.5 w-3.5" /> Agente Local
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="servidores" className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Server className="h-3.5 w-3.5" /> Servidores
              </TabsTrigger>
            )}
            <TabsTrigger value="notificacoes" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Bell className="h-3.5 w-3.5" /> Notificações
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="sistema" className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Clock className="h-3.5 w-3.5" /> Sistema
              </TabsTrigger>
            )}
            <TabsTrigger value="conta" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Shield className="h-3.5 w-3.5" /> Conta
            </TabsTrigger>
          </TabsList>

          {/* ── Tab: Agente Local ── */}
          <TabsContent value="agente" className="space-y-4 mt-4">
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-emerald-600" />
                  Agente Local (Base44 Agent)
                </CardTitle>
                <CardDescription>
                  Instale o agente no Windows para monitorar terminais na sua rede local. Ele verifica cada terminal e envia o status automaticamente.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">

                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2">
                  <p className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
                    <Info className="h-4 w-4" /> Como funciona
                  </p>
                  <ul className="text-sm text-emerald-700 space-y-1 list-disc list-inside">
                    <li>O agente corre como serviço Windows (via NSSM)</li>
                    <li>A cada 30 segundos, obtém os terminais cadastrados via API</li>
                    <li>Testa HTTP ou TCP para cada terminal na rede local</li>
                    <li>Atualiza status, latência e último ping automaticamente</li>
                  </ul>
                </div>

                {/* Credenciais */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Key className="h-4 w-4" /> API Key do Agente
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 space-y-1">
                      <p className="font-semibold">🔐 Autenticação</p>
                      <ul className="space-y-0.5 list-disc list-inside leading-relaxed">
                        <li>Cada utilizador tem uma API Key pessoal única.</li>
                        <li>Enviada no header <code className="bg-blue-100 px-1 rounded">X-Api-Key</code>.</li>
                        <li>O agente só acede aos seus próprios terminais.</li>
                      </ul>
                    </div>
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 space-y-1">
                      <p className="font-semibold">⚠️ Boas práticas</p>
                      <ul className="space-y-0.5 list-disc list-inside leading-relaxed">
                        <li>Guarde a chave apenas no <code className="bg-amber-100 px-1 rounded">config.json</code> local.</li>
                        <li>Se comprometida, regenere imediatamente.</li>
                        <li>Transmitida sempre via HTTPS encriptado.</li>
                      </ul>
                    </div>
                  </div>

                  {/* API Key field */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500 flex items-center justify-between">
                      <span>SUA API KEY PESSOAL</span>
                      {currentUser?.api_key && (
                        <button onClick={() => setShowApiKey(v => !v)} className="text-slate-400 hover:text-slate-600 flex items-center gap-1">
                          {showApiKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          {showApiKey ? 'Ocultar' : 'Mostrar'}
                        </button>
                      )}
                    </Label>
                    {currentUser?.api_key ? (
                      <div className="flex gap-2">
                        <Input readOnly value={showApiKey ? currentUser.api_key : '•'.repeat(20)} className="bg-slate-50 text-xs font-mono" />
                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(currentUser.api_key, 'API Key')} className="shrink-0">
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic">Nenhuma API Key gerada ainda.</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button variant="outline" size="sm" onClick={handleGenerateApiKey} disabled={generatingKey} className="gap-1.5 text-xs">
                        <RefreshCw className={cn('h-3 w-3', generatingKey && 'animate-spin')} />
                        {currentUser?.api_key ? 'Regenerar API Key' : 'Gerar API Key'}
                      </Button>
                      {currentUser?.api_key && (
                        <Button variant="outline" size="sm" onClick={handleTestConnection} disabled={testingConn} className="gap-1.5 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                          <Plug className={cn('h-3 w-3', testingConn && 'animate-pulse')} />
                          {testingConn ? 'A testar...' : 'Testar Ligação'}
                        </Button>
                      )}
                    </div>
                    {testResult && (
                      <div className={cn('flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg border', testResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700')}>
                        {testResult.ok ? <CheckCircle className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                        {testResult.msg}
                      </div>
                    )}
                    {currentUser?.api_key && (
                      <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                        ⚠️ Ao regenerar, o agente atual deixa de funcionar até ser reconfigurado.
                      </p>
                    )}
                  </div>

                  {/* Endpoints */}
                  <div className="space-y-2 pt-1 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Endpoints da API</p>
                    {[
                      { label: 'APP ID', value: APP_ID },
                      { label: 'Obter Terminais', value: '/api/functions/agentGetTerminals' },
                      { label: 'Reportar Status', value: '/api/functions/agentReport' },
                    ].map(({ label, value }) => (
                      <div key={label} className="space-y-0.5">
                        <Label className="text-xs text-slate-500">{label}</Label>
                        <div className="flex gap-2">
                          <Input readOnly value={value} className="bg-slate-50 text-xs font-mono" />
                          <Button variant="outline" size="sm" onClick={() => copyToClipboard(value, label)} className="shrink-0">
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Guia de instalação — para todos */}
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot className="h-4 w-4 text-emerald-600" />
                  Instalação do Agente Windows
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  { n: 1, title: 'Baixe o NSSM', body: <><a href="https://nssm.cc/download" target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs">nssm.cc/download</a><p className="text-xs text-slate-500 mt-0.5">Copie <code className="bg-slate-100 px-1 rounded">nssm.exe</code> para <code className="bg-slate-100 px-1 rounded">C:\Program Files\Base44Agent\</code></p></> },
                  { n: 2, title: 'Copie o código fonte', body: <p className="text-xs text-slate-500">Para <code className="bg-slate-100 px-1 rounded">C:\Program Files\Base44Agent\core_agent.py</code></p> },
                  { n: 3, title: 'Crie o ficheiro de configuração', body: <><pre className="bg-slate-900 text-emerald-400 p-2 rounded text-xs mt-1 overflow-x-auto">{`{\n  "API_KEY": "SUA_API_KEY",\n  "APP_ID": "${APP_ID}"\n}`}</pre><p className="text-xs text-slate-500 mt-1">Guarde em <code className="bg-slate-100 px-1 rounded">C:\ProgramData\Base44Agent\config.json</code></p></> },
                  { n: 4, title: 'Instale como serviço Windows', body: <pre className="bg-slate-900 text-emerald-400 p-2 rounded text-xs mt-1 overflow-x-auto">{`nssm install Base44Agent python "C:\\Program Files\\Base44Agent\\core_agent.py"\nnssm start Base44Agent`}</pre> },
                ].map(({ n, title, body }) => (
                  <div key={n} className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">{n}</span>
                    <div><p className="font-medium text-slate-700">{title}</p>{body}</div>
                  </div>
                ))}
                <div className="pt-2">
                  <AgentSourceCode />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab: Servidores (admin only) ── */}
          {isAdmin && (
            <TabsContent value="servidores" className="space-y-4 mt-4">
              <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Radio className="h-5 w-5 text-violet-600" />
                    NOC Server — Windows Server (51.91.219.145)
                  </CardTitle>
                  <CardDescription>Servidor unificado: Heartbeat TCP, ADMS/Push (ZKTeco, Anviz) e SDK-TCP.</CardDescription>
                </CardHeader>
                <CardContent><NocServerCode /></CardContent>
              </Card>

              <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Radio className="h-5 w-5 text-blue-600" />
                    Servidor ADMS (ZKTeco / Anviz)
                  </CardTitle>
                  <CardDescription>Recebe push HTTP dos terminais ZKTeco e Anviz (protocolo iClock/ADMS).</CardDescription>
                </CardHeader>
                <CardContent><AdmsServerCode /></CardContent>
              </Card>

              <Card className="bg-white/80 backdrop-blur-sm border-violet-200/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Radio className="h-5 w-5 text-violet-600" />
                    P2S Server — Push to Server
                  </CardTitle>
                  <CardDescription>Para terminais P2S: ZKTeco, Anviz, Suprema, Hikvision, Dahua, Nitgen.</CardDescription>
                </CardHeader>
                <CardContent><P2sServerCode /></CardContent>
              </Card>

              <Card className="bg-white/80 backdrop-blur-sm border-violet-200/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Radio className="h-5 w-5 text-violet-600" />
                    Timmy WebSocket Cloud Server
                  </CardTitle>
                  <CardDescription>Para terminais Timmy/THbio: TM-AI07F, TM-AIFace11F, TFS30, TFS50 e outros.</CardDescription>
                </CardHeader>
                <CardContent><TimmyWsServerCode /></CardContent>
              </Card>

              <Card className="bg-white/80 backdrop-blur-sm border-rose-200/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Radio className="h-5 w-5 text-rose-600" />
                    M-BioFace WebSocket Server
                  </CardTitle>
                  <CardDescription>Para terminais M-BioFace v4/v3: WebSocket com AutoSync, foto facial, impressão digital e LiveTimeSync.</CardDescription>
                </CardHeader>
                <CardContent><MbioWsServerCode /></CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Tab: Notificações ── */}
          <TabsContent value="notificacoes" className="mt-4">
            <TelegramConfig />
          </TabsContent>

          {/* ── Tab: Sistema (admin only) ── */}
          {isAdmin && (
            <TabsContent value="sistema" className="mt-4">
              <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-blue-600" />
                    Intervalo de Sincronização
                  </CardTitle>
                  <CardDescription>
                    Frequência de atualização dos dados em Dashboard, Terminais e Modo TV.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="number" min="1" max="60"
                      value={refreshInterval}
                      onChange={(e) => setRefreshInterval(e.target.value)}
                      className="flex h-9 w-[120px] rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm"
                    />
                    <span className="text-sm text-slate-500">minuto(s)</span>
                    <Button onClick={handleSaveInterval} disabled={savingInterval} size="sm" className="gap-2 bg-blue-600 hover:bg-blue-700">
                      <Save className="h-4 w-4" />
                      {savingInterval ? 'Salvando...' : 'Salvar'}
                    </Button>
                  </div>
                  <p className="text-xs text-slate-400">Mínimo: 1 minuto. Recomendado: 5 minutos.</p>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Tab: Conta ── */}
          <TabsContent value="conta" className="mt-4">
            {currentUser && (
              <Card className="bg-white/80 backdrop-blur-sm border-red-200">
                <CardHeader>
                  <CardTitle className="text-red-600 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" />
                    Zona de Perigo
                  </CardTitle>
                  <CardDescription>Estas ações são irreversíveis. Proceda com cautela.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 border border-red-200 rounded-lg bg-red-50">
                    <div>
                      <p className="font-medium text-slate-900">Excluir Conta</p>
                      <p className="text-xs sm:text-sm text-slate-500">Remove permanentemente todos os dados e configurações.</p>
                    </div>
                    <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm" className="shrink-0 w-full sm:w-auto">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir Conta
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                            <AlertTriangle className="h-5 w-5" /> Confirmar Exclusão
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta ação é <strong>permanente e irreversível</strong>. Todos os terminais, histórico e configurações serão excluídos. Tem certeza?
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700"
                            onClick={() => { toast.error('Disponível apenas via suporte. Contacte o administrador.'); setDeleteConfirmOpen(false); }}
                          >
                            Sim, Excluir Tudo
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}