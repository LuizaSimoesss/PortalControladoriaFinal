"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { ChevronDown, ChevronRight as ChevronRt, Filter, Download } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData, loadData } from "@/lib/storage";
import { buildHierarchy } from "@/lib/utils";
import { idbGet } from "@/lib/idb";
import type { LancamentoFinanceiro, Fechamento, NaturezaRow, CentroResultadoRow, EmpresaRow, ParceiroRow, ProjetoRow } from "@/lib/mockData";

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
interface ColDRE       { label: string; sublabel?: string; result: PeriodResult }

interface Filtros {
  periodoInicio: string;  // "YYYY-MM"
  periodoFim:    string;  // "YYYY-MM"
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
  const counters = [0,0,0,0,0];
  let prev = 0;
  return items.map(item => {
    const n = item.nivel;
    if (n > prev + 1) for (let i = prev + 1; i < n; i++) if (!counters[i]) counters[i] = 1;
    counters[n]++;
    for (let i = n + 1; i <= 4; i++) counters[i] = 0;
    const parts: number[] = [];
    for (let i = 1; i <= n; i++) parts.push(counters[i]);
    prev = n;
    return parts.join(".");
  });
}

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
  // intervalo: compara numericamente se possível, lexicograficamente senão
  const n = +cod;
  const isNum = !isNaN(n);
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

  // Passo 2: SUBTOTAIs sem fórmula — soma filhos diretos, de baixo para cima
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

  // Passo 3: SUBTOTAIs com fórmula — referenciam outros SUBTOTAIs já calculados acima
  for (const item of dre) {
    if (item.tipo !== "SUBTOTAL" || !Array.isArray(item.formula)) continue;
    valores.set(item.id, item.formula.reduce(
      (s, fi) => s + (fi.sinal === "+" ? 1 : -1) * (valores.get(fi.subtotalId) ?? 0), 0
    ));
  }

  return { valores, naoAlocado: lans.reduce((s, l, i) => alocados.has(i) ? s : s + l.valor, 0) };
}

const EMPTY_PERIOD: PeriodResult = { valores: new Map(), naoAlocado: 0 };

