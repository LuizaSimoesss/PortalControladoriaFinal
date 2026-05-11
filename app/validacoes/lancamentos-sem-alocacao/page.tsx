"use client";

import { useState, useMemo, useEffect } from "react";
import { Search, ChevronLeft, ChevronRight, Filter, ChevronDown } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { loadData, usePersistedData } from "@/lib/storage";
import { idbGet } from "@/lib/idb";
import type {
  LancamentoFinanceiro, Fechamento,
  NaturezaRow, CentroResultadoRow, EmpresaRow,
  ProjetoRow, ParceiroRow,
} from "@/lib/mockData";

// ─── DRE types ───────────────────────────────────────────────────────────────

type ItemTipo = "SUBTOTAL" | "CONTA";
type RegraMode = "none" | "especifico" | "intervalo";

interface RegraItem { modo: RegraMode; codEspecifico?: string; codDe?: string; codAte?: string }
interface RegrasLinha { centroResultado?: RegraItem; natureza?: RegraItem }
interface FormulaItem { subtotalId: string; sinal: "+" | "-" }

interface DemoItem {
  id: string; nivel: number; tipo: ItemTipo; descricao: string;
  regras?: RegrasLinha; formula?: FormulaItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function hasEffectiveRule(regra: RegraItem | undefined): boolean {
  if (!regra || regra.modo === "none") return false;
  if (regra.modo === "especifico") return !!regra.codEspecifico;
  if (regra.modo === "intervalo") return !!(regra.codDe || regra.codAte);
  return false;
}

function matchesRegra(cod: string, regra: RegraItem | undefined): boolean {
  if (!regra || regra.modo === "none") return true;
  if (regra.modo === "especifico") return regra.codEspecifico ? cod === regra.codEspecifico : true;
  if (regra.modo === "intervalo") {
    const cmp = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    if (regra.codDe && cmp(cod, regra.codDe) < 0) return false;
    if (regra.codAte && cmp(cod, regra.codAte) > 0) return false;
    return true;
  }
  return true;
}

function findNaoAlocados(dre: DemoItem[], lancamentos: LancamentoFinanceiro[]): Set<string> {
  const alocados = new Set<string>();
  for (const item of dre) {
    if (item.tipo !== "CONTA") continue;
    const hasNat = hasEffectiveRule(item.regras?.natureza);
    const hasCr  = hasEffectiveRule(item.regras?.centroResultado);
    if (!hasNat && !hasCr) continue;
    for (const l of lancamentos) {
      const natMatch = !hasNat || matchesRegra(l.codnat, item.regras?.natureza);
      const crMatch  = !hasCr  || matchesRegra(l.codcencus, item.regras?.centroResultado);
      if (natMatch && crMatch) alocados.add(l.id);
    }
  }
  return new Set(lancamentos.filter(l => !alocados.has(l.id)).map(l => l.id));
}

type EntradaResultado = "DRE" | "DFC" | "AMBOS" | "NÃO ENTRA" | "—";
type Resultado = "ENTRA" | "NÃO ENTRA";

function toER(v: string | undefined): EntradaResultado {
  if (!v) return "—";
  if (v === "DRE" || v === "DFC" || v === "AMBOS" || v === "NÃO ENTRA") return v;
  return "—";
}

const DISQUALIFICA: EntradaResultado[] = ["DFC", "NÃO ENTRA", "—"];

function calcResultado(natER: EntradaResultado, crER: EntradaResultado, empER: EntradaResultado): Resultado {
  if (DISQUALIFICA.includes(natER) || DISQUALIFICA.includes(crER) || DISQUALIFICA.includes(empER)) return "NÃO ENTRA";
  return "ENTRA";
}

const entradaBadge: Record<EntradaResultado, { label: string; bg: string; color: string }> = {
  "DRE":       { label: "DRE",      bg: "#dbeafe", color: "#1e40af" },
  "DFC":       { label: "DFC",      bg: "#dcfce7", color: "#166534" },
  "AMBOS":     { label: "AMBOS",    bg: "#fef9c3", color: "#713f12" },
  "NÃO ENTRA": { label: "NÃO ENTRA", bg: "#fee2e2", color: "#991b1b" },
  "—":         { label: "—",        bg: "#f1f5f9", color: "#64748b" },
};

const resultadoBadge: Record<Resultado, { label: string; bg: string; color: string }> = {
  "ENTRA":     { label: "ENTRA",     bg: "#dcfce7", color: "#166534" },
  "NÃO ENTRA": { label: "NÃO ENTRA", bg: "#fee2e2", color: "#991b1b" },
};

// ─── Filter helpers ──────────────────────────────────────────────────────────

interface Filtros {
  nat: string[]; cr: string[]; emp: string[]; nufin: string[];
  periodo: string[];
  entradaNat: string[]; entradaCR: string[]; entradaEmp: string[];
  resultado: string[];
  dataInicio: string; dataFim: string;
}
const filtrosVazios: Filtros = {
  nat: [], cr: [], emp: [], nufin: [], periodo: [],
  entradaNat: [], entradaCR: [], entradaEmp: [],
  resultado: [],
  dataInicio: "", dataFim: "",
};

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

// ─── Página ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;

export default function LancamentosSemAlocacaoPage() {
  const [dre] = usePersistedData<DemoItem[]>("portal_dre", []);
  const [fechamentos] = usePersistedData<Fechamento[]>("portal_fechamentos", []);

  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const natRows  = useMemo(() => loadData<NaturezaRow[]>("portal_natureza", []), []);
  const crRows   = useMemo(() => loadData<CentroResultadoRow[]>("portal_centro_resultado", []), []);
  const empRows  = useMemo(() => loadData<EmpresaRow[]>("portal_empresas", []), []);
  const projRows = useMemo(() => loadData<ProjetoRow[]>("portal_projetos", []), []);
  const parcRows = useMemo(() => loadData<ParceiroRow[]>("portal_parceiro", []), []);

  const natMap  = useMemo(() => new Map(natRows.map(r  => [r.CODNAT,    r])),  [natRows]);
  const crMap   = useMemo(() => new Map(crRows.map(r   => [r.CODCENCUS, r])),  [crRows]);
  const empMap  = useMemo(() => new Map(empRows.map(r  => [r.CODEMP,    r])),  [empRows]);
  const projMap = useMemo(() => new Map(projRows.map(r => [r.CODPROJ,   r.IDENTIFICACAO])), [projRows]);
  const parcMap = useMemo(() => new Map(parcRows.map(r => [r.CODPARC,   r.NOMEPARC])),      [parcRows]);
  const fechMap = useMemo(() => new Map(fechamentos.map(f => [f.id, f.label])),              [fechamentos]);

  const [fechamentoId, setFechamentoId] = useState("__todos__");
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(1);
  const [filtros, setFiltros] = useState<Filtros>(filtrosVazios);
  const [rascunho, setRascunho] = useState<Filtros>(filtrosVazios);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    const fallback = setTimeout(() => setDataLoaded(true), 400);
    idbGet<LancamentoFinanceiro[]>("portal_lancamentos_financeiro", []).then(loaded => {
      clearTimeout(fallback);
      setLancamentos(loaded);
      setDataLoaded(true);
    });
  }, []);

  const fechamentosRealizado = useMemo(
    () => fechamentos.filter(f => f.tipo === "realizado").sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)),
    [fechamentos]
  );

  const lancamentosRealizado = useMemo(
    () => lancamentos.filter(l => {
      if (l.tipo !== "realizado") return false;
      if (fechamentoId !== "__todos__" && l.fechamentoId !== fechamentoId) return false;
      return true;
    }),
    [lancamentos, fechamentoId]
  );

  const naoAlocadosIds = useMemo(
    () => findNaoAlocados(dre, lancamentosRealizado),
    [dre, lancamentosRealizado]
  );

  // Enriquece cada lançamento não alocado com as classificações dos cadastros
  const naoAlocados = useMemo(() => {
    return lancamentosRealizado
      .filter(l => naoAlocadosIds.has(l.id))
      .map(l => {
        const nat  = natMap.get(l.codnat);
        const cr   = crMap.get(l.codcencus);
        const emp  = empMap.get(l.codemp);
        return {
          ...l,
          natDescr:     nat?.DESCRNAT   ?? "",
          crDescr:      cr?.DESCRCENCUS ?? "",
          empDescr:     emp?.RAZAOSOCIAL ?? "",
          natER:     toER(nat?.ENTRA_RESULTADO),
          crER:      toER(cr?.ENTRA_RESULTADO),
          empER:     toER(emp?.ENTRA_RESULTADO),
          crClass:   cr?.CLASSIFICACAO  ?? "—",
          empClass:  emp?.AD_EMPCLASS   ?? "—",
          resultado: calcResultado(toER(nat?.ENTRA_RESULTADO), toER(cr?.ENTRA_RESULTADO), toER(emp?.ENTRA_RESULTADO)) as Resultado,
        };
      });
  }, [lancamentosRealizado, naoAlocadosIds, natMap, crMap, empMap]);

  // Valores únicos para os filtros
  const uniqueNats        = useMemo(() => [...new Set(naoAlocados.map(l => l.codnat))].sort(), [naoAlocados]);
  const uniqueCrs         = useMemo(() => [...new Set(naoAlocados.map(l => l.codcencus))].sort(), [naoAlocados]);
  const uniqueEmps        = useMemo(() => [...new Set(naoAlocados.map(l => l.codemp))].sort(), [naoAlocados]);
  const uniqueNufins      = useMemo(() => [...new Set(naoAlocados.map(l => l.nufin).filter(Boolean))] as string[], [naoAlocados]);
  const uniquePeriods     = useMemo(() => [...new Set(naoAlocados.map(l => l.periodo))].sort(), [naoAlocados]);
  const opcoesEntrada: EntradaResultado[] = ["DRE", "DFC", "AMBOS", "NÃO ENTRA", "—"];

  const filtrosAtivos = useMemo(() => {
    let n = 0;
    if (filtros.nat.length)        n += filtros.nat.length;
    if (filtros.cr.length)         n += filtros.cr.length;
    if (filtros.emp.length)        n += filtros.emp.length;
    if (filtros.nufin.length)      n += filtros.nufin.length;
    if (filtros.periodo.length)    n += filtros.periodo.length;
    if (filtros.entradaNat.length) n += filtros.entradaNat.length;
    if (filtros.entradaCR.length)  n += filtros.entradaCR.length;
    if (filtros.entradaEmp.length) n += filtros.entradaEmp.length;
    if (filtros.resultado.length)  n += filtros.resultado.length;
    if (filtros.dataInicio)        n++;
    if (filtros.dataFim)           n++;
    return n;
  }, [filtros]);

  const filtrados = useMemo(() => {
    return naoAlocados.filter(l => {
      if (filtros.nat.length        && !filtros.nat.includes(l.codnat))          return false;
      if (filtros.cr.length         && !filtros.cr.includes(l.codcencus))        return false;
      if (filtros.emp.length        && !filtros.emp.includes(l.codemp))          return false;
      if (filtros.nufin.length      && !filtros.nufin.includes(l.nufin ?? ""))   return false;
      if (filtros.periodo.length    && !filtros.periodo.includes(l.periodo))      return false;
      if (filtros.entradaNat.length && !filtros.entradaNat.includes(l.natER))       return false;
      if (filtros.entradaCR.length  && !filtros.entradaCR.includes(l.crER))         return false;
      if (filtros.entradaEmp.length && !filtros.entradaEmp.includes(l.empER))       return false;
      if (filtros.resultado.length  && !filtros.resultado.includes(l.resultado))    return false;
      if (filtros.dataInicio        && l.data < filtros.dataInicio)               return false;
      if (filtros.dataFim           && l.data > filtros.dataFim)                  return false;
      if (busca.trim()) {
        const q = busca.toLowerCase();
        const hit =
          l.codnat.toLowerCase().includes(q) ||
          l.natDescr.toLowerCase().includes(q) ||
          l.codcencus.toLowerCase().includes(q) ||
          l.crDescr.toLowerCase().includes(q) ||
          l.codemp.toLowerCase().includes(q) ||
          l.empDescr.toLowerCase().includes(q) ||
          (l.codproj ?? "").toLowerCase().includes(q) ||
          (projMap.get(l.codproj ?? "") ?? "").toLowerCase().includes(q) ||
          (l.codparc ?? "").toLowerCase().includes(q) ||
          (parcMap.get(l.codparc ?? "") ?? "").toLowerCase().includes(q) ||
          (l.nufin ?? "").toLowerCase().includes(q) ||
          l.periodo.includes(q) ||
          l.data.includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [naoAlocados, filtros, busca, projMap, parcMap]);

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const pageData   = filtrados.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalFiltrado = useMemo(() => filtrados.reduce((s, l) => s + l.valor, 0), [filtrados]);

  function handleBusca(v: string) { setBusca(v); setPage(1); }
  function handleFech(v: string)  { setFechamentoId(v); setPage(1); setFiltros(filtrosVazios); setRascunho(filtrosVazios); }
  function aplicar()              { setFiltros(rascunho); setPage(1); setFilterOpen(false); }
  function limparTudo()           { setRascunho(filtrosVazios); }

  if (!dataLoaded) {
    return (
      <div>
        <PageHeader title="Lançamentos sem Alocação" subtitle="Validação · Realizado" />
        <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">Carregando lançamentos…</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Lançamentos sem Alocação" subtitle="Validação · Realizado" />

      <div className="p-6 space-y-5">

        {/* ── Controles ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={fechamentoId}
            onChange={e => handleFech(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="__todos__">Todos os fechamentos</option>
            {fechamentosRealizado.map(f => (
              <option key={f.id} value={f.id}>{f.ativo ? `★ ${f.label}` : f.label}</option>
            ))}
          </select>

          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por código, descrição, NUFIN…"
              value={busca}
              onChange={e => handleBusca(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Botão filtro */}
          <div className="relative">
            <button
              onClick={() => { setRascunho(filtros); setFilterOpen(true); }}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
              style={filtrosAtivos > 0 ? { borderColor: "#1e3a5f", color: "#1e3a5f" } : {}}
            >
              <Filter size={14} />
              Filtros
              {filtrosAtivos > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full text-white" style={{ background: "#1e3a5f" }}>{filtrosAtivos}</span>
              )}
            </button>
          </div>

          <span className="ml-auto text-xs text-gray-400">
            {filtrados.length.toLocaleString("pt-BR")} de {naoAlocados.length.toLocaleString("pt-BR")} lançamento{naoAlocados.length !== 1 ? "s" : ""}
          </span>
        </div>


        {naoAlocados.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-gray-100 text-center">
            <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mb-3">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-gray-700 font-medium">Todos os lançamentos estão alocados</p>
            <p className="text-gray-400 text-sm mt-1">Nenhum lançamento sem correspondência na estrutura DRE.</p>
          </div>
        )}

        {/* ── Tabela ──────────────────────────────────────────────────────── */}
        {naoAlocados.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-gray-800 text-sm">Detalhamento</span>
              <span className="text-xs text-gray-400">
                Total filtrado: <span className="font-semibold tabular-nums text-gray-700">{fmtBRL(totalFiltrado)}</span>
              </span>
            </div>

            <div className="overflow-x-auto overflow-y-auto max-h-[60vh] scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
              <table className="w-full text-sm border-collapse min-w-max">
                <thead>
                  <tr style={{ background: "#1e3a5f" }}>
                    {["Fechamento","Data","Natureza","Descr. Natureza","C. Resultado","Descr. CR","Empresa","Razão Social","Cód. Projeto","Identificação","Cód. Parceiro","Nome Parceiro","NUFIN","Nat.","CR","Emp.","Resultado","Valor"].map((h, hi) => (
                      <th key={hi}
                        className={`font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 sticky top-0 z-10 whitespace-nowrap ${hi === 17 ? "text-right" : hi >= 13 && hi <= 16 ? "text-center" : "text-left"}`}
                        style={{ background: "#1e3a5f" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageData.map((l, i) => {
                    return (
                      <tr key={l.id}
                        className="border-b border-gray-50 hover:bg-blue-50/40 transition-colors"
                        style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}
                      >
                          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap max-w-[140px] truncate" title={fechMap.get(l.fechamentoId ?? "") ?? "—"}>
                          {fechMap.get(l.fechamentoId ?? "") ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">{fmtData(l.data)}</td>

                        {/* Natureza */}
                        <td className="px-3 py-2 text-xs font-mono text-gray-700 whitespace-nowrap">{l.codnat || <span className="text-red-400 font-sans">vazio</span>}</td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-[200px] truncate" title={l.natDescr}>{l.natDescr || <span className="text-gray-300">—</span>}</td>

                        {/* Centro de Resultado */}
                        <td className="px-3 py-2 text-xs font-mono text-gray-700 whitespace-nowrap">{l.codcencus || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-[200px] truncate" title={l.crDescr}>{l.crDescr || <span className="text-gray-300">—</span>}</td>

                        {/* Empresa */}
                        <td className="px-3 py-2 text-xs font-mono text-gray-700 whitespace-nowrap">{l.codemp || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-[180px] truncate" title={l.empDescr}>{l.empDescr || <span className="text-gray-300">—</span>}</td>

                        {/* Projeto */}
                        <td className="px-3 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">
                          {l.codproj || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-[180px] truncate" title={projMap.get(l.codproj ?? "") ?? ""}>
                          {l.codproj ? (projMap.get(l.codproj) ?? <span className="text-gray-300">—</span>) : <span className="text-gray-300">—</span>}
                        </td>

                        {/* Parceiro */}
                        <td className="px-3 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">
                          {l.codparc || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-[180px] truncate" title={parcMap.get(l.codparc ?? "") ?? ""}>
                          {l.codparc ? (parcMap.get(l.codparc) ?? <span className="text-gray-300">—</span>) : <span className="text-gray-300">—</span>}
                        </td>

                        <td className="px-3 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">
                          {l.nufin || <span className="text-gray-300">—</span>}
                        </td>

                        {/* Entra em — Natureza / CR / Empresa separados */}
                        {([l.natER, l.crER, l.empER] as EntradaResultado[]).map((er, bi) => {
                          const b = entradaBadge[er] ?? entradaBadge["—"];
                          return (
                            <td key={bi} className="px-2 py-2 text-center whitespace-nowrap">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold"
                                style={{ background: b.bg, color: b.color }}>
                                {b.label}
                              </span>
                            </td>
                          );
                        })}

                        {/* Resultado */}
                        <td className="px-2 py-2 text-center whitespace-nowrap">
                          {(() => { const b = resultadoBadge[l.resultado] ?? resultadoBadge["NÃO ENTRA"]; return (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold"
                              style={{ background: b.bg, color: b.color }}>
                              {b.label}
                            </span>
                          ); })()}
                        </td>

                        <td className={`px-3 py-2 text-sm tabular-nums font-medium text-right whitespace-nowrap ${l.valor < 0 ? "text-red-600" : "text-gray-800"}`}>
                          {fmtBRL(l.valor)}
                        </td>
                      </tr>
                    );
                  })}
                  {pageData.length === 0 && (
                    <tr>
                      <td colSpan={18} className="px-4 py-10 text-center text-gray-400 text-sm">
                        Nenhum resultado para os filtros aplicados.
                      </td>
                    </tr>
                  )}
                </tbody>
                {filtrados.length > 0 && (
                  <tfoot>
                    <tr style={{ background: "#f8fafc" }}>
                      <td colSpan={17} className="px-3 py-2.5 text-xs font-semibold text-gray-600 text-right uppercase tracking-wide">
                        Total ({filtrados.length.toLocaleString("pt-BR")} lançamentos)
                      </td>
                      <td className={`px-3 py-2.5 text-sm tabular-nums font-bold text-right ${totalFiltrado < 0 ? "text-red-600" : "text-gray-800"}`}>
                        {fmtBRL(totalFiltrado)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Paginação */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  Página {page} de {totalPages} · {filtrados.length.toLocaleString("pt-BR")} registros
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors">
                    <ChevronLeft size={14} />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const pg = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
                    return (
                      <button key={pg} onClick={() => setPage(pg)}
                        className="w-7 h-7 rounded text-xs font-medium transition-colors"
                        style={pg === page ? { background: "#0078D4", color: "white" } : { color: "#374151" }}>
                        {pg}
                      </button>
                    );
                  })}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
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
              <span className="font-semibold text-gray-800">Filtros</span>
              <button onClick={() => setFilterOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Data */}
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

              <FilterSection title="Resultado" count={rascunho.resultado.length}
                onClear={() => setRascunho(r => ({ ...r, resultado: [] }))}
                items={["ENTRA", "NÃO ENTRA"]}
                renderLabel={c => c}
                isChecked={c => rascunho.resultado.includes(c)}
                onToggle={(c, v) => setRascunho(r => ({ ...r, resultado: v ? [...r.resultado, c] : r.resultado.filter(x => x !== c) }))} />

              <FilterSection title="Entra em (Natureza)" count={rascunho.entradaNat.length}
                onClear={() => setRascunho(r => ({ ...r, entradaNat: [] }))}
                items={opcoesEntrada}
                renderLabel={c => c}
                isChecked={c => rascunho.entradaNat.includes(c)}
                onToggle={(c, v) => setRascunho(r => ({ ...r, entradaNat: v ? [...r.entradaNat, c] : r.entradaNat.filter(x => x !== c) }))} />

              <FilterSection title="Entra em (C. Resultado)" count={rascunho.entradaCR.length}
                onClear={() => setRascunho(r => ({ ...r, entradaCR: [] }))}
                items={opcoesEntrada}
                renderLabel={c => c}
                isChecked={c => rascunho.entradaCR.includes(c)}
                onToggle={(c, v) => setRascunho(r => ({ ...r, entradaCR: v ? [...r.entradaCR, c] : r.entradaCR.filter(x => x !== c) }))} />

              <FilterSection title="Entra em (Empresa)" count={rascunho.entradaEmp.length}
                onClear={() => setRascunho(r => ({ ...r, entradaEmp: [] }))}
                items={opcoesEntrada}
                renderLabel={c => c}
                isChecked={c => rascunho.entradaEmp.includes(c)}
                onToggle={(c, v) => setRascunho(r => ({ ...r, entradaEmp: v ? [...r.entradaEmp, c] : r.entradaEmp.filter(x => x !== c) }))} />

              <FilterSection title="Período" count={rascunho.periodo.length}
                onClear={() => setRascunho(r => ({ ...r, periodo: [] }))}
                items={uniquePeriods}
                renderLabel={c => periodoLabel(c)}
                isChecked={c => rascunho.periodo.includes(c)}
                onToggle={(c, v) => setRascunho(r => ({ ...r, periodo: v ? [...r.periodo, c] : r.periodo.filter(x => x !== c) }))} />

              <FilterSection title="Natureza" count={rascunho.nat.length}
                onClear={() => setRascunho(r => ({ ...r, nat: [] }))}
                items={uniqueNats}
                renderLabel={c => `${c}${natMap.get(c) ? ` — ${natMap.get(c)!.DESCRNAT}` : ""}`}
                isChecked={c => rascunho.nat.includes(c)}
                onToggle={(c, v) => setRascunho(r => ({ ...r, nat: v ? [...r.nat, c] : r.nat.filter(x => x !== c) }))} />

              <FilterSection title="Centro de Resultado" count={rascunho.cr.length}
                onClear={() => setRascunho(r => ({ ...r, cr: [] }))}
                items={uniqueCrs}
                renderLabel={c => `${c}${crMap.get(c) ? ` — ${crMap.get(c)!.DESCRCENCUS}` : ""}`}
                isChecked={c => rascunho.cr.includes(c)}
                onToggle={(c, v) => setRascunho(r => ({ ...r, cr: v ? [...r.cr, c] : r.cr.filter(x => x !== c) }))} />

              <FilterSection title="Empresa" count={rascunho.emp.length}
                onClear={() => setRascunho(r => ({ ...r, emp: [] }))}
                items={uniqueEmps}
                renderLabel={c => `${c}${empMap.get(c) ? ` — ${empMap.get(c)!.RAZAOSOCIAL}` : ""}`}
                isChecked={c => rascunho.emp.includes(c)}
                onToggle={(c, v) => setRascunho(r => ({ ...r, emp: v ? [...r.emp, c] : r.emp.filter(x => x !== c) }))} />

              {uniqueNufins.length > 0 && (
                <FilterSection title="NUFIN" count={rascunho.nufin.length}
                  onClear={() => setRascunho(r => ({ ...r, nufin: [] }))}
                  items={uniqueNufins}
                  renderLabel={c => c}
                  isChecked={c => rascunho.nufin.includes(c)}
                  onToggle={(c, v) => setRascunho(r => ({ ...r, nufin: v ? [...r.nufin, c] : r.nufin.filter(x => x !== c) }))} />
              )}
            </div>

            <div className="flex gap-3 px-4 py-4 border-t border-gray-200">
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
