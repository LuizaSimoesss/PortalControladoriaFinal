"use client";

import { useState, useMemo, useEffect } from "react";
import { Search } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { loadData, usePersistedData } from "@/lib/storage";
import { idbGet } from "@/lib/idb";
import type { LancamentoFinanceiro, Fechamento, NaturezaRow, ParceiroRow } from "@/lib/mockData";

type Aba = "gestao" | "consultoria";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const ABA_LABEL: Record<Aba, string> = {
  gestao:      "Gestão de Fundos",
  consultoria: "Consultoria Especializada",
};

// Substring to match in DESCRNAT (case-insensitive)
const ABA_DESCRNAT: Record<Aba, string> = {
  gestao:      "gestão de fundos",
  consultoria: "consultoria especializada",
};

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

  const natMap  = useMemo(() => new Map(natRows.map(r => [r.CODNAT,  r])),           [natRows]);
  const parcMap = useMemo(() => new Map(parcRows.map(r => [r.CODPARC, r.NOMEPARC])), [parcRows]);

  // Natureza codes that match each tab by DESCRNAT
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

  // Filter by natureza codes of the active tab
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

  // Unique parceiros (including "" for sem parceiro)
  const parceiros = useMemo(() => {
    const set = new Set<string>();
    filtrados.forEach(l => set.add(l.codparc ?? ""));
    return [...set].sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [filtrados]);

  // Pivot: parceiro -> periodo -> total
  const pivot = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const l of filtrados) {
      const parc = l.codparc ?? "";
      if (!map.has(parc)) map.set(parc, new Map());
      const inner = map.get(parc)!;
      inner.set(l.periodo, (inner.get(l.periodo) ?? 0) + l.valor);
    }
    return map;
  }, [filtrados]);

  // Column totals
  const colTotals = useMemo(() => {
    const tot = new Map<string, number>();
    periodos.forEach(p => {
      let sum = 0;
      parceiros.forEach(parc => { sum += pivot.get(parc)?.get(p) ?? 0; });
      tot.set(p, sum);
    });
    return tot;
  }, [pivot, parceiros, periodos]);

  // Row totals
  const rowTotals = useMemo(() => {
    const tot = new Map<string, number>();
    parceiros.forEach(parc => {
      const inner = pivot.get(parc);
      tot.set(parc, inner ? Array.from(inner.values()).reduce((s, v) => s + v, 0) : 0);
    });
    return tot;
  }, [pivot, parceiros]);

  const grandTotal = useMemo(() =>
    Array.from(colTotals.values()).reduce((s, v) => s + v, 0),
    [colTotals]
  );

  // Naturezas matched (for info display)
  const natCodsAtivos = aba === "gestao" ? natCodsGestao : natCodsConsultoria;
  const natMatchadas = useMemo(() =>
    natRows.filter(r => natCodsAtivos.has(r.CODNAT)),
    [natRows, natCodsAtivos]
  );

  // Filter parceiros by busca
  const parceirosFiltered = useMemo(() => {
    if (!busca.trim()) return parceiros;
    const q = busca.toLowerCase();
    return parceiros.filter(p => {
      if (!p) return "sem parceiro".includes(q);
      return p.toLowerCase().includes(q) || (parcMap.get(p) ?? "").toLowerCase().includes(q);
    });
  }, [parceiros, busca, parcMap]);

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
              placeholder="Buscar parceiro…"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <span className="ml-auto text-xs text-gray-400">
            {parceirosFiltered.length} parceiro{parceirosFiltered.length !== 1 ? "s" : ""}
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
                ? <>Nenhuma natureza encontrada com <span className="font-semibold">"{ABA_LABEL[aba]}"</span> na descrição.</>
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
                    <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky left-0 z-20 min-w-[240px]"
                      style={{ background: "#1e3a5f" }}>
                      Parceiro
                    </th>
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
                  {parceirosFiltered.map((parc, i) => {
                    const inner  = pivot.get(parc);
                    const rowTot = rowTotals.get(parc) ?? 0;
                    const nome   = parc ? (parcMap.get(parc) ?? parc) : "Sem parceiro";
                    const rowBg  = i % 2 === 0 ? "white" : "#f9fafb";

                    return (
                      <tr key={parc || "__sem__"}
                        className="border-b border-gray-50 hover:bg-blue-50/40 transition-colors"
                        style={{ background: rowBg }}>

                        <td className="px-4 py-2 sticky left-0 z-10 border-r border-gray-100"
                          style={{ background: rowBg }}>
                          <div className="flex flex-col">
                            {parc
                              ? <>
                                  <span className="font-mono text-xs text-blue-700 font-semibold">{parc}</span>
                                  <span className="text-xs text-gray-600 truncate max-w-[200px]" title={nome}>{nome}</span>
                                </>
                              : <span className="text-xs text-gray-400 italic">Sem parceiro</span>
                            }
                          </div>
                        </td>

                        {periodos.map(p => {
                          const v = inner?.get(p) ?? 0;
                          return (
                            <td key={p} className="px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap">
                              {fmtBRLCell(v)}
                            </td>
                          );
                        })}

                        <td className={`px-4 py-2 text-right tabular-nums text-xs font-semibold whitespace-nowrap border-l border-gray-100 ${rowTot < 0 ? "text-red-600" : "text-gray-800"}`}>
                          {fmtBRL(rowTot)}
                        </td>
                      </tr>
                    );
                  })}

                  {parceirosFiltered.length === 0 && (
                    <tr>
                      <td colSpan={periodos.length + 2} className="px-4 py-10 text-center text-gray-400 text-sm">
                        Nenhum parceiro encontrado para "{busca}".
                      </td>
                    </tr>
                  )}
                </tbody>

                {parceirosFiltered.length > 0 && (
                  <tfoot>
                    <tr style={{ background: "#f0f4f8" }}>
                      <td className="px-4 py-2.5 text-xs font-bold text-gray-700 uppercase tracking-wide sticky left-0 z-10 border-t border-gray-200 border-r border-gray-100"
                        style={{ background: "#f0f4f8" }}>
                        Total
                      </td>
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
