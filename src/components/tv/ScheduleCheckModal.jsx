import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, CalendarClock, Clock, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { create_automation } from '@/api/base44Client';

const PRESETS = [
  { label: 'A cada 5 min', interval: 5, unit: 'minutes' },
  { label: 'A cada 15 min', interval: 15, unit: 'minutes' },
  { label: 'A cada 30 min', interval: 30, unit: 'minutes' },
  { label: 'A cada hora', interval: 1, unit: 'hours' },
];

export default function ScheduleCheckModal({ terminal, onClose }) {
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      // Call backend to create the scheduled automation via function
      await base44.functions.invoke('createScheduledCheck', {
        terminalId: terminal.id,
        terminalNome: terminal.nome,
        interval: selected.interval,
        unit: selected.unit,
      });
      setDone(true);
    } catch (e) {
      setError(e.message || 'Erro ao agendar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        className="relative w-full max-w-sm mx-4 bg-slate-800 border border-slate-600 rounded-2xl overflow-hidden"
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-blue-400" />
            <div>
              <h3 className="text-sm font-bold text-white">Agendar Verificação</h3>
              <p className="text-xs text-slate-400 truncate max-w-[180px]">{terminal.nome}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="p-3 bg-emerald-500/20 rounded-full">
                <Check className="h-6 w-6 text-emerald-400" />
              </div>
              <p className="text-white font-semibold">Agendamento criado!</p>
              <p className="text-sm text-slate-400">
                Verificação automática <span className="text-emerald-400">{selected?.label?.toLowerCase()}</span> para este terminal.
              </p>
              <Button onClick={onClose} className="mt-2 bg-emerald-600 hover:bg-emerald-700 w-full">
                Fechar
              </Button>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Frequência de verificação
              </p>
              <div className="grid grid-cols-2 gap-2 mb-5">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setSelected(p)}
                    className={cn(
                      "px-4 py-3 rounded-xl text-sm font-medium transition-all border",
                      selected?.label === p.label
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "bg-slate-700/60 border-slate-600 text-slate-300 hover:border-slate-500 hover:text-white"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {error && (
                <p className="text-xs text-red-400 mb-3">{error}</p>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} className="flex-1 border-slate-600 text-slate-300 hover:text-white">
                  Cancelar
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!selected || saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  {saving ? 'A guardar...' : 'Criar Agendamento'}
                </Button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}