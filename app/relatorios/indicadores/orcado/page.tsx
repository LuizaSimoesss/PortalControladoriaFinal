"use client";

import React, { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { ChevronDown, ChevronRight as ChevronRt, Filter, Download } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData } from "@/lib/storage";

// ─── Types ────────────────────────────────────────────────────────────────────

type RegraMode = "none" | "especifico" | "intervalo";
type ViewMode  = "mensal" | "trimestral" | "quadrimestral" | "semestral";
type IndicadorTipo = "SUBTOTAL" | "INDICADOR";

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

interface LancamentoIndicador {
  id: string;
  tipo: "realizado" | "orcado";
  data: string;
  periodo: string;
  cod_indicador: string;
  unidade?: "valor" | "percentual";
  valor: number;
}

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
    { label: "1º Trim.",    sub: "Jan · Fev · Mar",                  meses: [0,1,2]        },
    { label: "2º Trim.",    sub: "Abr · Mai · Jun",                  meses: [3,4,5]        },
    { label: "3º Trim.",    sub: "Jul · Ago · Set",                  meses: [6,7,8]        },
    { label: "4º Trim.",    sub: "Out · Nov · Dez",                  meses: [9,10,11]      },
  ],
  quadrimestral: [
    { label: "1º Quadrim.", sub: "Jan · Fev · Mar · Abr",            meses: [0,1,2,3]      },
    { label: "2º Quadrim.", sub: "Mai · Jun · Jul · Ago",            meses: [4,5,6,7]      },
    { label: "3º Quadrim.", sub: "Set · Out · Nov · Dez",            meses: [8,9,10,11]    },
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

function isPercentual(lans: LancamentoIndicador[]): boolean {
  return lans.length > 0 && lans.every(l => l.unidade === "percentual");
}

function fmtValor(v: number, pct: boolean): string {
  return pct ? fmtPct(v) : fmtInt(v);
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function fmtPeriodo(p: string): string {
  const [y, m] = p.split("-");
  return `${MESES[parseInt(m) - 1]}/${y}`;
}

function matchesRegra(cod: string, r: RegraItem | undefined): boolean {
  if (!r || r.modo === "none") return true;
  if (r.modo === "especifico") return r.codEspecifico ? cod === r.codEspecifico : true;
  const cmp = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  if (r.codDe && cmp(cod, r.codDe) < 0) return false;
  if (r.codAte && cmp(cod, r.codAte) > 0) return false;
  return true;
}

function getIndicadorLeaves(node: IndicadorRow, all: IndicadorRow[]): IndicadorRow[] {
  if (node.tipo === "INDICADOR") return [node];
  const idx = all.findIndex(r => r.id === node.id);
  const leaves: IndicadorRow[] = [];
  for (let i = idx + 1; i < all.length; i++) {
    if (all[i].nivel <= node.nivel) break;
    if (all[i].tipo === "INDICADOR") leaves.push(all[i]);
  }
  return leaves;
}

function computePeriodIndicadores(
  indicadores: IndicadorRow[],
  lans: LancamentoIndicador[]
): Map<string, number> {
  const valores = new Map<string, number>();

  for (const ind of indicadores) {
    if (ind.tipo !== "INDICADOR") continue;
    if (!ind.fontes || ind.fontes.length === 0) { valores.set(ind.id, 0); continue; }

    const counted = new Set<number>();
    let total = 0;
    const implicitRegra: RegraItem | undefined = ind.codigo
      ? { modo: "especifico", codEspecifico: ind.codigo }
      : undefined;

    for (const fonte of ind.fontes) {
      const regra = (fonte.codIndicador && fonte.codIndicador.modo !== "none")
        ? fonte.codIndicador : implicitRegra;
      if (!regra) continue;
      for (let i = 0; i < lans.length; i++) {
        if (counted.has(i)) continue;
        const l = lans[i];
        if (!matchesRegra(l.cod_indicador, regra)) continue;
        counted.add(i);
        total += l.valor;
      }
    }
    valores.set(ind.id, total);
  }

  for (let i = indicadores.length - 1; i >= 0; i--) {
    const ind = indicadores[i];
    if (ind.tipo !== "SUBTOTAL" || (Array.isArray(ind.formula) && ind.formula.length > 0)) continue;
    let total = 0;
    for (let j = i + 1; j < indicadores.length; j++) {
      if (indicadores[j].nivel <= ind.nivel) break;
      if (indicadores[j].nivel === ind.nivel + 1) {
        total += valores.get(indicadores[j].id) ?? 0;
      }
    }
    valores.set(ind.id, total);
  }

  for (const ind of indicadores) {
    if (ind.tipo !== "SUBTOTAL" || !Array.isArray(ind.formula) || ind.formula.length === 0) continue;
    const total = (ind.formula as FormulaItem[]).reduce(
      (s, fi) => s + (fi.sinal === "+" ? 1 : -1) * (valores.get(fi.subtotalId) ?? 0),
      0
    );
    valores.set(ind.id, total);
  }

  return valores;
}

function buildCategoriaMap(indicadores: IndicadorRow[]): Map<string, "ESTOQUE" | "MENSAL"> {
  const map = new Map<string, "ESTOQUE" | "MENSAL">();
  for (const ind of indicadores) {
    if (ind.tipo === "INDICADOR") {
      map.set(ind.id, ind.categoria === "ESTOQUE" ? "ESTOQUE" : "MENSAL");
    }
  }
  for (let i = indicadores.length - 1; i >= 0; i--) {
    const ind = indicadores[i];
    if (ind.tipo !== "SUBTOTAL") continue;
    const leaves = getIndicadorLeaves(ind, indicadores);
    map.set(ind.id, leaves.length > 0 && leaves.every(l => map.get(l.id) === "ESTOQUE") ? "ESTOQUE" : "MENSAL");
  }
  return map;
}

function aggregatePeriods(
  meses: number[],
  monthly: Map<string, number>[],
  indicadores: IndicadorRow[],
  categoriaMap: Map<string, "ESTOQUE" | "MENSAL">
): Map<string, number> {
  const valores = new Map<string, number>();
  for (const ind of indicadores) {
    if (categoriaMap.get(ind.id) === "ESTOQUE") {
      const lastMi = meses[meses.length - 1];
      valores.set(ind.id, monthly[lastMi].get(ind.id) ?? 0);
    } else {
      valores.set(ind.id, meses.reduce((s, mi) => s + (monthly[mi].get(ind.id) ?? 0), 0));
    }
  }
  return valores;
}

function getLancamentosForIndicador(
  node: IndicadorRow,
  all: IndicadorRow[],
  lans: LancamentoIndicador[]
): LancamentoIndicador[] {
  const leaves = getIndicadorLeaves(node, all);
  if (leaves.length === 0) return [];

  const counted = new Set<number>();
  const result: LancamentoIndicador[] = [];

  for (const leaf of leaves) {
    if (!leaf.fontes || leaf.fontes.length === 0) continue;
    const implicitRegra: RegraItem | undefined = leaf.codigo
      ? { modo: "especifico", codEspecifico: leaf.codigo }
      : undefined;
    for (const fonte of leaf.fontes) {
      const regra = (fonte.codIndicador && fonte.codIndicador.modo !== "none")
        ? fonte.codIndicador
        : implicitRegra;
      if (!regra) continue;
      for (let i = 0; i < lans.length; i++) {
        if (counted.has(i)) continue;
        const l = lans[i];
        if (!matchesRegra(l.cod_indicador, regra)) continue;
        counted.add(i);
        result.push(l);
      }
    }
  }

  return result;
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
  const [lancamentos] = usePersistedData<LancamentoIndicador[]>("portal_lancamentos_indicadores", []);

  const [collapsed,  setCollapsed]  = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [filtros,    setFiltros]    = usePersistedData<Filtros>("portal_ind_filtros_orcado", filtrosVazios);
  const [rascunho,   setRascunho]   = useState<Filtros>(filtrosVazios);

  const [detalhe,     setDetalhe]     = useState<{ row: IndicadorRow; lans: LancamentoIndicador[] } | null>(null);
  const [periodosSel, setPeriodosSel] = useState<Set<string>>(new Set());

  // Filter to orcado lancamentos only
  const lancamentosOrcado = useMemo(
    () => lancamentos.filter(l => l.tipo === "orcado"),
    [lancamentos]
  );

  const lancamentosPorPeriodo = useMemo(() => {
    const map = new Map<string, LancamentoIndicador[]>();
    for (const l of lancamentosOrcado) {
      const bucket = map.get(l.periodo);
      if (bucket) bucket.push(l);
      else map.set(l.periodo, [l]);
    }
    return map;
  }, [lancamentosOrcado]);

  const lancamentosPeriodo = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    return lancamentosOrcado.filter(l => l.periodo >= periodoInicio && l.periodo <= periodoFim);
  }, [lancamentosOrcado, filtros]);

  const valoresPorMes = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    const ano = periodoInicio.slice(0, 4);
    return MESES.map((_, mi) => {
      const p = `${ano}-${String(mi + 1).padStart(2, "0")}`;
      if (p < periodoInicio || p > periodoFim) return new Map<string, number>();
      return computePeriodIndicadores(indicadores, lancamentosPorPeriodo.get(p) ?? []);
    });
  }, [indicadores, lancamentosPorPeriodo, filtros]);

  const categoriaMap = useMemo(() => buildCategoriaMap(indicadores), [indicadores]);

  const unidadeMap = useMemo(() => {
    const map = new Map<string, "valor" | "percentual">();
    for (const ind of indicadores) {
      if (ind.tipo !== "INDICADOR") continue;
      const lans = getLancamentosForIndicador(ind, indicadores, lancamentosPeriodo);
      map.set(ind.id, isPercentual(lans) ? "percentual" : "valor");
    }
    return map;
  }, [indicadores, lancamentosPeriodo]);

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

  const detalhePeriodos = useMemo(() =>
    detalhe ? [...new Set(detalhe.lans.map(l => l.periodo))].sort() : [],
    [detalhe]
  );

  const detalheGrupos = useMemo(() => {
    if (!detalhe) return [];
    const sorted = [...detalhe.lans]
      .filter(l => periodosSel.has(l.periodo))
      .sort((a, b) => a.periodo.localeCompare(b.periodo) || a.data.localeCompare(b.data));
    const grupos: { periodo: string; lans: LancamentoIndicador[] }[] = [];
    for (const l of sorted) {
      const last = grupos[grupos.length - 1];
      if (last && last.periodo === l.periodo) last.lans.push(l);
      else grupos.push({ periodo: l.periodo, lans: [l] });
    }
    return grupos;
  }, [detalhe, periodosSel]);

  const detalheTotal = useMemo(() =>
    detalheGrupos.reduce((s, g) => s + g.lans.reduce((ss, l) => ss + l.valor, 0), 0),
    [detalheGrupos]
  );

  function openDetalhe(row: IndicadorRow) {
    const lans = getLancamentosForIndicador(row, indicadores, lancamentosPeriodo);
    setDetalhe({ row, lans });
    setPeriodosSel(new Set(lans.map(l => l.periodo)));
  }

  function exportarDetalhe() {
    if (!detalhe) return;
    const rows = detalheGrupos.flatMap(g =>
      g.lans.map(l => ({
        Data:      fmtDate(l.data),
        Período:   fmtPeriodo(l.periodo),
        Indicador: l.cod_indicador,
        Unidade:   l.unidade === "percentual" ? "%" : "R$",
        Valor:     l.valor,
      }))
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, detalhe.row.nome.slice(0, 31));
    XLSX.writeFile(wb, `Indicadores_Orcado_${detalhe.row.nome.replace(/[/\\?*[\]]/g, "_")}.xlsx`);
  }

  function toggleCollapse(id: string) {
    setCollapsed(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function aplicar()    { setFiltros(rascunho); setFilterOpen(false); }
  function limparTudo() { setRascunho(filtrosVazios); }

  const anoAtivo     = filtros.periodoInicio.slice(0, 4);
  const viewMode     = filtros.viewMode;
  const mIni         = parseInt(filtros.periodoInicio.split("-")[1]) - 1;
  const mFim         = parseInt(filtros.periodoFim.split("-")[1])    - 1;
  const periodoLabel = mIni === 0 && mFim === 11
    ? anoAtivo
    : `${MESES[mIni]}–${MESES[mFim]} ${anoAtivo}`;
  const subtitle     = `Orçado · ${periodoLabel}`;
  const totalLans    = lancamentosOrcado.filter(l => l.periodo.startsWith(anoAtivo)).length;

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

      <div className="p-6 space-y-4">

        {/* ── Controles ────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">
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

          <span className="ml-auto text-xs text-gray-400">
            {totalLans.toLocaleString("pt-BR")} lançamentos · {VIEW_LABELS[viewMode]} · {periodoLabel}
          </span>
        </div>

        {/* ── Tabela pivô ──────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-semibold text-gray-800 text-sm">
              Indicadores · Orçado ·{" "}
              <span className="font-normal text-gray-500">{VIEW_LABELS[viewMode]} · {periodoLabel}</span>
            </span>
          </div>

          <div className="overflow-x-auto">
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
                  const hasFilhos = (() => { for (let i = dataIdx + 1; i < indicadores.length; i++) { if (indicadores[i].nivel <= row.nivel) return false; return true; } return false; })();
                  const effectiveTipo: IndicadorTipo = hasFilhos ? "SUBTOTAL" : row.tipo;
                  const s           = getRowStyle(effectiveTipo, row.nivel);
                  const isCollapse  = hasFilhos;
                  const isCollapsed = isCollapse && collapsed.has(row.id);

                  return (
                    <tr key={row.id}
                      style={{ background: s.bg, color: s.color, fontWeight: s.fw }}
                      className="border-b border-gray-100 cursor-pointer hover:brightness-95 transition-all"
                      onClick={() => isCollapse ? toggleCollapse(row.id) : openDetalhe(row)}>

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
                        const pct = unidadeMap.get(row.id) === "percentual";
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

                {visibleData.length === 0 && lancamentosPeriodo.length === 0 && (
                  <tr>
                    <td colSpan={2 + colunas.length} className="px-4 py-12 text-center text-gray-400 text-sm">
                      Nenhum lançamento de indicadores orçados no período.
                    </td>
                  </tr>
                )}

                {visibleData.length === 0 && lancamentosPeriodo.length > 0 && (
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

      {/* ── Modal de detalhamento ────────────────────────────────────────────── */}
      {detalhe && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setDetalhe(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-[96vw] max-h-[88vh] flex flex-col">

              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 flex-shrink-0">
                <p className="font-semibold text-gray-800">{detalhe.row.nome}</p>
                <button onClick={() => setDetalhe(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none">✕</button>
              </div>

              <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0 flex-wrap">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Período</span>
                <div className="flex items-center gap-1.5 flex-wrap flex-1">
                  {detalhePeriodos.map(p => {
                    const sel = periodosSel.has(p);
                    return (
                      <button key={p}
                        onClick={() => setPeriodosSel(prev => {
                          const n = new Set(prev);
                          sel ? n.delete(p) : n.add(p);
                          return n;
                        })}
                        className="px-2.5 py-1 rounded-full text-xs font-medium transition-all border"
                        style={sel
                          ? { background: "#1e3a5f", color: "white",   borderColor: "#1e3a5f" }
                          : { background: "white",   color: "#64748b", borderColor: "#e2e8f0" }}>
                        {fmtPeriodo(p)}
                      </button>
                    );
                  })}
                  {detalhePeriodos.length > 1 && (
                    <button
                      onClick={() => setPeriodosSel(
                        periodosSel.size === detalhePeriodos.length
                          ? new Set()
                          : new Set(detalhePeriodos)
                      )}
                      className="text-[11px] text-blue-600 hover:underline ml-1">
                      {periodosSel.size === detalhePeriodos.length ? "Desmarcar todos" : "Selecionar todos"}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-4 flex-shrink-0 border-l border-gray-200 pl-4">
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Lançamentos</p>
                    <p className="text-sm font-semibold text-gray-700 tabular-nums">
                      {detalheGrupos.reduce((s, g) => s + g.lans.length, 0).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Total</p>
                    <p className={`text-sm font-bold tabular-nums${detalheTotal < 0 ? " text-red-600" : " text-gray-800"}`}>
                      {fmtValor(detalheTotal, detalhe.lans.every(l => l.unidade === "percentual"))}
                    </p>
                  </div>
                  <button onClick={exportarDetalhe}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors whitespace-nowrap">
                    <Download size={13} />
                    Exportar Excel
                  </button>
                </div>
              </div>

              <div className="overflow-auto flex-1">
                <table className="text-sm w-full border-collapse">
                  <thead className="sticky top-0">
                    <tr style={{ background: "#1e3a5f" }}>
                      {["Data","Período","Indicador","Valor"].map((h, i) => (
                        <th key={i}
                          className={`px-3 py-2.5 text-white/80 text-xs uppercase tracking-wide font-semibold whitespace-nowrap${i === 3 ? " text-right" : " text-left"}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detalheGrupos.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">
                          Nenhum lançamento para os períodos selecionados.
                        </td>
                      </tr>
                    )}
                    {detalheGrupos.map(g => (
                      <React.Fragment key={g.periodo}>
                        {g.lans.map((l, i) => (
                          <tr key={`${g.periodo}-${i}`} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-1.5 text-gray-500 tabular-nums whitespace-nowrap">{fmtDate(l.data)}</td>
                            <td className="px-3 py-1.5 text-gray-500 tabular-nums whitespace-nowrap">{fmtPeriodo(l.periodo)}</td>
                            <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                              <span className="text-gray-400 text-xs mr-1">{l.cod_indicador}</span>
                            </td>
                            <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap font-medium${l.valor < 0 ? " text-red-600" : " text-gray-800"}`}>
                              {fmtValor(l.valor, l.unidade === "percentual")}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>
          </div>
        </>
      )}

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
