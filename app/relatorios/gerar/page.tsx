"use client";

import React, { useState, useMemo, useEffect } from "react";
import { FileDown, Eye, EyeOff } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { loadData } from "@/lib/storage";
import { buildHierarchy } from "@/lib/utils";
import { buildOrcamentoMap, getOrcamentoAnos } from "@/lib/orcamentoData";
import { buildForecastMap, getForecastAnos } from "@/lib/forecastData";
import { buildRealizadoMap } from "@/lib/realizadoData";
import type { CentroResultadoRow } from "@/lib/mockData";

// ─── Types ───────────────────────────────────────────────────────────────────

type ItemTipo = "SUBTOTAL" | "CONTA";
type ViewMode  = "mensal" | "trimestral" | "quadrimestral" | "semestral";
type Fonte     = "orcado" | "realizado" | "comparativo" | "forecast" | "pacote_orcado" | "pacote_forecast" | "ind_orcado" | "ind_realizado" | "ind_comparativo";
type DreField  = "gerencial" | "contabil";

interface FormulaItem { subtotalId: string; sinal: "+" | "-" }
interface DemoItem    { id: string; nivel: number; tipo: ItemTipo; descricao: string; formula?: FormulaItem[] }
interface PeriodResult { valores: Map<string, number> }

interface RelConfig { id: string; label: string; grupo: string; dreKey: string; dreField: DreField; fonte: Fonte; storageKey?: string }

// ─── Indicadores types ────────────────────────────────────────────────────────

interface FormulaItemG  { subtotalId: string; sinal: "+" | "-" }
interface FormulaBlocoG { id: string; sinal: "+" | "-"; items: FormulaItemG[] }
interface IndicadorRowG {
  id: string; tipo: "SUBTOTAL" | "INDICADOR"; nivel: number; nome: string;
  codigo?: string; categoria?: "ESTOQUE" | "MENSAL";
  fontes?: Array<{ id: string; tipo: string; codIndicador?: { modo: string; codEspecifico?: string; codDe?: string; codAte?: string } }>;
  formula?: unknown; acumulado?: boolean;
}
interface LanIndicadorG { id: string; tipo: "realizado" | "orcado"; periodo: string; cod_indicador: string; unidade?: "valor" | "percentual"; valor: number }
interface BlocoIndG     { id: string; subBlocos: Array<{ id: string; linhas: Array<{ categoria: string; tipo: string; codIndicador?: string; isPercentual?: boolean; valores: Record<string, number>; composicao?: Array<{ valores: Record<string, number> }> }> }> }

// ─── Indicadores helpers ──────────────────────────────────────────────────────

function getFormulaBlocosG(formula: unknown): FormulaBlocoG[] {
  if (!Array.isArray(formula) || formula.length === 0) return [];
  if ((formula[0] as FormulaItemG).subtotalId !== undefined)
    return [{ id: "__v1__", sinal: "+", items: formula as FormulaItemG[] }];
  return formula as FormulaBlocoG[];
}

function buildCategoriaMapG(inds: IndicadorRowG[]): Map<string, "ESTOQUE" | "MENSAL"> {
  const map = new Map<string, "ESTOQUE" | "MENSAL">();
  for (const ind of inds)
    if (ind.tipo === "INDICADOR") map.set(ind.id, ind.categoria === "ESTOQUE" ? "ESTOQUE" : "MENSAL");
  for (let i = inds.length - 1; i >= 0; i--) {
    const ind = inds[i];
    if (ind.tipo !== "SUBTOTAL") continue;
    const leaves: IndicadorRowG[] = [];
    for (let j = i + 1; j < inds.length; j++) {
      if (inds[j].nivel <= ind.nivel) break;
      if (inds[j].tipo === "INDICADOR") leaves.push(inds[j]);
    }
    map.set(ind.id, leaves.length > 0 && leaves.every(l => map.get(l.id) === "ESTOQUE") ? "ESTOQUE" : "MENSAL");
  }
  return map;
}

// ESTOQUE → last period value; MENSAL → sum — this is THE key fix
function aggregatePeriodsG(
  meses: number[], monthly: Map<string, number>[],
  inds: IndicadorRowG[], categoriaMap: Map<string, "ESTOQUE" | "MENSAL">
): Map<string, number> {
  const valores = new Map<string, number>();
  for (const ind of inds) {
    if (categoriaMap.get(ind.id) === "ESTOQUE") {
      valores.set(ind.id, monthly[meses[meses.length - 1]].get(ind.id) ?? 0);
    } else {
      valores.set(ind.id, meses.reduce((s, mi) => s + (monthly[mi].get(ind.id) ?? 0), 0));
    }
  }
  return valores;
}

function matchesRegraG(cod: string, r: { modo: string; codEspecifico?: string; codDe?: string; codAte?: string }): boolean {
  if (r.modo === "none") return true;
  if (r.modo === "especifico") return !!r.codEspecifico && cod === r.codEspecifico;
  const n = +cod, isNum = !isNaN(n);
  if (r.codDe)  { const d = +r.codDe;  if (isNum && !isNaN(d) ? n < d : cod < r.codDe)  return false; }
  if (r.codAte) { const a = +r.codAte; if (isNum && !isNaN(a) ? n > a : cod > r.codAte) return false; }
  return true;
}

function applyFormulasG(inds: IndicadorRowG[], valores: Map<string, number>) {
  for (let i = inds.length - 1; i >= 0; i--) {
    const ind = inds[i];
    if (ind.tipo !== "SUBTOTAL" || getFormulaBlocosG(ind.formula).length > 0) continue;
    let total = 0;
    for (let j = i + 1; j < inds.length; j++) {
      if (inds[j].nivel <= ind.nivel) break;
      if (inds[j].nivel === ind.nivel + 1) total += valores.get(inds[j].id) ?? 0;
    }
    valores.set(ind.id, total);
  }
  for (const ind of inds) {
    const blocos = getFormulaBlocosG(ind.formula);
    if (ind.tipo !== "SUBTOTAL" || blocos.length === 0) continue;
    valores.set(ind.id, blocos.reduce((s, b) => {
      const bv = b.items.reduce((bs, fi) => bs + (fi.sinal === "+" ? 1 : -1) * (valores.get(fi.subtotalId) ?? 0), 0);
      return s + (b.sinal === "+" ? 1 : -1) * bv;
    }, 0));
  }
}

// Orcado: reads from orcamento blobs map
function computePeriodOrcadoG(
  inds: IndicadorRowG[], orcMap: Map<string, Map<string, number>>,
  periodo: string, prev?: Map<string, number>
): Map<string, number> {
  const valores = new Map<string, number>();
  for (const ind of inds)
    if (ind.tipo === "INDICADOR") valores.set(ind.id, orcMap.get(ind.id)?.get(periodo) ?? 0);
  applyFormulasG(inds, valores);
  if (prev) for (const ind of inds) if (ind.acumulado) valores.set(ind.id, (valores.get(ind.id) ?? 0) + (prev.get(ind.id) ?? 0));
  return valores;
}

// Realizado / comparativo orcado: reads from lancamentos
function computePeriodLanG(
  inds: IndicadorRowG[], lans: LanIndicadorG[], prev?: Map<string, number>
): Map<string, number> {
  const valores = new Map<string, number>();
  for (const ind of inds) {
    if (ind.tipo !== "INDICADOR") continue;
    const counted = new Set<number>();
    let total = 0;
    const implicit = ind.codigo ? { modo: "especifico", codEspecifico: ind.codigo } : undefined;
    const fontes = ind.fontes?.length ? ind.fontes : (implicit ? [{ id: "_", tipo: "DIRETO", codIndicador: implicit }] : []);
    for (const fonte of fontes) {
      const regra = fonte.codIndicador;
      if (!regra || regra.modo === "none") continue;
      for (let i = 0; i < lans.length; i++) {
        if (counted.has(i)) continue;
        if (!matchesRegraG(lans[i].cod_indicador, regra)) continue;
        counted.add(i);
        total += lans[i].valor;
      }
    }
    valores.set(ind.id, total);
  }
  applyFormulasG(inds, valores);
  if (prev) for (const ind of inds) if (ind.acumulado) valores.set(ind.id, (valores.get(ind.id) ?? 0) + (prev.get(ind.id) ?? 0));
  return valores;
}

const IND_ORC_BLOBS = [
  "portal_orcamento_gestao_recursos","portal_orcamento_investment_banking",
  "portal_orcamento_advisory","portal_orcamento_research",
  "portal_orcamento_gastos_pacote_pessoal","portal_orcamento_gastos_pacote_certificacao",
  "portal_orcamento_gastos_pacote_incentivos_comerciais","portal_orcamento_gastos_pacote_institucional",
  "portal_orcamento_gastos_pacote_ocupacao","portal_orcamento_gastos_pacote_eventos",
  "portal_orcamento_gastos_pacote_servicos_especializados","portal_orcamento_gastos_pacote_servicos_juridicos",
  "portal_orcamento_gastos_pacote_tecnologia","portal_orcamento_gastos_pacote_viagens",
];

// ─── Indicadores report configs ────────────────────────────────────────────────

const IND_RELATORIOS: RelConfig[] = [
  { id: "ind-orcado",      label: "Orçado",        grupo: "Indicadores", dreKey: "", dreField: "gerencial", fonte: "ind_orcado"      },
  { id: "ind-realizado",   label: "Realizado",     grupo: "Indicadores", dreKey: "", dreField: "gerencial", fonte: "ind_realizado"   },
  { id: "ind-comparativo", label: "Orçado × Real", grupo: "Indicadores", dreKey: "", dreField: "gerencial", fonte: "ind_comparativo" },
];

// Pacote types (mirrors individual orcamento pages)
type OpFormulaP = "*" | "+" | "-" | "/";
type ExprTokenP = { t: "ref"; id: string; offset: 0 | -1 | 1 } | { t: "num"; v: number } | { t: "op"; v: "+" | "-" | "*" | "/" | "(" | ")" };
interface FormulaOperandoP { linhaId: string; offset: 0 | -1 | 1; valorFixo?: number }
interface FormulaP { op: OpFormulaP; left: FormulaOperandoP; right: FormulaOperandoP }
interface ComposicaoItemP { id: string; descricao: string; valores: Record<string, number>; centroId?: string }
interface LinhaOrcamentoP { id: string; descricao: string; tipo: "digitado" | "calculado" | "subtotal"; categoria?: string; isPercentual?: boolean; centroResultadoId?: string; composicao?: ComposicaoItemP[]; subtotalLinhaIds?: string[]; formula?: FormulaP; formulaExpr?: ExprTokenP[]; valores: Record<string, number> }
interface SubBlocoP { id: string; descricao: string; linhas: LinhaOrcamentoP[]; totalizar?: boolean }
interface BlocoP    { id: string; descricao: string; subBlocos: SubBlocoP[]; totalizar?: boolean }

// ─── DRE report configs ───────────────────────────────────────────────────────

