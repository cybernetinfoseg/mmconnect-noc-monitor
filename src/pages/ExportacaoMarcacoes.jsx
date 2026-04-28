import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Share2, Plus, Pencil, Trash2, Play, CheckCircle2, XCircle,
  Database, Globe, Loader2, RefreshCw, Code, ChevronDown, ChevronUp
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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

const TIPO_ICONS = {
  api_rest: Globe,
  sql_server: Database,
  mysql: Database,
  postgresql: Database,
};

const TIPO_COLORS = {
  api_rest: 'bg-blue-100 text-blue-700 border-blue-200',
  sql_server: 'bg-orange-100 text-orange-700 border-orange-200',
  mysql: 'bg-teal-100 text-teal-700 border-teal-200',
  postgresql: 'bg-indigo-100 text-indigo-700 border-indigo-200',
};

const DEFAULT_MAPPING = JSON.stringify({
  "enrollid": "user_id",
  "timestamp": "punch_time",
  "terminal_nome": "device_name",
  "modo": "verify_type",
  "tipo": "direction"
}, null, 2);

export default function ExportacaoMarcacoes() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [formData, setFormData] = useState({});
  const [running, setRunning] = useState(null);
  const [runResults, setRunResults] = useState({});
  const [showSql, setShowSql] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['export-configs'],
    queryFn: () => base44.entities.ExportConfig.list('-created_date'),
  });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const payload = { ...data, owner_email: data.owner_email || currentUser?.email };
      if (editingConfig) return base44.entities.ExportConfig.update(editingConfig.id, payload);
      return base44.entities.ExportConfig.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['export-configs']);
      setDialogOpen(false);
      setEditingConfig(null);
      setFormData({});
      toast.success(editingConfig ? 'Configuração atualizada' : 'Configuração criada');
    },
    onError: (e) => toast.error(`Erro: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ExportConfig.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(['export-configs']); toast.success('Eliminado'); },
  });

  const handleRunExport = async (config) => {
    setRunning(config.id);
    setRunResults(prev => ({ ...prev, [config.id]: null }));
    try {
      const resp = await base44.functions.invoke('exportMarcacoes', { config_id: config.id });
      const data = resp.data;
      setRunResults(prev => ({ ...prev, [config.id]: data }));
      if (data?.success) {
        toast.success(`${data.exported || 0} marcação(ões) exportada(s)`);
        queryClient.invalidateQueries(['export-configs']);
      } else {
        toast.error(data?.error || 'Erro na exportação');
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e.message;
      setRunResults(prev => ({ ...prev, [config.id]: { success: false, error: msg } }));
      toast.error(`Erro: ${msg}`);
    } finally {
      setRunning(null);
    }
  };

  const handleNew = () => {
    setEditingConfig(null);
    setFormData({ tipo: 'api_rest', api_method: 'POST', apenas_novos: true, ativo: true, sql_mapping: DEFAULT_MAPPING });
    setDialogOpen(true);
  };

  const handleEdit = (c) => {
    setEditingConfig(c);
    setFormData(c);
    setDialogOpen(true);
  };

  const Icon = (tipo) => TIPO_ICONS[tipo] || Globe;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 w-full overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-4xl">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-100 rounded-xl shrink-0">
              <Share2 className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Exportação de Marcações</h1>
              <p className="text-xs sm:text-sm text-slate-500">Envie marcações para APIs REST ou bases de dados SQL externas</p>
            </div>
          </div>
          <Button onClick={handleNew} size="sm" className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="h-4 w-4 mr-2" /> Nova Exportação
          </Button>
        </div>

        {/* Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-blue-600" />
                <p className="font-semibold text-blue-800">Exportação via API REST</p>
              </div>
              <p className="text-xs text-blue-700">Envia as marcações como JSON via HTTP POST/PUT para qualquer endpoint REST externo. Suporta headers personalizados (ex: autenticação Bearer).</p>
            </CardContent>
          </Card>
          <Card className="bg-orange-50 border-orange-200">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-orange-600" />
                <p className="font-semibold text-orange-800">Exportação via SQL</p>
              </div>
              <p className="text-xs text-orange-700">Insere as marcações diretamente numa tabela SQL Server, MySQL ou PostgreSQL. Configure a string de conexão e o mapeamento de campos.</p>
            </CardContent>
          </Card>
        </div>

        {/* Configs list */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : configs.length === 0 ? (
          <Card className="bg-white/80 border-slate-200/50">
            <CardContent className="py-12 text-center text-slate-400">
              <Share2 className="h-12 w-12 mx-auto mb-3" />
              <p>Nenhuma exportação configurada ainda</p>
              <Button onClick={handleNew} className="mt-4 bg-indigo-600 hover:bg-indigo-700">
                <Plus className="h-4 w-4 mr-2" /> Criar primeira exportação
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {configs.map(c => {
              const Icon2 = TIPO_ICONS[c.tipo] || Globe;
              const result = runResults[c.id];
              return (
                <Card key={c.id} className={cn('bg-white/80 border-slate-200/50', !c.ativo && 'opacity-60')}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-slate-100 rounded-lg shrink-0">
                          <Icon2 className="h-5 w-5 text-slate-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-slate-800">{c.nome}</p>
                            <Badge className={cn('text-xs', TIPO_COLORS[c.tipo])}>
                              {c.tipo?.replace('_', ' ').toUpperCase()}
                            </Badge>
                            {!c.ativo && <Badge variant="outline" className="text-xs text-slate-400">Inativo</Badge>}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 font-mono truncate max-w-xs">
                            {c.api_url || c.sql_connection_string?.replace(/password=.+?;/i, 'password=***;') || '—'}
                          </p>
                          {c.ultima_exportacao && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              Última exportação: {format(new Date(c.ultima_exportacao), 'dd/MM/yyyy HH:mm')}
                              {c.total_exportado != null && ` • Total: ${c.total_exportado} registos`}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-wrap shrink-0">
                        <Button
                          size="sm"
                          className="bg-indigo-600 hover:bg-indigo-700 gap-1.5 text-xs"
                          disabled={running === c.id || !c.ativo}
                          onClick={() => handleRunExport(c)}
                        >
                          {running === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                          Exportar Agora
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleEdit(c)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="outline" className="text-red-500 hover:bg-red-50" onClick={() => setDeleteId(c.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {result && (
                      <div className={cn('rounded-lg border p-3 text-sm', result.success ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')}>
                        <div className="flex items-start gap-2">
                          {result.success
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                            : <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                          }
                          <p className={cn('text-xs font-medium', result.success ? 'text-emerald-800' : 'text-red-700')}>
                            {result.success ? `${result.exported || 0} marcação(ões) exportada(s) com sucesso` : result.error}
                          </p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* SQL Schema helper */}
        <Card className="bg-white/80 border-slate-200/50">
          <CardHeader className="pb-2">
            <button
              className="flex items-center justify-between w-full text-left"
              onClick={() => setShowSql(v => !v)}
            >
              <CardTitle className="text-sm flex items-center gap-2">
                <Code className="h-4 w-4 text-slate-500" />
                Script SQL — Criar tabela de destino
              </CardTitle>
              {showSql ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </CardHeader>
          {showSql && (
            <CardContent>
              <pre className="bg-slate-900 text-emerald-400 p-4 rounded-lg text-xs overflow-x-auto font-mono leading-relaxed">
{`-- SQL Server
CREATE TABLE marcacoes_biometrico (
    id            INT IDENTITY PRIMARY KEY,
    enrollid      INT NOT NULL,
    user_name     NVARCHAR(100),
    punch_time    DATETIME NOT NULL,
    device_name   NVARCHAR(100),
    verify_type   VARCHAR(20),   -- fp, face, card, pw
    direction     VARCHAR(20),   -- entrada, saida, desconhecido
    local         NVARCHAR(100),
    terminal_id   VARCHAR(50),
    exported_at   DATETIME DEFAULT GETDATE()
);

-- MySQL / MariaDB
CREATE TABLE marcacoes_biometrico (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    enrollid      INT NOT NULL,
    user_name     VARCHAR(100),
    punch_time    DATETIME NOT NULL,
    device_name   VARCHAR(100),
    verify_type   VARCHAR(20),
    direction     VARCHAR(20),
    local_name    VARCHAR(100),
    terminal_id   VARCHAR(50),
    exported_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- PostgreSQL
CREATE TABLE marcacoes_biometrico (
    id            SERIAL PRIMARY KEY,
    enrollid      INT NOT NULL,
    user_name     VARCHAR(100),
    punch_time    TIMESTAMP NOT NULL,
    device_name   VARCHAR(100),
    verify_type   VARCHAR(20),
    direction     VARCHAR(20),
    local_name    VARCHAR(100),
    terminal_id   VARCHAR(50),
    exported_at   TIMESTAMP DEFAULT NOW()
);`}
              </pre>
            </CardContent>
          )}
        </Card>
      </div>

      {/* Dialog: Create/Edit */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[95vw] max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingConfig ? 'Editar Exportação' : 'Nova Exportação'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Nome *</Label>
                <Input
                  placeholder="Ex: ERP Principal"
                  value={formData.nome || ''}
                  onChange={e => setFormData(f => ({ ...f, nome: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Tipo *</Label>
                <Select
                  value={formData.tipo || 'api_rest'}
                  onValueChange={v => setFormData(f => ({ ...f, tipo: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="api_rest">API REST</SelectItem>
                    <SelectItem value="sql_server">SQL Server (MSSQL)</SelectItem>
                    <SelectItem value="mysql">MySQL / MariaDB</SelectItem>
                    <SelectItem value="postgresql">PostgreSQL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(formData.tipo === 'api_rest') && (
              <>
                <div className="space-y-1">
                  <Label>URL da API *</Label>
                  <Input
                    placeholder="https://erp.empresa.com/api/marcacoes"
                    value={formData.api_url || ''}
                    onChange={e => setFormData(f => ({ ...f, api_url: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Método HTTP</Label>
                    <Select
                      value={formData.api_method || 'POST'}
                      onValueChange={v => setFormData(f => ({ ...f, api_method: v }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Headers HTTP</Label>
                  <Textarea
                    rows={3}
                    placeholder={'{\n  "Authorization": "Bearer SEU_TOKEN",\n  "X-Api-Key": "CHAVE"\n}'}
                    value={formData.api_headers || ''}
                    onChange={e => setFormData(f => ({ ...f, api_headers: e.target.value }))}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-slate-400">JSON com headers adicionais. Opcional.</p>
                </div>
              </>
            )}

            {(['sql_server', 'mysql', 'postgresql'].includes(formData.tipo)) && (
              <>
                <div className="space-y-1">
                  <Label>String de Conexão *</Label>
                  <Input
                    placeholder={
                      formData.tipo === 'sql_server'
                        ? 'Server=host;Database=db;User Id=user;Password=pass;'
                        : formData.tipo === 'mysql'
                        ? 'mysql://user:pass@host:3306/database'
                        : 'postgresql://user:pass@host:5432/database'
                    }
                    value={formData.sql_connection_string || ''}
                    onChange={e => setFormData(f => ({ ...f, sql_connection_string: e.target.value }))}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Tabela de Destino *</Label>
                  <Input
                    placeholder="marcacoes_biometrico"
                    value={formData.sql_table || ''}
                    onChange={e => setFormData(f => ({ ...f, sql_table: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Mapeamento de Campos (JSON)</Label>
                  <Textarea
                    rows={6}
                    value={formData.sql_mapping || DEFAULT_MAPPING}
                    onChange={e => setFormData(f => ({ ...f, sql_mapping: e.target.value }))}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-slate-400">{"{ \"campo_origem\": \"coluna_destino\" } — campos: enrollid, timestamp, terminal_nome, terminal_id, modo, tipo, local, utilizador_nome"}</p>
                </div>
              </>
            )}

            <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
              <Switch
                checked={formData.apenas_novos !== false}
                onCheckedChange={v => setFormData(f => ({ ...f, apenas_novos: v }))}
              />
              <div>
                <Label className="text-sm">Apenas marcações novas</Label>
                <p className="text-xs text-slate-400">Se ativo, exporta apenas marcações ainda não exportadas (evita duplicados)</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={formData.ativo !== false}
                onCheckedChange={v => setFormData(f => ({ ...f, ativo: v }))}
              />
              <Label>Exportação ativa</Label>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                disabled={saveMutation.isPending || !formData.nome || !formData.tipo}
                onClick={() => saveMutation.mutate(formData)}
              >
                {saveMutation.isPending ? 'A guardar...' : 'Guardar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar configuração?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação é permanente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700"
              onClick={() => { deleteMutation.mutate(deleteId); setDeleteId(null); }}
            >Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}