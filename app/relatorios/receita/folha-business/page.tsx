"use client";

import React, { useState, useMemo, useRef } from "react";
import { Plus, Trash2, Pencil, X, Download, ChevronLeft, ChevronRight } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData } from "@/lib/storage";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PoloRow { id: string; POLO: string; ESTADO: string; CIDADE: string; }

interface FolhaBusiness {
  id: string;
  tipo: "PATROCÍNIO" | "CONECTA";
  polo: string;
  nomeContratante: string;
  valorContrato: number | null;
  dataInicio: string;
  dataFim: string;
  tipoContrato: "NOVO" | "RENOVAÇÃO";
  contratoAssinado: "SIM" | "NÃO";
  forma: "DINHEIRO" | "PERMUTA";
  parcelas: number | null;
  fluxoCaixa: Record<string, number>;
  fluxoCompetencia: Record<string, number>;
  comentario: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

const EMPTY: Omit<FolhaBusiness, "id"> = {
  tipo: "PATROCÍNIO",
  polo: "",
  nomeContratante: "",
  valorContrato: null,
  dataInicio: "",
  dataFim: "",
  tipoContrato: "NOVO",
  contratoAssinado: "NÃO",
  forma: "DINHEIRO",
  parcelas: null,
  fluxoCaixa: {},
  fluxoCompetencia: {},
  comentario: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10); }

