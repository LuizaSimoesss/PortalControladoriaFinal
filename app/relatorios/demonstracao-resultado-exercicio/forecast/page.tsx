"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { ChevronDown, ChevronRight as ChevronRt, Filter, Download } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData, loadData } from "@/lib/storage";
import { buildHierarchy } from "@/lib/utils";
import { buildForecastMap, getForecastAnos, getAllForecastCenarios, getForecastMesesRealizados } from "@/lib/forecastData";
import { CentroResultadoRow } from "@/lib/mockData";
import { idbGet } from "@/lib/idb";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemTipo  = "SUBTOTAL" | "CONTA";
type ViewMode  = "mensal" | "trimestral" | "quadrimestral" | "semestral";
type RegraMode = "none" | "especifico" | "intervalo" | "multiplo";

interface FormulaItem { subtotalId: string; sinal: "+" | "-" }
interface RegraItem   { modo: RegraMode; codEspecifico?: string; codDe?: string; codAte?: string; codMultiplos?: string[] }
interface RegrasLinha { centroResultado?: RegraItem; natureza?: RegraItem }
interface DemoItem {
  id: string; nivel: number; tipo: ItemTipo; descricao: string;
  regras?: RegrasLinha; formula?: FormulaItem[];
}
interface LancamentoFin { tipo: string; periodo: string; codnat: string; codcencus: string; codemp: string; valor: number }

interface PeriodResult { valores: Map<string, number> }
interface ColDRE       { label: string; sublabel?: string; result: PeriodResult }

interface Filtros {
  periodoInicio: string;
  periodoFim:    string;
  viewMode:      ViewMode;
  mostrarZeros:  boolean;
  crIds:         string[];
  cenarioNome:   string;
}

const _y = new Date().getFullYear();
const filtrosVazios: Filtros = { periodoInicio: `${_y}-01`, periodoFim: `${_y}-12`, viewMode: "mensal", mostrarZeros: false, crIds: [], cenarioNome: "" };

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
  mensal: "Mensal", trimestral: "Trimestral", quadrimestral: "Quadrimestral", semestral: "Semestral",
};

// ─── DRE helpers ──────────────────────────────────────────────────────────────

function computeCodes(items: DemoItem[]): string[] {
  const counters = [0,0,0,0,0]; let prev = 0;
  return items.map(item => {
    const n = item.nivel;
    if (n > prev + 1) for (let i = prev + 1; i < n; i++) if (!counters[i]) counters[i] = 1;
    counters[n]++;
    for (let i = n + 1; i <= 4; i++) counters[i] = 0;
    const parts: number[] = [];
    for (let i = 1; i <= n; i++) parts.push(counters[i]);
    prev = n; return parts.join(".");
  });
}

function computePeriodFromForecast(
  dre: DemoItem[],
  fcMap: Map<string, Map<string, number>>,
  period: string
): PeriodResult {
  const valores = new Map<string, number>();

  for (const item of dre) {
    const v = fcMap.get(item.id)?.get(period);
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
    valores.set(item.id, item.formula.reduce(
      (s, fi) => s + (fi.sinal === "+" ? 1 : -1) * (valores.get(fi.subtotalId) ?? 0), 0
    ));
  }

  return { valores };
}

const EMPTY_PERIOD: PeriodResult = { valores: new Map() };