const RELATORIOS: RelConfig[] = [
  { id: "dre-ger-orcado",      label: "Orçado",        grupo: "DRE Gerencial", dreKey: "portal_dre",          dreField: "gerencial", fonte: "orcado"      },
  { id: "dre-ger-realizado",   label: "Realizado",     grupo: "DRE Gerencial", dreKey: "portal_dre",          dreField: "gerencial", fonte: "realizado"   },
  { id: "dre-ger-comparativo", label: "Orçado × Real", grupo: "DRE Gerencial", dreKey: "portal_dre",          dreField: "gerencial", fonte: "comparativo" },
  { id: "dre-ger-forecast",    label: "Forecast",      grupo: "DRE Gerencial", dreKey: "portal_dre",          dreField: "gerencial", fonte: "forecast"    },
  { id: "dre-ctb-orcado",      label: "Orçado",        grupo: "DRE Contábil",  dreKey: "portal_dre_contabil", dreField: "contabil",  fonte: "orcado"      },
  { id: "dre-ctb-realizado",   label: "Realizado",     grupo: "DRE Contábil",  dreKey: "portal_dre_contabil", dreField: "contabil",  fonte: "realizado"   },
  { id: "dre-ctb-comparativo", label: "Orçado × Real", grupo: "DRE Contábil",  dreKey: "portal_dre_contabil", dreField: "contabil",  fonte: "comparativo" },
  { id: "dre-ctb-forecast",    label: "Forecast",      grupo: "DRE Contábil",  dreKey: "portal_dre_contabil", dreField: "contabil",  fonte: "forecast"    },
];

// ─── Pacote report configs ────────────────────────────────────────────────────

const PACOTE_RECEITA_AREAS = [
  { id: "gest-rec",  label: "Gestão de Recursos",   orcKey: "portal_orcamento_gestao_recursos",       fctKey: "portal_forecast_receita_gestao_recursos"       },
  { id: "advisory",  label: "Advisory",              orcKey: "portal_orcamento_advisory",               fctKey: "portal_forecast_receita_advisory"               },
  { id: "inv-bank",  label: "Investment Banking",    orcKey: "portal_orcamento_investment_banking",     fctKey: "portal_forecast_receita_investment_banking"     },
  { id: "research",  label: "Research",              orcKey: "portal_orcamento_research",               fctKey: "portal_forecast_receita_research"               },
];

const PACOTE_GASTOS_AREAS = [
  { id: "pessoal",       label: "Pacote Pessoal",                 orcKey: "portal_orcamento_gastos_pacote_pessoal",                fctKey: "portal_forecast_gastos_pacote_pessoal"                },
  { id: "certificacao",  label: "Pacote Certificação",            orcKey: "portal_orcamento_gastos_pacote_certificacao",           fctKey: "portal_forecast_gastos_pacote_certificacao"           },
  { id: "eventos",       label: "Pacote Eventos",                 orcKey: "portal_orcamento_gastos_pacote_eventos",                fctKey: "portal_forecast_gastos_pacote_eventos"                },
  { id: "institucional", label: "Pacote Institucional",           orcKey: "portal_orcamento_gastos_pacote_institucional",          fctKey: "portal_forecast_gastos_pacote_institucional"          },
  { id: "inc-com",       label: "Pacote Incentivos Comerciais",   orcKey: "portal_orcamento_gastos_pacote_incentivos_comerciais",  fctKey: "portal_forecast_gastos_pacote_incentivos_comerciais"  },
  { id: "ocupacao",      label: "Pacote Ocupação",                orcKey: "portal_orcamento_gastos_pacote_ocupacao",               fctKey: "portal_forecast_gastos_pacote_ocupacao"               },
  { id: "serv-espec",    label: "Pacote Serviços Especializados", orcKey: "portal_orcamento_gastos_pacote_servicos_especializados",fctKey: "portal_forecast_gastos_pacote_servicos_especializados"},
  { id: "serv-jur",      label: "Pacote Serviços Jurídicos",      orcKey: "portal_orcamento_gastos_pacote_servicos_juridicos",     fctKey: "portal_forecast_gastos_pacote_servicos_juridicos"     },
  { id: "tecnologia",    label: "Pacote Tecnologia",              orcKey: "portal_orcamento_gastos_pacote_tecnologia",             fctKey: "portal_forecast_gastos_pacote_tecnologia"             },
  { id: "viagens",       label: "Pacote Viagens",                 orcKey: "portal_orcamento_gastos_pacote_viagens",               fctKey: "portal_forecast_gastos_pacote_viagens"                },
];

const PACOTE_RELATORIOS: RelConfig[] = [
  ...PACOTE_RECEITA_AREAS.map(a => ({ id: `orc-rec-${a.id}`, label: a.label, grupo: "Orçamento — Receita",  dreKey: "", dreField: "gerencial" as DreField, fonte: "pacote_orcado"   as Fonte, storageKey: a.orcKey })),
  ...PACOTE_GASTOS_AREAS.map(a  => ({ id: `orc-gas-${a.id}`, label: a.label, grupo: "Orçamento — Gastos",   dreKey: "", dreField: "gerencial" as DreField, fonte: "pacote_orcado"   as Fonte, storageKey: a.orcKey })),
  ...PACOTE_RECEITA_AREAS.map(a => ({ id: `fct-rec-${a.id}`, label: a.label, grupo: "Forecast — Receita",   dreKey: "", dreField: "gerencial" as DreField, fonte: "pacote_forecast" as Fonte, storageKey: a.fctKey })),
  ...PACOTE_GASTOS_AREAS.map(a  => ({ id: `fct-gas-${a.id}`, label: a.label, grupo: "Forecast — Gastos",    dreKey: "", dreField: "gerencial" as DreField, fonte: "pacote_forecast" as Fonte, storageKey: a.fctKey })),
];

const ALL_RELATORIOS: RelConfig[] = [...RELATORIOS, ...PACOTE_RELATORIOS, ...IND_RELATORIOS];

const GRUPOS = ["DRE Gerencial", "DRE Contábil", "Orçamento — Receita", "Orçamento — Gastos", "Forecast — Receita", "Forecast — Gastos", "Indicadores"];

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

type GrupoDef = { label: string; sub: string; meses: number[] };
const GRUPOS_DEF: Record<ViewMode, GrupoDef[]> = {
  mensal:        MESES.map((label, i) => ({ label, sub: "", meses: [i] })),
  trimestral:    [
    { label: "1º Trim.", sub: "Jan · Fev · Mar", meses: [0,1,2]     },
    { label: "2º Trim.", sub: "Abr · Mai · Jun", meses: [3,4,5]     },
    { label: "3º Trim.", sub: "Jul · Ago · Set", meses: [6,7,8]     },
    { label: "4º Trim.", sub: "Out · Nov · Dez", meses: [9,10,11]   },
  ],
  quadrimestral: [
    { label: "1º Quadrim.", sub: "Jan · Fev · Mar · Abr", meses: [0,1,2,3]   },
    { label: "2º Quadrim.", sub: "Mai · Jun · Jul · Ago", meses: [4,5,6,7]   },
    { label: "3º Quadrim.", sub: "Set · Out · Nov · Dez", meses: [8,9,10,11] },
  ],
  semestral: [
    { label: "1º Sem.", sub: "Jan · Fev · Mar · Abr · Mai · Jun", meses: [0,1,2,3,4,5]  },
    { label: "2º Sem.", sub: "Jul · Ago · Set · Out · Nov · Dez", meses: [6,7,8,9,10,11] },
  ],
};

const VIEW_LABELS: Record<ViewMode, string> = {
  mensal: "Mensal", trimestral: "Trimestral", quadrimestral: "Quadrimestral", semestral: "Semestral",
};

// ─── DRE helpers ─────────────────────────────────────────────────────────────

function computeFromMap(dre: DemoItem[], map: Map<string, Map<string, number>>, period: string): PeriodResult {
  const valores = new Map<string, number>();
  for (const item of dre) {
    const v = map.get(item.id)?.get(period);
    if (v !== undefined) valores.set(item.id, v);
  }
  for (let i = dre.length - 1; i >= 0; i--) {
    const item = dre[i];
    if (item.tipo !== "SUBTOTAL" || Array.isArray(item.formula)) continue;
    let total = valores.get(item.id) ?? 0;
    for (let j = i + 1; j < dre.length; j++) {
      if (dre[j].nivel <= item.nivel) break;
      if (dre[j].nivel === item.nivel + 1) total += valores.get(dre[j].id) ?? 0;
    }
    valores.set(item.id, total);
  }
  for (const item of dre) {
    if (item.tipo !== "SUBTOTAL" || !Array.isArray(item.formula)) continue;
    valores.set(item.id, item.formula.reduce((s, fi) => s + (fi.sinal === "+" ? 1 : -1) * (valores.get(fi.subtotalId) ?? 0), 0));
  }
  return { valores };
}

function aggregatePeriods(meses: number[], monthly: PeriodResult[], dre: DemoItem[]): PeriodResult {
  const valores = new Map<string, number>();
  for (const item of dre) {
    valores.set(item.id, meses.reduce((s, mi) => s + (monthly[mi].valores.get(item.id) ?? 0), 0));
  }
  return { valores };
}

function getRowStyle(tipo: string, nivel: number) {
  if (tipo === "SUBTOTAL") {
    if (nivel === 1) return { bg: "#1e3a5f", color: "white",   fw: "700" };
    if (nivel === 2) return { bg: "#dbeafe", color: "#1e3a5f", fw: "600" };
    return              { bg: "#f0f9ff", color: "#1e3a5f", fw: "600" };
  }
  return { bg: "white", color: "#6b7280", fw: "400" };
}

