"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight as ChevronRt, Filter } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData, loadData, prefetchKeys, PREFETCH_ORCADO_KEYS } from "@/lib/storage";
import { buildHierarchy } from "@/lib/utils";
import { idbGet } from "@/lib/idb";
import type { LancamentoFinanceiro, NaturezaRow, CentroResultadoRow, ParceiroRow } from "@/lib/mockData";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemTipo  = "SUBTOTAL" | "CONTA";
type RegraMode = "none" | "especifico" | "intervalo" | "multiplo";
type ViewMode  = "mensal" | "trimestral" | "quadrimestral" | "semestral";

interface RegraItem   { modo: RegraMode; codEspecifico?: string; codDe?: string; codAte?: string; codMultiplos?: string[] }
interface RegrasLinha { centroResultado?: RegraItem; natureza?: RegraItem }
interface FormulaItem { subtotalId: string; sinal: "+" | "-" }

interface DemoItem {
  id: string; nivel: number; tipo: ItemTipo; descricao: string;
  regras?: RegrasLinha; formula?: FormulaItem[];
}

interface PeriodResult { valores: Map<string, number>; naoAlocado: number }

interface Filtros {
  anoA:       number;
  anoB:       number;
  mesInicio:  number; // 1–12
  mesFim:     number; // 1–12
  viewMode:   ViewMode;
  mostrarZeros: boolean;
  crIds:      string[];
}

const _y = new Date().getFullYear();
const filtrosVazios: Filtros = { anoA: _y - 1, anoB: _y, mesInicio: 1, mesFim: 12, viewMode: "mensal", mostrarZeros: false, crIds: [] };

// ─── Grupos de período ────────────────────────────────────────────────────────

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

type GrupoDef = { label: string; sub: string; meses: number[] };

const GRUPOS_DEF: Record<ViewMode, GrupoDef[]> = {
  mensal: MESES.map((label, i) => ({ label, sub: "", meses: [i] })),
  trimestral: [
    { label: "1º Trim.",    sub: "Jan · Fev · Mar",             meses: [0,1,2]      },
    { label: "2º Trim.",    sub: "Abr · Mai · Jun",             meses: [3,4,5]      },
    { label: "3º Trim.",    sub: "Jul · Ago · Set",             meses: [6,7,8]      },
    { label: "4º Trim.",    sub: "Out · Nov · Dez",             meses: [9,10,11]    },
  ],
  quadrimestral: [
    { label: "1º Quadrim.", sub: "Jan · Fev · Mar · Abr",       meses: [0,1,2,3]    },
    { label: "2º Quadrim.", sub: "Mai · Jun · Jul · Ago",       meses: [4,5,6,7]    },
    { label: "3º Quadrim.", sub: "Set · Out · Nov · Dez",       meses: [8,9,10,11]  },
  ],
  semestral: [
    { label: "1º Sem.",     sub: "Jan · Fev · Mar · Abr · Mai · Jun", meses: [0,1,2,3,4,5]   },
    { label: "2º Sem.",     sub: "Jul · Ago · Set · Out · Nov · Dez", meses: [6,7,8,9,10,11]  },
  ],
};

const VIEW_LABELS: Record<ViewMode, string> = {
  mensal:        "Mensal",
  trimestral:    "Trimestral",
  quadrimestral: "Quadrimestral",
  semestral:     "Semestral",
};

// ─── DRE helpers ──────────────────────────────────────────────────────────────

function hasEffectiveRule(r: RegraItem | undefined): boolean {
  if (!r || r.modo === "none") return false;
  if (r.modo === "especifico") return !!r.codEspecifico;
  if (r.modo === "multiplo") return (r.codMultiplos?.length ?? 0) > 0;
  return !!(r.codDe || r.codAte);
}

function matchesRegra(cod: string, r: RegraItem | undefined): boolean {
  if (!r || r.modo === "none") return true;
  if (r.modo === "especifico") return r.codEspecifico ? cod === r.codEspecifico : true;
  if (r.modo === "multiplo") return r.codMultiplos ? r.codMultiplos.includes(cod) : true;
  const n = +cod; const isNum = !isNaN(n);
  if (r.codDe)  { const d = +r.codDe;  if (isNum && !isNaN(d) ? n < d : cod < r.codDe)  return false; }
  if (r.codAte) { const a = +r.codAte; if (isNum && !isNaN(a) ? n > a : cod > r.codAte) return false; }
  return true;
}

