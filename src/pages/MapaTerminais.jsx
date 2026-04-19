import React, { useState, useMemo, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import { MapPin, Monitor, Wifi, WifiOff, AlertTriangle, Search, RefreshCw, X, Info, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

// Gera uma posição pseudo-aleatória mas determinística a partir de uma string
function hashPosition(str, index, total) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  const col = Math.abs(h) % 10;
  const row = Math.abs(h >> 4) % 8;
  return { col, row };
}

// Cores por status
const STATUS_COLORS = {
  online:  { bg: 'bg-emerald-500', ring: 'ring-emerald-400', text: 'text-emerald-700', light: 'bg-emerald-50 border-emerald-200' },
  offline: { bg: 'bg-red-500',     ring: 'ring-red-400',     text: 'text-red-700',     light: 'bg-red-50 border-red-200'     },
  warning: { bg: 'bg-yellow-500',  ring: 'ring-yellow-400',  text: 'text-yellow-700',  light: 'bg-yellow-50 border-yellow-200'},
  default: { bg: 'bg-slate-400',   ring: 'ring-slate-300',   text: 'text-slate-600',   light: 'bg-slate-50 border-slate-200' },
};

function getColors(status) {
  return STATUS_COLORS[status] || STATUS_COLORS.default;
}

// Tooltip de detalhe do terminal
function TerminalTooltip({ terminal, onClose }) {
  const c = getColors(terminal.status);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 8 }}
      className="absolute z-50 w-64 bg-white rounded-xl shadow-2xl border border-slate-200 p-4 pointer-events-auto"
      style={{ bottom: '110%', left: '50%', transform: 'translateX(-50%)' }}
    >
      <button onClick={onClose} className="absolute top-2 right-2 text-slate-400 hover:text-slate-700">
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-center gap-2 mb-3">
        <span className={cn('w-3 h-3 rounded-full shrink-0', c.bg, terminal.status === 'online' ? '' : 'animate-pulse')} />
        <span className="font-semibold text-slate-900 text-sm truncate">{terminal.nome}</span>
      </div>
      <div className="space-y-1.5 text-xs text-slate-600">
        {terminal.local && (
          <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3 text-slate-400 shrink-0" />{terminal.local}</div>
        )}
        {terminal.cliente_nome && (
          <div className="flex items-center gap-1.5"><Info className="h-3 w-3 text-slate-400 shrink-0" />Cliente: {terminal.cliente_nome}</div>
        )}
        {terminal.modelo && (
          <div className="flex items-center gap-1.5"><Monitor className="h-3 w-3 text-slate-400 shrink-0" />{terminal.modelo}</div>
        )}
        {terminal.latencia_ms && (
          <div className="flex items-center gap-1.5"><Wifi className="h-3 w-3 text-slate-400 shrink-0" />Latência: {terminal.latencia_ms}ms</div>
        )}
        {terminal.ultimo_ping && (
          <div className="text-slate-400 text-[10px] mt-1">
            Último ping: {new Date(terminal.ultimo_ping).toLocaleString('pt-PT')}
          </div>
        )}
      </div>
      <div className={cn('mt-3 px-2 py-1 rounded-lg text-center text-xs font-semibold border', c.light, c.text)}>
        {terminal.status === 'online' ? 'ONLINE' : terminal.status === 'offline' ? 'OFFLINE' : terminal.status?.toUpperCase() || 'DESCONHECIDO'}
      </div>
    </motion.div>
  );
}

// Marcador individual
function TerminalMarker({ terminal, selected, onSelect }) {
  const c = getColors(terminal.status);
  const isOffline = terminal.status === 'offline';
  const isOnline = terminal.status === 'online';

  return (
    <div className="relative flex flex-col items-center group" style={{ minWidth: 44 }}>
      <button
        onClick={() => onSelect(selected ? null : terminal)}
        className={cn(
          'relative w-10 h-10 rounded-full flex items-center justify-center border-2 border-white shadow-lg transition-all duration-200 focus:outline-none',
          c.bg,
          'ring-2', c.ring,
          selected && 'ring-4 scale-125',
          !selected && 'hover:scale-110'
        )}
        title={terminal.nome}
      >
        {isOffline ? (
          <WifiOff className="h-4 w-4 text-white" />
        ) : isOnline ? (
          <Wifi className="h-4 w-4 text-white" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-white" />
        )}
        {isOffline && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping opacity-75" />
        )}
      </button>
      <span className="mt-1 text-[9px] font-semibold text-slate-700 max-w-[56px] text-center leading-tight truncate select-none">
        {terminal.nome}
      </span>

      <AnimatePresence>
        {selected && <TerminalTooltip terminal={terminal} onClose={() => onSelect(null)} />}
      </AnimatePresence>
    </div>
  );
}

