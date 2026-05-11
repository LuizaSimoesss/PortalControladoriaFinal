"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";

export function FilterSection({
  label,
  count,
  onClear,
  children,
}: {
  label: string;
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-gray-100 last:border-0">
      <div className="flex items-center px-5 py-3 hover:bg-gray-50 transition-colors">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 flex-1 text-left">
          <span className="text-sm font-medium text-gray-700">{label}</span>
          {count > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-xs" style={{ background: "#1e3a5f" }}>
              {count}
            </span>
          )}
        </button>
        {count > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors mr-2"
          >
            Limpar
          </button>
        )}
        <button onClick={() => setOpen((o) => !o)}>
          <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && <div className="px-5 pb-3 space-y-0.5">{children}</div>}
    </div>
  );
}

export function FilterCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2.5 py-1.5 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-4 h-4 rounded cursor-pointer flex-shrink-0"
        style={{ accentColor: "#1e3a5f" }}
      />
      <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">{label}</span>
    </label>
  );
}

export function FilterDrawerShell({
  totalAtivos,
  onClose,
  onApply,
  onClear,
  children,
}: {
  totalAtivos: number;
  onClose: () => void;
  onApply: () => void;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full z-50 flex flex-col bg-white shadow-2xl" style={{ width: 300 }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <span className="text-base font-semibold text-gray-800 flex items-center gap-2">
            Filtros
            {totalAtivos > 0 && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full text-white" style={{ background: "#1e3a5f" }}>
                {totalAtivos}
              </span>
            )}
          </span>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-200 flex-shrink-0">
          <button onClick={onApply} className="flex-1 py-2 text-sm font-semibold text-white rounded-lg" style={{ background: "#1e3a5f" }}>
            Aplicar
          </button>
          <button onClick={onClear} className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
            Limpar
          </button>
        </div>
      </div>
    </>
  );
}
