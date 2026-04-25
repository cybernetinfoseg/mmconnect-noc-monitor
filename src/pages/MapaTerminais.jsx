import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import FloorPlanCanvas from '@/components/mapa/FloorPlanCanvas';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Map,
  Upload,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  LayoutGrid,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  User as UserIcon,
  Layers,
} from 'lucide-react';

export default function MapaTerminais() {
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [positions, setPositions] = useState({});
  const [showNewPlanDialog, setShowNewPlanDialog] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanOwner, setNewPlanOwner] = useState('');
  const [uploading, setUploading] = useState(false);
  const [userFilter, setUserFilter] = useState('all');

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms = resolvePermissions(currentUser);
  const isAdmin = perms.isAdmin;

  // Fetch terminais
  const { data: allTerminals = [] } = useQuery({
    queryKey: ['terminals-mapa', currentUser?.email, isAdmin],
    queryFn: async () => {
      if (!currentUser) return [];
      if (isAdmin) return base44.entities.Terminal.list('-created_date');
      const [byOwner, byCreated] = await Promise.all([
        base44.entities.Terminal.filter({ usuario_email: currentUser.email }, '-created_date'),
        base44.entities.Terminal.filter({ created_by: currentUser.email }, '-created_date'),
      ]);
      const seen = new Set();
      return [...byOwner, ...byCreated].filter(t => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    },
    enabled: !!currentUser,
    refetchInterval: 30000,
  });

  // Fetch plantas
  const { data: floorPlans = [] } = useQuery({
    queryKey: ['floor-plans', currentUser?.email],
    queryFn: () => base44.entities.FloorPlan.list('nome'),
    enabled: !!currentUser,
  });

  // Todos os utilizadores (admin) — para seletor no dialog e filtro
  const { data: allUsers = [] } = useQuery({
    queryKey: ['users-for-plans'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!currentUser && isAdmin,
  });

  // Lista de utilizadores para filtro admin (baseado nos utilizadores existentes)
  const usuarios = useMemo(() => {
    if (!isAdmin) return [];
    return allUsers.map(u => u.email).filter(Boolean).sort();
  }, [allUsers, isAdmin]);

  // Plantas filtradas por utilizador (admin) ou do próprio utilizador
  const visiblePlans = useMemo(() => {
    if (!isAdmin) return floorPlans.filter(p => p.owner_email === currentUser?.email || p.created_by === currentUser?.email);
    if (userFilter === 'all') return floorPlans;
    return floorPlans.filter(p => p.owner_email === userFilter);
  }, [floorPlans, isAdmin, userFilter, currentUser]);

  // Seleciona automaticamente a primeira planta disponível
  useEffect(() => {
    if (visiblePlans.length > 0 && !selectedPlanId) {
      setSelectedPlanId(visiblePlans[0].id);
    }
    if (visiblePlans.length === 0) setSelectedPlanId(null);
  }, [visiblePlans]);

  const selectedPlan = useMemo(
    () => visiblePlans.find(p => p.id === selectedPlanId) || null,
    [visiblePlans, selectedPlanId]
  );

  // Terminais visíveis para a planta selecionada
  const planOwner = selectedPlan?.owner_email;
  const terminalsForPlan = useMemo(() => {
    if (!selectedPlan) return [];
    if (isAdmin) {
      // Admin vê os terminais do dono da planta
      return allTerminals.filter(t => (t.usuario_email || t.created_by) === planOwner);
    }
    return allTerminals;
  }, [allTerminals, selectedPlan, isAdmin, planOwner]);

  // Inicializa posições da planta selecionada
  useEffect(() => {
    if (!selectedPlan) { setPositions({}); return; }
    try {
      const saved = JSON.parse(selectedPlan.terminais_posicoes || '[]');
      const pos = {};
      saved.forEach(({ terminal_id, x, y }) => { pos[terminal_id] = { x, y }; });
      setPositions(pos);
    } catch {
      setPositions({});
    }
  }, [selectedPlan?.id, selectedPlan?.terminais_posicoes]);

  const handlePositionChange = useCallback((terminalId, x, y) => {
    setPositions(prev => ({ ...prev, [terminalId]: { x, y } }));
  }, []);

  // Salvar posições
  const saveMutation = useMutation({
    mutationFn: ({ id, positions }) => {
      const arr = Object.entries(positions).map(([terminal_id, { x, y }]) => ({ terminal_id, x, y }));
      return base44.entities.FloorPlan.update(id, { terminais_posicoes: JSON.stringify(arr) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['floor-plans']);
      setEditMode(false);
      toast.success('Posições guardadas!');
    },
    onError: () => toast.error('Erro ao guardar posições'),
  });

  const handleSave = () => {
    if (!selectedPlan) return;
    saveMutation.mutate({ id: selectedPlan.id, positions });
  };

  // Upload de imagem
  const handleImageUpload = async (e, planId) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      await base44.entities.FloorPlan.update(planId, { imagem_url: file_url });
      queryClient.invalidateQueries(['floor-plans']);
      toast.success('Planta actualizada!');
    } catch {
      toast.error('Erro ao carregar imagem');
    } finally {
      setUploading(false);
    }
  };

  // Criar nova planta
  const createMutation = useMutation({
    mutationFn: ({ nome, owner_email }) =>
      base44.entities.FloorPlan.create({
        nome,
        owner_email: owner_email || currentUser?.email,
        terminais_posicoes: '[]',
        ativo: true,
      }),
    onSuccess: (plan) => {
      queryClient.invalidateQueries(['floor-plans']);
      setSelectedPlanId(plan.id);
      setShowNewPlanDialog(false);
      setNewPlanName('');
      setNewPlanOwner('');
      toast.success('Planta criada!');
    },
    onError: () => toast.error('Erro ao criar planta'),
  });

  // Eliminar planta
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FloorPlan.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['floor-plans']);
      setSelectedPlanId(null);
      toast.success('Planta eliminada');
    },
    onError: () => toast.error('Erro ao eliminar planta'),
  });

  // Estatísticas da planta actual
  const stats = useMemo(() => {
    const positioned = terminalsForPlan.filter(t => positions[t.id]);
    const online = positioned.filter(t => t.status === 'online').length;
    const offline = positioned.filter(t => t.status === 'offline').length;
    const warning = positioned.filter(t => t.status === 'warning').length;
    return { total: positioned.length, online, offline, warning };
  }, [terminalsForPlan, positions]);

  const [selectedTerminal, setSelectedTerminal] = useState(null);

  const canEdit = selectedPlan && (
    isAdmin || selectedPlan.owner_email === currentUser?.email || selectedPlan.created_by === currentUser?.email
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 w-full overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6 space-y-4 max-w-[1920px]">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-violet-100 rounded-xl shrink-0">
              <Map className="h-6 w-6 text-violet-600" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Mapa de Terminais</h1>
              <p className="text-xs sm:text-sm text-slate-500">Planta baixa interativa com estado em tempo real</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Filtro de utilizador — apenas admin */}
            {isAdmin && (
              <Select value={userFilter} onValueChange={(v) => { setUserFilter(v); setSelectedPlanId(null); }}>
                <SelectTrigger className="w-[180px]">
                  <UserIcon className="h-4 w-4 mr-2 text-slate-400" />
                  <SelectValue placeholder="Utilizador" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os utilizadores</SelectItem>
                  {usuarios.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            {canEdit && !editMode && (
              <Button variant="outline" size="sm" onClick={() => setEditMode(true)} className="gap-2">
                <Pencil className="h-4 w-4" /> Editar Posições
              </Button>
            )}
            {editMode && (
              <>
                <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 gap-2">
                  <Save className="h-4 w-4" />
                  {saveMutation.isPending ? 'A guardar...' : 'Guardar'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditMode(false)} className="gap-2">
                  <X className="h-4 w-4" /> Cancelar
                </Button>
              </>
            )}
            <Button size="sm" onClick={() => setShowNewPlanDialog(true)} className="bg-violet-600 hover:bg-violet-700 gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nova Planta</span>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Painel lateral */}
          <div className="lg:col-span-1 space-y-3">

            {/* Seletor de plantas */}
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="h-4 w-4 text-violet-600" /> Plantas
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-1">
                {visiblePlans.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2 text-center">Nenhuma planta disponível</p>
                ) : (
                  visiblePlans.map(plan => (
                    <div
                      key={plan.id}
                      className={cn(
                        "flex items-center justify-between gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors text-sm group",
                        selectedPlanId === plan.id
                          ? "bg-violet-100 text-violet-900"
                          : "hover:bg-slate-50 text-slate-700"
                      )}
                      onClick={() => { setSelectedPlanId(plan.id); setEditMode(false); setSelectedTerminal(null); }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{plan.nome}</p>
                        {isAdmin && plan.owner_email && (
                          <p className="text-[10px] text-slate-400 truncate">{plan.owner_email}</p>
                        )}
                      </div>
                      {(isAdmin || plan.owner_email === currentUser?.email) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Eliminar "${plan.nome}"?`)) deleteMutation.mutate(plan.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 hover:text-red-600 text-slate-400 shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Upload de imagem da planta seleccionada */}
            {selectedPlan && canEdit && (
              <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
                <CardContent className="px-3 py-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-600">Imagem da Planta</p>
                  <label className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 cursor-pointer hover:bg-slate-50 transition-colors text-xs text-slate-500",
                    uploading && "opacity-50 pointer-events-none"
                  )}>
                    <Upload className="h-4 w-4 shrink-0" />
                    {uploading ? 'A carregar...' : 'Carregar imagem (PNG/JPG/SVG)'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleImageUpload(e, selectedPlan.id)}
                      disabled={uploading}
                    />
                  </label>
                  {selectedPlan.imagem_url && (
                    <img src={selectedPlan.imagem_url} alt="preview" className="w-full h-20 object-contain rounded border border-slate-100 bg-slate-50" />
                  )}
                </CardContent>
              </Card>
            )}

            {/* Estatísticas */}
            {selectedPlan && (
              <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
                <CardContent className="px-3 py-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-600">Estado dos Terminais</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Online</span>
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">{stats.online}</Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-red-700"><XCircle className="h-3.5 w-3.5" /> Offline</span>
                      <Badge className="bg-red-100 text-red-800 border-red-200">{stats.offline}</Badge>
                    </div>
                    {stats.warning > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> Atenção</span>
                        <Badge className="bg-amber-100 text-amber-800 border-amber-200">{stats.warning}</Badge>
                      </div>
                    )}
                    <div className="border-t border-slate-100 pt-1 flex items-center justify-between text-xs text-slate-500">
                      <span>Posicionados</span>
                      <span className="font-semibold">{stats.total} / {terminalsForPlan.length}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Lista de terminais na planta */}
            {selectedPlan && terminalsForPlan.length > 0 && (
              <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Terminais</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-1 max-h-64 overflow-y-auto">
                  {terminalsForPlan.map(t => {
                    const hasPos = !!positions[t.id];
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          setSelectedTerminal(prev => prev?.id === t.id ? null : t);
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition-colors",
                          selectedTerminal?.id === t.id ? "bg-violet-50 text-violet-900" : "hover:bg-slate-50"
                        )}
                      >
                        <span className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          t.status === 'online' ? "bg-emerald-500" :
                          t.status === 'warning' ? "bg-amber-500" : "bg-red-500"
                        )} />
                        <span className="flex-1 truncate font-medium">{t.nome}</span>
                        {!hasPos && <span className="text-slate-300 text-[9px]">sem pos.</span>}
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Canvas principal */}
          <div className="lg:col-span-3">
            {!selectedPlan ? (
              <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50 h-[500px]">
                <CardContent className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
                  <LayoutGrid className="h-12 w-12 opacity-30" />
                  <p className="text-sm">Selecione ou crie uma planta baixa</p>
                  <Button size="sm" onClick={() => setShowNewPlanDialog(true)} className="bg-violet-600 hover:bg-violet-700 gap-2">
                    <Plus className="h-4 w-4" /> Nova Planta
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50 overflow-hidden">
                <CardHeader className="pb-2 pt-3 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                    <Map className="h-4 w-4 text-violet-600" />
                    {selectedPlan.nome}
                    {isAdmin && selectedPlan.owner_email && (
                      <span className="text-xs font-normal text-slate-400 ml-1">— {selectedPlan.owner_email}</span>
                    )}
                  </CardTitle>
                  {editMode && (
                    <Badge className="bg-violet-100 text-violet-800 border-violet-200 text-xs animate-pulse">
                      Modo Edição
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  <div style={{ height: '560px' }} className="w-full">
                    {selectedPlan.imagem_url ? (
                      <FloorPlanCanvas
                        imageUrl={selectedPlan.imagem_url}
                        terminals={terminalsForPlan}
                        positions={positions}
                        editMode={editMode}
                        onPositionChange={handlePositionChange}
                        selectedTerminalId={selectedTerminal?.id}
                        onSelectTerminal={setSelectedTerminal}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-3 bg-slate-50">
                        <Upload className="h-10 w-10 opacity-30" />
                        <p className="text-sm">Carregue uma imagem de planta baixa no painel lateral</p>
                        {canEdit && (
                          <label className="cursor-pointer px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm rounded-lg transition-colors flex items-center gap-2">
                            <Upload className="h-4 w-4" />
                            Carregar imagem
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleImageUpload(e, selectedPlan.id)}
                            />
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
                {editMode && (
                  <div className="px-4 py-2 bg-violet-50 border-t border-violet-100 text-xs text-violet-700">
                    💡 Clique e arraste os marcadores para reposicioná-los. Terminais sem posição aparecem em baixo — arraste-os para a planta.
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Dialog nova planta */}
      <Dialog open={showNewPlanDialog} onOpenChange={(open) => { setShowNewPlanDialog(open); if (!open) { setNewPlanName(''); setNewPlanOwner(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova Planta Baixa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da Planta *</Label>
              <Input
                value={newPlanName}
                onChange={e => setNewPlanName(e.target.value)}
                placeholder="Ex: Piso 1 — Entrada Principal"
              />
            </div>
            {isAdmin && (
              <div className="space-y-2">
                <Label>Utilizador *</Label>
                <Select value={newPlanOwner} onValueChange={setNewPlanOwner}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar utilizador..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allUsers.map(u => (
                      <SelectItem key={u.id} value={u.email}>
                        {u.full_name ? `${u.full_name} (${u.email})` : u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowNewPlanDialog(false)} className="flex-1">Cancelar</Button>
              <Button
                onClick={() => createMutation.mutate({ nome: newPlanName.trim(), owner_email: newPlanOwner || currentUser?.email })}
                disabled={!newPlanName.trim() || (isAdmin && !newPlanOwner) || createMutation.isPending}
                className="flex-1 bg-violet-600 hover:bg-violet-700"
              >
                {createMutation.isPending ? 'A criar...' : 'Criar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}