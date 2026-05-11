"use client";

import { useState, useMemo } from "react";
import {
  Plus, Trash2, Pencil, ChevronDown, ChevronRight, X,
  GripVertical, Indent, Outdent, Database, Zap,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData } from "@/lib/storage";

// ─── Types ────────────────────────────────────────────────────────────────────

type IndicadorTipo = "SUBTOTAL" | "INDICADOR";
type DropMode = "before" | "inside" | "after";
type RegraMode = "none" | "especifico" | "intervalo";

interface RegraItem { modo: RegraMode; codEspecifico?: string; codDe?: string; codAte?: string; }

interface FonteIndicador {
  id: string;
  tipo: "DRE" | "DIRETO";
  demoItemId?: string;
  codIndicador?: RegraItem;
  centroResultado?: RegraItem;
}

interface FormulaItem { subtotalId: string; sinal: "+" | "-"; }

interface IndicadorRow {
  id: string;
  tipo: IndicadorTipo;
  nivel: number;
  nome: string;
  codigo?: string;
  descricao?: string;
  categoria?: "ESTOQUE" | "MENSAL";
  fontes?: FonteIndicador[];
  formula?: FormulaItem[];
}

type DemoItemTipo2 = "SUBTOTAL" | "CONTA";
interface DemoItem {
  id: string; nivel: number; tipo: DemoItemTipo2; descricao: string;
  regras?: { natureza?: RegraItem; centroResultado?: RegraItem };
  formula?: unknown[];
}

// ─── computeCodes ─────────────────────────────────────────────────────────────

function computeCodes(items: IndicadorRow[]): string[] {
  const counters = Array(12).fill(0) as number[];
  let prevNivel = 0;
  return items.map(item => {
    const n = item.nivel;
    if (n > prevNivel + 1) { for (let i = prevNivel + 1; i < n; i++) { if (counters[i] === 0) counters[i] = 1; } }
    counters[n]++;
    for (let i = n + 1; i < counters.length; i++) counters[i] = 0;
    const parts: number[] = [];
    for (let i = 1; i <= n; i++) parts.push(counters[i]);
    prevNivel = n;
    return parts.join(".");
  });
}

function getDescendantCount(data: IndicadorRow[], parentIdx: number): number {
  const parentLevel = data[parentIdx].nivel;
  let count = 0;
  for (let i = parentIdx + 1; i < data.length; i++) {
    if (data[i].nivel <= parentLevel) break;
    count++;
  }
  return count;
}

function getDirectChildCodes(data: IndicadorRow[], codes: string[], parentIdx: number): string[] {
  const parentLevel = data[parentIdx].nivel;
  const result: string[] = [];
  for (let i = parentIdx + 1; i < data.length; i++) {
    if (data[i].nivel <= parentLevel) break;
    if (data[i].nivel === parentLevel + 1) result.push(codes[i]);
  }
  return result;
}

// ─── Normalização de dados antigos ────────────────────────────────────────────
// Converte formato antigo (UNIDADE_NEGOCIO/AREA) para novo (SUBTOTAL/INDICADOR)

function normalizeData(data: IndicadorRow[]): IndicadorRow[] {
  return data.map(r => {
    const tipo = r.tipo as string;
    if (tipo === "UNIDADE_NEGOCIO" || tipo === "AREA") {
      return { ...r, tipo: "SUBTOTAL" as IndicadorTipo };
    }
    return r;
  });
}

// ─── Row style ────────────────────────────────────────────────────────────────

function getRowStyle(tipo: IndicadorTipo, nivel: number): { background: string; color: string; fontWeight?: string } {
  if (tipo === "SUBTOTAL") {
    if (nivel === 1) return { background: "#1e3a5f", color: "white",   fontWeight: "700" };
    if (nivel === 2) return { background: "#dbeafe", color: "#1e3a5f", fontWeight: "600" };
    return              { background: "#f0f9ff", color: "#1e3a5f", fontWeight: "600" };
  }
  return { background: "white", color: "#334155" };
}

// ─── DRE path helpers ─────────────────────────────────────────────────────────

function buildDrePath(item: DemoItem, all: DemoItem[]): string {
  const idx = all.findIndex(d => d.id === item.id);
  const ancestors: string[] = [];
  let currentNivel = item.nivel;
  for (let i = idx - 1; i >= 0; i--) {
    if (all[i].nivel < currentNivel) { ancestors.unshift(all[i].descricao); currentNivel = all[i].nivel; if (currentNivel === 1) break; }
  }
  return [...ancestors, item.descricao].join(" › ");
}

function describeRegra(r: RegraItem | undefined): string {
  if (!r || r.modo === "none") return "";
  if (r.modo === "especifico") return r.codEspecifico ?? "";
  return `${r.codDe ?? "?"} – ${r.codAte ?? "?"}`;
}

