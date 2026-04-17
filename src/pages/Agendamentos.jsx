import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarClock, Plus, Pencil, Trash2, Play, Pause,
  CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import moment from 'moment';
import { toast } from 'sonner';
import ScheduledActionModal from '@/components/agendamentos/ScheduledActionModal';

const ACAO_LABELS = {
  settime:    'Acertar Relógio',
  getlogs:    'Recolher Marcações',
  reboot:     'Reiniciar Terminal',
  opendoor:   'Abrir Porta',
  getdevinfo: 'Info do Dispositivo',
  lockctrl:   'Forçar Porta Aberta',
};

const ACAO_COLORS = {
  settime:    'bg-blue-100 text-blue-700 border-blue-200',
  getlogs:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  reboot:     'bg-red-100 text-red-700 border-red-200',
  opendoor:   'bg-amber-100 text-amber-700 border-amber-200',
  getdevinfo: 'bg-slate-100 text-slate-600 border-slate-200',
  lockctrl:   'bg-violet-100 text-violet-700 border-violet-200',
};

const FREQ_LABELS = {
  diaria:   'Diária',
  semanal:  'Semanal',
  mensal:   'Mensal',
  unica:    'Única vez',
};

const DIAS_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function formatFrequencia(sched) {
  if (sched.frequencia === 'diaria') return `Diária às ${sched.hora} UTC`;
  if (sched.frequencia === 'semanal') {
    try {
      const dias = JSON.parse(sched.dias_semana || '[]').map(d => DIAS_LABELS[d]).join(', ');
      return `${dias} às ${sched.hora} UTC`;
    } catch { return `Semanal às ${sched.hora} UTC`; }
  }
  if (sched.frequencia === 'mensal') return `Dia ${sched.dia_mes} de cada mês às ${sched.hora} UTC`;
  if (sched.frequencia === 'unica' && sched.data_unica) return moment(sched.data_unica).format('DD/MM/YY HH:mm');
  return sched.frequencia;
}

export default function Agendamentos() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms = resolvePermissions(currentUser);
  const canSeeAll = perms.isAdmin;

  const { data: allSchedules = [], isLoading } = useQuery({
    queryKey: ['scheduled-actions'],
    queryFn: () => base44.entities.ScheduledAction.list('-created_date', 100),
    refetchInterval: 30000,
    enabled: !!currentUser,
  });

  const schedules = useMemo(() => {
    if (!currentUser) return [];
    if (canSeeAll) return allSchedules;
    return allSchedules.filter(s => s.criado_por === currentUser.email);
  }, [allSchedules, currentUser, canSeeAll]);

  const toggleMutation = useMutation({
    mutationFn: ({ id, ativo }) => base44.entities.ScheduledAction.update(id, { ativo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-actions'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ScheduledAction.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-actions'] });
      toast.success('Agendamento eliminado');
    },
  });

  const handleRunNow = async (sched) => {
    setRunningId(sched.id);
    try {
      await base44.functions.invoke('terminalControl', {
        terminal_id: sched.terminal_id,
        action: sched.acao,
      });
      // Atualizar última execução
      await base44.entities.ScheduledAction.update(sched.id, {
        ultima_execucao: new Date().toISOString(),
        ultimo_resultado: 'sucesso',
        total_execucoes: (sched.total_execucoes || 0) + 1,
      });
      queryClient.invalidateQueries({ queryKey: ['scheduled-actions'] });
      toast.success(`Ação executada: ${ACAO_LABELS[sched.acao]}`);
    } catch (err) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setRunningId(null);
    }
  };

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['scheduled-actions'] });
    setModalOpen(false);
    setEditItem(null);
    toast.success('Agendamento guardado');
  };

  const ativos = schedules.filter(s => s.ativo);
  const inativos = schedules.filter(s => !s.ativo);

  const ScheduleCard = ({ sched, index }) => (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ delay: index * 0.03 }}
    >
      <Card className={cn('bg-white border-slate-200', !sched.ativo && 'opacity-60')}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-semibold text-slate-800 text-sm truncate">{sched.nome}</span>
                <Badge variant="outline" className={cn('text-xs shrink-0', ACAO_COLORS[sched.acao])}>
                  {ACAO_LABELS[sched.acao]}
                </Badge>
                <Badge variant="outline" className="text-xs shrink-0">
                  {FREQ_LABELS[sched.frequencia]}
                </Badge>
              </div>

              <p className="text-xs text-slate-500">
                Terminal: <span className="font-medium text-slate-700">{sched.terminal_nome}</span>
              </p>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatFrequencia(sched)}
              </p>

              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {sched.ultima_execucao && (
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    {sched.ultimo_resultado === 'sucesso'
                      ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      : <XCircle className="h-3 w-3 text-red-400" />
                    }
                    Última: {moment(sched.ultima_execucao).fromNow()}
                  </span>
                )}
                {sched.total_execucoes > 0 && (
                  <span className="text-xs text-slate-400">{sched.total_execucoes}× executado</span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1 shrink-0">
              <Button
                size="icon" variant="ghost"
                className={cn('h-7 w-7', sched.ativo ? 'text-orange-500 hover:bg-orange-50' : 'text-emerald-600 hover:bg-emerald-50')}
                title={sched.ativo ? 'Pausar' : 'Ativar'}
                onClick={() => toggleMutation.mutate({ id: sched.id, ativo: !sched.ativo })}
              >
                {sched.ativo ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
              <Button
                size="icon" variant="ghost"
                className="h-7 w-7 text-blue-500 hover:bg-blue-50"
                title="Executar agora"
                disabled={runningId === sched.id}
                onClick={() => handleRunNow(sched)}
              >
                {runningId === sched.id
                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  : <RefreshCw className="h-3.5 w-3.5" />
                }
              </Button>
              <Button
                size="icon" variant="ghost"
                className="h-7 w-7"
                title="Editar"
                onClick={() => { setEditItem(sched); setModalOpen(true); }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon" variant="ghost"
                className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50"
                title="Eliminar"
                onClick={() => { if (confirm('Eliminar agendamento?')) deleteMutation.mutate(sched.id); }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-xl">
            <CalendarClock className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Agendamentos</h1>
            <p className="text-sm text-slate-500">Ações remotas automáticas nos terminais</p>
          </div>
        </div>
        <Button onClick={() => { setEditItem(null); setModalOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Novo Agendamento</span>
          <span className="sm:hidden">Novo</span>
        </Button>
      </div>

      {/* Info */}
      <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
        <p>As ações são executadas automaticamente pelo sistema a cada 5 minutos. Os resultados ficam registados nos <strong>Logs de Operação</strong> de cada terminal. Os horários são em <strong>UTC</strong>.</p>
      </div>

      {/* Ativos */}
      {ativos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
            Ativos ({ativos.length})
          </h2>
          <AnimatePresence>
            {ativos.map((s, i) => <ScheduleCard key={s.id} sched={s} index={i} />)}
          </AnimatePresence>
        </section>
      )}

      {/* Inativos */}
      {inativos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
            Pausados ({inativos.length})
          </h2>
          <AnimatePresence>
            {inativos.map((s, i) => <ScheduleCard key={s.id} sched={s} index={i} />)}
          </AnimatePresence>
        </section>
      )}

      {/* Vazio */}
      {!isLoading && schedules.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <CalendarClock className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhum agendamento criado</p>
          <p className="text-sm mt-1">Crie agendamentos para automatizar ações remotas nos terminais</p>
        </div>
      )}

      <ScheduledActionModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditItem(null); }}
        onSaved={handleSaved}
        editItem={editItem}
        currentUser={currentUser}
      />
    </div>
  );
}