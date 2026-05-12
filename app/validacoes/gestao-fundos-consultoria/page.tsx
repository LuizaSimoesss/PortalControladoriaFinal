"use client";

import { useState, useMemo, useEffect } from "react";
import { Search } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { loadData, usePersistedData } from "@/lib/storage";
import { idbGet } from "@/lib/idb";
import type { LancamentoFinanceiro, Fechamento, NaturezaRow, ParceiroRow, ProjetoRow } from "@/lib/mockData";

type Aba = "gestao" | "consultoria";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const ABA_LABEL: Record<Aba, string> = {
  gestao:      "Gestão de Fundos",
  consultoria: "Consultoria Especializada",
};

const ABA_DESCRNAT: Record<Aba, string> = {
  gestao:      "gestão de fundos",
  consultoria: "consultoria especializada",
};

// Row key = "CODPARC|CODPROJ" (either may be "")
function rowKey(codparc: string | undefined, codproj: string | undefined) {
  return `${codparc ?? ""}|${codproj ?? ""}`;
}

function periodoLabel(p: string) {
  if (!p) return "—";
  const [y, m] = p.split("-");
  return `${MESES[parseInt(m) - 1]}/${y.slice(2)}`;
}

function fmtBRLCell(v: number) {
  if (v === 0) return <span className="text-gray-300">—</span>;
  return (
    <span className={v < 0 ? "text-red-600" : undefined}>
      {v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
    </span>
  );
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function GestaoFundosConsultoriaPage() {
  const [aba, setAba] = useState<Aba>("gestao");
  const [fechamentos] = usePersistedData<Fechamento[]>("portal_fechamentos", []);
  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [fechamentoId, setFechamentoId] = useState("__todos__");
  const [busca, setBusca] = useState("");

  const natRows  = useMemo(() => loadData<NaturezaRow[]>("portal_natureza", []), []);
  const parcRows = useMemo(() => loadData<ParceiroRow[]>("portal_parceiro", []), []);
  const projRows = useMemo(() => loadData<ProjetoRow[]>("portal_projetos", []), []);

  const natMap  = useMemo(() => new Map(natRows.map(r  => [r.CODNAT,  r])),                         [natRows]);
  const parcMap = useMemo(() => new Map(parcRows.map(r => [r.CODPARC, r.NOMEPARC])),                [parcRows]);
  const projMap = useMemo(() => new Map(projRows.map(r => [r.CODPROJ, r.IDENTIFICACAO])),           [projRows]);

  const natCodsGestao = useMemo(() =>
    new Set(natRows.filter(r => r.DESCRNAT.toLowerCase().includes(ABA_DESCRNAT.gestao)).map(r => r.CODNAT)),
    [natRows]
  );
  const natCodsConsultoria = useMemo(() =>
    new Set(natRows.filter(r => r.DESCRNAT.toLowerCase().includes(ABA_DESCRNAT.consultoria)).map(r => r.CODNAT)),
    [natRows]
  );

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

  const lancamentosBase = useMemo(() =>
    lancamentos.filter(l => {
      if (l.tipo !== "realizado") return false;
      if (fechamentoId !== "__todos__" && l.fechamentoId !== fechamentoId) return false;
      return true;
    }),
    [lancamentos, fechamentoId]
  );

  const natCods = aba === "gestao" ? natCodsGestao : natCodsConsultoria;
  const filtrados = useMemo(() =>
    lancamentosBase.filter(l => natCods.has(l.codnat)),
    [lancamentosBase, natCods]
  );

  // Unique periods sorted
  const periodos = useMemo(() =>
    [...new Set(filtrados.map(l => l.periodo))].sort(),
    [filtrados]
  );

  // Unique row keys (parceiro + projeto), sorted by parceiro then projeto
  const rowKeys = useMemo(() => {
    const set = new Set<string>();
    filtrados.forEach(l => set.add(rowKey(l.codparc, l.codproj)));
    return [...set].sort((a, b) => {
      const [pa, pja] = a.split("|");
      const [pb, pjb] = b.split("|");
      const cmpParc = (pa || "zzz").localeCompare(pb || "zzz", undefined, { numeric: true, sensitivity: "base" });
      if (cmpParc !== 0) return cmpParc;
      return (pja || "zzz").localeCompare(pjb || "zzz", undefined, { numeric: true, sensitivity: "base" });
    });
  }, [filtrados]);

  // Pivot: rowKey -> periodo -> total
  const pivot = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const l of filtrados) {
      const k = rowKey(l.codparc, l.codproj);
      if (!map.has(k)) map.set(k, new Map());
      const inner = map.get(k)!;
      inner.set(l.periodo, (inner.get(l.periodo) ?? 0) + l.valor);
    }
    return map;
  }, [filtrados]);

  // Column totals
  const colTotals = useMemo(() => {
    const tot = new Map<string, number>();
    periodos.forEach(p => {
      let sum = 0;
      rowKeys.forEach(k => { sum += pivot.get(k)?.get(p) ?? 0; });
      tot.set(p, sum);
    });
    return tot;
  }, [pivot, rowKeys, periodos]);

  // Row totals
  const rowTotals = useMemo(() => {
    const tot = new Map<string, number>();
    rowKeys.forEach(k => {
      const inner = pivot.get(k);
      tot.set(k, inner ? Array.from(inner.values()).reduce((s, v) => s + v, 0) : 0);
    });
    return tot;
  }, [pivot, rowKeys]);

  const grandTotal = useMemo(() =>
    Array.from(colTotals.values()).reduce((s, v) => s + v, 0),
    [colTotals]
  );

  const natCodsAtivos = aba === "gestao" ? natCodsGestao : natCodsConsultoria;
  const natMatchadas = useMemo(() =>
    natRows.filter(r => natCodsAtivos.has(r.CODNAT)),
    [natRows, natCodsAtivos]
  );

  // Filter by busca (parceiro ou projeto)
  const rowKeysFiltered = useMemo(() => {
    if (!busca.trim()) return rowKeys;
    const q = busca.toLowerCase();
    return rowKeys.filter(k => {
      const [parc, proj] = k.split("|");
      const parcNome = parcMap.get(parc) ?? "";
      const projIdent = projMap.get(proj) ?? "";
      return (
        parc.toLowerCase().includes(q) ||
        parcNome.toLowerCase().includes(q) ||
        proj.toLowerCase().includes(q) ||
        projIdent.toLowerCase().includes(q)
      );
    });
  }, [rowKeys, busca, parcMap, projMap]);

  if (!dataLoaded) {
    return (
      <div>
        <PageHeader title="Gestão de Fundos / Consultoria" subtitle="Validação · Realizado por Parceiro" />
        <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">Carregando lançamentos…</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Gestão de Fundos / Consultoria" subtitle="Validação · Realizado por Parceiro" />

      {/* Abas */}
      <div className="flex gap-0 border-b border-slate-200 bg-white px-6">
        {(["gestao", "consultoria"] as Aba[]).map(a => (
          <button key={a}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
              aba === a ? "border-[#1e3a5f] text-[#1e3a5f]" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
            onClick={() => { setAba(a); setBusca(""); }}>
            {ABA_LABEL[a]}
          </button>
        ))}
      </div>

      <div className="p-6 space-y-5">

        {/* Controles */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={fechamentoId}
            onChange={e => setFechamentoId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="__todos__">Todos os fechamentos</option>
            {fechamentosRealizado.map(f => (
              <option key={f.id} value={f.id}>{f.ativo ? `★ ${f.label}` : f.label}</option>
            ))}
          </select>

          <div className="relative max-w-xs flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar parceiro ou projeto…"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <span className="ml-auto text-xs text-gray-400">
            {rowKeysFiltered.length} linha{rowKeysFiltered.length !== 1 ? "s" : ""}
            {" · "}
            {periodos.length} período{periodos.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Naturezas identificadas */}
        {natMatchadas.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-gray-400">Naturezas:</span>
            {natMatchadas.map(n => (
              <span key={n.CODNAT}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                {n.CODNAT} <span className="font-sans font-normal text-blue-500">— {n.DESCRNAT}</span>
              </span>
            ))}
          </div>
        )}

        {/* Sem dados */}
        {filtrados.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-gray-100 text-center">
            <p className="text-gray-500 font-medium">Nenhum lançamento encontrado</p>
            <p className="text-gray-400 text-sm mt-1">
              {natMatchadas.length === 0
                ? <>Nenhuma natureza com <span className="font-semibold">"{ABA_LABEL[aba]}"</span> na descrição.</>
                : "Nenhum lançamento para as naturezas identificadas no período selecionado."
              }
            </p>
          </div>
        )}

        {/* Tabela pivot */}
        {filtrados.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-gray-800 text-sm">{ABA_LABEL[aba]} — Realizado por Parceiro</span>
              <span className="text-xs text-gray-400">
                Total geral:{" "}
                <span className={`font-semibold tabular-nums ${grandTotal < 0 ? "text-red-600" : "text-gray-700"}`}>
                  {fmtBRL(grandTotal)}
                </span>
              </span>
            </div>

            <div className="overflow-x-auto overflow-y-auto max-h-[65vh]">
              <table className="text-sm border-collapse min-w-max w-full">
                <thead>
                  <tr style={{ background: "#1e3a5f" }}>
                    {/* Col 1 — Parceiro */}
                    <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky left-0 z-20 min-w-[220px]"
                      style={{ background: "#1e3a5f" }}>
                      Parceiro
                    </th>
                    {/* Col 2 — Identificação (Projeto) */}
                    <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky z-20 min-w-[200px] border-l border-white/10"
                      style={{ background: "#1e3a5f", left: "220px" }}>
                      Identificação
                    </th>
                    {/* Month columns */}
                    {periodos.map(p => (
                      <th key={p}
                        className="font-semibold text-white/80 uppercase text-xs tracking-wide px-3 py-2.5 text-right whitespace-nowrap"
                        style={{ minWidth: "90px" }}>
                        {periodoLabel(p)}
                      </th>
                    ))}
                    <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-right whitespace-nowrap border-l border-white/20"
                      style={{ minWidth: "110px" }}>
                      Total
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rowKeysFiltered.map((k, i) => {
                    const [parc, proj] = k.split("|");
                    const inner   = pivot.get(k);
                    const rowTot  = rowTotals.get(k) ?? 0;
                    const parcNome = parc ? (parcMap.get(parc) ?? parc) : null;
                    const projIdent = proj ? (projMap.get(proj) ?? proj) : null;
                    const rowBg   = i % 2 === 0 ? "white" : "#f9fafb";

                    return (
                      <tr key={k}
                        className="border-b border-gray-50 hover:bg-blue-50/40 transition-colors"
                        style={{ background: rowBg }}>

                        {/* Parceiro — sticky col 1 */}
                        <td className="px-4 py-2 sticky left-0 z-10 border-r border-gray-100"
                          style={{ background: rowBg }}>
                          {parc
                            ? <div className="flex flex-col">
                                <span className="font-mono text-xs text-blue-700 font-semibold">{parc}</span>
                                <span className="text-xs text-gray-600 truncate max-w-[180px]" title={parcNome ?? ""}>{parcNome}</span>
                              </div>
                            : <span className="text-xs text-gray-400 italic">Sem parceiro</span>
                          }
                        </td>

                        {/* Identificação (Projeto) — sticky col 2 */}
                        <td className="px-4 py-2 sticky z-10 border-r border-gray-100"
                          style={{ background: rowBg, left: "220px" }}>
                          {proj
                            ? <div className="flex flex-col">
                                <span className="font-mono text-xs text-gray-500 font-semibold">{proj}</span>
                                <span className="text-xs text-gray-700 truncate max-w-[160px]" title={projIdent ?? ""}>{projIdent}</span>
                              </div>
                            : <span className="text-xs text-gray-300">—</span>
                          }
                        </td>

                        {/* Valores por mês */}
                        {periodos.map(p => {
                          const v = inner?.get(p) ?? 0;
                          return (
                            <td key={p} className="px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap">
                              {fmtBRLCell(v)}
                            </td>
                          );
                        })}

                        {/* Total da linha */}
                        <td className={`px-4 py-2 text-right tabular-nums text-xs font-semibold whitespace-nowrap border-l border-gray-100 ${rowTot < 0 ? "text-red-600" : "text-gray-800"}`}>
                          {fmtBRL(rowTot)}
                        </td>
                      </tr>
                    );
                  })}

                  {rowKeysFiltered.length === 0 && (
                    <tr>
                      <td colSpan={periodos.length + 3} className="px-4 py-10 text-center text-gray-400 text-sm">
                        Nenhum resultado para "{busca}".
                      </td>
                    </tr>
                  )}
                </tbody>

                {rowKeysFiltered.length > 0 && (
                  <tfoot>
                    <tr style={{ background: "#f0f4f8" }}>
                      <td className="px-4 py-2.5 text-xs font-bold text-gray-700 uppercase tracking-wide sticky left-0 z-10 border-t border-gray-200 border-r border-gray-100"
                        style={{ background: "#f0f4f8" }}>
                        Total
                      </td>
                      <td className="px-4 py-2.5 sticky z-10 border-t border-gray-200 border-r border-gray-100"
                        style={{ background: "#f0f4f8", left: "220px" }} />
                      {periodos.map(p => {
                        const v = colTotals.get(p) ?? 0;
                        return (
                          <td key={p} className={`px-3 py-2.5 text-right tabular-nums text-xs font-bold border-t border-gray-200 whitespace-nowrap ${v < 0 ? "text-red-600" : "text-gray-800"}`}>
                            {fmtBRL(v)}
                          </td>
                        );
                      })}
                      <td className={`px-4 py-2.5 text-right tabular-nums text-xs font-bold border-t border-gray-200 border-l border-gray-100 whitespace-nowrap ${grandTotal < 0 ? "text-red-600" : "text-gray-800"}`}>
                        {fmtBRL(grandTotal)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
