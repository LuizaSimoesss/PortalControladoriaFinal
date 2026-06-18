"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { ChevronDown, ChevronRight as ChevronRt, Filter, Download, Printer } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData, loadData, prefetchKeys, PREFETCH_ORCADO_KEYS } from "@/lib/storage";
import { buildHierarchy } from "@/lib/utils";
import { buildOrcamentoMap, getOrcamentoAnos, buildOrcamentoDebug, buildOrcamentoSemMapeamento, buildOrcamentoSemCRAtrib, buildEventosCalcDebug, buildGastosAtribDiag, type EventosCalcDebugEntry, type GastosAtribDiagEntry } from "@/lib/orcamentoData";
import { CentroResultadoRow } from "@/lib/mockData";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemTipo  = "SUBTOTAL" | "CONTA";
type ViewMode  = "mensal" | "trimestral" | "quadrimestral" | "semestral";

interface FormulaItem { subtotalId: string; sinal: "+" | "-" }
interface DemoItem {
  id: string; nivel: number; tipo: ItemTipo; descricao: string;
  formula?: FormulaItem[];
}

interface PeriodResult { valores: Map<string, number>; naoAlocado: number }
interface ColDRE       { label: string; sublabel?: string; result: PeriodResult }

interface Filtros {
  periodoInicio: string;
  periodoFim:    string;
  viewMode:      ViewMode;
  mostrarZeros:  boolean;
  crIds:         string[];
}

const _y = new Date().getFullYear();
const filtrosVazios: Filtros = { periodoInicio: `${_y}-01`, periodoFim: `${_y}-12`, viewMode: "mensal", mostrarZeros: false, crIds: [] };

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

function computePeriodFromOrcamento(
  dre: DemoItem[],
  orcMap: Map<string, Map<string, number>>,
  period: string
): PeriodResult {
  const valores = new Map<string, number>();

  // Carrega orcMap para todos os itens (CONTA e SUBTOTAL)
  for (const item of dre) {
    const v = orcMap.get(item.id)?.get(period);
    if (v !== undefined) valores.set(item.id, v);
  }

  // Propaga SUBTOTAL sem fórmula: soma filhos diretos sobre o valor já existente
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

  return { valores, naoAlocado: 0 };
}

const EMPTY_PERIOD: PeriodResult = { valores: new Map(), naoAlocado: 0 };

