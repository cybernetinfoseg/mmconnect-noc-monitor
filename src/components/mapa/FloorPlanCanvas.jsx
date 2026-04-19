import React, { useRef, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Upload, Trash2, Move, Save, Loader2,
  Fingerprint, Scan, Shield, Cpu, MonitorSmartphone,
  Wifi, DoorOpen, UserCheck, Camera, ZoomIn, ZoomOut, RotateCcw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Cores de status ─── */
const STATUS_COLORS = {
  online:  { dot: '#10b981', ring: '#6ee7b7' },
  offline: { dot: '#ef4444', ring: '#fca5a5' },
  warning: { dot: '#f59e0b', ring: '#fcd34d' },
  default: { dot: '#94a3b8', ring: '#cbd5e1' },
};
const getColor = (s) => STATUS_COLORS[s] || STATUS_COLORS.default;

/* ─── Ícones disponíveis ─── */
const TERMINAL_ICONS = [
  { id: 'initials',    label: 'Iniciais',   Icon: null },
  { id: 'fingerprint', label: 'Biométrico', Icon: Fingerprint },
  { id: 'scan',        label: 'Scan',       Icon: Scan },
  { id: 'shield',      label: 'Segurança',  Icon: Shield },
  { id: 'cpu',         label: 'CPU',        Icon: Cpu },
  { id: 'monitor',     label: 'Monitor',    Icon: MonitorSmartphone },
  { id: 'wifi',        label: 'Wireless',   Icon: Wifi },
  { id: 'door',        label: 'Porta',      Icon: DoorOpen },
  { id: 'user',        label: 'Utilizador', Icon: UserCheck },
  { id: 'camera',      label: 'Câmara',     Icon: Camera },
];
const getIconEntry = (id) => TERMINAL_ICONS.find(i => i.id === id) || TERMINAL_ICONS[0];

/* ─── Constantes de zoom ─── */
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 3;
const ZOOM_STEP = 0.25;

/* ─── Picker de ícone flutuante (fora do canvas escalado) ─── */
function FloatingIconPicker({ terminalId, currentIcon, anchorEl, wrapperEl, zoom, onSelect, onClose }) {
  const ref = useRef(null);
  const [style, setStyle] = useState({ opacity: 0 });
  const PICKER_W = 224;

  useEffect(() => {
    if (!anchorEl || !wrapperEl || !ref.current) return;
    const wRect = wrapperEl.getBoundingClientRect();
    const aRect = anchorEl.getBoundingClientRect();
    const pRect = ref.current.getBoundingClientRect();

    const anchorCX = aRect.left - wRect.left + aRect.width / 2;
    const anchorTY = aRect.top  - wRect.top;
    const anchorBY = aRect.bottom - wRect.top;

    // Preferir acima; se não cabe → abaixo
    let top = anchorTY - pRect.height - 8;
    if (top < 4) top = anchorBY + 8;
    if (top + pRect.height > wRect.height - 4) top = Math.max(4, wRect.height - pRect.height - 4);

    let left = anchorCX - PICKER_W / 2;
    if (left < 4) left = 4;
    if (left + PICKER_W > wRect.width - 4) left = wRect.width - PICKER_W - 4;

    setStyle({ opacity: 1, top, left });
  }, [anchorEl, wrapperEl, zoom]);

  return (
    <div
      ref={ref}
      className="bg-white border border-slate-200 rounded-xl shadow-2xl p-2"
      style={{ position: 'absolute', zIndex: 9998, width: PICKER_W, transition: 'opacity .1s', ...style }}
      onMouseDown={e => e.stopPropagation()}
    >
      <p className="text-[10px] text-slate-400 font-medium uppercase mb-2 px-1">Escolher ícone</p>
      <div className="grid grid-cols-5 gap-1">
        {TERMINAL_ICONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            title={label}
            onClick={() => { onSelect(terminalId, id); onClose(); }}
            className={`flex flex-col items-center justify-center gap-0.5 p-1.5 rounded-lg transition-colors text-[9px] font-medium
              ${currentIcon === id ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100 text-slate-600'}`}
          >
            {Icon ? <Icon className="h-4 w-4" /> : <span className="text-[11px] font-bold">AB</span>}
            <span className="leading-tight">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Tooltip flutuante renderizado no portal do wrapperRef ─── */
function FloatingTooltip({ terminal, anchorEl, wrapperEl, zoom }) {
  const [style, setStyle] = useState({ opacity: 0 });
  const tipRef = useRef(null);
  const c = getColor(terminal.status);

  useEffect(() => {
    if (!anchorEl || !wrapperEl || !tipRef.current) return;

    const wRect = wrapperEl.getBoundingClientRect();
    const aRect = anchorEl.getBoundingClientRect();
    const tRect = tipRef.current.getBoundingClientRect();

    // Posição do centro do marcador relativa ao wrapper
    const anchorCX = aRect.left - wRect.left + aRect.width  / 2;
    const anchorTY = aRect.top  - wRect.top;
    const anchorBY = aRect.bottom - wRect.top;

    // Tentativa: acima do marcador
    let top = anchorTY - tRect.height - 8;
    // Se sair pelo topo → abaixo
    if (top < 4) top = anchorBY + 8;
    // Clamp vertical inferior
    if (top + tRect.height > wRect.height - 4) top = wRect.height - tRect.height - 4;

    // Horizontal centrado, clampado
    let left = anchorCX - tRect.width / 2;
    if (left < 4) left = 4;
    if (left + tRect.width > wRect.width - 4) left = wRect.width - tRect.width - 4;

    setStyle({ opacity: 1, top, left });
  }, [anchorEl, wrapperEl, zoom]);

  return (
    <div
      ref={tipRef}
      className="pointer-events-none bg-white rounded-xl shadow-2xl border border-slate-200 p-3 text-xs"
      style={{ position: 'absolute', zIndex: 9999, minWidth: 160, transition: 'opacity .1s', ...style }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
        <span className="font-bold text-slate-800">{terminal.nome}</span>
      </div>
      {terminal.local     && <p className="text-slate-500 truncate">{terminal.local}</p>}
      {terminal.latencia_ms && <p className="text-slate-400">Latência: {terminal.latencia_ms}ms</p>}
      <div className="mt-1.5 text-center font-semibold rounded px-1 py-0.5"
        style={{ backgroundColor: c.dot + '22', color: c.dot }}>
        {terminal.status?.toUpperCase() || '—'}
      </div>
    </div>
  );
}

/* ─── Componente principal ─── */
export default function FloorPlanCanvas({ local, terminals, canEdit, savedPlan, onSave, selectedId, onSelect }) {
  const [imageUrl, setImageUrl]     = useState(savedPlan?.imageUrl || null);
  const [positions, setPositions]   = useState(savedPlan?.positions || {});
  const [dragging, setDragging]     = useState(null);
  const [editMode, setEditMode]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [hover, setHover]           = useState(null);       // terminal.id | null
  const [iconPicker, setIconPicker] = useState(null);       // terminal.id | null
  const [zoom, setZoom]             = useState(1);

  const fileRef       = useRef(null);
  const wrapperRef    = useRef(null);  // contentor com overflow:hidden — tooltip renderiza aqui
  const canvasRef     = useRef(null);  // div escalada com transform:scale
  const markerRefs    = useRef({});    // { [terminalId]: DOM el }

  /* Sincronizar savedPlan */
  useEffect(() => {
    if (savedPlan) {
      setImageUrl(savedPlan.imageUrl || null);
      setPositions(savedPlan.positions || {});
    }
  }, [savedPlan?.imageUrl]);

  /* Fechar icon picker ao clicar fora */
  useEffect(() => {
    if (!iconPicker) return;
    const h = () => setIconPicker(null);
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [iconPicker]);

  /* ─── Posições ─── */
  function defaultPos(idx, total) {
    const cols = Math.max(4, Math.ceil(Math.sqrt(total)));
    return { x: 10 + (idx % cols) * 14, y: 15 + Math.floor(idx / cols) * 20 };
  }
  const getPos          = (t, i) => positions[t.id] || defaultPos(i, terminals.length);
  const getTerminalIcon = (t)    => positions[t.id]?.icon || 'initials';
  const setTerminalIcon = (id, iconId) =>
    setPositions(p => ({ ...p, [id]: { ...(p[id] || {}), icon: iconId } }));

  /* ─── Upload ─── */
  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Imagem deve ter menos de 5MB'); return; }
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setImageUrl(file_url);
      toast.success('Planta carregada!');
    } catch { toast.error('Erro ao carregar a planta'); }
    finally { setUploading(false); e.target.value = ''; }
  }
  const removePlan = () => { setImageUrl(null); setPositions({}); };

  /* ─── Drag (coordenadas em % do canvas ANTES do scale) ─── */
  function onMouseDown(e, terminalId) {
    if (!editMode || iconPicker === terminalId) return;
    e.preventDefault(); e.stopPropagation();
    const rect = canvasRef.current.getBoundingClientRect();
    // Converter para coordenadas do canvas sem zoom
    const cx = ((e.clientX - rect.left) / zoom / (rect.width  / zoom)) * 100;
    const cy = ((e.clientY - rect.top)  / zoom / (rect.height / zoom)) * 100;
    const pos = positions[terminalId] || defaultPos(terminals.findIndex(t => t.id === terminalId), terminals.length);
    setDragging({ id: terminalId, offsetX: cx - pos.x, offsetY: cy - pos.y, moved: false });
  }

  const onMouseMove = useCallback((e) => {
    if (!dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.min(97, Math.max(2, ((e.clientX - rect.left) / zoom / (rect.width  / zoom)) * 100 - dragging.offsetX));
    const y = Math.min(95, Math.max(2, ((e.clientY - rect.top)  / zoom / (rect.height / zoom)) * 100 - dragging.offsetY));
    setPositions(p => ({ ...p, [dragging.id]: { ...(p[dragging.id] || {}), x, y } }));
    setDragging(d => d ? { ...d, moved: true } : d);
  }, [dragging, zoom]);

  const onMouseUp = useCallback(() => {
    if (dragging && !dragging.moved) {
      setIconPicker(id => id === dragging.id ? null : dragging.id);
    }
    setDragging(null);
  }, [dragging]);

  useEffect(() => {
    if (!editMode) return;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [editMode, onMouseMove, onMouseUp]);

  /* Touch */
  function onTouchStart(e, terminalId) {
    if (!editMode) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect  = canvasRef.current.getBoundingClientRect();
    const cx = ((touch.clientX - rect.left) / zoom / (rect.width  / zoom)) * 100;
    const cy = ((touch.clientY - rect.top)  / zoom / (rect.height / zoom)) * 100;
    const pos = positions[terminalId] || defaultPos(terminals.findIndex(t => t.id === terminalId), terminals.length);
    setDragging({ id: terminalId, offsetX: cx - pos.x, offsetY: cy - pos.y, moved: false });
  }
  function onTouchMove(e) {
    if (!dragging || !canvasRef.current) return;
    const touch = e.touches[0];
    const rect  = canvasRef.current.getBoundingClientRect();
    const x = Math.min(97, Math.max(2, ((touch.clientX - rect.left) / zoom / (rect.width  / zoom)) * 100 - dragging.offsetX));
    const y = Math.min(95, Math.max(2, ((touch.clientY - rect.top)  / zoom / (rect.height / zoom)) * 100 - dragging.offsetY));
    setPositions(p => ({ ...p, [dragging.id]: { ...(p[dragging.id] || {}), x, y } }));
  }

  /* ─── Save ─── */
  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ imageUrl, positions });
      toast.success('Planta guardada!');
      setEditMode(false); setIconPicker(null);
    } catch { toast.error('Erro ao guardar'); }
    finally { setSaving(false); }
  }

  /* ─── Zoom ─── */
  const changeZoom = (d) =>
    setZoom(z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + d) * 100) / 100)));

  const hasImage = !!imageUrl;
  // Altura base do canvas (antes do zoom)
  const BASE_H = hasImage ? 400 : Math.max(160, Math.ceil(terminals.length / 6) * 100 + 60);

  return (
    <div className="space-y-2">
      {/* Toolbar edição */}
      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={editMode ? 'default' : 'outline'} size="sm"
            onClick={() => { setEditMode(v => !v); setIconPicker(null); }}
            className={editMode ? 'bg-blue-600 hover:bg-blue-700' : ''}
          >
            <Move className="h-3.5 w-3.5 mr-1" />
            {editMode ? 'A editar...' : 'Editar posições'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
            {hasImage ? 'Substituir planta' : 'Importar planta'}
          </Button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          {hasImage && (
            <Button variant="outline" size="sm" onClick={removePlan} className="text-red-600 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Remover planta
            </Button>
          )}
          {editMode && (
            <Button size="sm" onClick={handleSave} disabled={saving} className="ml-auto bg-emerald-600 hover:bg-emerald-700">
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Guardar
            </Button>
          )}
        </div>
      )}

      {/* Controles de zoom */}
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => changeZoom(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-slate-500 w-10 text-center select-none">{Math.round(zoom * 100)}%</span>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        {zoom !== 1 && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(1)} title="Repor zoom">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/*
        wrapperRef: contentor com tamanho FIXO (não muda com o zoom).
        Tem overflow:hidden + position:relative.
        O tooltip e o canvas escalado ficam ambos dentro deste elemento.
        O canvas escala com transform:scale, transformOrigin top-left.
        O wrapper cresce em altura conforme o zoom para não cortar o conteúdo.
      */}
      <div
        ref={wrapperRef}
        className="relative w-full rounded-xl overflow-hidden border border-slate-200"
        style={{ height: BASE_H * zoom }}
      >
        {/* Canvas escalado */}
        <div
          ref={canvasRef}
          className="absolute top-0 left-0 select-none"
          style={{
            width:           '100%',
            height:          BASE_H,
            transformOrigin: 'top left',
            transform:       `scale(${zoom})`,
            background: hasImage
              ? 'transparent'
              : 'repeating-linear-gradient(0deg,transparent,transparent 39px,#e2e8f0 39px,#e2e8f0 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,#e2e8f0 39px,#e2e8f0 40px)',
            backgroundColor: '#f8fafc',
            cursor: editMode ? 'crosshair' : 'default',
          }}
          onTouchMove={onTouchMove}
          onTouchEnd={() => setDragging(null)}
        >
          {hasImage && (
            <img
              src={imageUrl}
              alt="Planta baixa"
              className="w-full object-contain"
              style={{ height: BASE_H, display: 'block' }}
              draggable={false}
            />
          )}

          {!hasImage && (
            <span className="absolute top-2 left-3 text-[10px] text-slate-400 font-medium uppercase tracking-wider">
              Planta — {local}
            </span>
          )}

          {/* Marcadores */}
          {terminals.map((terminal, idx) => {
            const pos            = getPos(terminal, idx);
            const c              = getColor(terminal.status);
            const isDraggingThis = dragging?.id === terminal.id;
            const iconId         = getTerminalIcon(terminal);
            const IconComp       = getIconEntry(iconId).Icon;
            const showPicker     = editMode && iconPicker === terminal.id;

            return (
              <div
                key={terminal.id}
                ref={el => { markerRefs.current[terminal.id] = el; }}
                className="absolute"
                style={{
                  left:        `${pos.x}%`,
                  top:         `${pos.y}%`,
                  transform:   'translate(-50%, -50%)',
                  zIndex:      isDraggingThis ? 200 : showPicker ? 150 : 10,
                  cursor:      editMode ? 'grab' : 'pointer',
                  touchAction: editMode ? 'none' : 'auto',
                }}
                onMouseDown={(e) => onMouseDown(e, terminal.id)}
                onTouchStart={(e) => onTouchStart(e, terminal.id)}
                onMouseEnter={() => !editMode && setHover(terminal.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => !editMode && onSelect(terminal)}
              >
                {/* Ping offline */}
                {terminal.status === 'offline' && (
                  <span className="absolute inset-0 rounded-full animate-ping opacity-60" style={{ backgroundColor: c.ring }} />
                )}

                {/* Marcador circular */}
                <div
                  className="relative flex items-center justify-center rounded-full border-2 border-white shadow-lg"
                  style={{
                    width: 32, height: 32,
                    backgroundColor: c.dot,
                    boxShadow: `0 0 0 3px ${c.ring}`,
                    transform: isDraggingThis ? 'scale(1.3)' : 'scale(1)',
                    transition: 'transform .15s',
                  }}
                >
                  {IconComp
                    ? <IconComp className="text-white h-4 w-4" />
                    : <span className="text-white text-[10px] font-bold leading-none select-none">{terminal.nome?.slice(0, 2).toUpperCase()}</span>
                  }
                </div>

                {/* Label */}
                <div className="mt-1 text-center" style={{ width: 60, marginLeft: -14 }}>
                  <span className="text-[9px] font-semibold text-slate-700 bg-white/80 px-1 rounded leading-tight block truncate">
                    {terminal.nome}
                  </span>
                </div>
              </div>
            );
          })}

          {editMode && (
            <div className="absolute bottom-2 right-2 bg-blue-600/90 text-white text-[10px] px-2 py-1 rounded-lg pointer-events-none">
              Arraste para mover · Clique para mudar ícone
            </div>
          )}
        </div>

        {/* Tooltips — fora do canvas escalado */}
        {!editMode && terminals.map(terminal => (
          hover === terminal.id && (
            <FloatingTooltip
              key={terminal.id}
              terminal={terminal}
              anchorEl={markerRefs.current[terminal.id]}
              wrapperEl={wrapperRef.current}
              zoom={zoom}
            />
          )
        ))}

        {/* Icon picker — fora do canvas escalado */}
        {editMode && terminals.map(terminal => (
          iconPicker === terminal.id && (
            <FloatingIconPicker
              key={terminal.id}
              terminalId={terminal.id}
              currentIcon={getTerminalIcon(terminal)}
              anchorEl={markerRefs.current[terminal.id]}
              wrapperEl={wrapperRef.current}
              zoom={zoom}
              onSelect={setTerminalIcon}
              onClose={() => setIconPicker(null)}
            />
          )
        ))}
      </div>
    </div>
  );
}