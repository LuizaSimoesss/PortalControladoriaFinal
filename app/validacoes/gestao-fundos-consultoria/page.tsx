"use client";

import { useState, useMemo, useEffect } from "react";
import { Search, Filter, Download, X } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { loadData, usePersistedData } from "@/lib/storage";
import { idbGet } from "@/lib/idb";
import type { LancamentoFinanceiro, Fechamento, NaturezaRow, ParceiroRow, ProjetoRow } from "@/lib/mockData";

type Aba = "gestao" | "consultoria" | "consultoria_cvm" | "gestao_carteiras";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const ABA_LABEL: Record<Aba, string> = {
  gestao:             "Gestão de Fundos",
  consultoria:        "Consultoria Especializada",
  consultoria_cvm:    "Consultoria de Investimentos CVM",
  gestao_carteiras:   "Gestão Carteiras Administradas",
};

const CONSULTORIA_CVM_COD    = "10070100";
const GESTAO_CARTEIRAS_COD   = "10070300";

const CONSULTORIA_MAP: Record<string, string> = {
  "10010101": "Real Estate",
  "10010102": "Private Equity & Venture Capital",
  "10010103": "Private Equity & Venture Capital",
  "10010104": "Crédito Privado",
  "10010106": "Líquidos",
};
const CONSULTORIA_CODS = new Set(Object.keys(CONSULTORIA_MAP));

const AREA_ORDER = ["Real Estate", "Private Equity & Venture Capital", "Crédito Privado", "Líquidos"];
const GESTAO_DESCRNAT = "gestão de fundos";

function periodoLabel(p: string) {
  if (!p) return "—";
  const [y, m] = p.split("-");
  return `${MESES[parseInt(m) - 1]}/${y.slice(2)}`;
}