function fmtBRL(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v)) return "";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function parseBRL(s: string): number | null {
  if (!s.trim()) return null;
  const clean = s.replace(/[R$\s.]/g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function periodoKey(ano: number, mes: number): string {
  return `${ano}-${String(mes + 1).padStart(2, "0")}`;
}

function fmtDate(d: string) {
  if (!d) return "—";
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({
  row, polos, onSave, onClose,
}: {
  row: FolhaBusiness | null;
  polos: PoloRow[];
  onSave: (r: FolhaBusiness) => void;
  onClose: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const [form, setForm] = useState<FolhaBusiness>(
    row ? { ...row } : { id: uid(), ...EMPTY }
  );

  const set = <K extends keyof FolhaBusiness>(k: K, v: FolhaBusiness[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const setFluxo = (tipo: "fluxoCaixa" | "fluxoCompetencia", ano: number, mes: number, raw: string) => {
    const key = periodoKey(ano, mes);
    const v = parseBRL(raw);
    setForm(f => ({
      ...f,
      [tipo]: { ...f[tipo], [key]: v ?? 0 },
    }));
  };

  // Derive year range from contract dates; fallback to current year
  const fluxoYears = useMemo(() => {
    const startY = form.dataInicio ? parseInt(form.dataInicio.slice(0, 4)) : currentYear;
    const endY   = form.dataFim   ? parseInt(form.dataFim.slice(0, 4))   : startY;
    const s = Math.min(startY, endY);
    const e = Math.max(startY, endY);
    const years: number[] = [];
    for (let y = s; y <= e; y++) years.push(y);
    return years;
  }, [form.dataInicio, form.dataFim, currentYear]);

  const field = "px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white w-full";
  const label = "text-xs font-medium text-gray-600 mb-0.5 block";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
            <span className="text-base font-semibold text-gray-800">
              {row ? "Editar Contrato" : "Novo Contrato"}
            </span>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-5">
            {/* Row 1 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label}>Tipo</label>
                <select className={field} value={form.tipo} onChange={e => set("tipo", e.target.value as FolhaBusiness["tipo"])}>
                  <option>PATROCÍNIO</option>
                  <option>CONECTA</option>
                </select>
              </div>
              <div>
                <label className={label}>Polo Originador</label>
                <select className={field} value={form.polo} onChange={e => set("polo", e.target.value)}>
                  <option value="">— Selecione —</option>
                  {polos.map(p => (
                    <option key={p.id} value={p.POLO}>{p.POLO}{p.CIDADE ? ` — ${p.CIDADE}` : ""}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2 */}
            <div>
              <label className={label}>Nome do Contratante</label>
              <input className={field} value={form.nomeContratante} onChange={e => set("nomeContratante", e.target.value)} placeholder="Razão social ou nome" />
            </div>

            {/* Row 3 */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={label}>Valor do Contrato</label>
                <input className={field} value={form.valorContrato !== null ? fmtBRL(form.valorContrato) : ""} onChange={e => set("valorContrato", parseBRL(e.target.value))} placeholder="R$ 0" />
              </div>
              <div>
                <label className={label}>Parcelas</label>
                <input type="number" min={1} className={field} value={form.parcelas ?? ""} onChange={e => set("parcelas", e.target.value ? parseInt(e.target.value) : null)} placeholder="—" />
              </div>
              <div>
                <label className={label}>Forma</label>
                <select className={field} value={form.forma} onChange={e => set("forma", e.target.value as FolhaBusiness["forma"])}>
                  <option>DINHEIRO</option>
                  <option>PERMUTA</option>
                </select>
              </div>
            </div>

            {/* Row 4 */}
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className={label}>Data Início</label>
                <input type="date" className={field} value={form.dataInicio} onChange={e => set("dataInicio", e.target.value)} />
              </div>
              <div>
                <label className={label}>Data Fim</label>
                <input type="date" className={field} value={form.dataFim} onChange={e => set("dataFim", e.target.value)} />
              </div>
              <div>
                <label className={label}>Tipo Contrato</label>
                <select className={field} value={form.tipoContrato} onChange={e => set("tipoContrato", e.target.value as FolhaBusiness["tipoContrato"])}>
                  <option>NOVO</option>
                  <option>RENOVAÇÃO</option>
                </select>
              </div>
              <div>
                <label className={label}>Contrato Assinado</label>
                <select className={field} value={form.contratoAssinado} onChange={e => set("contratoAssinado", e.target.value as FolhaBusiness["contratoAssinado"])}>
                  <option>NÃO</option>
                  <option>SIM</option>
                </select>
              </div>
            </div>

            {/* Fluxos mensais — um bloco por ano do contrato */}
            <div className="space-y-4">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                Fluxo de Pagamento
                {fluxoYears.length > 1 && (
                  <span className="ml-2 font-normal text-gray-400 normal-case tracking-normal">
                    ({fluxoYears[0]} – {fluxoYears[fluxoYears.length - 1]})
                  </span>
                )}
              </p>
              {!form.dataInicio && !form.dataFim && (
                <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  Preencha as datas do contrato para expandir o fluxo por todos os anos do período.
                </p>
              )}
              {fluxoYears.map(y => (
                <div key={y}>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{y}</p>
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left py-1 pr-3 text-gray-400 font-medium w-28">Tipo</th>
                          {MESES.map(m => (
                            <th key={m} className="py-1 px-1 text-center text-gray-400 font-medium w-16">{m}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(["fluxoCaixa", "fluxoCompetencia"] as const).map(tipo => (
                          <tr key={tipo} className="border-t border-gray-100">
                            <td className="py-1 pr-3 text-gray-600 font-medium whitespace-nowrap">
                              {tipo === "fluxoCaixa" ? "Caixa" : "Competência"}
                            </td>
                            {MESES.map((_, mi) => {
                              const key = periodoKey(y, mi);
                              const v = form[tipo][key] ?? 0;
                              return (
                                <td key={mi} className="py-1 px-0.5">
                                  <input
                                    className="w-full text-right text-xs px-1 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                                    value={v !== 0 ? v.toLocaleString("pt-BR") : ""}
                                    onChange={e => setFluxo(tipo, y, mi, e.target.value)}
                                    placeholder="—"
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

            {/* Comentário */}
            <div>
              <label className={label}>Comentário</label>
              <textarea rows={2} className={`${field} resize-none`} value={form.comentario} onChange={e => set("comentario", e.target.value)} placeholder="Observações adicionais..." />
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 sticky bottom-0 bg-white">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
            <button
              onClick={() => onSave(form)}
              className="px-5 py-2 text-sm font-semibold text-white rounded-lg"
              style={{ background: "#1e3a5f" }}>
              Salvar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function FolhaBusinessPage() {
  const [data, setData] = usePersistedData<FolhaBusiness[]>("portal_receita_folha_business", []);
  const [polos] = usePersistedData<PoloRow[]>("portal_polo", []);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [modal, setModal] = useState<{ open: boolean; row: FolhaBusiness | null }>({ open: false, row: null });
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const poloMap = useMemo(() => new Map(polos.map(p => [p.POLO, p])), [polos]);

  // Totais mensais por tipo de fluxo
  const totais = useMemo(() => {
    const caixa: number[] = Array(12).fill(0);
    const comp:  number[] = Array(12).fill(0);
    for (const r of data) {
      MESES.forEach((_, mi) => {
        const key = periodoKey(ano, mi);
        caixa[mi] += r.fluxoCaixa[key] ?? 0;
        comp[mi]  += r.fluxoCompetencia[key] ?? 0;
      });
    }
    return { caixa, comp };
  }, [data, ano]);

  const handleSave = (row: FolhaBusiness) => {
    setData(d => {
      const idx = d.findIndex(r => r.id === row.id);
      if (idx >= 0) { const n = [...d]; n[idx] = row; return n; }
      return [...d, row];
    });
    setModal({ open: false, row: null });
  };

  const handleDelete = (id: string) => {
    setData(d => d.filter(r => r.id !== id));
    setConfirmDel(null);
  };

  const handleExport = () => {
    const rows = data.map(r => {
      const base: Record<string, unknown> = {
        Tipo: r.tipo,
        "Polo Originador": r.polo,
        "Nome Contratante": r.nomeContratante,
        "Valor Contrato": r.valorContrato,
        "Data Início": r.dataInicio,
        "Data Fim": r.dataFim,
        "Tipo Contrato": r.tipoContrato,
        "Contrato Assinado": r.contratoAssinado,
        Forma: r.forma,
        Parcelas: r.parcelas,
        Comentário: r.comentario,
      };
      MESES.forEach((m, mi) => {
        const k = periodoKey(ano, mi);
        base[`Caixa ${m}/${ano}`] = r.fluxoCaixa[k] ?? 0;
        base[`Competência ${m}/${ano}`] = r.fluxoCompetencia[k] ?? 0;
      });
      return base;
    });
    const csv = [
      Object.keys(rows[0] ?? {}).join(";"),
      ...rows.map(r => Object.values(r).map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")),
    ].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `folha-business-${ano}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // Column widths
  const COL_FIXED_W = 140; // each fixed info column

  const thFixed = "px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap border-b border-gray-200 bg-gray-50";
  const thMonth = "px-2 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap border-b border-gray-200 bg-gray-50 border-l border-gray-100";
  const tdFixed = "px-3 py-2 text-sm text-gray-700 whitespace-nowrap border-b border-gray-100";
  const tdMonth = "px-2 py-2 text-right text-xs tabular-nums whitespace-nowrap border-b border-gray-100 border-l border-gray-100";

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <PageHeader title="Folha Business" subtitle="Relatórios · Receita" />

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        {/* Year nav */}
        <div className="flex items-center gap-1 border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={() => setAno(a => a - 1)} className="px-2.5 py-1.5 hover:bg-gray-100 transition-colors text-gray-500">
            <ChevronLeft size={14} />
          </button>
          <span className="px-3 py-1.5 text-sm font-semibold text-gray-700 border-x border-gray-200">{ano}</span>
          <button onClick={() => setAno(a => a + 1)} className="px-2.5 py-1.5 hover:bg-gray-100 transition-colors text-gray-500">
            <ChevronRight size={14} />
          </button>
        </div>

        <span className="text-xs text-gray-400">{data.length} contrato{data.length !== 1 ? "s" : ""}</span>

        <div className="flex-1" />

        {data.length > 0 && (
          <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <Download size={13} /> Exportar CSV
          </button>
        )}

        <button
          onClick={() => setModal({ open: true, row: null })}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold text-white rounded-lg transition-colors hover:opacity-90"
          style={{ background: "#1e3a5f" }}>
          <Plus size={15} /> Novo Contrato
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse" style={{ minWidth: "max-content" }}>
              <thead>
                <tr>
                  {/* Sticky fixed columns */}
                  <th className={`${thFixed} sticky left-0 z-20`} style={{ minWidth: 100 }}>Tipo</th>
                  <th className={`${thFixed} sticky z-20`} style={{ left: 100, minWidth: 130 }}>Polo Originador</th>
                  <th className={`${thFixed}`} style={{ minWidth: 180 }}>Nome Contratante</th>
                  <th className={`${thFixed} text-right`} style={{ minWidth: 120 }}>Valor Contrato</th>
                  <th className={`${thFixed}`} style={{ minWidth: 100 }}>Data Início</th>
                  <th className={`${thFixed}`} style={{ minWidth: 100 }}>Data Fim</th>
                  <th className={`${thFixed}`} style={{ minWidth: 100 }}>Tipo Contrato</th>
                  <th className={`${thFixed}`} style={{ minWidth: 110 }}>Assinado</th>
                  <th className={`${thFixed}`} style={{ minWidth: 100 }}>Forma</th>
                  <th className={`${thFixed} text-right`} style={{ minWidth: 80 }}>Parcelas</th>
                  {/* Month columns — 2 rows per month (Caixa + Competência) */}
                  {MESES.map(m => (
                    <th key={m} colSpan={2} className={thMonth} style={{ minWidth: 180 }}>
                      {m}/{String(ano).slice(2)}
                    </th>
                  ))}
                  <th className={`${thFixed}`} style={{ minWidth: 200 }}>Comentário</th>
                  <th className={`${thFixed} text-center`} style={{ minWidth: 80 }}>Ações</th>
                </tr>
                {/* Sub-header for months */}
                <tr>
                  <th colSpan={10} className="bg-gray-50 border-b border-gray-200" />
                  {MESES.map(m => (
                    <React.Fragment key={m}>
                      <th className="px-2 py-1 text-[10px] font-medium text-gray-400 uppercase tracking-wide text-center border-b border-gray-200 bg-gray-50 border-l border-gray-100" style={{ minWidth: 90 }}>Caixa</th>
                      <th className="px-2 py-1 text-[10px] font-medium text-gray-400 uppercase tracking-wide text-center border-b border-gray-200 bg-gray-50 border-l border-gray-100" style={{ minWidth: 90 }}>Competência</th>
                    </React.Fragment>
                  ))}
                  <th colSpan={2} className="bg-gray-50 border-b border-gray-200" />
                </tr>
              </thead>

              <tbody>
                {data.length === 0 ? (
                  <tr>
                    <td colSpan={13 + MESES.length * 2} className="px-6 py-16 text-center text-gray-400 text-sm">
                      Nenhum contrato cadastrado. Clique em <strong>Novo Contrato</strong> para começar.
                    </td>
                  </tr>
                ) : (
                  data.map((r, ri) => {
                    const poloInfo = poloMap.get(r.polo);
                    return (
                      <tr key={r.id} className={`hover:bg-blue-50/40 transition-colors ${ri % 2 === 0 ? "" : "bg-gray-50/50"}`}>
                        {/* Tipo */}
                        <td className={`${tdFixed} sticky left-0 z-10`} style={{ background: ri % 2 === 0 ? "white" : "#fafafa" }}>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                            r.tipo === "PATROCÍNIO"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-purple-100 text-purple-700"
                          }`}>
                            {r.tipo}
                          </span>
                        </td>
                        {/* Polo */}
                        <td className={`${tdFixed} sticky z-10`} style={{ left: 100, background: ri % 2 === 0 ? "white" : "#fafafa" }}>
                          {r.polo
                            ? <span className="flex flex-col">
                                <span className="font-medium text-gray-800 text-xs">{r.polo}</span>
                                {poloInfo?.CIDADE && <span className="text-[10px] text-gray-400">{poloInfo.CIDADE}</span>}
                              </span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        {/* Nome */}
                        <td className={tdFixed}>{r.nomeContratante || <span className="text-gray-300">—</span>}</td>
                        {/* Valor */}
                        <td className={`${tdFixed} text-right font-medium`}>
                          {r.valorContrato !== null ? fmtBRL(r.valorContrato) : <span className="text-gray-300">—</span>}
                        </td>
                        {/* Datas */}
                        <td className={tdFixed}>{r.dataInicio ? fmtDate(r.dataInicio) : <span className="text-gray-300">—</span>}</td>
                        <td className={tdFixed}>{r.dataFim ? fmtDate(r.dataFim) : <span className="text-gray-300">—</span>}</td>
                        {/* Tipo contrato */}
                        <td className={tdFixed}>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                            r.tipoContrato === "NOVO"
                              ? "bg-green-100 text-green-700"
                              : "bg-amber-100 text-amber-700"
                          }`}>
                            {r.tipoContrato}
                          </span>
                        </td>
                        {/* Assinado */}
                        <td className={tdFixed}>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                            r.contratoAssinado === "SIM"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-red-100 text-red-600"
                          }`}>
                            {r.contratoAssinado}
                          </span>
                        </td>
                        {/* Forma */}
                        <td className={tdFixed}>{r.forma}</td>
                        {/* Parcelas */}
                        <td className={`${tdFixed} text-right`}>{r.parcelas ?? <span className="text-gray-300">—</span>}</td>
                        {/* Meses */}
                        {MESES.map((_, mi) => {
                          const key = periodoKey(ano, mi);
                          const vc = r.fluxoCaixa[key] ?? 0;
                          const vp = r.fluxoCompetencia[key] ?? 0;
                          return (
                            <React.Fragment key={mi}>
                              <td className={`${tdMonth}`}>
                                {vc !== 0 ? <span className={vc < 0 ? "text-red-600" : "text-gray-700"}>{fmtBRL(vc)}</span> : <span className="text-gray-200">—</span>}
                              </td>
                              <td className={`${tdMonth}`}>
                                {vp !== 0 ? <span className={vp < 0 ? "text-red-600" : "text-gray-700"}>{fmtBRL(vp)}</span> : <span className="text-gray-200">—</span>}
                              </td>
                            </React.Fragment>
                          );
                        })}
                        {/* Comentário */}
                        <td className={`${tdFixed} max-w-[200px]`}>
                          {r.comentario
                            ? <span className="text-gray-600 text-xs truncate block" title={r.comentario}>{r.comentario}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        {/* Ações */}
                        <td className={`${tdFixed} text-center`}>
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => setModal({ open: true, row: r })}
                              className="p-1.5 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Editar">
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => setConfirmDel(r.id)}
                              className="p-1.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
                              title="Excluir">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* Totals footer */}
              {data.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#002b5c" }}>
                    <td colSpan={10} className="px-3 py-2.5 text-xs font-bold text-white sticky left-0 z-10" style={{ background: "#002b5c" }}>
                      TOTAL {ano}
                    </td>
                    {MESES.map((_, mi) => (
                      <React.Fragment key={mi}>
                        <td className="px-2 py-2.5 text-right text-xs font-bold text-white tabular-nums whitespace-nowrap border-l border-white/10">
                          {totais.caixa[mi] !== 0 ? fmtBRL(totais.caixa[mi]) : <span className="opacity-30">—</span>}
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs font-bold text-white tabular-nums whitespace-nowrap border-l border-white/10">
                          {totais.comp[mi] !== 0 ? fmtBRL(totais.comp[mi]) : <span className="opacity-30">—</span>}
                        </td>
                      </React.Fragment>
                    ))}
                    <td colSpan={2} style={{ background: "#002b5c" }} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      {/* Modal */}
      {modal.open && (
        <Modal
          row={modal.row}
          polos={polos}
          onSave={handleSave}
          onClose={() => setModal({ open: false, row: null })}
        />
      )}

      {/* Confirm delete */}
      {confirmDel && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setConfirmDel(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm">
              <p className="text-sm font-semibold text-gray-800 mb-1">Excluir contrato?</p>
              <p className="text-sm text-gray-500 mb-5">Esta ação não pode ser desfeita.</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setConfirmDel(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
                <button onClick={() => handleDelete(confirmDel)} className="px-4 py-2 text-sm font-semibold text-white rounded-lg bg-red-600 hover:bg-red-700">Excluir</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
