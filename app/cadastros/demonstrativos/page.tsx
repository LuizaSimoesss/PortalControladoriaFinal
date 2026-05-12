"use client";

import { useState, useMemo } from "react";
import { Plus, Trash2, Pencil, FileText, ChevronDown, ChevronRight, X, AlertTriangle, Settings2, GripVertical, Indent, Outdent } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { loadData, usePersistedData } from "@/lib/storage";
import type { NaturezaRow, CentroResultadoRow } from "@/lib/mockData";

type ItemTipo = "SUBTOTAL" | "CONTA";
type Demonstrativo = "DRE" | "DFC";
type RegraMode = "none" | "especifico" | "intervalo";
type DropMode = "before" | "inside" | "after";

interface RegraItem {
  modo: RegraMode;
  codEspecifico?: string;
  codDe?: string;
  codAte?: string;
}

interface RegrasLinha {
  centroResultado?: RegraItem;
  natureza?: RegraItem;
}

interface FormulaItem {
  subtotalId: string;
  sinal: "+" | "-";
}

interface DemoItem {
  id: string;
  nivel: number;   // gerenciado pelo drag-and-drop, não pelo usuário
  tipo: ItemTipo;
  descricao: string;
  regras?: RegrasLinha;
  formula?: FormulaItem[];  // undefined = agregar filhos; array = fórmula personalizada
}

// ─── Dados iniciais ───────────────────────────────────────────────────────────

const dreInicial: DemoItem[] = [
  { id: "d1",  nivel: 1, tipo: "SUBTOTAL", descricao: "RECEITA BRUTA" },
  { id: "d2",  nivel: 2, tipo: "CONTA",    descricao: "Receita de Produtos" },
  { id: "d3",  nivel: 2, tipo: "CONTA",    descricao: "Receita de Serviços" },
  { id: "d4",  nivel: 1, tipo: "SUBTOTAL", descricao: "(-) DEDUÇÕES" },
  { id: "d5",  nivel: 2, tipo: "CONTA",    descricao: "Impostos sobre Vendas" },
  { id: "d6",  nivel: 2, tipo: "CONTA",    descricao: "Devoluções" },
  { id: "d7",  nivel: 1, tipo: "SUBTOTAL", descricao: "(-) CUSTOS" },
  { id: "d8",  nivel: 2, tipo: "CONTA",    descricao: "Custo dos Produtos Vendidos" },
  { id: "d9",  nivel: 2, tipo: "CONTA",    descricao: "Custo dos Serviços Prestados" },
  { id: "d10", nivel: 1, tipo: "SUBTOTAL", descricao: "(-) DESPESAS OPERACIONAIS" },
  { id: "d11", nivel: 2, tipo: "SUBTOTAL", descricao: "Despesas com Pessoal" },
  { id: "d12", nivel: 3, tipo: "CONTA",    descricao: "Salários e Ordenados" },
  { id: "d13", nivel: 3, tipo: "CONTA",    descricao: "Encargos Sociais" },
  { id: "d14", nivel: 2, tipo: "SUBTOTAL", descricao: "Despesas com Tecnologia" },
  { id: "d15", nivel: 3, tipo: "CONTA",    descricao: "Software e Licenças" },
];

const dfcInicial: DemoItem[] = [
  { id: "f1",  nivel: 1, tipo: "SUBTOTAL", descricao: "ATIVIDADES OPERACIONAIS" },
  { id: "f2",  nivel: 2, tipo: "CONTA",    descricao: "Recebimento de Clientes" },
  { id: "f3",  nivel: 2, tipo: "CONTA",    descricao: "Pagamento a Fornecedores" },
  { id: "f4",  nivel: 2, tipo: "CONTA",    descricao: "Pagamento de Salários" },
  { id: "f5",  nivel: 1, tipo: "SUBTOTAL", descricao: "ATIVIDADES DE INVESTIMENTO" },
  { id: "f6",  nivel: 2, tipo: "CONTA",    descricao: "Aquisição de Imobilizado" },
  { id: "f7",  nivel: 2, tipo: "CONTA",    descricao: "Recebimento de Alienações" },
  { id: "f8",  nivel: 1, tipo: "SUBTOTAL", descricao: "ATIVIDADES DE FINANCIAMENTO" },
  { id: "f9",  nivel: 2, tipo: "CONTA",    descricao: "Empréstimos e Financiamentos" },
  { id: "f10", nivel: 2, tipo: "CONTA",    descricao: "Amortizações" },
];

// ─── Helpers de hierarquia ────────────────────────────────────────────────────

