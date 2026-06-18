"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface Option { value: string; label: string }

interface SearchableSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
}

export default function SearchableSelect({
  value, onChange, options, placeholder = "Buscar...", emptyLabel = "— Nenhum —", className = "",
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = options.find(o => o.value === value);

  const filtered = query.trim()
    ? options.filter(o =>
        o.value.toLowerCase().includes(query.toLowerCase()) ||
        o.label.toLowerCase().includes(query.toLowerCase())
      )
    : options;

  function openDrop() {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
    }
    setOpen(true);
    setQuery("");
  }

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        // also check if click was inside the portal dropdown
        const drop = document.getElementById("searchable-select-portal");
        if (drop && drop.contains(target)) return;
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const dropdown = open && dropPos && typeof window !== "undefined" ? createPortal(
    <div
      id="searchable-select-portal"
      style={{ position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
      className="bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto"
    >
      <div
        onMouseDown={e => { e.preventDefault(); pick(""); }}
        className="px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 cursor-pointer border-b border-gray-100"
      >
        {emptyLabel}
      </div>
      {filtered.length === 0 && (
        <div className="px-3 py-2 text-xs text-gray-400">Nenhum resultado</div>
      )}
      {filtered.map(o => (
        <div
          key={o.value}
          onMouseDown={e => { e.preventDefault(); pick(o.value); }}
          className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
            o.value === value
              ? "bg-blue-50 text-blue-700 font-medium"
              : "text-gray-700 hover:bg-gray-50"
          }`}
        >
          <span className="font-mono text-xs text-gray-400 mr-2">{o.value}</span>
          {o.label.replace(new RegExp(`^${o.value}\\s*[—-]\\s*`), "")}
        </div>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={open ? query : (selected ? selected.label : "")}
        placeholder={open ? placeholder : (selected ? selected.label : placeholder)}
        onFocus={openDrop}
        onChange={e => { setQuery(e.target.value); if (!open) openDrop(); }}
        className={`w-full bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}
        autoComplete="off"
      />
      {dropdown}
    </div>
  );
}
