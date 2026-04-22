import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Plus, Trash2, ToggleLeft, ToggleRight, Mail, Zap, Clock, AlertTriangle, CheckCircle, Edit2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import moment from 'moment';
import AlertRuleModal from '../components/alerts/AlertRuleModal';
import BrowserNotificationToggle from '../components/alerts/BrowserNotificationToggle';

const GATILHO_LABELS = {
  terminal_offline: 'Terminal fica offline',
  terminal_online: 'Terminal volta online',
  sem_ping_minutos: 'Sem ping por X minutos',
  multiplos_offline: 'Múltiplos terminais offline',
};

const GATILHO_ICONS = {
  terminal_offline: AlertTriangle,
  terminal_online: CheckCircle,
  sem_ping_minutos: Clock,
  multiplos_offline: Bell,
};

export default function Alertas() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const queryClient = useQueryClient();

  const logAudit = (acao, entidade_id, descricao) =>
    base44.functions.invoke('auditLog', { acao, entidade: 'AlertRule', entidade_id, descricao }).catch(() => {});

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms = resolvePermissions(currentUser);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['alert-rules', currentUser?.email],
    queryFn: () => base44.entities.AlertRule.list('-created_date', 100),
    enabled: !!currentUser,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.AlertRule.delete(id),
    onSuccess: (_, id) => {
      const rule = rules.find(r => r.id === id);
      logAudit('alerta_excluido', id, `Regra de alerta "${rule?.nome || id}" excluída`);
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      toast.success('Regra de alerta eliminada');
    },
    onError: () => toast.error('Erro ao eliminar regra'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, ativo }) => base44.entities.AlertRule.update(id, { ativo }),
    onSuccess: (_, { id, ativo }) => {
      const rule = rules.find(r => r.id === id);
      logAudit(ativo ? 'alerta_ativado' : 'alerta_desativado', id, `Regra "${rule?.nome || id}" ${ativo ? 'ativada' : 'desativada'}`);
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      toast.success(ativo ? 'Regra ativada' : 'Regra desativada');
    },
    onError: () => toast.error('Erro ao atualizar regra'),
  });

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setModalOpen(true);
  };

  const handleNew = () => {
    setEditingRule(null);
    setModalOpen(true);
  };

  const activeRules = rules.filter(r => r.ativo).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 w-full overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-orange-100 rounded-xl shrink-0">
              <Bell className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Alertas</h1>
              <p className="text-sm text-slate-500">{activeRules} regra(s) ativa(s)</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <BrowserNotificationToggle />
            {perms.pode_configurar_alertas && (
              <Button onClick={handleNew} className="bg-slate-900 hover:bg-slate-800 text-white gap-2">
                <Plus className="h-4 w-4" />
                Nova Regra
              </Button>
            )}
          </div>
        </div>

        {/* Empty state */}
        {!isLoading && rules.length === 0 && (
          <Card className="bg-white/80 border-slate-200/50">
            <CardContent className="py-16 text-center">
              <Bell className="h-12 w-12 mx-auto mb-4 text-slate-300" />
              <p className="text-slate-500 font-medium">Nenhuma regra de alerta criada</p>
              <p className="text-sm text-slate-400 mt-1">Crie regras para receber notificações sobre eventos importantes</p>
              {perms.pode_configurar_alertas && (
                <Button onClick={handleNew} className="mt-4 bg-slate-900 text-white gap-2">
                  <Plus className="h-4 w-4" /> Criar primeira regra
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Rules list */}
        <div className="space-y-3">
          <AnimatePresence>
            {rules.map((rule, index) => {
              const Icon = GATILHO_ICONS[rule.gatilho] || Bell;
              return (
                <motion.div
                  key={rule.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ delay: index * 0.03 }}
                >
                  <Card className={cn(
                    "bg-white/80 border-slate-200/50 transition-all",
                    !rule.ativo && "opacity-60"
                  )}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4 flex-1 min-w-0">
                          <div className={cn(
                            "p-2.5 rounded-xl shrink-0",
                            rule.ativo ? "bg-orange-100" : "bg-slate-100"
                          )}>
                            <Icon className={cn("h-5 w-5", rule.ativo ? "text-orange-600" : "text-slate-400")} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-slate-900">{rule.nome}</p>
                              <Badge variant="outline" className={cn(
                                rule.ativo
                                  ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                                  : "border-slate-300 text-slate-500"
                              )}>
                                {rule.ativo ? 'Ativa' : 'Inativa'}
                              </Badge>
                            </div>
                            <p className="text-sm text-slate-500 mt-0.5">
                              {GATILHO_LABELS[rule.gatilho]}
                              {rule.gatilho === 'sem_ping_minutos' && rule.condicao_valor && ` (${rule.condicao_valor} min)`}
                              {rule.gatilho === 'multiplos_offline' && rule.condicao_valor && ` (≥ ${rule.condicao_valor} terminais)`}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                              {(rule.canal === 'email' || rule.canal === 'ambos') && rule.destinatarios_email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  {rule.destinatarios_email}
                                </span>
                              )}
                              {(rule.canal === 'slack' || rule.canal === 'ambos') && (
                                <span className="flex items-center gap-1">
                                  💬 Slack webhook
                                </span>
                              )}
                              {rule.filtro_local && <span>📍 {rule.filtro_local}</span>}
                              {rule.ultima_disparada && (
                                <span className="flex items-center gap-1">
                                  <Zap className="h-3 w-3 text-yellow-500" />
                                  Último disparo: {moment(rule.ultima_disparada).fromNow()}
                                </span>
                              )}
                              {rule.total_disparos > 0 && (
                                <span>{rule.total_disparos} disparo(s)</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {perms.pode_configurar_alertas && (
                            <>
                              <button
                                onClick={() => toggleMutation.mutate({ id: rule.id, ativo: !rule.ativo })}
                                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                                title={rule.ativo ? 'Desativar' : 'Ativar'}
                              >
                                {rule.ativo
                                  ? <ToggleRight className="h-5 w-5 text-emerald-500" />
                                  : <ToggleLeft className="h-5 w-5" />
                                }
                              </button>
                              <button
                                onClick={() => handleEdit(rule)}
                                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-blue-600 transition-colors"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => deleteMutation.mutate(rule.id)}
                                className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {modalOpen && (
        <AlertRuleModal
          rule={editingRule}
          onClose={() => { setModalOpen(false); setEditingRule(null); }}
          onSaved={(result) => {
            const isEdit = !!editingRule;
            logAudit(
              isEdit ? 'alerta_editado' : 'alerta_criado',
              editingRule?.id || result?.id || '',
              isEdit
                ? `Regra "${editingRule?.nome}" editada`
                : `Nova regra de alerta "${result?.nome || ''}" criada`
            );
            queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
            toast.success(isEdit ? 'Regra de alerta atualizada' : 'Regra de alerta criada');
            setModalOpen(false);
            setEditingRule(null);
          }}
        />
      )}
    </div>
  );
}