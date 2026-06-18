"use client";

import React, { useState, useMemo, useRef } from "react";
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Download, Eye, EyeOff, Hash, GripVertical, Filter, MessageSquare, Link2, X } from "lucide-react";
import * as XLSX from "xlsx";
import PageHeader from "@/components/PageHeader";
import SearchableSelect from "@/components/SearchableSelect";
import { usePersistedData, loadData } from "@/lib/storage";
import { buildHierarchy } from "@/lib/utils";
import type { IndicadorRow, CentroResultadoRow } from "@/lib/mockData";

type Categoria  = "receita" | "gastos" | "impostos" | "indicador";
type TipoLinha  = "digitado"  | "calculado"  | "subtotal";
type OpFormula  = "*" | "+" | "-" | "/";
type RefDRE     = "contabil" | "gerencial";

type ExprToken =
  | { t: "ref"; id: string; offset: 0 | -1 | 1 }
  | { t: "num"; v: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "(" | ")" };

interface RegraItem { modo: "none"|"especifico"|"intervalo"|"multiplo"; codEspecifico?: string; codDe?: string; codAte?: string; codMultiplos?: string[] }
interface DemoItem  { id: string; nivel: number; tipo: "SUBTOTAL"|"CONTA"; descricao: string; regras?: { centroResultado?: RegraItem; natureza?: RegraItem } }

interface FormulaOperando { linhaId: string; offset: 0 | -1 | 1; valorFixo?: number }
interface Formula         { op: OpFormula; left: FormulaOperando; right: FormulaOperando }

interface ComposicaoItem { id: string; descricao: string; valores: Record<string, number>; comentario?: string; demoItemIdGerencial?: string; demoItemIdContabil?: string; centroId?: string; projetoId?: string; parceiroId?: string }

interface LinhaOrcamento {
  id: string; descricao: string; categoria: Categoria; tipo: TipoLinha;
  isPercentual?: boolean; demoItemIdGerencial?: string; demoItemIdContabil?: string; codIndicador?: string;
  naturezaId?: string; centroResultadoId?: string;
  composicao?: ComposicaoItem[];
  formula?: Formula;
  formulaExpr?: ExprToken[];
  valores: Record<string, number>;
  subtotalLinhaIds?: string[];
}
interface SubBloco { id: string; descricao: string; linhas: LinhaOrcamento[]; totalizar?: boolean }
interface Bloco    { id: string; descricao: string; subBlocos: SubBloco[]; totalizar?: boolean }

const MESES     = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

type ViewMode = "mensal" | "trimestral" | "quadrimestral" | "semestral";
interface FiltrosOrc { periodoInicio: string; periodoFim: string; viewMode: ViewMode }
const VIEW_LABELS: Record<ViewMode, string> = {
  mensal: "Mensal", trimestral: "Trimestral", quadrimestral: "Quadrimestral", semestral: "Semestral",
};
const GRUPOS_DEF: Record<ViewMode, { label: string; sub: string; meses: number[] }[]> = {
  mensal: MESES.map((label, i) => ({ label, sub: "", meses: [i] })),
  trimestral: [
    { label: "1º Trim.",    sub: "Jan · Fev · Mar",                  meses: [0,1,2]      },
    { label: "2º Trim.",    sub: "Abr · Mai · Jun",                  meses: [3,4,5]      },
    { label: "3º Trim.",    sub: "Jul · Ago · Set",                  meses: [6,7,8]      },
    { label: "4º Trim.",    sub: "Out · Nov · Dez",                  meses: [9,10,11]    },
  ],
  quadrimestral: [
    { label: "1º Quadrim.", sub: "Jan · Fev · Mar · Abr",            meses: [0,1,2,3]    },
    { label: "2º Quadrim.", sub: "Mai · Jun · Jul · Ago",            meses: [4,5,6,7]    },
    { label: "3º Quadrim.", sub: "Set · Out · Nov · Dez",            meses: [8,9,10,11]  },
  ],
  semestral: [
    { label: "1º Sem.",     sub: "Jan · Fev · Mar · Abr · Mai · Jun", meses: [0,1,2,3,4,5]   },
    { label: "2º Sem.",     sub: "Jul · Ago · Set · Out · Nov · Dez", meses: [6,7,8,9,10,11]  },
  ],
};
const OP_LABELS: Record<OpFormula, string> = { "*": "×", "+": "+", "-": "−", "/": "÷" };
const OFFSET_LABELS: Record<string, string> = { "0": "Mês atual", "-1": "Mês anterior", "1": "Próximo mês" };

const uid = () => Math.random().toString(36).slice(2, 9);
const pk  = (ano: number, m: number) => `${ano}-${String(m + 1).padStart(2, "0")}`;

function _applyOp(op: string, stk: number[]) {
  const b = stk.pop() ?? 0, a = stk.pop() ?? 0;
  if (op === "+") stk.push(a + b);
  else if (op === "-") stk.push(a - b);
  else if (op === "*") stk.push(a * b);
  else stk.push(b !== 0 ? a / b : 0);
}
function evalExprTokens(tokens: ExprToken[], resolve: (id: string, offset: 0|-1|1) => number): number {
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const out: number[] = [], ops: string[] = [];
  for (const tok of tokens) {
    if (tok.t === "ref") { out.push(resolve(tok.id, tok.offset)); }
    else if (tok.t === "num") { out.push(tok.v); }
    else {
      const v = tok.v;
      if (v === "(") { ops.push(v); }
      else if (v === ")") {
        while (ops.length && ops[ops.length-1] !== "(") _applyOp(ops.pop()!, out);
        ops.pop();
      } else {
        while (ops.length && ops[ops.length-1] !== "(" && (prec[ops[ops.length-1]] ?? 0) >= (prec[v] ?? 0)) _applyOp(ops.pop()!, out);
        ops.push(v);
      }
    }
  }
  while (ops.length) _applyOp(ops.pop()!, out);
  return out[0] ?? 0;
}

function evalLinha(linha: LinhaOrcamento, todas: LinhaOrcamento[], ano: number, mi: number, allLinhas?: Map<string, LinhaOrcamento>, _depth = 0): number {
  if (_depth > 30) return 0;
  if (linha.tipo === "subtotal") {
    return (linha.subtotalLinhaIds ?? []).reduce((s, id) => {
      const ref = allLinhas?.get(id) ?? todas.find(l => l.id === id);
      if (!ref) return s;
      return s + evalLinha(ref, todas, ano, mi, allLinhas, _depth + 1);
    }, 0);
  }
  if (linha.tipo === "digitado") {
    if (linha.composicao && linha.composicao.length > 0)
      return linha.composicao.reduce((s, item) => s + (item.valores[pk(ano, mi)] ?? 0), 0);
    return linha.valores[pk(ano, mi)] ?? 0;
  }
  if (linha.formulaExpr && linha.formulaExpr.length > 0) {

    if (linha.formulaExpr.length === 3) {
      const [t0, t1, t2] = linha.formulaExpr;
      if (t0.t === "ref" && t1.t === "op" && t1.v === "*" && t2.t === "ref") {
        const tl = mi + t0.offset, tr = mi + t2.offset;
        if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
          const lL = todas.find(x => x.id === t0.id) ?? allLinhas?.get(t0.id);
          const rL = todas.find(x => x.id === t2.id) ?? allLinhas?.get(t2.id);
          if (lL?.composicao?.length && rL?.composicao?.length) {
            return lL.composicao.reduce((sum, li, idx) => {
              const ri = rL.composicao![idx]; if (!ri) return sum;
              const lv = (li.valores[pk(ano, tl)] ?? 0) / (lL.isPercentual ? 100 : 1);
              const rv = (ri.valores[pk(ano, tr)] ?? 0) / (rL.isPercentual ? 100 : 1);
              return sum + lv * rv;
            }, 0);
          }
        }
      }
    }
    return evalExprTokens(linha.formulaExpr, (id, offset) => {
      const t = mi + offset; if (t < 0 || t > 11) return 0;
      const l = todas.find(x => x.id === id) ?? allLinhas?.get(id); if (!l) return 0;
      const v = evalLinha(l, todas, ano, t, allLinhas, _depth + 1);
      return l.isPercentual ? v / 100 : v;
    });
  }
  if (!linha.formula) return 0;
  const { op, left, right } = linha.formula;
  if (op === "*" && left.valorFixo === undefined && right.valorFixo === undefined) {
    const tl = mi + left.offset, tr = mi + right.offset;
    if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
      const lL = todas.find(x => x.id === left.linhaId) ?? allLinhas?.get(left.linhaId);
      const rL = todas.find(x => x.id === right.linhaId) ?? allLinhas?.get(right.linhaId);
      if (lL?.composicao?.length && rL?.composicao?.length) {
        return lL.composicao.reduce((sum, li, idx) => {
          const ri = rL.composicao![idx];
          if (!ri) return sum;
          const lv = (li.valores[pk(ano, tl)] ?? 0) / (lL.isPercentual ? 100 : 1);
          const rv = (ri.valores[pk(ano, tr)] ?? 0) / (rL.isPercentual ? 100 : 1);
          return sum + lv * rv;
        }, 0);
      }
    }
  }
  const getV = (o: FormulaOperando) => {
    if (o.valorFixo !== undefined) return o.valorFixo;
    const t = mi + o.offset; if (t < 0 || t > 11) return 0;
    const l = todas.find(x => x.id === o.linhaId) ?? allLinhas?.get(o.linhaId); if (!l) return 0;
    const v = evalLinha(l, todas, ano, t, allLinhas, _depth + 1);
    return l.isPercentual ? v / 100 : v;
  };
  const lv = getV(left), rv = getV(right);
  if (op === "*") return lv * rv; if (op === "+") return lv + rv; if (op === "-") return lv - rv;
  return rv !== 0 ? lv / rv : 0;
}

function evalLinhaFiltered(
  linha: LinhaOrcamento, todas: LinhaOrcamento[], ano: number, mi: number,
  allLinhas: Map<string, LinhaOrcamento>, crFiltroSet: Set<string>, crIdToCod: Map<string, string>
): number {
  if (linha.tipo === "digitado") {
    if (linha.composicao && linha.composicao.length > 0) {
      return linha.composicao
        .filter(c => { if (!c.centroId) return true; const cod = crIdToCod.get(c.centroId); return !cod || crFiltroSet.has(cod); })
        .reduce((s, c) => s + (c.valores[pk(ano, mi)] ?? 0), 0);
    }
    if (linha.centroResultadoId) {
      const cod = crIdToCod.get(linha.centroResultadoId);
      return (cod && crFiltroSet.has(cod)) ? (linha.valores[pk(ano, mi)] ?? 0) : 0;
    }
    return 0;
  }
  if (linha.tipo === "subtotal") {
    return (linha.subtotalLinhaIds ?? []).reduce((s, id) => {
      const ref = allLinhas.get(id) ?? todas.find(l => l.id === id); if (!ref) return s;
      return s + evalLinhaFiltered(ref, todas, ano, mi, allLinhas, crFiltroSet, crIdToCod);
    }, 0);
  }
  // calculado
  if (linha.formulaExpr && linha.formulaExpr.length > 0) {
    if (linha.formulaExpr.length === 3) {
      const [t0, t1, t2] = linha.formulaExpr;
      if (t0.t === "ref" && t1.t === "op" && t1.v === "*" && t2.t === "ref") {
        const tl = mi + t0.offset, tr = mi + t2.offset;
        if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
          const lL = allLinhas.get(t0.id) ?? todas.find(x => x.id === t0.id);
          const rL = allLinhas.get(t2.id) ?? todas.find(x => x.id === t2.id);
          if (lL?.composicao?.length && rL?.composicao?.length) {
            return lL.composicao.reduce((sum, li, idx) => {
              if (!li.centroId) return sum;
              const cod = crIdToCod.get(li.centroId); if (!cod || !crFiltroSet.has(cod)) return sum;
              const ri = rL.composicao![idx]; if (!ri) return sum;
              const lv = (li.valores[pk(ano, tl)] ?? 0) / (lL.isPercentual ? 100 : 1);
              const rv = (ri.valores[pk(ano, tr)] ?? 0) / (rL.isPercentual ? 100 : 1);
              return sum + lv * rv;
            }, 0);
          }
        }
      }
    }
    return evalExprTokens(linha.formulaExpr, (id, offset) => {
      const t = mi + offset; if (t < 0 || t > 11) return 0;
      const l = allLinhas.get(id) ?? todas.find(x => x.id === id); if (!l) return 0;
      const v = evalLinhaFiltered(l, todas, ano, t, allLinhas, crFiltroSet, crIdToCod);
      return l.isPercentual ? v / 100 : v;
    });
  }
  if (!linha.formula) return 0;
  const { op, left, right } = linha.formula;
  if (op === "*" && left.valorFixo === undefined && right.valorFixo === undefined) {
    const tl = mi + left.offset, tr = mi + right.offset;
    if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
      const lL = allLinhas.get(left.linhaId) ?? todas.find(x => x.id === left.linhaId);
      const rL = allLinhas.get(right.linhaId) ?? todas.find(x => x.id === right.linhaId);
      if (lL?.composicao?.length && rL?.composicao?.length) {
        return lL.composicao.reduce((sum, li, idx) => {
          if (!li.centroId) return sum;
          const cod = crIdToCod.get(li.centroId); if (!cod || !crFiltroSet.has(cod)) return sum;
          const ri = rL.composicao![idx]; if (!ri) return sum;
          const lv = (li.valores[pk(ano, tl)] ?? 0) / (lL.isPercentual ? 100 : 1);
          const rv = (ri.valores[pk(ano, tr)] ?? 0) / (rL.isPercentual ? 100 : 1);
          return sum + lv * rv;
        }, 0);
      }
    }
  }
  const getVF = (o: FormulaOperando) => {
    if (o.valorFixo !== undefined) return o.valorFixo;
    const t = mi + o.offset; if (t < 0 || t > 11) return 0;
    const l = allLinhas.get(o.linhaId) ?? todas.find(x => x.id === o.linhaId); if (!l) return 0;
    const v = evalLinhaFiltered(l, todas, ano, t, allLinhas, crFiltroSet, crIdToCod);
    return l.isPercentual ? v / 100 : v;
  };
  const lv = getVF(left), rv = getVF(right);
  if (op === "*") return lv * rv; if (op === "+") return lv + rv; if (op === "-") return lv - rv;
  return rv !== 0 ? lv / rv : 0;
}