function computeCodes(items: DemoItem[]): string[] {
  const counters = Array(12).fill(0) as number[];
  let prevNivel = 0;
  return items.map(item => {
    const n = item.nivel;
    // If jumping more than 1 level deep, fill the gap so codes never contain "0"
    if (n > prevNivel + 1) {
      for (let i = prevNivel + 1; i < n; i++) {
        if (counters[i] === 0) counters[i] = 1;
      }
    }
    counters[n]++;
    for (let i = n + 1; i < counters.length; i++) counters[i] = 0;
    const parts: number[] = [];
    for (let i = 1; i <= n; i++) parts.push(counters[i]);
    prevNivel = n;
    return parts.join(".");
  });
}

function getDirectChildCodes(data: DemoItem[], codes: string[], parentIdx: number): string[] {
  const parentLevel = data[parentIdx].nivel;
  const result: string[] = [];
  for (let i = parentIdx + 1; i < data.length; i++) {
    if (data[i].nivel <= parentLevel) break;
    if (data[i].nivel === parentLevel + 1) result.push(codes[i]);
  }
  return result;
}

function getDescendantCount(data: DemoItem[], parentIdx: number): number {
  const parentLevel = data[parentIdx].nivel;
  let count = 0;
  for (let i = parentIdx + 1; i < data.length; i++) {
    if (data[i].nivel <= parentLevel) break;
    count++;
  }
  return count;
}

// ─── Estilo de linha ──────────────────────────────────────────────────────────

function getRowStyle(tipo: string, nivel: number): { background: string; color: string; fontWeight?: string } {
  if (tipo === "SUBTOTAL") {
    if (nivel === 1) return { background: "#1e3a5f", color: "white",   fontWeight: "700" };
    if (nivel === 2) return { background: "#dbeafe", color: "#1e3a5f", fontWeight: "600" };
    return              { background: "#f0f9ff", color: "#1e3a5f", fontWeight: "600" };
  }
  return { background: "white", color: "#334155" };
}

// ─── AccountPicker ────────────────────────────────────────────────────────────

interface AccountOption { cod: string; descr: string; grau: number; analitico: boolean; ativo: boolean; classificacao?: string; }

