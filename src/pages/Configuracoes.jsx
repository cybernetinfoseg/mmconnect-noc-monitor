import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resolvePermissions } from '../components/auth/usePermissions';
import { motion } from 'framer-motion';
import { 
  Settings, 
  Database, 
  Globe,
  Save,
  RefreshCw,
  CheckCircle,
  XCircle,
  Trash2,
  AlertTriangle,
  Bot,
  Key,
  Download,
  Terminal,
  Copy,
  Info
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function Configuracoes() {
  const [formData, setFormData] = useState({});
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms = resolvePermissions(currentUser);

  const { data: allConfigs = [] } = useQuery({
    queryKey: ['monitor-configs'],
    queryFn: () => base44.entities.MonitorConfig.list(),
    enabled: !!currentUser,
  });

  // Each user sees only their own config; admin sees all
  const configs = useMemo(() => {
    if (!currentUser) return [];
    if (perms.isAdmin) return allConfigs;
    return allConfigs.filter(c => c.created_by === currentUser.email);
  }, [allConfigs, currentUser, perms.isAdmin]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (configs.length > 0) {
        return base44.entities.MonitorConfig.update(configs[0].id, data);
      }
      return base44.entities.MonitorConfig.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['monitor-configs']);
      toast.success('Configuração salva');
    }
  });

  const syncMutation = useMutation({
    mutationFn: () => base44.functions.invoke('syncExternalData', {}),
    onSuccess: () => {
      queryClient.invalidateQueries(['terminals']);
      toast.success('Sincronização iniciada');
    }
  });

  React.useEffect(() => {
    if (configs.length > 0) {
      setFormData(configs[0]);
    }
  }, [configs]);

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const config = configs[0];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-slate-900 rounded-xl">
            <Settings className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Configurações</h1>
            <p className="text-sm text-slate-500">Integração com fontes de dados externas</p>
          </div>
        </div>

        {/* Status Card */}
        {config && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {config.ultima_sync_status?.includes('success') ? (
                      <CheckCircle className="h-8 w-8 text-emerald-500" />
                    ) : (
                      <XCircle className="h-8 w-8 text-red-500" />
                    )}
                    <div>
                      <p className="text-sm text-slate-500">Última Sincronização</p>
                      <p className="text-lg font-semibold text-slate-900">
                        {config.ultima_sync 
                          ? new Date(config.ultima_sync).toLocaleString('pt-BR')
                          : 'Nunca'
                        }
                      </p>
                      {config.ultima_sync_status && (
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "mt-1",
                            config.ultima_sync_status.includes('success')
                              ? "border-emerald-300 text-emerald-700"
                              : "border-red-300 text-red-700"
                          )}
                        >
                          {config.ultima_sync_status}
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <Button
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <RefreshCw className={cn(
                      "h-4 w-4 mr-2",
                      syncMutation.isPending && "animate-spin"
                    )} />
                    Sincronizar Agora
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Config Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
            <CardHeader>
              <CardTitle>Fonte de Dados Externa</CardTitle>
              <CardDescription>
                Configure a integração com SQL Server ou API para importar dados de terminais
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Tipo de Integração</Label>
                <Select
                  value={formData.tipo || 'api_externa'}
                  onValueChange={(v) => setFormData({...formData, tipo: v})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="api_externa">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        API Externa
                      </div>
                    </SelectItem>
                    <SelectItem value="sql_server">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        SQL Server (via API intermediária)
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.tipo === 'api_externa' && (
                <>
                  <div className="space-y-2">
                    <Label>URL da API</Label>
                    <Input
                      value={formData.api_url || ''}
                      onChange={(e) => setFormData({...formData, api_url: e.target.value})}
                      placeholder="https://api.exemplo.com/terminais"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Tipo de Autenticação</Label>
                    <Select
                      value={formData.api_auth_type || 'none'}
                      onValueChange={(v) => setFormData({...formData, api_auth_type: v})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        <SelectItem value="bearer">Bearer Token</SelectItem>
                        <SelectItem value="api_key">API Key</SelectItem>
                        <SelectItem value="basic">Basic Auth</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.api_auth_type && formData.api_auth_type !== 'none' && (
                    <div className="space-y-2">
                      <Label>Token/Key de Autenticação</Label>
                      <Input
                        type="password"
                        value={formData.api_auth_token || ''}
                        onChange={(e) => setFormData({...formData, api_auth_token: e.target.value})}
                        placeholder="Insira o token ou key"
                      />
                    </div>
                  )}
                </>
              )}

              {formData.tipo === 'sql_server' && (
                <>
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">
                      <strong>Importante:</strong> Conexão direta com SQL Server requer uma API intermediária.
                      Configure uma API REST que consulte seu SQL Server e retorne os dados no formato esperado.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Connection String (para documentação)</Label>
                    <Textarea
                      value={formData.sql_connection_string || ''}
                      onChange={(e) => setFormData({...formData, sql_connection_string: e.target.value})}
                      placeholder="Server=localhost;Database=NOC;User Id=sa;Password=***"
                      rows={2}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Query SQL (para documentação)</Label>
                    <Textarea
                      value={formData.sql_query || ''}
                      onChange={(e) => setFormData({...formData, sql_query: e.target.value})}
                      placeholder="SELECT nome, local, cliente, ip_local, porta, ultimo_ping, status FROM terminais"
                      rows={4}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>URL da API Intermediária</Label>
                    <Input
                      value={formData.api_url || ''}
                      onChange={(e) => setFormData({...formData, api_url: e.target.value})}
                      placeholder="https://sua-api.com/sql-bridge/terminais"
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label>Intervalo de Sincronização (minutos)</Label>
                <Input
                  type="number"
                  min="1"
                  value={formData.intervalo_sync_minutos || 5}
                  onChange={(e) => setFormData({...formData, intervalo_sync_minutos: parseInt(e.target.value)})}
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.ativo !== false}
                  onCheckedChange={(checked) => setFormData({...formData, ativo: checked})}
                />
                <Label>Sincronização automática ativa</Label>
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="flex-1 bg-slate-900 hover:bg-slate-800"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saveMutation.isPending ? 'Salvando...' : 'Salvar Configuração'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Documentation */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
            <CardHeader>
              <CardTitle>Formato Esperado da API</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg text-xs overflow-x-auto">
{`[
  {
    "nome": "BIO-001",
    "local": "Matriz - Recepção",
    "cliente": "TechCorp",
    "tipo_conexao": "ip_local",
    "ip_local": "192.168.1.101",
    "ip_publico": "203.0.113.1",
    "porta": 5005,
    "status": "online",
    "ultimo_ping": "2026-02-12T10:30:00Z"
  }
]`}
              </pre>
            </CardContent>
          </Card>
        </motion.div>

        {/* Local Agent Setup */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
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
            <CardContent className="space-y-6">

              {/* Como funciona */}
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2">
                <p className="text-sm font-semibold text-emerald-800 flex items-center gap-2"><Info className="h-4 w-4" /> Como funciona</p>
                <ul className="text-sm text-emerald-700 space-y-1 list-disc list-inside">
                  <li>O agente roda como serviço Windows (via NSSM)</li>
                  <li>A cada 30 segundos, busca os terminais cadastrados aqui via API</li>
                  <li>Testa HTTP ou TCP para cada terminal na rede local</li>
                  <li>Atualiza status, latência e último ping automaticamente</li>
                  <li>Verifica atualizações a cada 6 horas automaticamente</li>
                </ul>
              </div>

              {/* Credenciais */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Key className="h-4 w-4" /> Suas Credenciais para o Agente
                </p>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">API KEY (configure em Configurações → Secrets como <code className="bg-slate-100 px-1 rounded">BASE44_API_KEY</code>)</Label>
                    <div className="flex gap-2">
                      <Input 
                        readOnly 
                        value="Seu API_KEY configurado nos Secrets do app" 
                        className="bg-slate-50 text-sm font-mono text-slate-500 cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">APP ID</Label>
                    <div className="flex gap-2">
                      <Input 
                        readOnly 
                        value="697aa46c9998c30665e2e19a" 
                        className="bg-slate-50 text-sm font-mono"
                      />
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => { navigator.clipboard.writeText('697aa46c9998c30665e2e19a'); }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Instalação */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Terminal className="h-4 w-4" /> Instalação Passo a Passo
                </p>
                <div className="space-y-3 text-sm">

                  <div className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">1</span>
                    <div className="flex-1">
                      <p className="font-medium text-slate-700">Baixe o NSSM (gerenciador de serviços Windows)</p>
                      <a href="https://nssm.cc/download" target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs">nssm.cc/download</a>
                      <p className="text-xs text-slate-500 mt-1">Extraia e copie <code className="bg-slate-100 px-1 rounded">nssm.exe</code> para <code className="bg-slate-100 px-1 rounded">C:\Base44Agent\</code></p>
                    </div>
                  </div>

                  <div className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">2</span>
                    <div className="flex-1">
                      <p className="font-medium text-slate-700">Coloque os arquivos do agente em <code className="bg-slate-100 px-1 rounded">C:\Base44Agent\</code></p>
                      <p className="text-xs text-slate-500 mt-1">Arquivos necessários: <code className="bg-slate-100 px-1 rounded">core_agent.py</code>, <code className="bg-slate-100 px-1 rounded">agent_cli.py</code>, <code className="bg-slate-100 px-1 rounded">agent_config.py</code>, <code className="bg-slate-100 px-1 rounded">updater.py</code></p>
                    </div>
                  </div>

                  <div className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">3</span>
                    <div className="flex-1">
                      <p className="font-medium text-slate-700">Configure as credenciais (CMD como Administrador):</p>
                      <pre className="bg-slate-900 text-emerald-400 p-2 rounded text-xs mt-1 overflow-x-auto">{`cd C:\\Base44Agent
python agent_config.py --api-key SEU_API_KEY --app-id 697aa46c9998c30665e2e19a --yes`}</pre>
                    </div>
                  </div>

                  <div className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">4</span>
                    <div className="flex-1">
                      <p className="font-medium text-slate-700">Instale como serviço Windows com NSSM:</p>
                      <pre className="bg-slate-900 text-emerald-400 p-2 rounded text-xs mt-1 overflow-x-auto">{`nssm install Base44Agent python "C:\\Base44Agent\\agent_cli.py"
nssm set Base44Agent AppParameters "--interval 30"
nssm set Base44Agent AppDirectory "C:\\Base44Agent"
nssm start Base44Agent`}</pre>
                    </div>
                  </div>

                  <div className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">5</span>
                    <div className="flex-1">
                      <p className="font-medium text-slate-700">Verificar logs do agente:</p>
                      <pre className="bg-slate-900 text-emerald-400 p-2 rounded text-xs mt-1 overflow-x-auto">{`type "C:\\ProgramData\\Base44Agent\\agent.log"`}</pre>
                    </div>
                  </div>

                </div>
              </div>

              {/* Parâmetros CLI */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-700">Parâmetros do agent_cli.py</p>
                <div className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden text-xs">
                  <table className="w-full">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="text-left px-3 py-2 text-slate-600">Parâmetro</th>
                        <th className="text-left px-3 py-2 text-slate-600">Padrão</th>
                        <th className="text-left px-3 py-2 text-slate-600">Descrição</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      <tr><td className="px-3 py-2 font-mono text-slate-700">--interval</td><td className="px-3 py-2 text-slate-500">30</td><td className="px-3 py-2 text-slate-500">Segundos entre verificações</td></tr>
                      <tr><td className="px-3 py-2 font-mono text-slate-700">--no-update</td><td className="px-3 py-2 text-slate-500">false</td><td className="px-3 py-2 text-slate-500">Desativa auto-atualização</td></tr>
                      <tr><td className="px-3 py-2 font-mono text-slate-700">--once</td><td className="px-3 py-2 text-slate-500">false</td><td className="px-3 py-2 text-slate-500">Executa 1 ciclo e encerra (debug)</td></tr>
                      <tr><td className="px-3 py-2 font-mono text-slate-700">--log-level</td><td className="px-3 py-2 text-slate-500">INFO</td><td className="px-3 py-2 text-slate-500">DEBUG / INFO / WARNING / ERROR</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Teste rápido */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs font-semibold text-blue-700 mb-1">Teste rápido (sem instalar serviço):</p>
                <pre className="text-xs text-blue-800 font-mono">{`python agent_cli.py --once --log-level DEBUG`}</pre>
              </div>

            </CardContent>
          </Card>
        </motion.div>

        {/* Delete Account */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="bg-white/80 backdrop-blur-sm border-red-200">
            <CardHeader>
              <CardTitle className="text-red-600 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Zona de Perigo
              </CardTitle>
              <CardDescription>
                Estas ações são irreversíveis. Proceda com cautela.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 border border-red-200 rounded-lg bg-red-50">
                <div>
                  <p className="font-medium text-slate-900">Excluir Conta</p>
                  <p className="text-sm text-slate-500">Remove permanentemente todos os dados e configurações.</p>
                </div>
                <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="select-none shrink-0 ml-4">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Excluir Conta
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                        <AlertTriangle className="h-5 w-5" />
                        Confirmar Exclusão de Conta
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta ação é <strong>permanente e irreversível</strong>. Todos os seus terminais, clientes, histórico e configurações serão excluídos. Tem certeza que deseja continuar?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="select-none">Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-600 hover:bg-red-700 select-none"
                        onClick={() => {
                          toast.error('Funcionalidade disponível apenas via suporte. Contacte o administrador.');
                          setDeleteConfirmOpen(false);
                        }}
                      >
                        Sim, Excluir Tudo
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}