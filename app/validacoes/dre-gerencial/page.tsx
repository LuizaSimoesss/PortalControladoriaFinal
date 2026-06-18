"use client";

import { useState, useMemo, useEffect } from "react";
import { Search, ChevronLeft, ChevronRight, Filter, ChevronDown, Download } from "lucide-react";
import * as XLSX from "xlsx";
import PageHeader from "@/components/PageHeader";
import { loadData, usePersistedData } from "@/lib/storage";
import { idbGet } from "@/lib/idb";
import type {
  LancamentoFinanceiro, Fechamento,
  NaturezaRow, CentroResultadoRow, EmpresaRow,
  ProjetoRow, ParceiroRow,
} from "@/lib/mockData";

// ─── DRE types ────────────────────────────────────────────────────────────────

type ItemTipo  = "SUBTOTAL" | "CONTA";
type RegraMode = "none" | "especifico" | "intervalo" | "multiplo";

interface RegraItem   { modo: RegraMode; codEspecifico?: string; codDe?: string; codAte?: string; codMultiplos?: string[] }
interface RegrasLinha { centroResultado?: RegraItem; natureza?: RegraItem }
interface FormulaItem { subtotalId: string; sinal: "+" | "-" }

interface DemoItem {
  id: string; nivel: number; tipo: ItemTipo; descricao: string;
  regras?: RegrasLinha; formula?: FormulaItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function periodoLabel(p: string) {
  if (!p) return "—";
  const [y, m] = p.split("-");
  return `${MESES[parseInt(m) - 1]}/${y}`;
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtData(d: string) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function hasEffectiveRule(r: RegraItem | undefined): boolean {
  if (!r || r.modo === "none") return false;
  if (r.modo === "especifico") return !!r.codEspecifico;
  if (r.modo === "multiplo")   return (r.codMultiplos?.length ?? 0) > 0;
  return !!(r.codDe || r.codAte);
}

function matchesRegra(cod: string, r: RegraItem | undefined): boolean {
  if (!r || r.modo === "none") return true;
  if (r.modo === "especifico") return r.codEspecifico ? cod === r.codEspecifico : true;
  if (r.modo === "multiplo")   return r.codMultiplos ? r.codMultiplos.includes(cod) : true;
  const n = +cod, isNum = !isNaN(n);
  if (r.codDe)  { const d = +r.codDe;  if (isNum && !isNaN(d) ? n < d : cod < r.codDe)  return false; }
  if (r.codAte) { const a = +r.codAte; if (isNum && !isNaN(a) ? n > a : cod > r.codAte) return false; }
  return true;
}

function entraNosDre(v: string | undefined): boolean {
  return v === "DRE" || v === "AMBOS";
}

function findNaoAlocadosIds(dre: DemoItem[], lans: LancamentoFinanceiro[]): Set<string> {
  const alocados = new Set<string>();
  for (const item of dre) {
    if (item.tipo !== "CONTA") continue;
    const hasNat = hasEffectiveRule(item.regras?.natureza);
    const hasCr  = hasEffectiveRule(item.regras?.centroResultado);
    if (!hasNat && !hasCr) continue;
    for (const l of lans) {
      if ((!hasNat || matchesRegra(l.codnat, item.regras?.natureza)) &&
          (!hasCr  || matchesRegra(l.codcencus, item.regras?.centroResultado)))
        alocados.add(l.id);
    }
  }
  return new Set(lans.filter(l => !alocados.has(l.id)).map(l => l.id));
}

// ─── Filter helpers ────────────────────────────────────────────────────────────

interface Filtros {
  nat: string[]; cr: string[]; emp: string[];
  nufin: string[]; periodo: string[];
  dataInicio: string; dataFim: string;
}
const filtrosVazios: Filtros = { nat: [], cr: [], emp: [], nufin: [], periodo: [], dataInicio: "", dataFim: "" };

function countFiltros(f: Filtros) {
  return f.nat.length + f.cr.length + f.emp.length + f.nufin.length + f.periodo.length +
    (f.dataInicio ? 1 : 0) + (f.dataFim ? 1 : 0);
}

function FilterSection({ title, count, onClear, items, renderLabel, isChecked, onToggle }: {
  title: string; count: number; onClear: () => void;
  items: string[]; renderLabel: (item: string) => string;
  isChecked: (item: string) => boolean; onToggle: (item: string, checked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const visible = q ? items.filter(i => renderLabel(i).toLowerCase().includes(q.toLowerCase())) : items;
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
        <span className="flex items-center gap-2">
          {title}
          {count > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full text-white" style={{ background: "#1e3a5f" }}>{count}</span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {count > 0 && (
            <span onClick={e => { e.stopPropagation(); onClear(); }}
              className="text-[11px] text-blue-600 hover:underline mr-1">limpar</span>
          )}
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3">
          {items.length > 6 && (
            <div className="relative mb-2">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar..."
                className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
            </div>
          )}
          <div className="space-y-0.5 max-h-44 overflow-y-auto">
            {visible.map(item => (
              <label key={item} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-50 px-1 rounded text-sm text-gray-700">
                <input type="checkbox" checked={isChecked(item)} onChange={e => onToggle(item, e.target.checked)}
                  className="w-4 h-4 rounded cursor-pointer flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
                <span className="truncate">{renderLabel(item)}</span>
              </label>
            ))}
            {visible.length === 0 && <p className="text-xs text-gray-400 py-1">Nenhum resultado</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tipo enriquecido ─────────────────────────────────────────────────────────

interface LanEnriquecido extends LancamentoFinanceiro {
  natDescr: string; crDescr: string; empDescr: string;
  natEntra: boolean; crEntra: boolean; empEntra: boolean;
  motivoExclusao: string;
  projNome: string; parcNome: string; fechLabel: string;
}

// ─── Página ───────────────────────────────────────────────────────────────────

type Aba = "nao-alocados" | "excluidos";
const PAGE_SIZE = 100;

export default function DreGerencialValidacaoPage() {
  const [dre]        = usePersistedData<DemoItem[]>("portal_dre", []);
  const [fechamentos] = usePersistedData<Fechamento[]>("portal_fechamentos", []);

  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([]);
  const [dataLoaded,  setDataLoaded]  = useState(false);

  const [aba,          setAba]          = useState<Aba>("nao-alocados");
  const [fechamentoId, setFechamentoId] = useState("__todos__");
  const [buscaNA,      setBuscaNA]      = useState("");
  const [buscaEX,      setBuscaEX]      = useState("");
  const [pageNA,       setPageNA]       = useState(1);
  const [pageEX,       setPageEX]       = useState(1);
  const [filtrosNA,    setFiltrosNA]    = useState<Filtros>(filtrosVazios);
  const [rascNA,       setRascNA]       = useState<Filtros>(filtrosVazios);
  const [filtrosEX,    setFiltrosEX]    = useState<Filtros>(filtrosVazios);
  const [rascEX,       setRascEX]       = useState<Filtros>(filtrosVazios);
  const [filterOpen,   setFilterOpen]   = useState(false);

  useEffect(() => {
    const fb = setTimeout(() => setDataLoaded(true), 400);
    idbGet<LancamentoFinanceiro[]>("portal_lancamentos_financeiro", []).then(d => {
      clearTimeout(fb); setLancamentos(d); setDataLoaded(true);
    });
  }, []);

  const natRows  = useMemo(() => loadData<NaturezaRow[]>("portal_natureza", []), []);
  const crRows   = useMemo(() => loadData<CentroResultadoRow[]>("portal_centro_resultado", []), []);
  const empRows  = useMemo(() => loadData<EmpresaRow[]>("portal_empresas", []), []);
  const projRows = useMemo(() => loadData<ProjetoRow[]>("portal_projetos", []), []);
  const parcRows = useMemo(() => loadData<ParceiroRow[]>("portal_parceiro", []), []);

  const natMap  = useMemo(() => new Map(natRows.map(r  => [r.CODNAT,    r])), [natRows]);
  const crMap   = useMemo(() => new Map(crRows.map(r   => [r.CODCENCUS, r])), [crRows]);
  const empMap  = useMemo(() => new Map(empRows.map(r  => [r.CODEMP,    r])), [empRows]);
  const projMap = useMemo(() => new Map(projRows.map(r => [r.CODPROJ,   r.IDENTIFICACAO])), [projRows]);
  const parcMap = useMemo(() => new Map(parcRows.map(r => [r.CODPARC,   r.NOMEPARC])), [parcRows]);
  const fechMap = useMemo(() => new Map(fechamentos.map(f => [f.id, f.label])), [fechamentos]);

  const fechamentosRealizado = useMemo(
    () => fechamentos.filter(f => f.tipo === "realizado").sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)),
    [fechamentos]
  );

  // Lançamentos do tipo realizado filtrados pelo fechamento
  const lancamentosBase = useMemo(() => lancamentos.filter(l => {
    if (l.tipo !== "realizado") return false;
    if (fechamentoId !== "__todos__" && l.fechamentoId !== fechamentoId) return false;
    return true;
  }), [lancamentos, fechamentoId]);

  // Enriquece um lançamento com dados de cadastro
  function enriquecer(l: LancamentoFinanceiro): LanEnriquecido {
    const nat = natMap.get(l.codnat);
    const cr  = crMap.get(l.codcencus);
    const emp = empMap.get(l.codemp);
    const natEntra = entraNosDre(nat?.ENTRA_RESULTADO);
    const crEntra  = entraNosDre(cr?.ENTRA_RESULTADO);
    const empEntra = entraNosDre(emp?.ENTRA_RESULTADO);
    const motivos: string[] = [];
    if (!natEntra) motivos.push(`Nat ${l.codnat}: ${nat?.ENTRA_RESULTADO ?? "não cadastrado"}`);
    if (!crEntra)  motivos.push(`CR ${l.codcencus}: ${cr?.ENTRA_RESULTADO ?? "não cadastrado"}`);
    if (!empEntra) motivos.push(`Emp ${l.codemp}: ${emp?.ENTRA_RESULTADO ?? "não cadastrado"}`);
    return {
      ...l,
      natDescr: nat?.DESCRNAT ?? "",
      crDescr:  cr?.DESCRCENCUS ?? "",
      empDescr: emp?.RAZAOSOCIAL ?? "",
      natEntra, crEntra, empEntra,
      motivoExclusao: motivos.join(" · ") || "—",
      projNome:  projMap.get(l.codproj ?? "") ?? "",
      parcNome:  parcMap.get(l.codparc ?? "") ?? "",
      fechLabel: fechMap.get(l.fechamentoId ?? "") ?? "—",
    };
  }

  // Excluídos: pelo menos um de Nat/CR/Emp não entra no DRE
  const excluidos = useMemo<LanEnriquecido[]>(() => {
    if (!dataLoaded) return [];
    return lancamentosBase
      .filter(l => {
        const nat = natMap.get(l.codnat);
        const cr  = crMap.get(l.codcencus);
        const emp = empMap.get(l.codemp);
        return !entraNosDre(nat?.ENTRA_RESULTADO) ||
               !entraNosDre(cr?.ENTRA_RESULTADO)  ||
               !entraNosDre(emp?.ENTRA_RESULTADO);
      })
      .map(enriquecer);
  }, [lancamentosBase, dataLoaded, natMap, crMap, empMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lançamentos que passam todos os filtros de exclusão mas não têm regra DRE
  const candidatosNaoAlocados = useMemo(() => {
    if (!dataLoaded) return [];
    return lancamentosBase.filter(l => {
      const nat = natMap.get(l.codnat);
      const cr  = crMap.get(l.codcencus);
      const emp = empMap.get(l.codemp);
      return entraNosDre(nat?.ENTRA_RESULTADO) &&
             entraNosDre(cr?.ENTRA_RESULTADO)  &&
             entraNosDre(emp?.ENTRA_RESULTADO);
    });
  }, [lancamentosBase, dataLoaded, natMap, crMap, empMap]);

  const naoAlocadosIds = useMemo(
    () => findNaoAlocadosIds(dre, candidatosNaoAlocados),
    [dre, candidatosNaoAlocados]
  );

  const naoAlocados = useMemo<LanEnriquecido[]>(
    () => candidatosNaoAlocados.filter(l => naoAlocadosIds.has(l.id)).map(enriquecer),
    [candidatosNaoAlocados, naoAlocadosIds] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Filtros — Não Alocados
  const uniqNatNA  = useMemo(() => [...new Set(naoAlocados.map(l => l.codnat))].sort(), [naoAlocados]);
  const uniqCrNA   = useMemo(() => [...new Set(naoAlocados.map(l => l.codcencus))].sort(), [naoAlocados]);
  const uniqEmpNA  = useMemo(() => [...new Set(naoAlocados.map(l => l.codemp))].sort(), [naoAlocados]);
  const uniqNuNA   = useMemo(() => [...new Set(naoAlocados.map(l => l.nufin).filter(Boolean))] as string[], [naoAlocados]);
  const uniqPerNA  = useMemo(() => [...new Set(naoAlocados.map(l => l.periodo))].sort(), [naoAlocados]);

  // Filtros — Excluídos
  const uniqNatEX  = useMemo(() => [...new Set(excluidos.map(l => l.codnat))].sort(), [excluidos]);
  const uniqCrEX   = useMemo(() => [...new Set(excluidos.map(l => l.codcencus))].sort(), [excluidos]);
  const uniqEmpEX  = useMemo(() => [...new Set(excluidos.map(l => l.codemp))].sort(), [excluidos]);
  const uniqNuEX   = useMemo(() => [...new Set(excluidos.map(l => l.nufin).filter(Boolean))] as string[], [excluidos]);
  const uniqPerEX  = useMemo(() => [...new Set(excluidos.map(l => l.periodo))].sort(), [excluidos]);

  function aplicarFiltro(lan: LanEnriquecido, f: Filtros, busca: string): boolean {
    if (f.nat.length    && !f.nat.includes(lan.codnat))         return false;
    if (f.cr.length     && !f.cr.includes(lan.codcencus))       return false;
    if (f.emp.length    && !f.emp.includes(lan.codemp))         return false;
    if (f.nufin.length  && !f.nufin.includes(lan.nufin ?? ""))  return false;
    if (f.periodo.length && !f.periodo.includes(lan.periodo))   return false;
    if (f.dataInicio    && lan.data < f.dataInicio)             return false;
    if (f.dataFim       && lan.data > f.dataFim)                return false;
    if (busca.trim()) {
      const q = busca.toLowerCase();
      const ok =
        lan.codnat.toLowerCase().includes(q)     ||
        lan.natDescr.toLowerCase().includes(q)   ||
        lan.codcencus.toLowerCase().includes(q)  ||
        lan.crDescr.toLowerCase().includes(q)    ||
        lan.codemp.toLowerCase().includes(q)     ||
        lan.empDescr.toLowerCase().includes(q)   ||
        (lan.nufin ?? "").toLowerCase().includes(q) ||
        lan.periodo.includes(q) || lan.data.includes(q) ||
        (lan.historico ?? "").toLowerCase().includes(q);
      if (!ok) return false;
    }
    return true;
  }

  const filtradosNA = useMemo(
    () => naoAlocados.filter(l => aplicarFiltro(l, filtrosNA, buscaNA)),
    [naoAlocados, filtrosNA, buscaNA] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const filtradosEX = useMemo(
    () => excluidos.filter(l => aplicarFiltro(l, filtrosEX, buscaEX)),
    [excluidos, filtrosEX, buscaEX] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const totalPagesNA = Math.max(1, Math.ceil(filtradosNA.length / PAGE_SIZE));
  const totalPagesEX = Math.max(1, Math.ceil(filtradosEX.length / PAGE_SIZE));
  const pageDataNA   = filtradosNA.slice((pageNA - 1) * PAGE_SIZE, pageNA * PAGE_SIZE);
  const pageDataEX   = filtradosEX.slice((pageEX - 1) * PAGE_SIZE, pageEX * PAGE_SIZE);

  const totalNA = useMemo(() => filtradosNA.reduce((s, l) => s + l.valor, 0), [filtradosNA]);
  const totalEX = useMemo(() => filtradosEX.reduce((s, l) => s + l.valor, 0), [filtradosEX]);

  function exportar(dados: LanEnriquecido[], nome: string) {
    const rows = dados.map(l => ({
      Fechamento:  l.fechLabel,
      Período:     periodoLabel(l.periodo),
      Data:        fmtData(l.data),
      NUFIN:       l.nufin ?? "",
      Histórico:   l.historico ?? "",
      Natureza:    l.codnat,
      "Descr. Nat": l.natDescr,
      "CR":        l.codcencus,
      "Descr. CR": l.crDescr,
      Empresa:     l.codemp,
      "Razão Social": l.empDescr,
      Projeto:     l.codproj ?? "",
      Parceiro:    l.codparc ?? "",
      "Entra (Nat)": l.natEntra ? "SIM" : "NÃO",
      "Entra (CR)":  l.crEntra  ? "SIM" : "NÃO",
      "Entra (Emp)": l.empEntra ? "SIM" : "NÃO",
      "Motivo Exclusão": l.motivoExclusao,
      Valor: l.valor,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nome);
    XLSX.writeFile(wb, `Validacao_DRE_${nome}.xlsx`);
  }

  if (!dataLoaded) {
    return (
      <div>
        <PageHeader title="DRE Gerencial" subtitle="Validação" />
        <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">Carregando lançamentos…</span>
        </div>
      </div>
    );
  }

  const isNA  = aba === "nao-alocados";
  const dados = isNA ? filtradosNA : filtradosEX;
  const paged = isNA ? pageDataNA  : pageDataEX;
  const total = isNA ? totalNA     : totalEX;
  const pages = isNA ? totalPagesNA : totalPagesEX;
  const pg    = isNA ? pageNA      : pageEX;
  const setPg = isNA ? setPageNA   : setPageEX;
  const busca = isNA ? buscaNA     : buscaEX;
  const setBusca = isNA ? setBuscaNA : setBuscaEX;
  const filtros = isNA ? filtrosNA : filtrosEX;
  const rascunho = isNA ? rascNA  : rascEX;
  const setRascunho = isNA ? setRascNA : setRascEX;
  const setFiltros  = isNA ? setFiltrosNA : setFiltrosEX;
  const uniqNat = isNA ? uniqNatNA : uniqNatEX;
  const uniqCr  = isNA ? uniqCrNA  : uniqCrEX;
  const uniqEmp = isNA ? uniqEmpNA : uniqEmpEX;
  const uniqNu  = isNA ? uniqNuNA  : uniqNuEX;
  const uniqPer = isNA ? uniqPerNA : uniqPerEX;
  const nomeAba = isNA ? "Nao_Alocados" : "Excluidos_Configuracao";
  const source  = isNA ? naoAlocados   : excluidos;

  const tabStyle = (a: Aba) => {
    const active = aba === a;
    if (a === "nao-alocados") return active
      ? { background: "#fef3c7", color: "#92400e", borderColor: "#fbbf24", borderBottom: "2px solid #fbbf24" }
      : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" };
    return active
      ? { background: "#dcfce7", color: "#166534", borderColor: "#4ade80", borderBottom: "2px solid #4ade80" }
      : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" };
  };

  return (
    <div>
      <PageHeader title="DRE Gerencial" subtitle="Validação" />

      <div className="p-6 space-y-4">

        {/* ── Fechamento ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">
          <select value={fechamentoId} onChange={e => { setFechamentoId(e.target.value); setPageNA(1); setPageEX(1); setFiltrosNA(filtrosVazios); setFiltrosEX(filtrosVazios); }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="__todos__">Todos os fechamentos</option>
            {fechamentosRealizado.map(f => (
              <option key={f.id} value={f.id}>{f.ativo ? `★ ${f.label}` : f.label}</option>
            ))}
          </select>
          <span className="text-xs text-gray-400 ml-auto">
            {lancamentosBase.length.toLocaleString("pt-BR")} lançamentos carregados
          </span>
        </div>

        {/* ── Abas ────────────────────────────────────────────────────────── */}
        <div className="flex gap-0 border border-gray-200 rounded-xl overflow-hidden w-fit">
          <button onClick={() => setAba("nao-alocados")}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all"
            style={tabStyle("nao-alocados")}>
            <span>⚠</span>
            Não Alocados
            <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: "#fbbf24", color: "#78350f" }}>
              {naoAlocados.length.toLocaleString("pt-BR")}
            </span>
          </button>
          <button onClick={() => setAba("excluidos")}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all border-l border-gray-200"
            style={tabStyle("excluidos")}>
            <span>⛔</span>
            Excluídos por Configuração
            <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: "#4ade80", color: "#14532d" }}>
              {excluidos.length.toLocaleString("pt-BR")}
            </span>
          </button>
        </div>

        {/* ── Descrição da aba ─────────────────────────────────────────────── */}
        <div className="rounded-lg px-4 py-2.5 text-xs"
          style={isNA
            ? { background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }
            : { background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}>
          {isNA
            ? "Lançamentos cujos Natureza, CR e Empresa estão configurados para entrar na DRE, mas nenhuma linha da estrutura DRE tem regra que os capture."
            : "Lançamentos excluídos da DRE porque sua Natureza, CR ou Empresa está configurada como Não Entra / DFC no cadastro."}
        </div>

        {/* ── Vazio ───────────────────────────────────────────────────────── */}
        {source.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-gray-100 text-center">
            <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
              style={{ background: isNA ? "#fef3c7" : "#dcfce7" }}>
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" stroke={isNA ? "#d97706" : "#16a34a"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-gray-700 font-medium">
              {isNA ? "Todos os lançamentos elegíveis estão alocados" : "Nenhum lançamento excluído por configuração"}
            </p>
          </div>
        )}

        {/* ── Controles ───────────────────────────────────────────────────── */}
        {source.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Buscar por código, NUFIN, histórico…" value={busca}
                onChange={e => { setBusca(e.target.value); setPg(1); }}
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={() => { setRascunho(filtros); setFilterOpen(true); }}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
              style={countFiltros(filtros) > 0 ? { borderColor: "#1e3a5f", color: "#1e3a5f" } : {}}>
              <Filter size={14} />
              Filtros
              {countFiltros(filtros) > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full text-white" style={{ background: "#1e3a5f" }}>{countFiltros(filtros)}</span>
              )}
            </button>
            <button onClick={() => exportar(dados, nomeAba)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600 transition-colors">
              <Download size={14} />
              Exportar
            </button>
            <span className="ml-auto text-xs text-gray-400">
              {dados.length.toLocaleString("pt-BR")} de {source.length.toLocaleString("pt-BR")} lançamento{source.length !== 1 ? "s" : ""}
              {" · "}Total: <span className="font-semibold tabular-nums text-gray-700">{fmtBRL(total)}</span>
            </span>
          </div>
        )}

        {/* ── Tabela ──────────────────────────────────────────────────────── */}
        {source.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "60vh" }}>
              <table className="w-full text-sm border-collapse min-w-max">
                <thead>
                  <tr style={{ background: "#1e3a5f" }}>
                    {["Período","Data","NUFIN","Natureza","Descr. Nat.","C.Resultado","Descr. CR","Empresa","Razão Social","Projeto","Parceiro",
                      ...(isNA ? ["Entra (Nat)","Entra (CR)","Entra (Emp)"] : ["Motivo Exclusão"]),
                      "Valor"].map((h, i, arr) => (
                      <th key={i}
                        className={`font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 sticky top-0 z-10 whitespace-nowrap ${i === arr.length - 1 ? "text-right" : "text-left"}`}
                        style={{ background: "#1e3a5f" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((l, i) => (
                    <tr key={l.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors"
                      style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}>
                      <td className="px-3 py-1.5 text-xs text-gray-600 whitespace-nowrap">{periodoLabel(l.periodo)}</td>
                      <td className="px-3 py-1.5 text-xs font-mono text-gray-600 whitespace-nowrap">{fmtData(l.data)}</td>
                      <td className="px-3 py-1.5 text-xs font-mono text-gray-600 whitespace-nowrap">{l.nufin ?? "—"}</td>

                      <td className="px-3 py-1.5 text-xs font-mono text-gray-700 whitespace-nowrap">{l.codnat}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-600 max-w-[160px] truncate" title={l.natDescr}>{l.natDescr || "—"}</td>

                      <td className="px-3 py-1.5 text-xs font-mono text-gray-700 whitespace-nowrap">{l.codcencus}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-600 max-w-[160px] truncate" title={l.crDescr}>{l.crDescr || "—"}</td>

                      <td className="px-3 py-1.5 text-xs font-mono text-gray-700 whitespace-nowrap">{l.codemp}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-600 max-w-[160px] truncate" title={l.empDescr}>{l.empDescr || "—"}</td>

                      <td className="px-3 py-1.5 text-xs font-mono text-gray-500 whitespace-nowrap">{l.codproj ?? "—"}</td>
                      <td className="px-3 py-1.5 text-xs font-mono text-gray-500 whitespace-nowrap">{l.codparc ?? "—"}</td>

                      {isNA ? (
                        <>
                          {([l.natEntra, l.crEntra, l.empEntra]).map((ok, bi) => (
                            <td key={bi} className="px-2 py-1.5 text-center whitespace-nowrap">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold"
                                style={ok
                                  ? { background: "#dcfce7", color: "#166534" }
                                  : { background: "#fee2e2", color: "#991b1b" }}>
                                {ok ? "ENTRA" : "NÃO ENTRA"}
                              </span>
                            </td>
                          ))}
                        </>
                      ) : (
                        <td className="px-3 py-1.5 text-xs text-amber-700 max-w-[260px] truncate" title={l.motivoExclusao}>
                          {l.motivoExclusao}
                        </td>
                      )}

                      <td className={`px-3 py-1.5 text-sm tabular-nums font-medium text-right whitespace-nowrap ${l.valor < 0 ? "text-red-600" : "text-gray-800"}`}>
                        {fmtBRL(l.valor)}
                      </td>
                    </tr>
                  ))}
                  {paged.length === 0 && (
                    <tr>
                      <td colSpan={15} className="px-4 py-10 text-center text-gray-400 text-sm">
                        Nenhum resultado para os filtros aplicados.
                      </td>
                    </tr>
                  )}
                </tbody>
                {dados.length > 0 && (
                  <tfoot>
                    <tr style={{ background: "#f8fafc" }}>
                      <td colSpan={14} className="px-3 py-2.5 text-xs font-semibold text-gray-600 text-right uppercase tracking-wide">
                        Total ({dados.length.toLocaleString("pt-BR")} lançamentos)
                      </td>
                      <td className={`px-3 py-2.5 text-sm tabular-nums font-bold text-right ${total < 0 ? "text-red-600" : "text-gray-800"}`}>
                        {fmtBRL(total)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {pages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">Página {pg} de {pages} · {dados.length.toLocaleString("pt-BR")} registros</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPg(p => Math.max(1, p - 1))} disabled={pg === 1}
                    className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors">
                    <ChevronLeft size={14} />
                  </button>
                  {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                    const p = Math.max(1, Math.min(pages - 4, pg - 2)) + i;
                    return (
                      <button key={p} onClick={() => setPg(p)}
                        className="w-7 h-7 rounded text-xs font-medium transition-colors"
                        style={p === pg ? { background: "#0078D4", color: "white" } : { color: "#374151" }}>
                        {p}
                      </button>
                    );
                  })}
                  <button onClick={() => setPg(p => Math.min(pages, p + 1))} disabled={pg === pages}
                    className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── FilterDrawer ───────────────────────────────────────────────────── */}
      {filterOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setFilterOpen(false)} />
          <div className="fixed top-0 right-0 h-full w-[300px] z-50 bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 flex-shrink-0">
              <span className="font-semibold text-gray-800">Filtros — {isNA ? "Não Alocados" : "Excluídos"}</span>
              <button onClick={() => setFilterOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="border-b border-gray-100 px-4 py-3">
                <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center justify-between">
                  Data
                  {(rascunho.dataInicio || rascunho.dataFim) && (
                    <span onClick={() => setRascunho(r => ({ ...r, dataInicio: "", dataFim: "" }))}
                      className="text-[11px] text-blue-600 hover:underline cursor-pointer font-normal">limpar</span>
                  )}
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">De</label>
                    <input type="date" value={rascunho.dataInicio}
                      onChange={e => setRascunho(r => ({ ...r, dataInicio: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Até</label>
                    <input type="date" value={rascunho.dataFim}
                      onChange={e => setRascunho(r => ({ ...r, dataFim: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                </div>
              </div>
              <FilterSection title="Período" count={rascunho.periodo.length}
                onClear={() => setRascunho(r => ({ ...r, periodo: [] }))}
                items={uniqPer} renderLabel={periodoLabel}
                isChecked={c => rascunho.periodo.includes(c)}
                onToggle={(c, v) => setRascunho(r => ({ ...r, periodo: v ? [...r.periodo, c] : r.periodo.filter(x => x !== c) }))} />
              <FilterSection title="Natureza" count={rascunho.nat.length}
                onClear={() => setRascunho(r => ({ ...r, nat: [] }))}
                items={uniqNat} renderLabel={c => `${c}${natMap.get(c) ? ` — ${natMap.get(c)!.DESCRNAT}` : ""}`}
                isChecked={c => rascunho.nat.includes(c)}
                onToggle={(c, v) => setRascunho(r => ({ ...r, nat: v ? [...r.nat, c] : r.nat.filter(x => x !== c) }))} />
              <FilterSection title="Centro de Resultado" count={rascunho.cr.length}
                onClear={() => setRascunho(r => ({ ...r, cr: [] }))}
                items={uniqCr} renderLabel={c => `${c}${crMap.get(c) ? ` — ${crMap.get(c)!.DESCRCENCUS}` : ""}`}
                isChecked={c => rascunho.cr.includes(c)}
                onToggle={(c, v) => setRascunho(r => ({ ...r, cr: v ? [...r.cr, c] : r.cr.filter(x => x !== c) }))} />
              <FilterSection title="Empresa" count={rascunho.emp.length}
                onClear={() => setRascunho(r => ({ ...r, emp: [] }))}
                items={uniqEmp} renderLabel={c => `${c}${empMap.get(c) ? ` — ${empMap.get(c)!.RAZAOSOCIAL}` : ""}`}
                isChecked={c => rascunho.emp.includes(c)}
                onToggle={(c, v) => setRascunho(r => ({ ...r, emp: v ? [...r.emp, c] : r.emp.filter(x => x !== c) }))} />
              {uniqNu.length > 0 && (
                <FilterSection title="NUFIN" count={rascunho.nufin.length}
                  onClear={() => setRascunho(r => ({ ...r, nufin: [] }))}
                  items={uniqNu} renderLabel={c => c}
                  isChecked={c => rascunho.nufin.includes(c)}
                  onToggle={(c, v) => setRascunho(r => ({ ...r, nufin: v ? [...r.nufin, c] : r.nufin.filter(x => x !== c) }))} />
              )}
            </div>
            <div className="flex gap-3 px-4 py-4 border-t border-gray-200">
              <button onClick={() => setRascunho(filtrosVazios)}
                className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                Limpar tudo
              </button>
              <button onClick={() => { setFiltros(rascunho); setPg(1); setFilterOpen(false); }}
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
