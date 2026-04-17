import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, ChevronDown, ChevronUp, Terminal, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import moment from 'moment';

const ACAO_LABELS = {
  settime:    'Acertar Relógio',
  getlogs:    'Recolher Marcações',
  opendoor:   'Abrir Porta',
  reboot:     'Reiniciar Terminal',
  getdevinfo: 'Info do Dispositivo',
  lockctrl:   'Forçar Porta Aberta',
  adduser:    'Adicionar Utilizador',
  blockuser:  'Bloquear Utilizador',
};

function LogRow({ log }) {
  const [expanded, setExpanded] = useState(false);
  let parsedRaw = null;
  if (log.resposta_raw) {
    try { parsedRaw = JSON.parse(log.resposta_raw); } catch { parsedRaw = log.resposta_raw; }
  }

  return (
    <div className={cn(
      'rounded-lg border p-3 text-sm transition-colors',
      log.sucesso ? 'bg-emerald-50/60 border-emerald-200' : 'bg-red-50/60 border-red-200'
    )}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {log.sucesso
            ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            : <XCircle className="h-4 w-4 text-red-500" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs font-medium">
              {ACAO_LABELS[log.acao] || log.acao}
            </Badge>
            <span className={cn('text-xs font-semibold', log.sucesso ? 'text-emerald-700' : 'text-red-600')}>
              {log.sucesso ? 'Sucesso' : 'Falha'}
            </span>
            <span className="text-xs text-slate-400 ml-auto shrink-0">
              {moment(log.timestamp).format('DD/MM/YY HH:mm:ss')}
            </span>
          </div>
          <p className="text-xs text-slate-600">{log.mensagem}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Por: <span className="font-medium text-slate-600">{log.executado_por}</span>
          </p>
          {parsedRaw && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-xs text-slate-400 hover:text-slate-600 mt-1 flex items-center gap-1"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? 'Ocultar resposta' : 'Ver resposta do terminal'}
            </button>
          )}
          {expanded && parsedRaw && (
            <pre className="text-xs bg-white border border-slate-200 rounded p-2 mt-2 overflow-x-auto max-h-40 text-slate-600">
              {typeof parsedRaw === 'string' ? parsedRaw : JSON.stringify(parsedRaw, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OperationLogsList({ terminalId }) {
  const { data: logs = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['operation-logs', terminalId],
    queryFn: () => base44.entities.OperationLog.filter(
      { terminal_id: terminalId },
      '-timestamp',
      50
    ),
    enabled: !!terminalId,
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-700">Logs de Operação</span>
          <Badge variant="outline" className="text-xs">{logs.length}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={refetch} disabled={isFetching} className="h-7 px-2 text-slate-400">
          <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
        </Button>
      </div>

      {isLoading ? (
        <div className="text-xs text-slate-400 text-center py-4">A carregar...</div>
      ) : logs.length === 0 ? (
        <div className="text-xs text-slate-400 text-center py-6 border border-dashed border-slate-200 rounded-lg">
          <Terminal className="h-6 w-6 mx-auto mb-2 opacity-30" />
          Nenhuma operação remota registada para este terminal
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {logs.map(log => <LogRow key={log.id} log={log} />)}
        </div>
      )}
    </div>
  );
}