function dreItemLabel(d: DemoItem, all: DemoItem[]): string {
  const path = buildDrePath(d, all);
  const nat = describeRegra(d.regras?.natureza);
  return nat ? `${path}  [Nat: ${nat}]` : path;
}

// ─── RegraItemEditor ──────────────────────────────────────────────────────────

function RegraItemEditor({ label, value, onChange }: { label: string; value: RegraItem; onChange: (v: RegraItem) => void }) {
  const modo = value.modo;
  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-gray-600">{label}</label>
      <div className="flex gap-1.5 flex-wrap">
        {([["none","Todos"],["especifico","Específico"],["intervalo","Intervalo"]] as [RegraMode,string][]).map(([v,l]) => (
          <button key={v} type="button" onClick={() => onChange({ modo: v })}
            className="px-2.5 py-1 text-xs font-medium rounded-md border transition-all"
            style={modo === v ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#6b7280", borderColor: "#d1d5db" }}>
            {l}
          </button>
        ))}
      </div>
      {modo === "especifico" && (
        <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Código" value={value.codEspecifico ?? ""}
          onChange={e => onChange({ modo: "especifico", codEspecifico: e.target.value })} />
      )}
      {modo === "intervalo" && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[10px] text-gray-500 mb-0.5">De</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="De" value={value.codDe ?? ""}
              onChange={e => onChange({ modo: "intervalo", codDe: e.target.value, codAte: value.codAte })} />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] text-gray-500 mb-0.5">Até</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Até" value={value.codAte ?? ""}
              onChange={e => onChange({ modo: "intervalo", codDe: value.codDe, codAte: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FonteCard ────────────────────────────────────────────────────────────────

function RegraTag({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border border-gray-200 bg-white text-gray-500">
      <span className="font-sans font-semibold text-gray-400 not-italic">{label}</span>{value}
    </span>
  );
}

function FonteCard({ fonte, dreItems, onRemove }: { fonte: FonteIndicador; dreItems: DemoItem[]; onRemove: () => void }) {
  if (fonte.tipo === "DRE") {
    const item = dreItems.find(d => d.id === fonte.demoItemId);
    const ancestors = (() => {
      if (!item) return [];
      const idx = dreItems.findIndex(d => d.id === item.id);
      const result: string[] = [];
      let currentNivel = item.nivel;
      for (let i = idx - 1; i >= 0; i--) {
        if (dreItems[i].nivel < currentNivel) { result.unshift(dreItems[i].descricao); currentNivel = dreItems[i].nivel; if (currentNivel === 1) break; }
      }
      return result;
    })();
    const nat = item ? describeRegra(item.regras?.natureza) : "";
    const cr  = item ? describeRegra(item.regras?.centroResultado) : "";
    return (
      <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0 space-y-0.5">
            {ancestors.length > 0 && <p className="text-[10px] text-blue-400 truncate">{ancestors.join(" › ")}</p>}
            <p className="text-xs font-semibold text-blue-900 truncate">
              {item ? item.descricao : <span className="text-gray-400 italic">Conta não encontrada</span>}
            </p>
            {(() => {
              const indLabel = fonte.codIndicador && fonte.codIndicador.modo !== "none"
                ? fonte.codIndicador.modo === "especifico" ? (fonte.codIndicador.codEspecifico ?? "—") : `${fonte.codIndicador.codDe ?? "?"} – ${fonte.codIndicador.codAte ?? "?"}`
                : null;
              return (nat || cr || indLabel) ? (
                <div className="flex flex-wrap gap-1 pt-1">
                  {indLabel && <RegraTag label="Ind" value={indLabel} />}
                  {nat && <RegraTag label="Nat" value={nat} />}
                  {cr  && <RegraTag label="CR"  value={cr}  />}
                </div>
              ) : null;
            })()}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: "#dbeafe", color: "#1d4ed8" }}>
              <Database size={9} /> DRE
            </span>
            <button type="button" onClick={onRemove} className="p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><X size={13} /></button>
          </div>
        </div>
      </div>
    );
  }
  const r = fonte.codIndicador;
  const cr = fonte.centroResultado;
  const indLabel = !r || r.modo === "none" ? "Todos" : r.modo === "especifico" ? (r.codEspecifico ?? "—") : `${r.codDe ?? "?"} – ${r.codAte ?? "?"}`;
  const crLabel = cr && cr.modo !== "none" ? cr.modo === "especifico" ? (cr.codEspecifico ?? "—") : `${cr.codDe ?? "?"} – ${cr.codAte ?? "?"}` : "";
  return (
    <div className="rounded-lg border border-purple-100 bg-purple-50/60 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-[10px] text-purple-400 font-medium uppercase tracking-wide">Lançamento direto</p>
          <div className="flex flex-wrap gap-1">
            <RegraTag label="Indicador" value={indLabel} />
            {crLabel && <RegraTag label="CR" value={crLabel} />}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: "#f3e8ff", color: "#7c3aed" }}>
            <Zap size={9} /> DIRETO
          </span>
          <button type="button" onClick={onRemove} className="p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><X size={13} /></button>
        </div>
      </div>
    </div>
  );
}

// ─── AddFonteForm ─────────────────────────────────────────────────────────────

function AddFonteForm({ tipo, dreItems, onAdd, onCancel }: { tipo: "DRE" | "DIRETO"; dreItems: DemoItem[]; onAdd: (f: FonteIndicador) => void; onCancel: () => void }) {
  const [demoItemId, setDemoItemId] = useState("");
  const [codIndicador, setCodIndicador] = useState<RegraItem>({ modo: "none" });
  const [centroResultado, setCentroResultado] = useState<RegraItem>({ modo: "none" });
  const [search, setSearch] = useState("");

  const contaItems = useMemo(() => dreItems.filter(d => d.tipo === "CONTA"), [dreItems]);
  const filteredContas = useMemo(() => {
    if (!search.trim()) return contaItems;
    const q = search.toLowerCase();
    return contaItems.filter(d => dreItemLabel(d, dreItems).toLowerCase().includes(q));
  }, [contaItems, dreItems, search]);

  function handleAdd() {
    if (tipo === "DRE" && !demoItemId) { alert("Selecione uma Conta DRE."); return; }
    if (tipo === "DIRETO" && codIndicador.modo === "none") { alert("Informe o código do indicador."); return; }
    const fonte: FonteIndicador = {
      id: `fonte_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tipo,
      ...(tipo === "DRE"
        ? { demoItemId, ...(codIndicador.modo !== "none" ? { codIndicador } : {}) }
        : { codIndicador, centroResultado: centroResultado.modo !== "none" ? centroResultado : undefined }),
    };
    onAdd(fonte);
  }

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-3">
      <div className="flex items-center gap-2">
        {tipo === "DRE" ? <Database size={13} className="text-blue-600 flex-shrink-0" /> : <Zap size={13} className="text-purple-600 flex-shrink-0" />}
        <span className="text-xs font-semibold text-gray-700">Nova fonte {tipo === "DRE" ? "DRE" : "Direta"}</span>
      </div>
      {tipo === "DRE" && (
        <>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Conta DRE</label>
            {contaItems.length === 0 ? (
              <p className="text-[10px] text-amber-600">Nenhuma conta DRE. Configure o demonstrativo DRE primeiro.</p>
            ) : (
              <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
                <div className="px-2 py-1.5 border-b border-gray-200">
                  <input className="w-full text-xs outline-none placeholder:text-gray-400" placeholder="Buscar conta…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div className="max-h-44 overflow-y-auto">
                  {filteredContas.length === 0 && <p className="px-3 py-3 text-xs text-gray-400">Nenhum resultado.</p>}
                  {filteredContas.map(d => {
                    const label = dreItemLabel(d, dreItems);
                    const nat   = describeRegra(d.regras?.natureza);
                    const path  = buildDrePath(d, dreItems);
                    return (
                      <button key={d.id} type="button" onClick={() => setDemoItemId(d.id)}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-0"
                        style={demoItemId === d.id ? { background: "#eff6ff" } : {}} title={label}>
                        <p className="text-xs font-medium text-gray-800 truncate">{path}</p>
                        {nat && <p className="text-[10px] text-blue-600 font-mono mt-0.5">Nat: {nat}</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <RegraItemEditor label="Código do Indicador (padrão: código deste indicador)" value={codIndicador} onChange={setCodIndicador} />
        </>
      )}
      {tipo === "DIRETO" && (
        <>
          <RegraItemEditor label="Indicador (obrigatório)" value={codIndicador} onChange={setCodIndicador} />
          <RegraItemEditor label="Centro de Resultado (opcional)" value={centroResultado} onChange={setCentroResultado} />
        </>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancelar</button>
        <button type="button" onClick={handleAdd} className="px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors" style={{ background: "#1e3a5f" }}>Adicionar</button>
      </div>
    </div>
  );
}

// ─── ComposicaoChips ──────────────────────────────────────────────────────────

function ComposicaoChips({ childCodes, totalDescendants, isOnDark, formula, subtotalMap }: {
  childCodes: string[]; totalDescendants: number; isOnDark: boolean;
  formula?: FormulaItem[]; subtotalMap: Map<string, { code: string; nome: string }>;
}) {
  if (formula !== undefined) {
    const safe = Array.isArray(formula) ? formula : [];
    if (safe.length === 0) return <span style={{ opacity: 0.4 }} className="text-xs italic">Fórmula vazia</span>;
    return (
      <div className="flex flex-wrap gap-1 items-center">
        <span style={{ opacity: 0.5 }} className="text-[10px] mr-0.5">∑</span>
        {safe.map(fi => {
          const st = subtotalMap.get(fi.subtotalId);
          if (!st) return null;
          const bg = fi.sinal === "+"
            ? (isOnDark ? "bg-emerald-400/25 text-emerald-200" : "bg-emerald-100 text-emerald-700")
            : (isOnDark ? "bg-red-400/25 text-red-200" : "bg-red-100 text-red-700");
          return (
            <span key={fi.subtotalId} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${bg}`}>
              {fi.sinal} {st.code}
            </span>
          );
        })}
      </div>
    );
  }
  if (childCodes.length === 0) return <span style={{ opacity: 0.35 }} className="text-xs">Sem itens</span>;
  const MAX = 5;
  const visible = childCodes.slice(0, MAX);
  const extra = childCodes.length - MAX;
  const chip = isOnDark ? "bg-white/20 text-white" : "bg-white/80 text-blue-700 border border-blue-200";
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {visible.map(code => <span key={code} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${chip}`}>{code}</span>)}
      {extra > 0 && <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${chip}`}>+{extra}</span>}
      <span style={{ opacity: 0.5 }} className="text-[10px] ml-0.5">({totalDescendants} {totalDescendants === 1 ? "item" : "itens"})</span>
    </div>
  );
}

