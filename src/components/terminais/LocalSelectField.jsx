import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { MapPin, Pencil, Trash2, Check, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export default function LocalSelectField({ locais, value, onChange, onRefresh, isAdmin = false }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editVal, setEditVal] = useState('');
  const [newVal, setNewVal] = useState('');
  const [showNew, setShowNew] = useState(false);

  const handleEdit = (l) => {
    setEditingId(l.id);
    setEditVal(l.nome);
  };

  const handleSaveEdit = async (l) => {
    if (!editVal.trim()) return;
    await base44.entities.Local.update(l.id, { nome: editVal.trim() });
    if (value === l.nome) onChange(editVal.trim());
    setEditingId(null);
    onRefresh();
  };

  const handleDelete = async (l) => {
    if (!confirm(`Eliminar "${l.nome}"?`)) return;
    await base44.entities.Local.delete(l.id);
    if (value === l.nome) onChange('');
    onRefresh();
  };

  const handleCreate = async () => {
    if (!newVal.trim()) return;
    await base44.entities.Local.create({ nome: newVal.trim(), ativo: true });
    onChange(newVal.trim());
    setNewVal('');
    setShowNew(false);
    setOpen(false);
    onRefresh();
  };

  const selectedLabel = value || 'Selecionar local...';

  return (
    <div className="relative">
      {/* Trigger */}
      <div
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center justify-between h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm cursor-pointer shadow-sm",
          !value && "text-slate-400"
        )}
      >
        <span className="truncate">{selectedLabel}</span>
        <MapPin className="h-4 w-4 text-slate-400 shrink-0 ml-2" />
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {/* Empty option */}
          <div
            onClick={() => { onChange(''); setOpen(false); }}
            className="px-3 py-2 text-sm text-slate-400 hover:bg-slate-50 cursor-pointer"
          >
            Selecionar local...
          </div>

          {locais.filter(l => l.ativo).map(l => (
            <div key={l.id} className="flex items-center gap-1 px-2 py-1 hover:bg-slate-50">
              {editingId === l.id ? (
                <>
                  <Input
                    value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(l); if (e.key === 'Escape') setEditingId(null); }}
                    className="flex-1 h-7 text-xs"
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={e => { e.stopPropagation(); handleSaveEdit(l); }} className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700">
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={e => { e.stopPropagation(); setEditingId(null); }} className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <div
                    className="flex-1 min-w-0 cursor-pointer px-1 py-1 rounded"
                    onClick={() => { onChange(l.nome); setOpen(false); }}
                  >
                    <div className={cn("text-sm truncate", value === l.nome ? "font-semibold text-blue-600" : "text-slate-700")}>
                      {l.nome}
                    </div>
                    {isAdmin && l.created_by && (
                      <div className="text-[10px] text-slate-400 truncate">{l.created_by}</div>
                    )}
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={e => { e.stopPropagation(); handleEdit(l); }} className="h-7 w-7 p-0 text-slate-300 hover:text-blue-500 shrink-0">
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={e => { e.stopPropagation(); handleDelete(l); }} className="h-7 w-7 p-0 text-slate-300 hover:text-red-500 shrink-0">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          ))}

          {/* New local */}
          <div className="border-t border-slate-100 px-2 py-1.5">
            {showNew ? (
              <div className="flex items-center gap-1">
                <Input
                  value={newVal}
                  onChange={e => setNewVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNew(false); }}
                  placeholder="Nome do novo local..."
                  className="flex-1 h-7 text-xs"
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
                <Button type="button" size="sm" onClick={handleCreate} className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 shrink-0">Criar</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowNew(false)} className="h-7 w-7 p-0 text-slate-400"><X className="h-3 w-3" /></Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setShowNew(true); }}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 w-full py-0.5"
              >
                <Plus className="h-3.5 w-3.5" /> Novo local
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}