function computePeriod(dre: DemoItem[], lans: LancamentoFinanceiro[]): PeriodResult {
  const valores  = new Map<string, number>();
  const alocados = new Set<number>();
  for (const item of dre) {
    if (item.tipo !== "CONTA") continue;
    const hasNat = hasEffectiveRule(item.regras?.natureza);
    const hasCr  = hasEffectiveRule(item.regras?.centroResultado);
    if (!hasNat && !hasCr) { valores.set(item.id, 0); continue; }
    let total = 0;
    for (let i = 0; i < lans.length; i++) {
      const l = lans[i];
      if ((!hasNat || matchesRegra(l.codnat, item.regras?.natureza)) &&
          (!hasCr  || matchesRegra(l.codcencus, item.regras?.centroResultado))) {
        total += l.valor; alocados.add(i);
      }
    }
    valores.set(item.id, total);
  }
  for (let i = dre.length - 1; i >= 0; i--) {
    const item = dre[i];
    if (item.tipo !== "SUBTOTAL" || Array.isArray(item.formula)) continue;
    let total = 0;
    for (let j = i + 1; j < dre.length; j++) {
      if (dre[j].nivel <= item.nivel) break;
      if (dre[j].nivel === item.nivel + 1) total += valores.get(dre[j].id) ?? 0;
    }
    valores.set(item.id, total);
  }
  for (const item of dre) {
    if (item.tipo !== "SUBTOTAL" || !Array.isArray(item.formula)) continue;
    valores.set(item.id, item.formula.reduce(
      (s, fi) => s + (fi.sinal === "+" ? 1 : -1) * (valores.get(fi.subtotalId) ?? 0), 0
    ));
  }
  return { valores, naoAlocado: lans.reduce((s, l, i) => alocados.has(i) ? s : s + l.valor, 0) };
}

function aggregatePeriods(meses: number[], monthly: PeriodResult[], dre: DemoItem[]): PeriodResult {
  const valores = new Map<string, number>();
  for (const item of dre) {
    valores.set(item.id, meses.reduce((s, mi) => s + (monthly[mi].valores.get(item.id) ?? 0), 0));
  }
  return { valores, naoAlocado: meses.reduce((s, mi) => s + monthly[mi].naoAlocado, 0) };
}

function getRowStyle(tipo: string, nivel: number) {
  if (tipo === "SUBTOTAL") {
    if (nivel === 1) return { bg: "#1e3a5f", color: "white",   fw: "700", dark: true };
    if (nivel === 2) return { bg: "#dbeafe", color: "#1e3a5f", fw: "600", dark: false };
    return              { bg: "#f0f9ff", color: "#1e3a5f", fw: "600", dark: false };
  }
  return { bg: "white", color: "#334155", fw: "400", dark: false };
}

