"use client";

import React, { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { ChevronDown, ChevronRight as ChevronRt, Filter, Download } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData } from "@/lib/storage";
import { evalLinha, pk, type LinhaEval } from "@/lib/orcamento-eval";

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode      = "mensal" | "trimestral" | "quadrimestral" | "semestral";
type IndicadorTipo = "SUBTOTAL" | "INDICADOR";

interface FormulaItem  { subtotalId: string; sinal: "+" | "-"; }
interface FormulaBloco { id: string; label?: string; sinal: "+" | "-"; items: FormulaItem[]; }

interface IndicadorRow {
  id: string;
  tipo: IndicadorTipo;
  nivel: number;
  nome: string;
  codigo?: string;
  categoria?: "ESTOQUE" | "MENSAL";
  formula?: FormulaBloco[] | FormulaItem[];
  acumulado?: boolean;
}

// Minimal types for orçamento blobs
interface ComposicaoItem { id: string; valores: Record<string, number>; }
interface LinhaOrcamento {
  id: string;
  categoria: string;
  tipo: string;
  codIndicador?: string;
  isPercentual?: boolean;
  valores: Record<string, number>;
  composicao?: ComposicaoItem[];
}
interface SubBloco { id: string; linhas: LinhaOrcamento[]; }
interface Bloco    { id: string; subBlocos: SubBloco[]; }

