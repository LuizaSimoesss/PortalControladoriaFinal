"use client";

import React, { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { ChevronDown, ChevronRight as ChevronRt, Filter, Download } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData } from "@/lib/storage";
import { buildHierarchy } from "@/lib/utils";

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
interface FormulaBloco { id: string; label?: string; sinal: "+" | "-"; items: FormulaItem[]; }

interface IndicadorRow {
  id: string;
  tipo: IndicadorTipo;
  nivel: number;
  nome: string;
  codigo?: string;
  descricao?: string;
  categoria?: "ESTOQUE" | "MENSAL";
  fontes?: FonteIndicador[];
  formula?: FormulaBloco[] | FormulaItem[];
  acumulado?: boolean;
}

// Migra formato antigo FormulaItem[] → FormulaBloco[]
function getFormulaBlocos(formula: unknown): FormulaBloco[] {
  if (!Array.isArray(formula) || formula.length === 0) return [];
  if ((formula[0] as FormulaItem).subtotalId !== undefined)
    return [{ id: "__v1__", sinal: "+", items: formula as FormulaItem[] }];
  return formula as FormulaBloco[];
}


interface LancamentoIndicador {
  id: string;
  tipo: "realizado" | "orcado";
  data: string;
  periodo: string;
  cod_indicador: string;
  unidade?: "valor" | "percentual";
  valor: number;
  polo_cidade?: string;
  parceiro?: string;
  projeto?: string;
  cliente?: string;
  adquirida?: string;
  comentario?: string;
}