export default function MapaTerminais() {
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedTerminal, setSelectedTerminal] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [localFilter, setLocalFilter] = useState('all');
  const mapRef = useRef(null);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms = resolvePermissions(currentUser);
  const isAdmin = perms.isAdmin;

  const { data: allTerminals = [], isLoading, refetch } = useQuery({
    queryKey: ['mapa-terminals', currentUser?.email, isAdmin],
    queryFn: async () => {
      if (isAdmin) return base44.entities.Terminal.list('-created_date');
      return base44.entities.Terminal.filter({ created_by: currentUser?.email }, '-created_date');
    },
    enabled: !!currentUser,
    refetchInterval: 15000,
  });

  const terminals = useMemo(() => allTerminals.filter(t => t.ativo !== false), [allTerminals]);

  const locais = useMemo(() => [...new Set(terminals.map(t => t.local).filter(Boolean))].sort(), [terminals]);

  const filtered = useMemo(() => {
    return terminals.filter(t => {
      const matchSearch = !search || t.nome?.toLowerCase().includes(search.toLowerCase()) || t.local?.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || t.status === statusFilter;
      const matchLocal  = localFilter  === 'all' || t.local === localFilter;
      return matchSearch && matchStatus && matchLocal;
    });
  }, [terminals, search, statusFilter, localFilter]);

  // Agrupar por local para o mapa de grupos
  const groupedByLocal = useMemo(() => {
    const groups = {};
    filtered.forEach(t => {
      const key = t.local || 'Sem local';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const stats = useMemo(() => ({
    total:   terminals.length,
    online:  terminals.filter(t => t.status === 'online').length,
    offline: terminals.filter(t => t.status === 'offline').length,
    warning: terminals.filter(t => t.status === 'warning').length,
  }), [terminals]);

  // Click fora fecha tooltip
  useEffect(() => {
    const handler = (e) => {
      if (mapRef.current && !mapRef.current.contains(e.target)) setSelectedTerminal(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 w-full overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-5 max-w-[1920px]">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-teal-100 rounded-xl shrink-0">
              <MapPin className="h-6 w-6 text-teal-600" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Mapa de Terminais</h1>
              <p className="text-xs sm:text-sm text-slate-500">Visualização geográfica por local</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total',   value: stats.total,   color: 'text-slate-700',   bg: 'bg-white'        },
            { label: 'Online',  value: stats.online,  color: 'text-emerald-700', bg: 'bg-emerald-50'   },
            { label: 'Offline', value: stats.offline, color: 'text-red-700',     bg: 'bg-red-50'       },
            { label: 'Atenção', value: stats.warning, color: 'text-yellow-700',  bg: 'bg-yellow-50'    },
          ].map(k => (
            <Card key={k.label} className={cn('border-slate-200', k.bg)}>
              <CardContent className="p-3 sm:p-4 flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">{k.label}</span>
                <span className={cn('text-2xl font-bold', k.color)}>{k.value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input placeholder="Pesquisar terminal ou local..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 bg-white" />
          </div>
          <select
            value={localFilter}
            onChange={e => setLocalFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">Todos os locais</option>
            {locais.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <div className="flex items-center gap-2 flex-wrap">
            {['all', 'online', 'offline', 'warning'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-semibold select-none transition-colors border',
                  statusFilter === s
                    ? s === 'online'  ? 'bg-emerald-600 text-white border-emerald-600'
                    : s === 'offline' ? 'bg-red-600 text-white border-red-600'
                    : s === 'warning' ? 'bg-yellow-500 text-white border-yellow-500'
                    : 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                )}
              >
                {s === 'all' ? 'Todos' : s === 'online' ? '🟢 Online' : s === 'offline' ? '🔴 Offline' : '🟡 Atenção'}
              </button>
            ))}
            {(search || statusFilter !== 'all' || localFilter !== 'all') && (
              <button onClick={() => { setSearch(''); setStatusFilter('all'); setLocalFilter('all'); }}
                className="text-xs text-slate-400 hover:text-slate-700 transition-colors">
                Limpar
              </button>
            )}
          </div>
        </div>

        {/* Legenda */}
        <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
          <span className="font-medium text-slate-700">Legenda:</span>
          {[
            { status: 'online',  label: 'Online'  },
            { status: 'offline', label: 'Offline' },
            { status: 'warning', label: 'Atenção' },
          ].map(({ status, label }) => {
            const c = getColors(status);
            return (
              <span key={status} className="flex items-center gap-1.5">
                <span className={cn('w-3 h-3 rounded-full', c.bg)} />
                {label}
              </span>
            );
          })}
          <span className="ml-auto text-slate-400">{filtered.length} terminal(is) exibido(s)</span>
        </div>

        {/* Mapa por locais */}
        <div ref={mapRef} className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-64 text-slate-400">
              <RefreshCw className="h-6 w-6 animate-spin mr-2" /> A carregar terminais...
            </div>
          ) : groupedByLocal.length === 0 ? (
            <Card className="bg-white border-slate-200">
              <CardContent className="py-16 text-center text-slate-400">
                <Monitor className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p>Nenhum terminal encontrado com os filtros actuais</p>
              </CardContent>
            </Card>
          ) : (
            <AnimatePresence>
              {groupedByLocal.map(([local, termList], gi) => {
                const hasOffline = termList.some(t => t.status === 'offline');
                const hasWarning = termList.some(t => t.status === 'warning');
                const allOnline  = termList.every(t => t.status === 'online');
                const localStatus = hasOffline ? 'offline' : hasWarning ? 'warning' : 'online';
                const lc = getColors(localStatus);

                return (
                  <motion.div
                    key={local}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -16 }}
                    transition={{ delay: gi * 0.04 }}
                  >
                    <Card className={cn('bg-white border overflow-visible', hasOffline ? 'border-red-200' : hasWarning ? 'border-yellow-200' : 'border-slate-200')}>
                      {/* Cabeçalho do local */}
                      <CardHeader className={cn('py-3 px-4 rounded-t-xl', hasOffline ? 'bg-red-50' : hasWarning ? 'bg-yellow-50' : 'bg-emerald-50/50')}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <MapPin className={cn('h-4 w-4 shrink-0', lc.text)} />
                            <CardTitle className={cn('text-sm font-bold', lc.text)}>{local}</CardTitle>
                          </div>
                          <div className="flex items-center gap-2 text-xs flex-wrap">
                            {termList.filter(t => t.status === 'online').length > 0 && (
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">
                                {termList.filter(t => t.status === 'online').length} online
                              </Badge>
                            )}
                            {termList.filter(t => t.status === 'offline').length > 0 && (
                              <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px] animate-pulse">
                                {termList.filter(t => t.status === 'offline').length} offline
                              </Badge>
                            )}
                            {termList.filter(t => t.status === 'warning').length > 0 && (
                              <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-[10px]">
                                {termList.filter(t => t.status === 'warning').length} atenção
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardHeader>

                      {/* Grid de marcadores */}
                      <CardContent className="p-4 sm:p-6">
                        {/* Planta baixa estilizada — fundo quadriculado */}
                        <div
                          className="relative w-full rounded-xl overflow-visible"
                          style={{
                            minHeight: Math.max(120, Math.ceil(termList.length / 6) * 100 + 40),
                            background: 'repeating-linear-gradient(0deg,transparent,transparent 39px,#e2e8f0 39px,#e2e8f0 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,#e2e8f0 39px,#e2e8f0 40px)',
                            backgroundColor: '#f8fafc',
                          }}
                        >
                          {/* Rótulo da planta */}
                          <span className="absolute top-2 left-3 text-[10px] text-slate-400 font-medium uppercase tracking-wider select-none">
                            Planta — {local}
                          </span>

                          {/* Terminais posicionados em grelha */}
                          <div className="flex flex-wrap gap-6 p-8 pt-10 justify-start">
                            {termList.map((terminal, idx) => (
                              <div key={terminal.id} className="relative" style={{ zIndex: selectedTerminal?.id === terminal.id ? 100 : 1 }}>
                                <TerminalMarker
                                  terminal={terminal}
                                  selected={selectedTerminal?.id === terminal.id}
                                  onSelect={setSelectedTerminal}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* Lista rápida de offline */}
        {terminals.filter(t => t.status === 'offline').length > 0 && (
          <Card className="bg-red-50 border-red-200">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-red-700 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 animate-pulse" />
                Terminais Offline ({terminals.filter(t => t.status === 'offline').length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {terminals.filter(t => t.status === 'offline').map(t => (
                  <div key={t.id} className="flex items-center gap-2 bg-white border border-red-200 rounded-lg px-3 py-2">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-red-800 truncate">{t.nome}</p>
                      <p className="text-xs text-red-500 truncate">{t.local || 'Sem local'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}