function fmtBRLCell(v: number) {
  if (v === 0) return <span className="text-gray-300">—</span>;
  return <span className={v < 0 ? "text-red-600" : undefined}>{v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>;
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d: string) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function mkKey(codparc?: string, codproj?: string, area?: string) {
  return `${codparc ?? ""}|${codproj ?? ""}|${area ?? ""}`;
}

const AREA_COLORS: Record<string, { bg: string; color: string }> = {
  "Real Estate":                        { bg: "#dbeafe", color: "#1e40af" },
  "Private Equity & Venture Capital":   { bg: "#f3e8ff", color: "#6b21a8" },
  "Crédito Privado":                    { bg: "#dcfce7", color: "#166534" },
  "Líquidos":                           { bg: "#fef9c3", color: "#713f12" },
};

function downloadCSV(filename: string, rows: string[][]) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GestaoFundosConsultoriaPage() {
  const SS_KEY = "receitas_filtros";

  function readSS() {
    try { return JSON.parse(sessionStorage.getItem(SS_KEY) ?? "{}"); } catch { return {}; }
  }

  const [aba, setAba] = useState<Aba>(() => readSS().aba ?? "gestao");
  const [fechamentos] = usePersistedData<Fechamento[]>("portal_fechamentos", []);
  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [fechamentoId, setFechamentoId] = useState<string>(() => readSS().fechamentoId ?? "__todos__");
  const [busca, setBusca] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [dataInicio, setDataInicio] = useState<string>(() => readSS().dataInicio ?? "");
  const [dataFim, setDataFim] = useState<string>(() => readSS().dataFim ?? "");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // persist filter state across page navigation
  useEffect(() => {
    sessionStorage.setItem(SS_KEY, JSON.stringify({ aba, fechamentoId, dataInicio, dataFim }));
  }, [aba, fechamentoId, dataInicio, dataFim]);

  const natRows  = useMemo(() => loadData<NaturezaRow[]>("portal_natureza", []), []);
  const parcRows = useMemo(() => loadData<ParceiroRow[]>("portal_parceiro", []), []);
  const projRows = useMemo(() => loadData<ProjetoRow[]>("portal_projetos", []), []);

  const parcMap = useMemo(() => new Map(parcRows.map(r => [r.CODPARC, r.NOMEPARC])),      [parcRows]);
  const projMap = useMemo(() => new Map(projRows.map(r => [r.CODPROJ, r.IDENTIFICACAO])), [projRows]);

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

  const filtrosAtivos = (dataInicio ? 1 : 0) + (dataFim ? 1 : 0);

  const lancamentosBase = useMemo(() =>
    lancamentos.filter(l => {
      if (l.tipo !== "realizado") return false;
      if (fechamentoId !== "__todos__" && l.fechamentoId !== fechamentoId) return false;
      if (dataInicio && l.data < dataInicio) return false;
      if (dataFim   && l.data > dataFim)   return false;
      return true;
    }),
    [lancamentos, fechamentoId, dataInicio, dataFim]
  );

  const filtrados = useMemo(() => {
    if (aba === "gestao")           return lancamentosBase.filter(l => gestaoNatCods.has(l.codnat));
    if (aba === "consultoria")      return lancamentosBase.filter(l => CONSULTORIA_CODS.has(l.codnat));
    if (aba === "consultoria_cvm")  return lancamentosBase.filter(l => l.codnat === CONSULTORIA_CVM_COD);
    if (aba === "gestao_carteiras") return lancamentosBase.filter(l => l.codnat === GESTAO_CARTEIRAS_COD);
    return [];
  }, [aba, lancamentosBase, gestaoNatCods]);

  const periodos = useMemo(() =>
    [...new Set(filtrados.map(l => l.periodo))].sort(),
    [filtrados]
  );

  const isConsultoria = aba === "consultoria";
  const showIdent = aba === "gestao" || aba === "consultoria";

  const rowKeys = useMemo(() => {
    const set = new Set<string>();
    filtrados.forEach(l => {
      const area = isConsultoria ? (CONSULTORIA_MAP[l.codnat] ?? "") : "";
      const proj = showIdent ? l.codproj : "";
      set.add(mkKey(l.codparc, proj, area));
    });
    return [...set].sort((a, b) => {
      const [pa, pja, aa] = a.split("|");
      const [pb, pjb, ab] = b.split("|");
      const cmpParc = (pa || "zzz").localeCompare(pb || "zzz", undefined, { numeric: true, sensitivity: "base" });
      if (cmpParc !== 0) return cmpParc;
      const cmpProj = (pja || "zzz").localeCompare(pjb || "zzz", undefined, { numeric: true, sensitivity: "base" });
      if (cmpProj !== 0) return cmpProj;
      return AREA_ORDER.indexOf(aa) - AREA_ORDER.indexOf(ab);
    });
  }, [filtrados, aba, showIdent]);

  const pivot = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const l of filtrados) {
      const area = isConsultoria ? (CONSULTORIA_MAP[l.codnat] ?? "") : "";
      const proj = showIdent ? l.codproj : "";
      const k = mkKey(l.codparc, proj, area);
      if (!map.has(k)) map.set(k, new Map());
      const inner = map.get(k)!;
      inner.set(l.periodo, (inner.get(l.periodo) ?? 0) + l.valor);
    }
    return map;
  }, [filtrados, aba, showIdent]);

  // rowKey → lancamentos (for history drawer)
  const rowLancamentos = useMemo(() => {
    const map = new Map<string, LancamentoFinanceiro[]>();
    for (const l of filtrados) {
      const area = isConsultoria ? (CONSULTORIA_MAP[l.codnat] ?? "") : "";
      const proj = showIdent ? l.codproj : "";
      const k = mkKey(l.codparc, proj, area);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(l);
    }
    // sort each list by date
    map.forEach(arr => arr.sort((a, b) => a.data.localeCompare(b.data)));
    return map;
  }, [filtrados, aba, showIdent]);

  const colTotals = useMemo(() => {
    const tot = new Map<string, number>();
    periodos.forEach(p => {
      let sum = 0;
      rowKeys.forEach(k => { sum += pivot.get(k)?.get(p) ?? 0; });
      tot.set(p, sum);
    });
    return tot;
  }, [pivot, rowKeys, periodos]);

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

  const uniqueNatCodsBase = useMemo(() => {
    const showDiag = (isConsultoria || aba === "consultoria_cvm" || aba === "gestao_carteiras") && filtrados.length === 0;
    if (!showDiag) return [];
    const s = new Set<string>();
    lancamentosBase.forEach(l => { if (l.codnat) s.add(l.codnat); });
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }, [aba, isConsultoria, filtrados.length, lancamentosBase]);

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

  function handleExport() {
    const headers: string[] = ["Parceiro", "Nome Parceiro"];
    if (showIdent) headers.push("Código Projeto", "Identificação");
    if (isConsultoria) headers.push("Área");
    periodos.forEach(p => headers.push(periodoLabel(p)));
    headers.push("Total");

    const dataRows = rowKeysFiltered.map(k => {
      const [parc, proj, area] = k.split("|");
      const row: string[] = [parc, parcMap.get(parc) ?? ""];
      if (showIdent) row.push(proj, projMap.get(proj) ?? "");
      if (isConsultoria) row.push(area);
      periodos.forEach(p => row.push(String(pivot.get(k)?.get(p) ?? 0)));
      row.push(String(rowTotals.get(k) ?? 0));
      return row;
    });

    const totalRow: string[] = ["TOTAL", ""];
    if (showIdent) totalRow.push("", "");
    if (isConsultoria) totalRow.push("");
    periodos.forEach(p => totalRow.push(String(colTotals.get(p) ?? 0)));
    totalRow.push(String(grandTotal));

    const today = new Date().toISOString().slice(0, 10);
    downloadCSV(`receitas_${aba}_${today}.csv`, [headers, ...dataRows, totalRow]);
  }

  // History drawer data
  const historyLancamentos = selectedKey ? (rowLancamentos.get(selectedKey) ?? []) : [];
  const [selParc, selProj, selArea] = selectedKey ? selectedKey.split("|") : ["", "", ""];
  const historyTitle = [
    parcMap.get(selParc) ?? selParc,
    showIdent && selProj ? (projMap.get(selProj) ?? selProj) : null,
    isConsultoria && selArea ? selArea : null,
  ].filter(Boolean).join(" · ");
  const historyTotal = historyLancamentos.reduce((s, l) => s + l.valor, 0);

  if (!dataLoaded) {
    return (
      <div>
        <PageHeader title="Receitas" subtitle="Validação · Realizado por Parceiro" />
        <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">Carregando lançamentos…</span>
        </div>
      </div>
    );
  }

  const hasData = filtrados.length > 0;

  return (
    <div>
      <PageHeader title="Receitas" subtitle="Validação · Realizado por Parceiro" />

      {/* Abas */}
      <div className="flex gap-0 border-b border-slate-200 bg-white px-6">
        {(["gestao", "consultoria", "consultoria_cvm", "gestao_carteiras"] as Aba[]).map(a => (
          <button key={a}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
              aba === a ? "border-[#1e3a5f] text-[#1e3a5f]" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
            onClick={() => { setAba(a); setBusca(""); setSelectedKey(null); }}>
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

          <button
            onClick={() => setFilterOpen(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
            style={filtrosAtivos > 0 ? { borderColor: "#1e3a5f", color: "#1e3a5f" } : {}}
          >
            <Filter size={14} />
            Filtros
            {filtrosAtivos > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full text-white" style={{ background: "#1e3a5f" }}>{filtrosAtivos}</span>
            )}
          </button>

          {hasData && (
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors text-gray-600"
            >
              <Download size={14} />
              Exportar
            </button>
          )}

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

        {/* CODNAT badge — Consultoria CVM / Gestão Carteiras */}
        {(aba === "consultoria_cvm" || aba === "gestao_carteiras") && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-gray-400">Natureza:</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-100">
              {aba === "consultoria_cvm" ? CONSULTORIA_CVM_COD : GESTAO_CARTEIRAS_COD}
              <span className="font-sans font-normal text-blue-500">— {ABA_LABEL[aba]}</span>
            </span>
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

            {uniqueNatCodsBase.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
                  CODNATs encontrados nos lançamentos (selecione o fechamento correto para ver):
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                  {uniqueNatCodsBase.map(cod => {
                    const isConfigured = isConsultoria
                      ? CONSULTORIA_CODS.has(cod)
                      : aba === "consultoria_cvm"
                      ? cod === CONSULTORIA_CVM_COD
                      : cod === GESTAO_CARTEIRAS_COD;
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

            {uniqueNatCodsBase.length === 0 && (
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
                    <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky left-0 z-20 min-w-[300px]"
                      style={{ background: "#1e3a5f" }}>
                      Parceiro
                    </th>
                    {showIdent && (
                      <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky z-20 min-w-[280px] border-l border-white/10"
                        style={{ background: "#1e3a5f", left: "300px" }}>
                        Identificação
                      </th>
                    )}
                    {isConsultoria && (
                      <th className="font-semibold text-white/80 uppercase text-xs tracking-wide px-4 py-2.5 text-left sticky z-20 min-w-[240px] border-l border-white/10"
                        style={{ background: "#1e3a5f", left: "580px" }}>
                        Área
                      </th>
                    )}
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
                    const inner     = pivot.get(k);
                    const rowTot    = rowTotals.get(k) ?? 0;
                    const parcNome  = parc ? (parcMap.get(parc) ?? parc) : null;
                    const projIdent = proj ? (projMap.get(proj) ?? proj) : null;
                    const rowBg     = i % 2 === 0 ? "white" : "#f9fafb";
                    const areaColor = AREA_COLORS[area];
                    const isSelected = selectedKey === k;

                    return (
                      <tr key={k}
                        onClick={() => setSelectedKey(isSelected ? null : k)}
                        className="border-b border-gray-50 transition-colors cursor-pointer"
                        style={{ background: isSelected ? "#eff6ff" : rowBg }}
                        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = "#f0f4ff"; }}
                        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = rowBg; }}>

                        {/* Parceiro */}
                        <td className="px-4 py-2 sticky left-0 z-10 border-r border-gray-100"
                          style={{ background: isSelected ? "#eff6ff" : rowBg }}>
                          {parc
                            ? <div className="flex flex-col">
                                <span className="font-mono text-xs text-blue-700 font-semibold">{parc}</span>
                                <span className="text-xs text-gray-600 max-w-[268px]" title={parcNome ?? ""}>{parcNome}</span>
                              </div>
                            : <span className="text-xs text-gray-400 italic">Sem parceiro</span>
                          }
                        </td>

                        {/* Identificação */}
                        {showIdent && (
                          <td className="px-4 py-2 sticky z-10 border-r border-gray-100"
                            style={{ background: isSelected ? "#eff6ff" : rowBg, left: "300px" }}>
                            {proj
                              ? <div className="flex flex-col">
                                  <span className="font-mono text-xs text-gray-500 font-semibold">{proj}</span>
                                  <span className="text-xs text-gray-700 max-w-[248px]" title={projIdent ?? ""}>{projIdent}</span>
                                </div>
                              : <span className="text-xs text-gray-300">—</span>
                            }
                          </td>
                        )}

                        {/* Área */}
                        {isConsultoria && (
                          <td className="px-4 py-2 sticky z-10 border-r border-gray-100"
                            style={{ background: isSelected ? "#eff6ff" : rowBg, left: "580px" }}>
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
                      <td colSpan={periodos.length + (isConsultoria ? 4 : showIdent ? 3 : 2)} className="px-4 py-10 text-center text-gray-400 text-sm">
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
                      {showIdent && (
                        <td className="sticky z-10 border-t border-gray-200 border-r border-gray-100"
                          style={{ background: "#f0f4f8", left: "300px" }} />
                      )}
                      {isConsultoria && (
                        <td className="sticky z-10 border-t border-gray-200 border-r border-gray-100"
                          style={{ background: "#f0f4f8", left: "580px" }} />
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

        {/* Histórico da linha selecionada */}
        {selectedKey && (
          <div className="bg-white rounded-xl shadow-sm border border-blue-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-blue-100 flex items-center justify-between" style={{ background: "#f0f6ff" }}>
              <div>
                <span className="font-semibold text-gray-800 text-sm">Histórico de lançamentos</span>
                <span className="ml-2 text-xs text-gray-500">{historyTitle}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-500">
                  {historyLancamentos.length} lançamento{historyLancamentos.length !== 1 ? "s" : ""}{" · "}
                  <span className={`font-semibold tabular-nums ${historyTotal < 0 ? "text-red-600" : "text-gray-700"}`}>
                    {fmtBRL(historyTotal)}
                  </span>
                </span>
                <button onClick={() => setSelectedKey(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="text-xs border-collapse w-full min-w-[400px]">
                <thead>
                  <tr style={{ background: "#e8f0fe" }}>
                    <th className="px-4 py-2 text-left font-semibold text-gray-600 uppercase tracking-wide sticky top-0" style={{ background: "#e8f0fe" }}>NUFIN</th>
                    <th className="px-4 py-2 text-left font-semibold text-gray-600 uppercase tracking-wide sticky top-0" style={{ background: "#e8f0fe" }}>Data</th>
                    <th className="px-4 py-2 text-right font-semibold text-gray-600 uppercase tracking-wide sticky top-0" style={{ background: "#e8f0fe" }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {historyLancamentos.map((l, i) => (
                    <tr key={l.id} className="border-b border-gray-50" style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}>
                      <td className="px-4 py-2 font-mono text-blue-700 font-semibold">{l.nufin ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-600">{fmtDate(l.data)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums font-semibold ${l.valor < 0 ? "text-red-600" : "text-gray-800"}`}>
                        {fmtBRL(l.valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Filter drawer */}
      {filterOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setFilterOpen(false)} />
          <div className="fixed top-0 right-0 h-full w-[300px] z-50 bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 flex-shrink-0">
              <span className="font-semibold text-gray-800">Filtros</span>
              <button onClick={() => setFilterOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="border-b border-gray-100 px-4 py-3">
                <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center justify-between">
                  Data
                  {(dataInicio || dataFim) && (
                    <span onClick={() => { setDataInicio(""); setDataFim(""); }}
                      className="text-[11px] text-blue-600 hover:underline cursor-pointer font-normal">limpar</span>
                  )}
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">De</label>
                    <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Até</label>
                    <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-4 py-4 border-t border-gray-200">
              <button onClick={() => { setDataInicio(""); setDataFim(""); }}
                className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                Limpar tudo
              </button>
              <button onClick={() => setFilterOpen(false)}
                className="flex-1 px-3 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                style={{ background: "#1e3a5f" }}>
                Fechar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