function fmtInt(v: number) {
  const s = Math.abs(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return v < 0 ? `(${s})` : s;
}

function fmtVar(base: number, novo: number): { text: string; color: string } {
  if (base === 0) return { text: "—", color: "#9ca3af" };
  const pct = ((novo - base) / Math.abs(base)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return {
    text: `${sign}${pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
    color: pct >= 0 ? "#16a34a" : "#dc2626",
  };
}

// ─── Fallback DRE ─────────────────────────────────────────────────────────────

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

// ─── Página ───────────────────────────────────────────────────────────────────

export default function DreContabilComparativoAnosPage() {
  const [dreRaw] = usePersistedData<DemoItem[]>("portal_dre_contabil", []);
  const dre = dreRaw.length > 0 ? dreRaw : dreInicial;

  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([]);
  const [dataLoaded,  setDataLoaded]  = useState(false);

  const [collapsed,   setCollapsed]   = useState<Set<string>>(new Set());
  const [activeLevel, setActiveLevel] = useState<number | "all">(1);
  const initialCollapseRef = useRef(false);

  const [parcData] = usePersistedData<ParceiroRow[]>("portal_parceiro", []);
  const [popupItem, setPopupItem] = useState<DemoItem | null>(null);
  const [popupSort, setPopupSort] = useState<{ col: "nome" | "vA" | "vB" | "var"; dir: "asc" | "desc" }>({ col: "vA", dir: "desc" });
  const [popupMes,  setPopupMes]  = useState<number | null>(null);

  const [filterOpen,          setFilterOpen]          = useState(false);
  const [somenteTotalizadora, setSomenteTotalizadora] = useState(false);
  const [filtros,    setFiltros]    = usePersistedData<Filtros>("portal_dre_contabil_filtros_comparativo_anos", filtrosVazios);
  const [rascunho,   setRascunho]   = useState<Filtros>(filtrosVazios);

  useEffect(() => {
    prefetchKeys(PREFETCH_ORCADO_KEYS);
    const fb = setTimeout(() => setDataLoaded(true), 400);
    idbGet<LancamentoFinanceiro[]>("portal_lancamentos_financeiro", []).then(data => {
      clearTimeout(fb); setLancamentos(data); setDataLoaded(true);
    });
  }, []);

  const anosDisponiveis = useMemo(() => {
    const set = new Set<number>();
    lancamentos.forEach(l => {
      const y = parseInt(l.periodo.split("-")[0]);
      if (!isNaN(y)) set.add(y);
    });
    return [...set].sort((a, b) => b - a);
  }, [lancamentos]);

  useEffect(() => {
    if (anosDisponiveis.length === 0) return;
    setFiltros(f => {
      const anoB = anosDisponiveis.includes(f.anoB) ? f.anoB : anosDisponiveis[0];
      const candidates = anosDisponiveis.filter(y => y !== anoB);
      const anoA = candidates.includes(f.anoA) ? f.anoA : (candidates[0] ?? anoB);
      if (anoA === f.anoA && anoB === f.anoB) return f;
      return { ...f, anoA, anoB };
    });
  }, [anosDisponiveis]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (initialCollapseRef.current || dre.length === 0) return;
    initialCollapseRef.current = true;
    setCollapsed(new Set(dre.filter(d => d.tipo === "SUBTOTAL").map(d => d.id)));
  }, [dre]); // eslint-disable-line react-hooks/exhaustive-deps

  const crExcluidos = useMemo(() => new Set(
    loadData<CentroResultadoRow[]>("portal_centro_resultado", [])
      .filter(r => r.ENTRA_RESULTADO !== "DRE" && r.ENTRA_RESULTADO !== "AMBOS")
      .map(r => r.CODCENCUS)
  ), []);

  const natExcluidas = useMemo(() => new Set(
    loadData<NaturezaRow[]>("portal_natureza", [])
      .filter(r => r.ENTRA_RESULTADO !== "DRE" && r.ENTRA_RESULTADO !== "AMBOS")
      .map(r => r.CODNAT)
  ), []);

  const crOpcoes = useMemo(() =>
    loadData<CentroResultadoRow[]>("portal_centro_resultado", [])
      .filter(r => r.GRAU === 1 && r.ATIVO && (r.ENTRA_RESULTADO === "DRE" || r.ENTRA_RESULTADO === "AMBOS"))
      .sort((a, b) => a.CODCENCUS.localeCompare(b.CODCENCUS, undefined, { numeric: true, sensitivity: "base" })),
  []);

  const crFiltroSet = useMemo(() => {
    const ids = filtros.crIds ?? [];
    if (ids.length === 0) return null;
    const allCrs = loadData<CentroResultadoRow[]>("portal_centro_resultado", [])
      .sort((a, b) => a.CODCENCUS.localeCompare(b.CODCENCUS, undefined, { numeric: true, sensitivity: "base" }));
    const crMap = new Map(allCrs.map(cr => [cr.CODCENCUS, cr]));
    const hasPaiData = allCrs.some(cr => !!cr.CODCENCUSPAI);
    const result = new Set<string>();
    if (hasPaiData) {
      for (const cr of allCrs) {
        let cur: typeof cr | undefined = cr;
        while (cur && cur.GRAU > 1 && cur.CODCENCUSPAI) cur = crMap.get(cur.CODCENCUSPAI);
        if (cur && ids.includes(cur.CODCENCUS)) result.add(cr.CODCENCUS);
      }
    } else {
      const withHierarchy = buildHierarchy(allCrs, "DESCRCENCUS");
      const selectedDescrs = new Set(
        allCrs.filter(cr => ids.includes(cr.CODCENCUS)).map(cr => cr.DESCRCENCUS)
      );
      for (const cr of withHierarchy) {
        const grau1 = cr.GRAU_1 as string | undefined;
        if (ids.includes(cr.CODCENCUS) || (grau1 && selectedDescrs.has(grau1)))
          result.add(cr.CODCENCUS);
      }
    }
    return result;
  }, [filtros.crIds]);

  // ── Dados por ano ─────────────────────────────────────────────────────────────

  function buildLancamentosBase(ano: number): LancamentoFinanceiro[] {
    return lancamentos.filter(l => {
      if (l.tipo !== "realizado") return false;
      if (!l.periodo.startsWith(String(ano))) return false;
      if (crExcluidos.has(l.codcencus)) return false;
      if (natExcluidas.has(l.codnat)) return false;
      if (crFiltroSet && (!l.codcencus || !crFiltroSet.has(l.codcencus))) return false;
      return true;
    });
  }

  const lancamentosA = useMemo(
    () => buildLancamentosBase(filtros.anoA),
    [lancamentos, filtros.anoA, crFiltroSet, crExcluidos, natExcluidas] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const lancamentosB = useMemo(
    () => buildLancamentosBase(filtros.anoB),
    [lancamentos, filtros.anoB, crFiltroSet, crExcluidos, natExcluidas] // eslint-disable-line react-hooks/exhaustive-deps
  );

  function buildPorPeriodo(lans: LancamentoFinanceiro[]): Map<string, LancamentoFinanceiro[]> {
    const map = new Map<string, LancamentoFinanceiro[]>();
    for (const l of lans) {
      const bucket = map.get(l.periodo);
      if (bucket) bucket.push(l);
      else map.set(l.periodo, [l]);
    }
    return map;
  }

  const porPeriodoA = useMemo(() => buildPorPeriodo(lancamentosA), [lancamentosA]);
  const porPeriodoB = useMemo(() => buildPorPeriodo(lancamentosB), [lancamentosB]);

  const valoresMensaisA = useMemo(() =>
    MESES.map((_, mi) => {
      const p = `${filtros.anoA}-${String(mi + 1).padStart(2, "0")}`;
      return computePeriod(dre, porPeriodoA.get(p) ?? []);
    }),
    [dre, porPeriodoA, filtros.anoA]
  );

  const valoresMensaisB = useMemo(() =>
    MESES.map((_, mi) => {
      const p = `${filtros.anoB}-${String(mi + 1).padStart(2, "0")}`;
      return computePeriod(dre, porPeriodoB.get(p) ?? []);
    }),
    [dre, porPeriodoB, filtros.anoB]
  );

  // ── Colunas ──────────────────────────────────────────────────────────────────

  type ColComp = { label: string; sublabel?: string; anoA: PeriodResult; anoB: PeriodResult };

  const mesesSel = useMemo(() => {
    const ini = (filtros.mesInicio ?? 1) - 1;
    const fim = (filtros.mesFim ?? 12) - 1;
    return Array.from({ length: fim - ini + 1 }, (_, i) => ini + i);
  }, [filtros.mesInicio, filtros.mesFim]);

  const colunas = useMemo<ColComp[]>(() => {
    return GRUPOS_DEF[filtros.viewMode]
      .map(g => {
        const meses = g.meses.filter(mi => mesesSel.includes(mi));
        return { g, meses };
      })
      .filter(({ meses }) => meses.length > 0)
      .map(({ g, meses }) => ({
        label:    g.label,
        sublabel: filtros.viewMode !== "mensal" ? g.sub : undefined,
        anoA:     aggregatePeriods(meses, valoresMensaisA, dre),
        anoB:     aggregatePeriods(meses, valoresMensaisB, dre),
      }));
  }, [filtros.viewMode, mesesSel, valoresMensaisA, valoresMensaisB, dre]);

  const totalA = useMemo(() => aggregatePeriods(mesesSel, valoresMensaisA, dre), [mesesSel, valoresMensaisA, dre]);
  const totalB = useMemo(() => aggregatePeriods(mesesSel, valoresMensaisB, dre), [mesesSel, valoresMensaisB, dre]);

  // ── Popup: análise por parceiro ───────────────────────────────────────────────

  function getLansForItem(item: DemoItem, lans: LancamentoFinanceiro[]): LancamentoFinanceiro[] {
    if (item.tipo === "CONTA") {
      const hasNat = hasEffectiveRule(item.regras?.natureza);
      const hasCr  = hasEffectiveRule(item.regras?.centroResultado);
      if (!hasNat && !hasCr) return [];
      return lans.filter(l =>
        (!hasNat || matchesRegra(l.codnat,    item.regras?.natureza)) &&
        (!hasCr  || matchesRegra(l.codcencus, item.regras?.centroResultado))
      );
    }
    const idx  = dre.findIndex(d => d.id === item.id);
    const seen = new Set<string>();
    const res: LancamentoFinanceiro[] = [];
    for (let i = idx + 1; i < dre.length; i++) {
      if (dre[i].nivel <= item.nivel) break;
      if (dre[i].tipo !== "CONTA") continue;
      const child  = dre[i];
      const hasNat = hasEffectiveRule(child.regras?.natureza);
      const hasCr  = hasEffectiveRule(child.regras?.centroResultado);
      if (!hasNat && !hasCr) continue;
      for (const l of lans) {
        if (!seen.has(l.id) &&
            (!hasNat || matchesRegra(l.codnat,    child.regras?.natureza)) &&
            (!hasCr  || matchesRegra(l.codcencus, child.regras?.centroResultado))) {
          res.push(l); seen.add(l.id);
        }
      }
    }
    return res;
  }

  const popupBase = useMemo(() => {
    if (!popupItem) return null;
    const parcMap  = new Map(parcData.map(p => [p.CODPARC, p.NOMEPARC]));
    const selMeses = popupMes !== null ? [popupMes] : mesesSel;
    const inRange  = (l: LancamentoFinanceiro) => selMeses.includes(parseInt(l.periodo.split("-")[1]) - 1);
    const lansA    = getLansForItem(popupItem, lancamentosA.filter(inRange));
    const lansB    = getLansForItem(popupItem, lancamentosB.filter(inRange));
    const byParcA  = new Map<string, number>();
    const byParcB  = new Map<string, number>();
    for (const l of lansA) { const k = l.codparc || "__"; byParcA.set(k, (byParcA.get(k) ?? 0) + l.valor); }
    for (const l of lansB) { const k = l.codparc || "__"; byParcB.set(k, (byParcB.get(k) ?? 0) + l.valor); }
    const keys = new Set([...byParcA.keys(), ...byParcB.keys()]);
    const rows = [...keys].map(k => ({
      cod:  k,
      nome: k === "__" ? "Sem parceiro" : (parcMap.get(k) ? `${k} · ${parcMap.get(k)}` : k),
      vA:   byParcA.get(k) ?? 0,
      vB:   byParcB.get(k) ?? 0,
    }));
    return { rows, totalA: rows.reduce((s, r) => s + r.vA, 0), totalB: rows.reduce((s, r) => s + r.vB, 0) };
  }, [popupItem, lancamentosA, lancamentosB, popupMes, mesesSel, parcData]); // eslint-disable-line react-hooks/exhaustive-deps

  const popupRows = useMemo(() => {
    if (!popupBase) return [];
    return [...popupBase.rows].sort((a, b) => {
      const dir = popupSort.dir === "asc" ? 1 : -1;
      switch (popupSort.col) {
        case "nome": return dir * a.nome.localeCompare(b.nome, "pt-BR");
        case "vA":   return dir * (a.vA - b.vA);
        case "vB":   return dir * (a.vB - b.vB);
        case "var": {
          const va = a.vA === 0 ? -Infinity : (a.vB - a.vA) / Math.abs(a.vA);
          const vb = b.vA === 0 ? -Infinity : (b.vB - b.vA) / Math.abs(b.vA);
          return dir * (va - vb);
        }
        default: return 0;
      }
    });
  }, [popupBase, popupSort]);

  function openPopup(item: DemoItem) {
    setPopupItem(item);
    setPopupMes(null);
    setPopupSort({ col: "vA", dir: "desc" });
  }

  function togglePopupSort(col: "nome" | "vA" | "vB" | "var") {
    setPopupSort(s => s.col === col
      ? { col, dir: s.dir === "desc" ? "asc" : "desc" }
      : { col, dir: col === "nome" ? "asc" : "desc" }
    );
  }

  // ── DRE visibility ────────────────────────────────────────────────────────────

  const maxNivel = useMemo(
    () => Math.max(...dre.filter(d => d.tipo === "SUBTOTAL").map(d => d.nivel), 1),
    [dre]
  );

  const visibleData = useMemo(() => {
    const hidden = new Set<string>();
    dre.forEach((item, idx) => {
      if (item.tipo === "SUBTOTAL" && collapsed.has(item.id)) {
        for (let i = idx + 1; i < dre.length; i++) {
          if (dre[i].nivel <= item.nivel) break;
          hidden.add(dre[i].id);
        }
      }
    });
    return dre
      .map((item, dataIdx) => ({ item, dataIdx }))
      .filter(({ item }) => {
        if (hidden.has(item.id)) return false;
        if (!filtros.mostrarZeros && item.tipo === "CONTA") {
          const allZero = colunas.every(c =>
            (c.anoA.valores.get(item.id) ?? 0) === 0 &&
            (c.anoB.valores.get(item.id) ?? 0) === 0
          );
          if (allZero) return false;
        }
        return true;
      });
  }, [dre, collapsed, filtros.mostrarZeros, colunas]);

  const filtrosAtivos = useMemo(() => {
    let n = 0;
    if (filtros.mesInicio !== 1 || filtros.mesFim !== 12) n++;
    if (filtros.viewMode !== "mensal") n++;
    if (filtros.mostrarZeros) n++;
    if ((filtros.crIds?.length ?? 0) > 0) n++;
    return n;
  }, [filtros]);

  function handleSetLevel(nivel: number | "all") {
    setActiveLevel(nivel);
    if (nivel === "all") {
      setCollapsed(new Set());
    } else {
      setCollapsed(new Set(
        dre.filter(d => d.tipo === "SUBTOTAL" && d.nivel >= nivel).map(d => d.id)
      ));
    }
  }

  function toggleCollapse(id: string) {
    setActiveLevel("all");
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const periodoLabel = (filtros.mesInicio ?? 1) === 1 && (filtros.mesFim ?? 12) === 12
    ? "Ano completo"
    : `${MESES[(filtros.mesInicio ?? 1) - 1]} – ${MESES[(filtros.mesFim ?? 12) - 1]}`;

  function aplicar()    { setFiltros(rascunho); setFilterOpen(false); }
  function limparTudo() { setRascunho(f => ({ ...filtrosVazios, anoA: f.anoA, anoB: f.anoB })); }

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (!dataLoaded) {
    return (
      <div>
        <PageHeader title="Demonstração de Resultado Contábil" subtitle="Comparativo Ano × Ano" />
        <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">Carregando lançamentos…</span>
        </div>
      </div>
    );
  }

  if (anosDisponiveis.length === 0) {
    return (
      <div>
        <PageHeader title="Demonstração de Resultado Contábil" subtitle="Comparativo Ano × Ano" />
        <div className="p-6">
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-xl border border-gray-100">
            <p className="text-gray-500 font-medium">Nenhum lançamento financeiro importado</p>
            <p className="text-gray-400 text-sm mt-1">Importe lançamentos em Lançamentos › Financeiro.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const totalCols = (somenteTotalizadora ? 0 : colunas.length * 3) + 3;

  return (
    <div>
      <PageHeader title="Demonstração de Resultado Contábil" subtitle="Comparativo Ano × Ano" />

      <div className="p-6 space-y-4 min-w-max">

        {/* ── Controles ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">

          {/* Seletores de ano */}
          <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <span className="text-xs text-gray-400 font-medium">Ano A</span>
            <select
              value={filtros.anoA}
              onChange={e => setFiltros(f => ({ ...f, anoA: parseInt(e.target.value) }))}
              className="text-sm text-gray-700 bg-transparent focus:outline-none cursor-pointer"
            >
              {anosDisponiveis.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <span className="text-gray-400 text-sm">vs</span>

          <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <span className="text-xs text-gray-400 font-medium">Ano B</span>
            <select
              value={filtros.anoB}
              onChange={e => setFiltros(f => ({ ...f, anoB: parseInt(e.target.value) }))}
              className="text-sm text-gray-700 bg-transparent focus:outline-none cursor-pointer"
            >
              {anosDisponiveis.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Filtros */}
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

          {/* Toggle: somente coluna totalizadora */}
          <button
            onClick={() => setSomenteTotalizadora(v => !v)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium border rounded-lg transition-colors"
            style={somenteTotalizadora
              ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" }
              : { background: "white", color: "#374151", borderColor: "#e5e7eb" }}>
            Somente Total
          </button>

          {/* Níveis */}
          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
            {Array.from({ length: maxNivel }, (_, i) => i + 1).map(n => (
              <button key={n} onClick={() => handleSetLevel(n)}
                className="px-3 py-2 text-xs font-semibold transition-colors"
                style={activeLevel === n
                  ? { background: "#1e3a5f", color: "white" }
                  : { background: "white", color: "#374151" }}>
                N{n}
              </button>
            ))}
            <button onClick={() => handleSetLevel("all")}
              className="px-3 py-2 text-xs font-semibold transition-colors border-l border-gray-200"
              style={activeLevel === "all"
                ? { background: "#1e3a5f", color: "white" }
                : { background: "white", color: "#374151" }}>
              Tudo
            </button>
          </div>

          <span className="ml-auto text-xs text-gray-400">
            {VIEW_LABELS[filtros.viewMode]} · {periodoLabel} · {filtros.anoA} × {filtros.anoB}
          </span>
        </div>

        {/* ── Tabela ──────────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-semibold text-gray-800 text-sm">
              DRE Contábil · Ano × Ano ·{" "}
              <span className="font-normal text-gray-500">
                {filtros.anoA} vs {filtros.anoB} · {VIEW_LABELS[filtros.viewMode]}
              </span>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="text-sm border-collapse" style={{ minWidth: "max-content", width: "100%" }}>
              <thead>
                {filtros.viewMode !== "mensal" && !somenteTotalizadora && (
                  <tr style={{ background: "#152d4a" }}>
                    <th className="sticky left-0 z-30 min-w-[200px]" style={{ background: "#152d4a" }} />
                    {colunas.map((c, ci) => (
                      <th key={ci} colSpan={3}
                        className="px-3 py-1 text-center text-[10px] text-white/60 uppercase tracking-widest font-semibold border-l border-white/10">
                        <div>{c.label}</div>
                        {c.sublabel && <div className="font-normal text-[9px] text-white/30 mt-0.5">{c.sublabel}</div>}
                      </th>
                    ))}
                    <th colSpan={3} className="px-3 py-1 text-center text-[10px] text-white/60 uppercase tracking-widest font-semibold border-l border-white/10">
                      Total
                    </th>
                  </tr>
                )}

                <tr style={{ background: "#1e3a5f" }}>
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky left-0 z-30 min-w-[200px]"
                    style={{ background: "#1e3a5f" }}>
                    Descrição
                  </th>
                  {!somenteTotalizadora && colunas.map((c, ci) => (
                    <React.Fragment key={ci}>
                      <th className={`font-semibold text-white/80 text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap min-w-[110px]${ci > 0 ? " border-l border-white/10" : ""}`}
                        style={{ background: "#1e3a5f" }}>
                        {filtros.viewMode === "mensal" && <div className="uppercase">{c.label}</div>}
                        <div className="font-normal text-[10px] text-white/50 mt-0.5">{filtros.anoA}</div>
                      </th>
                      <th className="font-semibold text-white/80 text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap min-w-[110px]"
                        style={{ background: "#1e3a5f" }}>
                        {filtros.viewMode === "mensal" && <div className="uppercase opacity-0 select-none">{c.label}</div>}
                        <div className="font-normal text-[10px] text-white/50 mt-0.5">{filtros.anoB}</div>
                      </th>
                      <th className="font-semibold text-white/80 text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap min-w-[80px]"
                        style={{ background: "#1e3a5f" }}>
                        {filtros.viewMode === "mensal" && <div className="uppercase opacity-0 select-none">{c.label}</div>}
                        <div className="font-normal text-[10px] text-white/50 mt-0.5">Var%</div>
                      </th>
                    </React.Fragment>
                  ))}
                  <th className="font-semibold text-white/80 text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap min-w-[110px] border-l border-white/20"
                    style={{ background: "#1e3a5f" }}>
                    <div className="uppercase">Total</div>
                    <div className="font-normal text-[10px] text-white/50 mt-0.5">{filtros.anoA}</div>
                  </th>
                  <th className="font-semibold text-white/80 text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap min-w-[110px]"
                    style={{ background: "#1e3a5f" }}>
                    <div className="uppercase opacity-0 select-none">Total</div>
                    <div className="font-normal text-[10px] text-white/50 mt-0.5">{filtros.anoB}</div>
                  </th>
                  <th className="font-semibold text-white/80 text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap min-w-[80px]"
                    style={{ background: "#1e3a5f" }}>
                    <div className="uppercase opacity-0 select-none">Total</div>
                    <div className="font-normal text-[10px] text-white/50 mt-0.5">Var%</div>
                  </th>
                </tr>
              </thead>

              <tbody suppressHydrationWarning>
                {visibleData.map(({ item }) => {
                  const s           = getRowStyle(item.tipo, item.nivel);
                  const isSubtotal  = item.tipo === "SUBTOTAL";
                  const isCollapsed = isSubtotal && collapsed.has(item.id);

                  const vTotalA = totalA.valores.get(item.id) ?? 0;
                  const vTotalB = totalB.valores.get(item.id) ?? 0;
                  const varTotal = fmtVar(vTotalA, vTotalB);

                  return (
                    <tr key={item.id}
                      style={{ background: s.bg, color: s.color, fontWeight: s.fw }}
                      className="border-b border-gray-100 hover:brightness-95 transition-all cursor-pointer"
                      onClick={() => openPopup(item)}>

                      <td className="px-4 py-2.5 sticky left-0 z-10 cursor-default" style={{ background: s.bg }}>
                        <span className="flex items-center gap-1" style={{ paddingLeft: `${(item.nivel - 1) * 16}px` }}>
                          {isSubtotal ? (
                            <button onClick={e => { e.stopPropagation(); toggleCollapse(item.id); }}
                              className="flex-shrink-0 rounded p-0.5 transition-colors"
                              style={{ color: s.dark ? "rgba(255,255,255,0.7)" : "#1e3a5f" }}>
                              {isCollapsed ? <ChevronRt size={13} /> : <ChevronDown size={13} />}
                            </button>
                          ) : <span className="w-4 flex-shrink-0" />}
                          <span className={`whitespace-nowrap${isSubtotal ? " uppercase" : ""}`}>{item.descricao}</span>
                        </span>
                      </td>

                      {!somenteTotalizadora && colunas.map((c, ci) => {
                        const vA = c.anoA.valores.get(item.id) ?? 0;
                        const vB = c.anoB.valores.get(item.id) ?? 0;
                        const v  = fmtVar(vA, vB);
                        return (
                          <React.Fragment key={ci}>
                            <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap${ci > 0 ? " border-l border-gray-100" : ""}`}>
                              {vA !== 0 ? <span>{fmtInt(vA)}</span> : <span style={{ opacity: 0.18 }}>—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                              {vB !== 0 ? <span>{fmtInt(vB)}</span> : <span style={{ opacity: 0.18 }}>—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                              <span style={{ color: s.dark ? (v.color === "#16a34a" ? "#86efac" : v.color === "#dc2626" ? "#fca5a5" : "rgba(255,255,255,0.4)") : v.color }}
                                className="text-xs font-medium">
                                {v.text}
                              </span>
                            </td>
                          </React.Fragment>
                        );
                      })}

                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-gray-100"
                        style={{ fontWeight: isSubtotal ? "700" : "500" }}>
                        {vTotalA !== 0 ? <span>{fmtInt(vTotalA)}</span> : <span style={{ opacity: 0.18 }}>—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap"
                        style={{ fontWeight: isSubtotal ? "700" : "500" }}>
                        {vTotalB !== 0 ? <span>{fmtInt(vTotalB)}</span> : <span style={{ opacity: 0.18 }}>—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                        <span style={{ color: s.dark ? (varTotal.color === "#16a34a" ? "#86efac" : varTotal.color === "#dc2626" ? "#fca5a5" : "rgba(255,255,255,0.4)") : varTotal.color }}
                          className="text-xs font-medium">
                          {varTotal.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {visibleData.length === 0 && (
                  <tr>
                    <td colSpan={1 + totalCols} className="px-4 py-12 text-center text-gray-400 text-sm">
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

      {/* ── Popup: análise por parceiro ────────────────────────────────────────── */}
      {popupItem && popupBase && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setPopupItem(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col pointer-events-auto">

              {/* Header */}
              <div className="px-6 pt-4 pb-3 border-b border-gray-100 flex-shrink-0">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-0.5">
                      Análise por Parceiro
                    </p>
                    <h2 className="text-base font-bold text-gray-800">{popupItem.descricao}</h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {filtros.anoA} vs {filtros.anoB}
                    </p>
                  </div>
                  <button onClick={() => setPopupItem(null)}
                    className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none ml-4 mt-0.5">✕</button>
                </div>

                {/* Seletor de mês */}
                {mesesSel.length > 1 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    <button
                      onClick={() => setPopupMes(null)}
                      className="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                      style={popupMes === null
                        ? { background: "#1e3a5f", color: "white" }
                        : { background: "#f1f5f9", color: "#475569" }}>
                      Todos
                    </button>
                    {mesesSel.map(mi => (
                      <button key={mi}
                        onClick={() => setPopupMes(mi === popupMes ? null : mi)}
                        className="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                        style={popupMes === mi
                          ? { background: "#1e3a5f", color: "white" }
                          : { background: "#f1f5f9", color: "#475569" }}>
                        {MESES[mi]}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Tabela */}
              <div className="overflow-y-auto flex-1">
                {popupRows.length === 0 ? (
                  <div className="flex items-center justify-center py-16 text-sm text-gray-400">
                    Nenhum lançamento com parceiro identificado no período.
                  </div>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr style={{ background: "#1e3a5f" }}>
                        {(["nome", "vA", "vB", "var"] as const).map(col => {
                          const labels: Record<string, string> = { nome: "Parceiro", vA: String(filtros.anoA), vB: String(filtros.anoB), var: "Var%" };
                          const active = popupSort.col === col;
                          const icon   = active ? (popupSort.dir === "desc" ? " ↓" : " ↑") : " ⇅";
                          return (
                            <th key={col}
                              onClick={() => togglePopupSort(col)}
                              className={`py-2.5 font-semibold text-xs uppercase tracking-wide cursor-pointer select-none transition-colors hover:bg-white/10 ${col === "nome" ? "text-left px-5" : "text-right px-4 min-w-[110px]"}`}
                              style={{ color: active ? "white" : "rgba(255,255,255,0.65)" }}>
                              {labels[col]}
                              <span className="ml-1 text-[10px] opacity-70">{icon}</span>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {popupRows.map((r, i) => {
                        const v = fmtVar(r.vA, r.vB);
                        return (
                          <tr key={r.cod}
                            className="border-b border-gray-50 hover:bg-blue-50/40 transition-colors"
                            style={{ background: i % 2 === 0 ? "white" : "#f8fafc" }}>
                            <td className="px-5 py-2.5 text-gray-700 truncate max-w-[260px]" title={r.nome}>
                              {r.nome}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
                              {r.vA !== 0 ? fmtInt(r.vA) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
                              {r.vB !== 0 ? fmtInt(r.vB) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                              <span className="text-xs font-medium" style={{ color: v.color }}>{v.text}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "#1e3a5f" }}>
                        <td className="px-5 py-2.5 font-bold text-white text-xs uppercase tracking-wide">Total</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white whitespace-nowrap">
                          {fmtInt(popupBase.totalA)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white whitespace-nowrap">
                          {fmtInt(popupBase.totalB)}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {(() => { const v = fmtVar(popupBase.totalA, popupBase.totalB); return (
                            <span className="text-xs font-bold"
                              style={{ color: v.color === "#16a34a" ? "#86efac" : v.color === "#dc2626" ? "#fca5a5" : "rgba(255,255,255,0.4)" }}>
                              {v.text}
                            </span>
                          ); })()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              {/* Rodapé */}
              <div className="px-6 py-3 border-t border-gray-100 flex-shrink-0 flex items-center justify-between">
                <span className="text-xs text-gray-400">{popupRows.length} parceiro{popupRows.length !== 1 ? "s" : ""}</span>
                <button onClick={() => setPopupItem(null)}
                  className="px-4 py-1.5 text-sm font-medium text-white rounded-lg transition-colors"
                  style={{ background: "#1e3a5f" }}>
                  Fechar
                </button>
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
                  {(rascunho.mesInicio !== 1 || rascunho.mesFim !== 12) && (
                    <span onClick={() => setRascunho(r => ({ ...r, mesInicio: 1, mesFim: 12 }))}
                      className="text-[11px] text-blue-600 hover:underline cursor-pointer font-normal">limpar</span>
                  )}
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">De</label>
                    <select
                      value={rascunho.mesInicio}
                      onChange={e => {
                        const v = parseInt(e.target.value);
                        setRascunho(r => ({ ...r, mesInicio: v, mesFim: r.mesFim < v ? v : r.mesFim }));
                      }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                      {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Até</label>
                    <select
                      value={rascunho.mesFim}
                      onChange={e => {
                        const v = parseInt(e.target.value);
                        setRascunho(r => ({ ...r, mesFim: v, mesInicio: r.mesInicio > v ? v : r.mesInicio }));
                      }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                      {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Visão */}
              <div className="border-b border-gray-100 px-4 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center justify-between">
                  Visão
                  {rascunho.viewMode !== "mensal" && (
                    <span onClick={() => setRascunho(r => ({ ...r, viewMode: "mensal" }))}
                      className="text-[11px] text-blue-600 hover:underline cursor-pointer font-normal">limpar</span>
                  )}
                </p>
                <div className="space-y-0.5">
                  {(Object.keys(VIEW_LABELS) as ViewMode[]).map(mode => (
                    <label key={mode}
                      className="flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-gray-50 rounded text-sm text-gray-700">
                      <input type="radio"
                        checked={rascunho.viewMode === mode}
                        onChange={() => setRascunho(r => ({ ...r, viewMode: mode }))}
                        className="w-4 h-4 cursor-pointer flex-shrink-0"
                        style={{ accentColor: "#1e3a5f" }} />
                      {VIEW_LABELS[mode]}
                    </label>
                  ))}
                </div>
              </div>

              {/* Centro de Resultado */}
              {crOpcoes.length > 0 && (
                <div className="border-b border-gray-100 px-4 py-4">
                  <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center justify-between">
                    Centro de Resultado
                    {(rascunho.crIds?.length ?? 0) > 0 && (
                      <span onClick={() => setRascunho(r => ({ ...r, crIds: [] }))}
                        className="text-[11px] text-blue-600 hover:underline cursor-pointer font-normal">limpar</span>
                    )}
                  </p>
                  <div className="space-y-0.5">
                    {crOpcoes.map(cr => (
                      <label key={cr.CODCENCUS}
                        className="flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-gray-50 rounded text-sm text-gray-700">
                        <input type="checkbox"
                          checked={rascunho.crIds?.includes(cr.CODCENCUS)}
                          onChange={e => setRascunho(r => ({
                            ...r,
                            crIds: e.target.checked
                              ? [...(r.crIds ?? []), cr.CODCENCUS]
                              : (r.crIds ?? []).filter(id => id !== cr.CODCENCUS),
                          }))}
                          className="w-4 h-4 rounded cursor-pointer flex-shrink-0"
                          style={{ accentColor: "#1e3a5f" }} />
                        <span className="truncate" title={cr.DESCRCENCUS}>
                          <span className="text-gray-400 text-xs mr-1">{cr.CODCENCUS}</span>
                          {cr.DESCRCENCUS}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Exibição */}
              <div className="px-4 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Exibição</p>
                <label className="flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-gray-50 rounded text-sm text-gray-700">
                  <input type="checkbox"
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
