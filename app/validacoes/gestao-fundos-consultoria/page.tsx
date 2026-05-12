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

// ── Consultoria: código → área ────────────────────────────────────────────────
const CONSULTORIA_MAP: Record<string, string> = {
  "10.01.01.01": "Real Estate",
  "10.01.01.02": "Private Equity & Venture Capital",
  "10.01.01.03": "Private Equity & Venture Capital",
  "10.01.01.04": "Crédito Privado",
  "10.01.01.06": "Líquidos",
};
const CONSULTORIA_CODS = new Set(Object.keys(CONSULTORIA_MAP));

// Ordem de exibição das áreas
const AREA_ORDER = [
  "Real Estate",
  "Private Equity & Venture Capital",
  "Crédito Privado",
  "Líquidos",
];

// ── Gestão de Fundos: match por DESCRNAT ──────────────────────────────────────
const GESTAO_DESCRNAT = "gestão de fundos";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Row key: "codparc|codproj|area" (area = "" para Gestão)
function mkKey(codparc?: string, codproj?: string, area?: string) {
  return `${codparc ?? ""}|${codproj ?? ""}|${area ?? ""}`;
}

// ── Área badge colors ─────────────────────────────────────────────────────────
const AREA_COLORS: Record<string, { bg: string; color: string }> = {
  "Real Estate":                        { bg: "#dbeafe", color: "#1e40af" },
  "Private Equity & Venture Capital":   { bg: "#f3e8ff", color: "#6b21a8" },
  "Crédito Privado":                    { bg: "#dcfce7", color: "#166534" },
  "Líquidos":                           { bg: "#fef9c3", color: "#713f12" },
};

