import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useEffect } from 'react';
import { resolvePermissions } from '../components/auth/usePermissions';
import { motion } from 'framer-motion';
import { 
  Settings, 
  Save,
  Trash2,
  AlertTriangle,
  Bot,
  Key,
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
import { toast } from 'sonner';
import AgentSourceCode from '../components/configuracoes/AgentSourceCode';

const APP_ID = '697aa46c9998c30665e2e19a';

export default function Configuracoes() {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms = resolvePermissions(currentUser);

  const copyToClipboard = (value, label) => {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copiado!`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-3 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-6 overflow-hidden">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-slate-900 rounded-xl">
            <Settings className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Configurações</h1>
            <p className="text-sm text-slate-500">Agente Local e configurações do sistema</p>
          </div>
        </div>

        {/* Local Agent Setup */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
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
                <p className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
                  <Info className="h-4 w-4" /> Como funciona
                </p>
                <ul className="text-sm text-emerald-700 space-y-1 list-disc list-inside">
                  <li>O agente roda como serviço Windows (via NSSM)</li>
                  <li>A cada 30 segundos, busca os terminais cadastrados aqui via API</li>
                  <li>Testa HTTP ou TCP para cada terminal na rede local</li>
                  <li>Atualiza status, latência e último ping automaticamente</li>
                </ul>
              </div>

              {/* Credenciais */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Key className="h-4 w-4" /> Credenciais do Agente
                </p>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <strong>Segurança:</strong> O agente autentica-se enviando a <strong>API Key</strong> (configurada em <em>Painel → Segredos → API_KEY</em>) e o <strong>APP ID</strong> em cada pedido. Sem ambos, o pedido é rejeitado.
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">API KEY — definida em <strong>Painel → Segredos → API_KEY</strong></Label>
                    <Input
                      readOnly
                      value="Configurada no painel de segredos do projeto"
                      className="bg-slate-50 text-sm text-slate-400 italic cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">APP ID</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={APP_ID} className="bg-slate-50 text-sm font-mono" />
                      <Button variant="outline" size="sm" onClick={() => copyToClipboard(APP_ID, 'APP ID')}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">Endpoint — Obter Terminais</Label>
                    <div className="flex gap-2">
                      <Input readOnly value="/api/functions/agentGetTerminals" className="bg-slate-50 text-xs font-mono" />
                      <Button variant="outline" size="sm" onClick={() => copyToClipboard('/api/functions/agentGetTerminals', 'Endpoint')}><Copy className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">Endpoint — Reportar Status</Label>
                    <div className="flex gap-2">
                      <Input readOnly value="/api/functions/agentReport" className="bg-slate-50 text-xs font-mono" />
                      <Button variant="outline" size="sm" onClick={() => copyToClipboard('/api/functions/agentReport', 'Endpoint')}><Copy className="h-4 w-4" /></Button>
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
                      <p className="text-xs text-slate-500 mt-1">Extraia e copie <code className="bg-slate-100 px-1 rounded">nssm.exe</code> para <code className="bg-slate-100 px-1 rounded">C:\Program Files\Base44Agent\</code></p>
                    </div>
                  </div>

                  <div className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">2</span>
                    <div className="flex-1">
                      <p className="font-medium text-slate-700">Coloque os arquivos do agente em <code className="bg-slate-100 px-1 rounded">C:\Program Files\Base44Agent\</code></p>
                      <p className="text-xs text-slate-500 mt-1">Copie o código fonte abaixo para <code className="bg-slate-100 px-1 rounded">C:\Program Files\Base44Agent\core_agent.py</code></p>
                    </div>
                  </div>

                  <div className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">3</span>
                    <div className="flex-1">
                      <p className="font-medium text-slate-700">Configure as credenciais (CMD como Administrador):</p>
                      <p className="text-xs text-slate-500 mt-1">O agente lê as credenciais do ficheiro <code className="bg-slate-100 px-1 rounded">C:\ProgramData\Base44Agent\config.json</code>. Crie-o com o conteúdo:</p>
                      <pre className="bg-slate-900 text-emerald-400 p-2 rounded text-xs mt-1 overflow-x-auto">{`{
  "API_KEY": "SUA_API_KEY",
  "APP_ID": "${APP_ID}"
}`}</pre>
                      <p className="text-xs text-amber-700 mt-1 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        Substitua <strong>SUA_API_KEY</strong> pelo valor configurado em <em>Painel → Segredos → API_KEY</em>.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">4</span>
                    <div className="flex-1">
                      <p className="font-medium text-slate-700">Instale como serviço Windows com NSSM:</p>
                      <pre className="bg-slate-900 text-emerald-400 p-2 rounded text-xs mt-1 overflow-x-auto">{`nssm install Base44Agent python "C:\\Program Files\\Base44Agent\\core_agent.py"
nssm set Base44Agent AppParameters "--interval 30"
nssm set Base44Agent AppDirectory "C:\\Program Files\\Base44Agent"
nssm start Base44Agent`}</pre>
                    </div>
                  </div>

                  <div className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">5</span>
                    <div className="flex-1">
                      <p className="font-medium text-slate-700">Teste rápido (sem instalar serviço):</p>
                      <pre className="bg-slate-900 text-emerald-400 p-2 rounded text-xs mt-1 overflow-x-auto">{`cd "C:\\Program Files\\Base44Agent"
python core_agent.py --once`}</pre>
                    </div>
                  </div>

                </div>
              </div>

              {/* Código fonte do agente */}
              <AgentSourceCode />

            </CardContent>
          </Card>
        </motion.div>

        {/* Delete Account — apenas admin */}
        {perms.isAdmin && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
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
                          Esta ação é <strong>permanente e irreversível</strong>. Todos os terminais, clientes, histórico e configurações serão excluídos. Tem certeza?
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
        )}
      </div>
    </div>
  );
}