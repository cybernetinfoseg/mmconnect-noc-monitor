import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { UserCheck, Ban, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

export default function PendingUserRow({ user, approveMutation, rejectMutation, deletePendingMutation }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-lg border border-amber-100 overflow-hidden">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 py-3 gap-3">
        <div className="flex-1">
          <p className="font-medium text-slate-900 text-sm">{user.email}</p>
          <p className="text-xs text-slate-400">Aguardando aprovação</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap sm:flex-nowrap">
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 gap-1 h-8"
            onClick={() => approveMutation.mutate({
              id: user.id,
              data: { aprovado: true, role: 'user' }
            })}
            disabled={approveMutation.isPending}
          >
            <UserCheck className="h-3.5 w-3.5" />
            Aprovar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 h-8 text-red-600 hover:bg-red-50 border-red-200"
            onClick={() => rejectMutation.mutate(user.id)}
            disabled={rejectMutation.isPending}
            title="Recusar e enviar email"
          >
            <Ban className="h-3.5 w-3.5" />
            Recusar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 h-8 text-slate-500 hover:text-slate-700"
            onClick={() => deletePendingMutation.mutate(user.id)}
            disabled={deletePendingMutation.isPending}
            title="Remover sem enviar email"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 h-8 text-slate-400 hover:text-slate-700"
            onClick={() => setExpanded(!expanded)}
            title="Ver informações"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-amber-100 bg-amber-50/50 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-slate-500 font-medium">Primeiro Nome</p>
            <p className="text-slate-800">{user.nome || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Sobrenome</p>
            <p className="text-slate-800">{user.sobrenome || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Telefone</p>
            <p className="text-slate-800">
              {user.pais_telefone && user.telefone ? `${user.pais_telefone} ${user.telefone}` : '—'}
            </p>
          </div>
          {user.motivo_acesso && (
            <div className="col-span-2">
              <p className="text-xs text-slate-500 font-medium">Motivo do Acesso</p>
              <p className="text-slate-800">{user.motivo_acesso}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}