// ─────────────────────────────────────────────────────────────────────────────

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

  const parcMap = useMemo(() => new Map(parcRows.map(r => [r.CODPARC, r.NOMEPARC])),      [parcRows]);
  const projMap = useMemo(() => new Map(projRows.map(r => [r.CODPROJ, r.IDENTIFICACAO])), [projRows]);

  // Natureza codes for Gestão de Fundos (by DESCRNAT)
  const gestaoNatCods = useMemo(() =>
    new Set(natRows.filter(r => r.DESCRNAT.toLowerCase().includes(GESTAO_DESCRNAT)).map(r => r.CODNAT)),
    [natRows]
  );
  const gestaoNatMatchadas = useMemo(() =>
    natRows.filter(r => gestaoNatCods.has(r.CODNAT)),
    [natRows, gestaoNatCods]
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

  // Filter lançamentos for the active tab
  const filtrados = useMemo(() => {
    if (aba === "gestao") {
      return lancamentosBase.filter(l => gestaoNatCods.has(l.codnat));
    }
    // consultoria: filter by specific CODNAT codes
    return lancamentosBase.filter(l => CONSULTORIA_CODS.has(l.codnat));
  }, [aba, lancamentosBase, gestaoNatCods]);

  // Unique periods sorted
  const periodos = useMemo(() =>
    [...new Set(filtrados.map(l => l.periodo))].sort(),
    [filtrados]
  );

  // Build row keys
  // Gestão:      parceiro + projeto
  // Consultoria: parceiro + projeto + área
  const rowKeys = useMemo(() => {
    const set = new Set<string>();
    filtrados.forEach(l => {
      const area = aba === "consultoria" ? (CONSULTORIA_MAP[l.codnat] ?? "") : "";
      set.add(mkKey(l.codparc, l.codproj, area));
    });

    return [...set].sort((a, b) => {
      const [pa, pja, aa] = a.split("|");
      const [pb, pjb, ab] = b.split("|");
      const cmpParc = (pa || "zzz").localeCompare(pb || "zzz", undefined, { numeric: true, sensitivity: "base" });
      if (cmpParc !== 0) return cmpParc;
      const cmpProj = (pja || "zzz").localeCompare(pjb || "zzz", undefined, { numeric: true, sensitivity: "base" });
      if (cmpProj !== 0) return cmpProj;
      // Sort area by AREA_ORDER
      return AREA_ORDER.indexOf(aa) - AREA_ORDER.indexOf(ab);
    });
  }, [filtrados, aba]);

  // Pivot: rowKey -> periodo -> total
  const pivot = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const l of filtrados) {
      const area = aba === "consultoria" ? (CONSULTORIA_MAP[l.codnat] ?? "") : "";
      const k = mkKey(l.codparc, l.codproj, area);
      if (!map.has(k)) map.set(k, new Map());
      const inner = map.get(k)!;
      inner.set(l.periodo, (inner.get(l.periodo) ?? 0) + l.valor);
    }
    return map;
  }, [filtrados, aba]);

  // Column totals (all rows, not just filtered)
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

  // Unique CODNATs in base lançamentos (for diagnostics when empty)
  const uniqueNatCodsBase = useMemo(() => {
    if (aba !== "consultoria" || filtrados.length > 0) return [];
    const s = new Set<string>();
    lancamentosBase.forEach(l => { if (l.codnat) s.add(l.codnat); });
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }, [aba, filtrados.length, lancamentosBase]);

  // Filter by busca
  const rowKeysFiltered = useMemo(() => {
    if (!busca.trim()) return rowKeys;
    const q = busca.toLowerCase();
    return rowKeys.filter(k => {
      const [parc, proj, area] = k.split("|");
      return (
        parc.toLowerCase().includes(q) ||
        (parcMap.get(parc) ?? "").toLowerCase().includes(q) ||
        proj.toLowerCase().includes(q) ||
        (projMap.get(proj) ?? "").toLowerCase().includes(q) ||
        area.toLowerCase().includes(q)
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

  const hasData = filtrados.length > 0;
  const isConsultoria = aba === "consultoria";

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
              placeholder={isConsultoria ? "Buscar parceiro, projeto ou área…" : "Buscar parceiro ou projeto…"}
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

        {/* Naturezas — Gestão de Fundos */}
        {aba === "gestao" && gestaoNatMatchadas.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-gray-400">Naturezas:</span>
            {gestaoNatMatchadas.map(n => (
              <span key={n.CODNAT}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                {n.CODNAT} <span className="font-sans font-normal text-blue-500">— {n.DESCRNAT}</span>
              </span>
            ))}
          </div>
        )}

        {/* Áreas — Consultoria Especializada */}
        {isConsultoria && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-gray-400">Áreas:</span>
            {AREA_ORDER.map(area => {
              const color = AREA_COLORS[area] ?? { bg: "#f1f5f9", color: "#64748b" };
              const cods = Object.entries(CONSULTORIA_MAP).filter(([, v]) => v === area).map(([k]) => k);
              return (
                <span key={area}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border"
                  style={{ background: color.bg, color: color.color, borderColor: color.bg }}>
                  {area}
                  <span className="font-mono font-normal opacity-70">{cods.join(", ")}</span>
                </span>
              );
            })}
          </div>
        )}

        {/* Sem dados */}
        {!hasData && (
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <p className="text-gray-500 font-medium text-sm text-center">Nenhum lançamento encontrado para os códigos configurados.</p>

            {isConsultoria && uniqueNatCodsBase.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
                  CODNATs encontrados nos lançamentos (selecione o fechamento correto para ver):
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                  {uniqueNatCodsBase.map(cod => {
                    const isConfigured = CONSULTORIA_CODS.has(cod);
                    return (
                      <span key={cod}
                        className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-semibold border"
                        style={isConfigured
                          ? { background: "#dcfce7", color: "#166534", borderColor: "#86efac" }
                          : { background: "#f8fafc", color: "#64748b", borderColor: "#e2e8f0" }}>
                        {cod}
                        {isConfigured && <span className="ml-1 text-[9px]">✓</span>}
                      </span>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400">
                  Os códigos em verde já estão configurados. Os cinzas não estão mapeados. Verifique se os códigos acima correspondem aos informados.
                </p>
              </div>
            )}

            {isConsultoria && uniqueNatCodsBase.length === 0 && (
              <p className="text-xs text-gray-400 text-center">Nenhum lançamento realizado encontrado no fechamento selecionado.</p>
            )}
          </div>
        )}

        {/* Tabela pivot */}
        {hasData && (
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
                    <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky left-0 z-20 min-w-[210px]"
                      style={{ background: "#1e3a5f" }}>
                      Parceiro
                    </th>
                    {/* Col 2 — Identificação */}
                    <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky z-20 min-w-[190px] border-l border-white/10"
                      style={{ background: "#1e3a5f", left: "210px" }}>
                      Identificação
                    </th>
                    {/* Col 3 — Área (only Consultoria) */}
                    {isConsultoria && (
                      <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky z-20 min-w-[220px] border-l border-white/10"
                        style={{ background: "#1e3a5f", left: "400px" }}>
                        Área
                      </th>
                    )}
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
                    const [parc, proj, area] = k.split("|");
                    const inner    = pivot.get(k);
                    const rowTot   = rowTotals.get(k) ?? 0;
                    const parcNome = parc ? (parcMap.get(parc) ?? parc) : null;
                    const projIdent = proj ? (projMap.get(proj) ?? proj) : null;
                    const rowBg    = i % 2 === 0 ? "white" : "#f9fafb";
                    const areaColor = AREA_COLORS[area];

                    return (
                      <tr key={k}
                        className="border-b border-gray-50 hover:bg-blue-50/40 transition-colors"
                        style={{ background: rowBg }}>

                        {/* Parceiro */}
                        <td className="px-4 py-2 sticky left-0 z-10 border-r border-gray-100"
                          style={{ background: rowBg }}>
                          {parc
                            ? <div className="flex flex-col">
                                <span className="font-mono text-xs text-blue-700 font-semibold">{parc}</span>
                                <span className="text-xs text-gray-600 truncate max-w-[175px]" title={parcNome ?? ""}>{parcNome}</span>
                              </div>
                            : <span className="text-xs text-gray-400 italic">Sem parceiro</span>
                          }
                        </td>

                        {/* Identificação */}
                        <td className="px-4 py-2 sticky z-10 border-r border-gray-100"
                          style={{ background: rowBg, left: "210px" }}>
                          {proj
                            ? <div className="flex flex-col">
                                <span className="font-mono text-xs text-gray-500 font-semibold">{proj}</span>
                                <span className="text-xs text-gray-700 truncate max-w-[155px]" title={projIdent ?? ""}>{projIdent}</span>
                              </div>
                            : <span className="text-xs text-gray-300">—</span>
                          }
                        </td>

                        {/* Área (Consultoria only) */}
                        {isConsultoria && (
                          <td className="px-4 py-2 sticky z-10 border-r border-gray-100"
                            style={{ background: rowBg, left: "400px" }}>
                            {area
                              ? <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap"
                                  style={areaColor ? { background: areaColor.bg, color: areaColor.color } : { background: "#f1f5f9", color: "#64748b" }}>
                                  {area}
                                </span>
                              : <span className="text-xs text-gray-300">—</span>
                            }
                          </td>
                        )}

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
                      <td colSpan={periodos.length + (isConsultoria ? 4 : 3)} className="px-4 py-10 text-center text-gray-400 text-sm">
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
                      <td className="sticky z-10 border-t border-gray-200 border-r border-gray-100"
                        style={{ background: "#f0f4f8", left: "210px" }} />
                      {isConsultoria && (
                        <td className="sticky z-10 border-t border-gray-200 border-r border-gray-100"
                          style={{ background: "#f0f4f8", left: "400px" }} />
                      )}
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
