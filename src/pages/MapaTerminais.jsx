import React, { useState, useMemo, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTerminals, TERMINALS_QUERY_KEY } from '@/hooks/useTerminals';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import { MapPin, Monitor, AlertTriangle, Search, RefreshCw, Maximize2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import FloorPlanCanvas from '@/components/mapa/FloorPlanCanvas';
import MapaFullscreen from '@/components/mapa/MapaFullscreen';

const STATUS_COLORS = {
  online:  { bg: 'bg-emerald-500', text: 'text-emerald-700', light: 'bg-emerald-50 border-emerald-200' },
  offline: { bg: 'bg-red-500',     text: 'text-red-700',     light: 'bg-red-50 border-red-200'     },
  warning: { bg: 'bg-yellow-500',  text: 'text-yellow-700',  light: 'bg-yellow-50 border-yellow-200'},
  default: { bg: 'bg-slate-400',   text: 'text-slate-600',   light: 'bg-slate-50 border-slate-200' },
};
function getColors(status) { return STATUS_COLORS[status] || STATUS_COLORS.default; }

export default function MapaTerminais() {
  const [currentUser, setCurrentUser]     = useState(null);
  const [selectedTerminal, setSelectedTerminal] = useState(null);
  const [search, setSearch]               = useState('');
  const [statusFilter, setStatusFilter]   = useState('all');
  const [localFilter, setLocalFilter]     = useState('all');
  const [userFilter, setUserFilter]       = useState('all');
  const [fullscreenLocal, setFullscreenLocal] = useState(null); // { local, termList }
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms   = resolvePermissions(currentUser);
  const isAdmin = perms.isAdmin;

  // Terminais — hook centralizado, query key partilhada com todas as páginas
  const { data: allTerminals = [], isLoading, isFetching, refetch } = useTerminals({ enabled: !!currentUser });

  // Utilizadores únicos (só para admin)
  const usuarios = useMemo(() =>
    isAdmin ? [...new Set(allTerminals.map(t => t.usuario_email || t.created_by).filter(Boolean))].sort() : [],
    [allTerminals, isAdmin]
  );

  // Plantas baixas guardadas — busca todas (admin vê tudo, utilizador vê as suas)
  const { data: floorPlans = [], refetch: refetchPlans } = useQuery({
    queryKey: ['floor-plans'],
    queryFn:  () => base44.entities.FloorPlan.list('local'),
    enabled:  !!currentUser,
  });

  const [isMonitoring, setIsMonitoring] = useState(false);

  const handleRefresh = async () => {
    setIsMonitoring(true);
    try {
      if (isAdmin) {
        await base44.functions.invoke('monitorAllTerminals', {});
      } else {
        // Utilizadores não-admin verificam cada terminal ativo individualmente
        const ativos = allTerminals.filter(t => t.ativo !== false && ['ip_publico','dns','api'].includes(t.tipo_conexao));
        await Promise.all(ativos.map(t =>
          base44.functions.invoke('monitorTerminal', { terminalId: t.id }).catch(() => {})
        ));
      }
    } catch {}
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: TERMINALS_QUERY_KEY }),
      refetchPlans()
    ]);
    setIsMonitoring(false);
  };

  // Determina o dono efectivo da planta a mostrar:
  // - Admin com filtro de utilizador activo → planta do utilizador filtrado
  // - Admin sem filtro → planta do próprio admin
  // - Utilizador normal → sempre a sua própria planta
  const effectiveOwner = isAdmin
    ? (userFilter !== 'all' ? userFilter : currentUser?.email)
    : currentUser?.email;

  const getPlan = (local) => {
    const plan = floorPlans.find(p => p.local === local && p.owner_email === effectiveOwner);
    if (!plan) return null;
    return {
      imageUrl:  plan.image_url || null,
      positions: plan.positions ? JSON.parse(plan.positions) : {},
    };
  };

  // Pode editar apenas se for o próprio dono (ou admin a ver a sua própria planta)
  const canEditPlan = !isAdmin
    ? true  // utilizador normal pode sempre editar as suas plantas
    : userFilter === 'all' || userFilter === currentUser?.email; // admin só edita quando está a ver as suas próprias plantas

  const savePlan = async (local, { imageUrl, positions }) => {
    const existing = floorPlans.find(p => p.local === local && p.owner_email === effectiveOwner);
    const data = {
      local,
      owner_email: effectiveOwner,
      image_url:   imageUrl || null,
      positions:   JSON.stringify(positions || {}),
    };
    if (existing) {
      await base44.entities.FloorPlan.update(existing.id, data);
    } else {
      await base44.entities.FloorPlan.create(data);
    }
    queryClient.invalidateQueries(['floor-plans']);
  };

  const terminals = useMemo(() => allTerminals.filter(t => t.ativo !== false), [allTerminals]);
  const locais    = useMemo(() => [...new Set(terminals.map(t => t.local).filter(Boolean))].sort(), [terminals]);

  const filtered = useMemo(() => {
    return terminals.filter(t => {
      const matchSearch = !search || t.nome?.toLowerCase().includes(search.toLowerCase()) || t.local?.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || t.status === statusFilter;
      const matchLocal  = localFilter  === 'all' || t.local === localFilter;
      const matchUser   = !isAdmin || userFilter === 'all' || (t.usuario_email || t.created_by) === userFilter;
      return matchSearch && matchStatus && matchLocal && matchUser;
    });
  }, [terminals, search, statusFilter, localFilter, userFilter, isAdmin]);

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

  const hasActiveFilters = search || statusFilter !== 'all' || localFilter !== 'all' || userFilter !== 'all';

  return (
    <>
    {/* ── Overlay Fullscreen ── */}
    <AnimatePresence>
      {fullscreenLocal && (
        <MapaFullscreen
          local={fullscreenLocal.local}
          termList={fullscreenLocal.termList}
          canEdit={canEditPlan}
          savedPlan={getPlan(fullscreenLocal.local)}
          onSave={(plan) => savePlan(fullscreenLocal.local, plan)}
          onClose={() => setFullscreenLocal(null)}
          onRefresh={handleRefresh}
          isRefreshing={isMonitoring || isFetching}
        />
      )}
    </AnimatePresence>

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
              <p className="text-xs sm:text-sm text-slate-500">Visualização por local com planta baixa</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isMonitoring || isFetching} className="gap-1.5">
            <RefreshCw className={cn("h-4 w-4", (isMonitoring || isFetching) && "animate-spin")} />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total',   value: stats.total,   color: 'text-slate-700',   bg: 'bg-white'      },
            { label: 'Online',  value: stats.online,  color: 'text-emerald-700', bg: 'bg-emerald-50' },
            { label: 'Offline', value: stats.offline, color: 'text-red-700',     bg: 'bg-red-50'     },
            { label: 'Atenção', value: stats.warning, color: 'text-yellow-700',  bg: 'bg-yellow-50'  },
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
        <div className="flex flex-col sm:flex-row gap-2 flex-wrap items-start sm:items-center">
          {/* Pesquisa */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input placeholder="Pesquisar terminal ou local..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 bg-white" />
          </div>

          {/* Local */}
          <select
            value={localFilter}
            onChange={e => setLocalFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">Todos os locais</option>
            {locais.map(l => <option key={l} value={l}>{l}</option>)}
          </select>

          {/* Utilizador — apenas admin */}
          {isAdmin && (
            <select
              value={userFilter}
              onChange={e => setUserFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">Todos os utilizadores</option>
              {usuarios.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          )}

          {/* Status pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
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
            {hasActiveFilters && (
              <button onClick={() => { setSearch(''); setStatusFilter('all'); setLocalFilter('all'); setUserFilter('all'); }}
                className="text-xs text-slate-400 hover:text-slate-700 transition-colors ml-1">
                Limpar
              </button>
            )}
          </div>
        </div>

        {/* Legenda */}
        <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
          <span className="font-medium text-slate-700">Legenda:</span>
          {[['online','Online'],['offline','Offline'],['warning','Atenção']].map(([s, l]) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={cn('w-3 h-3 rounded-full', getColors(s).bg)} />{l}
            </span>
          ))}
          <span className="ml-auto text-slate-400">{filtered.length} terminal(is) exibido(s)</span>
        </div>

        {/* Mapa por locais */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-64 text-slate-400">
              <RefreshCw className="h-6 w-6 animate-spin mr-2" /> A carregar terminais...
            </div>
          ) : groupedByLocal.length === 0 ? (
            <Card className="bg-white border-slate-200">
              <CardContent className="py-16 text-center text-slate-400">
                <Monitor className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p>Nenhum terminal encontrado com os filtros activos</p>
              </CardContent>
            </Card>
          ) : (
            <AnimatePresence>
              {groupedByLocal.map(([local, termList], gi) => {
                const hasOffline  = termList.some(t => t.status === 'offline');
                const hasWarning  = termList.some(t => t.status === 'warning');
                const localStatus = hasOffline ? 'offline' : hasWarning ? 'warning' : 'online';
                const lc          = getColors(localStatus);

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
                          <div className="flex items-center gap-2 flex-wrap">
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
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Modo TV / Fullscreen"
                              onClick={() => setFullscreenLocal({ local, termList })}
                              className="h-7 w-7 text-slate-400 hover:text-teal-700 hover:bg-teal-50 shrink-0"
                            >
                              <Maximize2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>

                      <CardContent className="p-4 sm:p-5">
                        <FloorPlanCanvas
                          local={local}
                          terminals={termList}
                          canEdit={canEditPlan}
                          savedPlan={getPlan(local)}
                          onSave={(plan) => savePlan(local, plan)}
                          selectedId={selectedTerminal?.id}
                          onSelect={setSelectedTerminal}
                        />
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* Painel de offline */}
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
                  <button
                    key={t.id}
                    onClick={() => setSelectedTerminal(t)}
                    className="flex items-center gap-2 bg-white border border-red-200 rounded-lg px-3 py-2 text-left hover:border-red-400 transition-colors"
                  >
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-red-800 truncate">{t.nome}</p>
                      <p className="text-xs text-red-500 truncate">{t.local || 'Sem local'}</p>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
    </>
  );
}