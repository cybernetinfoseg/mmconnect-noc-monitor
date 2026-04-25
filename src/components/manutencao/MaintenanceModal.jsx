import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const EMPTY_FORM = {
    terminal_id: '',
    terminal_nome: '',
    titulo: '',
    descricao: '',
    inicio: '',
    fim: '',
};

export default function MaintenanceModal({ open, onClose, onSaved, editItem, currentUser }) {
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    const { data: terminals = [] } = useQuery({
        queryKey: ['terminals-list'],
        queryFn: async () => {
            const response = await base44.functions.invoke('getMyTerminals', {});
            return (response.data?.terminals || []).filter(t => t.ativo !== false);
        },
        enabled: open,
    });

    useEffect(() => {
        if (editItem) {
            setForm({
                terminal_id: editItem.terminal_id || '',
                terminal_nome: editItem.terminal_nome || '',
                titulo: editItem.titulo || '',
                descricao: editItem.descricao || '',
                inicio: editItem.inicio ? editItem.inicio.slice(0, 16) : '',
                fim: editItem.fim ? editItem.fim.slice(0, 16) : '',
            });
        } else {
            // Default: agora até +2h
            const now = new Date();
            const nowStr = now.toISOString().slice(0, 16);
            const fim = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16);
            setForm({ ...EMPTY_FORM, inicio: nowStr, fim });
        }
    }, [editItem, open]);

    const handleTerminalChange = (id) => {
        const t = terminals.find(t => t.id === id);
        setForm(f => ({ ...f, terminal_id: id, terminal_nome: t?.nome || '' }));
    };

    const handleSave = async () => {
        if (!form.terminal_id || !form.titulo || !form.inicio || !form.fim) return;
        setSaving(true);
        const data = {
            ...form,
            inicio: new Date(form.inicio).toISOString(),
            fim: new Date(form.fim).toISOString(),
            ativo: true,
            criado_por: currentUser?.email || '',
        };
        let result;
        if (editItem) {
            result = await base44.entities.MaintenanceWindow.update(editItem.id, data);
        } else {
            result = await base44.entities.MaintenanceWindow.create(data);
        }
        setSaving(false);
        onSaved(result || { ...data, id: editItem?.id });
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{editItem ? 'Editar Manutenção' : 'Nova Janela de Manutenção'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1">
                        <Label>Terminal</Label>
                        <Select value={form.terminal_id} onValueChange={handleTerminalChange}>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecionar terminal..." />
                            </SelectTrigger>
                            <SelectContent>
                                {terminals.map(t => (
                                    <SelectItem key={t.id} value={t.id}>{t.nome} {t.local ? `(${t.local})` : ''}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Título / Motivo</Label>
                        <Input
                            placeholder="Ex: Atualização de firmware"
                            value={form.titulo}
                            onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label>Descrição (opcional)</Label>
                        <Textarea
                            placeholder="Detalhes da manutenção..."
                            value={form.descricao}
                            onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                            rows={2}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label>Início</Label>
                            <Input
                                type="datetime-local"
                                value={form.inicio}
                                onChange={e => setForm(f => ({ ...f, inicio: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>Fim</Label>
                            <Input
                                type="datetime-local"
                                value={form.fim}
                                onChange={e => setForm(f => ({ ...f, fim: e.target.value }))}
                            />
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button
                        onClick={handleSave}
                        disabled={saving || !form.terminal_id || !form.titulo || !form.inicio || !form.fim}
                    >
                        {saving ? 'A guardar...' : 'Guardar'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}