function aggregatePeriods(meses: number[], monthly: PeriodResult[], dre: DemoItem[]): PeriodResult {
  const valores = new Map<string, number>();
  for (const item of dre) {
    valores.set(item.id, meses.reduce((s, mi) => s + (monthly[mi].valores.get(item.id) ?? 0), 0));
  }
  return { valores };
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

// ─── Realized helpers ─────────────────────────────────────────────────────────

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

function computePeriodReal(dre: DemoItem[], lans: LancamentoFin[]): PeriodResult {
  const valores = new Map<string, number>();
  for (const item of dre) {
    if (item.tipo !== "CONTA") continue;
    const hasNat = hasEffectiveRule(item.regras?.natureza);
    const hasCr  = hasEffectiveRule(item.regras?.centroResultado);
    if (!hasNat && !hasCr) { valores.set(item.id, 0); continue; }
    let total = 0;
    for (const l of lans) {
      if ((!hasNat || matchesRegra(l.codnat, item.regras?.natureza)) &&
          (!hasCr  || matchesRegra(l.codcencus, item.regras?.centroResultado))) {
        total += l.valor;
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
  return { valores };
}

// ─── Fallback DRE ─────────────────────────────────────────────────────────────

const dreInicial: DemoItem[] = [
  { id: "d1",  nivel: 1, tipo: "SUBTOTAL", descricao: "RECEITA BRUTA" },
  { id: "d2",  nivel: 2, tipo: "CONTA",    descricao: "Receita de Produtos" },
  { id: "d3",  nivel: 2, tipo: "CONTA",    descricao: "Receita de Serviços" },
  { id: "d4",  nivel: 1, tipo: "SUBTOTAL", descricao: "(-) DEDUÇÕES" },
  { id: "d5",  nivel: 2, tipo: "CONTA",    descricao: "Impostos sobre Vendas" },
  { id: "d7",  nivel: 1, tipo: "SUBTOTAL", descricao: "(-) CUSTOS" },
  { id: "d8",  nivel: 2, tipo: "CONTA",    descricao: "Custo dos Produtos Vendidos" },
  { id: "d10", nivel: 1, tipo: "SUBTOTAL", descricao: "(-) DESPESAS OPERACIONAIS" },
];

// ─── Página ───────────────────────────────────────────────────────────────────

export default function DreForecastGerencialPage() {
  const [dre] = usePersistedData<DemoItem[]>("portal_dre", dreInicial);

  const [collapsed,   setCollapsed]  = useState<Set<string>>(new Set());
  const [activeLevel, setActiveLevel] = useState<number | "all">(1);
  const initialCollapseRef = useRef(false);

  const [filterOpen, setFilterOpen] = useState(false);
  const [filtros, setFiltros] = usePersistedData<Filtros>("portal_dre_filtros_forecast_ger", filtrosVazios);
  const [rascunho, setRascunho] = useState<Filtros>(filtrosVazios);

  const [anosDisponiveis, setAnosDisponiveis] = useState<number[]>([new Date().getFullYear()]);
  const [fcMap, setFcMap] = useState<Map<string, Map<string, number>>>(() => new Map());
  const [todosCenarios, setTodosCenarios] = useState<{ nome: string; cor: string }[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoFin[]>([]);
  const [mesesRealizados, setMesesRealizados] = useState<number[]>([]);

  const ano = parseInt(filtros.periodoInicio.slice(0, 4)) || new Date().getFullYear();

  useEffect(() => {
    const anos = getForecastAnos();
    setAnosDisponiveis(anos);
    if (anos.length > 0 && !anos.includes(ano)) {
      const y = anos[0];
      setFiltros(f => ({ ...f, periodoInicio: `${y}-01`, periodoFim: `${y}-12` }));
      setRascunho(r => ({ ...r, periodoInicio: `${y}-01`, periodoFim: `${y}-12` }));
    }
    const cens = getAllForecastCenarios();
    setTodosCenarios(cens);
    if (cens.length > 0) {
      setFiltros(f => ({ ...f, cenarioNome: f.cenarioNome || cens[0].nome }));
      setRascunho(r => ({ ...r, cenarioNome: r.cenarioNome || cens[0].nome }));
    }
    idbGet<LancamentoFin[]>("portal_lancamentos_financeiro").then(data => {
      if (data) setLancamentos(data.filter(l => l.tipo === "realizado"));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      // CODCENCUSPAI disponível: sobe a cadeia de pais até encontrar o GRAU=1
      for (const cr of allCrs) {
        let cur: typeof cr | undefined = cr;
        while (cur && cur.GRAU > 1 && cur.CODCENCUSPAI) cur = crMap.get(cur.CODCENCUSPAI);
        if (cur && ids.includes(cur.CODCENCUS)) result.add(cr.CODCENCUS);
      }
    } else {
      // Fallback: buildHierarchy por ordem de CODCENCUS (funciona quando pais ordenam antes dos filhos)
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

  useEffect(() => {
    setFcMap(buildForecastMap("gerencial", ano, crFiltroSet, filtros.cenarioNome || undefined));
    setMesesRealizados(getForecastMesesRealizados(filtros.cenarioNome || undefined));
    function onUpdate(e: Event) {
      const key = (e as CustomEvent<{ key: string }>).detail?.key ?? "";
      if (key.startsWith("portal_orcamento_") || key.startsWith("portal_forecast_")) {
        setFcMap(buildForecastMap("gerencial", ano, crFiltroSet, filtros.cenarioNome || undefined));
        setMesesRealizados(getForecastMesesRealizados(filtros.cenarioNome || undefined));
      }
    }
    window.addEventListener("portal-data-update", onUpdate);
    return () => window.removeEventListener("portal-data-update", onUpdate);
  }, [ano, crFiltroSet, filtros.cenarioNome]);

  useEffect(() => {
    if (initialCollapseRef.current || dre.length === 0) return;
    initialCollapseRef.current = true;
    setCollapsed(new Set(dre.filter(d => d.tipo === "SUBTOTAL").map(d => d.id)));
  }, [dre]); // eslint-disable-line react-hooks/exhaustive-deps

  const crExcluidos = useMemo(() => new Set(
    loadData<{ CODCENCUS: string; ENTRA_RESULTADO: string }[]>("portal_centro_resultado", [])
      .filter(r => r.ENTRA_RESULTADO !== "DRE" && r.ENTRA_RESULTADO !== "AMBOS")
      .map(r => r.CODCENCUS)
  ), []);
  const natExcluidas = useMemo(() => new Set(
    loadData<{ CODNAT: string; ENTRA_RESULTADO: string }[]>("portal_natureza", [])
      .filter(r => r.ENTRA_RESULTADO !== "DRE" && r.ENTRA_RESULTADO !== "AMBOS")
      .map(r => r.CODNAT)
  ), []);
  const empExcluidas = useMemo(() => new Set(
    loadData<{ CODEMP: string; ENTRA_RESULTADO: string }[]>("portal_empresas", [])
      .filter(r => r.ENTRA_RESULTADO !== "DRE" && r.ENTRA_RESULTADO !== "AMBOS")
      .map(r => r.CODEMP)
  ), []);

  const lancamentosBase = useMemo(() =>
    lancamentos.filter(l =>
      !crExcluidos.has(l.codcencus) &&
      !natExcluidas.has(l.codnat) &&
      !empExcluidas.has(l.codemp) &&
      (!crFiltroSet || crFiltroSet.has(l.codcencus))
    ),
  [lancamentos, crExcluidos, natExcluidas, empExcluidas, crFiltroSet]);

  const mesesRealizadosSet = useMemo(() => new Set(mesesRealizados), [mesesRealizados]);

  // ── Valores mensais ────────────────────────────────────────────────────────
  const valoresPorMes = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    const anoFiltro = periodoInicio.slice(0, 4);
    return MESES.map((_, mi) => {
      const p = `${anoFiltro}-${String(mi + 1).padStart(2, "0")}`;
      if (p < periodoInicio || p > periodoFim) return EMPTY_PERIOD;
      if (mesesRealizadosSet.has(mi)) {
        const lansDoMes = lancamentosBase.filter(l => l.periodo === p);
        return computePeriodReal(dre, lansDoMes);
      }
      return computePeriodFromForecast(dre, fcMap, p);
    });
  }, [dre, fcMap, filtros, mesesRealizadosSet, lancamentosBase]);

  const colunas = useMemo<ColDRE[]>(() => {
    const { viewMode, periodoInicio, periodoFim } = filtros;
    const anoFiltro = periodoInicio.slice(0, 4);
    return GRUPOS_DEF[viewMode]
      .filter(g => g.meses.some(mi => {
        const p = `${anoFiltro}-${String(mi + 1).padStart(2, "0")}`;
        return p >= periodoInicio && p <= periodoFim;
      }))
      .map(g => ({
        label:    g.label,
        sublabel: viewMode !== "mensal" ? g.sub : undefined,
        result:   aggregatePeriods(g.meses, valoresPorMes, dre),
      }));
  }, [filtros, valoresPorMes, dre]);

  const valoresTotal = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    const anoFiltro = periodoInicio.slice(0, 4);
    const idxs = MESES.map((_, mi) => `${anoFiltro}-${String(mi + 1).padStart(2, "0")}`)
      .map((p, mi) => ({ p, mi }))
      .filter(({ p }) => p >= periodoInicio && p <= periodoFim)
      .map(({ mi }) => mi);
    return aggregatePeriods(idxs, valoresPorMes, dre);
  }, [filtros, valoresPorMes, dre]);

  const codes    = useMemo(() => computeCodes(dre), [dre]);
  const maxNivel = useMemo(() => Math.max(...dre.filter(d => d.tipo === "SUBTOTAL").map(d => d.nivel), 1), [dre]);

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
          if (colunas.every(c => (c.result.valores.get(item.id) ?? 0) === 0)) return false;
        }
        return true;
      });
  }, [dre, collapsed, filtros.mostrarZeros, colunas]);

  const filtrosAtivos = useMemo(() => {
    let n = 0;
    if (filtros.viewMode !== "mensal") n++;
    const anoF = filtros.periodoInicio.slice(0, 4);
    if (filtros.periodoInicio !== `${anoF}-01` || filtros.periodoFim !== `${anoF}-12`) n++;
    if (filtros.mostrarZeros) n++;
    if ((filtros.crIds?.length ?? 0) > 0) n++;
    return n;
  }, [filtros]);

  function handleSetLevel(nivel: number | "all") {
    setActiveLevel(nivel);
    if (nivel === "all") {
      setCollapsed(new Set());
    } else {
      setCollapsed(new Set(dre.filter(d => d.tipo === "SUBTOTAL" && d.nivel >= nivel).map(d => d.id)));
    }
  }

  function toggleCollapse(id: string) {
    setActiveLevel("all");
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function aplicar()    { setFiltros(rascunho); setFilterOpen(false); }
  function limparTudo() { setRascunho(filtrosVazios); }

  function exportar() {
    const rows = visibleData.map(({ item }) => {
      const row: Record<string, string | number> = { Descrição: item.descricao, Tipo: item.tipo };
      colunas.forEach(c => { row[c.label] = c.result.valores.get(item.id) ?? 0; });
      row["Total"] = valoresTotal.valores.get(item.id) ?? 0;
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `DRE Forecast ${ano}`);
    XLSX.writeFile(wb, `DRE_Forecast_Gerencial_${ano}.xlsx`);
  }

  const anoAtivo    = filtros.periodoInicio.slice(0, 4);
  const viewMode    = filtros.viewMode;
  const mIni        = parseInt(filtros.periodoInicio.split("-")[1]) - 1;
  const mFim        = parseInt(filtros.periodoFim.split("-")[1]) - 1;
  const periodoLabel = mIni === 0 && mFim === 11
    ? anoAtivo
    : `${MESES[mIni]}–${MESES[mFim]} ${anoAtivo}`;

  void codes;

  return (
    <div>
      <PageHeader title="Demonstração de Resultado do Exercício" subtitle={`Forecast · ${anoAtivo}`} />

      <div className="p-6 space-y-4 min-w-max">

        {/* ── Controles ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">

          <select
            value={anoAtivo}
            onChange={e => {
              const y = e.target.value;
              setFiltros(f => ({ ...f, periodoInicio: `${y}-01`, periodoFim: `${y}-12` }));
              setRascunho(r => ({ ...r, periodoInicio: `${y}-01`, periodoFim: `${y}-12` }));
            }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {anosDisponiveis.map(y => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>

          {todosCenarios.length > 0 && (
            <div className="flex items-center gap-1.5">
              {(() => {
                const cor = todosCenarios.find(c => c.nome === filtros.cenarioNome)?.cor;
                return cor ? <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: cor }} /> : null;
              })()}
              <select
                value={filtros.cenarioNome}
                onChange={e => {
                  const v = e.target.value;
                  setFiltros(f => ({ ...f, cenarioNome: v }));
                  setRascunho(r => ({ ...r, cenarioNome: v }));
                }}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {todosCenarios.map(c => (
                  <option key={c.nome} value={c.nome}>{c.nome}</option>
                ))}
              </select>
            </div>
          )}

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

          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
            {Array.from({ length: maxNivel }, (_, i) => i + 1).map(n => (
              <button key={n} onClick={() => handleSetLevel(n)}
                className="px-3 py-2 text-xs font-semibold transition-colors"
                style={activeLevel === n ? { background: "#1e3a5f", color: "white" } : { background: "white", color: "#374151" }}>
                N{n}
              </button>
            ))}
            <button onClick={() => handleSetLevel("all")}
              className="px-3 py-2 text-xs font-semibold transition-colors border-l border-gray-200"
              style={activeLevel === "all" ? { background: "#1e3a5f", color: "white" } : { background: "white", color: "#374151" }}>
              Tudo
            </button>
          </div>

          <button onClick={exportar}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600 transition-colors ml-auto">
            <Download size={14} /> Exportar Excel
          </button>

          <span className="text-xs text-gray-400">
            Base: Forecast · {VIEW_LABELS[viewMode]} · {periodoLabel}
          </span>
        </div>

        {/* ── Tabela ────────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-semibold text-gray-800 text-sm">
              DRE Gerencial · Forecast ·{" "}
              <span className="font-normal text-gray-500">{VIEW_LABELS[viewMode]} · {periodoLabel}</span>
            </span>
          </div>

          <div>
            <table className="text-sm" style={{ minWidth: "max-content", width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
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
                    <th className="border-l border-white/10 sticky right-0 z-30" style={{ background: "#152d4a" }} />
                  </tr>
                )}
                <tr style={{ background: "#1e3a5f" }}>
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky left-0 z-30 min-w-[200px]"
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
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap min-w-[140px] border-l border-white/20 sticky right-0 z-30"
                    style={{ background: "#1e3a5f" }}>
                    Total
                  </th>
                </tr>
              </thead>

              <tbody>
                {visibleData.map(({ item }) => {
                  const s          = getRowStyle(item.tipo, item.nivel);
                  const isSubtotal = item.tipo === "SUBTOTAL";
                  const isCollapsed = isSubtotal && collapsed.has(item.id);
                  const total      = valoresTotal.valores.get(item.id) ?? 0;

                  return (
                    <tr key={item.id}
                      style={{ background: s.bg, color: s.color, fontWeight: s.fw }}
                      className="border-b border-gray-100">

                      <td className="px-4 py-2.5 sticky left-0 z-10" style={{ background: s.bg }}>
                        <span className="flex items-center gap-1" style={{ paddingLeft: `${(item.nivel - 1) * 16}px` }}>
                          {isSubtotal ? (
                            <button onClick={() => toggleCollapse(item.id)}
                              className="flex-shrink-0 rounded p-0.5 transition-colors"
                              style={{ color: s.dark ? "rgba(255,255,255,0.7)" : "#1e3a5f" }}>
                              {isCollapsed ? <ChevronRt size={13} /> : <ChevronDown size={13} />}
                            </button>
                          ) : <span className="w-4 flex-shrink-0" />}
                          <span className={`whitespace-nowrap${isSubtotal ? " uppercase" : ""}`}>{item.descricao}</span>
                        </span>
                      </td>

                      {colunas.map((c, ci) => {
                        const v = c.result.valores.get(item.id) ?? 0;
                        const sep = viewMode === "trimestral" && ci > 0;
                        return (
                          <td key={ci}
                            className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap${sep ? " border-l border-gray-100" : ""}`}>
                            {v !== 0
                              ? <span>{fmtInt(v)}</span>
                              : <span style={{ opacity: 0.18 }}>—</span>}
                          </td>
                        );
                      })}

                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-gray-100 sticky right-0 z-10"
                        style={{ fontWeight: isSubtotal ? "700" : "500", background: s.bg }}>
                        {total !== 0
                          ? <span>{fmtInt(total)}</span>
                          : <span style={{ opacity: 0.18 }}>—</span>}
                      </td>
                    </tr>
                  );
                })}

                {visibleData.length === 0 && (
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

              <div className="px-4 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Exibição</p>
                <label className="flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-gray-50 rounded text-sm text-gray-700">
                  <input type="checkbox" checked={rascunho.mostrarZeros}
                    onChange={e => setRascunho(r => ({ ...r, mostrarZeros: e.target.checked }))}
                    className="w-4 h-4 rounded cursor-pointer flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
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

