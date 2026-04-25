import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Upload, Loader2, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import FloorPlanCanvas from './FloorPlanCanvas';

export default function FloorPlanCanvasWrapper({
  local,
  terminals = [],
  canEdit = false,
  savedPlan,
  onSave,
  selectedId,
  onSelect,
}) {
  const [editMode, setEditMode] = useState(false);
  const [positions, setPositions] = useState(savedPlan?.positions || {});
  const [imageUrl, setImageUrl] = useState(savedPlan?.image_url || savedPlan?.imageUrl || null);
  const [iconConfig, setIconConfig] = useState({});
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setPositions(savedPlan?.positions || {});
    setImageUrl(savedPlan?.image_url || savedPlan?.imageUrl || null);
    setEditMode(false);
  }, [savedPlan]);

  const handlePositionChange = useCallback((terminalId, x, y) => {
    setPositions(prev => ({ ...prev, [terminalId]: { x, y } }));
  }, []);

  const handleSave = useCallback(() => {
    onSave?.({ imageUrl, positions });
    setEditMode(false);
  }, [imageUrl, positions, onSave]);

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImageUrl(ev.target.result);
      setUploading(false);
    };
    reader.onerror = () => setUploading(false);
    reader.readAsDataURL(file);
    // reset so same file can be selected again
    e.target.value = '';
  };

  const handleCancel = () => {
    setEditMode(false);
    setPositions(savedPlan?.positions || {});
    setImageUrl(savedPlan?.image_url || savedPlan?.imageUrl || null);
  };

  const hasImage = !!imageUrl;

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap">
          {!editMode ? (
            <Button size="sm" variant="outline" onClick={() => setEditMode(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Editar posições
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={handleSave} className="bg-teal-600 hover:bg-teal-700 gap-1.5">Guardar</Button>
              <Button size="sm" variant="outline" onClick={handleCancel}>Cancelar</Button>
            </>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-sm font-medium shadow-sm hover:bg-accent transition-colors",
              uploading && "opacity-60 cursor-wait"
            )}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? 'A carregar...' : hasImage ? 'Substituir planta' : 'Importar planta'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
        </div>
      )}

      {/* Canvas or no-image state */}
      {!hasImage ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center py-8 gap-3">
          <ImageOff className="h-8 w-8 text-slate-300" />
          <p className="text-sm text-slate-400 text-center">Sem planta baixa importada</p>
          {canEdit && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-teal-600 hover:underline font-medium"
            >
              Clique aqui para importar uma planta
            </button>
          )}
          {/* Terminais em lista quando não há planta */}
          {terminals.length > 0 && (
            <div className="w-full px-4 mt-2">
              <p className="text-xs font-semibold text-slate-500 mb-2">Terminais neste local:</p>
              <div className="flex flex-wrap gap-1.5">
                {terminals.map(t => (
                  <span
                    key={t.id}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border text-white",
                      t.status === 'online'  ? 'bg-emerald-500 border-emerald-300' :
                      t.status === 'warning' ? 'bg-amber-500 border-amber-300' :
                                               'bg-red-500 border-red-300'
                    )}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
                    {t.nome}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-[320px] h-[380px] rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
          <FloorPlanCanvas
            imageUrl={imageUrl}
            terminals={terminals}
            positions={positions}
            editMode={editMode}
            onPositionChange={handlePositionChange}
            selectedTerminalId={selectedId}
            onSelectTerminal={onSelect}
            iconConfig={iconConfig}
            onIconConfigChange={setIconConfig}
          />
        </div>
      )}
    </div>
  );
}