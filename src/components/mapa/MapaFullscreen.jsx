import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin, Minimize2, RefreshCw, Wifi, WifiOff, AlertTriangle,
  CheckCircle, Activity, Monitor
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import FloorPlanCanvas from './FloorPlanCanvas';
import LiveClock from '@/components/dashboard/LiveClock';

export default function MapaFullscreen({ local, termList, canEdit, savedPlan, onSave, onClose, onRefresh, isRefreshing }) {
  const [selectedTerminal, setSelectedTerminal] = useState(null);

  // Fechar com ESC
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Auto-refresh a cada 15s
  useEffect(() => {
    const interval = setInterval(() => { onRefresh?.(); }, 15000);
    return () => clearInterval(interval);
  }, [onRefresh]);

  const online  = termList.filter(t => t.status === 'online').length;
  const offline = termList.filter(t => t.status === 'offline').length;
  const warning = termList.filter(t => t.status === 'warning').length;
  const hasAlerts = offline > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] bg-slate-950 flex flex-col text-white"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* ── Header ── */}
      <div className={cn(
        "shrink-0 px-4 sm:px-8 py-3 sm:py-4 border-b border-slate-700/50 transition-colors duration-500",
        hasAlerts ? "bg-red-900/50" : "bg-slate-800/80"
      )}>
        <div className="flex items-center justify-between gap-3">
          {/* Left: icon + title */}
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn("p-2 sm:p-3 rounded-xl shrink-0", hasAlerts ? "bg-red-500/20" : "bg-teal-500/20")}>
              <MapPin className={cn("h-5 w-5 sm:h-7 sm:w-7", hasAlerts ? "text-red-400" : "text-teal-400")} />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold tracking-tight truncate">{local}</h1>
              <p className="text-xs text-slate-400">Mapa de Terminais — Modo TV</p>
            </div>
          </div>

          {/* Right: controls + clock */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20 h-8 px-2 sm:h-9 sm:px-3 text-xs"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
              <span className="hidden sm:inline ml-1">Atualizar</span>
            </Button>
            <div className="hidden sm:block">
              <LiveClock />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              title="Fechar (ESC)"
              className="text-slate-400 hover:text-white hover:bg-slate-700 h-9 w-9"
            >
              <Minimize2 className="h-5 w-5" />
            </Button>
          </div>
        </div>
        {/* Mobile clock */}
        <div className="sm:hidden mt-1 text-right">
          <LiveClock />
        </div>
      </div>

      {/* ── KPI Strip ── */}
      <div className="shrink-0 px-4 sm:px-8 py-3 bg-slate-800/30 border-b border-slate-700/50">
        <div className="flex items-center justify-center gap-6 sm:gap-16 flex-wrap">
          <motion.div className="flex items-center gap-2 sm:gap-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <Monitor className="h-5 w-5 sm:h-7 sm:w-7 text-blue-400 shrink-0" />
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">Total</p>
              <p className="text-xl sm:text-3xl font-bold text-blue-400 tabular-nums">{termList.length}</p>
            </div>
          </motion.div>
          <motion.div className="flex items-center gap-2 sm:gap-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Wifi className="h-5 w-5 sm:h-7 sm:w-7 text-emerald-400 shrink-0" />
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">Online</p>
              <p className="text-xl sm:text-3xl font-bold text-emerald-400 tabular-nums">{online}</p>
            </div>
          </motion.div>
          <motion.div className="flex items-center gap-2 sm:gap-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <WifiOff className="h-5 w-5 sm:h-7 sm:w-7 text-red-400 shrink-0" />
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">Offline</p>
              <p className="text-xl sm:text-3xl font-bold text-red-400 tabular-nums">{offline}</p>
            </div>
          </motion.div>
          {warning > 0 && (
            <motion.div className="flex items-center gap-2 sm:gap-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <AlertTriangle className="h-5 w-5 sm:h-7 sm:w-7 text-yellow-400 shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Atenção</p>
                <p className="text-xl sm:text-3xl font-bold text-yellow-400 tabular-nums">{warning}</p>
              </div>
            </motion.div>
          )}
          <motion.div className="flex items-center gap-2 sm:gap-3 pl-4 sm:pl-8 border-l border-slate-700" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            {offline === 0 ? (
              <><CheckCircle className="h-6 w-6 text-emerald-400 shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Status</p>
                <p className="text-sm sm:text-base font-bold text-emerald-400">OPERACIONAL</p>
              </div></>
            ) : (
              <><AlertTriangle className="h-6 w-6 text-red-400 animate-pulse shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Status</p>
                <p className="text-sm sm:text-base font-bold text-red-400">ALERTA</p>
              </div></>
            )}
          </motion.div>
        </div>
      </div>

      {/* ── Alert Banner ── */}
      <AnimatePresence>
        {hasAlerts && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="shrink-0 px-4 sm:px-8 py-2 bg-red-500/10 border-b border-red-500/30"
          >
            <div className="flex items-center gap-3 flex-wrap">
              <AlertTriangle className="h-4 w-4 text-red-400 animate-pulse shrink-0" />
              <span className="text-xs sm:text-sm text-red-300 font-medium">
                {offline} terminal{offline !== 1 ? 'is' : ''} offline {offline === 1 ? 'requer' : 'requerem'} atenção:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {termList.filter(t => t.status === 'offline').map(t => (
                  <span key={t.id} className="flex items-center gap-1 bg-red-950/60 border border-red-800/50 text-red-300 text-xs rounded-full px-2.5 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                    {t.nome}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Canvas ── */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {/* Dark wrapper to contrast with the canvas */}
        <div className="h-full rounded-2xl overflow-hidden border border-slate-700/60 bg-slate-900/40">
          <FloorPlanCanvas
            local={local}
            terminals={termList}
            canEdit={canEdit}
            savedPlan={savedPlan}
            onSave={onSave}
            selectedId={selectedTerminal?.id}
            onSelect={setSelectedTerminal}
            fullscreen
            dark
          />
        </div>
      </div>

      {/* ── Footer hint ── */}
      <div className="shrink-0 py-2 text-center text-[11px] text-slate-600 select-none">
        Pressione <kbd className="bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded text-[10px] font-mono">ESC</kbd> para sair do modo TV
      </div>
    </motion.div>
  );
}