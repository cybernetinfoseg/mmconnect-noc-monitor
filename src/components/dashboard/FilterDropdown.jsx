import React, { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import { cn } from '@/lib/utils';
import { Check, ChevronDown } from 'lucide-react';

function useIsMobile() {
  return typeof window !== 'undefined' && window.innerWidth < 1024;
}

export default function FilterDropdown({ 
  label, 
  value, 
  onChange, 
  options, 
  placeholder = "Todos",
  icon: Icon,
  className
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleSelect = (v) => {
    onChange(v === "all" ? null : v);
    setDrawerOpen(false);
  };

  const displayValue = value || placeholder;

  if (isMobile) {
    return (
      <div className={cn("space-y-1.5", className)}>
        {label && (
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {label}
          </label>
        )}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center justify-between w-full min-w-[160px] h-9 px-3 rounded-md border border-slate-200 bg-white/80 backdrop-blur-sm text-sm text-slate-700 hover:border-slate-300 transition-colors"
        >
          <span className={cn(!value && "text-muted-foreground")}>{displayValue}</span>
          <ChevronDown className="h-4 w-4 text-slate-400 ml-2 shrink-0" />
        </button>

        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent>
            <DrawerHeader className="pb-0">
              <DrawerTitle className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                {Icon && <Icon className="h-4 w-4" />}
                {label || placeholder}
              </DrawerTitle>
            </DrawerHeader>
            <div className="p-4 pt-2 space-y-1 overflow-y-auto max-h-[60vh]">
              {[{ val: "all", label: placeholder }, ...options.map(o => ({ val: o, label: o }))].map(({ val, label: optLabel }) => {
                const isActive = (val === "all" && !value) || val === value;
                return (
                  <DrawerClose asChild key={val}>
                    <button
                      onClick={() => handleSelect(val)}
                      className={cn(
                        "w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-colors text-left",
                        isActive
                          ? "bg-slate-900 text-white"
                          : "text-slate-700 hover:bg-slate-100"
                      )}
                    >
                      {optLabel}
                      {isActive && <Check className="h-4 w-4 shrink-0" />}
                    </button>
                  </DrawerClose>
                );
              })}
            </div>
            <div className="h-safe-bottom pb-4" />
          </DrawerContent>
        </Drawer>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {label}
        </label>
      )}
      <Select value={value || "all"} onValueChange={(v) => onChange(v === "all" ? null : v)}>
        <SelectTrigger className="w-full min-w-[180px] bg-white/80 backdrop-blur-sm border-slate-200 hover:border-slate-300 transition-colors">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="bg-white/95 backdrop-blur-sm">
          <SelectItem value="all">{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}