// Retorna os lançamentos que NÃO foram capturados por nenhuma regra CONTA da DRE
function computeUnallocated(dre: DemoItem[], lans: LancamentoFinanceiro[]): LancamentoFinanceiro[] {
  const alocados = new Set<number>();
  for (const item of dre) {
    if (item.tipo !== "CONTA") continue;
    const hasNat = hasEffectiveRule(item.regras?.natureza);
    const hasCr  = hasEffectiveRule(item.regras?.centroResultado);
    if (!hasNat && !hasCr) continue;
    for (let i = 0; i < lans.length; i++) {
      const l = lans[i];
      if ((!hasNat || matchesRegra(l.codnat, item.regras?.natureza)) &&
          (!hasCr  || matchesRegra(l.codcencus, item.regras?.centroResultado)))
        alocados.add(i);
    }
  }
  return lans.filter((_, i) => !alocados.has(i));
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

function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function fmtPeriodo(p: string) {
  const [y, m] = p.split("-");
  return `${MESES[parseInt(m) - 1]}/${y}`;
}

function getContasForItem(item: DemoItem, dre: DemoItem[]): DemoItem[] {
  if (item.tipo === "CONTA") return [item];
  const idx = dre.findIndex(d => d.id === item.id);
  const contas: DemoItem[] = [];
  for (let i = idx + 1; i < dre.length; i++) {
    if (dre[i].nivel <= item.nivel) break;
    if (dre[i].tipo === "CONTA") contas.push(dre[i]);
  }
  return contas;
}

function getLancamentosForItem(item: DemoItem, dre: DemoItem[], lans: LancamentoFinanceiro[]): LancamentoFinanceiro[] {
  const contas = getContasForItem(item, dre);
  if (contas.length === 0) return [];
  return lans.filter(l =>
    contas.some(conta => {
      const hasNat = hasEffectiveRule(conta.regras?.natureza);
      const hasCr  = hasEffectiveRule(conta.regras?.centroResultado);
      if (!hasNat && !hasCr) return false;
      return (!hasNat || matchesRegra(l.codnat, conta.regras?.natureza)) &&
             (!hasCr  || matchesRegra(l.codcencus, conta.regras?.centroResultado));
    })
  );
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

export default function DreRealizadaPage() {
  const [dre]        = usePersistedData<DemoItem[]>("portal_dre", []);
  const [fechamentos] = usePersistedData<Fechamento[]>("portal_fechamentos", []);

  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([]);
  const [dataLoaded, setDataLoaded]   = useState(false);

  const [fechamentoId, setFechamentoId] = useState<string>("__ativo__");
  const [collapsed,    setCollapsed]    = useState<Set<string>>(new Set());
  const [activeLevel,  setActiveLevel]  = useState<number | "all">(1);
  const initialCollapseRef = useRef(false);

  const [filterOpen, setFilterOpen] = useState(false);
  const [filtros,    setFiltros]    = usePersistedData<Filtros>("portal_dre_filtros_realizada", filtrosVazios);
  const [rascunho,   setRascunho]   = useState<Filtros>(filtrosVazios);

  const [detalhe, setDetalhe] = useState<{ item: DemoItem; lans: LancamentoFinanceiro[] } | null>(null);
  const [periodosSel, setPeriodosSel] = useState<Set<string>>(new Set());

  const [diagNufin, setDiagNufin] = useState("");
  const [diagResultado, setDiagResultado] = useState<{ motivo: string; detalhe: string; tipo: "ok" | "erro" | "aviso" } | null>(null);

  type SortKey = "nufin" | "data" | "historico" | "codnat" | "codcencus" | "codemp" | "codproj" | "codparc" | "valor";
  const [sortKey, setSortKey] = useState<SortKey>("data");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const natMap  = useMemo(() => new Map(loadData<NaturezaRow[]>("portal_natureza", []).map(r => [r.CODNAT, r.DESCRNAT])), []);
  const crMap   = useMemo(() => new Map(loadData<CentroResultadoRow[]>("portal_centro_resultado", []).map(r => [r.CODCENCUS, r.DESCRCENCUS])), []);

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

  // Códigos que NÃO devem entrar na DRE conforme cadastro
  const crExcluidos  = useMemo(() => new Set(
    loadData<CentroResultadoRow[]>("portal_centro_resultado", [])
      .filter(r => r.ENTRA_RESULTADO !== "DRE" && r.ENTRA_RESULTADO !== "AMBOS")
      .map(r => r.CODCENCUS)
  ), []);
  const natExcluidas = useMemo(() => new Set(
    loadData<NaturezaRow[]>("portal_natureza", [])
      .filter(r => r.ENTRA_RESULTADO !== "DRE" && r.ENTRA_RESULTADO !== "AMBOS")
      .map(r => r.CODNAT)
  ), []);
  const empExcluidas = useMemo(() => new Set(
    loadData<EmpresaRow[]>("portal_empresas", [])
      .filter(r => r.ENTRA_RESULTADO !== "DRE" && r.ENTRA_RESULTADO !== "AMBOS")
      .map(r => r.CODEMP)
  ), []);
  const empMap  = useMemo(() => new Map(loadData<EmpresaRow[]>("portal_empresas", []).map(r => [r.CODEMP, r.RAZAOSOCIAL])), []);
  const parcMap = useMemo(() => new Map(loadData<ParceiroRow[]>("portal_parceiro", []).map(r => [r.CODPARC, r.NOMEPARC])), []);
  const projMap = useMemo(() => new Map(loadData<ProjetoRow[]>("portal_projetos", []).map(r => [r.CODPROJ, r.IDENTIFICACAO])), []);

  // Inicializa seleção de períodos e reset de sort ao abrir um item
  useEffect(() => {
    if (!detalhe) return;
    setPeriodosSel(new Set(detalhe.lans.map(l => l.periodo)));
    setSortKey("data");
    setSortDir("asc");
  }, [detalhe?.item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const detalhePeriodos = useMemo(() =>
    detalhe ? [...new Set(detalhe.lans.map(l => l.periodo))].sort() : [],
    [detalhe]
  );

  const detalheGrupos = useMemo(() => {
    if (!detalhe) return [];
    const sorted = [...detalhe.lans]
      .filter(l => periodosSel.has(l.periodo))
      .sort((a, b) => a.periodo.localeCompare(b.periodo) || a.data.localeCompare(b.data));
    const grupos: { periodo: string; lans: LancamentoFinanceiro[] }[] = [];
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

  const detalheLansOrdenados = useMemo(() => {
    const flat = detalheGrupos.flatMap(g => g.lans);
    return [...flat].sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sortKey) {
        case "nufin":     av = a.nufin    ?? ""; bv = b.nufin    ?? ""; break;
        case "data":      av = a.data;           bv = b.data;           break;
        case "historico": av = a.historico ?? ""; bv = b.historico ?? ""; break;
        case "codnat":    av = a.codnat;          bv = b.codnat;          break;
        case "codcencus": av = a.codcencus;       bv = b.codcencus;       break;
        case "codemp":    av = a.codemp;          bv = b.codemp;          break;
        case "codproj":   av = a.codproj ?? "";   bv = b.codproj ?? "";   break;
        case "codparc":   av = a.codparc ?? "";   bv = b.codparc ?? "";   break;
        case "valor":     av = a.valor;           bv = b.valor;           break;
        default:          return 0;
      }
      const cmp = typeof av === "number" ? av - (bv as number) : (av as string).localeCompare(bv as string);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [detalheGrupos, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function exportarDetalhe() {
    if (!detalhe) return;
    const rows = detalheGrupos.flatMap(g =>
      g.lans.map(l => ({
        NUFIN:               l.nufin ?? "",
        Data:                fmtDate(l.data),
        Histórico:           l.historico ?? "",
        Período:             fmtPeriodo(l.periodo),
        Natureza:            `${l.codnat} ${natMap.get(l.codnat) ?? ""}`.trim(),
        "Centro de Resultado": `${l.codcencus} ${crMap.get(l.codcencus) ?? ""}`.trim(),
        Empresa:             `${l.codemp} ${empMap.get(l.codemp) ?? ""}`.trim(),
        Projeto:             l.codproj ? `${l.codproj} ${projMap.get(l.codproj) ?? ""}`.trim() : "",
        Parceiro:            l.codparc ? `${l.codparc} ${parcMap.get(l.codparc) ?? ""}`.trim() : "",
        Valor:               l.valor,
      }))
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, detalhe.item.descricao.slice(0, 31));
    XLSX.writeFile(wb, `DRE_${detalhe.item.descricao.replace(/[/\\?*[\]]/g, "_")}.xlsx`);
  }

  useEffect(() => {
    const fb = setTimeout(() => setDataLoaded(true), 400);
    idbGet<LancamentoFinanceiro[]>("portal_lancamentos_financeiro", []).then(data => {
      clearTimeout(fb); setLancamentos(data); setDataLoaded(true);
    });
  }, []);

  const fechamentosRealizado = useMemo(
    () => fechamentos.filter(f => f.tipo === "realizado").sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)),
    [fechamentos]
  );

  const fechamentoAtivo = useMemo(
    () => fechamentos.find(f => f.tipo === "realizado" && f.ativo) ?? null,
    [fechamentos]
  );

  const fechamentoVisual = useMemo(() => {
    if (fechamentoId === "__ativo__") return fechamentoAtivo;
    return fechamentos.find(f => f.id === fechamentoId) ?? fechamentoAtivo;
  }, [fechamentoId, fechamentos, fechamentoAtivo]);

  const anosDisponiveis = useMemo(() => {
    const set = new Set<number>();
    lancamentos.filter(l => l.tipo === "realizado").forEach(l => {
      const y = parseInt(l.periodo.split("-")[0]);
      if (!isNaN(y)) set.add(y);
    });
    return [...set].sort((a, b) => b - a);
  }, [lancamentos]);

  useEffect(() => {
    if (anosDisponiveis.length > 0) {
      const anoAtual = parseInt(filtros.periodoInicio.split("-")[0]);
      if (!anosDisponiveis.includes(anoAtual)) {
        const y = anosDisponiveis[0];
        setFiltros(f => ({ ...f, periodoInicio: `${y}-01`, periodoFim: `${y}-12` }));
        setRascunho(r => ({ ...r, periodoInicio: `${y}-01`, periodoFim: `${y}-12` }));
      }
    }
  }, [anosDisponiveis]); // eslint-disable-line react-hooks/exhaustive-deps

  const lancamentosBase = useMemo(() => {
    if (!dataLoaded) return [];
    return lancamentos.filter(l => {
      if (l.tipo !== "realizado") return false;
      if (fechamentoVisual && l.fechamentoId !== fechamentoVisual.id) return false;
      if (crExcluidos.has(l.codcencus)) return false;
      if (natExcluidas.has(l.codnat)) return false;
      if (empExcluidas.has(l.codemp)) return false;
      if (crFiltroSet && (!l.codcencus || !crFiltroSet.has(l.codcencus))) return false;
      return true;
    });
  }, [lancamentos, dataLoaded, fechamentoVisual, crExcluidos, natExcluidas, empExcluidas, crFiltroSet]);

  const lancamentosPeriodo = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    return lancamentosBase.filter(l => l.periodo >= periodoInicio && l.periodo <= periodoFim);
  }, [lancamentosBase, filtros]);

  // Índice período→lançamentos — uma só varredura do array em vez de 12
  const lancamentosPorPeriodo = useMemo(() => {
    const map = new Map<string, LancamentoFinanceiro[]>();
    for (const l of lancamentosBase) {
      const bucket = map.get(l.periodo);
      if (bucket) bucket.push(l);
      else map.set(l.periodo, [l]);
    }
    return map;
  }, [lancamentosBase]);

  // Valores mensais — meses fora do intervalo filtrado retornam período vazio
  const valoresPorMes = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    const ano = periodoInicio.slice(0, 4);
    return MESES.map((_, mi) => {
      const p = `${ano}-${String(mi + 1).padStart(2, "0")}`;
      if (p < periodoInicio || p > periodoFim) return EMPTY_PERIOD;
      return computePeriod(dre, lancamentosPorPeriodo.get(p) ?? []);
    });
  }, [dre, lancamentosPorPeriodo, filtros]);

  // Colunas: filtra grupos que tenham pelo menos 1 mês no intervalo selecionado
  const colunas = useMemo<ColDRE[]>(() => {
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
        result:   aggregatePeriods(g.meses, valoresPorMes, dre),
      }));
  }, [filtros, valoresPorMes, dre]);

  // Total = soma de todos os meses visíveis
  const valoresTotal = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    const ano = periodoInicio.slice(0, 4);
    const meses = MESES.map((_, mi) => `${ano}-${String(mi + 1).padStart(2, "0")}`);
    const idxs  = meses.map((p, mi) => ({ p, mi })).filter(({ p }) => p >= periodoInicio && p <= periodoFim).map(({ mi }) => mi);
    return aggregatePeriods(idxs, valoresPorMes, dre);
  }, [filtros, valoresPorMes, dre]);

  const codes = useMemo(() => computeCodes(dre), [dre]);

  // Lançamentos que não foram capturados por nenhuma regra da DRE no período filtrado
  const naoAlocados = useMemo(
    () => computeUnallocated(dre, lancamentosPeriodo),
    [dre, lancamentosPeriodo]
  );
  const totalNaoAlocado = useMemo(
    () => naoAlocados.reduce((s, l) => s + l.valor, 0),
    [naoAlocados]
  );

  // Lançamentos excluídos intencionalmente por configuração de ENTRA_RESULTADO no período filtrado
  const lancamentosExcluidos = useMemo(() => {
    if (!dataLoaded) return [];
    const { periodoInicio, periodoFim } = filtros;
    return lancamentos.filter(l => {
      if (l.tipo !== "realizado") return false;
      if (fechamentoVisual && l.fechamentoId !== fechamentoVisual.id) return false;
      if (l.periodo < periodoInicio || l.periodo > periodoFim) return false;
      return crExcluidos.has(l.codcencus) || natExcluidas.has(l.codnat) || empExcluidas.has(l.codemp);
    });
  }, [lancamentos, dataLoaded, fechamentoVisual, crExcluidos, natExcluidas, empExcluidas, filtros]);
  const totalExcluidos = useMemo(
    () => lancamentosExcluidos.reduce((s, l) => s + l.valor, 0),
    [lancamentosExcluidos]
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
          if (colunas.every(c => (c.result.valores.get(item.id) ?? 0) === 0)) return false;
        }
        return true;
      });
  }, [dre, collapsed, filtros.mostrarZeros, colunas]);

  const filtrosAtivos = useMemo(() => {
    let n = 0;
    if (filtros.viewMode !== "mensal") n++;
    const ano = filtros.periodoInicio.slice(0, 4);
    if (filtros.periodoInicio !== `${ano}-01` || filtros.periodoFim !== `${ano}-12`) n++;
    if (filtros.mostrarZeros) n++;
    if ((filtros.crIds?.length ?? 0) > 0) n++;
    return n;
  }, [filtros]);

  // Colapsa tudo ao N1 na primeira vez que `dre` tiver dados
  useEffect(() => {
    if (initialCollapseRef.current || dre.length === 0) return;
    initialCollapseRef.current = true;
    setCollapsed(new Set(dre.filter(d => d.tipo === "SUBTOTAL").map(d => d.id)));
  }, [dre]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxNivel = useMemo(
    () => Math.max(...dre.filter(d => d.tipo === "SUBTOTAL").map(d => d.nivel), 1),
    [dre]
  );

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
    setActiveLevel("all"); // desativa destaque de nível ao expandir/colapsar manualmente
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function aplicar()    { setFiltros(rascunho); setFilterOpen(false); }
  function limparTudo() { setRascunho(filtrosVazios); }

  function diagnosticarNufin(nufin: string) {
    const q = nufin.trim();
    if (!q) return;
    const lan = lancamentos.find(l => (l.nufin ?? "") === q);
    if (!lan) {
      setDiagResultado({ tipo: "erro", motivo: "Não encontrado", detalhe: `Nenhum lançamento com NUFIN ${q} nos dados importados.` });
      return;
    }
    if (lan.tipo !== "realizado") {
      setDiagResultado({ tipo: "aviso", motivo: "Tipo incorreto", detalhe: `O lançamento é do tipo "${lan.tipo}", não "realizado". A DRE Realizada só considera lançamentos do tipo realizado.` });
      return;
    }
    if (fechamentoVisual && lan.fechamentoId !== fechamentoVisual.id) {
      const fech = fechamentos.find(f => f.id === lan.fechamentoId);
      setDiagResultado({ tipo: "aviso", motivo: "Fechamento diferente", detalhe: `O lançamento pertence ao fechamento "${fech?.label ?? lan.fechamentoId}", mas a DRE está exibindo "${fechamentoVisual.label}". Troque o fechamento no seletor acima.` });
      return;
    }
    const { periodoInicio, periodoFim } = filtros;
    if (lan.periodo < periodoInicio || lan.periodo > periodoFim) {
      setDiagResultado({ tipo: "aviso", motivo: "Período fora do filtro", detalhe: `O lançamento é do período ${lan.periodo}, mas o filtro atual cobre ${periodoInicio} até ${periodoFim}. Ajuste o filtro de período.` });
      return;
    }
    if (crExcluidos.has(lan.codcencus)) {
      const cr = loadData<CentroResultadoRow[]>("portal_centro_resultado", []).find(r => r.CODCENCUS === lan.codcencus);
      setDiagResultado({ tipo: "aviso", motivo: "CR excluído por configuração", detalhe: `Centro de Resultado ${lan.codcencus} (${cr?.DESCRCENCUS ?? ""}) está configurado como "${cr?.ENTRA_RESULTADO ?? "NÃO ENTRA"}" em Cadastro › Centro de Resultado.` });
      return;
    }
    if (natExcluidas.has(lan.codnat)) {
      const nat = loadData<NaturezaRow[]>("portal_natureza", []).find(r => r.CODNAT === lan.codnat);
      setDiagResultado({ tipo: "aviso", motivo: "Natureza excluída por configuração", detalhe: `Natureza ${lan.codnat} (${nat?.DESCRNAT ?? ""}) está configurada como "${nat?.ENTRA_RESULTADO ?? "NÃO ENTRA"}" em Cadastro › Natureza.` });
      return;
    }
    if (empExcluidas.has(lan.codemp)) {
      const emp = loadData<EmpresaRow[]>("portal_empresas", []).find(r => r.CODEMP === lan.codemp);
      setDiagResultado({ tipo: "aviso", motivo: "Empresa excluída por configuração", detalhe: `Empresa ${lan.codemp} (${emp?.RAZAOSOCIAL ?? ""}) está configurada como "${emp?.ENTRA_RESULTADO ?? "NÃO ENTRA"}" em Cadastro › Empresas.` });
      return;
    }
    // Verifica se alguma regra CONTA da DRE cobre este lançamento
    const contasCobrem = dre.filter(item => {
      if (item.tipo !== "CONTA") return false;
      const hasNat = hasEffectiveRule(item.regras?.natureza);
      const hasCr  = hasEffectiveRule(item.regras?.centroResultado);
      if (!hasNat && !hasCr) return false;
      return (!hasNat || matchesRegra(lan.codnat, item.regras?.natureza)) &&
             (!hasCr  || matchesRegra(lan.codcencus, item.regras?.centroResultado));
    });
    if (contasCobrem.length === 0) {
      setDiagResultado({ tipo: "erro", motivo: "Sem regra na DRE", detalhe: `Nenhuma conta da estrutura DRE tem regra que cubra Natureza ${lan.codnat} + CR ${lan.codcencus}. Ajuste a estrutura em Cadastro › Demonstrativos.` });
    } else {
      setDiagResultado({ tipo: "ok", motivo: "Alocado", detalhe: `O lançamento está alocado em: ${contasCobrem.map(c => c.descricao).join(", ")}.` });
    }
  }

  const anoAtivo = filtros.periodoInicio.slice(0, 4);
  const lancamentosDoAno = lancamentosBase.filter(l => l.periodo.startsWith(anoAtivo)).length;
  const subtitle = fechamentoVisual ? `${fechamentoVisual.label} · ${anoAtivo}` : `Realizado · ${anoAtivo}`;
  const viewMode = filtros.viewMode;

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (!dataLoaded) {
    return (
      <div>
        <PageHeader title="Demonstração de Resultado do Exercício" subtitle="Realizado" />
        <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">Carregando lançamentos…</span>
        </div>
      </div>
    );
  }

  if (fechamentosRealizado.length === 0) {
    return (
      <div>
        <PageHeader title="Demonstração de Resultado do Exercício" subtitle="Realizado" />
        <div className="p-6">
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-xl border border-gray-100">
            <p className="text-gray-500 font-medium">Nenhum fechamento de Realizado importado</p>
            <p className="text-gray-400 text-sm mt-1">Importe um fechamento em Lançamentos › Financeiro.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const mIni = parseInt(filtros.periodoInicio.split("-")[1]) - 1;
  const mFim = parseInt(filtros.periodoFim.split("-")[1]) - 1;
  const periodoLabel = mIni === 0 && mFim === 11
    ? anoAtivo
    : `${MESES[mIni]}–${MESES[mFim]} ${anoAtivo}`;

  return (
    <div>
      <PageHeader title="Demonstração de Resultado do Exercício" subtitle={subtitle} />

      <div className="p-6 space-y-4 min-w-max">

        {/* ── Controles ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">

          {/* Fechamento */}
          <select value={fechamentoId} onChange={e => setFechamentoId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {fechamentoAtivo && <option value="__ativo__">★ {fechamentoAtivo.label} (ativo)</option>}
            {fechamentosRealizado.map(f => (
              <option key={f.id} value={f.id}>{f.ativo ? `★ ${f.label}` : f.label}</option>
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

          {/* Diagnóstico por NUFIN */}
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              placeholder="NUFIN…"
              value={diagNufin}
              onChange={e => { setDiagNufin(e.target.value); setDiagResultado(null); }}
              onKeyDown={e => e.key === "Enter" && diagnosticarNufin(diagNufin)}
              className="w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <button
              onClick={() => diagnosticarNufin(diagNufin)}
              className="px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors text-gray-600">
              🔍
            </button>
          </div>

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
            {lancamentosDoAno.toLocaleString("pt-BR")} lançamentos · {VIEW_LABELS[viewMode]} · {periodoLabel}
          </span>
        </div>

        {/* ── Resultado do diagnóstico ──────────────────────────────────────── */}
        {diagResultado && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg border text-sm"
            style={
              diagResultado.tipo === "ok"    ? { background: "#f0fdf4", borderColor: "#bbf7d0", color: "#166534" } :
              diagResultado.tipo === "erro"  ? { background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" } :
                                               { background: "#fffbeb", borderColor: "#fde68a", color: "#92400e" }
            }>
            <span className="text-base leading-none mt-0.5">
              {diagResultado.tipo === "ok" ? "✅" : diagResultado.tipo === "erro" ? "❌" : "⚠️"}
            </span>
            <div>
              <p className="font-semibold">{diagResultado.motivo}</p>
              <p className="mt-0.5 text-[13px] opacity-90">{diagResultado.detalhe}</p>
            </div>
            <button onClick={() => setDiagResultado(null)}
              className="ml-auto text-current opacity-40 hover:opacity-70 transition-opacity leading-none text-base">✕</button>
          </div>
        )}

        {/* ── Tabela pivô ─────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-semibold text-gray-800 text-sm">
              DRE · Realizado ·{" "}
              <span className="font-normal text-gray-500">{VIEW_LABELS[viewMode]} · {periodoLabel}</span>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="text-sm" style={{ minWidth: "max-content", width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                {/* Linha de agrupamento — apenas no modo trimestral */}
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

                {/* Cabeçalho principal */}
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
                  const s           = getRowStyle(item.tipo, item.nivel);
                  const isSubtotal  = item.tipo === "SUBTOTAL";
                  const isCollapsed = isSubtotal && collapsed.has(item.id);
                  const total       = valoresTotal.valores.get(item.id) ?? 0;

                  return (
                    <tr key={item.id}
                      style={{ background: s.bg, color: s.color, fontWeight: s.fw }}
                      className="border-b border-gray-100 cursor-pointer hover:brightness-95 transition-all"
                      onClick={() => setDetalhe({ item, lans: getLancamentosForItem(item, dre, lancamentosPeriodo) })}>

                      {/* Descrição — sticky */}
                      <td className="px-4 py-2.5 sticky left-0 z-10" style={{ background: s.bg }}>
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

                      {/* Valores por período */}
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

                      {/* Total */}
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-gray-100 sticky right-0 z-10"
                        style={{ fontWeight: isSubtotal ? "700" : "500", background: s.bg }}>
                        <span>{fmtInt(total)}</span>
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

      {/* ── Modal de detalhamento ────────────────────────────────────────────── */}
      {detalhe && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setDetalhe(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-[96vw] max-h-[88vh] flex flex-col">

              {/* Título */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 flex-shrink-0">
                <p className="font-semibold text-gray-800">{detalhe.item.descricao}</p>
                <button onClick={() => setDetalhe(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none">✕</button>
              </div>

              {/* Filtro de períodos + totalizador */}
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
                    <p className="text-sm font-bold tabular-nums text-gray-800">
                      {fmtInt(detalheTotal)}
                    </p>
                  </div>
                  <button onClick={exportarDetalhe}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors whitespace-nowrap">
                    <Download size={13} />
                    Exportar Excel
                  </button>
                </div>
              </div>

              {/* Tabela */}
              <div className="overflow-auto flex-1">
                <table className="text-sm w-full border-collapse">
                  <thead className="sticky top-0">
                    <tr style={{ background: "#1e3a5f" }}>
                      {(
                        [
                          ["nufin",    "NUFIN",               false],
                          ["data",     "Data",                false],
                          ["historico","Histórico",           false],
                          ["codnat",   "Natureza",            false],
                          ["codcencus","Centro de Resultado", false],
                          ["codemp",   "Empresa",             false],
                          ["codproj",  "Projeto",             false],
                          ["codparc",  "Parceiro",            false],
                          ["valor",    "Valor",               true ],
                        ] as [SortKey, string, boolean][]
                      ).map(([key, label, right]) => {
                        const active = sortKey === key;
                        return (
                          <th key={key}
                            onClick={() => toggleSort(key)}
                            className={`px-3 py-2.5 text-xs uppercase tracking-wide font-semibold whitespace-nowrap cursor-pointer select-none transition-colors hover:bg-white/10${right ? " text-right" : " text-left"}`}
                            style={{ color: active ? "white" : "rgba(255,255,255,0.7)" }}>
                            <span className="inline-flex items-center gap-1">
                              {label}
                              <span className="text-[10px]" style={{ opacity: active ? 1 : 0.35 }}>
                                {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                              </span>
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {detalheLansOrdenados.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">
                          Nenhum lançamento para os períodos selecionados.
                        </td>
                      </tr>
                    )}
                    {detalheLansOrdenados.map((l, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-gray-500 tabular-nums whitespace-nowrap">{l.nufin ?? "—"}</td>
                        <td className="px-3 py-1.5 text-gray-500 tabular-nums whitespace-nowrap">{fmtDate(l.data)}</td>
                        <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">{l.historico ?? <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                          <span className="text-gray-400 text-xs mr-1">{l.codnat}</span>
                          {natMap.get(l.codnat) ?? ""}
                        </td>
                        <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                          <span className="text-gray-400 text-xs mr-1">{l.codcencus}</span>
                          {crMap.get(l.codcencus) ?? ""}
                        </td>
                        <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                          <span className="text-gray-400 text-xs mr-1">{l.codemp}</span>
                          {empMap.get(l.codemp) ?? ""}
                        </td>
                        <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                          {l.codproj
                            ? <><span className="text-gray-400 text-xs mr-1">{l.codproj}</span>{projMap.get(l.codproj) ?? ""}</>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                          {l.codparc
                            ? <><span className="text-gray-400 text-xs mr-1">{l.codparc}</span>{parcMap.get(l.codparc) ?? ""}</>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap font-medium text-gray-800">
                          {fmtInt(l.valor)}
                        </td>
                      </tr>
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
                    <span onClick={() => setRascunho(r => ({ ...r, periodoInicio: "", periodoFim: "" }))}
                      className="text-[11px] text-blue-600 hover:underline cursor-pointer font-normal">limpar</span>
                  )}
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">De</label>
                    <input type="month" value={rascunho.periodoInicio}
                      onChange={e => {
                        const v = e.target.value;
                        setRascunho(r => ({ ...r, periodoInicio: v, periodoFim: r.periodoFim && r.periodoFim < v ? v : r.periodoFim }));
                      }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Até</label>
                    <input type="month" value={rascunho.periodoFim}
                      onChange={e => {
                        const v = e.target.value;
                        setRascunho(r => ({ ...r, periodoFim: v, periodoInicio: r.periodoInicio && r.periodoInicio > v ? v : r.periodoInicio }));
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

