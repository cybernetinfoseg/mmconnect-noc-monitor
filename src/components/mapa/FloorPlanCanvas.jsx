import React, { useRef, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Upload, Trash2, Move, Save, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

const STATUS_COLORS = {
  online:  { dot: '#10b981', ring: '#6ee7b7' },
  offline: { dot: '#ef4444', ring: '#fca5a5' },
  warning: { dot: '#f59e0b', ring: '#fcd34d' },
  default: { dot: '#94a3b8', ring: '#cbd5e1' },
};

function getColor(status) {
  return STATUS_COLORS[status] || STATUS_COLORS.default;
}

// Tooltip flutuante sobre o marcador
function MarkerTooltip({ terminal }) {
  const c = getColor(terminal.status);
  return (
    <div className="absolute z-50 pointer-events-none"
      style={{ bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', minWidth: 160 }}>
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-3 text-xs">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
          <span className="font-bold text-slate-800 truncate">{terminal.nome}</span>
        </div>
        {terminal.local && <p className="text-slate-500 truncate">{terminal.local}</p>}
        {terminal.latencia_ms && <p className="text-slate-400">Latência: {terminal.latencia_ms}ms</p>}
        <div className="mt-1.5 text-center font-semibold rounded px-1 py-0.5"
          style={{ backgroundColor: c.dot + '22', color: c.dot }}>
          {terminal.status?.toUpperCase() || '—'}
        </div>
      </div>
      <div className="w-2 h-2 bg-white border-b border-r border-slate-200 rotate-45 mx-auto -mt-1" />
    </div>
  );
}

/**
 * FloorPlanCanvas
 * Props:
 *   local         — string (nome do local)
 *   terminals     — array de terminais filtrados para este local
 *   isAdmin       — bool
 *   savedPlan     — { imageUrl, positions } | null
 *   onSave        — (plan) => void
 *   selectedId    — string | null
 *   onSelect      — (terminal | null) => void
 */
export default function FloorPlanCanvas({ local, terminals, canEdit, savedPlan, onSave, selectedId, onSelect }) {
  const [imageUrl, setImageUrl]     = useState(savedPlan?.imageUrl || null);
  const [positions, setPositions]   = useState(savedPlan?.positions || {}); // { terminalId: {x, y} }
  const [dragging, setDragging]     = useState(null); // { id, offsetX, offsetY }
  const [editMode, setEditMode]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [hover, setHover]           = useState(null);
  const containerRef = useRef(null);
  const fileRef      = useRef(null);

  // Sincronizar com savedPlan externo
  useEffect(() => {
    if (savedPlan) {
      setImageUrl(savedPlan.imageUrl || null);
      setPositions(savedPlan.positions || {});
    }
  }, [savedPlan?.imageUrl]);

  // Posição padrão em grelha para terminais sem posição
  function defaultPos(idx, total) {
    const cols = Math.max(4, Math.ceil(Math.sqrt(total)));
    const col  = idx % cols;
    const row  = Math.floor(idx / cols);
    return { x: 10 + col * 14, y: 15 + row * 20 };
  }

  function getPos(terminal, idx) {
    return positions[terminal.id] || defaultPos(idx, terminals.length);
  }

  // Upload da planta
  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Imagem deve ter menos de 5MB'); return; }
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setImageUrl(file_url);
      toast.success('Planta carregada!');
    } catch {
      toast.error('Erro ao carregar a planta');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function removePlan() {
    setImageUrl(null);
    setPositions({});
  }

  // Drag handlers (% coordinates relative to container)
  function onMouseDown(e, terminalId) {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width)  * 100;
    const cy = ((e.clientY - rect.top)  / rect.height) * 100;
    const pos = positions[terminalId] || defaultPos(terminals.findIndex(t => t.id === terminalId), terminals.length);
    setDragging({ id: terminalId, offsetX: cx - pos.x, offsetY: cy - pos.y });
  }

  const onMouseMove = useCallback((e) => {
    if (!dragging) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.min(97, Math.max(2, ((e.clientX - rect.left) / rect.width)  * 100 - dragging.offsetX));
    const y = Math.min(95, Math.max(2, ((e.clientY - rect.top)  / rect.height) * 100 - dragging.offsetY));
    setPositions(p => ({ ...p, [dragging.id]: { x, y } }));
  }, [dragging]);

  const onMouseUp = useCallback(() => setDragging(null), []);

  useEffect(() => {
    if (editMode) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [editMode, onMouseMove, onMouseUp]);

  // Touch support
  function onTouchStart(e, terminalId) {
    if (!editMode) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const cx = ((touch.clientX - rect.left) / rect.width)  * 100;
    const cy = ((touch.clientY - rect.top)  / rect.height) * 100;
    const pos = positions[terminalId] || defaultPos(terminals.findIndex(t => t.id === terminalId), terminals.length);
    setDragging({ id: terminalId, offsetX: cx - pos.x, offsetY: cy - pos.y });
  }

  function onTouchMove(e) {
    if (!dragging) return;
    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.min(97, Math.max(2, ((touch.clientX - rect.left) / rect.width)  * 100 - dragging.offsetX));
    const y = Math.min(95, Math.max(2, ((touch.clientY - rect.top)  / rect.height) * 100 - dragging.offsetY));
    setPositions(p => ({ ...p, [dragging.id]: { x, y } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ imageUrl, positions });
      toast.success('Planta guardada!');
      setEditMode(false);
    } catch {
      toast.error('Erro ao guardar');
    } finally {
      setSaving(false);
    }
  }

  const hasImage = !!imageUrl;

  return (
    <div className="space-y-2">
      {/* Toolbar (apenas quem pode editar) */}
      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={editMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => setEditMode(v => !v)}
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

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative w-full rounded-xl overflow-hidden select-none"
        style={{
          minHeight: hasImage ? 360 : Math.max(140, Math.ceil(terminals.length / 6) * 100 + 40),
          background: hasImage
            ? 'transparent'
            : 'repeating-linear-gradient(0deg,transparent,transparent 39px,#e2e8f0 39px,#e2e8f0 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,#e2e8f0 39px,#e2e8f0 40px)',
          backgroundColor: '#f8fafc',
          cursor: editMode ? 'crosshair' : 'default',
        }}
        onTouchMove={onTouchMove}
        onTouchEnd={() => setDragging(null)}
      >
        {/* Background image */}
        {hasImage && (
          <img
            src={imageUrl}
            alt="Planta baixa"
            className="w-full h-full object-contain"
            style={{ minHeight: 360, maxHeight: 600 }}
            draggable={false}
          />
        )}

        {/* Label */}
        {!hasImage && (
          <span className="absolute top-2 left-3 text-[10px] text-slate-400 font-medium uppercase tracking-wider">
            Planta — {local}
          </span>
        )}

        {/* No image hint for editable users */}
        {!hasImage && canEdit && (
          <button
            onClick={() => fileRef.current?.click()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300 hover:text-slate-400 transition-colors"
          >
            <ImageIcon className="h-10 w-10" />
            <span className="text-xs">Clique para importar planta baixa</span>
          </button>
        )}

        {/* Terminal markers */}
        {terminals.map((terminal, idx) => {
          const pos   = getPos(terminal, idx);
          const c     = getColor(terminal.status);
          const isDraggingThis = dragging?.id === terminal.id;
          const isSelected = selectedId === terminal.id;
          const isHovered  = hover === terminal.id;

          return (
            <div
              key={terminal.id}
              className="absolute"
              style={{
                left:      `${pos.x}%`,
                top:       `${pos.y}%`,
                transform: 'translate(-50%, -50%)',
                zIndex:    isDraggingThis ? 200 : isSelected ? 100 : isHovered ? 50 : 10,
                cursor:    editMode ? 'grab' : 'pointer',
                touchAction: editMode ? 'none' : 'auto',
              }}
              onMouseDown={(e) => onMouseDown(e, terminal.id)}
              onTouchStart={(e) => onTouchStart(e, terminal.id)}
              onMouseEnter={() => !editMode && setHover(terminal.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => !editMode && onSelect(isSelected ? null : terminal)}
            >
              {/* Tooltip */}
              <AnimatePresence>
                {(isSelected || isHovered) && !editMode && (
                  <motion.div
                    key="tip"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                  >
                    <MarkerTooltip terminal={terminal} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Ping animation for offline */}
              {terminal.status === 'offline' && (
                <span
                  className="absolute inset-0 rounded-full animate-ping opacity-60"
                  style={{ backgroundColor: c.ring }}
                />
              )}

              {/* Dot marker */}
              <div
                className="relative flex items-center justify-center rounded-full border-2 border-white shadow-lg transition-transform duration-150"
                style={{
                  width:           isSelected ? 40 : 32,
                  height:          isSelected ? 40 : 32,
                  backgroundColor: c.dot,
                  boxShadow:       `0 0 0 3px ${c.ring}`,
                  transform:       isDraggingThis ? 'scale(1.3)' : isSelected ? 'scale(1.2)' : 'scale(1)',
                }}
              >
                <span className="text-white text-[10px] font-bold leading-none select-none">
                  {terminal.nome?.slice(0, 2).toUpperCase()}
                </span>
              </div>

              {/* Label below marker */}
              <div className="mt-1 text-center" style={{ width: 60, marginLeft: -14 }}>
                <span className="text-[9px] font-semibold text-slate-700 bg-white/80 px-1 rounded leading-tight block truncate">
                  {terminal.nome}
                </span>
              </div>
            </div>
          );
        })}

        {/* Edit overlay hint */}
        {editMode && (
          <div className="absolute bottom-2 right-2 bg-blue-600/90 text-white text-[10px] px-2 py-1 rounded-lg">
            Arraste os marcadores para reposicioná-los
          </div>
        )}
      </div>
    </div>
  );
}