function fmtN(v: number) { if (v === 0) return ""; return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPercent(v: number) { if (v === 0) return ""; return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"; }

function Modal({ title, onClose, children, wide, xlWide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; xlWide?: boolean }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className={`bg-white rounded-xl shadow-2xl w-full ${xlWide ? "max-w-6xl" : wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] flex flex-col`} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
            <span className="font-semibold text-gray-800">{title}</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </div>
      </div>
    </>
  );
}

function ValoresModal({ linha, ano, onSave, onClose }: {
  linha: LinhaOrcamento; ano: number;
  onSave: (vals: Record<string, number>) => void;
  onClose: () => void;
}) {
  const [vals, setVals] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (let mi = 0; mi < 12; mi++) { const k = pk(ano, mi); init[k] = linha.valores[k] ?? 0; }
    return init;
  });
  const setVal = (mi: number, raw: string) => {
    const num = parseFloat(raw.replace(",", ".")); const k = pk(ano, mi);
    setVals(v => ({ ...v, [k]: isNaN(num) ? 0 : num }));
  };
  const total = MESES.reduce((s, _, mi) => s + (vals[pk(ano, mi)] ?? 0), 0);
  return (
    <Modal title={linha.descricao} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-xs text-gray-400 -mt-1">{ano}</p>
        <div className="grid grid-cols-3 gap-3">
          {MESES.map((m, mi) => (
            <div key={mi}>
              <label className="block text-xs font-medium text-gray-500 mb-1">{m}</label>
              <input type="number" step="any" value={vals[pk(ano, mi)] || ""}
                onChange={e => setVal(mi, e.target.value)}
                className="w-full text-right text-sm tabular-nums border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
                placeholder={linha.isPercentual ? "0%" : "0"} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between py-2 border-t border-gray-100">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total {ano}</span>
          <span className="text-sm font-semibold text-gray-700 tabular-nums">
            {total !== 0 ? (linha.isPercentual ? fmtPercent(total) : fmtN(total)) : <span className="text-gray-300">—</span>}
          </span>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">Cancelar</button>
          <button onClick={() => onSave(vals)} className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors" style={{ background: "#1e3a5f" }}>Salvar</button>
        </div>
      </div>
    </Modal>
  );
}

function parseBRNumber(s: string): number {
  const clean = s.trim().replace(/\s/g, "").replace(/[^0-9.,\-]/g, "");
  if (!clean) return 0;
  if (/^\-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean))
    return parseFloat(clean.replace(/\./g, "").replace(",", "."));
  if (/^\-?\d+(,\d+)?$/.test(clean))
    return parseFloat(clean.replace(",", "."));
  return parseFloat(clean) || 0;
}

function parseExcelPaste(text: string, ano: number): ComposicaoItem[] {
  const rows = text.trim().split(/\r?\n/).map(r => r.split("\t"));
  if (rows.length === 0) return [];
  const mesNomes = MESES.map(m => m.toLowerCase());
  let dataStart = 0;
  let monthOffset = 1;
  const firstRow = rows[0].map(c => c.trim().toLowerCase());
  if (firstRow.some(c => mesNomes.includes(c))) {
    dataStart = 1;
    const idx = firstRow.findIndex(c => mesNomes.includes(c));
    monthOffset = idx >= 0 ? idx : 1;
  }
  const result: ComposicaoItem[] = [];
  for (let ri = dataStart; ri < rows.length; ri++) {
    const row = rows[ri];
    const descricao = (row[0] ?? "").trim();
    if (!descricao) continue;
    const valores: Record<string, number> = {};
    for (let mi = 0; mi < 12; mi++) {
      const num = parseBRNumber(row[monthOffset + mi] ?? "");
      if (num !== 0) valores[pk(ano, mi)] = num;
    }
    result.push({ id: uid(), descricao, valores });
  }
  return result;
}

function ComposicaoModal({ linha, ano, onSave, onAutoSave, onClose }: {
  linha: LinhaOrcamento; ano: number;
  onSave: (composicao: ComposicaoItem[]) => void;
  onAutoSave?: (composicao: ComposicaoItem[]) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ComposicaoItem[]>(linha.composicao ?? []);
  const initialItemsRef = useRef(JSON.stringify(linha.composicao ?? []));
  function handleClose() {
    if (JSON.stringify(items) !== initialItemsRef.current) {
      if (!confirm("Há alterações não salvas. Deseja descartar as mudanças?")) return;
    }
    onClose();
  }
  type TipoAdicao = "livre" | "parceiro" | "projeto" | "centro" | "centro_parceiro" | "centro_projeto";
  const [tipoAdicao, setTipoAdicao] = useState<TipoAdicao>("livre");
  const [novaNome, setNovaNome] = useState("");
  const [selParceiro, setSelParceiro] = useState("");
  const [selProjeto, setSelProjeto] = useState("");
  const [selCentro, setSelCentro] = useState("");
  const parceiros = useMemo(() => loadData<{ id: string; CODPARC: string; NOMEPARC: string }[]>("portal_parceiro", []), []);
  const projetos  = useMemo(() => loadData<{ id: string; CODPROJ: string; IDENTIFICACAO: string; ATIVO: boolean; ANALITICO: boolean }[]>("portal_projetos", []).filter(p => p.ATIVO && p.ANALITICO), []);

  const parceiroOptions = useMemo(() => parceiros.map(p => ({ value: p.id, label: p.CODPARC ? `${p.CODPARC} — ${p.NOMEPARC}` : p.NOMEPARC })), [parceiros]);
  const projetoOptions  = useMemo(() => projetos.map(p => ({ value: p.id, label: p.CODPROJ ? `${p.CODPROJ} — ${p.IDENTIFICACAO}` : p.IDENTIFICACAO })), [projetos]);
  const centros = useMemo(() => loadData<{ id: string; CODCENCUS: string; DESCRCENCUS: string; ATIVO: boolean; ANALITICO: boolean }[]>("portal_centro_resultado", []).filter(c => c.ATIVO && c.ANALITICO), []);
  const centroOptions = useMemo(() => centros.map(c => ({ value: c.id, label: c.CODCENCUS ? `${c.CODCENCUS} — ${c.DESCRCENCUS}` : c.DESCRCENCUS })), [centros]);
  const dreGerComp = useMemo(() => loadData<DemoItem[]>("portal_dre", []), []);
  const dreCtbComp = useMemo(() => loadData<DemoItem[]>("portal_dre_contabil", []), []);
  const [dreAbertos, setDreAbertos] = useState<Set<string>>(new Set());
  function toggleDre(id: string) { setDreAbertos(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function setDemoG(itemId: string, val: string) { setItems(p => p.map(i => i.id !== itemId ? i : { ...i, demoItemIdGerencial: val })); }
  function setDemoC(itemId: string, val: string) { setItems(p => p.map(i => i.id !== itemId ? i : { ...i, demoItemIdContabil: val })); }
  const [searchCG, setSearchCG] = useState<Record<string, string>>({});
  const [searchCC, setSearchCC] = useState<Record<string, string>>({});

  function addItem() {
    let descricao = "";
    if (tipoAdicao === "livre") {
      if (!novaNome.trim()) return;
      descricao = novaNome.trim();
    } else if (tipoAdicao === "parceiro") {
      const p = parceiros.find(x => x.id === selParceiro);
      if (!p) return;
      descricao = p.NOMEPARC;
    } else if (tipoAdicao === "projeto") {
      const p = projetos.find(x => x.id === selProjeto);
      if (!p) return;
      descricao = p.IDENTIFICACAO;
    } else if (tipoAdicao === "centro") {
      const c = centros.find(x => x.id === selCentro);
      if (!c) return;
      descricao = c.CODCENCUS ? `${c.CODCENCUS} — ${c.DESCRCENCUS}` : c.DESCRCENCUS;
    } else if (tipoAdicao === "centro_parceiro") {
      const c = centros.find(x => x.id === selCentro);
      const p = parceiros.find(x => x.id === selParceiro);
      if (!c || !p) return;
      const crLabel = c.CODCENCUS ? `${c.CODCENCUS} — ${c.DESCRCENCUS}` : c.DESCRCENCUS;
      descricao = `${crLabel} | ${p.NOMEPARC}`;
    } else if (tipoAdicao === "centro_projeto") {
      const c = centros.find(x => x.id === selCentro);
      const p = projetos.find(x => x.id === selProjeto);
      if (!c || !p) return;
      const crLabel = c.CODCENCUS ? `${c.CODCENCUS} — ${c.DESCRCENCUS}` : c.DESCRCENCUS;
      descricao = `${crLabel} | ${p.IDENTIFICACAO}`;
    }
    if (items.some(i => i.descricao === descricao)) return;
    const newItem: ComposicaoItem = { id: uid(), descricao, valores: {} };
    if (tipoAdicao === "centro") { newItem.centroId = selCentro; }
    else if (tipoAdicao === "centro_projeto") { newItem.centroId = selCentro; newItem.projetoId = selProjeto; }
    else if (tipoAdicao === "centro_parceiro") { newItem.centroId = selCentro; newItem.parceiroId = selParceiro; }
    setItems(prev => [...prev, newItem]);
    setNovaNome(""); setSelParceiro(""); setSelProjeto(""); setSelCentro("");
  }
  function setValorItem(itemId: string, k: string, val: number) {
    setItems(p => p.map(i => i.id !== itemId ? i : { ...i, valores: { ...i.valores, [k]: val } }));
  }
  function deleteItem(itemId: string) { setItems(p => p.filter(i => i.id !== itemId)); }
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDesc, setEditingDesc] = useState("");
  const [editingCentro, setEditingCentro] = useState("");
  const [editingProjeto, setEditingProjeto] = useState("");
  const [editingParceiro, setEditingParceiro] = useState("");
  function startEdit(item: ComposicaoItem) { setEditingId(item.id); setEditingDesc(item.descricao); setEditingCentro(item.centroId ?? ""); setEditingProjeto(item.projetoId ?? ""); setEditingParceiro(item.parceiroId ?? ""); }
  function commitEdit() {
    if (editingId) {
      setItems(p => p.map(i => {
        if (i.id !== editingId) return i;
        if (i.centroId !== undefined) {
          const c = centros.find(x => x.id === editingCentro);
          const crLabel = c ? (c.CODCENCUS ? `${c.CODCENCUS} — ${c.DESCRCENCUS}` : c.DESCRCENCUS) : "";
          if (i.projetoId !== undefined) {
            const p = projetos.find(x => x.id === editingProjeto);
            const desc = (crLabel && p) ? `${crLabel} | ${p.IDENTIFICACAO}` : i.descricao;
            return { ...i, descricao: desc, centroId: editingCentro || i.centroId, projetoId: editingProjeto || i.projetoId };
          } else if (i.parceiroId !== undefined) {
            const p = parceiros.find(x => x.id === editingParceiro);
            const desc = (crLabel && p) ? `${crLabel} | ${p.NOMEPARC}` : i.descricao;
            return { ...i, descricao: desc, centroId: editingCentro || i.centroId, parceiroId: editingParceiro || i.parceiroId };
          } else {
            return { ...i, descricao: crLabel || i.descricao, centroId: editingCentro || i.centroId };
          }
        }
                const c2 = editingCentro ? centros.find(x => x.id === editingCentro) : undefined;
        const crLabel2 = c2 ? (c2.CODCENCUS ? `${c2.CODCENCUS} — ${c2.DESCRCENCUS}` : c2.DESCRCENCUS) : "";
        const upd = { ...i, descricao: editingDesc.trim() || crLabel2 || i.descricao };
        if (editingCentro) upd.centroId = editingCentro;
        return upd;
      }));
    }
    setEditingId(null);
  }
  const [cAbertos, setCAbertos] = useState<Set<string>>(new Set());
  function toggleComentario(id: string) { setCAbertos(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function setComentario(itemId: string, com: string) { setItems(p => p.map(i => i.id !== itemId ? i : { ...i, comentario: com })); }
  const [crAbertos, setCrAbertos] = useState<Set<string>>(new Set());
  function toggleCrPanel(id: string) { setCrAbertos(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function setCrItem(itemId: string, centroId: string) { setItems(p => p.map(i => i.id !== itemId ? i : { ...i, centroId: centroId || undefined })); }

  function handleCellPaste(e: React.ClipboardEvent<HTMLInputElement>, itemId: string, startMi: number) {
    const text = e.clipboardData.getData("text");
    const rows = text.trim().split(/\r?\n/);
    if (rows.length === 0) return;
    const itemIdx = items.findIndex(i => i.id === itemId);
    if (itemIdx === -1) return;
    e.preventDefault();
    setItems(prev => {
      const next = prev.map(i => ({ ...i, valores: { ...i.valores } }));
      rows.forEach((row, ri) => {
        const cells = row.split("\t");
        const valStart = cells.length > 1 && isNaN(parseBRNumber(cells[0])) ? 1 : 0;
        const targetIdx = itemIdx + ri;
        if (targetIdx >= next.length) return;
        cells.slice(valStart).forEach((cell, ci) => {
          const mi = startMi + ci;
          if (mi >= 12) return;
          next[targetIdx].valores[pk(ano, mi)] = parseBRNumber(cell);
        });
      });
      return next;
    });
  }

  const totaisMes = MESES.map((_, mi) => items.reduce((s, i) => s + (i.valores[pk(ano, mi)] ?? 0), 0));
  const grandTotal = totaisMes.reduce((a, b) => a + b, 0);
  const canAdd = tipoAdicao === "livre" ? !!novaNome.trim() : tipoAdicao === "parceiro" ? !!selParceiro : tipoAdicao === "projeto" ? !!selProjeto : tipoAdicao === "centro" ? !!selCentro : tipoAdicao === "centro_parceiro" ? (!!selCentro && !!selParceiro) : (!!selCentro && !!selProjeto);

  return (
    <Modal title={`Composição · ${linha.descricao}`} onClose={handleClose} xlWide>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-1 p-1 bg-gray-100 rounded-lg">
          {(["livre", "parceiro", "projeto", "centro", "centro_parceiro", "centro_projeto"] as TipoAdicao[]).map(t => (
            <button key={t} type="button"
              onClick={() => setTipoAdicao(t)}
              className={`py-1.5 rounded-md text-xs font-medium transition-colors ${tipoAdicao === t ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {t === "livre" ? "Texto livre" : t === "parceiro" ? "Parceiro" : t === "projeto" ? "Projeto" : t === "centro" ? "C. Resultado" : t === "centro_parceiro" ? "CR + Parceiro" : "CR + Projeto"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {tipoAdicao === "livre" && (
            <input autoFocus value={novaNome} onChange={e => setNovaNome(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addItem()}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Descrição livre..." />
          )}
          {tipoAdicao === "parceiro" && (
            <div className="flex-1">
              <SearchableSelect value={selParceiro} onChange={setSelParceiro}
                options={parceiroOptions} placeholder="Buscar parceiro..." emptyLabel="— Selecionar parceiro —"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          {tipoAdicao === "projeto" && (
            <div className="flex-1">
              <SearchableSelect value={selProjeto} onChange={setSelProjeto}
                options={projetoOptions} placeholder="Buscar projeto..." emptyLabel="— Selecionar projeto —"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          {tipoAdicao === "centro" && (
            <div className="flex-1">
              <SearchableSelect value={selCentro} onChange={setSelCentro}
                options={centroOptions} placeholder="Buscar centro de resultado..." emptyLabel="— Selecionar CR —"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          {(tipoAdicao === "centro_parceiro" || tipoAdicao === "centro_projeto") && (
            <div className="flex-1 flex gap-2">
              <div className="flex-1">
                <SearchableSelect value={selCentro} onChange={setSelCentro}
                  options={centroOptions} placeholder="Buscar CR..." emptyLabel="— Selecionar CR —"
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex-1">
                {tipoAdicao === "centro_parceiro" ? (
                  <SearchableSelect value={selParceiro} onChange={setSelParceiro}
                    options={parceiroOptions} placeholder="Buscar parceiro..." emptyLabel="— Selecionar parceiro —"
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                ) : (
                  <SearchableSelect value={selProjeto} onChange={setSelProjeto}
                    options={projetoOptions} placeholder="Buscar projeto..." emptyLabel="— Selecionar projeto —"
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                )}
              </div>
            </div>
          )}
          <button onClick={addItem} disabled={!canAdd}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-40" style={{ background: "#1e3a5f" }}>
            <Plus size={14} /> Adicionar
          </button>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Adicione itens para detalhar a composição.</p>
        ) : (
          <div className="rounded-lg border border-gray-200" style={{ overflowX: "auto", overflowY: "auto", maxHeight: 360 }}>
            <table className="w-full text-sm" style={{ minWidth: "max-content", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th className="sticky left-0 z-10 px-3 py-2 text-left text-xs font-semibold text-gray-500 min-w-[160px]" style={{ background: "#f8fafc" }}>Item</th>
                  {MESES.map(m => <th key={m} className="px-2 py-2 text-right text-xs font-semibold text-gray-500 min-w-[90px]">{m}</th>)}
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 min-w-[90px]">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const tot = MESES.reduce((s, _, mi) => s + (item.valores[pk(ano, mi)] ?? 0), 0);
                  return (
                    <React.Fragment key={item.id}>
                    <tr className="border-t border-gray-100 hover:bg-blue-50/20">
                      <td className="sticky left-0 z-10 px-2 py-1.5 text-sm font-medium text-gray-700 bg-white min-w-[200px]">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => deleteItem(item.id)} className="flex-shrink-0 p-1 hover:bg-red-100 rounded text-red-300 hover:text-red-600 transition-colors" title="Remover"><Trash2 size={12} /></button>
                          <button onClick={() => startEdit(item)} className="flex-shrink-0 p-1 hover:bg-amber-50 rounded text-gray-300 hover:text-amber-600 transition-colors" title="Editar descrição"><Pencil size={12} /></button>
                          <button onClick={() => toggleComentario(item.id)} className={`flex-shrink-0 relative p-1 rounded transition-colors ${item.comentario ? "text-blue-500 hover:bg-blue-50" : "text-gray-300 hover:bg-gray-100 hover:text-gray-500"}`} title={item.comentario ? `Comentário: ${item.comentario}` : "Adicionar comentário"}>
                            <MessageSquare size={12} />
                            {item.comentario && <span className="absolute top-0 right-0 w-2 h-2 bg-amber-400 rounded-full border border-white" />}
                          </button>
                          <button onClick={() => toggleDre(item.id)} className={`flex-shrink-0 relative p-1 rounded transition-colors ${(item.demoItemIdGerencial || item.demoItemIdContabil) ? "text-emerald-500 hover:bg-emerald-50" : "text-gray-300 hover:bg-gray-100 hover:text-gray-500"}`} title="Mapear DRE">
                            <Link2 size={12} />
                            {(item.demoItemIdGerencial || item.demoItemIdContabil) && <span className="absolute top-0 right-0 w-2 h-2 bg-emerald-400 rounded-full border border-white" />}
                          </button>
                          <button onClick={() => toggleCrPanel(item.id)} className={`flex-shrink-0 relative p-1 rounded transition-colors text-[9px] font-bold leading-none px-1.5 py-1 ${item.centroId ? "text-blue-600 bg-blue-50 border border-blue-200" : "text-gray-400 bg-gray-100 hover:bg-blue-50 hover:text-blue-500"}`} title={item.centroId ? `CR: ${centros.find(c => c.id === item.centroId)?.CODCENCUS ?? "—"}` : "Atribuir Centro de Resultado"}>
                            CR
                            {item.centroId && <span className="absolute top-0 right-0 w-2 h-2 bg-blue-400 rounded-full border border-white" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            {editingId === item.id ? (
                              item.centroId !== undefined ? (
                                <div className="flex gap-1 items-center flex-wrap">
                                  <div className="flex-1 min-w-[120px]"><SearchableSelect value={editingCentro} onChange={setEditingCentro} options={centroOptions} placeholder="CR..." emptyLabel="— CR —" className="border border-amber-300 rounded px-2 py-0.5 text-xs bg-amber-50" /></div>
                                  {item.projetoId !== undefined && <div className="flex-1 min-w-[120px]"><SearchableSelect value={editingProjeto} onChange={setEditingProjeto} options={projetoOptions} placeholder="Projeto..." emptyLabel="— Projeto —" className="border border-amber-300 rounded px-2 py-0.5 text-xs bg-amber-50" /></div>}
                                  {item.parceiroId !== undefined && <div className="flex-1 min-w-[120px]"><SearchableSelect value={editingParceiro} onChange={setEditingParceiro} options={parceiroOptions} placeholder="Parceiro..." emptyLabel="— Parceiro —" className="border border-amber-300 rounded px-2 py-0.5 text-xs bg-amber-50" /></div>}
                                  <button onClick={commitEdit} className="flex-shrink-0 px-2 py-1 text-xs font-medium text-white rounded bg-amber-500 hover:bg-amber-600">OK</button>
                                  <button onClick={() => setEditingId(null)} className="flex-shrink-0 px-2 py-1 text-xs text-gray-600 bg-gray-200 rounded hover:bg-gray-300">✕</button>
                                </div>
                              ) : (
                                <input autoFocus value={editingDesc} onChange={e => setEditingDesc(e.target.value)}
                                  onBlur={commitEdit} onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingId(null); }}
                                  className="w-full text-sm border border-amber-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-400 bg-amber-50" />
                              )
                            ) : (
                              <>
                                <span>{item.descricao}</span>
                                {item.comentario && !cAbertos.has(item.id) && (
                                  <p className="text-[10px] text-gray-400 italic truncate mt-0.5">{item.comentario}</p>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                      {MESES.map((_, mi) => {
                        const k = pk(ano, mi);
                        return (
                          <td key={mi} className="px-1 py-1">
                            <input type="number"
                              value={item.valores[k] !== undefined && item.valores[k] !== 0 ? item.valores[k] : ""}
                              onChange={e => setValorItem(item.id, k, e.target.value === "" ? 0 : Number(e.target.value))}
                              onPaste={e => handleCellPaste(e, item.id, mi)}
                              className="w-full text-right text-sm border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-[82px]"
                              placeholder="—" />
                          </td>
                        );
                      })}
                      <td className="px-3 py-1.5 text-right text-sm font-semibold text-gray-700">{tot !== 0 ? fmtN(tot) : <span className="opacity-20">—</span>}</td>
                    </tr>
                    {cAbertos.has(item.id) && (
                      <tr>
                        <td colSpan={99} className="px-4 pb-2 pt-1" style={{ background: "#f0f9ff" }}>
                          <input type="text" value={item.comentario ?? ""} onChange={e => setComentario(item.id, e.target.value)}
                            placeholder="Comentário..." autoFocus
                            className="w-full text-xs border border-blue-100 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white text-gray-600 placeholder-gray-300" />
                        </td>
                      </tr>
                    )}
                    {crAbertos.has(item.id) && (
                      <tr>
                        <td colSpan={99} className="px-4 py-2 border-b border-blue-100" style={{ background: "#eff6ff" }}>
                          <div className="flex items-center gap-3" style={{ maxWidth: 480 }}>
                            <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wide flex-shrink-0">Centro de Resultado</span>
                            <div className="flex-1">
                              <SearchableSelect
                                value={item.centroId ?? ""}
                                onChange={v => { setCrItem(item.id, v); setCrAbertos(s => { const n = new Set(s); n.delete(item.id); return n; }); }}
                                options={centroOptions}
                                placeholder="Buscar CR..."
                                emptyLabel="— Nenhum —"
                                className="border border-blue-200 rounded px-2 py-1 text-xs bg-white" />
                            </div>
                            {item.centroId && (
                              <button onClick={() => setCrItem(item.id, "")} className="text-[10px] text-red-400 hover:text-red-600 flex-shrink-0">remover</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                                        {dreAbertos.has(item.id) && (
                      <tr>
                        <td colSpan={99} className="px-4 py-3 border-b border-gray-100" style={{ background: "#f8fafc" }}>
                          <div className="grid grid-cols-2 gap-3" style={{ maxWidth: 560 }}>
                            <div>
                              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">DRE Gerencial</p>
                              {item.demoItemIdGerencial ? (
                                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-blue-50 border border-blue-200 rounded text-xs">
                                  <span className="flex-1 text-gray-700 truncate">{dreGerComp.find(d => d.id === item.demoItemIdGerencial)?.descricao ?? "—"}</span>
                                  <button type="button" onClick={() => setDemoG(item.id, "")} className="text-blue-300 hover:text-red-400 transition-colors flex-shrink-0">✕</button>
                                </div>
                              ) : (
                                <div className="border border-gray-200 rounded overflow-hidden">
                                  <input type="text" value={searchCG[item.id] ?? ""} onChange={e => setSearchCG(s => ({ ...s, [item.id]: e.target.value }))} placeholder="Pesquisar DRE Gerencial..." className="w-full text-xs px-2 py-1 border-b border-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white" />
                                  <div className="max-h-32 overflow-y-auto">
                                    {(() => {
                                      const srch = (searchCG[item.id] ?? "").toLowerCase().trim();
                                      const list = srch ? dreGerComp.filter(d => d.descricao.toLowerCase().includes(srch)) : dreGerComp;
                                      if (!list.length) return <p className="text-xs text-gray-400 px-2 py-2">{dreGerComp.length === 0 ? "Configure a DRE Gerencial em Cadastros → Demonstrativos." : "Nenhum resultado."}</p>;
                                      const pathMapG: Record<string, string> = {};
                                      const stkG: { nivel: number; descricao: string }[] = [];
                                      for (const x of dreGerComp) { if (x.tipo === "SUBTOTAL") { while (stkG.length && stkG[stkG.length-1].nivel >= x.nivel) stkG.pop(); stkG.push({ nivel: x.nivel, descricao: x.descricao }); } else { pathMapG[x.id] = stkG.map(s => s.descricao).join(" › "); } }
                                      return list.map(d => {
                                        const pl = (d.nivel - 1) * 10 + 8;
                                        if (d.tipo === "SUBTOTAL") return (
                                          <div key={d.id} className="py-1 bg-gray-50 border-b border-gray-100" style={{ paddingLeft: pl }}>
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{d.descricao}</span>
                                          </div>
                                        );
                                        return (
                                          <button key={d.id} type="button"
                                            onClick={() => { setDemoG(item.id, d.id); setSearchCG(s => ({ ...s, [item.id]: "" })); }}
                                            className="w-full text-left text-xs py-1.5 hover:bg-blue-50 border-b border-gray-50 last:border-0"
                                            style={{ paddingLeft: pl + 4 }}>
                                            <span className="block text-gray-700 truncate">{d.descricao}</span>
                                            {pathMapG[d.id] && <span className="block text-[10px] text-gray-400 truncate mt-0.5">{pathMapG[d.id]}</span>}
                                          </button>
                                        );
                                      });
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">DRE Contábil</p>
                              {item.demoItemIdContabil ? (
                                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-indigo-50 border border-indigo-200 rounded text-xs">
                                  <span className="flex-1 text-gray-700 truncate">{dreCtbComp.find(d => d.id === item.demoItemIdContabil)?.descricao ?? "—"}</span>
                                  <button type="button" onClick={() => setDemoC(item.id, "")} className="text-indigo-300 hover:text-red-400 transition-colors flex-shrink-0">✕</button>
                                </div>
                              ) : (
                                <div className="border border-gray-200 rounded overflow-hidden">
                                  <input type="text" value={searchCC[item.id] ?? ""} onChange={e => setSearchCC(s => ({ ...s, [item.id]: e.target.value }))} placeholder="Pesquisar DRE Contábil..." className="w-full text-xs px-2 py-1 border-b border-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-white" />
                                  <div className="max-h-32 overflow-y-auto">
                                    {(() => {
                                      const srch = (searchCC[item.id] ?? "").toLowerCase().trim();
                                      const list = srch ? dreCtbComp.filter(d => d.descricao.toLowerCase().includes(srch)) : dreCtbComp;
                                      if (!list.length) return <p className="text-xs text-gray-400 px-2 py-2">{dreCtbComp.length === 0 ? "Configure a DRE Contábil em Cadastros → Demonstrativos." : "Nenhum resultado."}</p>;
                                      const pathMapC: Record<string, string> = {};
                                      const stkC: { nivel: number; descricao: string }[] = [];
                                      for (const x of dreCtbComp) { if (x.tipo === "SUBTOTAL") { while (stkC.length && stkC[stkC.length-1].nivel >= x.nivel) stkC.pop(); stkC.push({ nivel: x.nivel, descricao: x.descricao }); } else { pathMapC[x.id] = stkC.map(s => s.descricao).join(" › "); } }
                                      return list.map(d => {
                                        const pl = (d.nivel - 1) * 10 + 8;
                                        if (d.tipo === "SUBTOTAL") return (
                                          <div key={d.id} className="py-1 bg-gray-50 border-b border-gray-100" style={{ paddingLeft: pl }}>
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{d.descricao}</span>
                                          </div>
                                        );
                                        return (
                                          <button key={d.id} type="button"
                                            onClick={() => { setDemoC(item.id, d.id); setSearchCC(s => ({ ...s, [item.id]: "" })); }}
                                            className="w-full text-left text-xs py-1.5 hover:bg-indigo-50 border-b border-gray-50 last:border-0"
                                            style={{ paddingLeft: pl + 4 }}>
                                            <span className="block text-gray-700 truncate">{d.descricao}</span>
                                            {pathMapC[d.id] && <span className="block text-[10px] text-gray-400 truncate mt-0.5">{pathMapC[d.id]}</span>}
                                          </button>
                                        );
                                      });
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
                <tr>
                  <td className="sticky left-0 z-10 px-3 py-2 text-xs font-bold text-white" style={{ background: "#1e3a5f" }}>Total</td>
                  {totaisMes.map((v, mi) => (
                    <td key={mi} className="px-2 py-2 text-right text-xs font-bold text-white" style={{ background: "#1e3a5f" }}>
                      {v !== 0 ? fmtN(v) : <span className="opacity-40">—</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right text-xs font-bold text-white" style={{ background: "#1e3a5f" }}>{grandTotal !== 0 ? fmtN(grandTotal) : <span className="opacity-40">—</span>}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-gray-400">Dica: copie células do Excel e cole diretamente em qualquer campo da tabela.</p>
        <div className="flex gap-3 pt-1">
          <button onClick={handleClose} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancelar</button>
          <button onClick={() => onSave(items)} className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }}>Salvar</button>
        </div>
      </div>
    </Modal>
  );
}

function fmtRegra(r?: RegraItem): string | null {
  if (!r || r.modo === "none") return null;
  if (r.modo === "especifico") return r.codEspecifico ?? "";
  if (r.modo === "intervalo") return `${r.codDe} – ${r.codAte}`;
  if (r.modo === "multiplo") return (r.codMultiplos ?? []).join(", ");
  return null;
}

function _esc(s: string) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function _chipHtml(id: string, name: string, offset: 0|-1|1): string {
  const off = offset === 0 ? "M" : offset === -1 ? "M−1" : "M+1";
  return `<span data-linha-id="${_esc(id)}" data-offset="${offset}" contenteditable="false" style="display:inline-flex;align-items:center;gap:3px;padding:1px 8px;background:#dbeafe;border:1px solid #93c5fd;border-radius:5px;color:#1e40af;font-size:12px;font-weight:600;cursor:default;user-select:none;white-space:nowrap;margin:0 2px;vertical-align:middle">${_esc(name)}<span data-chip-offset="${_esc(id)}" style="font-size:10px;color:#1d4ed8;background:#bfdbfe;padding:0 4px;border-radius:3px;cursor:pointer;margin-left:3px">${off}</span><span data-chip-del="${_esc(id)}" style="color:#93c5fd;cursor:pointer;font-weight:bold;margin-left:3px;font-size:13px;line-height:1">×</span></span>`;
}
function _tokensToHtml(tokens: ExprToken[], linhaMap: Map<string, LinhaOrcamento>): string {
  return tokens.map(tok => {
    if (tok.t === "ref") return _chipHtml(tok.id, linhaMap.get(tok.id)?.descricao ?? tok.id, tok.offset);
    if (tok.t === "num") return String(tok.v).replace(".", ",");
    return tok.v;
  }).join(" ");
}
function _parseExprText(text: string): ExprToken[] {
  const tks: ExprToken[] = [];
  const norm = text.replace(/ /g, " ").replace(/,/g, ".");
  let i = 0;
  while (i < norm.length) {
    const ch = norm[i];
    if (" \t".includes(ch)) { i++; continue; }
    if (["+", "*", "/", "(", ")"].includes(ch)) { tks.push({ t: "op", v: ch as "+" | "*" | "/" | "(" | ")" }); i++; }
    else if (ch === "-") {
      const last = tks[tks.length - 1];
      const isUnary = !last || (last.t === "op" && last.v !== ")");
      if (isUnary && /[\d.]/.test(norm[i + 1] ?? "")) {
        let num = "-"; i++;
        while (i < norm.length && /[\d.]/.test(norm[i])) { num += norm[i]; i++; }
        const v = parseFloat(num); if (!isNaN(v)) tks.push({ t: "num", v });
      } else { tks.push({ t: "op", v: "-" }); i++; }
    } else if (/[\d.]/.test(ch)) {
      let num = "";
      while (i < norm.length && /[\d.]/.test(norm[i])) { num += norm[i]; i++; }
      const v = parseFloat(num); if (!isNaN(v)) tks.push({ t: "num", v });
    } else { i++; }
  }
  return tks;
}
function _readTokensFromDiv(div: HTMLDivElement): ExprToken[] {
  const tokens: ExprToken[] = [];
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      tokens.push(..._parseExprText(node.textContent ?? ""));
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const id = el.dataset.linhaId;
      if (id) {
        tokens.push({ t: "ref", id, offset: parseInt(el.dataset.offset ?? "0") as 0|-1|1 });
      } else if (el.tagName === "BR") {
        // ignore line breaks
      } else {
        for (const child of Array.from(el.childNodes)) walk(child);
      }
    }
  }
  for (const node of Array.from(div.childNodes)) walk(node);
  return tokens;
}

const emptyLinha = (): Omit<LinhaOrcamento, "id" | "valores"> => ({
  descricao: "", categoria: "receita", tipo: "digitado",
  isPercentual: false, demoItemIdGerencial: "", demoItemIdContabil: "", codIndicador: "",
  naturezaId: "", centroResultadoId: "",
});

function LinhaForm({ inicial, linhasDisponiveis, allBlocos, onSave, onCancel, initialId }: {
  inicial: Omit<LinhaOrcamento, "id" | "valores">; linhasDisponiveis: LinhaOrcamento[]; allBlocos: Bloco[]; initialId?: string;
  onSave: (v: Omit<LinhaOrcamento, "id" | "valores">) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState(inicial);
  const [subtotalIds, setSubtotalIds] = useState<string[]>(inicial.subtotalLinhaIds ?? []);
  const [subtotalSearch, setSubtotalSearch] = useState("");
  const formulaRef = useRef<HTMLDivElement>(null);
  const [formulaEmpty, setFormulaEmpty] = useState(!inicial.formulaExpr?.length && !inicial.formula);
  const [exprSearch, setExprSearch] = useState("");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!formulaRef.current) return;
    const lm = new Map<string, LinhaOrcamento>();
    for (const b of allBlocos) for (const s of b.subBlocos) for (const l of s.linhas) lm.set(l.id, l);
    let tks: ExprToken[] = [];
    if (inicial.formulaExpr?.length) { tks = inicial.formulaExpr; }
    else if (inicial.formula) {
      const { op, left, right } = inicial.formula;
      if (left.valorFixo !== undefined) tks.push({ t: "num", v: left.valorFixo });
      else if (left.linhaId) tks.push({ t: "ref", id: left.linhaId, offset: left.offset });
      tks.push({ t: "op", v: op });
      if (right.valorFixo !== undefined) tks.push({ t: "num", v: right.valorFixo });
      else if (right.linhaId) tks.push({ t: "ref", id: right.linhaId, offset: right.offset });
    }
    if (tks.length > 0) { formulaRef.current.innerHTML = _tokensToHtml(tks, lm); setFormulaEmpty(false); }
  }, []);
  const dreGerencial    = useMemo(() => loadData<DemoItem[]>("portal_dre", []), []);
  const dreContabil     = useMemo(() => loadData<DemoItem[]>("portal_dre_contabil", []), []);
  const naturezaOptions = useMemo(() => loadData<{ id: string; CODNAT: string; DESCRNAT: string; ANALITICA: boolean; ATIVA: boolean }[]>("portal_natureza", [])
    .filter(n => n.ATIVA && n.ANALITICA)
    .map(n => ({ value: n.id, label: n.CODNAT ? `${n.CODNAT} — ${n.DESCRNAT}` : n.DESCRNAT })), []);
  const crOptions = useMemo(() => loadData<{ id: string; CODCENCUS: string; DESCRCENCUS: string; ATIVO: boolean; ANALITICO: boolean }[]>("portal_centro_resultado", [])
    .filter(c => c.ATIVO && c.ANALITICO)
    .map(c => ({ value: c.id, label: c.CODCENCUS ? `${c.CODCENCUS} — ${c.DESCRCENCUS}` : c.DESCRCENCUS })), []);
  const indicadorOptions = useMemo(() => loadData<IndicadorRow[]>("portal_indicadores", [])
    .filter(r => r.tipo === "INDICADOR")
    .slice().sort((a, b) => (a.codigo ?? a.nome).localeCompare(b.codigo ?? b.nome, undefined, { numeric: true }))
    .map(r => ({ value: r.id, label: r.codigo ? `${r.codigo} — ${r.nome}` : r.nome })), []);

  const selGerencial = dreGerencial.find(i => i.id === form.demoItemIdGerencial);
  const selContabil  = dreContabil.find(i => i.id === form.demoItemIdContabil);
  const isCatDRE = form.categoria !== "indicador";
  const [dreOpenG, setDreOpenG] = useState(!inicial.demoItemIdGerencial);
  const [dreOpenC, setDreOpenC] = useState(!inicial.demoItemIdContabil);
  const [searchG, setSearchG] = useState("");
  const [searchC, setSearchC] = useState("");

  function save() {
    if (!form.descricao.trim()) return;
    let formulaExpr: ExprToken[] | undefined = undefined;
    if (form.tipo === "calculado") {
      if (!formulaEmpty) {
        const read = formulaRef.current ? _readTokensFromDiv(formulaRef.current) : [];
        // if div read returns nothing but wasn't cleared, preserve the original formula
        formulaExpr = read.length > 0 ? read : (inicial.formulaExpr?.length ? inicial.formulaExpr : undefined);
      }
      // if formulaEmpty === true the user cleared it → formulaExpr stays undefined
    }
    // preserve legacy formula only as last resort when div read failed and no formulaExpr exists
    const legacyFormula = form.tipo === "calculado" && !formulaExpr && !formulaEmpty ? inicial.formula : undefined;
    onSave({ ...form, formula: legacyFormula, formulaExpr, subtotalLinhaIds: form.tipo === "subtotal" ? subtotalIds : undefined });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Descrição</label>
        <input autoFocus value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Ex: Receita de Gestão, Despesa de Pessoal..." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Categoria</label>
          <select value={form.categoria}
            onChange={e => { const c = e.target.value as Categoria; setForm(f => ({ ...f, categoria: c, demoItemIdGerencial: "", demoItemIdContabil: "", codIndicador: "" })); }}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="receita">Receita</option>
            <option value="gastos">Gastos</option>
            <option value="impostos">Impostos</option>
            <option value="indicador">Indicador</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Tipo</label>
          <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoLinha }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="digitado">Digitado</option>
            <option value="calculado">Calculado</option>
            <option value="subtotal">Subtotal</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Natureza <span className="font-normal text-gray-400">(opcional)</span></label>
          <div className="flex items-center gap-1">
            <div className="flex-1">
              <SearchableSelect value={form.naturezaId ?? ""} onChange={v => setForm(f => ({ ...f, naturezaId: v }))}
                options={naturezaOptions} placeholder="Buscar natureza..." emptyLabel="— Nenhuma —"
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            {form.naturezaId && (
              <button type="button" onClick={() => setForm(f => ({ ...f, naturezaId: "" }))}
                className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 text-sm leading-none px-1" title="Limpar">✕</button>
            )}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">C. Resultado <span className="font-normal text-gray-400">(opcional)</span></label>
          <div className="flex items-center gap-1">
            <div className="flex-1">
              <SearchableSelect value={form.centroResultadoId ?? ""} onChange={v => setForm(f => ({ ...f, centroResultadoId: v }))}
                options={crOptions} placeholder="Buscar CR..." emptyLabel="— Nenhum —"
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            {form.centroResultadoId && (
              <button type="button" onClick={() => setForm(f => ({ ...f, centroResultadoId: "" }))}
                className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 text-sm leading-none px-1" title="Limpar">✕</button>
            )}
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={!!form.isPercentual} onChange={e => setForm(f => ({ ...f, isPercentual: e.target.checked }))}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        <span className="text-xs text-gray-600">Exibir valores como porcentagem (%)</span>
      </label>

      {isCatDRE && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-600">DRE Gerencial <span className="font-normal text-gray-400">(opcional)</span></p>
            {selGerencial && !dreOpenG ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-600 flex-shrink-0" />
                <p className="flex-1 text-sm text-gray-700 font-medium truncate">{selGerencial.descricao}</p>
                <button type="button" onClick={() => setDreOpenG(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-0.5 rounded border border-blue-200 hover:bg-blue-100 transition-colors flex-shrink-0">Alterar</button>
                <button type="button" onClick={() => setForm(f => ({ ...f, demoItemIdGerencial: "" }))} className="text-blue-300 hover:text-red-400 transition-colors flex-shrink-0 text-sm leading-none">✕</button>
              </div>
            ) : (
              <div className="space-y-1">
                {dreOpenG && selGerencial && (
                  <div className="flex justify-end">
                    <button type="button" onClick={() => setDreOpenG(false)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Cancelar</button>
                  </div>
                )}
                {dreGerencial.length > 0 ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-2 py-1.5 border-b border-gray-100 bg-gray-50">
                      <input type="text" value={searchG} onChange={e => setSearchG(e.target.value)} placeholder="Pesquisar..." className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
                    </div>
                    <div className="max-h-36 overflow-y-auto">
                      {(searchG.trim() ? dreGerencial.filter(i => i.descricao.toLowerCase().includes(searchG.toLowerCase())) : dreGerencial).map(item => {
                        const pl = (item.nivel - 1) * 12 + 12;
                        if (item.tipo === "SUBTOTAL") return (
                          <div key={item.id} className="py-1 bg-gray-50/70 border-b border-gray-100" style={{ paddingLeft: pl }}>
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{item.descricao}</span>
                          </div>
                        );
                        const sel = form.demoItemIdGerencial === item.id;
                        return (
                          <button key={item.id} type="button"
                            onClick={() => { setForm(f => ({ ...f, demoItemIdGerencial: sel ? "" : item.id })); if (!sel) { setDreOpenG(false); setSearchG(""); } }}
                            className="w-full flex items-center gap-2 py-1.5 border-b border-gray-50 text-left hover:bg-blue-50/40 transition-colors"
                            style={{ paddingLeft: pl + 4, background: sel ? "#eff6ff" : undefined }}>
                            <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${sel ? "border-blue-600" : "border-gray-300"}`}>
                              {sel && <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
                            </div>
                            <span className={`text-sm transition-colors ${sel ? "text-gray-800 font-medium" : "text-gray-700"}`}>{item.descricao}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">Nenhuma linha na DRE Gerencial. Configure em <span className="font-medium text-gray-500">Cadastros → Demonstrativos</span>.</p>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-600">DRE Contábil <span className="font-normal text-gray-400">(opcional)</span></p>
            {selContabil && !dreOpenC ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
                <div className="w-2.5 h-2.5 rounded-full bg-indigo-600 flex-shrink-0" />
                <p className="flex-1 text-sm text-gray-700 font-medium truncate">{selContabil.descricao}</p>
                <button type="button" onClick={() => setDreOpenC(true)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-0.5 rounded border border-indigo-200 hover:bg-indigo-100 transition-colors flex-shrink-0">Alterar</button>
                <button type="button" onClick={() => setForm(f => ({ ...f, demoItemIdContabil: "" }))} className="text-indigo-300 hover:text-red-400 transition-colors flex-shrink-0 text-sm leading-none">✕</button>
              </div>
            ) : (
              <div className="space-y-1">
                {dreOpenC && selContabil && (
                  <div className="flex justify-end">
                    <button type="button" onClick={() => setDreOpenC(false)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Cancelar</button>
                  </div>
                )}
                {dreContabil.length > 0 ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-2 py-1.5 border-b border-gray-100 bg-gray-50">
                      <input type="text" value={searchC} onChange={e => setSearchC(e.target.value)} placeholder="Pesquisar..." className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
                    </div>
                    <div className="max-h-36 overflow-y-auto">
                      {(searchC.trim() ? dreContabil.filter(i => i.descricao.toLowerCase().includes(searchC.toLowerCase())) : dreContabil).map(item => {
                        const pl = (item.nivel - 1) * 12 + 12;
                        if (item.tipo === "SUBTOTAL") return (
                          <div key={item.id} className="py-1 bg-gray-50/70 border-b border-gray-100" style={{ paddingLeft: pl }}>
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{item.descricao}</span>
                          </div>
                        );
                        const sel = form.demoItemIdContabil === item.id;
                        return (
                          <button key={item.id} type="button"
                            onClick={() => { setForm(f => ({ ...f, demoItemIdContabil: sel ? "" : item.id })); if (!sel) { setDreOpenC(false); setSearchC(""); } }}
                            className="w-full flex items-center gap-2 py-1.5 border-b border-gray-50 text-left hover:bg-indigo-50/40 transition-colors"
                            style={{ paddingLeft: pl + 4, background: sel ? "#eef2ff" : undefined }}>
                            <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${sel ? "border-indigo-600" : "border-gray-300"}`}>
                              {sel && <div className="w-1.5 h-1.5 rounded-full bg-indigo-600" />}
                            </div>
                            <span className={`text-sm transition-colors ${sel ? "text-gray-800 font-medium" : "text-gray-700"}`}>{item.descricao}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">Nenhuma linha na DRE Contábil. Configure em <span className="font-medium text-gray-500">Cadastros → Demonstrativos</span>.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {form.categoria === "indicador" && (
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-2 block">Indicador</label>
          <SearchableSelect value={form.codIndicador ?? ""} onChange={v => setForm(f => ({ ...f, codIndicador: v }))}
            options={indicadorOptions} placeholder="Buscar indicador..." emptyLabel="— Nenhum —" className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
          <p className="text-[11px] text-gray-400 mt-1">CR e Natureza herdados do cadastro do indicador.</p>
        </div>
      )}

      {form.tipo === "digitado" && (
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox"
            checked={form.composicao !== undefined}
            onChange={e => setForm(f => ({ ...f, composicao: e.target.checked ? (f.composicao ?? []) : undefined }))}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          <span className="text-xs text-gray-600">Detalhar por projeto / parceiro</span>
        </label>
      )}

      {form.tipo === "subtotal" && (() => {
        const srch = subtotalSearch.toLowerCase().trim();
        const blocosFiltrados = allBlocos.map(b => ({
          ...b,
          subBlocos: b.subBlocos.map(s => ({
            ...s,
            linhas: s.linhas.filter(l =>
              l.id !== initialId &&
              l.tipo !== "subtotal" &&
              (!srch || l.descricao.toLowerCase().includes(srch) ||
               s.descricao.toLowerCase().includes(srch) ||
               b.descricao.toLowerCase().includes(srch))
            ),
          })).filter(s => s.linhas.length > 0),
        })).filter(b => b.subBlocos.length > 0);
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-600">Linhas referenciadas <span className="font-normal text-gray-400">(soma dos valores selecionados)</span></label>
              {subtotalIds.length > 0 && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full text-white" style={{ background: "#1e3a5f" }}>{subtotalIds.length} selecionada(s)</span>
              )}
            </div>
            <input type="text" value={subtotalSearch} onChange={e => setSubtotalSearch(e.target.value)}
              placeholder="Pesquisar linhas..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="border border-gray-200 rounded-lg overflow-hidden" style={{ maxHeight: 280, overflowY: "auto" }}>
              {blocosFiltrados.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">Nenhuma linha encontrada.</p>
              ) : blocosFiltrados.map(b => (
                <div key={b.id}>
                  <div className="px-3 py-1.5 border-b border-gray-200 sticky top-0 z-10" style={{ background: "#1e3a5f" }}>
                    <span className="text-[11px] font-bold text-white uppercase tracking-wide">{b.descricao}</span>
                  </div>
                  {b.subBlocos.map(s => (
                    <div key={s.id}>
                      <div className="px-4 py-1.5 bg-gray-100 border-b border-gray-200">
                        <span className="text-xs font-semibold text-gray-500">{s.descricao}</span>
                      </div>
                      {s.linhas.map(l => {
                        const checked = subtotalIds.includes(l.id);
                        return (
                          <label key={l.id} className={`flex items-center gap-2.5 px-5 py-2 border-b border-gray-50 cursor-pointer transition-colors ${checked ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                            <input type="checkbox" checked={checked}
                              onChange={e => setSubtotalIds(p => e.target.checked ? [...p, l.id] : p.filter(id => id !== l.id))}
                              className="w-3.5 h-3.5 flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
                            <span className={`text-sm flex-1 ${checked ? "text-gray-800 font-medium" : "text-gray-700"}`}>{l.descricao}</span>
                            <span className="text-[10px] text-gray-400 flex-shrink-0">{l.categoria}</span>
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {subtotalIds.length > 0 && (
              <button type="button" onClick={() => setSubtotalIds([])}
                className="text-xs text-red-400 hover:text-red-600 transition-colors">
                Limpar seleção
              </button>
            )}
          </div>
        );
      })()}

      {form.tipo === "calculado" && (() => {
        const allRefLinhas: { linha: LinhaOrcamento; blocoDesc: string; subDesc: string }[] = [];
        for (const b of allBlocos) for (const s of b.subBlocos) for (const l of s.linhas) {
          if (l.id === initialId) continue;
          allRefLinhas.push({ linha: l, blocoDesc: b.descricao, subDesc: s.descricao });
        }
        const srch = exprSearch.toLowerCase().trim();
        const filtradas = srch ? allRefLinhas.filter(x =>
          x.linha.descricao.toLowerCase().includes(srch) ||
          x.blocoDesc.toLowerCase().includes(srch) ||
          x.subDesc.toLowerCase().includes(srch)
        ) : allRefLinhas;
        const grupos = new Map<string, typeof filtradas>();
        for (const x of filtradas) { if (!grupos.has(x.blocoDesc)) grupos.set(x.blocoDesc, []); grupos.get(x.blocoDesc)!.push(x); }

        function insertChip(id: string, name: string) {
          const div = formulaRef.current; if (!div) return;
          div.focus();
          const sel = window.getSelection();
          let range: Range;
          if (sel && sel.rangeCount > 0 && div.contains(sel.anchorNode)) {
            range = sel.getRangeAt(0);
          } else {
            range = document.createRange(); range.selectNodeContents(div); range.collapse(false);
          }
          range.deleteContents();
          const temp = document.createElement("span");
          temp.innerHTML = _chipHtml(id, name, 0);
          const chip = temp.firstChild!;
          range.insertNode(chip);
          const space = document.createTextNode(" ");
          range.setStartAfter(chip); range.insertNode(space);
          range.setStartAfter(space); range.collapse(true);
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
          setFormulaEmpty(false);
        }

        return (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-gray-600">Fórmula calculada</label>
            <div className="relative">
              <span className="absolute left-3 top-3 text-sm font-bold text-gray-400 pointer-events-none select-none z-10">=</span>
              {formulaEmpty && (
                <span className="absolute left-8 top-3 text-sm text-gray-300 italic pointer-events-none select-none z-10">
                  escreva a fórmula ou clique em uma linha abaixo…
                </span>
              )}
              <div
                ref={formulaRef}
                contentEditable suppressContentEditableWarning spellCheck={false}
                onInput={() => setFormulaEmpty(
                  !formulaRef.current?.textContent?.trim() &&
                  !formulaRef.current?.querySelector("[data-linha-id]")
                )}
                onClick={e => {
                  const target = e.target as HTMLElement;
                  if (target.dataset.chipDel) {
                    target.closest("[data-linha-id]")?.remove();
                    setFormulaEmpty(
                      !formulaRef.current?.textContent?.trim() &&
                      !formulaRef.current?.querySelector("[data-linha-id]")
                    );
                  } else if (target.dataset.chipOffset) {
                    const chip = target.closest("[data-linha-id]") as HTMLElement;
                    if (chip) {
                      const curr = parseInt(chip.dataset.offset ?? "0") as 0 | -1 | 1;
                      const next: 0 | -1 | 1 = curr === 0 ? -1 : curr === -1 ? 1 : 0;
                      chip.dataset.offset = String(next);
                      target.textContent = next === 0 ? "M" : next === -1 ? "M−1" : "M+1";
                    }
                  }
                }}
                onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }}
                className="w-full min-h-[46px] pl-8 pr-8 py-2.5 bg-white border-2 border-blue-200 rounded-lg focus:outline-none focus:border-blue-400 text-sm text-gray-700 leading-relaxed"
                style={{ cursor: "text", wordBreak: "break-word" }}
              />
              {!formulaEmpty && (
                <button type="button"
                  onClick={() => { if (formulaRef.current) { formulaRef.current.innerHTML = ""; setFormulaEmpty(true); } }}
                  className="absolute right-2 top-3 text-gray-300 hover:text-red-400 transition-colors text-sm font-bold"
                  title="Limpar fórmula">×</button>
              )}
            </div>
            <div className="space-y-1.5">
              <input type="text" value={exprSearch} onChange={e => setExprSearch(e.target.value)}
                placeholder="Buscar linha para inserir na fórmula…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {allRefLinhas.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden" style={{ maxHeight: 220, overflowY: "auto" }}>
                  {filtradas.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4">Nenhuma linha encontrada.</p>
                  ) : [...grupos.entries()].map(([blocoDesc, items]) => (
                    <div key={blocoDesc}>
                      <div className="px-3 py-1.5 sticky top-0 z-10" style={{ background: "#1e3a5f" }}>
                        <span className="text-[11px] font-bold text-white uppercase tracking-wide">{blocoDesc}</span>
                      </div>
                      {items.map(({ linha, subDesc }) => (
                        <button key={linha.id} type="button" onClick={() => insertChip(linha.id, linha.descricao)}
                          className="w-full flex items-center gap-2 px-4 py-2 text-left border-b border-gray-50 last:border-0 hover:bg-blue-50 transition-colors">
                          <span className="text-[10px] text-gray-400 flex-shrink-0 w-24 truncate">{subDesc}</span>
                          <span className="text-sm text-gray-700 flex-1 truncate">{linha.descricao}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 flex-shrink-0">{linha.categoria}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {allRefLinhas.length === 0 && (
                <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">Nenhuma outra linha disponível nesta página.</p>
              )}
            </div>
            <p className="text-[11px] text-gray-400">Digite diretamente na barra de fórmula. Clique no badge <strong>M</strong> de uma referência para trocar o mês (atual · M−1 · M+1).</p>
          </div>
        );
      })()}
      <div className="flex gap-3 pt-2">
        <button onClick={onCancel} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">Cancelar</button>
        <button onClick={save} disabled={!form.descricao.trim()}
          className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-40" style={{ background: "#1e3a5f" }}>Salvar</button>
      </div>
    </div>
  );
}

const STORAGE_KEY = "portal_orcamento_gastos_pacote_institucional";
const TITULO      = "Pacote Institucional";

export default function OrcamentoGastosPacoteInstitucionalPage() {
  const [blocos, setBlocos] = usePersistedData<Bloco[]>(STORAGE_KEY, []);
  const [indicadores] = usePersistedData<IndicadorRow[]>("portal_indicadores", []);
  const indicadorEstoqueSet = useMemo(
    () => new Set(indicadores.filter(i => i.categoria === "ESTOQUE").map(i => i.id)),
    [indicadores]
  );
  const _anoAtual = new Date().getFullYear();
  const [filtros, setFiltros] = useState<FiltrosOrc>({ periodoInicio: `${_anoAtual}-01`, periodoFim: `${_anoAtual}-12`, viewMode: "mensal" });
  const [rascunho, setRascunho] = useState<FiltrosOrc>(filtros);
  const [filterOpen, setFilterOpen] = useState(false);
  const ano = parseInt(filtros.periodoInicio.slice(0, 4)) || new Date().getFullYear();
  const viewMode = filtros.viewMode;
  const mIni = parseInt(filtros.periodoInicio.split("-")[1]) - 1;
  const mFim = parseInt(filtros.periodoFim.split("-")[1]) - 1;
  const mesesAtivos = MESES.map((_, i) => i).filter(i => i >= mIni && i <= mFim);
  const gruposAtivos = GRUPOS_DEF[viewMode].filter(g => g.meses.some(mi => mi >= mIni && mi <= mFim));
  const tableWidth = 320 + 140 + gruposAtivos.length * 140;
  const [crFiltroIds, setCrFiltroIds] = useState<string[]>([]);
  const filtrosAtivos = (viewMode !== "mensal" ? 1 : 0) + (mIni !== 0 || mFim !== 11 ? 1 : 0) + (crFiltroIds.length > 0 ? 1 : 0);
  const periodoLabel = mIni === 0 && mFim === 11 ? String(ano) : `${MESES[mIni]}–${MESES[mFim]} ${ano}`;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedLinhas, setExpandedLinhas] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState(false);

  type ModalState =
    | { tipo: "bloco-add" } | { tipo: "bloco-edit"; blocoId: string; descricao: string }
    | { tipo: "sub-add"; blocoId: string } | { tipo: "sub-edit"; blocoId: string; subId: string; descricao: string }
    | { tipo: "linha-add"; blocoId: string; subId: string } | { tipo: "linha-edit"; blocoId: string; subId: string; linha: LinhaOrcamento }
    | { tipo: "valores"; blocoId: string; subId: string; linha: LinhaOrcamento }
    | { tipo: "composicao"; blocoId: string; subId: string; linha: LinhaOrcamento };

  const [modal, setModal] = useState<ModalState | null>(null);
  const [nomeModal, setNomeModal] = useState("");
  const [dragLinha, setDragLinha] = useState<{ blocoId: string; subId: string; linhaId: string } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragSub, setDragSub] = useState<{ blocoId: string; subId: string } | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [dragBloco, setDragBloco] = useState<string | null>(null);
  const [dragOverBlocoId, setDragOverBlocoId] = useState<string | null>(null);

  function toggleCollapse(id: string) { setCollapsed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleLinhaExpand(id: string) { setExpandedLinhas(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function addBloco() { if (!nomeModal.trim()) return; setBlocos(b => [...b, { id: uid(), descricao: nomeModal.trim(), subBlocos: [] }]); setModal(null); setNomeModal(""); }
  function editBloco(id: string) { if (!nomeModal.trim()) return; setBlocos(b => b.map(bl => bl.id === id ? { ...bl, descricao: nomeModal.trim() } : bl)); setModal(null); setNomeModal(""); }
  function deleteBloco(id: string) { if (!confirm("Excluir bloco e todo seu conteúdo?")) return; setBlocos(b => b.filter(bl => bl.id !== id)); }
  function addSub(bid: string) { if (!nomeModal.trim()) return; setBlocos(b => b.map(bl => bl.id === bid ? { ...bl, subBlocos: [...bl.subBlocos, { id: uid(), descricao: nomeModal.trim(), linhas: [] }] } : bl)); setModal(null); setNomeModal(""); }
  function editSub(bid: string, sid: string) { if (!nomeModal.trim()) return; setBlocos(b => b.map(bl => bl.id === bid ? { ...bl, subBlocos: bl.subBlocos.map(s => s.id === sid ? { ...s, descricao: nomeModal.trim() } : s) } : bl)); setModal(null); setNomeModal(""); }
  function deleteSub(bid: string, sid: string) { if (!confirm("Excluir sub-bloco?")) return; setBlocos(b => b.map(bl => bl.id === bid ? { ...bl, subBlocos: bl.subBlocos.filter(s => s.id !== sid) } : bl)); }
  function addLinha(bid: string, sid: string, form: Omit<LinhaOrcamento, "id"|"valores">) {
    const novaLinha: LinhaOrcamento = { ...form, id: uid(), valores: {} };
    setBlocos(b => b.map(bl => bl.id === bid ? { ...bl, subBlocos: bl.subBlocos.map(s => s.id === sid ? { ...s, linhas: [...s.linhas, novaLinha] } : s) } : bl));
    if (form.tipo === "digitado") {
      if (form.composicao !== undefined) setModal({ tipo: "composicao", blocoId: bid, subId: sid, linha: novaLinha });
      else setModal({ tipo: "valores", blocoId: bid, subId: sid, linha: novaLinha });
    } else setModal(null);
  }
  function setComposicao(bid: string, sid: string, lid: string, composicao: ComposicaoItem[]) {
    setBlocos(b => b.map(bl => bl.id !== bid ? bl : { ...bl, subBlocos: bl.subBlocos.map(s => s.id !== sid ? s : { ...s, linhas: s.linhas.map(l => l.id !== lid ? l : { ...l, composicao }) }) }));
    setModal(null);
  }
  function setComposicaoSilent(bid: string, sid: string, lid: string, composicao: ComposicaoItem[]) {
    setBlocos(b => b.map(bl => bl.id !== bid ? bl : { ...bl, subBlocos: bl.subBlocos.map(s => s.id !== sid ? s : { ...s, linhas: s.linhas.map(l => l.id !== lid ? l : { ...l, composicao }) }) }));
  }
  function editLinha(bid: string, sid: string, lid: string, form: Omit<LinhaOrcamento, "id"|"valores">) {
    const existingLinha = blocos.find(bl => bl.id === bid)?.subBlocos.find(s => s.id === sid)?.linhas.find(l => l.id === lid);
    setBlocos(b => b.map(bl => bl.id === bid ? { ...bl, subBlocos: bl.subBlocos.map(s => s.id === sid ? { ...s, linhas: s.linhas.map(l => l.id === lid ? { ...l, ...form } : l) } : s) } : bl));
    if (form.tipo === "digitado" && form.composicao !== undefined && existingLinha) {
      setModal({ tipo: "composicao", blocoId: bid, subId: sid, linha: { ...existingLinha, ...form } });
    } else {
      setModal(null);
    }
  }
  function deleteLinha(bid: string, sid: string, lid: string) { setBlocos(b => b.map(bl => bl.id === bid ? { ...bl, subBlocos: bl.subBlocos.map(s => s.id === sid ? { ...s, linhas: s.linhas.filter(l => l.id !== lid) } : s) } : bl)); }
  function reorderBlocos(fromId: string, toId: string) {
    if (fromId === toId) return;
    setBlocos(b => {
      const arr = [...b];
      const from = arr.findIndex(bl => bl.id === fromId);
      const to   = arr.findIndex(bl => bl.id === toId);
      if (from === -1 || to === -1) return b;
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
  }
  function toggleTotalizar(blocoId: string) {
    setBlocos(b => b.map(bl => bl.id === blocoId ? { ...bl, totalizar: !bl.totalizar } : bl));
  }
  function toggleSubTotalizar(blocoId: string, subId: string) {
    setBlocos(b => b.map(bl => bl.id !== blocoId ? bl : { ...bl, subBlocos: bl.subBlocos.map(s => s.id === subId ? { ...s, totalizar: !s.totalizar } : s) }));
  }
  function reorderSubBlocos(bid: string, fromId: string, toId: string) {
    if (fromId === toId) return;
    setBlocos(b => b.map(bl => {
      if (bl.id !== bid) return bl;
      const arr = [...bl.subBlocos];
      const from = arr.findIndex(s => s.id === fromId);
      const to   = arr.findIndex(s => s.id === toId);
      if (from === -1 || to === -1) return bl;
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return { ...bl, subBlocos: arr };
    }));
  }
  function reorderLinhas(bid: string, sid: string, fromId: string, toId: string) {
    if (fromId === toId) return;
    setBlocos(b => b.map(bl => bl.id !== bid ? bl : { ...bl, subBlocos: bl.subBlocos.map(s => {
      if (s.id !== sid) return s;
      const arr = [...s.linhas];
      const from = arr.findIndex(l => l.id === fromId);
      const to   = arr.findIndex(l => l.id === toId);
      if (from === -1 || to === -1) return s;
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return { ...s, linhas: arr };
    })}));
  }
  function setValores(bid: string, sid: string, lid: string, newVals: Record<string, number>) {
    setBlocos(b => b.map(bl => bl.id === bid ? { ...bl, subBlocos: bl.subBlocos.map(s => s.id === sid ? { ...s, linhas: s.linhas.map(l => l.id === lid ? { ...l, valores: { ...l.valores, ...newVals } } : l) } : s) } : bl));
    setModal(null);
  }
  function setValoresInline(bid: string, sid: string, lid: string, newVals: Record<string, number>) {
    setBlocos(b => b.map(bl => bl.id !== bid ? bl : { ...bl, subBlocos: bl.subBlocos.map(s => s.id !== sid ? s : { ...s, linhas: s.linhas.map(l => l.id !== lid ? l : { ...l, valores: { ...l.valores, ...newVals } }) }) }));
  }
  function exportar() {
    const rows: Record<string, string|number>[] = [];
    for (const bl of blocos) for (const sub of bl.subBlocos) for (const linha of sub.linhas) {
      const row: Record<string, string|number> = { Bloco: bl.descricao, "Sub-bloco": sub.descricao, Linha: linha.descricao, Categoria: linha.categoria, Tipo: linha.tipo };
      for (let mi = 0; mi < 12; mi++) row[MESES[mi]] = evalLinha(linha, sub.linhas, ano, mi, allLinhasMap);
      rows.push(row);
    }
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${TITULO} ${ano}`);
    XLSX.writeFile(wb, `Orcamento_${TITULO.replace(/\s/g, "_")}_${ano}.xlsx`);
  }
  const anos = useMemo(() => { const y = new Date().getFullYear(); return [y-1, y, y+1, y+2]; }, []);

  function aplicarFiltros() { setFiltros(rascunho); setFilterOpen(false); }
  function limparFiltros()  { const f: FiltrosOrc = { periodoInicio: `${ano}-01`, periodoFim: `${ano}-12`, viewMode: "mensal" }; setRascunho(f); setCrFiltroIds([]); }
  const dreGerencialPage = useMemo(() => loadData<DemoItem[]>("portal_dre", []), []);
  const dreContabilPage  = useMemo(() => loadData<DemoItem[]>("portal_dre_contabil", []), []);
  const indicadoresPage  = useMemo(() => loadData<IndicadorRow[]>("portal_indicadores", []), []);
  const allLinhasMap = useMemo(() => {
    const m = new Map<string, LinhaOrcamento>();
    for (const b of blocos) for (const s of b.subBlocos) for (const l of s.linhas) m.set(l.id, l);
    return m;
  }, [blocos]);
  const crOpcoes = useMemo(() =>
    loadData<CentroResultadoRow[]>("portal_centro_resultado", [])
      .filter(r => r.GRAU === 1 && r.ATIVO)
      .sort((a, b) => a.CODCENCUS.localeCompare(b.CODCENCUS)),
  []);
  const crIdToCod = useMemo(() =>
    new Map(loadData<CentroResultadoRow[]>("portal_centro_resultado", []).map(r => [r.id, r.CODCENCUS])),
  []);
  const crFiltroSet = useMemo<Set<string> | null>(() => {
    if (!crFiltroIds.length) return null;
    const allCrs = loadData<CentroResultadoRow[]>("portal_centro_resultado", []).sort((a, b) => a.CODCENCUS.localeCompare(b.CODCENCUS));
    const crMap = new Map(allCrs.map(cr => [cr.CODCENCUS, cr]));
    const hasPaiData = allCrs.some(cr => !!cr.CODCENCUSPAI);
    const result = new Set<string>();
    const selectedDescrs = new Set(allCrs.filter(cr => crFiltroIds.includes(cr.CODCENCUS)).map(cr => cr.DESCRCENCUS));
    if (hasPaiData) {
      for (const cr of allCrs) {
        let cur: typeof cr | undefined = cr;
        while (cur && cur.GRAU > 1 && cur.CODCENCUSPAI) cur = crMap.get(cur.CODCENCUSPAI);
        if (cur && crFiltroIds.includes(cur.CODCENCUS)) { result.add(cr.CODCENCUS); continue; }
        const grau1 = cr.GRAU_1 as string | undefined;
        if (grau1 && selectedDescrs.has(grau1)) result.add(cr.CODCENCUS);
      }
    } else {
      const withH = buildHierarchy(allCrs, "DESCRCENCUS");
      for (const cr of withH) {
        const grau1 = cr.GRAU_1 as string | undefined;
        if (crFiltroIds.includes(cr.CODCENCUS) || (grau1 && selectedDescrs.has(grau1))) result.add(cr.CODCENCUS);
      }
    }
    return result;
  }, [crFiltroIds]);
  const ev = crFiltroSet
    ? (linha: LinhaOrcamento, todas: LinhaOrcamento[], a: number, mi: number) =>
        evalLinhaFiltered(linha, todas, a, mi, allLinhasMap, crFiltroSet, crIdToCod)
    : (linha: LinhaOrcamento, todas: LinhaOrcamento[], a: number, mi: number) =>
        evalLinha(linha, todas, a, mi, allLinhasMap);

  return (
    <div>
      <PageHeader title="Orçamento · Gastos" subtitle={TITULO} />
      <div className="p-6 space-y-4 min-w-max">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setEditMode(v => !v)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors"
            style={editMode ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
            {editMode ? <><EyeOff size={14} /> Visualizar</> : <><Eye size={14} /> Editar</>}
          </button>
          <select value={ano} onChange={e => {
            const y = e.target.value;
            setFiltros(f => ({ ...f, periodoInicio: `${y}-01`, periodoFim: `${y}-12` }));
            setRascunho(r => ({ ...r, periodoInicio: `${y}-01`, periodoFim: `${y}-12` }));
          }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {anos.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </select>
                    <button
            onClick={() => { setRascunho(filtros); setFilterOpen(true); }}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
            style={filtrosAtivos > 0 ? { borderColor: "#1e3a5f", color: "#1e3a5f" } : {}}>
            <Filter size={14} />
            Filtros
            {filtrosAtivos > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full text-white"
                style={{ background: "#1e3a5f" }}>{filtrosAtivos}</span>
            )}
          </button>
          <span className="text-xs text-gray-400">{VIEW_LABELS[viewMode]} · {periodoLabel}</span>
          {editMode && (
            <button onClick={() => { setNomeModal(""); setModal({ tipo: "bloco-add" }); }}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }}>
              <Plus size={14} /> Novo Bloco
            </button>
          )}
          <button onClick={exportar} className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600 transition-colors">
            <Download size={14} /> Exportar Excel
          </button>
        </div>

        {blocos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-gray-100 text-center">
            <p className="text-gray-500 font-medium">Nenhum bloco criado</p>
            {editMode && <p className="text-gray-400 text-sm mt-1">Clique em "Novo Bloco" para começar.</p>}
          </div>
        )}

        {blocos.map(bloco => {
          const blocoCollapsed = collapsed.has(bloco.id);
          return (
            <div key={bloco.id} className="bg-white rounded-xl shadow-sm border border-gray-100"
              draggable={editMode}
              onDragStart={e => { e.stopPropagation(); setDragBloco(bloco.id); }}
              onDragOver={e => { if (!dragBloco) return; e.preventDefault(); e.stopPropagation(); setDragOverBlocoId(bloco.id); }}
              onDrop={e => { e.stopPropagation(); if (dragBloco && dragBloco !== bloco.id) reorderBlocos(dragBloco, bloco.id); setDragBloco(null); setDragOverBlocoId(null); }}
              onDragEnd={() => { setDragBloco(null); setDragOverBlocoId(null); }}
              style={dragOverBlocoId === bloco.id && dragBloco !== bloco.id ? { borderTop: "2px solid #1e3a5f" } : undefined}>
              <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 rounded-t-xl" style={{ background: "#1e3a5f" }}>
                {editMode && (
                  <GripVertical size={14} className="text-white/40 hover:text-white/80 cursor-grab active:cursor-grabbing flex-shrink-0" />
                )}
                <button onClick={() => toggleCollapse(bloco.id)} className="text-white/70 hover:text-white transition-colors">
                  {blocoCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                </button>
                {editMode && (
                  <button onClick={() => { setNomeModal(""); setModal({ tipo: "sub-add", blocoId: bloco.id }); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white border border-white/20 rounded-lg hover:bg-white/10 transition-colors">
                    <Plus size={12} /> Sub-bloco
                  </button>
                )}
                <span className="font-semibold text-white flex-1">{bloco.descricao}</span>
                {editMode && (
                  <>
                    <button onClick={() => toggleTotalizar(bloco.id)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium border rounded-lg transition-colors"
                      style={bloco.totalizar ? { background: "rgba(255,255,255,0.2)", color: "white", borderColor: "rgba(255,255,255,0.4)" } : { background: "transparent", color: "rgba(255,255,255,0.5)", borderColor: "rgba(255,255,255,0.2)" }}
                      title={bloco.totalizar ? "Remover linha de total" : "Adicionar linha de total"}>
                      Σ Total
                    </button>
                    <button onClick={() => { setNomeModal(bloco.descricao); setModal({ tipo: "bloco-edit", blocoId: bloco.id, descricao: bloco.descricao }); }} className="p-1.5 text-white/60 hover:text-white transition-colors rounded"><Pencil size={14} /></button>
                    <button onClick={() => deleteBloco(bloco.id)} className="p-1.5 text-white/60 hover:text-red-300 transition-colors rounded"><Trash2 size={14} /></button>
                  </>
                )}
              </div>
              {!blocoCollapsed && (
                <div className="divide-y divide-gray-50">
                  {bloco.subBlocos.length === 0 && (
                    <div className="px-5 py-6 text-center text-sm text-gray-400">
                      {editMode ? "Nenhum sub-bloco. Clique em \"+ Sub-bloco\" para adicionar." : "Nenhum sub-bloco."}
                    </div>
                  )}
                  {bloco.subBlocos.map(sub => {
                    const subCollapsed = collapsed.has(sub.id);
                    return (
                      <div key={sub.id}
                        draggable={editMode}
                        onDragStart={e => { e.stopPropagation(); setDragSub({ blocoId: bloco.id, subId: sub.id }); }}
                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverSubId(sub.id); }}
                        onDragLeave={() => setDragOverSubId(null)}
                        onDrop={e => { e.stopPropagation(); if (dragSub?.blocoId === bloco.id) reorderSubBlocos(bloco.id, dragSub.subId, sub.id); setDragSub(null); setDragOverSubId(null); }}
                        onDragEnd={() => { setDragSub(null); setDragOverSubId(null); }}
                        style={dragOverSubId === sub.id && dragSub?.subId !== sub.id ? { borderTop: "2px solid #1e3a5f" } : undefined}>
                        <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 border-b border-gray-100">
                          {editMode && (
                            <GripVertical size={13} className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing flex-shrink-0" />
                          )}
                          <button onClick={() => toggleCollapse(sub.id)} className="text-gray-400 hover:text-gray-600 transition-colors">
                            {subCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </button>
                          {editMode && (
                            <button onClick={() => setModal({ tipo: "linha-add", blocoId: bloco.id, subId: sub.id })}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors">
                              <Plus size={11} /> Linha
                            </button>
                          )}
                          <span className="text-sm font-semibold text-gray-700 flex-1">{sub.descricao}</span>
                          {editMode && (
                            <>
                              <button onClick={() => toggleSubTotalizar(bloco.id, sub.id)}
                                className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium border rounded transition-colors"
                                style={sub.totalizar ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "transparent", color: "#9ca3af", borderColor: "#d1d5db" }}
                                title={sub.totalizar ? "Remover total do sub-bloco" : "Adicionar total ao sub-bloco"}>
                                Σ
                              </button>
                              <button onClick={() => { setNomeModal(sub.descricao); setModal({ tipo: "sub-edit", blocoId: bloco.id, subId: sub.id, descricao: sub.descricao }); }} className="p-1 text-gray-400 hover:text-gray-600 transition-colors rounded"><Pencil size={13} /></button>
                              <button onClick={() => deleteSub(bloco.id, sub.id)} className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded"><Trash2 size={13} /></button>
                            </>
                          )}
                        </div>
                        {!subCollapsed && (
                          <table className="text-sm" style={{ width: tableWidth, tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}>
                            <colgroup>
                              <col style={{ width: 320 }} />
                              <col style={{ width: 140 }} />
                              {gruposAtivos.map((_, i) => <col key={i} style={{ width: 140 }} />)}
                            </colgroup>
                            <thead>
                              <tr style={{ background: "#f8fafc" }}>
                                <th className="sticky left-0 z-10 px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ background: "#f8fafc" }}>Linha</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide border-r border-gray-200 sticky z-20 left-[320px]" style={{ background: "#f8fafc" }}>Total</th>
                                {gruposAtivos.map(g => (
                                  <th key={g.label} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                    <div>{g.label}</div>
                                    {g.sub && <div className="font-normal text-[10px] text-gray-400 mt-0.5 normal-case">{g.sub}</div>}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sub.linhas.length === 0 && (
                                <tr><td colSpan={14} className="px-4 py-5 text-center text-xs text-gray-400">
                                  {editMode ? "Nenhuma linha. Clique em \"+ Linha\" para adicionar." : "Nenhuma linha."}
                                </td></tr>
                              )}
                              {sub.linhas.map(linha => {
                                const isCalc = linha.tipo === "calculado";
                                const isSubtotal = linha.tipo === "subtotal";
                                const isEstoque = linha.categoria === "indicador" && !!linha.codIndicador && indicadorEstoqueSet.has(linha.codIndicador);
                                const vals = MESES.map((_, mi) => ev(linha, sub.linhas, ano, mi));
                                const total = isEstoque
                                  ? (vals[mesesAtivos[mesesAtivos.length - 1]] ?? 0)
                                  : mesesAtivos.reduce((s, mi) => s + vals[mi], 0);
                                const hasDetail = (linha.tipo === "digitado" && (linha.composicao?.length ?? 0) > 0) ||
                                  (linha.tipo === "calculado" && linha.formula?.op === "*" &&
                                    linha.formula.left.valorFixo === undefined && linha.formula.right.valorFixo === undefined &&
                                    (sub.linhas.find(x => x.id === linha.formula!.left.linhaId)?.composicao?.length ?? 0) > 0 &&
                                    (sub.linhas.find(x => x.id === linha.formula!.right.linhaId)?.composicao?.length ?? 0) > 0);
                                const linhaExpanded = expandedLinhas.has(linha.id);
                                return (<React.Fragment key={linha.id}>
                                  <tr
                                    draggable={editMode && !isSubtotal}
                                    onDragStart={() => !isSubtotal && setDragLinha({ blocoId: bloco.id, subId: sub.id, linhaId: linha.id })}
                                    onDragOver={e => { e.preventDefault(); setDragOverId(linha.id); }}
                                    onDragLeave={() => setDragOverId(null)}
                                    onDrop={() => { if (dragLinha?.blocoId === bloco.id && dragLinha?.subId === sub.id) reorderLinhas(bloco.id, sub.id, dragLinha.linhaId, linha.id); setDragLinha(null); setDragOverId(null); }}
                                    onDragEnd={() => { setDragLinha(null); setDragOverId(null); }}
                                    className="group border-b border-gray-200 hover:bg-blue-50/20 transition-colors"
                                    style={dragOverId === linha.id && dragLinha?.linhaId !== linha.id ? { borderTop: "2px solid #1e3a5f" } : undefined}>
                                    <td className="sticky left-0 z-10 px-3 py-1.5 group-hover:bg-blue-50/20" style={{ background: "white" }}>
                                      <div className="flex items-center gap-1.5">
                                        {editMode && (
                                          <GripVertical size={13} className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing flex-shrink-0" />
                                        )}
                                        {hasDetail && (
                                          <button onClick={() => toggleLinhaExpand(linha.id)} className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors" title={linhaExpanded ? "Recolher detalhe" : "Expandir detalhe"}>
                                            {linhaExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                          </button>
                                        )}
                                        <span className={`text-sm flex-1 text-gray-700 ${isSubtotal ? "font-bold" : ""}`} title={linha.descricao}>{linha.descricao}</span>
                                        {!isSubtotal && editMode && linha.categoria !== "indicador" && (
                                          <div className="flex gap-0.5 flex-shrink-0">
                                            <span className={`text-[9px] font-bold px-1 rounded leading-4 ${linha.demoItemIdGerencial && dreGerencialPage.some(i => i.id === linha.demoItemIdGerencial) ? "bg-blue-100 text-blue-500" : "bg-orange-100 text-orange-500"}`} title={!linha.demoItemIdGerencial ? "DRE Gerencial não configurado" : dreGerencialPage.some(i => i.id === linha.demoItemIdGerencial) ? "DRE Gerencial configurado" : "DRE Gerencial: item não encontrado — reconfigure o mapeamento"}>G</span>
                                            <span className={`text-[9px] font-bold px-1 rounded leading-4 ${linha.demoItemIdContabil && dreContabilPage.some(i => i.id === linha.demoItemIdContabil) ? "bg-indigo-100 text-indigo-500" : "bg-orange-100 text-orange-500"}`} title={!linha.demoItemIdContabil ? "DRE Contábil não configurado" : dreContabilPage.some(i => i.id === linha.demoItemIdContabil) ? "DRE Contábil configurado" : "DRE Contábil: item não encontrado — reconfigure o mapeamento"}>C</span>
                                          </div>
                                        )}
                                        {editMode && (
                                          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {!isCalc && !isSubtotal && (
                                              <button
                                                onClick={() => setModal(linha.composicao !== undefined
                                                  ? { tipo: "composicao", blocoId: bloco.id, subId: sub.id, linha }
                                                  : { tipo: "valores", blocoId: bloco.id, subId: sub.id, linha })}
                                                className="p-1 hover:bg-emerald-100 rounded text-emerald-600 transition-colors"
                                                title={linha.composicao !== undefined ? "Editar composição" : "Editar valores"}>
                                                <Hash size={12} />
                                              </button>
                                            )}
                                            <button onClick={() => setModal({ tipo: "linha-edit", blocoId: bloco.id, subId: sub.id, linha })} className="p-1 hover:bg-blue-100 rounded text-blue-500 transition-colors" title="Editar linha"><Pencil size={12} /></button>
                                            <button onClick={() => deleteLinha(bloco.id, sub.id, linha.id)} className="p-1 hover:bg-red-100 rounded text-red-400 transition-colors" title="Excluir linha"><Trash2 size={12} /></button>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-2 py-1 text-right border-r border-gray-200 sticky z-10 left-[320px] group-hover:bg-blue-50/20" style={{ background: "#f8fafc" }}>
                                      <span className="text-sm tabular-nums font-semibold text-gray-700">
                                        {total !== 0 ? (linha.isPercentual ? fmtPercent(total) : fmtN(total)) : <span className="opacity-20">—</span>}
                                      </span>
                                    </td>
                                    {gruposAtivos.map(g => {
                                      const gVal = isEstoque
                                        ? vals[g.meses[g.meses.length - 1]]
                                        : g.meses.reduce((s, mi) => s + vals[mi], 0);
                                      if (viewMode === "mensal") {
                                        const mi = g.meses[0];
                                        const k = pk(ano, mi);
                                        const canEdit = editMode && !isCalc && !isSubtotal && linha.composicao === undefined;
                                        return (
                                          <td key={g.label} className="px-1 py-1 text-right">
                                            {canEdit ? (
                                              <input
                                                type="number"
                                                value={linha.valores[k] !== undefined && linha.valores[k] !== 0 ? linha.valores[k] : ""}
                                                onChange={e => setValoresInline(bloco.id, sub.id, linha.id, { [k]: e.target.value === "" ? 0 : Number(e.target.value) })}
                                                onPaste={e => {
                                                  const text = e.clipboardData.getData("text");
                                                  const parts = text.trim().split(/\r?\n/)[0].split("\t");
                                                  if (parts.length <= 1) return;
                                                  e.preventDefault();
                                                  const newVals: Record<string, number> = {};
                                                  parts.forEach((p, i) => { if (mi + i < 12) newVals[pk(ano, mi + i)] = parseBRNumber(p); });
                                                  setValoresInline(bloco.id, sub.id, linha.id, newVals);
                                                }}
                                                className="w-full text-right text-sm tabular-nums border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-[120px] bg-transparent"
                                                placeholder="—"
                                              />
                                            ) : (
                                              <span className={`text-sm tabular-nums ${isSubtotal ? "font-bold text-gray-700" : "text-gray-700"}`}>
                                                {vals[mi] !== 0 ? (linha.isPercentual ? fmtPercent(vals[mi]) : fmtN(vals[mi])) : <span className="opacity-20">—</span>}
                                              </span>
                                            )}
                                          </td>
                                        );
                                      }
                                      return (
                                        <td key={g.label} className="px-3 py-1.5 text-right">
                                          <span className={`text-sm tabular-nums ${isSubtotal ? "font-bold text-gray-700" : "text-gray-700"}`}>
                                            {gVal !== 0 ? (linha.isPercentual ? fmtPercent(gVal) : fmtN(gVal)) : <span className="opacity-20">—</span>}
                                          </span>
                                        </td>
                                      );
                                    })}
                                  </tr>
                                  {linhaExpanded && linha.tipo === "digitado" && linha.composicao && (crFiltroSet ? linha.composicao.filter(c => { if (!c.centroId) return true; const cod = crIdToCod.get(c.centroId); return !cod || crFiltroSet.has(cod); }) : linha.composicao).map(item => {
                                    const iVals = MESES.map((_, mi) => item.valores[pk(ano, mi)] ?? 0);
                                    const iTotal = isEstoque
                                      ? (iVals[mesesAtivos[mesesAtivos.length - 1]] ?? 0)
                                      : mesesAtivos.reduce((s, mi) => s + (iVals[mi] ?? 0), 0);
                                    return (
                                      <tr key={item.id} className="border-b border-gray-50" style={{ background: "#fafbfc" }}>
                                        <td className="sticky left-0 z-10 pl-8 pr-3 py-1" style={{ background: "#fafbfc" }}>
                                          <span className="text-xs text-gray-400">↳ {item.descricao}</span>
                                        </td>
                                        <td className="px-2 py-1 text-right border-r border-gray-200 sticky z-10 left-[320px]" style={{ background: "#fafbfc" }}>
                                          <span className="text-xs tabular-nums text-gray-400">{iTotal !== 0 ? fmtN(iTotal) : <span className="opacity-20">—</span>}</span>
                                        </td>
                                        {gruposAtivos.map(g => {
                                          const gVal = isEstoque
                                            ? (iVals[g.meses[g.meses.length - 1]] ?? 0)
                                            : g.meses.reduce((s, mi) => s + (iVals[mi] ?? 0), 0);
                                          return (
                                            <td key={g.label} className="px-2 py-1 text-right">
                                              <span className="text-xs tabular-nums text-gray-400">{gVal !== 0 ? fmtN(gVal) : <span className="opacity-20">—</span>}</span>
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                                  {linhaExpanded && linha.tipo === "calculado" && linha.formula?.op === "*" && (() => {
                                    const lL = sub.linhas.find(x => x.id === linha.formula!.left.linhaId);
                                    const rL = sub.linhas.find(x => x.id === linha.formula!.right.linhaId);
                                    if (!lL?.composicao?.length || !rL?.composicao?.length) return null;
                                    return lL.composicao.map((li, idx) => {
                                      const ri = rL.composicao![idx];
                                      if (!ri) return null;
                                      const iVals = MESES.map((_, mi) => {
                                        const lv = (li.valores[pk(ano, mi)] ?? 0) / (lL.isPercentual ? 100 : 1);
                                        const rv = (ri.valores[pk(ano, mi)] ?? 0) / (rL.isPercentual ? 100 : 1);
                                        return lv * rv;
                                      });
                                      const iTotal = isEstoque
                                        ? iVals[mesesAtivos[mesesAtivos.length - 1]]
                                        : mesesAtivos.reduce((s, mi) => s + iVals[mi], 0);
                                      return (
                                        <tr key={li.id} className="border-b border-gray-50" style={{ background: "#fafbfc" }}>
                                          <td className="sticky left-0 z-10 pl-8 pr-3 py-1" style={{ background: "#fafbfc" }}>
                                            <span className="text-xs text-gray-400">↳ {li.descricao}</span>
                                          </td>
                                          <td className="px-2 py-1 text-right border-r border-gray-200 sticky z-10 left-[320px]" style={{ background: "#fafbfc" }}>
                                            <span className="text-xs tabular-nums text-gray-400">{iTotal !== 0 ? fmtN(iTotal) : <span className="opacity-20">—</span>}</span>
                                          </td>
                                          {gruposAtivos.map(g => {
                                            const gVal = isEstoque
                                                ? iVals[g.meses[g.meses.length - 1]]
                                                : g.meses.reduce((s, mi) => s + iVals[mi], 0);
                                            return (
                                              <td key={g.label} className="px-2 py-1 text-right">
                                                <span className="text-xs tabular-nums text-gray-400">{gVal !== 0 ? fmtN(gVal) : <span className="opacity-20">—</span>}</span>
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      );
                                    });
                                  })()}
                                </React.Fragment>);
                              })}
                              {sub.totalizar && (() => {
                                const subLineIds = new Set(sub.linhas.map(l => l.id));
                                const referencedIds = new Set(
                                  sub.linhas
                                    .filter(l => l.tipo === "subtotal")
                                    .flatMap(l => l.subtotalLinhaIds ?? [])
                                    .filter(id => subLineIds.has(id))
                                );
                                const summableLines = sub.linhas.filter(l => !referencedIds.has(l.id));
                                const isSubBlocoEstoque = summableLines.length > 0 && summableLines.every(l => l.categoria === "indicador" && !!l.codIndicador && indicadorEstoqueSet.has(l.codIndicador));
                                const subTotalVals = MESES.map((_, mi) =>
                                  summableLines.reduce((s, l) => s + ev(l, sub.linhas, ano, mi), 0)
                                );
                                const subTotalTotal = isSubBlocoEstoque
                                  ? (subTotalVals[mesesAtivos[mesesAtivos.length - 1]] ?? 0)
                                  : mesesAtivos.reduce((s, mi) => s + subTotalVals[mi], 0);
                                return (
                                  <tr className="border-t-2 border-gray-200" style={{ background: "#f8fafc" }}>
                                    <td className="sticky left-0 z-10 px-4 py-2 font-bold text-sm text-gray-700" style={{ background: "#f8fafc" }}>
                                      Total · {sub.descricao}
                                    </td>
                                    <td className="px-2 py-2 text-right border-r border-gray-200 sticky z-10 left-[320px] font-bold text-sm text-gray-700 tabular-nums" style={{ background: "#f8fafc" }}>
                                      {subTotalTotal !== 0 ? fmtN(subTotalTotal) : <span className="opacity-20">—</span>}
                                    </td>
                                    {gruposAtivos.map(g => {
                                      const gVal = isSubBlocoEstoque
                                        ? subTotalVals[g.meses[g.meses.length - 1]]
                                        : g.meses.reduce((s, mi) => s + subTotalVals[mi], 0);
                                      return (
                                        <td key={g.label} className="px-3 py-2 text-right font-bold text-sm text-gray-700 tabular-nums">
                                          {gVal !== 0 ? fmtN(gVal) : <span className="opacity-20">—</span>}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })()}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                {bloco.totalizar && (() => {
                  const allSummableLines = bloco.subBlocos.flatMap(sub => {
                    const subLineIds = new Set(sub.linhas.map(l => l.id));
                    const referencedIds = new Set(
                      sub.linhas
                        .filter(l => l.tipo === "subtotal")
                        .flatMap(l => l.subtotalLinhaIds ?? [])
                        .filter(id => subLineIds.has(id))
                    );
                    return sub.linhas.filter(l => !referencedIds.has(l.id));
                  });
                  const isBlocoEstoque = allSummableLines.length > 0 && allSummableLines.every(l => l.categoria === "indicador" && !!l.codIndicador && indicadorEstoqueSet.has(l.codIndicador));
                  const totalVals = MESES.map((_, mi) =>
                    bloco.subBlocos.reduce((bSum, sub) => {
                      const subLineIds = new Set(sub.linhas.map(l => l.id));
                      const referencedIds = new Set(
                        sub.linhas
                          .filter(l => l.tipo === "subtotal")
                          .flatMap(l => l.subtotalLinhaIds ?? [])
                          .filter(id => subLineIds.has(id))
                      );
                      const summableLines = sub.linhas.filter(l => !referencedIds.has(l.id));
                      return bSum + summableLines.reduce((s, l) => s + ev(l, sub.linhas, ano, mi), 0);
                    }, 0)
                  );
                  const totalTotal = isBlocoEstoque
                    ? (totalVals[mesesAtivos[mesesAtivos.length - 1]] ?? 0)
                    : mesesAtivos.reduce((s, mi) => s + totalVals[mi], 0);
                  return (
                    <table className="text-sm border-t-2 border-gray-200" style={{ width: tableWidth, tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}>
                      <colgroup>
                        <col style={{ width: 320 }} />
                        <col style={{ width: 140 }} />
                        {gruposAtivos.map((_, i) => <col key={i} style={{ width: 140 }} />)}
                      </colgroup>
                      <tbody>
                        <tr style={{ background: "#f8fafc" }}>
                          <td className="sticky left-0 z-10 px-4 py-2.5 font-bold text-sm text-gray-700" style={{ background: "#f8fafc" }}>
                            Total · {bloco.descricao}
                          </td>
                          <td className="px-2 py-2.5 text-right border-r border-gray-200 sticky z-10 left-[320px] font-bold text-sm text-gray-700 tabular-nums" style={{ background: "#f8fafc" }}>
                            {totalTotal !== 0 ? fmtN(totalTotal) : <span className="opacity-20">—</span>}
                          </td>
                          {gruposAtivos.map(g => {
                            const gVal = isBlocoEstoque
                              ? totalVals[g.meses[g.meses.length - 1]]
                              : g.meses.reduce((s, mi) => s + totalVals[mi], 0);
                            return (
                              <td key={g.label} className="px-3 py-2.5 text-right font-bold text-sm text-gray-700 tabular-nums">
                                {gVal !== 0 ? fmtN(gVal) : <span className="opacity-20">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  );
                })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── FilterDrawer ─────────────────────────────────────────────────────── */}
      {filterOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setFilterOpen(false)} />
          <div className="fixed top-0 right-0 h-full w-[300px] z-50 bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 flex-shrink-0">
              <span className="font-semibold text-gray-800">Filtros</span>
              <button onClick={() => setFilterOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="border-b border-gray-100 px-4 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Período</p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">De</label>
                    <input type="month" value={rascunho.periodoInicio}
                      onChange={e => { const v = e.target.value; setRascunho(r => ({ ...r, periodoInicio: v, periodoFim: r.periodoFim && r.periodoFim < v ? v : r.periodoFim })); }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Até</label>
                    <input type="month" value={rascunho.periodoFim}
                      onChange={e => { const v = e.target.value; setRascunho(r => ({ ...r, periodoFim: v, periodoInicio: r.periodoInicio && r.periodoInicio > v ? v : r.periodoInicio })); }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                </div>
              </div>
              <div className="border-b border-gray-100 px-4 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Visão</p>
                <div className="space-y-0.5">
                  {(Object.keys(VIEW_LABELS) as ViewMode[]).map(mode => (
                    <label key={mode} className="flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-gray-50 rounded text-sm text-gray-700">
                      <input type="radio" checked={rascunho.viewMode === mode}
                        onChange={() => setRascunho(r => ({ ...r, viewMode: mode }))}
                        className="w-4 h-4 cursor-pointer flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
                      {VIEW_LABELS[mode]}
                    </label>
                  ))}
                </div>
              </div>
              {crOpcoes.length > 0 && (
                <div className="px-4 py-4">
                  <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center justify-between">
                    Centro de Resultado
                    {crFiltroIds.length > 0 && (
                      <button onClick={() => setCrFiltroIds([])} className="text-[11px] text-blue-600 hover:underline cursor-pointer font-normal">limpar</button>
                    )}
                  </p>
                  <div className="space-y-0.5">
                    {crOpcoes.map(cr => (
                      <label key={cr.CODCENCUS} className="flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-gray-50 rounded text-sm text-gray-700">
                        <input type="checkbox"
                          checked={crFiltroIds.includes(cr.CODCENCUS)}
                          onChange={e => setCrFiltroIds(p => e.target.checked ? [...p, cr.CODCENCUS] : p.filter(x => x !== cr.CODCENCUS))}
                          className="w-4 h-4 cursor-pointer flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
                        {cr.CODCENCUS} — {cr.DESCRCENCUS}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 px-4 py-4 border-t border-gray-200 flex-shrink-0">
              <button onClick={limparFiltros}
                className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                Limpar
              </button>
              <button onClick={aplicarFiltros}
                className="flex-1 px-3 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                style={{ background: "#1e3a5f" }}>
                Aplicar
              </button>
            </div>
          </div>
        </>
      )}
      {editMode && (modal?.tipo === "bloco-add" || modal?.tipo === "bloco-edit") && (
        <Modal title={modal.tipo === "bloco-add" ? "Novo Bloco" : "Editar Bloco"} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <input autoFocus value={nomeModal} onChange={e => setNomeModal(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (modal.tipo === "bloco-add" ? addBloco() : editBloco(modal.blocoId))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Ex: Real Estate, Renda Fixa..." />
            <div className="flex gap-3">
              <button onClick={() => setModal(null)} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancelar</button>
              <button onClick={() => modal.tipo === "bloco-add" ? addBloco() : editBloco(modal.blocoId)} disabled={!nomeModal.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-40" style={{ background: "#1e3a5f" }}>Salvar</button>
            </div>
          </div>
        </Modal>
      )}
      {editMode && (modal?.tipo === "sub-add" || modal?.tipo === "sub-edit") && (
        <Modal title={modal.tipo === "sub-add" ? "Novo Sub-bloco" : "Editar Sub-bloco"} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <input autoFocus value={nomeModal} onChange={e => setNomeModal(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (modal.tipo === "sub-add" ? addSub(modal.blocoId) : editSub(modal.blocoId, modal.subId))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Ex: Receita de Investment Banking..." />
            <div className="flex gap-3">
              <button onClick={() => setModal(null)} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancelar</button>
              <button onClick={() => modal.tipo === "sub-add" ? addSub(modal.blocoId) : editSub(modal.blocoId, modal.subId)} disabled={!nomeModal.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-40" style={{ background: "#1e3a5f" }}>Salvar</button>
            </div>
          </div>
        </Modal>
      )}
      {editMode && (modal?.tipo === "linha-add" || modal?.tipo === "linha-edit") && (() => {
        const sub = blocos.find(b => b.id === modal.blocoId)?.subBlocos.find(s => s.id === modal.subId);
        const outrasLinhas = sub?.linhas.filter(l => modal.tipo === "linha-edit" ? l.id !== modal.linha.id : true) ?? [];
        const categoriaHerdada = outrasLinhas.length > 0 ? outrasLinhas[0].categoria : "receita";
        const inicial = modal.tipo === "linha-add" ? { ...emptyLinha(), categoria: categoriaHerdada }
          : { descricao: modal.linha.descricao, categoria: modal.linha.categoria, tipo: modal.linha.tipo, isPercentual: modal.linha.isPercentual, demoItemIdGerencial: modal.linha.demoItemIdGerencial, demoItemIdContabil: modal.linha.demoItemIdContabil, codIndicador: modal.linha.codIndicador, naturezaId: modal.linha.naturezaId, centroResultadoId: modal.linha.centroResultadoId, composicao: modal.linha.composicao, formula: modal.linha.formula, formulaExpr: modal.linha.formulaExpr, subtotalLinhaIds: modal.linha.subtotalLinhaIds };
        return (
          <Modal title={modal.tipo === "linha-add" ? "Nova Linha" : "Editar Linha"} onClose={() => setModal(null)} wide>
            <LinhaForm inicial={inicial} linhasDisponiveis={outrasLinhas} allBlocos={blocos}
              initialId={modal.tipo === "linha-edit" ? modal.linha.id : undefined}
              onSave={form => modal.tipo === "linha-add" ? addLinha(modal.blocoId, modal.subId, form) : editLinha(modal.blocoId, modal.subId, modal.linha.id, form)}
              onCancel={() => setModal(null)} />
          </Modal>
        );
      })()}
      {modal?.tipo === "valores" && (
        <ValoresModal
          linha={modal.linha} ano={ano}
          onSave={vals => setValores(modal.blocoId, modal.subId, modal.linha.id, vals)}
          onClose={() => setModal(null)} />
      )}
      {modal?.tipo === "composicao" && (
        <ComposicaoModal
          linha={modal.linha} ano={ano}
          onSave={composicao => setComposicao(modal.blocoId, modal.subId, modal.linha.id, composicao)}
          onAutoSave={composicao => setComposicaoSilent(modal.blocoId, modal.subId, modal.linha.id, composicao)}
          onClose={() => setModal(null)} />
      )}
    </div>
  );
}