function AccountPicker({ value, onChange, options, placeholder = "— Selecionar —" }: {
  value?: string; onChange: (cod: string) => void; options: AccountOption[]; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [somenteAnaliticos, setSomenteAnaliticos] = useState(false);
  const [classFiltro, setClassFiltro] = useState("");

  const classificacoes = useMemo(() => {
    const vals = new Set<string>();
    options.forEach(o => { if (o.classificacao && o.classificacao !== "") vals.add(o.classificacao); });
    return Array.from(vals).sort();
  }, [options]);

  const filtered = useMemo(() => options.filter(o => {
    if (o.ativo === false) return false;
    if (somenteAnaliticos && !o.analitico) return false;
    if (classFiltro && o.classificacao !== classFiltro) return false;
    if (search) { const q = search.toLowerCase(); return o.cod.toLowerCase().includes(q) || o.descr.toLowerCase().includes(q); }
    return true;
  }), [options, search, somenteAnaliticos, classFiltro]);

  const selected = value ? options.find(o => o.cod === value) : null;

  return (
    <div>
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white hover:border-blue-400 focus:outline-none transition-colors text-left">
        {selected ? (
          <span className="font-mono text-xs text-gray-800 truncate flex-1">
            <span className="text-blue-700 font-semibold">{selected.cod}</span>
            <span className="text-gray-500"> — </span>{selected.descr}
          </span>
        ) : <span className="text-gray-400 text-sm flex-1">{placeholder}</span>}
        <ChevronDown size={14} className={`text-gray-400 flex-shrink-0 ml-2 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-1 border border-gray-200 rounded-lg bg-white shadow-md overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar código ou descrição..."
              className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 outline-none focus:border-blue-400" />
          </div>
          <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-2">
            <input type="checkbox" checked={somenteAnaliticos} onChange={e => setSomenteAnaliticos(e.target.checked)}
              className="w-3.5 h-3.5 cursor-pointer" style={{ accentColor: "#1e3a5f" }} />
            <span className="text-xs text-gray-600 cursor-pointer select-none" onClick={() => setSomenteAnaliticos(v => !v)}>Apenas analíticos</span>
          </div>
          {classificacoes.length > 0 && (
            <div className="px-3 py-1.5 border-b border-gray-100 flex flex-wrap gap-1">
              <button type="button"
                onClick={() => setClassFiltro("")}
                className="px-2 py-0.5 text-[10px] font-medium rounded border transition-all"
                style={classFiltro === "" ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#6b7280", borderColor: "#d1d5db" }}>
                Todos
              </button>
              {classificacoes.map(c => (
                <button key={c} type="button"
                  onClick={() => setClassFiltro(prev => prev === c ? "" : c)}
                  className="px-2 py-0.5 text-[10px] font-medium rounded border transition-all"
                  style={classFiltro === c ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#6b7280", borderColor: "#d1d5db" }}>
                  {c}
                </button>
              ))}
            </div>
          )}
          <div className="max-h-44 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-400 text-center">
                {options.length === 0 ? "Nenhum dado. Sincronize em Configurações." : "Nenhum resultado."}
              </p>
            ) : filtered.map(o => (
              <button key={o.cod} type="button"
                onClick={() => { onChange(o.cod); setOpen(false); setSearch(""); }}
                className={`w-full text-left flex items-center gap-2 py-1.5 pr-3 hover:bg-blue-50 transition-colors ${o.cod === value ? "bg-blue-50" : ""}`}
                style={{ paddingLeft: `${12 + (o.grau - 1) * 14}px` }}>
                <span className="font-mono text-xs text-blue-700 flex-shrink-0 w-20">{o.cod}</span>
                <span className="text-gray-700 text-xs truncate flex-1">{o.descr}</span>
                {o.analitico && <span className="flex-shrink-0 text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Anal.</span>}
              </button>
            ))}
          </div>
          {value && (
            <div className="p-2 border-t border-gray-100">
              <button type="button" onClick={() => { onChange(""); setOpen(false); }}
                className="text-xs text-red-500 hover:text-red-700 transition-colors">Limpar seleção</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── RegraSection ─────────────────────────────────────────────────────────────

function RegraSection({ titulo, regra, onChange, options }: {
  titulo: string; regra: RegraItem | undefined; onChange: (r: RegraItem | undefined) => void; options: AccountOption[];
}) {
  const modo = regra?.modo ?? "none";
  const intervaloInvalido = modo === "intervalo" && !!regra?.codDe && !!regra?.codAte &&
    regra.codDe.localeCompare(regra.codAte, undefined, { numeric: true, sensitivity: "base" }) > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
      <div className="px-3 py-2 bg-gray-100 border-b border-gray-200 flex items-center gap-2">
        <Settings2 size={13} className="text-gray-500" />
        <span className="text-xs font-semibold text-gray-700">{titulo}</span>
      </div>
      <div className="p-3 space-y-3">
        <div className="flex gap-1">
          {([["none", "Nenhum"], ["especifico", "Específico"], ["intervalo", "Intervalo"]] as [RegraMode, string][]).map(([v, l]) => (
            <button key={v} type="button" onClick={() => onChange(v === "none" ? undefined : { modo: v })}
              className="px-2.5 py-1 text-xs font-medium rounded-md border transition-all"
              style={modo === v ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#6b7280", borderColor: "#d1d5db" }}>
              {l}
            </button>
          ))}
        </div>
        {modo === "especifico" && (
          <AccountPicker value={regra?.codEspecifico}
            onChange={cod => onChange({ modo: "especifico", codEspecifico: cod || undefined })}
            options={options} placeholder="— Selecionar conta —" />
        )}
        {modo === "intervalo" && (
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">De (início)</label>
              <AccountPicker value={regra?.codDe}
                onChange={cod => onChange({ modo: "intervalo", codDe: cod || undefined, codAte: regra?.codAte })}
                options={options} placeholder="— Início —" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Até (fim)</label>
              <AccountPicker value={regra?.codAte}
                onChange={cod => onChange({ modo: "intervalo", codDe: regra?.codDe, codAte: cod || undefined })}
                options={options} placeholder="— Fim —" />
            </div>
            {intervaloInvalido && (
              <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                <AlertTriangle size={12} className="flex-shrink-0" />
                <span>"De" deve ser anterior ou igual ao "Até".</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Chips ────────────────────────────────────────────────────────────────────

function RegraChips({ regras }: { regras?: RegrasLinha }) {
  if (!regras) return <span className="text-gray-300 text-xs">—</span>;
  const chips: { label: string; color: string }[] = [];
  const cr = regras.centroResultado;
  if (cr && cr.modo !== "none") {
    if (cr.modo === "especifico" && cr.codEspecifico)
      chips.push({ label: `CR: ${cr.codEspecifico}`, color: "bg-purple-100 text-purple-700" });
    else if (cr.modo === "intervalo" && (cr.codDe || cr.codAte))
      chips.push({ label: `CR: ${cr.codDe ?? "?"} → ${cr.codAte ?? "?"}`, color: "bg-purple-100 text-purple-700" });
  }
  const nat = regras.natureza;
  if (nat && nat.modo !== "none") {
    if (nat.modo === "especifico" && nat.codEspecifico)
      chips.push({ label: `NAT: ${nat.codEspecifico}`, color: "bg-emerald-100 text-emerald-700" });
    else if (nat.modo === "intervalo" && (nat.codDe || nat.codAte))
      chips.push({ label: `NAT: ${nat.codDe ?? "?"} → ${nat.codAte ?? "?"}`, color: "bg-emerald-100 text-emerald-700" });
  }
  if (chips.length === 0) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c, i) => (
        <span key={i} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold font-mono ${c.color}`}>{c.label}</span>
      ))}
    </div>
  );
}

