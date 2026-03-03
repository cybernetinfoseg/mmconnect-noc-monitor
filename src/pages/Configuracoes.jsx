import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();

  const { data: configs = [] } = useQuery({
    queryKey: ['monitor-configs'],
    queryFn: () => base44.entities.MonitorConfig.list(),
  });

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