interface Filtros {
  periodoInicio: string; // "YYYY-MM"
  periodoFim:    string; // "YYYY-MM"
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
  lans: LancamentoIndicador[],
  prevValores?: Map<string, number>
): Map<string, number> {
  const valores = new Map<string, number>();

  // Pass 1: INDICADOR leaves — sum from fontes (or implicit cod match when no fontes)
  for (const ind of indicadores) {
    if (ind.tipo !== "INDICADOR") continue;

    const implicitRegra: RegraItem | undefined = ind.codigo
      ? { modo: "especifico", codEspecifico: ind.codigo }
      : undefined;

    const fontes = ind.fontes && ind.fontes.length > 0
      ? ind.fontes
      : implicitRegra ? [{ id: "__implicit__", tipo: "DIRETO" as const, codIndicador: implicitRegra }] : [];

    if (fontes.length === 0) { valores.set(ind.id, 0); continue; }

    const counted = new Set<number>();
    let total = 0;

    for (const fonte of fontes) {
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

  // Pass 2: SUBTOTAL sem fórmula — bottom-up, agrega filhos diretos
  for (let i = indicadores.length - 1; i >= 0; i--) {
    const ind = indicadores[i];
    if (ind.tipo !== "SUBTOTAL" || getFormulaBlocos(ind.formula).length > 0) continue;
    let total = 0;
    for (let j = i + 1; j < indicadores.length; j++) {
      if (indicadores[j].nivel <= ind.nivel) break;
      if (indicadores[j].nivel === ind.nivel + 1) {
        total += valores.get(indicadores[j].id) ?? 0;
      }
    }
    valores.set(ind.id, total);
  }

  // Pass 3: SUBTOTAL com fórmula(s) personalizada(s)
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

  // Pass 4: acumulado — soma valor do período anterior da própria linha
  if (prevValores) {
    for (const ind of indicadores) {
      if (!ind.acumulado) continue;
      valores.set(ind.id, (valores.get(ind.id) ?? 0) + (prevValores.get(ind.id) ?? 0));
    }
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
  // SUBTOTAL é ESTOQUE somente se todos os INDICADORs descendentes forem ESTOQUE
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
    const implicitRegra: RegraItem | undefined = leaf.codigo
      ? { modo: "especifico", codEspecifico: leaf.codigo }
      : undefined;
    const fontes = leaf.fontes && leaf.fontes.length > 0
      ? leaf.fontes
      : implicitRegra ? [{ id: "__implicit__", tipo: "DIRETO" as const, codIndicador: implicitRegra }] : [];
    for (const fonte of fontes) {
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

interface ProjetoRowL { id: string; CODPROJ: string; IDENTIFICACAO: string; ANALITICO: boolean; GRAU: number; }

export default function IndicadoresRealizadoPage() {
  const [indicadores] = usePersistedData<IndicadorRow[]>("portal_indicadores", []);
  const [lancamentos] = usePersistedData<LancamentoIndicador[]>("portal_lancamentos_indicadores", []);
  const [projetoData] = usePersistedData<ProjetoRowL[]>("portal_projetos", []);

  const [collapsed,  setCollapsed]  = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [filtros,    setFiltros]    = usePersistedData<Filtros>("portal_ind_filtros_realizado", filtrosVazios);
  const [rascunho,   setRascunho]   = useState<Filtros>(filtrosVazios);

  const [detalhe,     setDetalhe]     = useState<{ row: IndicadorRow; lans: LancamentoIndicador[] } | null>(null);
  const [periodosSel, setPeriodosSel] = useState<Set<string>>(new Set());
  const [verDetalheProj, setVerDetalheProj] = useState(false);
  const [expandedProj,   setExpandedProj]   = useState<Set<string>>(new Set());
  const [mostrarVariacao, setMostrarVariacao] = useState(false);

  const projetoMap = useMemo(
    () => new Map(projetoData.map(p => [p.CODPROJ, p.IDENTIFICACAO])),
    [projetoData]
  );

  // CODPROJ → ancestrais GRAU_3 e GRAU_4 (para agrupar projetos folha em dois níveis)
  const projetoAncestorMap = useMemo(() => {
    const sorted = [...projetoData].sort((a, b) =>
      a.CODPROJ.localeCompare(b.CODPROJ, undefined, { numeric: true, sensitivity: "base" })
    );
    const withH = buildHierarchy(sorted, "IDENTIFICACAO");
    const codByNomeGrau = new Map<string, Map<string, string>>(); // grau → nome → CODPROJ
    for (const r of sorted) {
      const g = String(r.GRAU);
      if (!codByNomeGrau.has(g)) codByNomeGrau.set(g, new Map());
      codByNomeGrau.get(g)!.set(r.IDENTIFICACAO, r.CODPROJ);
    }
    const map = new Map<string, { g3: { cod: string; nome: string }; g4: { cod: string; nome: string } }>();
    for (const r of withH) {
      const h = r as Record<string, string>;
      const g3nome = h.GRAU_3 ?? "";
      const g4nome = h.GRAU_4 ?? "";
      map.set(r.CODPROJ, {
        g3: { cod: codByNomeGrau.get("3")?.get(g3nome) ?? "", nome: g3nome },
        g4: { cod: codByNomeGrau.get("4")?.get(g4nome) ?? "", nome: g4nome },
      });
    }
    return map;
  }, [projetoData]);

  // Filter to realizado lancamentos only
  const lancamentosRealizado = useMemo(
    () => lancamentos.filter(l => l.tipo === "realizado"),
    [lancamentos]
  );

  // Index by periodo for efficient lookup
  const lancamentosPorPeriodo = useMemo(() => {
    const map = new Map<string, LancamentoIndicador[]>();
    for (const l of lancamentosRealizado) {
      const bucket = map.get(l.periodo);
      if (bucket) bucket.push(l);
      else map.set(l.periodo, [l]);
    }
    return map;
  }, [lancamentosRealizado]);

  // Lancamentos within the filtered period range
  const lancamentosPeriodo = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    return lancamentosRealizado.filter(l => l.periodo >= periodoInicio && l.periodo <= periodoFim);
  }, [lancamentosRealizado, filtros]);

  // 12 monthly Maps — sequential para suportar acumulado
  const valoresPorMes = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    const ano = periodoInicio.slice(0, 4);
    const maps: Map<string, number>[] = [];
    MESES.forEach((_, mi) => {
      const p = `${ano}-${String(mi + 1).padStart(2, "0")}`;
      if (p < periodoInicio || p > periodoFim) { maps.push(new Map()); return; }
      const prev = mi > 0 ? maps[mi - 1] : undefined;
      maps.push(computePeriodIndicadores(indicadores, lancamentosPorPeriodo.get(p) ?? [], prev));
    });
    return maps;
  }, [indicadores, lancamentosPorPeriodo, filtros]);

  // Categoria de cada indicador/nó (ESTOQUE vs MENSAL) para agregação
  const categoriaMap = useMemo(() => buildCategoriaMap(indicadores), [indicadores]);

  // Unidade por indicador — "percentual" se todos os lançamentos do período forem %
  const unidadeMap = useMemo(() => {
    const map = new Map<string, "valor" | "percentual">();
    for (const ind of indicadores) {
      if (ind.tipo !== "INDICADOR") continue;
      const lans = getLancamentosForIndicador(ind, indicadores, lancamentosPeriodo);
      map.set(ind.id, isPercentual(lans) ? "percentual" : "valor");
    }
    return map;
  }, [indicadores, lancamentosPeriodo]);

  // Colunas filtered by period range
  const colunas = useMemo<{ label: string; sublabel?: string; valores: Map<string, number>; meses: number[] }[]>(() => {
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
        meses:    g.meses,
      }));
  }, [filtros, valoresPorMes, indicadores, categoriaMap]);

  // Para cada INDICADOR com projeto: valores por projeto por coluna
  const projetoBreakdownMap = useMemo(() => {
    if (colunas.length === 0) return new Map<string, { cod: string; nome: string; g3: { cod: string; nome: string }; g4: { cod: string; nome: string }; valores: number[] }[]>();
    const ano = filtros.periodoInicio.slice(0, 4);
    const periodoToCol = new Map<string, number>();
    colunas.forEach((col, ci) => {
      col.meses.forEach(mi => {
        const p = `${ano}-${String(mi + 1).padStart(2, "0")}`;
        if (p >= filtros.periodoInicio && p <= filtros.periodoFim) periodoToCol.set(p, ci);
      });
    });
    const empty = { cod: "", nome: "" };
    const result = new Map<string, { cod: string; nome: string; g3: { cod: string; nome: string }; g4: { cod: string; nome: string }; valores: number[] }[]>();
    for (const ind of indicadores) {
      if (ind.tipo !== "INDICADOR") continue;
      const lans = getLancamentosForIndicador(ind, indicadores, lancamentosPeriodo);
      const comProj = lans.filter(l => l.projeto);
      if (comProj.length === 0) continue;
      const projData = new Map<string, number[]>();
      for (const l of comProj) {
        const ci = periodoToCol.get(l.periodo);
        if (ci === undefined) continue;
        if (!projData.has(l.projeto!)) projData.set(l.projeto!, new Array(colunas.length).fill(0));
        projData.get(l.projeto!)![ci] += l.valor;
      }
      const rows = [...projData.entries()]
        .map(([cod, valores]) => {
          const anc = projetoAncestorMap.get(cod) ?? { g3: empty, g4: empty };
          return { cod, nome: projetoMap.get(cod) ?? cod, g3: anc.g3, g4: anc.g4, valores };
        })
        .sort((a, b) => {
          const numCmp = (x: string, y: string) =>
            x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
          const c3 = numCmp(a.g3.cod || a.g3.nome, b.g3.cod || b.g3.nome);
          if (c3 !== 0) return c3;
          const c4 = numCmp(a.g4.cod || a.g4.nome, b.g4.cod || b.g4.nome);
          if (c4 !== 0) return c4;
          return numCmp(a.cod, b.cod);
        });
      if (rows.length > 0) result.set(ind.id, rows);
    }
    return result;
  }, [indicadores, lancamentosPeriodo, colunas, filtros.periodoInicio, filtros.periodoFim, projetoMap, projetoAncestorMap]);

  // Visible rows (collapsed + zero filter)
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

  // Detalhe helpers
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

  // Agrupa lançamentos visíveis por projeto → usado no painel de detalhamento
  const detalhePorProjeto = useMemo(() => {
    const visivel = detalheGrupos.flatMap(g => g.lans);
    const map = new Map<string, number>();
    for (const l of visivel) {
      if (!l.projeto) continue;
      map.set(l.projeto, (map.get(l.projeto) ?? 0) + l.valor);
    }
    return [...map.entries()]
      .map(([cod, valor]) => ({ cod, nome: projetoMap.get(cod) ?? cod, valor }))
      .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  }, [detalheGrupos, projetoMap]);

  function openDetalhe(row: IndicadorRow) {
    const lans = getLancamentosForIndicador(row, indicadores, lancamentosPeriodo);
    setDetalhe({ row, lans });
    setPeriodosSel(new Set(lans.map(l => l.periodo)));
    setVerDetalheProj(false);
  }

  function exportarDetalhe() {
    if (!detalhe) return;
    const rows = detalheGrupos.flatMap(g =>
      g.lans.map(l => ({
        Data:        fmtDate(l.data),
        Período:     fmtPeriodo(l.periodo),
        Indicador:   l.cod_indicador,
        Unidade:     l.unidade === "percentual" ? "%" : "R$",
        Valor:       l.valor,
        Polo:        l.polo_cidade ?? "",
        Parceiro:    l.parceiro ?? "",
        Projeto:     l.projeto ?? "",
        Cliente:     l.cliente ?? "",
        Adquirida:   l.adquirida ?? "",
        Comentário:  l.comentario ?? "",
      }))
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, detalhe.row.nome.slice(0, 31));
    XLSX.writeFile(wb, `Indicadores_${detalhe.row.nome.replace(/[/\\?*[\]]/g, "_")}.xlsx`);
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
  const subtitle     = `Realizado · ${periodoLabel}`;
  const totalLans    = lancamentosRealizado.filter(l => l.periodo.startsWith(anoAtivo)).length;

  // ── Empty states ──────────────────────────────────────────────────────────────

  if (indicadores.length === 0) {
    return (
      <div>
        <PageHeader title="Indicadores" subtitle="Realizado" />
        <div className="p-6">
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-xl border border-gray-100">
            <p className="text-gray-500 font-medium">Nenhum indicador cadastrado.</p>
            <p className="text-gray-400 text-sm mt-1">Configure em Cadastros › Indicadores.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader title="Indicadores" subtitle={subtitle} />

      <div className="p-6 space-y-4 min-w-max">

        {/* ── Controles ────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">

          {/* Filtros */}
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
            onClick={() => setMostrarVariacao(v => !v)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium border rounded-lg transition-colors"
            style={mostrarVariacao
              ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" }
              : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
            Variação
          </button>

          <span className="ml-auto text-xs text-gray-400">
            {totalLans.toLocaleString("pt-BR")} lançamentos · {VIEW_LABELS[viewMode]} · {periodoLabel}
          </span>
        </div>

        {/* ── Tabela pivô ──────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-semibold text-gray-800 text-sm">
              Indicadores · Realizado ·{" "}
              <span className="font-normal text-gray-500">{VIEW_LABELS[viewMode]} · {periodoLabel}</span>
            </span>
          </div>

          <div>
            <table className="text-sm border-collapse" style={{ minWidth: "max-content", width: "100%" }}>
              <thead>
                {/* Row grouping label — trimestral only */}
                {viewMode === "trimestral" && (
                  <tr style={{ background: "#152d4a" }}>
                    <th className="sticky left-0 z-30 min-w-[200px]" style={{ background: "#152d4a" }} />
                    {colunas.map((c, ci) => (
                      <th key={ci} colSpan={mostrarVariacao ? 2 : 1}
                        className="px-3 py-1 text-center text-[10px] text-white/50 uppercase tracking-widest font-semibold border-l border-white/10">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                )}

                {/* Main header */}
                <tr style={{ background: "#1e3a5f" }}>
                  <th
                    className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky left-0 z-30 min-w-[200px]"
                    style={{ background: "#1e3a5f" }}>
                    Descrição
                  </th>
                  {colunas.map((c, ci) => {
                    const sep = viewMode === "trimestral" && ci > 0;
                    return (
                      <React.Fragment key={ci}>
                        <th
                          className={`font-semibold text-white/80 text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap min-w-[130px]${sep ? " border-l border-white/10" : ""}`}
                          style={{ background: "#1e3a5f" }}>
                          <div className="uppercase">{c.label}</div>
                          {c.sublabel && <div className="font-normal text-[10px] text-white/40 mt-0.5">{c.sublabel}</div>}
                        </th>
                        {mostrarVariacao && (
                          <th
                            className="font-semibold text-white/40 text-[10px] tracking-wide px-2 py-2.5 text-right whitespace-nowrap min-w-[90px] border-l border-dashed border-white/20"
                            style={{ background: "#1e3a5f" }}>
                            Var.
                          </th>
                        )}
                      </React.Fragment>
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
                  const projRows    = projetoBreakdownMap.get(row.id);
                  const hasProjRows = !!projRows && projRows.length > 0;
                  const projExpanded = expandedProj.has(row.id);
                  const pct = unidadeMap.get(row.id) === "percentual";

                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        style={{ background: s.bg, color: s.color, fontWeight: s.fw }}
                        className="border-b border-gray-100 cursor-pointer hover:brightness-95 transition-all"
                        onClick={() => isCollapse ? toggleCollapse(row.id) : openDetalhe(row)}>

                        {/* Descrição — sticky */}
                        <td className="px-4 py-2.5 sticky left-0 z-10" style={{ background: s.bg }}>
                          <span className="flex items-center gap-1" style={{ paddingLeft: `${(row.nivel - 1) * 16}px` }}>
                            {isCollapse ? (
                              <span className="flex-shrink-0 rounded p-0.5" style={{ color: s.dark ? "rgba(255,255,255,0.7)" : "#1e3a5f" }}>
                                {isCollapsed ? <ChevronRt size={13} /> : <ChevronDown size={13} />}
                              </span>
                            ) : (
                              <span className="w-4 flex-shrink-0" />
                            )}
                            <span className="whitespace-nowrap">{row.nome}</span>
                            {hasProjRows && (
                              <button
                                onClick={e => { e.stopPropagation(); setExpandedProj(prev => { const n = new Set(prev); n.has(row.id) ? n.delete(row.id) : n.add(row.id); return n; }); }}
                                title={projExpanded ? "Ocultar projetos" : "Ver por projeto"}
                                className="ml-1.5 flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors"
                                style={projExpanded
                                  ? { background: "#1e3a5f", color: "white" }
                                  : { background: s.dark ? "rgba(255,255,255,0.15)" : "#e0e7ff", color: s.dark ? "white" : "#3730a3" }}>
                                {projExpanded ? <ChevronDown size={10} /> : <ChevronRt size={10} />}
                                {projRows!.length} proj.
                              </button>
                            )}
                          </span>
                        </td>

                        {/* Period values */}
                        {colunas.map((c, ci) => {
                          const v     = c.valores.get(row.id) ?? 0;
                          const prev  = ci > 0 ? (colunas[ci - 1].valores.get(row.id) ?? 0) : null;
                          const delta = prev !== null ? v - prev : null;
                          const deltaPct = (delta !== null && prev !== null && prev !== 0)
                            ? (delta / Math.abs(prev)) * 100 : null;
                          const sep   = viewMode === "trimestral" && ci > 0;
                          const varPos = delta !== null && delta > 0;
                          const varNeg = delta !== null && delta < 0;
                          return (
                            <React.Fragment key={ci}>
                              <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap${sep ? " border-l border-gray-100" : ""}`}>
                                {v !== 0
                                  ? <span className={v < 0 ? (s.dark ? "text-red-300" : "text-red-600") : ""}>{fmtValor(v, pct)}</span>
                                  : <span style={{ opacity: 0.18 }}>—</span>}
                              </td>
                              {mostrarVariacao && (
                                <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap min-w-[90px] border-l border-dashed border-gray-100">
                                  {delta === null || delta === 0
                                    ? <span style={{ opacity: 0.18 }}>—</span>
                                    : (
                                      <span>
                                        <div className={`text-xs font-medium ${varPos ? (s.dark ? "text-emerald-300" : "text-emerald-600") : (s.dark ? "text-red-300" : "text-red-500")}`}>
                                          {varPos ? "+" : ""}{fmtValor(delta!, pct)}
                                        </div>
                                        {deltaPct !== null && (
                                          <div className={`text-[10px] ${varPos ? (s.dark ? "text-emerald-400/70" : "text-emerald-500/70") : (s.dark ? "text-red-400/70" : "text-red-400/70")}`}>
                                            {varPos ? "+" : ""}{deltaPct.toFixed(1)}%
                                          </div>
                                        )}
                                      </span>
                                    )}
                                </td>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tr>

                      {/* Sub-linhas de projeto: GRAU_3 → GRAU_4 → folha */}
                      {hasProjRows && projExpanded && (() => {
                        const indent0 = (row.nivel - 1) * 16;

                        // Agrupar por G3
                        const byG3 = new Map<string, (typeof projRows)>();
                        for (const p of projRows!) {
                          const k = p.g3.nome || "__";
                          if (!byG3.has(k)) byG3.set(k, []);
                          byG3.get(k)!.push(p);
                        }

                        return [...byG3.entries()].map(([g3key, g3Projs]) => {
                          const g3 = g3Projs![0].g3;
                          const hasG3 = !!g3key && g3key !== "__";

                          // Agrupar por G4 dentro de G3
                          const byG4 = new Map<string, (typeof projRows)>();
                          for (const p of g3Projs!) {
                            const k = p.g4.nome || "__";
                            if (!byG4.has(k)) byG4.set(k, []);
                            byG4.get(k)!.push(p);
                          }

                          return (
                            <React.Fragment key={`${row.id}__g3__${g3key}`}>
                              {/* Grouper GRAU_3 */}
                              {hasG3 && (
                                <tr className="border-b border-blue-100" style={{ background: "#dbeafe" }}>
                                  <td className="px-4 py-1 sticky left-0 z-10" style={{ background: "#dbeafe" }}>
                                    <span className="flex items-center gap-1.5" style={{ paddingLeft: `${indent0 + 12}px` }}>
                                      <span className="text-[11px] font-semibold text-blue-800 whitespace-nowrap">{g3.nome}</span>
                                      {g3.cod && <span className="text-[10px] font-mono text-blue-400">{g3.cod}</span>}
                                    </span>
                                  </td>
                                  {colunas.map((_, ci) => {
                                    const v    = g3Projs!.reduce((s, p) => s + (p.valores[ci] ?? 0), 0);
                                    const prev = ci > 0 ? g3Projs!.reduce((s, p) => s + (p.valores[ci - 1] ?? 0), 0) : null;
                                    const delta = prev !== null ? v - prev : null;
                                    const sep  = viewMode === "trimestral" && ci > 0;
                                    return (
                                      <React.Fragment key={ci}>
                                        <td className={`px-3 py-1 text-right tabular-nums text-xs font-semibold whitespace-nowrap${sep ? " border-l border-blue-100" : ""}`}>
                                          {v !== 0 ? <span className={v < 0 ? "text-red-500" : "text-blue-800"}>{fmtValor(v, pct)}</span> : <span className="text-blue-200">—</span>}
                                        </td>
                                        {mostrarVariacao && (
                                          <td className="px-2 py-1 text-right tabular-nums text-xs whitespace-nowrap border-l border-dashed border-blue-100">
                                            {delta === null || delta === 0 ? <span className="text-blue-200">—</span> : (
                                              <span className={delta > 0 ? "text-emerald-600" : "text-red-500"}>
                                                {delta > 0 ? "+" : ""}{fmtValor(delta, pct)}
                                              </span>
                                            )}
                                          </td>
                                        )}
                                      </React.Fragment>
                                    );
                                  })}
                                </tr>
                              )}

                              {[...byG4.entries()].map(([g4key, g4Projs]) => {
                                const g4 = g4Projs![0].g4;
                                const hasG4 = !!g4key && g4key !== "__";

                                return (
                                  <React.Fragment key={`${row.id}__g4__${g4key}`}>
                                    {/* Grouper GRAU_4 */}
                                    {hasG4 && (
                                      <tr className="border-b border-indigo-100" style={{ background: "#eef2ff" }}>
                                        <td className="px-4 py-1 sticky left-0 z-10" style={{ background: "#eef2ff" }}>
                                          <span className="flex items-center gap-1.5" style={{ paddingLeft: `${indent0 + (hasG3 ? 24 : 12)}px` }}>
                                            <span className="text-[11px] font-medium text-indigo-700 whitespace-nowrap">{g4.nome}</span>
                                            {g4.cod && <span className="text-[10px] font-mono text-indigo-400">{g4.cod}</span>}
                                          </span>
                                        </td>
                                        {colunas.map((_, ci) => {
                                          const v    = g4Projs!.reduce((s, p) => s + (p.valores[ci] ?? 0), 0);
                                          const prev = ci > 0 ? g4Projs!.reduce((s, p) => s + (p.valores[ci - 1] ?? 0), 0) : null;
                                          const delta = prev !== null ? v - prev : null;
                                          const sep  = viewMode === "trimestral" && ci > 0;
                                          return (
                                            <React.Fragment key={ci}>
                                              <td className={`px-3 py-1 text-right tabular-nums text-xs font-medium whitespace-nowrap${sep ? " border-l border-indigo-100" : ""}`}>
                                                {v !== 0 ? <span className={v < 0 ? "text-red-500" : "text-indigo-700"}>{fmtValor(v, pct)}</span> : <span className="text-indigo-200">—</span>}
                                              </td>
                                              {mostrarVariacao && (
                                                <td className="px-2 py-1 text-right tabular-nums text-xs whitespace-nowrap border-l border-dashed border-indigo-100">
                                                  {delta === null || delta === 0 ? <span className="text-indigo-200">—</span> : (
                                                    <span className={delta > 0 ? "text-emerald-600" : "text-red-500"}>
                                                      {delta > 0 ? "+" : ""}{fmtValor(delta, pct)}
                                                    </span>
                                                  )}
                                                </td>
                                              )}
                                            </React.Fragment>
                                          );
                                        })}
                                      </tr>
                                    )}

                                    {/* Projetos folha */}
                                    {g4Projs!.map(proj => (
                                      <tr key={`${row.id}__${proj.cod}`}
                                        className="border-b border-indigo-50 hover:bg-indigo-50/60 transition-colors"
                                        style={{ background: "#f5f7ff" }}>
                                        <td className="px-4 py-1 sticky left-0 z-10" style={{ background: "#f5f7ff" }}>
                                          <span className="flex items-center gap-1.5"
                                            style={{ paddingLeft: `${indent0 + (hasG3 ? (hasG4 ? 40 : 28) : (hasG4 ? 28 : 12))}px` }}>
                                            <span className="w-1 h-1 rounded-full bg-indigo-300 flex-shrink-0" />
                                            <span className="text-xs text-gray-700 whitespace-nowrap">{proj.nome}</span>
                                            <span className="text-[10px] font-mono text-indigo-400">{proj.cod}</span>
                                          </span>
                                        </td>
                                        {colunas.map((_, ci) => {
                                          const v     = proj.valores[ci] ?? 0;
                                          const prev  = ci > 0 ? (proj.valores[ci - 1] ?? 0) : null;
                                          const delta = prev !== null ? v - prev : null;
                                          const sep   = viewMode === "trimestral" && ci > 0;
                                          return (
                                            <React.Fragment key={ci}>
                                              <td className={`px-3 py-1 text-right tabular-nums text-xs whitespace-nowrap${sep ? " border-l border-indigo-100" : ""}`}>
                                                {v !== 0 ? <span className={v < 0 ? "text-red-500" : "text-gray-700"}>{fmtValor(v, pct)}</span> : <span className="text-gray-200">—</span>}
                                              </td>
                                              {mostrarVariacao && (
                                                <td className="px-2 py-1 text-right tabular-nums text-xs whitespace-nowrap border-l border-dashed border-gray-100">
                                                  {delta === null || delta === 0 ? <span className="text-gray-200">—</span> : (
                                                    <span className={delta > 0 ? "text-emerald-600" : "text-red-500"}>
                                                      {delta > 0 ? "+" : ""}{fmtValor(delta, pct)}
                                                    </span>
                                                  )}
                                                </td>
                                              )}
                                            </React.Fragment>
                                          );
                                        })}
                                      </tr>
                                    ))}
                                  </React.Fragment>
                                );
                              })}
                            </React.Fragment>
                          );
                        });
                      })()}
                    </React.Fragment>
                  );
                })}

                {visibleData.length === 0 && lancamentosPeriodo.length === 0 && (
                  <tr>
                    <td colSpan={1 + colunas.length * (mostrarVariacao ? 2 : 1)} className="px-4 py-12 text-center text-gray-400 text-sm">
                      Nenhum lançamento de indicadores no período.
                    </td>
                  </tr>
                )}

                {visibleData.length === 0 && lancamentosPeriodo.length > 0 && (
                  <tr>
                    <td colSpan={1 + colunas.length * (mostrarVariacao ? 2 : 1)} className="px-4 py-12 text-center text-gray-400 text-sm">
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

              {/* Title */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 flex-shrink-0">
                <p className="font-semibold text-gray-800">{detalhe.row.nome}</p>
                <button onClick={() => setDetalhe(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none">✕</button>
              </div>

              {/* Period filter pills + totalizador */}
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

                {/* Totalizador */}
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

              {/* Detalhamento por Projeto */}
              {detalhePorProjeto.length > 0 && (
                <div className="border-b border-gray-100 flex-shrink-0">
                  <button
                    onClick={() => setVerDetalheProj(v => !v)}
                    className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-gray-50 transition-colors text-left">
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-2">
                      Detalhamento por Projeto
                      <span className="inline-flex items-center justify-center w-5 h-4 text-[10px] font-bold rounded-full text-white" style={{ background: "#1e3a5f" }}>
                        {detalhePorProjeto.length}
                      </span>
                    </span>
                    <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${verDetalheProj ? "rotate-180" : ""}`} />
                  </button>
                  {verDetalheProj && (
                    <div className="px-5 pb-3">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">Projeto</th>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 w-32">Código</th>
                            <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 w-40">Valor</th>
                            <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 w-20">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detalhePorProjeto.map(({ cod, nome, valor }) => {
                            const pct = detalheTotal !== 0 ? (valor / Math.abs(detalheTotal)) * 100 : 0;
                            const isPct = detalhe.lans.every(l => l.unidade === "percentual");
                            return (
                              <tr key={cod} className="border-b border-gray-50 hover:bg-blue-50/40 transition-colors">
                                <td className="px-3 py-2 text-sm text-gray-800 font-medium">{nome}</td>
                                <td className="px-3 py-2 text-xs font-mono text-blue-700 font-semibold">{cod}</td>
                                <td className={`px-3 py-2 text-right tabular-nums font-semibold text-sm${valor < 0 ? " text-red-600" : " text-gray-800"}`}>
                                  {fmtValor(valor, isPct)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-xs text-gray-400">
                                  {Math.abs(pct).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: "#f8fafc" }}>
                            <td colSpan={2} className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Total</td>
                            <td className={`px-3 py-2 text-right tabular-nums font-bold text-sm${detalheTotal < 0 ? " text-red-600" : " text-gray-800"}`}>
                              {fmtValor(detalhePorProjeto.reduce((s, r) => s + r.valor, 0), detalhe.lans.every(l => l.unidade === "percentual"))}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Table */}
              <div className="overflow-auto flex-1">
                <table className="text-sm w-full border-collapse">
                  <thead className="sticky top-0">
                    <tr style={{ background: "#1e3a5f" }}>
                      {[
                        { h: "Data",       right: false },
                        { h: "Período",    right: false },
                        { h: "Indicador",  right: false },
                        { h: "Polo",       right: false },
                        { h: "Parceiro",   right: false },
                        { h: "Projeto",    right: false },
                        { h: "Cliente",    right: false },
                        { h: "Adquirida",  right: false },
                        { h: "Comentário", right: false },
                        { h: "Valor",      right: true  },
                      ].map(({ h, right }) => (
                        <th key={h}
                          className={`px-3 py-2.5 text-white/80 text-xs uppercase tracking-wide font-semibold whitespace-nowrap${right ? " text-right" : " text-left"}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detalheGrupos.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-4 py-10 text-center text-gray-400 text-sm">
                          Nenhum lançamento para os períodos selecionados.
                        </td>
                      </tr>
                    )}
                    {detalheGrupos.map(g => (
                      <React.Fragment key={g.periodo}>
                        {g.lans.map((l, i) => (
                          <tr key={`${g.periodo}-${i}`} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-1.5 text-gray-500 tabular-nums whitespace-nowrap text-xs">{fmtDate(l.data)}</td>
                            <td className="px-3 py-1.5 text-gray-500 tabular-nums whitespace-nowrap text-xs">{fmtPeriodo(l.periodo)}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap">
                              <span className="font-mono text-xs font-semibold text-blue-700">{l.cod_indicador}</span>
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{l.polo_cidade || <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{l.parceiro || <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{l.projeto || <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{l.cliente || <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{l.adquirida || <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-1.5 text-xs text-gray-500 max-w-[160px] truncate" title={l.comentario}>{l.comentario || <span className="text-gray-300">—</span>}</td>
                            <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap font-medium text-sm${l.valor < 0 ? " text-red-600" : " text-gray-800"}`}>
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

              {/* Período */}
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

              {/* Visão */}
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

              {/* Exibição */}
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