function ComposicaoChips({ childCodes, totalDescendants, isOnDark, formula, subtotalMap }: {
  childCodes: string[]; totalDescendants: number; isOnDark: boolean;
  formula?: FormulaItem[]; subtotalMap: Map<string, { code: string; descricao: string }>;
}) {
  // Fórmula personalizada definida
  if (formula !== undefined) {
    const safeFormula = Array.isArray(formula) ? formula : [];
    if (safeFormula.length === 0) return (
      <span style={{ opacity: 0.4 }} className="text-xs italic">Fórmula vazia</span>
    );
    return (
      <div className="flex flex-wrap gap-1 items-center">
        <span style={{ opacity: 0.5 }} className="text-[10px] mr-0.5">∑</span>
        {safeFormula.map(fi => {
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

  // Composição automática por filhos
  if (childCodes.length === 0) return <span style={{ opacity: 0.35 }} className="text-xs">Sem itens</span>;
  const MAX = 5;
  const visible = childCodes.slice(0, MAX);
  const extra = childCodes.length - MAX;
  const chip = isOnDark ? "bg-white/20 text-white" : "bg-white/80 text-blue-700 border border-blue-200";
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {visible.map(code => (
        <span key={code} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${chip}`}>{code}</span>
      ))}
      {extra > 0 && <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${chip}`}>+{extra}</span>}
      <span style={{ opacity: 0.5 }} className="text-[10px] ml-0.5">({totalDescendants} {totalDescendants === 1 ? "item" : "itens"})</span>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function ItemModal({ mode, aba, item, natOpts, crOpts, subtotais, onSave, onClose }: {
  mode: "add" | "edit"; aba: Demonstrativo; item: Partial<DemoItem>;
  natOpts: AccountOption[]; crOpts: AccountOption[];
  subtotais: { id: string; code: string; descricao: string }[];
  onSave: (item: Partial<DemoItem>) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<DemoItem>>(item);

  function set<K extends keyof DemoItem>(key: K, val: DemoItem[K]) { setForm(f => ({ ...f, [key]: val })); }
  function setRegras(patch: Partial<RegrasLinha>) { setForm(f => ({ ...f, regras: { ...f.regras, ...patch } })); }

  function safeFormula(): FormulaItem[] { return Array.isArray(form.formula) ? form.formula : []; }

  function toggleFormulaItem(id: string) {
    const cur = safeFormula();
    const exists = cur.find(f => f.subtotalId === id);
    set("formula", exists ? cur.filter(f => f.subtotalId !== id) : [...cur, { subtotalId: id, sinal: "+" }]);
  }

  function toggleSinal(id: string) {
    set("formula", safeFormula().map(f => f.subtotalId === id ? { ...f, sinal: f.sinal === "+" ? "-" : "+" } : f));
  }

  function handleSave() {
    if (!form.descricao?.trim()) { alert("Preencha a descrição."); return; }
    const cr = form.regras?.centroResultado;
    if (cr?.modo === "intervalo") {
      if (!cr.codDe || !cr.codAte) { alert("Informe início e fim do intervalo de CR."); return; }
      if (cr.codDe.localeCompare(cr.codAte, undefined, { numeric: true, sensitivity: "base" }) > 0) { alert("CR: 'De' deve ser anterior ao 'Até'."); return; }
    }
    const nat = form.regras?.natureza;
    if (nat?.modo === "intervalo") {
      if (!nat.codDe || !nat.codAte) { alert("Informe início e fim do intervalo de Natureza."); return; }
      if (nat.codDe.localeCompare(nat.codAte, undefined, { numeric: true, sensitivity: "base" }) > 0) { alert("Natureza: 'De' deve ser anterior ao 'Até'."); return; }
    }
    onSave(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col"
        style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">
            {mode === "add" ? `Adicionar linha — ${aba}` : "Editar linha"}
          </h2>
          <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {mode === "add" && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              A nova linha será adicionada no final da lista. Arraste-a para a posição correta na hierarquia.
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
            <div className="flex gap-2">
              {(["SUBTOTAL", "CONTA"] as ItemTipo[]).map(t => (
                <button key={t} type="button" onClick={() => set("tipo", t)}
                  className="flex-1 py-2 text-sm font-medium rounded-lg border transition-all"
                  style={(form.tipo ?? "CONTA") === t
                    ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" }
                    : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descrição *</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.descricao || ""}
              onChange={e => set("descricao", e.target.value.toUpperCase())}
              placeholder="Ex: Receita de Serviços"
            />
          </div>

          {form.tipo === "SUBTOTAL" && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-2">Composição</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => set("formula", undefined)}
                  className="flex-1 py-2 text-xs font-medium rounded-lg border transition-all"
                  style={form.formula === undefined
                    ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" }
                    : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
                  Agregar filhos
                </button>
                <button type="button" onClick={() => { if (form.formula === undefined) set("formula", []); }}
                  className="flex-1 py-2 text-xs font-medium rounded-lg border transition-all"
                  style={form.formula !== undefined
                    ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" }
                    : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
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
                                style={fi!.sinal === "+"
                                  ? { background: "#d1fae5", color: "#059669", borderColor: "#6ee7b7" }
                                  : { background: "#fee2e2", color: "#dc2626", borderColor: "#fca5a5" }}
                                title="Clique para alternar sinal">
                                {fi!.sinal}
                              </button>
                            ) : (
                              <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-gray-300 text-sm font-bold">+</span>
                            )}
                            <span className="font-mono text-xs text-blue-700 font-semibold flex-shrink-0 w-10">{s.code}</span>
                            <span className="text-xs text-gray-700 truncate">{s.descricao}</span>
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

          {form.tipo === "CONTA" && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-2">Regras da conta</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <RegraSection titulo="Centro de Resultado" regra={form.regras?.centroResultado}
                onChange={r => setRegras({ centroResultado: r })} options={crOpts} />
              <RegraSection titulo="Natureza" regra={form.regras?.natureza}
                onChange={r => setRegras({ natureza: r })} options={natOpts} />
              {crOpts.length === 0 && natOpts.length === 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  <AlertTriangle size={13} className="flex-shrink-0" />
                  Nenhum dado encontrado. Sincronize em Configurações.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 flex-shrink-0">
          <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors" onClick={onClose}>
            Cancelar
          </button>
          <button className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
            style={{ background: "#1e3a5f" }} onClick={handleSave}>
            {mode === "add" ? "Adicionar" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function DemonstrativosPage() {
  const [aba, setAba]         = useState<Demonstrativo>("DRE");
  const [dre, setDre]         = usePersistedData<DemoItem[]>("portal_dre", dreInicial);
  const [dfc, setDfc]         = usePersistedData<DemoItem[]>("portal_dfc", dfcInicial);
  const [modal, setModal]     = useState<{ open: boolean; mode: "add" | "edit"; item: Partial<DemoItem> } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Drag state — dataIdx = índice no array completo
  const [dragIdx, setDragIdx]   = useState<number | null>(null);
  const [overIdx, setOverIdx]   = useState<number | null>(null);
  const [overMode, setOverMode] = useState<DropMode>("after");

  const data    = aba === "DRE" ? dre : dfc;
  const setData = aba === "DRE" ? setDre : setDfc;

  const natData = useMemo(() => loadData<NaturezaRow[]>("portal_natureza", []), []);
  const crData  = useMemo(() => loadData<CentroResultadoRow[]>("portal_centro_resultado", []), []);

  const natOpts = useMemo<AccountOption[]>(() =>
    [...natData].sort((a, b) => a.CODNAT.localeCompare(b.CODNAT, undefined, { numeric: true, sensitivity: "base" }))
      .map(r => ({ cod: r.CODNAT, descr: r.DESCRNAT, grau: r.GRAU, analitico: r.ANALITICA ?? false, ativo: r.ATIVA !== false, classificacao: r.CLASSIFICACAO || "" })), [natData]);

  const crOpts = useMemo<AccountOption[]>(() =>
    [...crData].sort((a, b) => a.CODCENCUS.localeCompare(b.CODCENCUS, undefined, { numeric: true, sensitivity: "base" }))
      .map(r => ({ cod: r.CODCENCUS, descr: r.DESCRCENCUS, grau: r.GRAU, analitico: r.ANALITICO ?? false, ativo: r.ATIVO !== false, classificacao: r.CLASSIFICACAO || "" })), [crData]);

  const codes = useMemo(() => computeCodes(data), [data]);

  const subtotalMap = useMemo(() => {
    const m = new Map<string, { code: string; descricao: string }>();
    data.forEach((item, idx) => {
      if (item.tipo === "SUBTOTAL") m.set(item.id, { code: codes[idx], descricao: item.descricao });
    });
    return m;
  }, [data, codes]);

  const subtotaisParaFormula = useMemo(() => {
    const editingId = modal?.item?.id;
    return data
      .map((item, idx) => ({ id: item.id, tipo: item.tipo, code: codes[idx], descricao: item.descricao }))
      .filter(s => s.tipo === "SUBTOTAL" && s.id !== editingId);
  }, [data, codes, modal?.item?.id]);

  // Linhas visíveis (remove descendentes de colapsados)
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

  // ── handlers ──────────────────────────────────────────────────────────────

  function toggleCollapse(id: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function openAdd() {
    const selRow = selectedId ? data.find(r => r.id === selectedId) : null;
    setModal({ open: true, mode: "add", item: { nivel: selRow?.nivel ?? 1, tipo: "CONTA", descricao: "" } });
  }

  function openEdit(row: DemoItem) {
    setModal({ open: true, mode: "edit", item: { ...row, regras: row.regras ? { ...row.regras } : undefined } });
  }

  function handleSave(item: Partial<DemoItem>) {
    if (!modal) return;
    if (modal.mode === "add") {
      const newItem: DemoItem = {
        id: `item_${Date.now()}`,
        nivel: item.nivel ?? 1,
        tipo: item.tipo || "CONTA",
        descricao: item.descricao || "",
        regras: item.tipo === "CONTA" ? item.regras : undefined,
        formula: item.tipo === "SUBTOTAL" ? item.formula : undefined,
      };
      setData(d => {
        if (!selectedId) return [...d, newItem];
        const idx = d.findIndex(r => r.id === selectedId);
        if (idx === -1) return [...d, newItem];
        const arr = [...d];
        arr.splice(idx + 1, 0, newItem);
        return arr;
      });
      setSelectedId(newItem.id);
    } else {
      setData(d => d.map(r => r.id === item.id
        ? { ...r, ...item, regras: item.tipo === "CONTA" ? item.regras : undefined, formula: item.tipo === "SUBTOTAL" ? item.formula : undefined }
        : r));
    }
    setModal(null);
  }

  function handleDelete(id: string) {
    if (confirm("Remover esta linha?")) setData(d => d.filter(r => r.id !== id));
  }

  function handleIndent(dataIdx: number) {
    setData(d => {
      const arr = [...d];
      const prev = arr[dataIdx - 1];
      const maxNivel = prev ? prev.nivel + 1 : 1;
      if (arr[dataIdx].nivel >= maxNivel) return d;
      arr[dataIdx] = { ...arr[dataIdx], nivel: arr[dataIdx].nivel + 1 };
      return arr;
    });
  }

  function handleUnindent(dataIdx: number) {
    setData(d => {
      const arr = [...d];
      if (arr[dataIdx].nivel <= 1) return d;
      arr[dataIdx] = { ...arr[dataIdx], nivel: arr[dataIdx].nivel - 1 };
      return arr;
    });
  }

  // ── drag-and-drop hierárquico ──────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, dataIdx: number) {
    setDragIdx(dataIdx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dataIdx));
  }

  function handleDragOver(e: React.DragEvent, dataIdx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    // Calcula posição relativa do cursor na linha
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY = (e.clientY - rect.top) / rect.height;
    const isSubtotal = data[dataIdx]?.tipo === "SUBTOTAL";

    let mode: DropMode;
    if (isSubtotal && relY > 0.25 && relY < 0.75) {
      mode = "inside"; // soltar dentro do subtotal → vira filho
    } else {
      mode = relY < 0.5 ? "before" : "after";
    }

    setOverIdx(dataIdx);
    setOverMode(mode);
  }

  function handleDrop(e: React.DragEvent, targetDataIdx: number) {
    e.preventDefault();
    if (dragIdx === null) { clearDrag(); return; }
    if (dragIdx === targetDataIdx && overMode !== "inside") { clearDrag(); return; }

    const targetRow = data[targetDataIdx];

    setData(d => {
      const arr = [...d];
      const [dragged] = arr.splice(dragIdx, 1);

      // Índice do alvo após remoção do item arrastado
      const adjustedTarget = dragIdx < targetDataIdx ? targetDataIdx - 1 : targetDataIdx;
      const targetAfterRemoval = arr[adjustedTarget];

      let newNivel: number;
      let insertAt: number;

      if (overMode === "inside") {
        // Filho direto do SUBTOTAL alvo
        newNivel  = targetRow.nivel + 1;
        insertAt  = adjustedTarget + 1;
      } else if (overMode === "before") {
        newNivel  = targetAfterRemoval?.nivel ?? 1;
        insertAt  = adjustedTarget;
      } else {
        // after
        newNivel  = targetAfterRemoval?.nivel ?? 1;
        insertAt  = adjustedTarget + 1;
      }

      // Prevent level gaps: max nivel is prevItem.nivel + 1
      const prevItem = arr[insertAt - 1];
      const maxNivel = prevItem ? prevItem.nivel + 1 : 1;
      newNivel = Math.min(newNivel, maxNivel);

      arr.splice(insertAt, 0, { ...dragged, nivel: newNivel });
      return arr;
    });

    clearDrag();
  }

  function clearDrag() { setDragIdx(null); setOverIdx(null); }
  function handleDragEnd() { clearDrag(); }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader title="Demonstrativos" subtitle="Estrutura do plano de contas e hierarquias">
        <button
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
          style={{ background: "#1e3a5f" }}
          onClick={openAdd}
        >
          <Plus size={15} /> Adicionar Linha
        </button>
      </PageHeader>

      {/* Abas */}
      <div className="flex gap-0 border-b border-slate-200 bg-white px-6">
        {(["DRE", "DFC"] as Demonstrativo[]).map(d => (
          <button key={d}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
              aba === d ? "border-[#1e3a5f] text-[#1e3a5f]" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
            onClick={() => setAba(d)}>
            <FileText size={14} />
            {d === "DRE" ? "Demonstração do Resultado (DRE)" : "Fluxo de Caixa (DFC)"}
          </button>
        ))}
      </div>

      <div className="p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">

          {/* Cabeçalho */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-wrap gap-3">
            <div>
              <span className="font-semibold text-gray-800 text-sm">
                {aba === "DRE" ? "Demonstração do Resultado do Exercício" : "Demonstração do Fluxo de Caixa"}
              </span>
              <span className="ml-3 text-xs text-gray-400">{data.length} linhas</span>
            </div>
            <div className="flex gap-4 text-xs text-gray-500 items-center">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: "#1e3a5f" }} />Subtotal nível 1
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: "#dbeafe", border: "1px solid #bfdbfe" }} />Subtotal nível 2+
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: "white", border: "1px solid #e2e8f0" }} />Conta
              </span>
              <span className="text-gray-400 text-[11px] border-l border-gray-200 pl-4">
                ↕ arraste entre linhas · arraste sobre SUBTOTAL para entrar como filho
              </span>
            </div>
          </div>

          {/* Tabela */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ background: "#1e3a5f" }}>
                  <th className="w-8 px-2 py-2.5" />
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-left w-20">CÓD.</th>
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-left w-24">TIPO</th>
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-left">DESCRIÇÃO</th>
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-left w-64">COMPOSIÇÃO / REGRAS</th>
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-center w-36">AÇÕES</th>
                </tr>
              </thead>
              <tbody onDragLeave={() => { setOverIdx(null); }}>
                {visibleData.map(({ item: row, dataIdx }) => {
                  const style        = getRowStyle(row.tipo, row.nivel);
                  const isOnDark     = style.background === "#1e3a5f";
                  const isDragging   = dragIdx === dataIdx;
                  const isOver       = overIdx === dataIdx && dragIdx !== null;
                  const isSubtotal   = row.tipo === "SUBTOTAL";
                  const hasChildren  = isSubtotal && dataIdx + 1 < data.length && (data[dataIdx + 1]?.nivel ?? 0) > row.nivel;
                  const isCollapsed  = hasChildren && collapsed.has(row.id);
                  const isSelected   = selectedId === row.id;
                  const childCodes   = isSubtotal ? getDirectChildCodes(data, codes, dataIdx) : [];
                  const descendCount = isSubtotal ? getDescendantCount(data, dataIdx) : 0;

                  // Indicador visual de drop
                  const dropStyle: React.CSSProperties = isOver
                    ? overMode === "before"  ? { boxShadow: "inset 0 3px 0 #3b82f6" }
                    : overMode === "after"   ? { boxShadow: "inset 0 -3px 0 #3b82f6" }
                    : /* inside */             { outline: "2px solid #3b82f6", outlineOffset: "-2px", zIndex: 1, position: "relative" }
                    : isSelected && !isOnDark  ? { outline: "2px solid #f59e0b", outlineOffset: "-2px", zIndex: 1, position: "relative" }
                    : isSelected && isOnDark   ? { outline: "2px solid #fbbf24", outlineOffset: "-2px", zIndex: 1, position: "relative" }
                    : {};

                  return (
                    <tr key={row.id}
                      draggable
                      onClick={() => { setSelectedId(row.id === selectedId ? null : row.id); if (hasChildren) toggleCollapse(row.id); }}
                      onDragStart={e => handleDragStart(e, dataIdx)}
                      onDragOver={e => handleDragOver(e, dataIdx)}
                      onDrop={e => handleDrop(e, dataIdx)}
                      onDragEnd={handleDragEnd}
                      style={{
                        background: style.background,
                        color: style.color,
                        fontWeight: style.fontWeight,
                        opacity: isDragging ? 0.3 : 1,
                        transition: "opacity 0.15s",
                        cursor: "pointer",
                        ...dropStyle,
                      }}
                      className="border-b border-gray-100 select-none"
                    >
                      {/* Handle */}
                      <td className="px-2 py-2 w-8" style={{ cursor: "grab" }}>
                        <GripVertical size={14} className="mx-auto" style={{ opacity: 0.35 }} />
                      </td>

                      {/* Código */}
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs font-semibold" style={{ opacity: 0.7 }}>{codes[dataIdx]}</span>
                      </td>

                      {/* Tipo */}
                      <td className="px-3 py-2">
                        <span className="text-xs font-semibold">{row.tipo}</span>
                      </td>

                      {/* Descrição + toggle */}
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5" style={{ paddingLeft: `${(row.nivel - 1) * 18}px` }}>
                          {isSubtotal ? (
                            <span className="flex-shrink-0 rounded p-0.5"
                              style={{ color: isOnDark ? "rgba(255,255,255,0.7)" : "#1e3a5f" }}>
                              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            </span>
                          ) : (
                            <span className="w-5 flex-shrink-0" />
                          )}
                          {row.descricao}
                        </span>
                      </td>

                      {/* Composição / Regras */}
                      <td className="px-3 py-2 text-xs">
                        {isSubtotal
                          ? <ComposicaoChips childCodes={childCodes} totalDescendants={descendCount} isOnDark={isOnDark} formula={row.formula} subtotalMap={subtotalMap} />
                          : <RegraChips regras={row.regras} />}
                      </td>

                      {/* Ações */}
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-0.5">
                          {/* Desindentar */}
                          <button
                            onClick={() => handleUnindent(dataIdx)}
                            disabled={row.nivel <= 1}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: row.nivel <= 1 ? (isOnDark ? "rgba(255,255,255,0.2)" : "#d1d5db") : (isOnDark ? "rgba(255,255,255,0.6)" : "#64748b") }}
                            onMouseEnter={e => { if (row.nivel > 1 && !isOnDark) (e.currentTarget as HTMLElement).style.background = "#f1f5f9"; }}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                            title="Desindentar (←)">
                            <Outdent size={13} />
                          </button>
                          {/* Indentar */}
                          <button
                            onClick={() => handleIndent(dataIdx)}
                            disabled={dataIdx === 0 || row.nivel >= (data[dataIdx - 1]?.nivel ?? 0) + 1}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: (dataIdx === 0 || row.nivel >= (data[dataIdx - 1]?.nivel ?? 0) + 1) ? (isOnDark ? "rgba(255,255,255,0.2)" : "#d1d5db") : (isOnDark ? "rgba(255,255,255,0.6)" : "#64748b") }}
                            onMouseEnter={e => { if (dataIdx > 0 && row.nivel < (data[dataIdx - 1]?.nivel ?? 0) + 1 && !isOnDark) (e.currentTarget as HTMLElement).style.background = "#f1f5f9"; }}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                            title="Indentar (→)">
                            <Indent size={13} />
                          </button>
                          <div className="w-px h-4 bg-current opacity-10 mx-0.5" />
                          <button onClick={(e) => { e.stopPropagation(); openEdit(row); }}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: isOnDark ? "rgba(255,255,255,0.6)" : "#3b82f6" }}
                            onMouseEnter={e => { if (!isOnDark) (e.currentTarget as HTMLElement).style.background = "#eff6ff"; }}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                            title="Editar">
                            <Pencil size={13} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: isOnDark ? "rgba(255,255,255,0.6)" : "#94a3b8" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ef4444"; (e.currentTarget as HTMLElement).style.background = "#fef2f2"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = isOnDark ? "rgba(255,255,255,0.6)" : "#94a3b8"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                            title="Remover">
                            <Trash2 size={13} />
                          </button>
                          <div className="w-px h-4 bg-current opacity-10 mx-0.5" />
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedId(row.id); openAdd(); }}
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
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">
                      Nenhuma linha adicionada. Clique em "Adicionar Linha" para começar.
                    </td>
                  </tr>
                )}
                <tr>
                  <td colSpan={6}>
                    <button
                      onClick={() => { setSelectedId(data[data.length - 1]?.id ?? null); openAdd(); }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 text-xs text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors group"
                    >
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
        <ItemModal mode={modal.mode} aba={aba} item={modal.item}
          natOpts={natOpts} crOpts={crOpts} subtotais={subtotaisParaFormula}
          onSave={handleSave} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
