import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, RefreshCw, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import FloorPlanCanvasWrapper from './FloorPlanCanvasWrapper';

export default function MapaFullscreen({
  local,
  termList = [],
  canEdit,
  savedPlan,
  onSave,
  onClose,
  onRefresh,
  isRefreshing,
}) {
  const onlineCount  = termList.filter(t => t.status === 'online').length;
  const offlineCount = termList.filter(t => t.status === 'offline').length;
  const warningCount = termList.filter(t => t.status === 'warning').length;

  return (
    <motion.div
      className="fixed inset-0 z-[200] bg-slate-950 flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          <MapPin className="h-5 w-5 text-teal-400" />
          <span className="font-bold text-white text-lg">{local}</span>
          <div className="flex items-center gap-1.5">
            {onlineCount > 0 && <Badge className="bg-emerald-900 text-emerald-300 border-emerald-700 text-xs">{onlineCount} online</Badge>}
            {offlineCount > 0 && <Badge className="bg-red-900 text-red-300 border-red-700 text-xs animate-pulse">{offlineCount} offline</Badge>}
            {warningCount > 0 && <Badge className="bg-yellow-900 text-yellow-300 border-yellow-700 text-xs">{warningCount} atenção</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isRefreshing} className="text-slate-300 hover:text-white hover:bg-slate-700">
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-300 hover:text-white hover:bg-slate-700">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Canvas fullscreen */}
      <div className="flex-1 overflow-hidden p-4">
        <FloorPlanCanvasWrapper
          local={local}
          terminals={termList}
          canEdit={canEdit}
          savedPlan={savedPlan}
          onSave={onSave}
        />
      </div>
    </motion.div>
  );
}