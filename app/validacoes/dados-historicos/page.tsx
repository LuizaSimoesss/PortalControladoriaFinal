"use client";

import { useState, useMemo, useEffect } from "react";
import { Search, ChevronLeft, ChevronRight, Filter, ChevronDown, Download } from "lucide-react";
import * as XLSX from "xlsx";
import PageHeader from "@/components/PageHeader";
import { usePersistedData } from "@/lib/storage";
import { idbGet } from "@/lib/idb";
import type {
  LancamentoFinanceiro,
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

function fmtPeriodo(p: string) {
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

// ─── Filter helpers ───────────────────────────────────────────────────────────

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

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface LanEnriquecido extends LancamentoFinanceiro {
  natDescr: string; crDescr: string; empDescr: string;
  natEntra: boolean; crEntra: boolean; empEntra: boolean;
  motivoExclusao: string;
  projNome: string; parcNome: string;
}

type SubAba = "nao-alocados" | "excluidos";
type DreTipo = "gerencial" | "contabil";
const PAGE_SIZE = 100;

function toRow(l: LanEnriquecido) {
  return {
    Período:          fmtPeriodo(l.periodo),
    Data:             fmtData(l.data),
    NUFIN:            l.nufin ?? "",
    Histórico:        l.historico ?? "",
    Natureza:         l.codnat,
    "Descr. Nat":     l.natDescr,
    CR:               l.codcencus,
    "Descr. CR":      l.crDescr,
    Empresa:          l.codemp ?? "",
    "Razão Social":   l.empDescr,
    Projeto:          l.codproj ?? "",
    Parceiro:         l.codparc ?? "",
    "Entra (Nat)":    l.natEntra ? "SIM" : "NÃO",
    "Entra (CR)":     l.crEntra  ? "SIM" : "NÃO",
    "Entra (Emp)":    l.empEntra ? "SIM" : "NÃO",
    "Motivo Exclusão": l.motivoExclusao,
    Valor:            l.valor,
  };
}

// ─── Análise de um DRE ────────────────────────────────────────────────────────

function useDreAnalise(
  dre: DemoItem[],
  lancamentosBase: LancamentoFinanceiro[],
  dataLoaded: boolean,
  natMap: Map<string, NaturezaRow>,
  crMap: Map<string, CentroResultadoRow>,
  empMap: Map<string, EmpresaRow>,
  projMap: Map<string, string>,
  parcMap: Map<string, string>,
) {
  function enriquecer(l: LancamentoFinanceiro): LanEnriquecido {
    const nat = natMap.get(l.codnat);
    const cr  = crMap.get(l.codcencus);
    const emp = empMap.get(l.codemp ?? "");
    const natEntra = entraNosDre(nat?.ENTRA_RESULTADO);
    const crEntra  = entraNosDre(cr?.ENTRA_RESULTADO);
    const empEntra = entraNosDre(emp?.ENTRA_RESULTADO); // false se empresa ausente ou não cadastrada
    const motivos: string[] = [];
    if (!natEntra) motivos.push(`Nat ${l.codnat}: ${nat?.ENTRA_RESULTADO ?? "não cadastrado"}`);
    if (!crEntra)  motivos.push(`CR ${l.codcencus}: ${cr?.ENTRA_RESULTADO ?? "não cadastrado"}`);
    if (!empEntra) motivos.push(`Emp ${l.codemp || "—"}: ${emp?.ENTRA_RESULTADO ?? "não cadastrado"}`);
    return {
      ...l,
      natDescr: nat?.DESCRNAT ?? "",
      crDescr:  cr?.DESCRCENCUS ?? "",
      empDescr: emp?.RAZAOSOCIAL ?? "",
      natEntra, crEntra, empEntra,
      motivoExclusao: motivos.join(" · ") || "—",
      projNome: projMap.get(l.codproj ?? "") ?? "",
      parcNome: parcMap.get(l.codparc ?? "") ?? "",
    };
  }

  const excluidos = useMemo<LanEnriquecido[]>(() => {
    if (!dataLoaded) return [];
    return lancamentosBase
      .filter(l => {
        const nat = natMap.get(l.codnat);
        const cr  = crMap.get(l.codcencus);
        const emp = empMap.get(l.codemp ?? "");
        // Excluído se qualquer um dos três NÃO está configurado como DRE/AMBOS
        return !entraNosDre(nat?.ENTRA_RESULTADO) ||
               !entraNosDre(cr?.ENTRA_RESULTADO)  ||
               !entraNosDre(emp?.ENTRA_RESULTADO);
      })
      .map(enriquecer);
  }, [lancamentosBase, dataLoaded, natMap, crMap, empMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidatos = useMemo(() => {
    if (!dataLoaded) return [];
    return lancamentosBase.filter(l => {
      const nat = natMap.get(l.codnat);
      const cr  = crMap.get(l.codcencus);
      const emp = empMap.get(l.codemp ?? "");
      // Candidato a não alocado: Nat, CR e Emp todos configurados como DRE/AMBOS
      return entraNosDre(nat?.ENTRA_RESULTADO) &&
             entraNosDre(cr?.ENTRA_RESULTADO)  &&
             entraNosDre(emp?.ENTRA_RESULTADO);
    });
  }, [lancamentosBase, dataLoaded, natMap, crMap, empMap]);

  const naoAlocadosIds = useMemo(
    () => findNaoAlocadosIds(dre, candidatos),
    [dre, candidatos]
  );

  const naoAlocados = useMemo<LanEnriquecido[]>(
    () => candidatos.filter(l => naoAlocadosIds.has(l.id)).map(enriquecer),
    [candidatos, naoAlocadosIds] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return { naoAlocados, excluidos };
}

// ─── Painel de uma DRE ────────────────────────────────────────────────────────

function DrePainel({
  naoAlocados, excluidos,
  natMap, crMap, empMap, titulo,
}: {
  naoAlocados: LanEnriquecido[];
  excluidos:   LanEnriquecido[];
  natMap: Map<string, NaturezaRow>;
  crMap:  Map<string, CentroResultadoRow>;
  empMap: Map<string, EmpresaRow>;
  titulo: string;
}) {
  const [subAba,     setSubAba]     = useState<SubAba>("nao-alocados");
  const [busca,      setBusca]      = useState("");
  const [page,       setPage]       = useState(1);
  const [filtros,    setFiltros]    = useState<Filtros>(filtrosVazios);
  const [rascunho,   setRascunho]   = useState<Filtros>(filtrosVazios);
  const [filterOpen, setFilterOpen] = useState(false);

  const source = subAba === "nao-alocados" ? naoAlocados : excluidos;
  const isNA   = subAba === "nao-alocados";

  const uniqNat = useMemo(() => [...new Set(source.map(l => l.codnat))].sort(), [source]);
  const uniqCr  = useMemo(() => [...new Set(source.map(l => l.codcencus))].sort(), [source]);
  const uniqEmp = useMemo(() => [...new Set(source.map(l => l.codemp).filter(Boolean))] as string[], [source]);
  const uniqNu  = useMemo(() => [...new Set(source.map(l => l.nufin).filter(Boolean))] as string[], [source]);
  const uniqPer = useMemo(() => [...new Set(source.map(l => l.periodo))].sort(), [source]);

  const filtrados = useMemo(() => source.filter(l => {
    if (filtros.nat.length    && !filtros.nat.includes(l.codnat))         return false;
    if (filtros.cr.length     && !filtros.cr.includes(l.codcencus))       return false;
    if (filtros.emp.length    && !filtros.emp.includes(l.codemp ?? ""))   return false;
    if (filtros.nufin.length  && !filtros.nufin.includes(l.nufin ?? ""))  return false;
    if (filtros.periodo.length && !filtros.periodo.includes(l.periodo))   return false;
    if (filtros.dataInicio    && l.data < filtros.dataInicio)             return false;
    if (filtros.dataFim       && l.data > filtros.dataFim)                return false;
    if (busca.trim()) {
      const q = busca.toLowerCase();
      if (![l.codnat, l.natDescr, l.codcencus, l.crDescr, l.codemp ?? "", l.empDescr,
             l.nufin ?? "", l.periodo, l.data, l.historico ?? ""]
          .some(v => v.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [source, filtros, busca]);

  const totalVal  = useMemo(() => filtrados.reduce((s, l) => s + l.valor, 0), [filtrados]);
  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const paged = filtrados.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page on source/filter change
  useEffect(() => { setPage(1); }, [subAba, busca, filtros]);

  function exportar() {
    const ws = XLSX.utils.json_to_sheet(filtrados.map(toRow));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, subAba === "nao-alocados" ? "Nao_Alocados" : "Excluidos");
    XLSX.writeFile(wb, `Validacao_${titulo.replace(/\s/g, "_")}_${subAba}.xlsx`);
  }

  const tabStyle = (a: SubAba) => {
    const active = subAba === a;
    if (a === "nao-alocados") return active
      ? { background: "#fef3c7", color: "#92400e", borderColor: "#fbbf24", borderBottom: "2px solid #fbbf24" }
      : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" };
    return active
      ? { background: "#dcfce7", color: "#166534", borderColor: "#4ade80", borderBottom: "2px solid #4ade80" }
      : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" };
  };

  return (
    <div className="space-y-3">

      {/* Sub-abas */}
      <div className="flex gap-0 border border-gray-200 rounded-xl overflow-hidden w-fit">
        <button onClick={() => setSubAba("nao-alocados")}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all"
          style={tabStyle("nao-alocados")}>
          <span>⚠</span>
          Não Alocados
          <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: "#fbbf24", color: "#78350f" }}>
            {naoAlocados.length.toLocaleString("pt-BR")}
          </span>
        </button>
        <button onClick={() => setSubAba("excluidos")}
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

      {/* Descrição */}
      <div className="rounded-lg px-4 py-2.5 text-xs"
        style={isNA
          ? { background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }
          : { background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}>
        {isNA
          ? "Lançamentos cujos Natureza, CR e Empresa estão configurados para entrar na DRE, mas nenhuma linha da estrutura DRE tem regra que os capture."
          : "Lançamentos excluídos da DRE porque sua Natureza, CR ou Empresa está configurada como Não Entra / DFC no cadastro."}
      </div>

      {/* Vazio */}
      {source.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 bg-white rounded-xl border border-gray-100 text-center">
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

      {/* Controles */}
      {source.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Buscar por código, NUFIN, histórico…" value={busca}
              onChange={e => setBusca(e.target.value)}
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
          <button onClick={exportar}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600 transition-colors">
            <Download size={14} />
            Exportar
          </button>
          <span className="ml-auto text-xs text-gray-400">
            {filtrados.length.toLocaleString("pt-BR")} de {source.length.toLocaleString("pt-BR")} lançamento{source.length !== 1 ? "s" : ""}
            {" · "}Total: <span className="font-semibold tabular-nums text-gray-700">{fmtBRL(totalVal)}</span>
          </span>
        </div>
      )}

      {/* Tabela */}
      {source.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "55vh" }}>
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
                    <td className="px-3 py-1.5 text-xs text-gray-600 whitespace-nowrap">{fmtPeriodo(l.periodo)}</td>
                    <td className="px-3 py-1.5 text-xs font-mono text-gray-600 whitespace-nowrap">{fmtData(l.data)}</td>
                    <td className="px-3 py-1.5 text-xs font-mono text-gray-600 whitespace-nowrap">{l.nufin ?? "—"}</td>
                    <td className="px-3 py-1.5 text-xs font-mono text-gray-700 whitespace-nowrap">{l.codnat}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-600 max-w-[160px] truncate" title={l.natDescr}>{l.natDescr || "—"}</td>
                    <td className="px-3 py-1.5 text-xs font-mono text-gray-700 whitespace-nowrap">{l.codcencus}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-600 max-w-[160px] truncate" title={l.crDescr}>{l.crDescr || "—"}</td>
                    <td className="px-3 py-1.5 text-xs font-mono text-gray-700 whitespace-nowrap">{l.codemp ?? "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-600 max-w-[160px] truncate" title={l.empDescr}>{l.empDescr || "—"}</td>
                    <td className="px-3 py-1.5 text-xs font-mono text-gray-500 whitespace-nowrap">{l.codproj ?? "—"}</td>
                    <td className="px-3 py-1.5 text-xs font-mono text-gray-500 whitespace-nowrap">{l.codparc ?? "—"}</td>
                    {isNA ? (
                      <>
                        {[l.natEntra, l.crEntra, l.empEntra].map((ok, bi) => (
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
              {filtrados.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#f8fafc" }}>
                    <td colSpan={14} className="px-3 py-2.5 text-xs font-semibold text-gray-600 text-right uppercase tracking-wide">
                      Total ({filtrados.length.toLocaleString("pt-BR")} lançamentos)
                    </td>
                    <td className={`px-3 py-2.5 text-sm tabular-nums font-bold text-right ${totalVal < 0 ? "text-red-600" : "text-gray-800"}`}>
                      {fmtBRL(totalVal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-400">Página {page} de {totalPages} · {filtrados.length.toLocaleString("pt-BR")} registros</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors">
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className="w-7 h-7 rounded text-xs font-medium transition-colors"
                      style={p === page ? { background: "#0078D4", color: "white" } : { color: "#374151" }}>
                      {p}
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

      {/* Filter Drawer */}
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
                items={uniqPer} renderLabel={fmtPeriodo}
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
              {uniqEmp.length > 0 && (
                <FilterSection title="Empresa" count={rascunho.emp.length}
                  onClear={() => setRascunho(r => ({ ...r, emp: [] }))}
                  items={uniqEmp} renderLabel={c => `${c}${empMap.get(c) ? ` — ${empMap.get(c)!.RAZAOSOCIAL}` : ""}`}
                  isChecked={c => rascunho.emp.includes(c)}
                  onToggle={(c, v) => setRascunho(r => ({ ...r, emp: v ? [...r.emp, c] : r.emp.filter(x => x !== c) }))} />
              )}
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
              <button onClick={() => { setFiltros(rascunho); setPage(1); setFilterOpen(false); }}
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

// ─── Página principal ─────────────────────────────────────────────────────────

export default function DadosHistoricosPage() {
  const [dreGer]     = usePersistedData<DemoItem[]>("portal_dre", []);
  const [dreCont]    = usePersistedData<DemoItem[]>("portal_dre_contabil", []);

  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([]);
  const [dataLoaded,  setDataLoaded]  = useState(false);
  const [dreTipo,     setDreTipo]     = useState<DreTipo>("gerencial");
  const [anoSel,      setAnoSel]      = useState<number>(2025);

  useEffect(() => {
    const fb = setTimeout(() => setDataLoaded(true), 400);
    idbGet<LancamentoFinanceiro[]>("portal_lancamentos_financeiro", []).then(d => {
      clearTimeout(fb); setLancamentos(d); setDataLoaded(true);
    });
  }, []);

  const anosDisponiveis = useMemo(() => {
    const s = new Set<number>();
    lancamentos.forEach(l => {
      if (l.tipo !== "realizado") return;
      const y = parseInt(l.periodo.split("-")[0]);
      if (!isNaN(y)) s.add(y);
    });
    return [...s].sort((a, b) => b - a);
  }, [lancamentos]);

  // Ajusta ano selecionado quando os dados carregam
  useEffect(() => {
    if (anosDisponiveis.length === 0) return;
    if (!anosDisponiveis.includes(anoSel)) setAnoSel(anosDisponiveis[0]);
  }, [anosDisponiveis]); // eslint-disable-line react-hooks/exhaustive-deps

  const [natRows]  = usePersistedData<NaturezaRow[]>("portal_natureza", []);
  const [crRows]   = usePersistedData<CentroResultadoRow[]>("portal_centro_resultado", []);
  const [empRows]  = usePersistedData<EmpresaRow[]>("portal_empresas", []);
  const [projRows] = usePersistedData<ProjetoRow[]>("portal_projetos", []);
  const [parcRows] = usePersistedData<ParceiroRow[]>("portal_parceiro", []);

  const natMap  = useMemo(() => new Map(natRows.map(r  => [r.CODNAT,    r])), [natRows]);
  const crMap   = useMemo(() => new Map(crRows.map(r   => [r.CODCENCUS, r])), [crRows]);
  const empMap  = useMemo(() => new Map(empRows.map(r  => [r.CODEMP,    r])), [empRows]);
  const projMap = useMemo(() => new Map(projRows.map(r => [r.CODPROJ,   r.IDENTIFICACAO])), [projRows]);
  const parcMap = useMemo(() => new Map(parcRows.map(r => [r.CODPARC,   r.NOMEPARC])), [parcRows]);

  const lancamentosBase = useMemo(() =>
    lancamentos.filter(l =>
      (l.tipo === "realizado" || !l.tipo) &&
      l.periodo.startsWith(String(anoSel))
    ),
    [lancamentos, anoSel]
  );

  const tituloAtual = dreTipo === "gerencial" ? "DRE Gerencial" : "DRE Contábil";

  const { naoAlocados: naoAlocGer, excluidos: exclGer } = useDreAnalise(
    dreGer, lancamentosBase, dataLoaded, natMap, crMap, empMap, projMap, parcMap
  );
  const { naoAlocados: naoAlocCont, excluidos: exclCont } = useDreAnalise(
    dreCont, lancamentosBase, dataLoaded, natMap, crMap, empMap, projMap, parcMap
  );

  const naoAlocados = dreTipo === "gerencial" ? naoAlocGer : naoAlocCont;
  const excluidos   = dreTipo === "gerencial" ? exclGer    : exclCont;

  function exportarCompleto() {
    const wb = XLSX.utils.book_new();
    const add = (data: LanEnriquecido[], name: string) =>
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.map(toRow)), name);
    add(naoAlocGer,  "Ger. Não Alocados");
    add(exclGer,     "Ger. Excluídos");
    add(naoAlocCont, "Cont. Não Alocados");
    add(exclCont,    "Cont. Excluídos");
    XLSX.writeFile(wb, `Validacao_Completa_${anoSel}.xlsx`);
  }

  if (!dataLoaded) {
    return (
      <div>
        <PageHeader title="Dados Históricos" subtitle="Validação" />
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
        <PageHeader title="Dados Históricos" subtitle="Validação" />
        <div className="p-6">
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-xl border border-gray-100">
            <p className="text-gray-500 font-medium">Nenhum lançamento realizado importado</p>
            <p className="text-gray-400 text-sm mt-1">Importe lançamentos em Lançamentos › Financeiro.</p>
          </div>
        </div>
      </div>
    );
  }

  const tabDreStyle = (t: DreTipo) => t === dreTipo
    ? { background: "#1e3a5f", color: "white" }
    : { background: "white", color: "#374151", border: "1px solid #e5e7eb" };

  return (
    <div>
      <PageHeader title="Dados Históricos" subtitle="Validação" />

      <div className="p-6 space-y-4">

        {/* Controles superiores */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Seletor de ano */}
          <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <span className="text-xs text-gray-400 font-medium">Ano</span>
            <select
              value={anoSel}
              onChange={e => setAnoSel(parseInt(e.target.value))}
              className="text-sm text-gray-700 bg-transparent focus:outline-none cursor-pointer font-semibold">
              {anosDisponiveis.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Abas DRE */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200 text-sm font-semibold">
            <button onClick={() => setDreTipo("gerencial")}
              className="px-4 py-2 transition-colors"
              style={tabDreStyle("gerencial")}>
              DRE Gerencial
            </button>
            <button onClick={() => setDreTipo("contabil")}
              className="px-4 py-2 transition-colors border-l border-gray-200"
              style={tabDreStyle("contabil")}>
              DRE Contábil
            </button>
          </div>

          <button
            onClick={exportarCompleto}
            className="ml-auto flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600 transition-colors">
            <Download size={14} />
            Exportar Completo
          </button>

          <span className="text-xs text-gray-400">
            {lancamentosBase.length.toLocaleString("pt-BR")} lançamentos em {anoSel}
          </span>
        </div>

        {/* Painel do DRE selecionado */}
        <DrePainel
          key={`${dreTipo}-${anoSel}`}
          naoAlocados={naoAlocados}
          excluidos={excluidos}
          natMap={natMap}
          crMap={crMap}
          empMap={empMap}
          titulo={`${tituloAtual}_${anoSel}`}
        />
      </div>
    </div>
  );
}