function aggregatePeriods(meses: number[], monthly: PeriodResult[], dre: DemoItem[]): PeriodResult {
  const valores = new Map<string, number>();
  for (const item of dre) {
    valores.set(item.id, meses.reduce((s, mi) => s + (monthly[mi].valores.get(item.id) ?? 0), 0));
  }
  return { valores, naoAlocado: 0 };
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

// ─── Capa de impressão ────────────────────────────────────────────────────────

function CoverPage({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <div style={{
      width: "100%", minHeight: 600, background: "#ffffff",
      display: "flex", flexDirection: "column",
      fontFamily: "'Manrope','Inter',-apple-system,sans-serif",
      color: "#1e3a5f",
    }}>
      <div style={{ padding: "36px 56px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/apex-logo.jpg" alt="Apex Partners" style={{ height: 44, objectFit: "contain", display: "block" }} />
        <span style={{ fontSize: 10, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Confidencial
        </span>
      </div>
      <div style={{ margin: "0 56px", height: 2, background: "#1e3a5f", borderRadius: 1 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", padding: "60px 56px" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, marginBottom: 24 }}>
          Apex Partners · Controladoria
        </div>
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1, color: "#1e3a5f", maxWidth: 580 }}>
          {titulo || "DRE Contábil · Orçado"}
        </div>
        {subtitulo && (
          <div style={{ fontSize: 15, color: "#475569", marginTop: 20, lineHeight: 1.6, maxWidth: 500, fontWeight: 500 }}>
            {subtitulo}
          </div>
        )}
        <div style={{ width: 48, height: 3, background: "#1e3a5f", marginTop: 36, borderRadius: 2 }} />
      </div>
      <div style={{ padding: "20px 56px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#cbd5e1", letterSpacing: "0.06em", textTransform: "uppercase" }}>Portal da Controladoria</span>
        <span style={{ fontSize: 10, color: "#94a3b8", letterSpacing: "0.06em" }}>{hoje}</span>
      </div>
    </div>
  );
}

// ─── Tabela de impressão (formato gerar relatórios) ───────────────────────────

interface ColPrint { label: string; result: { valores: Map<string, number> } }

function PrintableDRE({
  viewTab, visibleData, cols, valoresTotal, periodoLabel, anoAtivo,
}: {
  viewTab: "padrao" | "por_bu";
  visibleData: { item: DemoItem }[];
  cols: ColPrint[];
  valoresTotal: { valores: Map<string, number> };
  periodoLabel: string;
  anoAtivo: string;
}) {
  const subtitle = viewTab === "por_bu" ? `Por BU · Ano ${anoAtivo}` : `${periodoLabel}`;
  return (
    <div style={{ fontFamily: "Arial, sans-serif", fontSize: 10, background: "white", padding: "0 8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #1e3a5f", paddingBottom: 6, marginBottom: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/apex-logo.jpg" alt="Apex Partners" style={{ height: 28, objectFit: "contain" }} />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#1e3a5f" }}>DRE Contábil · Orçado</div>
          <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 8 }}>
        <thead>
          <tr style={{ background: "#1e3a5f" }}>
            <th style={{ padding: "4px 6px", textAlign: "left", color: "rgba(255,255,255,0.85)", fontWeight: 600, width: "22%", whiteSpace: "nowrap" }}>Descrição</th>
            {cols.map((c, i) => (
              <th key={i} style={{ padding: "4px 4px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontWeight: 600, whiteSpace: "nowrap" }}>{c.label}</th>
            ))}
            <th style={{ padding: "4px 6px", textAlign: "right", color: "rgba(255,255,255,0.85)", fontWeight: 700, borderLeft: "1px solid rgba(255,255,255,0.2)", whiteSpace: "nowrap" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {visibleData.map(({ item }) => {
            const s = getRowStyle(item.tipo, item.nivel);
            const isSub = item.tipo === "SUBTOTAL";
            const indent = (item.nivel - 1) * 8;
            const total = valoresTotal.valores.get(item.id) ?? 0;
            return (
              <tr key={item.id} style={{ background: s.bg, color: s.color, fontWeight: s.fw, borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                <td style={{ padding: "3px 6px", paddingLeft: 6 + indent }}>
                  <span style={{ textTransform: isSub ? "uppercase" : "none", whiteSpace: "nowrap" }}>{item.descricao}</span>
                </td>
                {cols.map((c, i) => {
                  const v = c.result.valores.get(item.id) ?? 0;
                  return (
                    <td key={i} style={{ padding: "3px 4px", textAlign: "right" }}>
                      {v !== 0 ? fmtInt(v) : <span style={{ opacity: 0.2 }}>—</span>}
                    </td>
                  );
                })}
                <td style={{ padding: "3px 6px", textAlign: "right", borderLeft: "1px solid rgba(0,0,0,0.08)", fontWeight: isSub ? "700" : "500", background: s.bg }}>
                  {total !== 0 ? fmtInt(total) : <span style={{ opacity: 0.2 }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 6, fontSize: 7, color: "#9ca3af", textAlign: "right" }}>
        Gerado em {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

// ─── Fallback DRE ─────────────────────────────────────────────────────────────

const dreInicial: DemoItem[] = [
  { id: "c1",  nivel: 1, tipo: "SUBTOTAL", descricao: "RECEITAS" },
  { id: "c2",  nivel: 2, tipo: "CONTA",    descricao: "Receitas de Vendas" },
  { id: "c3",  nivel: 2, tipo: "CONTA",    descricao: "Receitas de Serviços" },
  { id: "c4",  nivel: 1, tipo: "SUBTOTAL", descricao: "(-) DEDUÇÕES E IMPOSTOS" },
  { id: "c5",  nivel: 2, tipo: "CONTA",    descricao: "Impostos sobre Vendas" },
  { id: "c6",  nivel: 1, tipo: "SUBTOTAL", descricao: "(-) CUSTOS" },
  { id: "c7",  nivel: 2, tipo: "CONTA",    descricao: "Custo das Mercadorias" },
  { id: "c8",  nivel: 1, tipo: "SUBTOTAL", descricao: "(-) DESPESAS" },
  { id: "c9",  nivel: 2, tipo: "CONTA",    descricao: "Despesas Operacionais" },
  { id: "c10", nivel: 2, tipo: "CONTA",    descricao: "Despesas Administrativas" },
];

// ─── Página ───────────────────────────────────────────────────────────────────

export default function DreContabilOrcadaPage() {
  const [dre] = usePersistedData<DemoItem[]>("portal_dre_contabil", dreInicial);

  const [collapsed,   setCollapsed]  = useState<Set<string>>(new Set());
  const [activeLevel, setActiveLevel] = useState<number | "all">(1);
  const initialCollapseRef = useRef(false);

  const [filterOpen, setFilterOpen] = useState(false);
  const [filtros, setFiltros] = usePersistedData<Filtros>("portal_dre_contabil_filtros_orcado", filtrosVazios);
  const [rascunho, setRascunho] = useState<Filtros>(filtrosVazios);

  const [anosDisponiveis, setAnosDisponiveis] = useState<number[]>([new Date().getFullYear()]);
  const [orcVersion, setOrcVersion] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false);
  const [includeCover, setIncludeCover] = useState(true);
  const [coverModalOpen, setCoverModalOpen] = useState(false);
  const [coverTitulo, setCoverTitulo] = useState("DRE Contábil · Orçado");
  const [coverSubtitulo, setCoverSubtitulo] = useState("");

  const ano = parseInt(filtros.periodoInicio.slice(0, 4)) || new Date().getFullYear();
  const filtrosRef = useRef(filtros);
  filtrosRef.current = filtros;

  useEffect(() => {
    function corrigirAno() {
      const dreIds = new Set(loadData<{id: string}[]>("portal_dre_contabil", []).map(i => i.id));

      function matchCount(y: number): number {
        const m = buildOrcamentoMap("contabil", y, null);
        let n = 0;
        for (const id of m.keys()) if (dreIds.has(id)) n++;
        return n;
      }

      const anos = getOrcamentoAnos();
      setAnosDisponiveis(anos);

      const anoAtual = parseInt(filtrosRef.current.periodoInicio.slice(0, 4)) || new Date().getFullYear();
      if (matchCount(anoAtual) === 0) {
        const filtrosComp = loadData<{periodoInicio?: string}>("portal_dre_contabil_filtros_comparativo", {});
        const anoComp = parseInt((filtrosComp.periodoInicio ?? "").slice(0, 4));
        const candidatos = new Set([...anos, ...(anoComp > 0 ? [anoComp] : [])]);
        const melhor = [...candidatos]
          .map(y => ({ y, n: matchCount(y) }))
          .filter(x => x.n > 0)
          .sort((a, b) => b.n - a.n)[0];
        if (melhor) {
          const y = melhor.y;
          setAnosDisponiveis(prev => prev.includes(y) ? prev : [...prev, y].sort((a, b) => b - a));
          setFiltros(f => ({ ...f, periodoInicio: `${y}-01`, periodoFim: `${y}-12` }));
          setRascunho(r => ({ ...r, periodoInicio: `${y}-01`, periodoFim: `${y}-12` }));
        }
      }
    }
    corrigirAno();
    setMounted(true);
    prefetchKeys(PREFETCH_ORCADO_KEYS);
    // Ensure portal_dre is in cache so buildGerToContabMap() works for the cross-reference
    prefetchKeys(["portal_dre", "portal_dre_contabil"]);

    function onUpdate(e: Event) {
      const key = (e as CustomEvent<{ key: string }>).detail?.key ?? "";
      if (key.startsWith("portal_orcamento_") || key === "portal_dre" || key === "portal_dre_contabil") {
        setOrcVersion(v => v + 1);
        corrigirAno();
      }
    }
    window.addEventListener("portal-data-update", onUpdate);
    return () => window.removeEventListener("portal-data-update", onUpdate);
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

  const orcMap = useMemo(() => {
    const m = buildOrcamentoMap("contabil", ano, crFiltroSet);
    const matched = dre.filter(i => m.has(i.id));
    const unmatched = dre.filter(i => i.tipo === "CONTA" && !m.has(i.id));
    console.log("[ORCADO-DEBUG] orcMap size:", m.size, "ano:", ano, "matched DRE items:", matched.length, "/", dre.length);
    if (unmatched.length > 0) console.log("[ORCADO-DEBUG] DRE CONTA sem orçamento:", unmatched.map(i => i.descricao));
    return m;
  }, [ano, crFiltroSet, orcVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (initialCollapseRef.current || dre.length === 0) return;
    initialCollapseRef.current = true;
    setCollapsed(new Set(dre.filter(d => d.tipo === "SUBTOTAL").map(d => d.id)));
  }, [dre]); // eslint-disable-line react-hooks/exhaustive-deps

  const valoresPorMes = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    const anoFiltro = periodoInicio.slice(0, 4);
    return MESES.map((_, mi) => {
      const p = `${anoFiltro}-${String(mi + 1).padStart(2, "0")}`;
      if (p < periodoInicio || p > periodoFim) return EMPTY_PERIOD;
      return computePeriodFromOrcamento(dre, orcMap, p);
    });
  }, [dre, orcMap, filtros]);

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

  const [viewTab, setViewTab] = useState<"padrao" | "por_bu">("padrao");

  const buColumns = useMemo(() => {
    if (viewTab !== "por_bu") return [];
    const allCrs = loadData<CentroResultadoRow[]>("portal_centro_resultado", [])
      .sort((a, b) => a.CODCENCUS.localeCompare(b.CODCENCUS, undefined, { numeric: true, sensitivity: "base" }));
    const crMapById = new Map(allCrs.map(cr => [cr.CODCENCUS, cr]));
    const hasPaiData = allCrs.some(cr => !!cr.CODCENCUSPAI);
    const withHierarchyBU = hasPaiData ? null : buildHierarchy(allCrs, "DESCRCENCUS");
    const buList = allCrs.filter(r => r.GRAU === 1 && r.ATIVO && (r.ENTRA_RESULTADO === "DRE" || r.ENTRA_RESULTADO === "AMBOS"));
    return buList.map(bu => {
      const crSet = new Set<string>();
      if (hasPaiData) {
        for (const cr of allCrs) {
          let cur: typeof cr | undefined = cr;
          while (cur && cur.GRAU > 1 && cur.CODCENCUSPAI) cur = crMapById.get(cur.CODCENCUSPAI);
          if (cur && cur.CODCENCUS === bu.CODCENCUS) crSet.add(cr.CODCENCUS);
        }
      } else {
        for (const cr of withHierarchyBU!) {
          const grau1 = cr.GRAU_1 as string | undefined;
          if (cr.CODCENCUS === bu.CODCENCUS || grau1 === bu.DESCRCENCUS) crSet.add(cr.CODCENCUS);
        }
      }
      const buMap = buildOrcamentoMap("contabil", ano, crSet);
      const monthly = MESES.map((_, mi) =>
        computePeriodFromOrcamento(dre, buMap, `${ano}-${String(mi + 1).padStart(2, "0")}`)
      );
      return { bu, result: aggregatePeriods([0,1,2,3,4,5,6,7,8,9,10,11], monthly, dre) };
    });
  }, [viewTab, ano, dre, orcVersion]); // eslint-disable-line react-hooks/exhaustive-deps

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
          if (viewTab === "por_bu") {
            if (buColumns.length > 0 && buColumns.every(c => (c.result.valores.get(item.id) ?? 0) === 0)) return false;
          } else {
            if (colunas.every(c => (c.result.valores.get(item.id) ?? 0) === 0)) return false;
          }
        }
        return true;
      });
  }, [dre, collapsed, filtros.mostrarZeros, colunas, viewTab, buColumns]);

  const activeBuColumns = useMemo(() =>
    buColumns.filter(col =>
      visibleData.some(({ item }) => (col.result.valores.get(item.id) ?? 0) !== 0)
    ),
  [buColumns, visibleData]);

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

  function gerarPdf(withCover: boolean) {
    setPdfMenuOpen(false);
    setIncludeCover(withCover);
    // aguarda o React re-renderizar a área de impressão antes de imprimir
    setTimeout(() => {
    const styleId = "dre-print-style";
    const existing = document.getElementById(styleId);
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #dre-print-area { visibility: visible !important; display: block !important; }
        #dre-print-area * { visibility: visible !important; }
        #dre-print-area { position: absolute; left: 0; top: 0; width: 100%; background: white; }
        #dre-print-area table { width: 100%; table-layout: auto; }
        #dre-print-area .dre-cover-break { page-break-after: always; break-after: page; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @page { margin: 0.8cm; size: A4 landscape; }
      }
    `;
    document.head.appendChild(style);
    window.print();
    setTimeout(() => { const el = document.getElementById(styleId); if (el) el.remove(); }, 1000);
    }, 50);
  }

  function exportar() {
    const rows = visibleData.map(({ item }) => {
      const row: Record<string, string | number> = { Descrição: item.descricao, Tipo: item.tipo };
      colunas.forEach(c => { row[c.label] = c.result.valores.get(item.id) ?? 0; });
      row["Total"] = valoresTotal.valores.get(item.id) ?? 0;
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `DRE Contábil Orçado ${ano}`);
    XLSX.writeFile(wb, `DRE_Contabil_Orcado_${ano}.xlsx`);
  }

  function exportarBU() {
    const cols = activeBuColumns;
    const rows = visibleData.map(({ item }) => {
      const row: Record<string, string | number> = { Descrição: item.descricao, Tipo: item.tipo };
      cols.forEach(c => { row[c.bu.DESCRCENCUS] = c.result.valores.get(item.id) ?? 0; });
      row["Total Geral"] = valoresTotal.valores.get(item.id) ?? 0;
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `DRE Por BU ${ano}`);
    XLSX.writeFile(wb, `DRE_Contabil_Orcado_PorBU_${ano}.xlsx`);
  }

  const anoAtivo     = filtros.periodoInicio.slice(0, 4);
  const viewMode     = filtros.viewMode;
  const mIni         = parseInt(filtros.periodoInicio.split("-")[1]) - 1;
  const mFim         = parseInt(filtros.periodoFim.split("-")[1]) - 1;
  const periodoLabel = mIni === 0 && mFim === 11
    ? anoAtivo
    : `${MESES[mIni]}–${MESES[mFim]} ${anoAtivo}`;

  void codes;

  const [buDebugOpen, setBuDebugOpen] = useState(false);
  const [eventosDebugOpen, setEventosDebugOpen] = useState(false);
  const [gastosAtribOpen, setGastosAtribOpen] = useState(false);
  // Debug de eventos: usa todos os CODCENCUS como filtro (testa se a fórmula resolve)
  // e também testa cada BU individualmente para ver em qual coluna o CR cai
  const eventosDebug = useMemo(() => {
    if (viewTab !== "por_bu") return null;
    const allCrs = loadData<CentroResultadoRow[]>("portal_centro_resultado", [])
      .sort((a, b) => a.CODCENCUS.localeCompare(b.CODCENCUS, undefined, { numeric: true, sensitivity: "base" }));
    const allCods = new Set(allCrs.map(r => r.CODCENCUS));
    // Base: com todos os CRs no filtro → mostra se a fórmula resolve
    const base = buildEventosCalcDebug(ano, allCods);
    // Resultado por BU: para cada linha, em qual BU coluna o CR cai
    const hasPaiEvt = allCrs.some(r => !!r.CODCENCUSPAI);
    const crMapEvt  = new Map(allCrs.map(r => [r.CODCENCUS, r]));
    const withHierarchyEvt = hasPaiEvt ? null : buildHierarchy(allCrs, "DESCRCENCUS");
    const buCrSets = buColumns.map(col => ({
      buLabel: col.bu.DESCRCENCUS,
      buCod:   col.bu.CODCENCUS,
      crSet:   (() => {
        const set = new Set<string>();
        if (hasPaiEvt) {
          for (const cr of allCrs) {
            let cur: typeof cr | undefined = cr;
            while (cur && cur.GRAU > 1 && cur.CODCENCUSPAI) cur = crMapEvt.get(cur.CODCENCUSPAI);
            if (cur && cur.CODCENCUS === col.bu.CODCENCUS) set.add(cr.CODCENCUS);
          }
        } else {
          for (const cr of withHierarchyEvt!) {
            const grau1 = cr.GRAU_1 as string | undefined;
            if (cr.CODCENCUS === col.bu.CODCENCUS || grau1 === col.bu.DESCRCENCUS) set.add(cr.CODCENCUS);
          }
        }
        return set;
      })(),
    }));
    return { base, buCrSets };
  }, [viewTab, buColumns, ano]);

  // Diagnóstico de atribuição de gastos com composição → mostra onde o dinheiro "some"
  const gastosAtribDiag = useMemo((): GastosAtribDiagEntry[] => {
    if (viewTab !== "por_bu" || buColumns.length === 0) return [];
    const allCrs = loadData<CentroResultadoRow[]>("portal_centro_resultado", [])
      .sort((a, b) => a.CODCENCUS.localeCompare(b.CODCENCUS, undefined, { numeric: true, sensitivity: "base" }));
    const crMapByCod = new Map(allCrs.map(r => [r.CODCENCUS, r]));
    const hasPai = allCrs.some(r => !!r.CODCENCUSPAI);
    const withHierarchyDiag = hasPai ? null : buildHierarchy(allCrs, "DESCRCENCUS");
    const buCrSetsMap = new Map<string, Set<string>>();
    for (const col of buColumns) {
      const set = new Set<string>();
      if (hasPai) {
        for (const cr of allCrs) {
          let cur: typeof cr | undefined = cr;
          while (cur && cur.GRAU > 1 && cur.CODCENCUSPAI) cur = crMapByCod.get(cur.CODCENCUSPAI);
          if (cur && cur.CODCENCUS === col.bu.CODCENCUS) set.add(cr.CODCENCUS);
        }
      } else {
        for (const cr of withHierarchyDiag!) {
          const grau1 = cr.GRAU_1 as string | undefined;
          if (cr.CODCENCUS === col.bu.CODCENCUS || grau1 === col.bu.DESCRCENCUS) set.add(cr.CODCENCUS);
        }
      }
      buCrSetsMap.set(col.bu.CODCENCUS, set);
    }
    return buildGastosAtribDiag("contabil", ano, buCrSetsMap);
  }, [viewTab, buColumns, ano]);

  const buDebugInfo = useMemo(() => {
    if (buColumns.length === 0) return null;

    // Soma de todas as BUs por item DRE
    const somaBUsMap = new Map<string, number>();
    for (const col of buColumns) {
      for (const item of dre) {
        somaBUsMap.set(item.id, (somaBUsMap.get(item.id) ?? 0) + (col.result.valores.get(item.id) ?? 0));
      }
    }

    // Diferença: Total Geral - Soma BUs
    const gaps = dre
      .filter(item => {
        const totalG = valoresTotal.valores.get(item.id) ?? 0;
        const soma   = somaBUsMap.get(item.id) ?? 0;
        return Math.abs(totalG - soma) > 0.5 && totalG !== 0;
      })
      .map(item => ({
        item,
        totalGeral: valoresTotal.valores.get(item.id) ?? 0,
        somaBUs:    somaBUsMap.get(item.id) ?? 0,
        diff:       (valoresTotal.valores.get(item.id) ?? 0) - (somaBUsMap.get(item.id) ?? 0),
      }));

    // Linhas calculadas do orçamento que têm valor (excluídas quando CR filter ativo)
    const allDebug = buildOrcamentoDebug("contabil", ano);
    const calculadoLines = allDebug.filter(e => e.tipo === "calculado");

    // Total global de linhas calculadas por item DRE
    const calculadoPorItem = new Map<string, typeof calculadoLines>();
    for (const e of calculadoLines) {
      const arr = calculadoPorItem.get(e.itemId) ?? [];
      arr.push(e);
      calculadoPorItem.set(e.itemId, arr);
    }

    const totalCalculado = calculadoLines.reduce((s, e) => s + e.totalAno, 0);
    const totalGap       = gaps.filter(g => g.item.tipo === "CONTA").reduce((s, g) => s + g.diff, 0);

    return { gaps, calculadoLines, calculadoPorItem, totalCalculado, totalGap, somaBUsMap };
  }, [buColumns, dre, valoresTotal, ano]);

  const [debugOpen, setDebugOpen] = useState(false);
  const debugInfo = useMemo(() => {
    const contasSemDado = dre.filter(i => i.tipo === "CONTA" && !orcMap.get(i.id)?.size);
    const orcMapOrfaos  = [...orcMap.keys()].filter(id => !dre.some(i => i.id === id));
    const contasComDado = dre.filter(i => i.tipo === "CONTA" && (orcMap.get(i.id)?.size ?? 0) > 0);
    const detalhes      = buildOrcamentoDebug("contabil", ano);
    const porItem = new Map<string, typeof detalhes>();
    for (const e of detalhes) {
      const arr = porItem.get(e.itemId) ?? [];
      arr.push(e);
      porItem.set(e.itemId, arr);
    }
    const orfaosDetalhados = orcMapOrfaos.map(id => ({
      id,
      areas: porItem.get(id) ?? [],
      total: [...(orcMap.get(id)?.values() ?? [])].reduce((a, b) => a + b, 0),
    }));
    const semMapeamento = buildOrcamentoSemMapeamento("contabil", ano);
    const semCRAtrib    = buildOrcamentoSemCRAtrib("contabil", ano);
    return { contasSemDado, orcMapOrfaos, contasComDado, porItem, orfaosDetalhados, semMapeamento, semCRAtrib, orcMapTotal: orcMap.size, dreContaTotal: dre.filter(i => i.tipo === "CONTA").length };
  }, [dre, orcMap, ano]);

  return (
    <div>
      <PageHeader title="Demonstração de Resultado Contábil" subtitle={`Orçado · ${anoAtivo}`} />

      <div className="p-6 space-y-4 min-w-max">

        <div className="flex items-center gap-3 flex-wrap">

          {/* Seletor de ano */}
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

          {/* Níveis */}
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

          {/* View Tab */}
          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setViewTab("padrao")}
              className="px-3 py-2 text-xs font-semibold transition-colors"
              style={viewTab === "padrao" ? { background: "#1e3a5f", color: "white" } : { background: "white", color: "#374151" }}>
              Padrão
            </button>
            <button onClick={() => setViewTab("por_bu")}
              className="px-3 py-2 text-xs font-semibold transition-colors border-l border-gray-200"
              style={viewTab === "por_bu" ? { background: "#1e3a5f", color: "white" } : { background: "white", color: "#374151" }}>
              Por BU
            </button>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {viewTab === "padrao" ? (
              <button onClick={exportar}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600 transition-colors">
                <Download size={14} /> Exportar Excel
              </button>
            ) : (
              <button onClick={exportarBU}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600 transition-colors">
                <Download size={14} /> Exportar Por BU
              </button>
            )}
            <div className="relative">
              <button onClick={() => setPdfMenuOpen(v => !v)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600 transition-colors">
                <Printer size={14} /> PDF <ChevronDown size={12} />
              </button>
              {pdfMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPdfMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                    <button onClick={() => { setPdfMenuOpen(false); setCoverModalOpen(true); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                      <Printer size={13} /> Com capa
                    </button>
                    <button onClick={() => gerarPdf(false)}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                      <Printer size={13} /> Sem capa
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <span className="text-xs text-gray-400">
            Base: Orçamento · {VIEW_LABELS[viewMode]} · {periodoLabel}
          </span>
        </div>

        {/* Área de impressão — oculta na tela, visível no PDF */}
        <div id="dre-print-area" style={{ display: "none" }}>
          {includeCover && (
            <div className="dre-cover-break">
              <CoverPage titulo={coverTitulo} subtitulo={coverSubtitulo} />
            </div>
          )}
          <PrintableDRE
            viewTab={viewTab}
            visibleData={visibleData}
            cols={
              viewTab === "por_bu"
                ? activeBuColumns.map(b => ({ label: b.bu.DESCRCENCUS, result: b.result }))
                : colunas.map(c => ({ label: c.label, result: c.result }))
            }
            valoresTotal={valoresTotal}
            periodoLabel={periodoLabel}
            anoAtivo={anoAtivo}
          />
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-gray-800 text-sm">
                DRE Contábil · Orçado ·{" "}
                {viewTab === "padrao"
                  ? <span className="font-normal text-gray-500">{VIEW_LABELS[viewMode]} · {periodoLabel}</span>
                  : <span className="font-normal text-gray-500">Por BU · Ano {anoAtivo}</span>}
              </span>
            </div>

            {viewTab === "padrao" ? (
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

                <tbody suppressHydrationWarning>
                  {mounted && visibleData.map(({ item }) => {
                    const s           = getRowStyle(item.tipo, item.nivel);
                    const isSubtotal  = item.tipo === "SUBTOTAL";
                    const isCollapsed = isSubtotal && collapsed.has(item.id);
                    const total       = valoresTotal.valores.get(item.id) ?? 0;

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

                  {mounted && visibleData.length === 0 && (
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
            ) : (
            /* ── Por BU ─────────────────────────────────────────────────────── */
            <div>
              {buColumns.length === 0 ? (
                <p className="px-6 py-12 text-center text-gray-400 text-sm">Nenhum Centro de Resultado ativo encontrado.</p>
              ) : (
              <table className="text-sm" style={{ minWidth: "max-content", width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr style={{ background: "#1e3a5f" }}>
                    <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky left-0 z-30 min-w-[240px]"
                      style={{ background: "#1e3a5f" }}>
                      Descrição
                    </th>
                    {activeBuColumns.map((col, ci) => (
                      <th key={ci}
                        className="font-semibold text-white/80 text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap min-w-[150px] border-l border-white/10"
                        style={{ background: "#1e3a5f" }}>
                        <div className="font-semibold text-xs max-w-[140px] truncate">{col.bu.DESCRCENCUS}</div>
                      </th>
                    ))}
                    <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap min-w-[150px] border-l border-white/20 sticky right-0 z-30"
                      style={{ background: "#1e3a5f" }}>
                      Total Geral
                    </th>
                  </tr>
                </thead>
                <tbody suppressHydrationWarning>
                  {mounted && visibleData.map(({ item }) => {
                    const s          = getRowStyle(item.tipo, item.nivel);
                    const isSubtotal = item.tipo === "SUBTOTAL";
                    const isCollapsed = isSubtotal && collapsed.has(item.id);
                    const totalGeral = valoresTotal.valores.get(item.id) ?? 0;

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

                        {activeBuColumns.map((col, ci) => {
                          const v = col.result.valores.get(item.id) ?? 0;
                          return (
                            <td key={ci} className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-gray-100">
                              {v !== 0
                                ? <span>{fmtInt(v)}</span>
                                : <span style={{ opacity: 0.18 }}>—</span>}
                            </td>
                          );
                        })}

                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-gray-100 sticky right-0 z-10"
                          style={{ fontWeight: isSubtotal ? "700" : "500", background: s.bg }}>
                          {totalGeral !== 0
                            ? <span>{fmtInt(totalGeral)}</span>
                            : <span style={{ opacity: 0.18 }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}

                  {mounted && visibleData.length === 0 && (
                    <tr>
                      <td colSpan={2 + activeBuColumns.length} className="px-4 py-12 text-center text-gray-400 text-sm">
                        Nenhuma linha com valor.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              )}
            </div>
            )}
          </div>
      </div>


      {/* ── Modal de capa PDF ─────────────────────────────────────────────────── */}
      {coverModalOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setCoverModalOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl pointer-events-auto flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <span className="font-semibold text-gray-800">Configurar capa do PDF</span>
                <button onClick={() => setCoverModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
              <div className="flex gap-6 p-6 overflow-auto flex-1">
                {/* Inputs */}
                <div className="flex flex-col gap-4 flex-1 min-w-[200px]">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Título</label>
                    <input
                      type="text"
                      value={coverTitulo}
                      onChange={e => setCoverTitulo(e.target.value)}
                      placeholder="DRE Contábil · Orçado"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Subtítulo</label>
                    <input
                      type="text"
                      value={coverSubtitulo}
                      onChange={e => setCoverSubtitulo(e.target.value)}
                      placeholder={`${periodoLabel} · ${anoAtivo}`}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                {/* Preview */}
                <div className="flex-shrink-0">
                  <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Prévia</p>
                  <div style={{ width: 280, height: 188, borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0", boxShadow: "0 2px 12px rgba(0,0,0,0.10)" }}>
                    <div style={{ transform: "scale(0.314)", transformOrigin: "top left", width: 892, height: 600, pointerEvents: "none" }}>
                      <CoverPage titulo={coverTitulo} subtitulo={coverSubtitulo} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
                <button onClick={() => setCoverModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                  Cancelar
                </button>
                <button onClick={() => { setCoverModalOpen(false); gerarPdf(true); }}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                  style={{ background: "#1e3a5f" }}>
                  <Printer size={14} /> Gerar PDF
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
