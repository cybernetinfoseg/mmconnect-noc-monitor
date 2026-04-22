import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Wrench, Calendar, Clock, Trash2, Pencil, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format, isAfter, isBefore } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import MaintenanceModal from '@/components/manutencao/MaintenanceModal';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';

function getStatus(item) {
    const now = new Date();
    const inicio = new Date(item.inicio);
    const fim = new Date(item.fim);
    if (!item.ativo) return 'cancelada';
    if (isBefore(now, inicio)) return 'agendada';
    if (isAfter(now, fim)) return 'concluida';
    return 'ativa';
}

const STATUS_CONFIG = {
    ativa:     { label: 'Ativa agora', className: 'bg-orange-100 text-orange-700 border-orange-200' },
    agendada:  { label: 'Agendada',    className: 'bg-blue-100 text-blue-700 border-blue-200' },
    concluida: { label: 'Concluída',   className: 'bg-slate-100 text-slate-500 border-slate-200' },
    cancelada: { label: 'Cancelada',   className: 'bg-red-100 text-red-500 border-red-200' },
};

export default function Manutencao() {
    const queryClient = useQueryClient();
    const [modalOpen, setModalOpen] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);

    const logAudit = (acao, entidade_id, descricao) =>
        base44.functions.invoke('auditLog', { acao, entidade: 'MaintenanceWindow', entidade_id, descricao }).catch(() => {});

    useEffect(() => {
        base44.auth.me().then(setCurrentUser).catch(() => {});
    }, []);

    const perms = resolvePermissions(currentUser);

    const { data: janelas = [], isLoading } = useQuery({
        queryKey: ['maintenance-windows', currentUser?.email],
        queryFn: () => base44.entities.MaintenanceWindow.list('-inicio', 100),
        refetchInterval: 30000,
        enabled: !!currentUser,
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => base44.entities.MaintenanceWindow.delete(id),
        onSuccess: (_, id) => {
            const item = janelas.find(j => j.id === id);
            logAudit('manutencao_cancelada', id, `Manutenção "${item?.titulo || id}" do terminal "${item?.terminal_nome || ''}" removida`);
            queryClient.invalidateQueries({ queryKey: ['maintenance-windows'] });
            toast.success('Manutenção removida');
        },
        onError: () => toast.error('Erro ao remover manutenção'),
    });

    const cancelMutation = useMutation({
        mutationFn: (id) => base44.entities.MaintenanceWindow.update(id, { ativo: false }),
        onSuccess: (_, id) => {
            const item = janelas.find(j => j.id === id);
            logAudit('manutencao_cancelada', id, `Manutenção "${item?.titulo || id}" do terminal "${item?.terminal_nome || ''}" cancelada`);
            queryClient.invalidateQueries({ queryKey: ['maintenance-windows'] });
            toast.success('Manutenção cancelada');
        },
        onError: () => toast.error('Erro ao cancelar manutenção'),
    });

    const handleSaved = (result) => {
        const isEdit = !!editItem;
        logAudit(
            isEdit ? 'manutencao_editada' : 'manutencao_criada',
            editItem?.id || result?.id || '',
            isEdit
                ? `Manutenção "${editItem?.titulo}" do terminal "${editItem?.terminal_nome}" editada`
                : `Nova manutenção criada`
        );
        queryClient.invalidateQueries({ queryKey: ['maintenance-windows'] });
        toast.success(isEdit ? 'Manutenção atualizada' : 'Manutenção criada');
        setModalOpen(false);
        setEditItem(null);
    };

    const handleEdit = (item) => {
        setEditItem(item);
        setModalOpen(true);
    };

    const ativas = janelas.filter(j => getStatus(j) === 'ativa');
    const agendadas = janelas.filter(j => getStatus(j) === 'agendada');
    const historico = janelas.filter(j => ['concluida', 'cancelada'].includes(getStatus(j)));

    const JanelaCard = ({ item }) => {
        const status = getStatus(item);
        const cfg = STATUS_CONFIG[status];
        const podeEditar = status === 'agendada';
        const podeCancelar = status === 'agendada' || status === 'ativa';

        return (
            <Card className="bg-white border border-slate-200">
                <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-slate-800 text-sm">{item.terminal_nome}</span>
                                <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>
                            </div>
                            <p className="text-sm text-slate-600 mt-0.5">{item.titulo}</p>
                            {item.descricao && (
                                <p className="text-xs text-slate-400 mt-0.5">{item.descricao}</p>
                            )}
                            <div className="flex items-center gap-3 mt-2 text-xs text-slate-500 flex-wrap">
                                <span className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    {format(new Date(item.inicio), "dd/MM/yy HH:mm", { locale: ptBR })}
                                </span>
                                <span>→</span>
                                <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {format(new Date(item.fim), "dd/MM/yy HH:mm", { locale: ptBR })}
                                </span>
                            </div>
                            {item.criado_por && (
                                <p className="text-xs text-slate-400 mt-1">Por: {item.criado_por}</p>
                            )}
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                            {podeEditar && (
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(item)}>
                                    <Pencil className="h-3.5 w-3.5" />
                                </Button>
                            )}
                            {podeCancelar && (
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50"
                                    onClick={() => cancelMutation.mutate(item.id)}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    };

    return (
        <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-4xl overflow-x-hidden">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-100 rounded-xl">
                        <Wrench className="h-5 w-5 text-orange-600" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">Manutenção Programada</h1>
                        <p className="text-sm text-slate-500">Suspende alertas durante períodos de manutenção</p>
                    </div>
                </div>
                <Button onClick={() => { setEditItem(null); setModalOpen(true); }} className="gap-2">
                    <Plus className="h-4 w-4" />
                    <span className="hidden sm:inline">Nova Janela</span>
                    <span className="sm:hidden">Nova</span>
                </Button>
            </div>

            {/* Aviso informativo */}
            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <p>Durante uma janela de manutenção ativa, o sistema <strong>não gera alertas nem incidentes</strong> para o terminal selecionado. O status continua a ser registado no histórico.</p>
            </div>

            {/* Ativas agora */}
            {ativas.length > 0 && (
                <section>
                    <h2 className="text-sm font-semibold text-orange-600 uppercase tracking-wide mb-3">Em manutenção agora ({ativas.length})</h2>
                    <div className="space-y-2">
                        {ativas.map(j => <JanelaCard key={j.id} item={j} />)}
                    </div>
                </section>
            )}

            {/* Agendadas */}
            {agendadas.length > 0 && (
                <section>
                    <h2 className="text-sm font-semibold text-blue-600 uppercase tracking-wide mb-3">Agendadas ({agendadas.length})</h2>
                    <div className="space-y-2">
                        {agendadas.map(j => <JanelaCard key={j.id} item={j} />)}
                    </div>
                </section>
            )}

            {/* Vazio */}
            {!isLoading && ativas.length === 0 && agendadas.length === 0 && (
                <div className="text-center py-16 text-slate-400">
                    <Wrench className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Nenhuma manutenção ativa ou agendada</p>
                    <p className="text-sm mt-1">Crie uma janela de manutenção para suspender alertas durante intervenções técnicas</p>
                </div>
            )}

            {/* Histórico */}
            {historico.length > 0 && (
                <section>
                    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Histórico</h2>
                    <div className="space-y-2">
                        {historico.slice(0, 20).map(j => <JanelaCard key={j.id} item={j} />)}
                    </div>
                </section>
            )}

            <MaintenanceModal
                open={modalOpen}
                onClose={() => { setModalOpen(false); setEditItem(null); }}
                onSaved={handleSaved}
                editItem={editItem}
                currentUser={currentUser}
            />
        </div>
    );
}