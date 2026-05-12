"use client";

import React, { useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import { ChevronDown, ChevronRight as ChevronRt, Filter, Download } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData, loadData } from "@/lib/storage";
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
}

const _y = new Date().getFullYear();
const filtrosVazios: Filtros = { periodoInicio: `${_y}-01`, periodoFim: `${_y}-12`, viewMode: "mensal", mostrarZeros: false };

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
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  if (r.codDe && cmp(cod, r.codDe) < 0) return false;
  if (r.codAte && cmp(cod, r.codAte) > 0) return false;
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

const EMPTY_PERIOD: PeriodResult = { valores: new Map(), naoAlocado: 0 };

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
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

export default function DreOrcadaPage() {
  const [dre]        = usePersistedData<DemoItem[]>("portal_dre", dreInicial);
  const [fechamentos] = usePersistedData<Fechamento[]>("portal_fechamentos", []);

  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([]);
  const [dataLoaded, setDataLoaded]   = useState(false);

  const [fechamentoId, setFechamentoId] = useState<string>("__ativo__");
  const [collapsed,    setCollapsed]    = useState<Set<string>>(new Set());

  const [filterOpen, setFilterOpen] = useState(false);
  const [filtros,    setFiltros]    = usePersistedData<Filtros>("portal_dre_filtros_orcado", filtrosVazios);
  const [rascunho,   setRascunho]   = useState<Filtros>(filtrosVazios);

  const [detalhe, setDetalhe] = useState<{ item: DemoItem; lans: LancamentoFinanceiro[] } | null>(null);
  const [periodosSel, setPeriodosSel] = useState<Set<string>>(new Set());

  const natMap  = useMemo(() => new Map(loadData<NaturezaRow[]>("portal_natureza", []).map(r => [r.CODNAT, r.DESCRNAT])), []);
  const projMap = useMemo(() => new Map(loadData<ProjetoRow[]>("portal_projetos", []).map(r => [r.CODPROJ, r.IDENTIFICACAO])), []);
  const crMap   = useMemo(() => new Map(loadData<CentroResultadoRow[]>("portal_centro_resultado", []).map(r => [r.CODCENCUS, r.DESCRCENCUS])), []);
  const empMap  = useMemo(() => new Map(loadData<EmpresaRow[]>("portal_empresas", []).map(r => [r.CODEMP, r.RAZAOSOCIAL])), []);
  const parcMap = useMemo(() => new Map(loadData<ParceiroRow[]>("portal_parceiro", []).map(r => [r.CODPARC, r.NOMEPARC])), []);

  useEffect(() => {
    if (!detalhe) return;
    setPeriodosSel(new Set(detalhe.lans.map(l => l.periodo)));
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

  function exportarDetalhe() {
    if (!detalhe) return;
    const rows = detalheGrupos.flatMap(g =>
      g.lans.map(l => ({
        NUFIN:               l.nufin ?? "",
        Data:                fmtDate(l.data),
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
    XLSX.writeFile(wb, `DRE_Orcado_${detalhe.item.descricao.replace(/[/\\?*[\]]/g, "_")}.xlsx`);
  }

  useEffect(() => {
    const fb = setTimeout(() => setDataLoaded(true), 400);
    idbGet<LancamentoFinanceiro[]>("portal_lancamentos_financeiro", []).then(data => {
      clearTimeout(fb); setLancamentos(data); setDataLoaded(true);
    });
  }, []);

  const fechamentosOrcado = useMemo(
    () => fechamentos.filter(f => f.tipo === "orcado").sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)),
    [fechamentos]
  );

  const fechamentoAtivo = useMemo(
    () => fechamentos.find(f => f.tipo === "orcado" && f.ativo) ?? null,
    [fechamentos]
  );

  const fechamentoVisual = useMemo(() => {
    if (fechamentoId === "__ativo__") return fechamentoAtivo;
    return fechamentos.find(f => f.id === fechamentoId) ?? fechamentoAtivo;
  }, [fechamentoId, fechamentos, fechamentoAtivo]);

  const anosDisponiveis = useMemo(() => {
    const set = new Set<number>();
    lancamentos.filter(l => l.tipo === "orcado").forEach(l => {
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
      if (l.tipo !== "orcado") return false;
      if (fechamentoVisual && l.fechamentoId !== fechamentoVisual.id) return false;
      return true;
    });
  }, [lancamentos, dataLoaded, fechamentoVisual]);

  const lancamentosPeriodo = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    return lancamentosBase.filter(l => l.periodo >= periodoInicio && l.periodo <= periodoFim);
  }, [lancamentosBase, filtros]);

  const lancamentosPorPeriodo = useMemo(() => {
    const map = new Map<string, LancamentoFinanceiro[]>();
    for (const l of lancamentosBase) {
      const bucket = map.get(l.periodo);
      if (bucket) bucket.push(l);
      else map.set(l.periodo, [l]);
    }
    return map;
  }, [lancamentosBase]);

  const valoresPorMes = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    const ano = periodoInicio.slice(0, 4);
    return MESES.map((_, mi) => {
      const p = `${ano}-${String(mi + 1).padStart(2, "0")}`;
      if (p < periodoInicio || p > periodoFim) return EMPTY_PERIOD;
      return computePeriod(dre, lancamentosPorPeriodo.get(p) ?? []);
    });
  }, [dre, lancamentosPorPeriodo, filtros]);

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

  const valoresTotal = useMemo(() => {
    const { periodoInicio, periodoFim } = filtros;
    const ano = periodoInicio.slice(0, 4);
    const meses = MESES.map((_, mi) => `${ano}-${String(mi + 1).padStart(2, "0")}`);
    const idxs  = meses.map((p, mi) => ({ p, mi })).filter(({ p }) => p >= periodoInicio && p <= periodoFim).map(({ mi }) => mi);
    return aggregatePeriods(idxs, valoresPorMes, dre);
  }, [filtros, valoresPorMes, dre]);

  const codes = useMemo(() => computeCodes(dre), [dre]);

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
    return n;
  }, [filtros]);

  function toggleCollapse(id: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function aplicar()    { setFiltros(rascunho); setFilterOpen(false); }
  function limparTudo() { setRascunho(filtrosVazios); }

  const anoAtivo = filtros.periodoInicio.slice(0, 4);
  const lancamentosDoAno = lancamentosBase.filter(l => l.periodo.startsWith(anoAtivo)).length;
  const subtitle = fechamentoVisual ? `${fechamentoVisual.label} · ${anoAtivo}` : `Orçado · ${anoAtivo}`;
  const viewMode = filtros.viewMode;

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (!dataLoaded) {
    return (
      <div>
        <PageHeader title="Demonstração de Resultado do Exercício" subtitle="Orçado" />
        <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">Carregando lançamentos…</span>
        </div>
      </div>
    );
  }

  if (fechamentosOrcado.length === 0) {
    return (
      <div>
        <PageHeader title="Demonstração de Resultado do Exercício" subtitle="Orçado" />
        <div className="p-6">
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-xl border border-gray-100">
            <p className="text-gray-500 font-medium">Nenhum fechamento de Orçado importado</p>
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

      <div className="p-6 space-y-4">

        {/* ── Controles ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">

          {/* Fechamento */}
          <select value={fechamentoId} onChange={e => setFechamentoId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {fechamentoAtivo && <option value="__ativo__">★ {fechamentoAtivo.label} (ativo)</option>}
            {fechamentosOrcado.map(f => (
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

          <span className="ml-auto text-xs text-gray-400">
            {lancamentosDoAno.toLocaleString("pt-BR")} lançamentos · {VIEW_LABELS[viewMode]} · {periodoLabel}
          </span>
        </div>

        {/* ── Tabela pivô ─────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-semibold text-gray-800 text-sm">
              DRE · Orçado ·{" "}
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
                  <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap min-w-[140px] border-l border-white/20"
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

                      <td className="px-4 py-2.5 sticky left-0 z-10" style={{ background: s.bg }}>
                        <span className="flex items-center gap-1" style={{ paddingLeft: `${(item.nivel - 1) * 16}px` }}>
                          {isSubtotal ? (
                            <button onClick={e => { e.stopPropagation(); toggleCollapse(item.id); }}
                              className="flex-shrink-0 rounded p-0.5 transition-colors"
                              style={{ color: s.dark ? "rgba(255,255,255,0.7)" : "#1e3a5f" }}>
                              {isCollapsed ? <ChevronRt size={13} /> : <ChevronDown size={13} />}
                            </button>
                          ) : <span className="w-4 flex-shrink-0" />}
                          <span className="whitespace-nowrap">{item.descricao}</span>
                        </span>
                      </td>

                      {colunas.map((c, ci) => {
                        const v = c.result.valores.get(item.id) ?? 0;
                        const sep = viewMode === "trimestral" && ci > 0;
                        return (
                          <td key={ci}
                            className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap${sep ? " border-l border-gray-100" : ""}`}>
                            {v !== 0
                              ? <span className={v < 0 ? (s.dark ? "text-red-300" : "text-red-600") : ""}>{fmtInt(v)}</span>
                              : <span style={{ opacity: 0.18 }}>—</span>}
                          </td>
                        );
                      })}

                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-gray-100"
                        style={{ fontWeight: isSubtotal ? "700" : "500" }}>
                        <span className={total < 0 ? (s.dark ? "text-red-300" : "text-red-600") : ""}>{fmtInt(total)}</span>
                      </td>
                    </tr>
                  );
                })}

                {visibleData.length === 0 && valoresTotal.naoAlocado === 0 && (
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
                <p className="font-semibold text-gray-800">{detalhe.item.descricao}</p>
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

              <div className="overflow-auto flex-1">
                <table className="text-sm w-full border-collapse">
                  <thead className="sticky top-0">
                    <tr style={{ background: "#1e3a5f" }}>
                      {["NUFIN","Data","Natureza","Centro de Resultado","Empresa","Projeto","Parceiro","Valor"].map((h, i) => (
                        <th key={i}
                          className={`px-3 py-2.5 text-white/80 text-xs uppercase tracking-wide font-semibold whitespace-nowrap${i === 7 ? " text-right" : " text-left"}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detalheGrupos.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">
                          Nenhum lançamento para os períodos selecionados.
                        </td>
                      </tr>
                    )}
                    {detalheGrupos.map(g => (
                      <React.Fragment key={g.periodo}>
                        {g.lans.map((l, i) => (
                          <tr key={`${g.periodo}-${i}`} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-1.5 text-gray-500 tabular-nums whitespace-nowrap">{l.nufin ?? "—"}</td>
                            <td className="px-3 py-1.5 text-gray-500 tabular-nums whitespace-nowrap">{fmtDate(l.data)}</td>
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
                            <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap font-medium${l.valor < 0 ? " text-red-600" : " text-gray-800"}`}>
                              {fmtInt(l.valor)}
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