function FontesChips({ fontes, categoria }: { fontes?: FonteIndicador[]; categoria?: string }) {
  const count = fontes?.length ?? 0;
  return (
    <div className="flex items-center gap-2">
      {categoria && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold"
          style={categoria === "MENSAL" ? { background: "#d1fae5", color: "#065f46" } : { background: "#fef3c7", color: "#92400e" }}>
          {categoria}
        </span>
      )}
      <span className="text-xs" style={{ color: count > 0 ? "#6366f1" : "#9ca3af" }}>
        {count > 0 ? `${count} fonte${count !== 1 ? "s" : ""}` : "—"}
      </span>
    </div>
  );
}

// ─── ItemModal ────────────────────────────────────────────────────────────────

interface ItemModalProps {
  mode: "add" | "edit";
  item: Partial<IndicadorRow>;
  dreItems: DemoItem[];
  subtotais: { id: string; code: string; nome: string }[];
  onSave: (item: Partial<IndicadorRow>) => void;
  onClose: () => void;
}

function ItemModal({ mode, item, dreItems, subtotais, onSave, onClose }: ItemModalProps) {
  const [form, setForm] = useState<Partial<IndicadorRow>>({ ...item, fontes: item.fontes ? [...item.fontes] : [] });
  const [addingFonte, setAddingFonte] = useState<"DRE" | "DIRETO" | null>(null);

  function set<K extends keyof IndicadorRow>(key: K, val: IndicadorRow[K]) { setForm(f => ({ ...f, [key]: val })); }

  function safeFormula(): FormulaItem[] { return Array.isArray(form.formula) ? form.formula : []; }

  function toggleFormulaItem(id: string) {
    const cur = safeFormula();
    const exists = cur.find(f => f.subtotalId === id);
    set("formula", exists ? cur.filter(f => f.subtotalId !== id) : [...cur, { subtotalId: id, sinal: "+" }]);
  }

  function toggleSinal(id: string) {
    set("formula", safeFormula().map(f => f.subtotalId === id ? { ...f, sinal: f.sinal === "+" ? "-" as const : "+" as const } : f));
  }

  function handleSave() {
    if (!form.nome?.trim()) { alert("Informe o nome."); return; }
    onSave(form);
  }

  const tipo = form.tipo ?? "INDICADOR";
  const fontes = form.fontes ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 flex flex-col" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">
            {mode === "add" ? "Adicionar item" : tipo === "SUBTOTAL" ? "Editar Subtotal" : "Editar Indicador"}
          </h2>
          <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* Tipo toggle (só para add) */}
          {mode === "add" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
              <div className="flex gap-2">
                {(["SUBTOTAL", "INDICADOR"] as IndicadorTipo[]).map(t => (
                  <button key={t} type="button" onClick={() => set("tipo", t)}
                    className="flex-1 py-2 text-sm font-medium rounded-lg border transition-all"
                    style={tipo === t ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Nome */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.nome ?? ""}
              onChange={e => set("nome", e.target.value.toUpperCase())}
              placeholder={tipo === "SUBTOTAL" ? "Ex: RECEITA BRUTA" : "NOME DO INDICADOR"} />
          </div>

          {/* SUBTOTAL: composição */}
          {tipo === "SUBTOTAL" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-2">Composição</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => set("formula", undefined)}
                  className="flex-1 py-2 text-xs font-medium rounded-lg border transition-all"
                  style={form.formula === undefined ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
                  Agregar filhos
                </button>
                <button type="button" onClick={() => { if (form.formula === undefined) set("formula", []); }}
                  className="flex-1 py-2 text-xs font-medium rounded-lg border transition-all"
                  style={form.formula !== undefined ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
                  Fórmula personalizada
                </button>
              </div>
              {form.formula !== undefined && (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
                    <p className="text-xs text-gray-500">Selecione os subtotais e defina o sinal de cada um.</p>
                  </div>
                  {subtotais.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-gray-400 text-center">Nenhum outro subtotal disponível.</p>
                  ) : (
                    <div className="divide-y divide-gray-100 max-h-52 overflow-y-auto">
                      {subtotais.map(s => {
                        const fi = safeFormula().find(f => f.subtotalId === s.id);
                        const included = !!fi;
                        return (
                          <div key={s.id} className={`flex items-center gap-3 px-3 py-2 transition-colors ${included ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                            <input type="checkbox" checked={included} onChange={() => toggleFormulaItem(s.id)}
                              className="w-4 h-4 cursor-pointer flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
                            {included ? (
                              <button type="button" onClick={() => toggleSinal(s.id)}
                                className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md font-bold text-sm border transition-colors"
                                style={fi!.sinal === "+" ? { background: "#d1fae5", color: "#059669", borderColor: "#6ee7b7" } : { background: "#fee2e2", color: "#dc2626", borderColor: "#fca5a5" }}>
                                {fi!.sinal}
                              </button>
                            ) : (
                              <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-gray-300 text-sm font-bold">+</span>
                            )}
                            <span className="font-mono text-xs text-blue-700 font-semibold flex-shrink-0 w-10">{s.code}</span>
                            <span className="text-xs text-gray-700 truncate">{s.nome}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {safeFormula().length > 0 && (
                    <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
                      <p className="text-xs text-gray-500 font-mono">
                        = {safeFormula().map((f, i) => {
                          const st = subtotais.find(s => s.id === f.subtotalId);
                          return `${i === 0 && f.sinal === "+" ? "" : f.sinal + " "}${st?.code ?? "?"}`;
                        }).join(" ")}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* INDICADOR fields */}
          {tipo === "INDICADOR" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.codigo ?? ""} onChange={e => set("codigo", e.target.value || undefined)}
                  placeholder="Ex: IND-001" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                <div className="flex gap-2">
                  {(["MENSAL", "ESTOQUE"] as const).map(cat => (
                    <button key={cat} type="button" onClick={() => set("categoria", form.categoria === cat ? undefined : cat)}
                      className="flex-1 py-2 text-sm font-medium rounded-lg border transition-all"
                      style={form.categoria === cat ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={2} value={form.descricao ?? ""} onChange={e => set("descricao", e.target.value || undefined)} placeholder="Descrição opcional" />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-2">Fontes</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              {fontes.length === 0 && <p className="text-xs text-gray-400 text-center py-1">Nenhuma fonte configurada.</p>}
              {fontes.length > 0 && (
                <div className="space-y-2">
                  {fontes.map(fonte => (
                    <FonteCard key={fonte.id} fonte={fonte} dreItems={dreItems}
                      onRemove={() => set("fontes", fontes.filter(f => f.id !== fonte.id))} />
                  ))}
                </div>
              )}
              {addingFonte === null && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAddingFonte("DRE")}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors">
                    <Database size={12} /> + Fonte DRE
                  </button>
                  <button type="button" onClick={() => setAddingFonte("DIRETO")}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-purple-300 text-purple-700 hover:bg-purple-50 transition-colors">
                    <Zap size={12} /> + Fonte Direta
                  </button>
                </div>
              )}
              {addingFonte !== null && (
                <AddFonteForm tipo={addingFonte} dreItems={dreItems}
                  onAdd={fonte => { set("fontes", [...fontes, fonte]); setAddingFonte(null); }}
                  onCancel={() => setAddingFonte(null)} />
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 flex-shrink-0">
          <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors" onClick={onClose}>Cancelar</button>
          <button className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors" style={{ background: "#1e3a5f" }} onClick={handleSave}>
            {mode === "add" ? "Adicionar" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function IndicadoresPage() {
  const [rawData, setData] = usePersistedData<IndicadorRow[]>("portal_indicadores", []);
  const [dreItems] = usePersistedData<DemoItem[]>("portal_dre", []);

  // Normaliza dados antigos (UNIDADE_NEGOCIO/AREA → SUBTOTAL)
  const data = useMemo(() => normalizeData(rawData), [rawData]);

  const [modal, setModal]           = useState<{ open: boolean; mode: "add" | "edit"; item: Partial<IndicadorRow> } | null>(null);
  const [collapsed, setCollapsed]   = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragIdx, setDragIdx]       = useState<number | null>(null);
  const [overIdx, setOverIdx]       = useState<number | null>(null);
  const [overMode, setOverMode]     = useState<DropMode>("after");

  const codes = useMemo(() => computeCodes(data), [data]);

  const subtotalMap = useMemo(() => {
    const m = new Map<string, { code: string; nome: string }>();
    data.forEach((item, idx) => {
      if (item.tipo === "SUBTOTAL") m.set(item.id, { code: codes[idx], nome: item.nome });
    });
    return m;
  }, [data, codes]);

  const subtotaisParaFormula = useMemo(() => {
    const editingId = modal?.item?.id;
    return data
      .map((item, idx) => ({ id: item.id, tipo: item.tipo, code: codes[idx], nome: item.nome }))
      .filter(s => s.tipo === "SUBTOTAL" && s.id !== editingId);
  }, [data, codes, modal?.item?.id]);

  const visibleData = useMemo(() => {
    const hidden = new Set<string>();
    data.forEach((item, idx) => {
      if (item.tipo === "SUBTOTAL" && collapsed.has(item.id)) {
        for (let i = idx + 1; i < data.length; i++) {
          if (data[i].nivel <= item.nivel) break;
          hidden.add(data[i].id);
        }
      }
    });
    return data.map((item, dataIdx) => ({ item, dataIdx })).filter(({ item }) => !hidden.has(item.id));
  }, [data, collapsed]);

  const stats = useMemo(() => ({
    subtotais: data.filter(r => r.tipo === "SUBTOTAL").length,
    indicadores: data.filter(r => r.tipo === "INDICADOR").length,
  }), [data]);

  function toggleCollapse(id: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function openAdd() {
    const selRow = selectedId ? data.find(r => r.id === selectedId) : null;
    setModal({ open: true, mode: "add", item: { nivel: selRow?.nivel ?? 1, tipo: "INDICADOR", nome: "" } });
  }

  function openEdit(row: IndicadorRow) {
    setModal({ open: true, mode: "edit", item: { ...row, fontes: row.fontes ? [...row.fontes] : [] } });
  }

  function handleSave(item: Partial<IndicadorRow>) {
    if (!modal) return;
    if (modal.mode === "add") {
      const newItem: IndicadorRow = {
        id: `ind_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        nivel: item.nivel ?? 1,
        tipo: item.tipo ?? "INDICADOR",
        nome: item.nome ?? "",
        ...(item.tipo === "INDICADOR"
          ? { codigo: item.codigo, descricao: item.descricao, categoria: item.categoria, fontes: item.fontes ?? [] }
          : { formula: item.formula }),
      };
      setData(d => {
        if (!selectedId) return [...normalizeData(d), newItem];
        const idx = d.findIndex(r => r.id === selectedId);
        if (idx === -1) return [...normalizeData(d), newItem];
        const arr = [...normalizeData(d)];
        arr.splice(idx + 1, 0, newItem);
        return arr;
      });
      setSelectedId(newItem.id);
    } else {
      setData(d => normalizeData(d).map(r => r.id === item.id
        ? { ...r, nome: item.nome ?? r.nome,
            ...(r.tipo === "INDICADOR"
              ? { codigo: item.codigo, descricao: item.descricao, categoria: item.categoria, fontes: item.fontes ?? [] }
              : { formula: item.formula })
          }
        : r));
    }
    setModal(null);
  }

  function handleDelete(id: string) {
    const norm = normalizeData(rawData);
    const idx = norm.findIndex(r => r.id === id);
    if (idx === -1) return;
    const nivel = norm[idx].nivel;
    let end = idx + 1;
    while (end < norm.length && norm[end].nivel > nivel) end++;
    const hasKids = end > idx + 1;
    if (confirm(hasKids ? `Remover "${norm[idx].nome}" e todos os seus descendentes?` : `Remover "${norm[idx].nome}"?`)) {
      setData(d => { const n = normalizeData(d); return [...n.slice(0, idx), ...n.slice(end)]; });
      if (selectedId === id) setSelectedId(null);
    }
  }

  function handleIndent(dataIdx: number) {
    setData(d => {
      const arr = [...normalizeData(d)];
      const prev = arr[dataIdx - 1];
      const maxNivel = prev ? prev.nivel + 1 : 1;
      if (arr[dataIdx].nivel >= maxNivel) return d;
      arr[dataIdx] = { ...arr[dataIdx], nivel: arr[dataIdx].nivel + 1 };
      return arr;
    });
  }

  function handleUnindent(dataIdx: number) {
    setData(d => {
      const arr = [...normalizeData(d)];
      if (arr[dataIdx].nivel <= 1) return d;
      arr[dataIdx] = { ...arr[dataIdx], nivel: arr[dataIdx].nivel - 1 };
      return arr;
    });
  }

  function handleDragStart(e: React.DragEvent, dataIdx: number) {
    setDragIdx(dataIdx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dataIdx));
  }

  function handleDragOver(e: React.DragEvent, dataIdx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY = (e.clientY - rect.top) / rect.height;
    const isSubtotal = data[dataIdx]?.tipo === "SUBTOTAL";
    const mode: DropMode = isSubtotal && relY > 0.25 && relY < 0.75 ? "inside" : relY < 0.5 ? "before" : "after";
    setOverIdx(dataIdx);
    setOverMode(mode);
  }

  function handleDrop(e: React.DragEvent, targetDataIdx: number) {
    e.preventDefault();
    if (dragIdx === null) { clearDrag(); return; }
    if (dragIdx === targetDataIdx && overMode !== "inside") { clearDrag(); return; }
    setData(d => {
      const arr = [...normalizeData(d)];
      const [dragged] = arr.splice(dragIdx, 1);
      const adjustedTarget = dragIdx < targetDataIdx ? targetDataIdx - 1 : targetDataIdx;
      const targetAfterRemoval = arr[adjustedTarget];
      let newNivel: number;
      let insertAt: number;
      if (overMode === "inside") {
        newNivel = data[targetDataIdx].nivel + 1;
        insertAt = adjustedTarget + 1;
      } else if (overMode === "before") {
        newNivel = targetAfterRemoval?.nivel ?? 1;
        insertAt = adjustedTarget;
      } else {
        newNivel = targetAfterRemoval?.nivel ?? 1;
        insertAt = adjustedTarget + 1;
      }
      const prevItem = arr[insertAt - 1];
      const maxNivel = prevItem ? prevItem.nivel + 1 : 1;
      newNivel = Math.min(newNivel, maxNivel);
      arr.splice(insertAt, 0, { ...dragged, nivel: newNivel });
      return arr;
    });
    clearDrag();
  }

  function clearDrag() { setDragIdx(null); setOverIdx(null); }

  return (
    <div>
      <PageHeader
        title="Indicadores"
        subtitle={`${stats.indicadores} indicadores · ${stats.subtotais} subtotais`}>
        <button
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
          style={{ background: "#1e3a5f" }}
          onClick={openAdd}>
          <Plus size={15} /> Adicionar Linha
        </button>
      </PageHeader>

      <div className="p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">

          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-wrap gap-3">
            <div>
              <span className="font-semibold text-gray-800 text-sm">Estrutura de Indicadores</span>
              <span className="ml-3 text-xs text-gray-400">{data.length} itens</span>
            </div>
            <div className="flex gap-4 text-xs text-gray-500 items-center">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: "#1e3a5f" }} />Subtotal nível 1
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: "#dbeafe", border: "1px solid #bfdbfe" }} />Subtotal nível 2+
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: "white", border: "1px solid #e2e8f0" }} />Indicador
              </span>
              <span className="text-gray-400 text-[11px] border-l border-gray-200 pl-4">
                ↕ arraste entre linhas · arraste sobre SUBTOTAL para entrar como filho
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ background: "#1e3a5f" }}>
                  <th className="w-8 px-2 py-2.5" />
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-left w-20">CÓD.</th>
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-left w-24">TIPO</th>
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-left">NOME</th>
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-left w-64">COMPOSIÇÃO / FONTES</th>
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-center w-36">AÇÕES</th>
                </tr>
              </thead>
              <tbody onDragLeave={() => setOverIdx(null)}>
                {visibleData.map(({ item: row, dataIdx }) => {
                  const style      = getRowStyle(row.tipo, row.nivel);
                  const isOnDark   = style.background === "#1e3a5f";
                  const isDragging = dragIdx === dataIdx;
                  const isOver     = overIdx === dataIdx && dragIdx !== null;
                  const isSubtotal  = row.tipo === "SUBTOTAL";
                  const hasChildren = isSubtotal && dataIdx + 1 < data.length && (data[dataIdx + 1]?.nivel ?? 0) > row.nivel;
                  const isCollapsed = hasChildren && collapsed.has(row.id);
                  const isSelected  = selectedId === row.id;
                  const childCodes  = isSubtotal ? getDirectChildCodes(data, codes, dataIdx) : [];
                  const descendCount = isSubtotal ? getDescendantCount(data, dataIdx) : 0;

                  const dropStyle: React.CSSProperties = isOver
                    ? overMode === "before"  ? { boxShadow: "inset 0 3px 0 #3b82f6" }
                    : overMode === "after"   ? { boxShadow: "inset 0 -3px 0 #3b82f6" }
                    :                          { outline: "2px solid #3b82f6", outlineOffset: "-2px", zIndex: 1, position: "relative" }
                    : isSelected && !isOnDark ? { outline: "2px solid #f59e0b", outlineOffset: "-2px", zIndex: 1, position: "relative" }
                    : isSelected             ? { outline: "2px solid #fbbf24", outlineOffset: "-2px", zIndex: 1, position: "relative" }
                    : {};

                  return (
                    <tr key={row.id}
                      draggable
                      onClick={() => {
                        setSelectedId(row.id === selectedId ? null : row.id);
                        if (hasChildren) toggleCollapse(row.id);
                      }}
                      onDragStart={e => handleDragStart(e, dataIdx)}
                      onDragOver={e => handleDragOver(e, dataIdx)}
                      onDrop={e => handleDrop(e, dataIdx)}
                      onDragEnd={clearDrag}
                      style={{ background: style.background, color: style.color, fontWeight: style.fontWeight, opacity: isDragging ? 0.3 : 1, transition: "opacity 0.15s", cursor: "pointer", ...dropStyle }}
                      className="border-b border-gray-100 select-none">

                      <td className="px-2 py-2 w-8" style={{ cursor: "grab" }}>
                        <GripVertical size={14} className="mx-auto" style={{ opacity: 0.35 }} />
                      </td>

                      <td className="px-3 py-2">
                        <span className="font-mono text-xs font-semibold" style={{ opacity: 0.7 }}>{codes[dataIdx]}</span>
                      </td>

                      <td className="px-3 py-2">
                        <span className="text-xs font-semibold">{row.tipo}</span>
                      </td>

                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5" style={{ paddingLeft: `${(row.nivel - 1) * 18}px` }}>
                          {isSubtotal ? (
                            <span
                              className="flex-shrink-0 rounded p-0.5"
                              style={{ color: isOnDark ? "rgba(255,255,255,0.7)" : "#1e3a5f" }}>
                              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            </span>
                          ) : <span className="w-5 flex-shrink-0" />}
                          {row.nome}
                        </span>
                      </td>

                      <td className="px-3 py-2 text-xs">
                        {isSubtotal
                          ? <ComposicaoChips childCodes={childCodes} totalDescendants={descendCount} isOnDark={isOnDark} formula={row.formula} subtotalMap={subtotalMap} />
                          : <FontesChips fontes={row.fontes} categoria={row.categoria} />}
                      </td>

                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-0.5">
                          <button onClick={() => handleUnindent(dataIdx)} disabled={row.nivel <= 1}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: row.nivel <= 1 ? (isOnDark ? "rgba(255,255,255,0.2)" : "#d1d5db") : (isOnDark ? "rgba(255,255,255,0.6)" : "#64748b") }}
                            onMouseEnter={e => { if (row.nivel > 1 && !isOnDark) (e.currentTarget as HTMLElement).style.background = "#f1f5f9"; }}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                            title="Desindentar">
                            <Outdent size={13} />
                          </button>
                          <button onClick={() => handleIndent(dataIdx)} disabled={dataIdx === 0 || row.nivel >= (data[dataIdx - 1]?.nivel ?? 0) + 1}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: (dataIdx === 0 || row.nivel >= (data[dataIdx - 1]?.nivel ?? 0) + 1) ? (isOnDark ? "rgba(255,255,255,0.2)" : "#d1d5db") : (isOnDark ? "rgba(255,255,255,0.6)" : "#64748b") }}
                            onMouseEnter={e => { if (dataIdx > 0 && row.nivel < (data[dataIdx - 1]?.nivel ?? 0) + 1 && !isOnDark) (e.currentTarget as HTMLElement).style.background = "#f1f5f9"; }}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                            title="Indentar">
                            <Indent size={13} />
                          </button>
                          <div className="w-px h-4 bg-current opacity-10 mx-0.5" />
                          <button onClick={e => { e.stopPropagation(); openEdit(row); }}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: isOnDark ? "rgba(255,255,255,0.6)" : "#3b82f6" }}
                            onMouseEnter={e => { if (!isOnDark) (e.currentTarget as HTMLElement).style.background = "#eff6ff"; }}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                            title="Editar">
                            <Pencil size={13} />
                          </button>
                          <button onClick={e => { e.stopPropagation(); handleDelete(row.id); }}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: isOnDark ? "rgba(255,255,255,0.6)" : "#94a3b8" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ef4444"; (e.currentTarget as HTMLElement).style.background = "#fef2f2"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = isOnDark ? "rgba(255,255,255,0.6)" : "#94a3b8"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                            title="Remover">
                            <Trash2 size={13} />
                          </button>
                          <div className="w-px h-4 bg-current opacity-10 mx-0.5" />
                          <button onClick={e => { e.stopPropagation(); setSelectedId(row.id); openAdd(); }}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: isOnDark ? "rgba(255,255,255,0.6)" : "#10b981" }}
                            onMouseEnter={e => { if (!isOnDark) (e.currentTarget as HTMLElement).style.background = "#d1fae5"; }}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                            title="Adicionar linha abaixo">
                            <Plus size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-14 text-center text-gray-400 text-sm">
                      Nenhum item adicionado.{" "}
                      <button className="text-blue-600 hover:underline font-medium" onClick={openAdd}>+ Adicionar linha</button>{" "}
                      para começar.
                    </td>
                  </tr>
                )}
                <tr>
                  <td colSpan={6}>
                    <button onClick={() => { setSelectedId(data[data.length - 1]?.id ?? null); openAdd(); }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 text-xs text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors group">
                      <Plus size={13} className="group-hover:text-green-600" />
                      Adicionar linha no final
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modal?.open && (
        <ItemModal mode={modal.mode} item={modal.item} dreItems={dreItems}
          subtotais={subtotaisParaFormula}
          onSave={handleSave} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
