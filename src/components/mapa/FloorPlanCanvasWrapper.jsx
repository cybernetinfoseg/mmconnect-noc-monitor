import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Upload } from 'lucide-react';
import FloorPlanCanvas from './FloorPlanCanvas';

/**
 * Wrapper that bridges the MapaTerminais API (savedPlan, onSave) 
 * with the FloorPlanCanvas API (imageUrl, positions, onPositionChange, etc.)
 */
export default function FloorPlanCanvasWrapper({
  local,
  terminals = [],
  canEdit = false,
  savedPlan,       // { imageUrl, positions } | null
  onSave,
  selectedId,
  onSelect,
}) {
  const [editMode, setEditMode] = useState(false);
  const [positions, setPositions] = useState(savedPlan?.positions || {});
  const [imageUrl, setImageUrl] = useState(savedPlan?.image_url || savedPlan?.imageUrl || null);
  const [iconConfig, setIconConfig] = useState({});

  // Sync when savedPlan changes externally
  useEffect(() => {
    setPositions(savedPlan?.positions || {});
    setImageUrl(savedPlan?.image_url || savedPlan?.imageUrl || null);
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
    const reader = new FileReader();
    reader.onload = (ev) => setImageUrl(ev.target.result);
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-2 h-full">
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
              <Button size="sm" variant="outline" onClick={() => { setEditMode(false); setPositions(savedPlan?.positions || {}); setImageUrl(savedPlan?.image_url || savedPlan?.imageUrl || null); }}>Cancelar</Button>
            </>
          )}
          <label className="cursor-pointer">
            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors">
              <Upload className="h-3.5 w-3.5" /> Importar planta
            </span>
          </label>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 min-h-[280px] rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
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
    </div>
  );
}