interface Filtros {
  periodoInicio: string;
  periodoFim:    string;
  viewMode:      ViewMode;
  mostrarZeros:  boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const _y = new Date().getFullYear();
const filtrosVazios: Filtros = {
  periodoInicio: `${_y}-01`,
  periodoFim:    `${_y}-12`,
  viewMode:      "mensal",
  mostrarZeros:  false,
};

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

type GrupoDef = { label: string; sub: string; meses: number[] };

const GRUPOS_DEF: Record<ViewMode, GrupoDef[]> = {
  mensal: MESES.map((label, i) => ({ label, sub: "", meses: [i] })),
  trimestral: [
    { label: "1º Trim.",    sub: "Jan · Fev · Mar",                   meses: [0,1,2]        },
    { label: "2º Trim.",    sub: "Abr · Mai · Jun",                   meses: [3,4,5]        },
    { label: "3º Trim.",    sub: "Jul · Ago · Set",                   meses: [6,7,8]        },
    { label: "4º Trim.",    sub: "Out · Nov · Dez",                   meses: [9,10,11]      },
  ],
  quadrimestral: [
    { label: "1º Quadrim.", sub: "Jan · Fev · Mar · Abr",             meses: [0,1,2,3]      },
    { label: "2º Quadrim.", sub: "Mai · Jun · Jul · Ago",             meses: [4,5,6,7]      },
    { label: "3º Quadrim.", sub: "Set · Out · Nov · Dez",             meses: [8,9,10,11]    },
  ],
  semestral: [
    { label: "1º Sem.",     sub: "Jan · Fev · Mar · Abr · Mai · Jun", meses: [0,1,2,3,4,5]  },
    { label: "2º Sem.",     sub: "Jul · Ago · Set · Out · Nov · Dez", meses: [6,7,8,9,10,11] },
  ],
};

const VIEW_LABELS: Record<ViewMode, string> = {
  mensal:        "Mensal",
  trimestral:    "Trimestral",
  quadrimestral: "Quadrimestral",
  semestral:     "Semestral",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtInt(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(v: number): string {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function fmtValor(v: number, pct: boolean): string {
  return pct ? fmtPct(v) : fmtInt(v);
}

function getFormulaBlocos(formula: unknown): FormulaBloco[] {
  if (!Array.isArray(formula) || formula.length === 0) return [];
  if ((formula[0] as FormulaItem).subtotalId !== undefined)
    return [{ id: "__v1__", sinal: "+", items: formula as FormulaItem[] }];
  return formula as FormulaBloco[];
}

function buildCategoriaMap(indicadores: IndicadorRow[]): Map<string, "ESTOQUE" | "MENSAL"> {
  const map = new Map<string, "ESTOQUE" | "MENSAL">();
  for (const ind of indicadores) {
    if (ind.tipo === "INDICADOR")
      map.set(ind.id, ind.categoria === "ESTOQUE" ? "ESTOQUE" : "MENSAL");
  }
  for (let i = indicadores.length - 1; i >= 0; i--) {
    const ind = indicadores[i];
    if (ind.tipo !== "SUBTOTAL") continue;
    const leaves: IndicadorRow[] = [];
    for (let j = i + 1; j < indicadores.length; j++) {
      if (indicadores[j].nivel <= ind.nivel) break;
      if (indicadores[j].tipo === "INDICADOR") leaves.push(indicadores[j]);
    }
    map.set(ind.id, leaves.length > 0 && leaves.every(l => map.get(l.id) === "ESTOQUE") ? "ESTOQUE" : "MENSAL");
  }
  return map;
}

// Compute one month's values from the orcamento map instead of lançamentos
function computePeriodOrcado(
  indicadores: IndicadorRow[],
  orcadoValores: Map<string, Map<string, number>>,
  periodo: string,
  prevValores?: Map<string, number>
): Map<string, number> {
  const valores = new Map<string, number>();

  // Leaf indicators: read directly from orçamento map
  for (const ind of indicadores) {
    if (ind.tipo !== "INDICADOR") continue;
    valores.set(ind.id, orcadoValores.get(ind.id)?.get(periodo) ?? 0);
  }

  // SUBTOTALs without formula: sum direct children
  for (let i = indicadores.length - 1; i >= 0; i--) {
    const ind = indicadores[i];
    if (ind.tipo !== "SUBTOTAL" || getFormulaBlocos(ind.formula).length > 0) continue;
    let total = 0;
    for (let j = i + 1; j < indicadores.length; j++) {
      if (indicadores[j].nivel <= ind.nivel) break;
      if (indicadores[j].nivel === ind.nivel + 1) total += valores.get(indicadores[j].id) ?? 0;
    }
    valores.set(ind.id, total);
  }

  // SUBTOTALs with formula
  for (const ind of indicadores) {
    const blocos = getFormulaBlocos(ind.formula);
    if (ind.tipo !== "SUBTOTAL" || blocos.length === 0) continue;
    const total = blocos.reduce((sum, bloco) => {
      const blocoVal = bloco.items.reduce(
        (s, fi) => s + (fi.sinal === "+" ? 1 : -1) * (valores.get(fi.subtotalId) ?? 0), 0
      );
      return sum + (bloco.sinal === "+" ? 1 : -1) * blocoVal;
    }, 0);
    valores.set(ind.id, total);
  }

  // Acumulado
  if (prevValores) {
    for (const ind of indicadores) {
      if (!ind.acumulado) continue;
      valores.set(ind.id, (valores.get(ind.id) ?? 0) + (prevValores.get(ind.id) ?? 0));
    }
  }

  return valores;
}

function aggregatePeriods(
  meses: number[],
  monthly: Map<string, number>[],
  indicadores: IndicadorRow[],
  categoriaMap: Map<string, "ESTOQUE" | "MENSAL">
): Map<string, number> {
  const valores = new Map<string, number>();
  const lastMi = meses[meses.length - 1];

  // Step 1: leaf INDICADORs — ESTOQUE takes last month, MENSAL sums
  for (const ind of indicadores) {
    if (ind.tipo !== "INDICADOR") continue;
    valores.set(ind.id,
      categoriaMap.get(ind.id) === "ESTOQUE"
        ? (monthly[lastMi].get(ind.id) ?? 0)
        : meses.reduce((s, mi) => s + (monthly[mi].get(ind.id) ?? 0), 0)
    );
  }

  // Step 2: SUBTOTALs without formula — bottom-up, use already-aggregated children
  for (let i = indicadores.length - 1; i >= 0; i--) {
    const ind = indicadores[i];
    if (ind.tipo !== "SUBTOTAL" || getFormulaBlocos(ind.formula).length > 0) continue;
    if (categoriaMap.get(ind.id) === "ESTOQUE") {
      valores.set(ind.id, monthly[lastMi].get(ind.id) ?? 0);
    } else {
      let total = 0;
      for (let j = i + 1; j < indicadores.length; j++) {
        if (indicadores[j].nivel <= ind.nivel) break;
        if (indicadores[j].nivel === ind.nivel + 1) total += valores.get(indicadores[j].id) ?? 0;
      }
      valores.set(ind.id, total);
    }
  }

  // Step 3: formula-based SUBTOTALs — apply formula to aggregated values
  for (const ind of indicadores) {
    const blocos = getFormulaBlocos(ind.formula);
    if (ind.tipo !== "SUBTOTAL" || blocos.length === 0) continue;
    if (categoriaMap.get(ind.id) === "ESTOQUE") {
      valores.set(ind.id, monthly[lastMi].get(ind.id) ?? 0);
    } else {
      const total = blocos.reduce((sum, bloco) => {
        const blocoVal = bloco.items.reduce(
          (s, fi) => s + (fi.sinal === "+" ? 1 : -1) * (valores.get(fi.subtotalId) ?? 0), 0
        );
        return sum + (bloco.sinal === "+" ? 1 : -1) * blocoVal;
      }, 0);
      valores.set(ind.id, total);
    }
  }

  // Step 4: re-run non-formula SUBTOTALs so parents of formula-SUBTOTALs pick up Step 3 values
  for (let i = indicadores.length - 1; i >= 0; i--) {
    const ind = indicadores[i];
    if (ind.tipo !== "SUBTOTAL" || getFormulaBlocos(ind.formula).length > 0) continue;
    if (categoriaMap.get(ind.id) === "ESTOQUE") continue;
    let total = 0;
    for (let j = i + 1; j < indicadores.length; j++) {
      if (indicadores[j].nivel <= ind.nivel) break;
      if (indicadores[j].nivel === ind.nivel + 1) total += valores.get(indicadores[j].id) ?? 0;
    }
    valores.set(ind.id, total);
  }

  return valores;
}

function getRowStyle(tipo: IndicadorTipo, nivel: number) {
  if (tipo === "SUBTOTAL") {
    if (nivel === 1) return { bg: "#1e3a5f", color: "white",   fw: "700", dark: true };
    if (nivel === 2) return { bg: "#dbeafe", color: "#1e3a5f", fw: "600", dark: false };
    return                  { bg: "#f0f9ff", color: "#1e3a5f", fw: "600", dark: false };
  }
  return { bg: "white", color: "#334155", fw: "400", dark: false };
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function IndicadoresOrcadoPage() {
  const [indicadores] = usePersistedData<IndicadorRow[]>("portal_indicadores", []);

  // All 14 orçamento blobs
  const [orcGestao]     = usePersistedData<Bloco[]>("portal_orcamento_gestao_recursos", []);
  const [orcIB]         = usePersistedData<Bloco[]>("portal_orcamento_investment_banking", []);
  const [orcAdvisory]   = usePersistedData<Bloco[]>("portal_orcamento_advisory", []);
  const [orcResearch]   = usePersistedData<Bloco[]>("portal_orcamento_research", []);
  const [orcPessoal]    = usePersistedData<Bloco[]>("portal_orcamento_gastos_pacote_pessoal", []);
  const [orcCert]       = usePersistedData<Bloco[]>("portal_orcamento_gastos_pacote_certificacao", []);
  const [orcIncentivos] = usePersistedData<Bloco[]>("portal_orcamento_gastos_pacote_incentivos_comerciais", []);
  const [orcInst]       = usePersistedData<Bloco[]>("portal_orcamento_gastos_pacote_institucional", []);
  const [orcOcupacao]   = usePersistedData<Bloco[]>("portal_orcamento_gastos_pacote_ocupacao", []);
  const [orcEventos]    = usePersistedData<Bloco[]>("portal_orcamento_gastos_pacote_eventos", []);
  const [orcServEsp]    = usePersistedData<Bloco[]>("portal_orcamento_gastos_pacote_servicos_especializados", []);
  const [orcServJur]    = usePersistedData<Bloco[]>("portal_orcamento_gastos_pacote_servicos_juridicos", []);
  const [orcTec]        = usePersistedData<Bloco[]>("portal_orcamento_gastos_pacote_tecnologia", []);
  const [orcViagens]    = usePersistedData<Bloco[]>("portal_orcamento_gastos_pacote_viagens", []);

  const [collapsed,  setCollapsed]  = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [filtros,    setFiltros]    = usePersistedData<Filtros>("portal_ind_filtros_orcado", filtrosVazios);
  const [rascunho,   setRascunho]   = useState<Filtros>(filtrosVazios);

  // Build indicadorId → (YYYY-MM → value) from all orçamento blobs.
  // Handles both "digitado" (stored values) and "calculado" (formula-evaluated) indicator lines.
  const orcadoValores = useMemo(() => {
    const allBlocos: Bloco[] = [
      ...orcGestao, ...orcIB, ...orcAdvisory, ...orcResearch,
      ...orcPessoal, ...orcCert, ...orcIncentivos, ...orcInst,
      ...orcOcupacao, ...orcEventos, ...orcServEsp, ...orcServJur,
      ...orcTec, ...orcViagens,
    ];
    const map = new Map<string, Map<string, number>>();

    for (const bloco of allBlocos) {
      for (const sub of (bloco.subBlocos ?? [])) {
        const todas = sub.linhas ?? [];
        const allLinhasMap = new Map<string, LinhaEval>(todas.map(l => [l.id, l as LinhaEval]));

        for (const linha of todas) {
          if (linha.categoria !== "indicador" || !linha.codIndicador) continue;

          if (!map.has(linha.codIndicador)) map.set(linha.codIndicador, new Map());
          const indMap = map.get(linha.codIndicador)!;

          if (linha.tipo === "digitado") {
            const src = (linha.composicao && linha.composicao.length > 0)
              ? linha.composicao.reduce((acc, item) => {
                  for (const [k, v] of Object.entries(item.valores))
                    acc[k] = (acc[k] ?? 0) + v;
                  return acc;
                }, {} as Record<string, number>)
              : linha.valores;
            for (const [k, v] of Object.entries(src)) {
              if (v !== 0) indMap.set(k, (indMap.get(k) ?? 0) + v);
            }
          } else if (linha.tipo === "calculado") {
            // Infer year from any sibling digitado line that has stored values.
            let ano = new Date().getFullYear();
            for (const l of todas) {
              const k = Object.keys(l.valores)[0];
              if (k && k.length >= 4) { ano = parseInt(k.slice(0, 4)); break; }
            }
            for (let mi = 0; mi < 12; mi++) {
              const v = evalLinha(linha as LinhaEval, todas as LinhaEval[], ano, mi, allLinhasMap);
              if (v !== 0) indMap.set(pk(ano, mi), (indMap.get(pk(ano, mi)) ?? 0) + v);
            }
          }
        }
      }
    }
    return map;
  }, [orcGestao, orcIB, orcAdvisory, orcResearch, orcPessoal, orcCert, orcIncentivos,
      orcInst, orcOcupacao, orcEventos, orcServEsp, orcServJur, orcTec, orcViagens]);

  // Set of indicator ids marked as percentual in any orçamento linha
  const percentualSet = useMemo(() => {
    const s = new Set<string>();
    const allBlocos: Bloco[] = [
      ...orcGestao, ...orcIB, ...orcAdvisory, ...orcResearch,
      ...orcPessoal, ...orcCert, ...orcIncentivos, ...orcInst,
      ...orcOcupacao, ...orcEventos, ...orcServEsp, ...orcServJur,
      ...orcTec, ...orcViagens,
    ];
    for (const bloco of allBlocos)
      for (const sub of (bloco.subBlocos ?? []))
        for (const linha of (sub.linhas ?? []))
          if (linha.categoria === "indicador" && linha.codIndicador && linha.isPercentual)
            s.add(linha.codIndicador);
    return s;
  }, [orcGestao, orcIB, orcAdvisory, orcResearch, orcPessoal, orcCert, orcIncentivos,
      orcInst, orcOcupacao, orcEventos, orcServEsp, orcServJur, orcTec, orcViagens]);

  const categoriaMap = useMemo(() => buildCategoriaMap(indicadores), [indicadores]);

  const valoresPorMes = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    const ano = periodoInicio.slice(0, 4);
    const maps: Map<string, number>[] = [];
    MESES.forEach((_, mi) => {
      const p = `${ano}-${String(mi + 1).padStart(2, "0")}`;
      if (p < periodoInicio || p > periodoFim) { maps.push(new Map()); return; }
      maps.push(computePeriodOrcado(indicadores, orcadoValores, p, maps[mi - 1]));
    });
    return maps;
  }, [indicadores, orcadoValores, filtros]);

  const colunas = useMemo<{ label: string; sublabel?: string; valores: Map<string, number> }[]>(() => {
    const { viewMode, periodoInicio, periodoFim } = filtros;
    const ano = periodoInicio.slice(0, 4);
    return GRUPOS_DEF[viewMode]
      .filter(g => g.meses.some(mi => {
        const p = `${ano}-${String(mi + 1).padStart(2, "0")}`;
        return p >= periodoInicio && p <= periodoFim;
      }))
      .map(g => ({
        label:    g.label,
        sublabel: viewMode !== "mensal" ? g.sub : undefined,
        valores:  aggregatePeriods(g.meses, valoresPorMes, indicadores, categoriaMap),
      }));
  }, [filtros, valoresPorMes, indicadores, categoriaMap]);

  const visibleData = useMemo(() => {
    const hidden = new Set<string>();
    indicadores.forEach((row, idx) => {
      if (collapsed.has(row.id)) {
        for (let i = idx + 1; i < indicadores.length; i++) {
          if (indicadores[i].nivel <= row.nivel) break;
          hidden.add(indicadores[i].id);
        }
      }
    });
    return indicadores
      .map((row, dataIdx) => ({ row, dataIdx }))
      .filter(({ row }) => {
        if (hidden.has(row.id)) return false;
        if (!filtros.mostrarZeros && row.tipo === "INDICADOR") {
          if (colunas.every(c => (c.valores.get(row.id) ?? 0) === 0)) return false;
        }
        return true;
      });
  }, [indicadores, collapsed, filtros.mostrarZeros, colunas]);

  const filtrosAtivos = useMemo(() => {
    let n = 0;
    if (filtros.viewMode !== "mensal") n++;
    const ano = filtros.periodoInicio.slice(0, 4);
    if (filtros.periodoInicio !== `${ano}-01` || filtros.periodoFim !== `${ano}-12`) n++;
    if (filtros.mostrarZeros) n++;
    return n;
  }, [filtros]);

  const hasData = orcadoValores.size > 0;

  function toggleCollapse(id: string) {
    setCollapsed(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function aplicar()    { setFiltros(rascunho); setFilterOpen(false); }
  function limparTudo() { setRascunho(filtrosVazios); }

  function exportarExcel() {
    const rows = visibleData.map(({ row }) => {
      const r: Record<string, unknown> = { Indicador: row.nome };
      colunas.forEach(c => { r[c.label] = c.valores.get(row.id) ?? 0; });
      return r;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orçado");
    XLSX.writeFile(wb, `Indicadores_Orcado_${filtros.periodoInicio.slice(0, 4)}.xlsx`);
  }

  const anoAtivo     = filtros.periodoInicio.slice(0, 4);
  const viewMode     = filtros.viewMode;
  const mIni         = parseInt(filtros.periodoInicio.split("-")[1]) - 1;
  const mFim         = parseInt(filtros.periodoFim.split("-")[1])    - 1;
  const periodoLabel = mIni === 0 && mFim === 11
    ? anoAtivo
    : `${MESES[mIni]}–${MESES[mFim]} ${anoAtivo}`;
  const subtitle = `Orçado · ${periodoLabel}`;

  if (indicadores.length === 0) {
    return (
      <div>
        <PageHeader title="Indicadores" subtitle="Orçado" />
        <div className="p-6">
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-xl border border-gray-100">
            <p className="text-gray-500 font-medium">Nenhum indicador cadastrado.</p>
            <p className="text-gray-400 text-sm mt-1">Configure em Cadastros › Indicadores.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Indicadores" subtitle={subtitle} />

      <div className="p-6 space-y-4 min-w-max">

        {/* ── Controles ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setRascunho(filtros); setFilterOpen(true); }}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
            style={filtrosAtivos > 0 ? { borderColor: "#1e3a5f", color: "#1e3a5f" } : {}}>
            <Filter size={14} />
            Filtros
            {filtrosAtivos > 0 && (
              <span
                className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full text-white"
                style={{ background: "#1e3a5f" }}>
                {filtrosAtivos}
              </span>
            )}
          </button>

          <button
            onClick={exportarExcel}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors text-gray-600">
            <Download size={14} />
            Exportar Excel
          </button>

          <span className="ml-auto text-xs text-gray-400">
            {VIEW_LABELS[viewMode]} · {periodoLabel}
          </span>
        </div>

        {/* ── Tabela pivô ────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-5 py-3 border-b border-gray-100">
            <span className="font-semibold text-gray-800 text-sm">
              Indicadores · Orçado ·{" "}
              <span className="font-normal text-gray-500">{VIEW_LABELS[viewMode]} · {periodoLabel}</span>
            </span>
          </div>

          <div>
            <table className="text-sm border-collapse" style={{ minWidth: "max-content", width: "100%" }}>
              <thead>
                {viewMode === "trimestral" && (
                  <tr style={{ background: "#152d4a" }}>
                    <th className="sticky left-0 z-30 min-w-[200px]" style={{ background: "#152d4a" }} />
                    {colunas.map((c, ci) => (
                      <th key={ci} colSpan={1}
                        className="px-3 py-1 text-center text-[10px] text-white/50 uppercase tracking-widest font-semibold border-l border-white/10">
                        {c.label}
                      </th>
                    ))}
                    <th className="border-l border-white/10" style={{ background: "#152d4a" }} />
                  </tr>
                )}

                <tr style={{ background: "#1e3a5f" }}>
                  <th
                    className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky left-0 z-30 min-w-[200px]"
                    style={{ background: "#1e3a5f" }}>
                    Descrição
                  </th>
                  {colunas.map((c, ci) => {
                    const sep = viewMode === "trimestral" && ci > 0;
                    return (
                      <th key={ci}
                        className={`font-semibold text-white/80 text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap min-w-[130px]${sep ? " border-l border-white/10" : ""}`}
                        style={{ background: "#1e3a5f" }}>
                        <div className="uppercase">{c.label}</div>
                        {c.sublabel && <div className="font-normal text-[10px] text-white/40 mt-0.5">{c.sublabel}</div>}
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {visibleData.map(({ row, dataIdx }) => {
                  const hasFilhos = (() => {
                    for (let i = dataIdx + 1; i < indicadores.length; i++) {
                      if (indicadores[i].nivel <= row.nivel) return false;
                      return true;
                    }
                    return false;
                  })();
                  const effectiveTipo: IndicadorTipo = hasFilhos ? "SUBTOTAL" : row.tipo;
                  const s          = getRowStyle(effectiveTipo, row.nivel);
                  const isCollapse = hasFilhos;
                  const isCollapsed = isCollapse && collapsed.has(row.id);
                  const pct = percentualSet.has(row.id);

                  return (
                    <tr key={row.id}
                      style={{ background: s.bg, color: s.color, fontWeight: s.fw }}
                      className={`border-b border-gray-100 transition-all${isCollapse ? " cursor-pointer hover:brightness-95" : ""}`}
                      onClick={() => isCollapse ? toggleCollapse(row.id) : undefined}>

                      <td className="px-4 py-2.5 sticky left-0 z-10" style={{ background: s.bg }}>
                        <span className="flex items-center gap-1" style={{ paddingLeft: `${(row.nivel - 1) * 16}px` }}>
                          {isCollapse ? (
                            <span
                              className="flex-shrink-0 rounded p-0.5"
                              style={{ color: s.dark ? "rgba(255,255,255,0.7)" : "#1e3a5f" }}>
                              {isCollapsed ? <ChevronRt size={13} /> : <ChevronDown size={13} />}
                            </span>
                          ) : (
                            <span className="w-4 flex-shrink-0" />
                          )}
                          <span className="whitespace-nowrap">{row.nome}</span>
                        </span>
                      </td>

                      {colunas.map((c, ci) => {
                        const v   = c.valores.get(row.id) ?? 0;
                        const sep = viewMode === "trimestral" && ci > 0;
                        return (
                          <td key={ci}
                            className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap${sep ? " border-l border-gray-100" : ""}`}>
                            {v !== 0
                              ? <span className={v < 0 ? (s.dark ? "text-red-300" : "text-red-600") : ""}>{fmtValor(v, pct)}</span>
                              : <span style={{ opacity: 0.18 }}>—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                {!hasData && (
                  <tr>
                    <td colSpan={2 + colunas.length} className="px-4 py-12 text-center text-gray-400 text-sm">
                      Nenhum valor orçado encontrado. Configure em Orçamento e vincule linhas a indicadores.
                    </td>
                  </tr>
                )}

                {hasData && visibleData.length === 0 && (
                  <tr>
                    <td colSpan={2 + colunas.length} className="px-4 py-12 text-center text-gray-400 text-sm">
                      Nenhuma linha com valor.{" "}
                      <button
                        onClick={() => { setFiltros(f => ({ ...f, mostrarZeros: true })); setRascunho(r => ({ ...r, mostrarZeros: true })); }}
                        className="text-blue-500 hover:underline">
                        Mostrar linhas zeradas
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── FilterDrawer ──────────────────────────────────────────────────────── */}
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
                <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center justify-between">
                  Período
                  {(rascunho.periodoInicio || rascunho.periodoFim) && (
                    <span
                      onClick={() => setRascunho(r => ({ ...r, periodoInicio: "", periodoFim: "" }))}
                      className="text-[11px] text-blue-600 hover:underline cursor-pointer font-normal">
                      limpar
                    </span>
                  )}
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">De</label>
                    <input
                      type="month"
                      value={rascunho.periodoInicio}
                      onChange={e => {
                        const v = e.target.value;
                        setRascunho(r => ({
                          ...r,
                          periodoInicio: v,
                          periodoFim: r.periodoFim && r.periodoFim < v ? v : r.periodoFim,
                        }));
                      }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Até</label>
                    <input
                      type="month"
                      value={rascunho.periodoFim}
                      onChange={e => {
                        const v = e.target.value;
                        setRascunho(r => ({
                          ...r,
                          periodoFim: v,
                          periodoInicio: r.periodoInicio && r.periodoInicio > v ? v : r.periodoInicio,
                        }));
                      }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                </div>
              </div>

              <div className="border-b border-gray-100 px-4 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center justify-between">
                  Visão
                  {rascunho.viewMode !== "mensal" && (
                    <span
                      onClick={() => setRascunho(r => ({ ...r, viewMode: "mensal" }))}
                      className="text-[11px] text-blue-600 hover:underline cursor-pointer font-normal">
                      limpar
                    </span>
                  )}
                </p>
                <div className="space-y-0.5">
                  {(Object.keys(VIEW_LABELS) as ViewMode[]).map(mode => (
                    <label key={mode}
                      className="flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-gray-50 rounded text-sm text-gray-700">
                      <input
                        type="radio"
                        checked={rascunho.viewMode === mode}
                        onChange={() => setRascunho(r => ({ ...r, viewMode: mode }))}
                        className="w-4 h-4 cursor-pointer flex-shrink-0"
                        style={{ accentColor: "#1e3a5f" }} />
                      {VIEW_LABELS[mode]}
                    </label>
                  ))}
                </div>
              </div>

              <div className="px-4 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Exibição</p>
                <label className="flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-gray-50 rounded text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={rascunho.mostrarZeros}
                    onChange={e => setRascunho(r => ({ ...r, mostrarZeros: e.target.checked }))}
                    className="w-4 h-4 rounded cursor-pointer flex-shrink-0"
                    style={{ accentColor: "#1e3a5f" }} />
                  Mostrar linhas zeradas
                </label>
              </div>

            </div>

            <div className="flex gap-3 px-4 py-4 border-t border-gray-200 flex-shrink-0">
              <button onClick={limparTudo}
                className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                Limpar tudo
              </button>
              <button onClick={aplicar}
                className="flex-1 px-3 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                style={{ background: "#1e3a5f" }}>
                Aplicar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
