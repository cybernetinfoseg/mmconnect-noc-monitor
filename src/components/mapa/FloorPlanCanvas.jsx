import React, { useRef, useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

/**
 * Canvas interativo para posicionamento de terminais sobre uma planta baixa.
 *
 * Props:
 *  - imageUrl: URL da imagem da planta
 *  - terminals: array de terminais
 *  - positions: { [terminal_id]: {x, y} } — coordenadas em % (0-100)
 *  - editMode: boolean — permite arrastar/reposicionar marcadores
 *  - onPositionChange: (terminal_id, x, y) => void
 *  - selectedTerminalId: id do terminal selecionado (highlight)
 *  - onSelectTerminal: (terminal) => void
 */
export default function FloorPlanCanvas({
  imageUrl,
  terminals = [],
  positions = {},
  editMode = false,
  onPositionChange,
  selectedTerminalId,
  onSelectTerminal,
}) {
  const containerRef = useRef(null);
  const [dragging, setDragging] = useState(null); // { terminalId, startX, startY }
  const [tooltip, setTooltip] = useState(null);   // { terminal, x, y }
  const [imgSize, setImgSize] = useState({ w: 1, h: 1 });

  // Atualiza dimensões quando a imagem carrega ou o container redimensiona
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setImgSize({ w: el.clientWidth, h: el.clientHeight });
    });
    observer.observe(el);
    setImgSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, [imageUrl]);

  const getRelativePos = useCallback((e) => {
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    return { x, y };
  }, []);

  const handleMouseDown = useCallback((e, terminalId) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(terminalId);
    setTooltip(null);
  }, [editMode]);

  const handleMouseMove = useCallback((e) => {
    if (!dragging || !editMode) return;
    e.preventDefault();
    const { x, y } = getRelativePos(e);
    onPositionChange?.(dragging, x, y);
  }, [dragging, editMode, getRelativePos, onPositionChange]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  // Click no canvas em editMode sem terminal — ignora
  const handleCanvasClick = useCallback((e) => {
    if (editMode) return;
    setTooltip(null);
  }, [editMode]);

  // Calcula posição do tooltip para manter dentro do canvas
  const computeTooltipPos = (x, y) => {
    const TW = 200; // largura estimada tooltip (px)
    const TH = 100; // altura estimada tooltip (px)
    const cW = imgSize.w;
    const cH = imgSize.h;
    const markerX = (x / 100) * cW;
    const markerY = (y / 100) * cH;

    let left = markerX + 14;
    let top = markerY - 50;

    if (left + TW > cW) left = markerX - TW - 14;
    if (left < 0) left = 4;
    if (top < 0) top = markerY + 14;
    if (top + TH > cH) top = cH - TH - 4;

    return { left, top };
  };

  const terminalsWithPos = terminals.filter(t => positions[t.id]);
  const terminalsWithoutPos = terminals.filter(t => !positions[t.id]);

  return (
    <div className="relative w-full h-full select-none overflow-hidden rounded-xl">
      {/* Container da imagem */}
      <div
        ref={containerRef}
        className="relative w-full h-full bg-slate-100 overflow-hidden rounded-xl"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
        onClick={handleCanvasClick}
        style={{ cursor: dragging ? 'grabbing' : 'default' }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Planta baixa"
            className="w-full h-full object-contain pointer-events-none"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
            Sem planta baixa
          </div>
        )}

        {/* Marcadores de terminais posicionados */}
        {terminalsWithPos.map(terminal => {
          const pos = positions[terminal.id];
          const isOnline = terminal.status === 'online';
          const isSelected = selectedTerminalId === terminal.id;
          const isWarning = terminal.status === 'warning';

          return (
            <div
              key={terminal.id}
              className="absolute"
              style={{
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                transform: 'translate(-50%, -50%)',
                zIndex: isSelected ? 30 : 20,
                cursor: editMode ? 'grab' : 'pointer',
              }}
              onMouseDown={(e) => handleMouseDown(e, terminal.id)}
              onTouchStart={(e) => handleMouseDown(e, terminal.id)}
              onClick={(e) => {
                e.stopPropagation();
                if (!editMode) {
                  if (selectedTerminalId === terminal.id) {
                    onSelectTerminal?.(null);
                    setTooltip(null);
                  } else {
                    onSelectTerminal?.(terminal);
                    setTooltip({ terminal, ...computeTooltipPos(pos.x, pos.y) });
                  }
                }
              }}
            >
              {/* Anel de pulso para offline */}
              {!isOnline && !isWarning && (
                <span className="absolute inset-0 rounded-full animate-ping bg-red-400 opacity-50 scale-150" />
              )}
              {/* Marcador */}
              <div
                className={cn(
                  "w-7 h-7 rounded-full border-2 flex items-center justify-center shadow-lg transition-transform",
                  isOnline
                    ? "bg-emerald-500 border-emerald-300"
                    : isWarning
                    ? "bg-amber-500 border-amber-300"
                    : "bg-red-500 border-red-300",
                  isSelected && "scale-125 ring-2 ring-white ring-offset-1",
                  editMode && "cursor-grab active:cursor-grabbing"
                )}
              >
                <span className="text-white text-[10px] font-bold leading-none">
                  {isOnline ? '✓' : isWarning ? '!' : '✗'}
                </span>
              </div>
              {/* Label abaixo do marcador */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 whitespace-nowrap">
                <span className={cn(
                  "text-[9px] font-semibold px-1 py-0.5 rounded shadow-sm",
                  isOnline
                    ? "bg-emerald-600 text-white"
                    : isWarning
                    ? "bg-amber-500 text-white"
                    : "bg-red-600 text-white"
                )}>
                  {terminal.nome}
                </span>
              </div>
            </div>
          );
        })}

        {/* Tooltip fixo dentro do canvas */}
        {tooltip && !editMode && (
          <div
            className="absolute z-40 bg-white border border-slate-200 rounded-lg shadow-xl p-3 w-48 pointer-events-none"
            style={{ left: tooltip.left, top: tooltip.top }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={cn(
                "w-2.5 h-2.5 rounded-full shrink-0",
                tooltip.terminal.status === 'online' ? "bg-emerald-500" :
                tooltip.terminal.status === 'warning' ? "bg-amber-500" : "bg-red-500"
              )} />
              <p className="font-semibold text-slate-900 text-sm truncate">{tooltip.terminal.nome}</p>
            </div>
            {tooltip.terminal.local && (
              <p className="text-xs text-slate-500 mb-0.5">📍 {tooltip.terminal.local}</p>
            )}
            {tooltip.terminal.cliente_nome && (
              <p className="text-xs text-slate-500 mb-0.5">🏢 {tooltip.terminal.cliente_nome}</p>
            )}
            <p className={cn(
              "text-xs font-semibold mt-1",
              tooltip.terminal.status === 'online' ? "text-emerald-600" :
              tooltip.terminal.status === 'warning' ? "text-amber-600" : "text-red-600"
            )}>
              {tooltip.terminal.status === 'online' ? '● Online' :
               tooltip.terminal.status === 'warning' ? '● Atenção' : '● Offline'}
              {tooltip.terminal.latencia_ms ? ` — ${tooltip.terminal.latencia_ms}ms` : ''}
            </p>
          </div>
        )}
      </div>

      {/* Lista de terminais sem posição (editMode) */}
      {editMode && terminalsWithoutPos.length > 0 && (
        <div className="absolute bottom-2 left-2 right-2 bg-white/90 backdrop-blur-sm border border-slate-200 rounded-lg p-2 z-50">
          <p className="text-xs font-semibold text-slate-600 mb-1.5">
            Terminais não posicionados — arraste para a planta:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {terminalsWithoutPos.map(t => (
              <UnpositionedMarker
                key={t.id}
                terminal={t}
                containerRef={containerRef}
                onDrop={(x, y) => onPositionChange?.(t.id, x, y)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Marcador arrastável da lista de não-posicionados
function UnpositionedMarker({ terminal, containerRef, onDrop }) {
  const isOnline = terminal.status === 'online';

  const handleDragStart = (e) => {
    e.dataTransfer.setData('terminal_id', terminal.id);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={(e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
        const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
        if (x > 0 && y > 0 && x < 100 && y < 100) onDrop(x, y);
      }}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium cursor-grab active:cursor-grabbing border text-white",
        isOnline ? "bg-emerald-500 border-emerald-300" : "bg-red-500 border-red-300"
      )}
    >
      <span>{isOnline ? '✓' : '✗'}</span>
      {terminal.nome}
    </div>
  );
}