function fmtInt(v: number) {
  const s = Math.abs(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return v < 0 ? `(${s})` : s;
}

function fmtVar(orc: number, real: number) {
  if (orc === 0) return { text: "—", color: "#9ca3af" };
  const pct = ((real - orc) / Math.abs(orc)) * 100;
  return {
    text: `${pct >= 0 ? "+" : ""}${pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
    color: pct >= 0 ? "#16a34a" : "#dc2626",
  };
}

// ─── DRE Report Table ─────────────────────────────────────────────────────────

interface ReportTableProps {
  rel:          RelConfig;
  dre:          DemoItem[];
  orcMap:       Map<string, Map<string, number>>;
  realizadoMap: Map<string, Map<string, number>>;
  forecastMap:  Map<string, Map<string, number>>;
  ano:          number;
  periodoInicio: string;
  periodoFim:    string;
  viewMode:      ViewMode;
  nivelMax:      number | "all";
  crActive:      boolean;
  crLabels:      string;
}

function ReportTable({ rel, dre, orcMap, realizadoMap, forecastMap, ano, periodoInicio, periodoFim, viewMode, nivelMax, crActive, crLabels }: ReportTableProps) {
  const anoStr = String(ano);

  const grupos = useMemo(() =>
    GRUPOS_DEF[viewMode].filter(g => g.meses.some(mi => {
      const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
      return p >= periodoInicio && p <= periodoFim;
    })),
  [viewMode, anoStr, periodoInicio, periodoFim]);

  const colW = grupos.length >= 10 ? 65 : 100;

  const monthlyOrc  = useMemo(() => MESES.map((_, mi) => {
    const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
    return (p < periodoInicio || p > periodoFim) ? { valores: new Map<string, number>() } : computeFromMap(dre, orcMap, p);
  }), [dre, orcMap, anoStr, periodoInicio, periodoFim]);

  const monthlyReal = useMemo(() => MESES.map((_, mi) => {
    const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
    return (p < periodoInicio || p > periodoFim) ? { valores: new Map<string, number>() } : computeFromMap(dre, realizadoMap, p);
  }), [dre, realizadoMap, anoStr, periodoInicio, periodoFim]);

  const monthlyFct  = useMemo(() => MESES.map((_, mi) => {
    const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
    return (p < periodoInicio || p > periodoFim) ? { valores: new Map<string, number>() } : computeFromMap(dre, forecastMap, p);
  }), [dre, forecastMap, anoStr, periodoInicio, periodoFim]);

  const monthlyPrimary = rel.fonte === "realizado" ? monthlyReal : rel.fonte === "forecast" ? monthlyFct : monthlyOrc;

  const colsOrc  = grupos.map(g => aggregatePeriods(g.meses, monthlyOrc,  dre));
  const colsReal = grupos.map(g => aggregatePeriods(g.meses, monthlyReal, dre));
  const colsPri  = grupos.map(g => aggregatePeriods(g.meses, monthlyPrimary, dre));

  const allMeses = MESES.map((_, mi) => mi).filter(mi => {
    const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
    return p >= periodoInicio && p <= periodoFim;
  });
  const totalOrc  = aggregatePeriods(allMeses, monthlyOrc,  dre);
  const totalReal = aggregatePeriods(allMeses, monthlyReal, dre);
  const totalPri  = aggregatePeriods(allMeses, monthlyPrimary, dre);

  const isComp = rel.fonte === "comparativo";

  const visibleRows = useMemo(() => {
    const hidden = new Set<string>();
    if (nivelMax !== "all") {
      dre.forEach((item, idx) => {
        if (item.tipo === "SUBTOTAL" && item.nivel >= nivelMax) {
          for (let i = idx + 1; i < dre.length; i++) {
            if (dre[i].nivel <= item.nivel) break;
            hidden.add(dre[i].id);
          }
        }
      });
    }
    return dre.filter(item => {
      if (hidden.has(item.id)) return false;
      if (item.tipo === "SUBTOTAL") return true;
      if (isComp) {
        return !(colsOrc.every(c => (c.valores.get(item.id) ?? 0) === 0) &&
                 colsReal.every(c => (c.valores.get(item.id) ?? 0) === 0));
      }
      return !colsPri.every(c => (c.valores.get(item.id) ?? 0) === 0);
    });
  }, [dre, colsOrc, colsReal, colsPri, isComp, nivelMax]);

  const mIni = parseInt(periodoInicio.split("-")[1]) - 1;
  const mFim = parseInt(periodoFim.split("-")[1]) - 1;
  const periodoLabel = mIni === 0 && mFim === 11 ? anoStr : `${MESES[mIni]}–${MESES[mFim]} ${anoStr}`;
  const subtitle = `${rel.grupo} · ${rel.label} · ${VIEW_LABELS[viewMode]} · ${periodoLabel}${crActive ? ` · CR: ${crLabels}` : ""}`;

  return (
    <div style={{ fontFamily: "Arial, sans-serif", fontSize: 11 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #1e3a5f", paddingBottom: 8, marginBottom: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/apex-logo.jpg" alt="Apex Partners" style={{ height: 32, objectFit: "contain" }} />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#1e3a5f" }}>{rel.grupo} · {rel.label}</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            {isComp && (
              <tr style={{ background: "#0f2540" }}>
                <th style={{ padding: "4px 8px", textAlign: "left", color: "white", minWidth: 150 }} />
                {grupos.map((g, gi) => (
                  <th key={gi} colSpan={3} style={{ padding: "3px 4px", textAlign: "center", color: "rgba(255,255,255,0.6)", fontSize: 9, borderLeft: "1px solid rgba(255,255,255,0.1)", fontWeight: 600 }}>
                    {g.label}
                  </th>
                ))}
                <th colSpan={3} style={{ padding: "3px 4px", textAlign: "center", color: "rgba(255,255,255,0.6)", fontSize: 9, borderLeft: "1px solid rgba(255,255,255,0.2)", fontWeight: 600 }}>
                  TOTAL
                </th>
              </tr>
            )}
            <tr style={{ background: "#1e3a5f" }}>
              <th style={{ padding: "5px 8px", textAlign: "left", color: "rgba(255,255,255,0.85)", fontSize: 10, fontWeight: 600, minWidth: 150 }}>Descrição</th>
              {isComp ? grupos.map((g, gi) => (
                <React.Fragment key={gi}>
                  <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.7)", fontSize: 9, borderLeft: gi > 0 ? "1px solid rgba(255,255,255,0.1)" : undefined, minWidth: 90, fontWeight: 600 }}>Real</th>
                  <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.7)", fontSize: 9, minWidth: 90, fontWeight: 600 }}>Orç</th>
                  <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.7)", fontSize: 9, minWidth: 60, fontWeight: 600 }}>Var%</th>
                </React.Fragment>
              )) : grupos.map((g, gi) => (
                <th key={gi} style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontSize: 9, fontWeight: 600, minWidth: colW, whiteSpace: "nowrap" }}>
                  <div>{g.label}</div>
                  {g.sub && <div style={{ fontWeight: 400, fontSize: 8, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>{g.sub}</div>}
                </th>
              ))}
              {isComp ? (
                <React.Fragment>
                  <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontSize: 9, borderLeft: "1px solid rgba(255,255,255,0.2)", minWidth: 90, fontWeight: 700 }}>Total Real</th>
                  <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontSize: 9, minWidth: 90, fontWeight: 700 }}>Total Orç</th>
                  <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontSize: 9, minWidth: 60, fontWeight: 700 }}>Var%</th>
                </React.Fragment>
              ) : (
                <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontSize: 9, fontWeight: 700, minWidth: 100, borderLeft: "1px solid rgba(255,255,255,0.2)" }}>Total</th>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(item => {
              const s = getRowStyle(item.tipo, item.nivel);
              const isSub = item.tipo === "SUBTOTAL";
              const indent = (item.nivel - 1) * 12;
              return (
                <tr key={item.id} style={{ background: s.bg, color: s.color, fontWeight: s.fw, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <td style={{ padding: "4px 8px", paddingLeft: 8 + indent, color: !isSub ? "#374151" : undefined }}>
                    <span style={{ textTransform: isSub ? "uppercase" : "none", whiteSpace: "nowrap" }}>{item.descricao}</span>
                  </td>
                  {isComp ? grupos.map((_, gi) => {
                    const o = colsOrc[gi].valores.get(item.id) ?? 0;
                    const r = colsReal[gi].valores.get(item.id) ?? 0;
                    const vr = fmtVar(o, r);
                    return (
                      <React.Fragment key={gi}>
                        <td style={{ padding: "4px 6px", textAlign: "right", borderLeft: gi > 0 ? "1px solid rgba(0,0,0,0.06)" : undefined }}>
                          {r !== 0 ? fmtInt(r) : <span style={{ opacity: 0.2 }}>—</span>}
                        </td>
                        <td style={{ padding: "4px 6px", textAlign: "right" }}>
                          {o !== 0 ? fmtInt(o) : <span style={{ opacity: 0.2 }}>—</span>}
                        </td>
                        <td style={{ padding: "4px 6px", textAlign: "right", color: vr.color, fontSize: 9 }}>{vr.text}</td>
                      </React.Fragment>
                    );
                  }) : grupos.map((_, gi) => {
                    const v = colsPri[gi].valores.get(item.id) ?? 0;
                    return (
                      <td key={gi} style={{ padding: "4px 6px", textAlign: "right" }}>
                        {v !== 0 ? fmtInt(v) : <span style={{ opacity: 0.2 }}>—</span>}
                      </td>
                    );
                  })}
                  {isComp ? (() => {
                    const to = totalOrc.valores.get(item.id) ?? 0;
                    const tr = totalReal.valores.get(item.id) ?? 0;
                    const vr = fmtVar(to, tr);
                    return (
                      <React.Fragment>
                        <td style={{ padding: "4px 6px", textAlign: "right", borderLeft: "1px solid rgba(0,0,0,0.1)", fontWeight: isSub ? "700" : "500", background: s.bg }}>
                          {tr !== 0 ? fmtInt(tr) : <span style={{ opacity: 0.2 }}>—</span>}
                        </td>
                        <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: isSub ? "700" : "500", background: s.bg }}>
                          {to !== 0 ? fmtInt(to) : <span style={{ opacity: 0.2 }}>—</span>}
                        </td>
                        <td style={{ padding: "4px 6px", textAlign: "right", color: vr.color, fontSize: 9, background: s.bg }}>{vr.text}</td>
                      </React.Fragment>
                    );
                  })() : (() => {
                    const tv = totalPri.valores.get(item.id) ?? 0;
                    return (
                      <td style={{ padding: "4px 6px", textAlign: "right", borderLeft: "1px solid rgba(0,0,0,0.1)", fontWeight: isSub ? "700" : "500", background: s.bg, whiteSpace: "nowrap" }}>
                        {tv !== 0 ? fmtInt(tv) : <span style={{ opacity: 0.2 }}>—</span>}
                      </td>
                    );
                  })()}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Pacote eval helpers (same logic as individual orcamento pages) ───────────

function _applyOpP(op: string, stk: number[]) {
  const b = stk.pop() ?? 0, a = stk.pop() ?? 0;
  if (op === "+") stk.push(a + b); else if (op === "-") stk.push(a - b);
  else if (op === "*") stk.push(a * b); else stk.push(b !== 0 ? a / b : 0);
}

function evalExprP(tokens: ExprTokenP[], resolve: (id: string, offset: 0|-1|1) => number): number {
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const out: number[] = [], ops: string[] = [];
  for (const tok of tokens) {
    if (tok.t === "ref") { out.push(resolve(tok.id, tok.offset)); }
    else if (tok.t === "num") { out.push(tok.v); }
    else {
      const v = tok.v;
      if (v === "(") { ops.push(v); }
      else if (v === ")") { while (ops.length && ops[ops.length-1] !== "(") _applyOpP(ops.pop()!, out); ops.pop(); }
      else {
        while (ops.length && ops[ops.length-1] !== "(" && (prec[ops[ops.length-1]] ?? 0) >= (prec[v] ?? 0)) _applyOpP(ops.pop()!, out);
        ops.push(v);
      }
    }
  }
  while (ops.length) _applyOpP(ops.pop()!, out);
  return out[0] ?? 0;
}

function evalLinhaP(linha: LinhaOrcamentoP, allLinhas: Map<string, LinhaOrcamentoP>, anoStr: string, mi: number, depth = 0): number {
  if (depth > 30) return 0;
  const pk = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
  if (linha.tipo === "subtotal") {
    return (linha.subtotalLinhaIds ?? []).reduce((s, id) => {
      const ref = allLinhas.get(id); return ref ? s + evalLinhaP(ref, allLinhas, anoStr, mi, depth + 1) : s;
    }, 0);
  }
  if (linha.tipo === "digitado") {
    if (linha.composicao?.length) return linha.composicao.reduce((s, c) => s + (c.valores?.[pk] ?? 0), 0);
    return linha.valores[pk] ?? 0;
  }
  // calculado
  if (linha.formulaExpr?.length) {
    if (linha.formulaExpr.length === 3) {
      const [t0, t1, t2] = linha.formulaExpr;
      if (t0.t === "ref" && t1.t === "op" && t1.v === "*" && t2.t === "ref") {
        const tl = mi + t0.offset, tr = mi + t2.offset;
        if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
          const lL = allLinhas.get(t0.id), rL = allLinhas.get(t2.id);
          if (lL?.composicao?.length && rL?.composicao?.length) {
            return lL.composicao.reduce((sum, li, idx) => {
              const ri = rL.composicao![idx]; if (!ri) return sum;
              const lv = (li.valores[`${anoStr}-${String(tl + 1).padStart(2, "0")}`] ?? 0) / (lL.isPercentual ? 100 : 1);
              const rv = (ri.valores[`${anoStr}-${String(tr + 1).padStart(2, "0")}`] ?? 0) / (rL.isPercentual ? 100 : 1);
              return sum + lv * rv;
            }, 0);
          }
        }
      }
    }
    return evalExprP(linha.formulaExpr, (id, offset) => {
      const t = mi + offset; if (t < 0 || t > 11) return 0;
      const l = allLinhas.get(id); if (!l) return 0;
      return (l.isPercentual ? 1/100 : 1) * evalLinhaP(l, allLinhas, anoStr, t, depth + 1);
    });
  }
  if (!linha.formula) return linha.valores[pk] ?? 0;
  const { op, left, right } = linha.formula;
  if (op === "*" && left.valorFixo === undefined && right.valorFixo === undefined) {
    const tl = mi + left.offset, tr = mi + right.offset;
    if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
      const lL = allLinhas.get(left.linhaId), rL = allLinhas.get(right.linhaId);
      if (lL?.composicao?.length && rL?.composicao?.length) {
        return lL.composicao.reduce((sum, li, idx) => {
          const ri = rL.composicao![idx]; if (!ri) return sum;
          const lv = (li.valores[`${anoStr}-${String(tl + 1).padStart(2, "0")}`] ?? 0) / (lL.isPercentual ? 100 : 1);
          const rv = (ri.valores[`${anoStr}-${String(tr + 1).padStart(2, "0")}`] ?? 0) / (rL.isPercentual ? 100 : 1);
          return sum + lv * rv;
        }, 0);
      }
    }
  }
  const getV = (o: FormulaOperandoP) => {
    if (o.valorFixo !== undefined) return o.valorFixo;
    const t = mi + o.offset; if (t < 0 || t > 11) return 0;
    const l = allLinhas.get(o.linhaId); if (!l) return 0;
    return (l.isPercentual ? 1/100 : 1) * evalLinhaP(l, allLinhas, anoStr, t, depth + 1);
  };
  const lv = getV(left), rv = getV(right);
  if (op === "*") return lv * rv; if (op === "+") return lv + rv; if (op === "-") return lv - rv;
  return rv !== 0 ? lv / rv : 0;
}

function evalLinhaFilteredP(
  linha: LinhaOrcamentoP, allLinhas: Map<string, LinhaOrcamentoP>, anoStr: string, mi: number,
  crFiltroSet: Set<string>, crIdToCod: Map<string, string>, depth = 0
): number {
  if (depth > 30) return 0;
  const pk = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
  if (linha.tipo === "digitado") {
    if (linha.composicao?.length) {
      return linha.composicao
        .filter(c => { if (!c.centroId) return true; const cod = crIdToCod.get(c.centroId); return !cod || crFiltroSet.has(cod); })
        .reduce((s, c) => s + (c.valores?.[pk] ?? 0), 0);
    }
    if (linha.centroResultadoId) {
      const cod = crIdToCod.get(linha.centroResultadoId);
      return (cod && crFiltroSet.has(cod)) ? (linha.valores[pk] ?? 0) : 0;
    }
    // sem atribuição de CR: não pertence a outro CR, exibe valor integral
    return linha.valores[pk] ?? 0;
  }
  if (linha.tipo === "subtotal") {
    return (linha.subtotalLinhaIds ?? []).reduce((s, id) => {
      const ref = allLinhas.get(id); return ref ? s + evalLinhaFilteredP(ref, allLinhas, anoStr, mi, crFiltroSet, crIdToCod, depth + 1) : s;
    }, 0);
  }
  // calculado
  if (linha.formulaExpr?.length) {
    if (linha.formulaExpr.length === 3) {
      const [t0, t1, t2] = linha.formulaExpr;
      if (t0.t === "ref" && t1.t === "op" && t1.v === "*" && t2.t === "ref") {
        const tl = mi + t0.offset, tr = mi + t2.offset;
        if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
          const lL = allLinhas.get(t0.id), rL = allLinhas.get(t2.id);
          if (lL?.composicao?.length && rL?.composicao?.length) {
            return lL.composicao.reduce((sum, li, idx) => {
              if (!li.centroId) return sum;
              const cod = crIdToCod.get(li.centroId); if (!cod || !crFiltroSet.has(cod)) return sum;
              const ri = rL.composicao![idx]; if (!ri) return sum;
              const lv = (li.valores[`${anoStr}-${String(tl + 1).padStart(2, "0")}`] ?? 0) / (lL.isPercentual ? 100 : 1);
              const rv = (ri.valores[`${anoStr}-${String(tr + 1).padStart(2, "0")}`] ?? 0) / (rL.isPercentual ? 100 : 1);
              return sum + lv * rv;
            }, 0);
          }
        }
      }
    }
    return evalExprP(linha.formulaExpr, (id, offset) => {
      const t = mi + offset; if (t < 0 || t > 11) return 0;
      const l = allLinhas.get(id); if (!l) return 0;
      return (l.isPercentual ? 1/100 : 1) * evalLinhaFilteredP(l, allLinhas, anoStr, t, crFiltroSet, crIdToCod, depth + 1);
    });
  }
  if (!linha.formula) return 0;
  const { op, left, right } = linha.formula;
  if (op === "*" && left.valorFixo === undefined && right.valorFixo === undefined) {
    const tl = mi + left.offset, tr = mi + right.offset;
    if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
      const lL = allLinhas.get(left.linhaId), rL = allLinhas.get(right.linhaId);
      if (lL?.composicao?.length && rL?.composicao?.length) {
        return lL.composicao.reduce((sum, li, idx) => {
          if (!li.centroId) return sum;
          const cod = crIdToCod.get(li.centroId); if (!cod || !crFiltroSet.has(cod)) return sum;
          const ri = rL.composicao![idx]; if (!ri) return sum;
          const lv = (li.valores[`${anoStr}-${String(tl + 1).padStart(2, "0")}`] ?? 0) / (lL.isPercentual ? 100 : 1);
          const rv = (ri.valores[`${anoStr}-${String(tr + 1).padStart(2, "0")}`] ?? 0) / (rL.isPercentual ? 100 : 1);
          return sum + lv * rv;
        }, 0);
      }
    }
  }
  const getVF = (o: FormulaOperandoP) => {
    if (o.valorFixo !== undefined) return o.valorFixo;
    const t = mi + o.offset; if (t < 0 || t > 11) return 0;
    const l = allLinhas.get(o.linhaId); if (!l) return 0;
    return (l.isPercentual ? 1/100 : 1) * evalLinhaFilteredP(l, allLinhas, anoStr, t, crFiltroSet, crIdToCod, depth + 1);
  };
  const lv = getVF(left), rv = getVF(right);
  if (op === "*") return lv * rv; if (op === "+") return lv + rv; if (op === "-") return lv - rv;
  return rv !== 0 ? lv / rv : 0;
}

// ─── Pacote has-data helper (used to skip blank print pages) ─────────────────

function pacoteHasData(
  storageKey: string, ano: number, periodoInicio: string, periodoFim: string,
  crFiltroSet: Set<string> | null, crIdToCod: Map<string, string>,
): boolean {
  const raw = loadData<BlocoP[]>(storageKey, []);
  const blocos = raw
    .map(b => ({
      ...b,
      subBlocos: b.subBlocos
        .map(sb => ({ ...sb, linhas: sb.linhas.filter(l => l.categoria !== "impostos") }))
        .filter(sb => sb.linhas.length > 0),
    }))
    .filter(b => b.subBlocos.length > 0);
  if (!blocos.length) return false;

  const anoStr = String(ano);
  const allLinhasMap = new Map<string, LinhaOrcamentoP>();
  for (const b of blocos) for (const sb of b.subBlocos) for (const l of sb.linhas) allLinhasMap.set(l.id, l);

  const allMeses = MESES.map((_, mi) => mi).filter(mi => {
    const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
    return p >= periodoInicio && p <= periodoFim;
  });

  for (const mi of allMeses)
    for (const b of blocos)
      for (const sb of b.subBlocos)
        for (const l of sb.linhas) {
          if (l.tipo === "subtotal") continue;
          const v = crFiltroSet
            ? evalLinhaFilteredP(l, allLinhasMap, anoStr, mi, crFiltroSet, crIdToCod)
            : evalLinhaP(l, allLinhasMap, anoStr, mi);
          if (v !== 0) return true;
        }
  return false;
}

function dreHasData(
  dre: DemoItem[],
  primaryMap: Map<string, Map<string, number>>,
  secondaryMap: Map<string, Map<string, number>> | null,
  ano: number, periodoInicio: string, periodoFim: string,
): boolean {
  const anoStr = String(ano);
  for (const item of dre) {
    if (item.tipo === "SUBTOTAL") continue;
    const m1 = primaryMap.get(item.id);
    const m2 = secondaryMap?.get(item.id);
    for (let mi = 0; mi <= 11; mi++) {
      const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
      if (p < periodoInicio || p > periodoFim) continue;
      if ((m1?.get(p) ?? 0) !== 0) return true;
      if (m2 && (m2.get(p) ?? 0) !== 0) return true;
    }
  }
  return false;
}

// ─── Pacote Table ─────────────────────────────────────────────────────────────

interface PacoteTableProps {
  rel:           RelConfig;
  storageKey:    string;
  ano:           number;
  periodoInicio: string;
  periodoFim:    string;
  viewMode:      ViewMode;
  crFiltroSet:   Set<string> | null;
  crActive:      boolean;
  crLabels:      string;
  showDetail:    boolean;
}

function PacoteTable({ rel, storageKey, ano, periodoInicio, periodoFim, viewMode, crFiltroSet, crActive, crLabels, showDetail }: PacoteTableProps) {
  const blocos = useMemo(() => {
    const raw = loadData<BlocoP[]>(storageKey, []);
    return raw.map(b => ({
      ...b,
      subBlocos: b.subBlocos.map(sb => ({
        ...sb,
        linhas: sb.linhas.filter(l => l.categoria !== "impostos"),
      })).filter(sb => sb.linhas.length > 0),
    })).filter(b => b.subBlocos.length > 0);
  }, [storageKey]);
  const anoStr = String(ano);

  // id (UUID) → CODCENCUS — needed because composicao.centroId stores the UUID, not the code
  const crIdToCod = useMemo(() => {
    const all = loadData<CentroResultadoRow[]>("portal_centro_resultado", []);
    return new Map(all.map(cr => [cr.id, cr.CODCENCUS]));
  }, []);

  // flat map of all linhas for formula cross-references
  const allLinhasMap = useMemo(() => {
    const m = new Map<string, LinhaOrcamentoP>();
    for (const b of blocos) for (const sb of b.subBlocos) for (const l of sb.linhas) m.set(l.id, l);
    return m;
  }, [blocos]);

  const grupos = useMemo(() =>
    GRUPOS_DEF[viewMode].filter(g => g.meses.some(mi => {
      const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
      return p >= periodoInicio && p <= periodoFim;
    })),
  [viewMode, anoStr, periodoInicio, periodoFim]);

  const colW = grupos.length >= 10 ? 65 : 100;

  const allMeses = useMemo(() => MESES.map((_, mi) => mi).filter(mi => {
    const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
    return p >= periodoInicio && p <= periodoFim;
  }), [anoStr, periodoInicio, periodoFim]);

  function getVal(linha: LinhaOrcamentoP, mi: number): number {
    return crFiltroSet
      ? evalLinhaFilteredP(linha, allLinhasMap, anoStr, mi, crFiltroSet, crIdToCod)
      : evalLinhaP(linha, allLinhasMap, anoStr, mi);
  }

  function getGrupoVal(linha: LinhaOrcamentoP, meses: number[]): number {
    return meses.reduce((s, mi) => s + getVal(linha, mi), 0);
  }

  function getTotalVal(linha: LinhaOrcamentoP): number {
    return allMeses.reduce((s, mi) => s + getVal(linha, mi), 0);
  }

  const mIni = parseInt(periodoInicio.split("-")[1]) - 1;
  const mFim = parseInt(periodoFim.split("-")[1]) - 1;
  const periodoLabel = mIni === 0 && mFim === 11 ? anoStr : `${MESES[mIni]}–${MESES[mFim]} ${anoStr}`;
  const subtitle = `${rel.grupo} · ${rel.label} · ${VIEW_LABELS[viewMode]} · ${periodoLabel}${crActive ? ` · CR: ${crLabels}` : ""}`;

  const hasData = useMemo(() => {
    for (const mi of allMeses) {
      for (const b of blocos) {
        for (const sb of b.subBlocos) {
          for (const l of sb.linhas) {
            if (l.tipo === "subtotal") continue;
            const v = crFiltroSet
              ? evalLinhaFilteredP(l, allLinhasMap, anoStr, mi, crFiltroSet, crIdToCod)
              : evalLinhaP(l, allLinhasMap, anoStr, mi);
            if (v !== 0) return true;
          }
        }
      }
    }
    return false;
  }, [blocos, allLinhasMap, allMeses, crFiltroSet, crIdToCod, anoStr]);

  if (blocos.length === 0 || !hasData) return null;

  return (
    <div style={{ fontFamily: "Arial, sans-serif", fontSize: 11 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #1e3a5f", paddingBottom: 8, marginBottom: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/apex-logo.jpg" alt="Apex Partners" style={{ height: 32, objectFit: "contain" }} />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#1e3a5f" }}>{rel.grupo} · {rel.label}</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr style={{ background: "#1e3a5f" }}>
              <th style={{ padding: "5px 8px", textAlign: "left", color: "rgba(255,255,255,0.85)", fontSize: 10, fontWeight: 600, minWidth: 150 }}>Descrição</th>
              {grupos.map((g, gi) => (
                <th key={gi} style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontSize: 9, fontWeight: 600, minWidth: colW, whiteSpace: "nowrap" }}>
                  <div>{g.label}</div>
                  {g.sub && <div style={{ fontWeight: 400, fontSize: 8, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>{g.sub}</div>}
                </th>
              ))}
              <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontSize: 9, fontWeight: 700, minWidth: 100, borderLeft: "1px solid rgba(255,255,255,0.2)" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {blocos.map(bloco => {
              // summable lines for bloco total: exclude lines already referenced by a subtotal
              const blocoSummable = (() => {
                const referencedIds = new Set(
                  bloco.subBlocos.flatMap(sb =>
                    sb.linhas.filter(l => l.tipo === "subtotal").flatMap(l => l.subtotalLinhaIds ?? [])
                  )
                );
                return bloco.subBlocos.flatMap(sb => sb.linhas.filter(l => !referencedIds.has(l.id)));
              })();

              return (
                <React.Fragment key={bloco.id}>
                  <tr style={{ background: "#1e3a5f", color: "white", fontWeight: 700 }}>
                    <td colSpan={grupos.length + 2} style={{ padding: "5px 8px", fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                      {bloco.descricao}
                    </td>
                  </tr>

                  {bloco.subBlocos.map(sb => {
                    const showSbHeader = bloco.subBlocos.length > 1 || sb.descricao !== bloco.descricao;

                    // summable lines for sub total: exclude lines referenced by a subtotal within this sub
                    const sbReferencedIds = new Set(
                      sb.linhas.filter(l => l.tipo === "subtotal").flatMap(l => l.subtotalLinhaIds ?? [])
                    );
                    const sbSummable = sb.linhas.filter(l => !sbReferencedIds.has(l.id));

                    return (
                      <React.Fragment key={sb.id}>
                        {showSbHeader && sb.descricao && (
                          <tr style={{ background: "#f8fafc", color: "#374151", fontWeight: 600 }}>
                            <td colSpan={grupos.length + 2} style={{ padding: "4px 8px", paddingLeft: 16, fontSize: 10, borderBottom: "1px solid #e5e7eb" }}>
                              {sb.descricao}
                            </td>
                          </tr>
                        )}

                        {sb.linhas.map(linha => {
                          const isSub  = linha.tipo === "subtotal";
                          const gVals  = grupos.map(g => getGrupoVal(linha, g.meses));
                          const totVal = getTotalVal(linha);

                          if (!isSub && gVals.every(v => v === 0) && totVal === 0) return null;

                          const bg    = isSub ? "#f0f9ff" : "white";
                          const fw    = isSub ? "600"     : "400";
                          const color = isSub ? "#1e3a5f" : "#6b7280";
                          const fmt   = (v: number) => linha.isPercentual
                            ? (v !== 0 ? `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : null)
                            : (v !== 0 ? fmtInt(v) : null);

                          const composicaoItems = showDetail && !isSub && linha.tipo === "digitado" && linha.composicao && linha.composicao.length > 0
                            ? linha.composicao
                            : [];

                          return (
                            <React.Fragment key={linha.id}>
                              <tr style={{ background: bg, color, fontWeight: fw, borderBottom: composicaoItems.length ? "none" : "1px solid rgba(0,0,0,0.06)" }}>
                                <td style={{ padding: "4px 8px", paddingLeft: 28, color: !isSub ? "#374151" : undefined }}>{linha.descricao}</td>
                                {gVals.map((v, gi) => (
                                  <td key={gi} style={{ padding: "4px 6px", textAlign: "right" }}>
                                    {fmt(v) ?? <span style={{ opacity: 0.2 }}>—</span>}
                                  </td>
                                ))}
                                <td style={{ padding: "4px 6px", textAlign: "right", borderLeft: "1px solid rgba(0,0,0,0.1)", fontWeight: isSub ? "700" : "500", whiteSpace: "nowrap" }}>
                                  {fmt(totVal) ?? <span style={{ opacity: 0.2 }}>—</span>}
                                </td>
                              </tr>
                              {composicaoItems.map((item, ii) => {
                                const iGvals = grupos.map(g => g.meses.reduce((s, mi) => {
                                  const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
                                  return (p >= periodoInicio && p <= periodoFim) ? s + (item.valores[p] ?? 0) : s;
                                }, 0));
                                const allMesesItem = grupos.flatMap(g => g.meses).filter((mi, idx, arr) => arr.indexOf(mi) === idx);
                                const iTot = allMesesItem.reduce((s, mi) => {
                                  const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
                                  return (p >= periodoInicio && p <= periodoFim) ? s + (item.valores[p] ?? 0) : s;
                                }, 0);
                                if (iGvals.every(v => v === 0) && iTot === 0) return null;
                                const isLast = ii === composicaoItems.length - 1;
                                return (
                                  <tr key={item.id} style={{ background: "#fafafa", borderBottom: isLast ? "1px solid rgba(0,0,0,0.06)" : "1px solid rgba(0,0,0,0.03)" }}>
                                    <td style={{ padding: "3px 8px", paddingLeft: 44, fontSize: 9, color: "#9ca3af" }}>{item.descricao}</td>
                                    {iGvals.map((v, gi) => (
                                      <td key={gi} style={{ padding: "3px 6px", textAlign: "right", fontSize: 9, color: "#9ca3af" }}>
                                        {v !== 0 ? fmtInt(v) : <span style={{ opacity: 0.15 }}>—</span>}
                                      </td>
                                    ))}
                                    <td style={{ padding: "3px 6px", textAlign: "right", borderLeft: "1px solid rgba(0,0,0,0.06)", fontSize: 9, color: "#9ca3af", whiteSpace: "nowrap" }}>
                                      {iTot !== 0 ? fmtInt(iTot) : <span style={{ opacity: 0.15 }}>—</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}

                        {sb.totalizar && (() => {
                          const sbTotalV = getTotalVal({ id: "_", descricao: "", tipo: "subtotal", subtotalLinhaIds: sbSummable.map(l => l.id), valores: {} });
                          return (
                            <tr style={{ background: "#f8fafc", color: "#374151", fontWeight: 700, borderTop: "2px solid #e5e7eb" }}>
                              <td style={{ padding: "4px 8px", paddingLeft: 16 }}>Total · {sb.descricao}</td>
                              {grupos.map((g, gi) => {
                                const v = sbSummable.reduce((s, l) => s + getGrupoVal(l, g.meses), 0);
                                return <td key={gi} style={{ padding: "4px 6px", textAlign: "right" }}>{v !== 0 ? fmtInt(v) : <span style={{ opacity: 0.2 }}>—</span>}</td>;
                              })}
                              <td style={{ padding: "4px 6px", textAlign: "right", borderLeft: "1px solid rgba(0,0,0,0.1)" }}>
                                {sbTotalV !== 0 ? fmtInt(sbTotalV) : <span style={{ opacity: 0.2 }}>—</span>}
                              </td>
                            </tr>
                          );
                        })()}
                      </React.Fragment>
                    );
                  })}

                  {bloco.totalizar && (() => {
                    const blocoTotalV = getTotalVal({ id: "_", descricao: "", tipo: "subtotal", subtotalLinhaIds: blocoSummable.map(l => l.id), valores: {} });
                    return (
                      <tr style={{ background: "#dbeafe", color: "#1e3a5f", fontWeight: 700, borderTop: "2px solid #bfdbfe" }}>
                        <td style={{ padding: "5px 8px", fontSize: 10, textTransform: "uppercase" }}>Total · {bloco.descricao}</td>
                        {grupos.map((g, gi) => {
                          const v = blocoSummable.reduce((s, l) => s + getGrupoVal(l, g.meses), 0);
                          return <td key={gi} style={{ padding: "5px 6px", textAlign: "right" }}>{v !== 0 ? fmtInt(v) : <span style={{ opacity: 0.2 }}>—</span>}</td>;
                        })}
                        <td style={{ padding: "5px 6px", textAlign: "right", borderLeft: "1px solid rgba(0,0,0,0.1)" }}>
                          {blocoTotalV !== 0 ? fmtInt(blocoTotalV) : <span style={{ opacity: 0.2 }}>—</span>}
                        </td>
                      </tr>
                    );
                  })()}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Cover Page ──────────────────────────────────────────────────────────────

function CoverPage({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <div style={{
      width: "100%", minHeight: 600, background: "#ffffff",
      display: "flex", flexDirection: "column",
      fontFamily: "'Manrope','Inter',-apple-system,sans-serif",
      color: "#1e3a5f",
    }}>
      {/* header — white, logo alinhado à esquerda */}
      <div style={{ padding: "36px 56px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/apex-logo.jpg" alt="Apex Partners" style={{ height: 44, objectFit: "contain", display: "block" }} />
        <span style={{ fontSize: 10, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Confidencial
        </span>
      </div>

      {/* linha separadora navy */}
      <div style={{ margin: "0 56px", height: 2, background: "#1e3a5f", borderRadius: 1 }} />

      {/* corpo central */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "flex-start", justifyContent: "center",
        padding: "60px 56px",
      }}>
        {/* label superior */}
        <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, marginBottom: 24 }}>
          Apex Partners · Controladoria
        </div>

        {/* título */}
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1, color: "#1e3a5f", maxWidth: 580 }}>
          {titulo || "Relatório Financeiro"}
        </div>

        {/* subtítulo */}
        {subtitulo && (
          <div style={{ fontSize: 15, color: "#475569", marginTop: 20, lineHeight: 1.6, maxWidth: 500, fontWeight: 500 }}>
            {subtitulo}
          </div>
        )}

        {/* régua curta */}
        <div style={{ width: 48, height: 3, background: "#1e3a5f", marginTop: 36, borderRadius: 2 }} />
      </div>

      {/* rodapé */}
      <div style={{
        padding: "20px 56px", borderTop: "1px solid #e2e8f0",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontSize: 10, color: "#cbd5e1", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Portal da Controladoria
        </span>
        <span style={{ fontSize: 10, color: "#94a3b8", letterSpacing: "0.06em" }}>{hoje}</span>
      </div>
    </div>
  );
}

// ─── Indicadores Table ────────────────────────────────────────────────────────

interface IndicadoresTableProps {
  rel: RelConfig; ano: number; periodoInicio: string; periodoFim: string; viewMode: ViewMode;
}

function IndicadoresTable({ rel, ano, periodoInicio, periodoFim, viewMode }: IndicadoresTableProps) {
  const anoStr = String(ano);
  const isComp = rel.fonte === "ind_comparativo";

  const inds = useMemo(() => loadData<IndicadorRowG[]>("portal_indicadores", []), []);

  const orcBlobMap = useMemo(() => {
    if (rel.fonte === "ind_realizado") return new Map<string, Map<string, number>>();
    const map = new Map<string, Map<string, number>>();
    const allBlocos: BlocoIndG[] = IND_ORC_BLOBS.flatMap(k => loadData<BlocoIndG[]>(k, []));
    for (const bloco of allBlocos)
      for (const sub of bloco.subBlocos)
        for (const linha of sub.linhas) {
          if (linha.categoria !== "indicador" || !linha.codIndicador || linha.tipo !== "digitado") continue;
          if (!map.has(linha.codIndicador)) map.set(linha.codIndicador, new Map());
          const m = map.get(linha.codIndicador)!;
          const src = linha.composicao?.length
            ? linha.composicao.reduce((acc, c) => { for (const [k, v] of Object.entries(c.valores)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {} as Record<string, number>)
            : linha.valores;
          for (const [k, v] of Object.entries(src)) if (v !== 0) m.set(k, (m.get(k) ?? 0) + v);
        }
    return map;
  }, [rel.fonte]);

  const lancamentos = useMemo(() =>
    rel.fonte === "ind_orcado" ? [] as LanIndicadorG[] : loadData<LanIndicadorG[]>("portal_lancamentos_indicadores", []),
  [rel.fonte]);

  const categoriaMap = useMemo(() => buildCategoriaMapG(inds), [inds]);

  const orcadoPorMes = useMemo(() => {
    if (rel.fonte === "ind_realizado") return MESES.map(() => new Map<string, number>());
    const maps: Map<string, number>[] = [];
    MESES.forEach((_, mi) => {
      const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
      if (p < periodoInicio || p > periodoFim) { maps.push(new Map()); return; }
      maps.push(computePeriodOrcadoG(inds, orcBlobMap, p, maps[mi - 1]));
    });
    return maps;
  }, [inds, orcBlobMap, anoStr, periodoInicio, periodoFim, rel.fonte]);

  const realizadoPorMes = useMemo(() => {
    if (rel.fonte === "ind_orcado") return MESES.map(() => new Map<string, number>());
    const byPeriod = new Map<string, LanIndicadorG[]>();
    for (const l of lancamentos.filter(l => l.tipo === "realizado")) {
      if (!byPeriod.has(l.periodo)) byPeriod.set(l.periodo, []);
      byPeriod.get(l.periodo)!.push(l);
    }
    const maps: Map<string, number>[] = [];
    MESES.forEach((_, mi) => {
      const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
      if (p < periodoInicio || p > periodoFim) { maps.push(new Map()); return; }
      maps.push(computePeriodLanG(inds, byPeriod.get(p) ?? [], maps[mi - 1]));
    });
    return maps;
  }, [inds, lancamentos, anoStr, periodoInicio, periodoFim, rel.fonte]);

  const grupos = useMemo(() =>
    GRUPOS_DEF[viewMode].filter(g => g.meses.some(mi => {
      const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
      return p >= periodoInicio && p <= periodoFim;
    })),
  [viewMode, anoStr, periodoInicio, periodoFim]);

  const colW = grupos.length >= 10 ? 65 : 100;

  const allMeses = useMemo(() => MESES.map((_, mi) => mi).filter(mi => {
    const p = `${anoStr}-${String(mi + 1).padStart(2, "0")}`;
    return p >= periodoInicio && p <= periodoFim;
  }), [anoStr, periodoInicio, periodoFim]);

  const primaryMonthly = rel.fonte === "ind_realizado" ? realizadoPorMes : orcadoPorMes;

  // aggregatePeriodsG respeita categoriaMap: ESTOQUE → último valor, MENSAL → soma
  const colsOrc  = useMemo(() => grupos.map(g => aggregatePeriodsG(g.meses, orcadoPorMes,    inds, categoriaMap)), [grupos, orcadoPorMes,    inds, categoriaMap]);
  const colsReal = useMemo(() => grupos.map(g => aggregatePeriodsG(g.meses, realizadoPorMes, inds, categoriaMap)), [grupos, realizadoPorMes, inds, categoriaMap]);
  const colsPri  = useMemo(() => grupos.map(g => aggregatePeriodsG(g.meses, primaryMonthly,  inds, categoriaMap)), [grupos, primaryMonthly,  inds, categoriaMap]);
  const totalOrc  = useMemo(() => aggregatePeriodsG(allMeses, orcadoPorMes,    inds, categoriaMap), [allMeses, orcadoPorMes,    inds, categoriaMap]);
  const totalReal = useMemo(() => aggregatePeriodsG(allMeses, realizadoPorMes, inds, categoriaMap), [allMeses, realizadoPorMes, inds, categoriaMap]);
  const totalPri  = useMemo(() => aggregatePeriodsG(allMeses, primaryMonthly,  inds, categoriaMap), [allMeses, primaryMonthly,  inds, categoriaMap]);

  // percentual: determine from orcado blobs (isPercentual) or lançamentos (unidade)
  const percentualSet = useMemo(() => {
    const s = new Set<string>();
    if (rel.fonte !== "ind_realizado") {
      for (const k of IND_ORC_BLOBS)
        for (const bloco of loadData<BlocoIndG[]>(k, []))
          for (const sub of bloco.subBlocos)
            for (const linha of sub.linhas)
              if (linha.categoria === "indicador" && linha.codIndicador && linha.isPercentual) s.add(linha.codIndicador);
    }
    if (rel.fonte !== "ind_orcado") {
      const byInd = new Map<string, LanIndicadorG[]>();
      for (const l of lancamentos) { if (!byInd.has(l.cod_indicador)) byInd.set(l.cod_indicador, []); byInd.get(l.cod_indicador)!.push(l); }
      for (const [cod, lans] of byInd) if (lans.every(l => l.unidade === "percentual")) s.add(cod);
    }
    return s;
  }, [rel.fonte, lancamentos]);

  if (inds.length === 0) return null;

  const hasAnyData = inds.some(ind => colsPri.some(c => (c.get(ind.id) ?? 0) !== 0));
  if (!hasAnyData) return null;

  const visibleRows = inds.filter(ind => {
    if (ind.tipo === "SUBTOTAL") return true;
    if (isComp) return !(colsOrc.every(c => (c.get(ind.id) ?? 0) === 0) && colsReal.every(c => (c.get(ind.id) ?? 0) === 0));
    return !colsPri.every(c => (c.get(ind.id) ?? 0) === 0);
  });

  const mIni = parseInt(periodoInicio.split("-")[1]) - 1;
  const mFim = parseInt(periodoFim.split("-")[1]) - 1;
  const periodoLabel = mIni === 0 && mFim === 11 ? anoStr : `${MESES[mIni]}–${MESES[mFim]} ${anoStr}`;

  function fmtV(v: number, pct: boolean) {
    if (v === 0) return null;
    return pct
      ? `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
      : fmtInt(v);
  }

  function getIndStyle(tipo: "SUBTOTAL" | "INDICADOR", nivel: number) {
    if (tipo === "SUBTOTAL") {
      if (nivel === 1) return { bg: "#1e3a5f", color: "white",   fw: "700" };
      if (nivel === 2) return { bg: "#dbeafe", color: "#1e3a5f", fw: "600" };
      return              { bg: "#f0f9ff", color: "#1e3a5f", fw: "600" };
    }
    return { bg: "white", color: "#6b7280", fw: "400" };
  }

  return (
    <div style={{ fontFamily: "Arial, sans-serif", fontSize: 11 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #1e3a5f", paddingBottom: 8, marginBottom: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/apex-logo.jpg" alt="Apex Partners" style={{ height: 32, objectFit: "contain" }} />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#1e3a5f" }}>Indicadores · {rel.label}</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{periodoLabel} · {VIEW_LABELS[viewMode]}</div>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            {isComp && (
              <tr style={{ background: "#0f2540" }}>
                <th style={{ padding: "4px 8px", textAlign: "left", color: "white", minWidth: 150 }} />
                {grupos.map((g, gi) => (
                  <th key={gi} colSpan={3} style={{ padding: "3px 4px", textAlign: "center", color: "rgba(255,255,255,0.6)", fontSize: 9, borderLeft: "1px solid rgba(255,255,255,0.1)", fontWeight: 600 }}>{g.label}</th>
                ))}
                <th colSpan={3} style={{ padding: "3px 4px", textAlign: "center", color: "rgba(255,255,255,0.6)", fontSize: 9, borderLeft: "1px solid rgba(255,255,255,0.2)", fontWeight: 600 }}>TOTAL</th>
              </tr>
            )}
            <tr style={{ background: "#1e3a5f" }}>
              <th style={{ padding: "5px 8px", textAlign: "left", color: "rgba(255,255,255,0.85)", fontSize: 10, fontWeight: 600, minWidth: 150 }}>Indicador</th>
              {isComp ? grupos.map((g, gi) => (
                <React.Fragment key={gi}>
                  <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.7)", fontSize: 9, borderLeft: gi > 0 ? "1px solid rgba(255,255,255,0.1)" : undefined, minWidth: 90, fontWeight: 600 }}>Real</th>
                  <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.7)", fontSize: 9, minWidth: 90, fontWeight: 600 }}>Orç</th>
                  <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.7)", fontSize: 9, minWidth: 60, fontWeight: 600 }}>Var%</th>
                </React.Fragment>
              )) : grupos.map((g, gi) => (
                <th key={gi} style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontSize: 9, fontWeight: 600, minWidth: colW, whiteSpace: "nowrap" }}>
                  <div>{g.label}</div>
                  {g.sub && <div style={{ fontWeight: 400, fontSize: 8, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>{g.sub}</div>}
                </th>
              ))}
              {isComp ? (
                <React.Fragment>
                  <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontSize: 9, borderLeft: "1px solid rgba(255,255,255,0.2)", minWidth: 90, fontWeight: 700 }}>Total Real</th>
                  <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontSize: 9, minWidth: 90, fontWeight: 700 }}>Total Orç</th>
                  <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontSize: 9, minWidth: 60, fontWeight: 700 }}>Var%</th>
                </React.Fragment>
              ) : (
                <th style={{ padding: "5px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontSize: 9, fontWeight: 700, minWidth: 100, borderLeft: "1px solid rgba(255,255,255,0.2)" }}>Total</th>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(ind => {
              const s   = getIndStyle(ind.tipo, ind.nivel);
              const isSub = ind.tipo === "SUBTOTAL";
              const pct = percentualSet.has(ind.id) || percentualSet.has(ind.codigo ?? "");
              const indent = (ind.nivel - 1) * 12;
              return (
                <tr key={ind.id} style={{ background: s.bg, color: s.color, fontWeight: s.fw, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <td style={{ padding: "4px 8px", paddingLeft: 8 + indent, color: !isSub ? "#374151" : undefined }}>
                    <span style={{ textTransform: isSub ? "uppercase" : "none", whiteSpace: "nowrap" }}>{ind.nome}</span>
                  </td>
                  {isComp ? grupos.map((_, gi) => {
                    const o = colsOrc[gi].get(ind.id) ?? 0;
                    const r = colsReal[gi].get(ind.id) ?? 0;
                    const vr = fmtVar(o, r);
                    return (
                      <React.Fragment key={gi}>
                        <td style={{ padding: "4px 6px", textAlign: "right", borderLeft: gi > 0 ? "1px solid rgba(0,0,0,0.06)" : undefined }}>{fmtV(r, pct) ?? <span style={{ opacity: 0.2 }}>—</span>}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtV(o, pct) ?? <span style={{ opacity: 0.2 }}>—</span>}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", color: vr.color, fontSize: 9 }}>{vr.text}</td>
                      </React.Fragment>
                    );
                  }) : grupos.map((_, gi) => {
                    const v = colsPri[gi].get(ind.id) ?? 0;
                    return <td key={gi} style={{ padding: "4px 6px", textAlign: "right" }}>{fmtV(v, pct) ?? <span style={{ opacity: 0.2 }}>—</span>}</td>;
                  })}
                  {isComp ? (() => {
                    const to = totalOrc.get(ind.id) ?? 0, tr = totalReal.get(ind.id) ?? 0;
                    const vr = fmtVar(to, tr);
                    return (
                      <React.Fragment>
                        <td style={{ padding: "4px 6px", textAlign: "right", borderLeft: "1px solid rgba(0,0,0,0.1)", fontWeight: isSub ? "700" : "500" }}>{fmtV(tr, pct) ?? <span style={{ opacity: 0.2 }}>—</span>}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: isSub ? "700" : "500" }}>{fmtV(to, pct) ?? <span style={{ opacity: 0.2 }}>—</span>}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", color: vr.color, fontSize: 9 }}>{vr.text}</td>
                      </React.Fragment>
                    );
                  })() : (() => {
                    const tv = totalPri.get(ind.id) ?? 0;
                    return <td style={{ padding: "4px 6px", textAlign: "right", borderLeft: "1px solid rgba(0,0,0,0.1)", fontWeight: isSub ? "700" : "500" }}>{fmtV(tv, pct) ?? <span style={{ opacity: 0.2 }}>—</span>}</td>;
                  })()}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Helper: dispatch table ───────────────────────────────────────────────────

interface DispatchTableProps {
  rel:          RelConfig;
  dreGer:       DemoItem[];
  dreCtb:       DemoItem[];
  orcMapGer:    Map<string, Map<string, number>>;
  orcMapCtb:    Map<string, Map<string, number>>;
  realMapGer:   Map<string, Map<string, number>>;
  realMapCtb:   Map<string, Map<string, number>>;
  fctMapGer:    Map<string, Map<string, number>>;
  fctMapCtb:    Map<string, Map<string, number>>;
  ano:          number;
  periodoInicio: string;
  periodoFim:    string;
  viewMode:      ViewMode;
  nivelMax:      number | "all";
  crFiltroSet:   Set<string> | null;
  crActive:      boolean;
  crLabels:      string;
  showDetail:    boolean;
}

function DispatchTable(p: DispatchTableProps) {
  const { rel } = p;
  if (rel.fonte === "ind_orcado" || rel.fonte === "ind_realizado" || rel.fonte === "ind_comparativo") {
    return <IndicadoresTable rel={rel} ano={p.ano} periodoInicio={p.periodoInicio} periodoFim={p.periodoFim} viewMode={p.viewMode} />;
  }
  if ((rel.fonte === "pacote_orcado" || rel.fonte === "pacote_forecast") && rel.storageKey) {
    return (
      <PacoteTable
        rel={rel} storageKey={rel.storageKey}
        ano={p.ano} periodoInicio={p.periodoInicio} periodoFim={p.periodoFim}
        viewMode={p.viewMode} crFiltroSet={p.crFiltroSet} crActive={p.crActive} crLabels={p.crLabels}
        showDetail={p.showDetail}
      />
    );
  }
  return (
    <ReportTable
      rel={rel}
      dre={rel.dreKey === "portal_dre" ? p.dreGer : p.dreCtb}
      orcMap={rel.dreField === "gerencial" ? p.orcMapGer : p.orcMapCtb}
      realizadoMap={rel.dreField === "gerencial" ? p.realMapGer : p.realMapCtb}
      forecastMap={rel.dreField === "gerencial" ? p.fctMapGer : p.fctMapCtb}
      ano={p.ano} periodoInicio={p.periodoInicio} periodoFim={p.periodoFim}
      viewMode={p.viewMode} nivelMax={p.nivelMax} crActive={p.crActive} crLabels={p.crLabels}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GerarRelatoriosPage() {
  const _y = new Date().getFullYear();

  const [coverEnabled,  setCoverEnabled]  = useState(true);
  const [coverTitulo,   setCoverTitulo]   = useState("Relatório Financeiro");
  const [coverSubtitulo, setCoverSubtitulo] = useState("Apex Partners");
  const [selected,      setSelected]      = useState<Set<string>>(new Set(["dre-ger-orcado"]));
  const [ano,           setAno]           = useState(_y);
  const [periodoInicio, setPeriodoInicio] = useState(`${_y}-01`);
  const [periodoFim,    setPeriodoFim]    = useState(`${_y}-12`);
  const [viewMode,      setViewMode]      = useState<ViewMode>("trimestral");
  const [nivelMax,      setNivelMax]      = useState<number | "all">("all");
  const [crIds,         setCrIds]         = useState<string[]>([]);
  const [previewOpen,   setPreviewOpen]   = useState(false);
  const [showDetail,    setShowDetail]    = useState(false);

  const [anosDisponiveis, setAnosDisponiveis] = useState<number[]>([_y]);
  const [orcVersion, setOrcVersion] = useState(0);
  const [fctMapGer,  setFctMapGer]  = useState<Map<string, Map<string, number>>>(() => new Map());
  const [fctMapCtb,  setFctMapCtb]  = useState<Map<string, Map<string, number>>>(() => new Map());
  const [realMapGer, setRealMapGer] = useState<Map<string, Map<string, number>>>(() => new Map());
  const [realMapCtb, setRealMapCtb] = useState<Map<string, Map<string, number>>>(() => new Map());
  const [loadingReal, setLoadingReal] = useState(false);

  const [dreGer, setDreGer] = useState<DemoItem[]>([]);
  const [dreCtb, setDreCtb] = useState<DemoItem[]>([]);

  useEffect(() => {
    setDreGer(loadData<DemoItem[]>("portal_dre",          []));
    setDreCtb(loadData<DemoItem[]>("portal_dre_contabil", []));
  }, []);

  const maxNivel = useMemo(() =>
    Math.max(...[...dreGer, ...dreCtb].filter(d => d.tipo === "SUBTOTAL").map(d => d.nivel), 1),
  [dreGer, dreCtb]);

  const [crOpcoes, setCrOpcoes] = useState<CentroResultadoRow[]>([]);
  useEffect(() => {
    setCrOpcoes(
      loadData<CentroResultadoRow[]>("portal_centro_resultado", [])
        .filter(r => r.GRAU === 1 && r.ATIVO && (r.ENTRA_RESULTADO === "DRE" || r.ENTRA_RESULTADO === "AMBOS"))
        .sort((a, b) => a.CODCENCUS.localeCompare(b.CODCENCUS, undefined, { numeric: true, sensitivity: "base" }))
    );
  }, []);

  const crFiltroSet = useMemo<Set<string> | null>(() => {
    if (!crIds.length) return null;
    const allCrs = loadData<CentroResultadoRow[]>("portal_centro_resultado", []).sort((a, b) => a.CODCENCUS.localeCompare(b.CODCENCUS, undefined, { numeric: true, sensitivity: "base" }));
    const hasPai  = allCrs.some(cr => !!cr.CODCENCUSPAI);
    const result  = new Set<string>();
    if (hasPai) {
      const crMap = new Map(allCrs.map(cr => [cr.CODCENCUS, cr]));
      for (const cr of allCrs) {
        let cur: typeof cr | undefined = cr;
        while (cur && cur.GRAU > 1 && cur.CODCENCUSPAI) cur = crMap.get(cur.CODCENCUSPAI);
        if (cur && crIds.includes(cur.CODCENCUS)) result.add(cr.CODCENCUS);
      }
    } else {
      const withH = buildHierarchy(allCrs, "DESCRCENCUS");
      const selDescrs = new Set(allCrs.filter(cr => crIds.includes(cr.CODCENCUS)).map(cr => cr.DESCRCENCUS));
      for (const cr of withH) {
        const g1 = cr.GRAU_1 as string | undefined;
        if (crIds.includes(cr.CODCENCUS) || (g1 && selDescrs.has(g1))) result.add(cr.CODCENCUS);
      }
    }
    return result;
  }, [crIds]);

  const crLabels = useMemo(() =>
    crOpcoes.filter(c => crIds.includes(c.CODCENCUS)).map(c => c.DESCRCENCUS).join(", "),
  [crOpcoes, crIds]);

  useEffect(() => {
    const anos = [...new Set([...getOrcamentoAnos(), ...getForecastAnos()])].sort((a, b) => b - a);
    if (anos.length) { setAnosDisponiveis(anos); if (!anos.includes(ano)) { setAno(anos[0]); setPeriodoInicio(`${anos[0]}-01`); setPeriodoFim(`${anos[0]}-12`); } }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFctMapGer(buildForecastMap("gerencial",  ano, crFiltroSet));
    setFctMapCtb(buildForecastMap("contabil",   ano, crFiltroSet));
  }, [ano, crFiltroSet]);

  useEffect(() => {
    function onUpdate(e: Event) {
      const key = (e as CustomEvent<{ key: string }>).detail?.key ?? "";
      if (key.startsWith("portal_orcamento_")) setOrcVersion(v => v + 1);
    }
    window.addEventListener("portal-data-update", onUpdate);
    return () => window.removeEventListener("portal-data-update", onUpdate);
  }, []);

  const orcMapGer = useMemo(
    () => buildOrcamentoMap("gerencial", ano, crFiltroSet),
    [ano, crFiltroSet, orcVersion] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const orcMapCtb = useMemo(
    () => buildOrcamentoMap("contabil", ano, crFiltroSet),
    [ano, crFiltroSet, orcVersion] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    const needsReal = [...selected].some(id => {
      const r = ALL_RELATORIOS.find(x => x.id === id);
      return r && (r.fonte === "realizado" || r.fonte === "comparativo");
    });
    if (!needsReal) return;
    setLoadingReal(true);
    Promise.all([
      buildRealizadoMap("portal_dre",          ano),
      buildRealizadoMap("portal_dre_contabil", ano),
    ]).then(([rg, rc]) => {
      setRealMapGer(rg);
      setRealMapCtb(rc);
      setLoadingReal(false);
    }).catch(() => setLoadingReal(false));
  }, [ano, selected]);

  function toggleReport(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleGrupo(grupo: string) {
    const ids = ALL_RELATORIOS.filter(r => r.grupo === grupo).map(r => r.id);
    const allSel = ids.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      ids.forEach(id => allSel ? n.delete(id) : n.add(id));
      return n;
    });
  }

  function changeAno(y: number) {
    setAno(y);
    const ini = periodoInicio.slice(5);
    const fim = periodoFim.slice(5);
    setPeriodoInicio(`${y}-${ini}`);
    setPeriodoFim(`${y}-${fim}`);
  }

  const selectedList = ALL_RELATORIOS.filter(r => selected.has(r.id));

  const crIdToCodPage = useMemo(() => {
    const all = loadData<CentroResultadoRow[]>("portal_centro_resultado", []);
    return new Map(all.map(cr => [cr.id, cr.CODCENCUS]));
  }, []);

  const printList = useMemo(() =>
    selectedList.filter(rel => {
      if ((rel.fonte === "pacote_orcado" || rel.fonte === "pacote_forecast") && rel.storageKey) {
        return pacoteHasData(rel.storageKey, ano, periodoInicio, periodoFim, crFiltroSet, crIdToCodPage);
      }
      // Indicadores — IndicadoresTable returns null when empty; always include to let it self-filter
      if (rel.fonte === "ind_orcado" || rel.fonte === "ind_realizado" || rel.fonte === "ind_comparativo") return true;
      // DRE reports — skip if no data in the selected period
      const dre     = rel.dreKey === "portal_dre" ? dreGer : dreCtb;
      const orcMap  = rel.dreField === "gerencial" ? orcMapGer : orcMapCtb;
      const realMap = rel.dreField === "gerencial" ? realMapGer : realMapCtb;
      const fctMap  = rel.dreField === "gerencial" ? fctMapGer : fctMapCtb;
      const primary   = rel.fonte === "realizado" ? realMap : rel.fonte === "forecast" ? fctMap : orcMap;
      const secondary = rel.fonte === "comparativo" ? realMap : null;
      return dreHasData(dre, primary, secondary, ano, periodoInicio, periodoFim);
    }),
  [selectedList, ano, periodoInicio, periodoFim, crFiltroSet, crIdToCodPage,
   dreGer, dreCtb, orcMapGer, orcMapCtb, realMapGer, realMapCtb, fctMapGer, fctMapCtb]);

  const dispatchProps = {
    dreGer, dreCtb, orcMapGer, orcMapCtb, realMapGer, realMapCtb, fctMapGer, fctMapCtb,
    ano, periodoInicio, periodoFim, viewMode, nivelMax,
    crFiltroSet, crActive: crIds.length > 0, crLabels, showDetail,
  };

  function gerarPdf() {
    const styleId = "apex-print-pdf-style";
    const existing = document.getElementById(styleId);
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #pdf-print-area { visibility: visible !important; display: block !important; }
        #pdf-print-area * { visibility: visible !important; }
        #pdf-print-area { position: absolute; left: 0; top: 0; width: 100%; background: white; }
        .pdf-page-break { page-break-before: always; margin-top: 0; }
        @page { margin: 1.2cm; size: A4 landscape; }
      }
    `;
    document.head.appendChild(style);
    window.print();
    setTimeout(() => { const el = document.getElementById(styleId); if (el) el.remove(); }, 1000);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader title="Gerar Relatórios" subtitle="Exportar PDF" />

      <div className="p-6 space-y-6 max-w-4xl">

        {/* ── Selecionar Relatórios ─────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-semibold text-gray-800 text-sm">Relatórios</span>
            <span className="text-xs text-gray-400">{selected.size} selecionado{selected.size !== 1 ? "s" : ""}</span>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {GRUPOS.map(grupo => {
              const rels = ALL_RELATORIOS.filter(r => r.grupo === grupo);
              const allSel = rels.every(r => selected.has(r.id));
              const someSel = rels.some(r => selected.has(r.id));
              return (
                <div key={grupo}>
                  <label className="flex items-center gap-2 mb-2 cursor-pointer">
                    <input type="checkbox" checked={allSel} ref={el => { if (el) el.indeterminate = !allSel && someSel; }}
                      onChange={() => toggleGrupo(grupo)}
                      className="w-4 h-4 rounded" style={{ accentColor: "#1e3a5f" }} />
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{grupo}</span>
                  </label>
                  <div className="space-y-1 pl-6">
                    {rels.map(r => (
                      <label key={r.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-1">
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleReport(r.id)}
                          className="w-4 h-4 rounded" style={{ accentColor: "#1e3a5f" }} />
                        <span className="text-sm text-gray-700">{r.label}</span>
                        {(r.fonte === "realizado" || r.fonte === "comparativo") && loadingReal && selected.has(r.id) && (
                          <span className="text-[10px] text-gray-400 italic">carregando...</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Configurações ─────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <span className="font-semibold text-gray-800 text-sm">Configurações</span>
          </div>
          <div className="p-5 space-y-5">
            <div className="flex flex-wrap gap-5 items-start">
              {/* Ano */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Ano</label>
                <select value={ano} onChange={e => changeAno(Number(e.target.value))}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {anosDisponiveis.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              {/* Período */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Período</label>
                <div className="flex items-center gap-2">
                  <select value={periodoInicio.slice(5)}
                    onChange={e => { const v = `${ano}-${e.target.value}`; setPeriodoInicio(v); if (v > periodoFim) setPeriodoFim(v); }}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {MESES.map((m, mi) => <option key={mi} value={String(mi + 1).padStart(2, "0")}>{m}</option>)}
                  </select>
                  <span className="text-gray-400 text-sm">até</span>
                  <select value={periodoFim.slice(5)}
                    onChange={e => { const v = `${ano}-${e.target.value}`; setPeriodoFim(v); if (v < periodoInicio) setPeriodoInicio(v); }}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {MESES.map((m, mi) => <option key={mi} value={String(mi + 1).padStart(2, "0")}>{m}</option>)}
                  </select>
                </div>
              </div>
              {/* Visão */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Visão</label>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                  {(Object.keys(VIEW_LABELS) as ViewMode[]).map(mode => (
                    <button key={mode} onClick={() => setViewMode(mode)}
                      className="px-3 py-2 text-xs font-medium transition-colors"
                      style={viewMode === mode ? { background: "#1e3a5f", color: "white" } : { background: "white", color: "#374151" }}>
                      {VIEW_LABELS[mode]}
                    </button>
                  ))}
                </div>
              </div>
              {/* Detalhamento de orçamento */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Detalhamento (Orçamento)</label>
                <label className="flex items-center gap-2 cursor-pointer select-none py-2 px-3 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors">
                  <input type="checkbox" checked={showDetail} onChange={e => setShowDetail(e.target.checked)}
                    className="w-4 h-4 rounded" style={{ accentColor: "#1e3a5f" }} />
                  <span className="text-sm text-gray-700">Exibir composição das linhas</span>
                </label>
                <p className="text-[11px] text-gray-400 mt-1">Mostra o detalhamento individual de cada linha nos pacotes de receita e gastos.</p>
              </div>
              {/* Nível (only for DRE reports) */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Nível de detalhe (DRE)</label>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                  {Array.from({ length: maxNivel }, (_, i) => i + 1).map(n => (
                    <button key={n} onClick={() => setNivelMax(n)}
                      className="px-3 py-2 text-xs font-semibold transition-colors"
                      style={nivelMax === n ? { background: "#1e3a5f", color: "white" } : { background: "white", color: "#374151" }}>
                      N{n}
                    </button>
                  ))}
                  <button onClick={() => setNivelMax("all")}
                    className="px-3 py-2 text-xs font-semibold transition-colors border-l border-gray-200"
                    style={nivelMax === "all" ? { background: "#1e3a5f", color: "white" } : { background: "white", color: "#374151" }}>
                    Tudo
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Centro de Resultado ───────────────────────────────────────────── */}
        {crOpcoes.length > 0 && (
          <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-gray-800 text-sm">Centro de Resultado</span>
              {crIds.length > 0 && (
                <button onClick={() => setCrIds([])} className="text-xs text-blue-600 hover:underline">limpar</button>
              )}
            </div>
            <div className="p-5">
              <p className="text-xs text-gray-500 mb-3">Selecione os CRs para filtrar. Linhas sem dados no CR selecionado serão ocultadas.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-0.5">
                {crOpcoes.map(cr => (
                  <label key={cr.CODCENCUS} className="flex items-center gap-2 py-1.5 px-2 cursor-pointer hover:bg-gray-50 rounded text-sm text-gray-700">
                    <input type="checkbox" checked={crIds.includes(cr.CODCENCUS)}
                      onChange={e => setCrIds(ids => e.target.checked ? [...ids, cr.CODCENCUS] : ids.filter(id => id !== cr.CODCENCUS))}
                      className="w-4 h-4 rounded flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
                    <span className="truncate">
                      <span className="text-gray-400 text-xs mr-1">{cr.CODCENCUS}</span>
                      {cr.DESCRCENCUS}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── Capa ──────────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={coverEnabled} onChange={e => setCoverEnabled(e.target.checked)}
                className="w-4 h-4 rounded" style={{ accentColor: "#1e3a5f" }} />
              <span className="font-semibold text-gray-800 text-sm">Capa</span>
            </label>
            <span className="text-xs text-gray-400">Inserir página de capa no PDF</span>
          </div>
          {coverEnabled && (
            <div className="p-5 flex flex-col lg:flex-row gap-6 items-start">
              {/* inputs */}
              <div className="flex flex-col gap-4 flex-1 min-w-[220px]">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Título</label>
                  <input
                    type="text"
                    value={coverTitulo}
                    onChange={e => setCoverTitulo(e.target.value)}
                    placeholder="Relatório Financeiro"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Subtítulo</label>
                  <input
                    type="text"
                    value={coverSubtitulo}
                    onChange={e => setCoverSubtitulo(e.target.value)}
                    placeholder="Apex Partners"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              {/* mini live preview */}
              <div className="flex-shrink-0">
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Prévia</p>
                <div style={{ width: 280, height: 188, borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0", boxShadow: "0 2px 12px rgba(0,0,0,0.10)" }}>
                  <div style={{ transform: "scale(0.314)", transformOrigin: "top left", width: 892, height: 600, pointerEvents: "none" }}>
                    <CoverPage titulo={coverTitulo} subtitulo={coverSubtitulo} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Ações ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            onClick={gerarPdf}
            disabled={selected.size === 0}
            className="flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white rounded-xl disabled:opacity-40 transition-all shadow-sm hover:shadow-md"
            style={{ background: "#1e3a5f" }}>
            <FileDown size={16} /> Gerar PDF
          </button>
          <button
            onClick={() => setPreviewOpen(v => !v)}
            disabled={selected.size === 0}
            className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 transition-colors">
            {previewOpen ? <EyeOff size={15} /> : <Eye size={15} />}
            {previewOpen ? "Ocultar prévia" : "Pré-visualizar"}
          </button>
          {selected.size === 0 && (
            <span className="text-xs text-gray-400">Selecione ao menos um relatório</span>
          )}
        </div>

        {/* ── Prévia ────────────────────────────────────────────────────────── */}
        {previewOpen && selectedList.length > 0 && (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-gray-800 text-sm">Pré-visualização</span>
              <button onClick={gerarPdf} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ background: "#1e3a5f" }}>
                <FileDown size={13} /> Gerar PDF
              </button>
            </div>
            <div className="p-5 space-y-8 overflow-x-auto">
              {coverEnabled && (
                <div>
                  <CoverPage titulo={coverTitulo} subtitulo={coverSubtitulo} />
                </div>
              )}
              {selectedList.map((rel, idx) => (
                <div key={rel.id} className={(coverEnabled || idx > 0) ? "pt-6 border-t border-dashed border-gray-200" : ""}>
                  <DispatchTable rel={rel} {...dispatchProps} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── PDF Print Area (hidden, printed via window.print) ─────────────── */}
      <div id="pdf-print-area" style={{ display: "none" }}>
        {coverEnabled && (
          <div style={{ padding: "0 4px" }}>
            <CoverPage titulo={coverTitulo} subtitulo={coverSubtitulo} />
          </div>
        )}
        {printList.map((rel, idx) => (
          <div key={rel.id} className={(coverEnabled || idx > 0) ? "pdf-page-break" : ""} style={{ padding: "0 4px" }}>
            <DispatchTable rel={rel} {...dispatchProps} />
          </div>
        ))}
      </div>
    </div>
  );
}

