"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { Plus, Trash2, Pencil, Search, Upload, X, AlertTriangle, ChevronLeft, ChevronRight, Download, Clock, FileText, Copy } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData, loadData } from "@/lib/storage";
import type { LancamentoIndicador, IndicadorRow, UnidadeIndicador, ImportacaoIndicador } from "@/lib/mockData";

type Tipo = "realizado" | "orcado";
type Aba  = "lancamentos" | "historico";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function periodoLabel(p: string) {
  const [y, m] = p.split("-");
  return `${MESES[parseInt(m) - 1]}/${y}`;
}

function hoje(): { ano: number; mes: number } {
  const d = new Date();
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
}

function periodoStr(ano: number, mes: number) {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

function parseValor(v: string): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "-" || s.toLowerCase() === "null") return null;
  const isNeg = s.startsWith("(") && s.endsWith(")");
  let clean = s.replace(/[R$\s()'"]/g, "");
  const hasDot   = clean.includes(".");
  const hasComma = clean.includes(",");
  if (hasComma && hasDot) {
    if (clean.lastIndexOf(",") > clean.lastIndexOf(".")) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      clean = clean.replace(/,/g, "");
    }
  } else if (hasComma) {
    const afterComma = clean.split(",")[1] ?? "";
    clean = afterComma.length === 3 && !afterComma.includes(".")
      ? clean.replace(",", "")
      : clean.replace(",", ".");
  }
  // only dot → EN decimal or EN thousands: parseFloat handles both
  const n = parseFloat(clean);
  if (isNaN(n)) return null;
  return isNeg ? -Math.abs(n) : n;
}

function excelSerialToISO(serial: number): string {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return date.toISOString().slice(0, 10);
}

function parsePeriodo(v: string): string | null {
  if (/^\d{4,6}$/.test(v)) {
    const n = parseInt(v);
    if (n > 40000 && n < 60000) return excelSerialToISO(n).slice(0, 7);
  }
  if (/^\d{4}-\d{2}$/.test(v)) return v;
  if (/^\d{2}\/\d{4}$/.test(v)) return `${v.slice(3)}-${v.slice(0, 2)}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return `${v.slice(6)}-${v.slice(3, 5)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(0, 7);
  return null;
}

function parseData(v: string): string | null {
  if (/^\d{4,6}$/.test(v)) {
    const n = parseInt(v);
    if (n > 40000 && n < 60000) return excelSerialToISO(n);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return `${v.slice(6)}-${v.slice(3, 5)}-${v.slice(0, 2)}`;
  const p = parsePeriodo(v);
  return p ? p + "-01" : null;
}

function dataToPeriodo(data: string) { return data.slice(0, 7); }

// ─── Modal add/edit ───────────────────────────────────────────────────────────

function LancamentoModal({ modo, tipo, form: initial, indRows, onSave, onClose }: {
  modo: "add" | "edit"; tipo: Tipo;
  form: Partial<LancamentoIndicador>;
  indRows: IndicadorRow[];
  onSave: (f: Omit<LancamentoIndicador, "id">) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<LancamentoIndicador>>({
    unidade: "valor",
    ...initial,
  });
  const [valorInput, setValorInput] = useState<string>(
    initial.valor !== undefined && initial.valor !== null
      ? String(initial.valor).replace(".", ",")
      : ""
  );
  const set = (k: keyof LancamentoIndicador, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  const indLeaves = useMemo(() => indRows.filter(r => r.tipo === "INDICADOR"), [indRows]);
  const unidade = form.unidade ?? "valor";

  function handleSave() {
    if (!form.data)          { alert("Informe a data.");      return; }
    if (!form.cod_indicador) { alert("Informe o Indicador."); return; }
    const valor = parseValor(valorInput);
    if (valor === null) { alert("Valor inválido. Use vírgula como separador decimal (ex: 9.201.226.094,00)."); return; }
    const data = form.data!;
    onSave({
      tipo, data, periodo: dataToPeriodo(data),
      cod_indicador: form.cod_indicador!,
      unidade,
      valor,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">
            {modo === "add" ? "Novo Lançamento" : "Editar Lançamento"}
            <span className="ml-2 text-xs font-normal text-gray-400 uppercase">{tipo}</span>
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Data *</label>
            <input type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.data || ""}
              onChange={e => set("data", e.target.value)} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Indicador *</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={form.cod_indicador || ""}
              onChange={e => set("cod_indicador", e.target.value)}>
              <option value="">— Selecionar —</option>
              {indLeaves.map(r => (
                <option key={r.id} value={r.codigo ?? r.id}>
                  {r.codigo ? `${r.codigo} — ` : ""}{r.nome}
                </option>
              ))}
            </select>
          </div>

          {/* Unidade */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Unidade</label>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {([["valor", "Valor (R$)"], ["percentual", "Percentual (%)"]] as [UnidadeIndicador, string][]).map(([v, l]) => (
                <button
                  key={v} type="button"
                  onClick={() => setForm(f => ({ ...f, unidade: v }))}
                  className="flex-1 py-2 text-sm font-medium transition-colors"
                  style={unidade === v
                    ? { background: "#1e3a5f", color: "white" }
                    : { background: "white", color: "#374151" }}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Valor */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {unidade === "percentual" ? "Valor (%)" : "Valor (R$)"} *
            </label>
            <div className="relative">
              <input type="text" inputMode="decimal"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={valorInput}
                onChange={e => setValorInput(e.target.value)}
                placeholder={unidade === "percentual" ? "0,00" : "9.201.226.094,00"} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400 pointer-events-none">
                {unidade === "percentual" ? "%" : "R$"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancelar</button>
          <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }}>
            {modo === "add" ? "Adicionar" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de importação ──────────────────────────────────────────────────────

interface ImportRow {
  raw: Record<string, string>;
  erros: string[];
  lancamento?: Omit<LancamentoIndicador, "id">;
}

function ImportModal({ tipo, periodo, indRows, onImport, onClose }: {
  tipo: Tipo; periodo: string;
  indRows: IndicadorRow[];
  onImport: (rows: Omit<LancamentoIndicador, "id">[]) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [done, setDone] = useState(false);

  const indSet = useMemo(() =>
    new Set(indRows.filter(r => r.tipo === "INDICADOR").flatMap(r => r.codigo ? [r.codigo] : [])),
    [indRows]
  );

  function parseSheetRows(wb: XLSX.WorkBook): Record<string, string>[] {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    return json.map(row => {
      const obj: Record<string, string> = {};
      Object.entries(row).forEach(([k, v]) => { obj[k.trim().toUpperCase()] = String(v ?? "").trim(); });
      return obj;
    });
  }

  function parseCSVText(text: string): Record<string, string>[] {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(';').map(h => h.trim().replace(/^\"|\"$/g, '').toUpperCase());
    return lines.slice(1).map(line => {
      const vals = line.split(';').map(v => v.trim().replace(/^\"|\"$/g, ''));
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
      return obj;
    });
  }

  function validateRow(raw: Record<string, string>): ImportRow {
    const erros: string[] = [];

    const periodoRaw    = raw["PERIODO"] || "";
    const periodoValido = parsePeriodo(periodoRaw);
    if (!periodoValido) erros.push(`PERIODO inválido: "${periodoRaw}"`);

    const valorRaw = raw["VALOR"] || "";
    const valor    = parseValor(valorRaw);
    if (valor === null) erros.push(`VALOR inválido: "${valorRaw}"`);

    const cod_indicador = (raw["COD_INDICADOR"] || "").trim();
    if (!cod_indicador)                                        erros.push("COD_INDICADOR obrigatório");
    else if (indSet.size > 0 && !indSet.has(cod_indicador))   erros.push(`COD_INDICADOR "${cod_indicador}" não encontrado`);

    const unidadeRaw = (raw["UNIDADE"] || "").trim().toLowerCase();
    const unidade: UnidadeIndicador = unidadeRaw === "%" || unidadeRaw === "percentual" ? "percentual" : "valor";

    if (erros.length > 0) return { raw, erros };

    const dataISO = parseData(periodoRaw) ?? periodoValido! + "-01";
    return {
      raw, erros: [],
      lancamento: { tipo, data: dataISO, periodo: dataToPeriodo(dataISO), cod_indicador, unidade, valor: valor! },
    };
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const result = ev.target?.result;
      const parsed = isExcel
        ? parseSheetRows(XLSX.read(result, { type: 'array' }))
        : parseCSVText(result as string);
      setRows(parsed.map(validateRow));
      setDone(false);
    };
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file, 'utf-8');
  }

  const validas   = rows.filter(r => r.erros.length === 0);
  const invalidas = rows.filter(r => r.erros.length > 0);

  function handleImport() {
    onImport(validas.map(r => r.lancamento!));
    setDone(true);
  }

  function baixarTemplate() {
    const wb = XLSX.utils.book_new();

    // Aba 1: Template com linha de exemplo
    const leaves = indRows.filter(r => r.tipo === "INDICADOR");
    const exCod = leaves[0]?.codigo ?? leaves[0]?.id ?? "COD_EXEMPLO";
    const wsT = XLSX.utils.aoa_to_sheet([
      ["PERIODO", "COD_INDICADOR", "VALOR", "UNIDADE"],
      ["01/2026", exCod, "1000,00", "valor"],
    ]);
    XLSX.utils.book_append_sheet(wb, wsT, "Template");

    // Aba 2: Indicadores disponíveis (apenas folhas com código)
    if (leaves.length > 0) {
      const ws = XLSX.utils.json_to_sheet(
        leaves.map(r => ({
          COD_INDICADOR: r.codigo ?? r.id,
          Nome: r.nome,
          Categoria: r.categoria ?? "MENSAL",
        }))
      );
      XLSX.utils.book_append_sheet(wb, ws, "Indicadores");
    }

    XLSX.writeFile(wb, `Template_Lancamentos_Indicadores_${tipo}.xlsx`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800">
              Importar — Indicadores {tipo === "realizado" ? "Realizado" : "Orçado"}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">CSV (ponto-e-vírgula) ou XLSX</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-600 mb-2">Colunas esperadas:</p>
            <div className="flex flex-wrap gap-1.5">
              {["PERIODO *", "COD_INDICADOR *", "VALOR *", "UNIDADE"].map(c => (
                <span key={c} className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium ${c.endsWith("*") ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>{c}</span>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">* Obrigatórias. UNIDADE aceita "%" ou "percentual" (padrão: valor).</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={handleFile} />
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              <Upload size={14} /> Selecionar arquivo
            </button>
            <button onClick={baixarTemplate}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-blue-200 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors">
              <Download size={14} /> Baixar Template
            </button>
          </div>

          {rows.length > 0 && !done && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700">{rows.length} linhas lidas</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">{validas.length} válidas</span>
                {invalidas.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">{invalidas.length} com erro</span>
                )}
              </div>
              {invalidas.length > 0 && (
                <div className="border border-red-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-red-50 border-b border-red-200 flex items-center gap-2">
                    <AlertTriangle size={13} className="text-red-500" />
                    <span className="text-xs font-semibold text-red-700">Linhas com erro (não serão importadas)</span>
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-red-100">
                    {invalidas.map((r, i) => (
                      <div key={i} className="px-3 py-2">
                        <p className="text-xs text-gray-500 font-mono truncate">{JSON.stringify(r.raw)}</p>
                        <ul className="mt-1 space-y-0.5">
                          {r.erros.map((e, j) => <li key={j} className="text-xs text-red-600">• {e}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {validas.length > 0 && (
                <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
                  Os lançamentos de <strong>{periodoLabel(periodo)}</strong> — <strong>{tipo}</strong> serão substituídos.
                </div>
              )}
            </div>
          )}

          {done && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-3 font-medium">
              ✓ {validas.length} lançamentos importados com sucesso.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">
            {done ? "Fechar" : "Cancelar"}
          </button>
          {!done && validas.length > 0 && (
            <button onClick={handleImport} className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }}>
              Importar {validas.length} lançamento{validas.length !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal edição em lote ─────────────────────────────────────────────────────

function BulkEditModal({ count, indRows, onSave, onClose }: {
  count: number;
  indRows: IndicadorRow[];
  onSave: (patch: Partial<Pick<LancamentoIndicador, "data" | "periodo" | "cod_indicador" | "unidade" | "valor">>) => void;
  onClose: () => void;
}) {
  const [applyData,    setApplyData]    = useState(false);
  const [applyInd,     setApplyInd]     = useState(false);
  const [applyUnidade, setApplyUnidade] = useState(false);
  const [applyValor,   setApplyValor]   = useState(false);
  const [dataVal,      setDataVal]      = useState("");
  const [codInd,       setCodInd]       = useState("");
  const [unidade,      setUnidade]      = useState<UnidadeIndicador>("valor");
  const [valorInput,   setValorInput]   = useState("");
  const indLeaves = useMemo(() => indRows.filter(r => r.tipo === "INDICADOR"), [indRows]);

  function handleSave() {
    const patch: Partial<Pick<LancamentoIndicador, "data" | "periodo" | "cod_indicador" | "unidade" | "valor">> = {};
    if (applyData    && dataVal)    { patch.data = dataVal; patch.periodo = dataToPeriodo(dataVal); }
    if (applyInd     && codInd)     patch.cod_indicador = codInd;
    if (applyUnidade)               patch.unidade = unidade;
    if (applyValor) {
      const v = parseValor(valorInput);
      if (v === null) { alert("Valor inválido."); return; }
      patch.valor = v;
    }
    if (Object.keys(patch).length === 0) { alert("Ative pelo menos um campo para editar."); return; }
    onSave(patch);
  }

  function Field({ label, active, onToggle, children }: { label: string; active: boolean; onToggle: () => void; children: React.ReactNode }) {
    return (
      <div className={`p-3 rounded-lg border transition-all ${active ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"}`}>
        <label className="flex items-center gap-2 cursor-pointer mb-2">
          <input type="checkbox" checked={active} onChange={onToggle} className="w-4 h-4 rounded" style={{ accentColor: "#1e3a5f" }} />
          <span className={`text-xs font-semibold uppercase tracking-wide ${active ? "text-blue-700" : "text-gray-500"}`}>{label}</span>
        </label>
        {active && children}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Editar em lote</h2>
            <p className="text-xs text-gray-400 mt-0.5">{count} lançamento{count !== 1 ? "s" : ""} selecionado{count !== 1 ? "s" : ""}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-3">
          <p className="text-xs text-gray-400">Ative os campos que deseja alterar. Apenas eles serão atualizados.</p>

          <Field label="Data" active={applyData} onToggle={() => setApplyData(v => !v)}>
            <input type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={dataVal} onChange={e => setDataVal(e.target.value)} />
          </Field>

          <Field label="Indicador" active={applyInd} onToggle={() => setApplyInd(v => !v)}>
            <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={codInd} onChange={e => setCodInd(e.target.value)}>
              <option value="">— Selecionar —</option>
              {indLeaves.map(r => (
                <option key={r.id} value={r.codigo ?? r.id}>
                  {r.codigo ? `${r.codigo} — ` : ""}{r.nome}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Unidade" active={applyUnidade} onToggle={() => setApplyUnidade(v => !v)}>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {([["valor", "Valor (R$)"], ["percentual", "Percentual (%)"]] as [UnidadeIndicador, string][]).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setUnidade(v)}
                  className="flex-1 py-2 text-sm font-medium transition-colors"
                  style={unidade === v ? { background: "#1e3a5f", color: "white" } : { background: "white", color: "#374151" }}>
                  {l}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Valor" active={applyValor} onToggle={() => setApplyValor(v => !v)}>
            <input type="text" inputMode="decimal"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={valorInput} onChange={e => setValorInput(e.target.value)} placeholder="0,00" />
          </Field>
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancelar</button>
          <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }}>
            Aplicar alterações
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Histórico de importações ─────────────────────────────────────────────────

function HistoricoTab({ historico, lancamentos, onExcluir, onImportar }: {
  historico: ImportacaoIndicador[];
  lancamentos: LancamentoIndicador[];
  onExcluir: (id: string) => void;
  onImportar: () => void;
}) {
  const contagemPorImport = useMemo(() => {
    const m = new Map<string, number>();
    lancamentos.forEach(l => {
      if (l.importacaoId) m.set(l.importacaoId, (m.get(l.importacaoId) ?? 0) + 1);
    });
    return m;
  }, [lancamentos]);

  const sorted = [...historico].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Clock size={40} className="text-gray-300 mb-3" />
        <p className="text-gray-500 font-medium">Nenhuma importação registrada</p>
        <p className="text-gray-400 text-sm mt-1">Importe dados de indicadores para ver o histórico aqui.</p>
        <button onClick={onImportar}
          className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
          style={{ background: "#1e3a5f" }}>
          <Upload size={14} /> Importar dados
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map(imp => {
        const qtd = contagemPorImport.get(imp.id) ?? imp.totalLinhas;
        const dataImport = new Date(imp.criadoEm).toLocaleString("pt-BR", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
        return (
          <div key={imp.id}
            className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 bg-white hover:border-gray-300 transition-all">
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-blue-100">
              <FileText size={16} className="text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-800 text-sm">
                  {imp.tipo === "realizado" ? "Realizado" : "Orçado"} · {periodoLabel(imp.periodo)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400 flex-wrap">
                <span>{qtd.toLocaleString("pt-BR")} lançamentos</span>
                <span>·</span>
                <span>Importado em {dataImport}</span>
              </div>
            </div>
            <button
              onClick={() => {
                if (!confirm(`Excluir esta importação?\n\nIsso removerá ${qtd.toLocaleString("pt-BR")} lançamento${qtd !== 1 ? "s" : ""} de ${imp.tipo === "realizado" ? "Realizado" : "Orçado"} · ${periodoLabel(imp.periodo)} permanentemente.`)) return;
                onExcluir(imp.id);
              }}
              title="Excluir importação"
              className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0">
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function LancamentosIndicadoresPage() {
  const { ano: anoHoje, mes: mesHoje } = hoje();
  const [ano, setAno] = useState(anoHoje);
  const [mes, setMes] = useState(mesHoje);
  const [tipo, setTipo] = useState<Tipo>("realizado");
  const [search, setSearch] = useState("");
  const [verTodos, setVerTodos] = useState(false);

  const [aba, setAba] = useState<Aba>("lancamentos");
  const [data, setData] = usePersistedData<LancamentoIndicador[]>("portal_lancamentos_indicadores", []);
  const [historico, setHistorico] = usePersistedData<ImportacaoIndicador[]>("portal_importacoes_indicadores", []);
  const [modal, setModal] = useState<{ open: boolean; modo: "add" | "edit"; form: Partial<LancamentoIndicador> } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  // multi-select
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClickIdx = useRef<number | null>(null);

  const indRows = useMemo(() => loadData<IndicadorRow[]>("portal_indicadores", []), []);
  const periodo = periodoStr(ano, mes);

  const indMap = useMemo(() => new Map(
    indRows.filter(r => r.tipo === "INDICADOR").map(r => [r.codigo ?? r.id, r.nome])
  ), [indRows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.filter(r => {
      if (r.tipo !== tipo) return false;
      if (!verTodos && r.periodo !== periodo) return false;
      if (!q) return true;
      return (
        r.cod_indicador.toLowerCase().includes(q) ||
        (indMap.get(r.cod_indicador) || "").toLowerCase().includes(q)
      );
    });
  }, [data, tipo, periodo, search, indMap, verTodos]);

  // Clear selection when filters change
  useEffect(() => { setSelected(new Set()); lastClickIdx.current = null; }, [tipo, periodo, verTodos]);

  function navMes(delta: number) {
    let m = mes + delta, a = ano;
    if (m > 12) { m = 1;  a++; }
    if (m < 1)  { m = 12; a--; }
    setMes(m); setAno(a);
  }

  function handleSave(f: Omit<LancamentoIndicador, "id">) {
    if (modal?.modo === "add") {
      setData(d => [...d, { ...f, id: `li_${Date.now()}` }]);
    } else {
      setData(d => d.map(r => r.id === (modal?.form as LancamentoIndicador).id ? { ...r, ...f } : r));
    }
    setModal(null);
  }

  function handleImport(rows: Omit<LancamentoIndicador, "id">[]) {
    const importacaoId = `imp_${Date.now()}`;
    setHistorico(h => [...h, { id: importacaoId, tipo, periodo, criadoEm: new Date().toISOString(), totalLinhas: rows.length }]);
    setData(d => {
      const sem   = d.filter(r => !(r.tipo === tipo && r.periodo === periodo));
      const novos = rows.map(r => ({ ...r, importacaoId, id: `li_${Date.now()}_${Math.random().toString(36).slice(2)}` }));
      return [...sem, ...novos];
    });
    setImportOpen(false);
  }

  function handleExcluirImportacao(id: string) {
    setData(d => d.filter(r => r.importacaoId !== id));
    setHistorico(h => h.filter(r => r.id !== id));
  }

  function handleDelete(id: string) {
    if (confirm("Remover este lançamento?")) setData(d => d.filter(r => r.id !== id));
  }

  // ── Seleção ──────────────────────────────────────────────────────────────────

  function handleCheckbox(id: string, idx: number, e: React.MouseEvent) {
    if (e.shiftKey && lastClickIdx.current !== null) {
      const from = Math.min(lastClickIdx.current, idx);
      const to   = Math.max(lastClickIdx.current, idx);
      setSelected(prev => {
        const next = new Set(prev);
        const ids  = filtered.slice(from, to + 1).map(r => r.id);
        const anyOff = ids.some(i => !next.has(i));
        ids.forEach(i => anyOff ? next.add(i) : next.delete(i));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
      lastClickIdx.current = idx;
    }
  }

  function toggleSelectAll() {
    setSelected(selected.size === filtered.length && filtered.length > 0
      ? new Set()
      : new Set(filtered.map(r => r.id))
    );
  }

  // ── Operações em lote ────────────────────────────────────────────────────────

  function handleBulkDelete() {
    if (!confirm(`Excluir ${selected.size} lançamento${selected.size !== 1 ? "s" : ""}?`)) return;
    setData(d => d.filter(r => !selected.has(r.id)));
    setSelected(new Set());
  }

  function handleDuplicate() {
    const rows = filtered.filter(r => selected.has(r.id));
    const novos = rows.map(r => ({
      ...r,
      id: `li_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      importacaoId: undefined,
    }));
    setData(d => [...d, ...novos]);
    setSelected(new Set());
  }

  function handleBulkSave(patch: Partial<Pick<LancamentoIndicador, "data" | "periodo" | "cod_indicador" | "unidade" | "valor">>) {
    setData(d => d.map(r => selected.has(r.id) ? { ...r, ...patch } : r));
    setSelected(new Set());
    setBulkEditOpen(false);
  }

  const totalValor  = filtered.reduce((s, r) => s + r.valor, 0);
  const allChecked  = filtered.length > 0 && selected.size === filtered.length;
  const someChecked = selected.size > 0 && selected.size < filtered.length;

  return (
    <div>
      <PageHeader
        title="Lançamentos de Indicadores"
        subtitle={aba === "lancamentos"
          ? `${filtered.length} lançamento${filtered.length !== 1 ? "s" : ""}${verTodos ? "" : ` · ${periodoLabel(periodo)}`}`
          : `${historico.length} importação${historico.length !== 1 ? "ões" : ""}`}>
        <button onClick={() => setImportOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
          <Upload size={14} /> Importar
        </button>
        <button onClick={() => setModal({ open: true, modo: "add", form: { periodo, tipo } })}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }}>
          <Plus size={14} /> Novo Lançamento
        </button>
      </PageHeader>

      {/* Tabs */}
      <div className="border-b border-gray-200 px-6">
        <div className="flex gap-0">
          {([["lancamentos", "Lançamentos"], ["historico", "Histórico de Importações"]] as [Aba, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setAba(id)}
              className="px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
              style={aba === id
                ? { borderColor: "#1e3a5f", color: "#1e3a5f" }
                : { borderColor: "transparent", color: "#6b7280" }}>
              {label}
              {id === "historico" && historico.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-5 h-4 text-[10px] font-bold rounded-full text-white" style={{ background: "#1e3a5f" }}>
                  {historico.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 space-y-4">

        {aba === "historico" && (
          <HistoricoTab
            historico={historico}
            lancamentos={data}
            onExcluir={handleExcluirImportacao}
            onImportar={() => setImportOpen(true)} />
        )}

        {aba === "lancamentos" && (
          <>
            {/* ── Filtros ── */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {(["realizado", "orcado"] as Tipo[]).map(t => (
                  <button key={t} onClick={() => setTipo(t)}
                    className="px-4 py-2 text-sm font-medium transition-colors"
                    style={tipo === t ? { background: "#1e3a5f", color: "white" } : { background: "white", color: "#374151" }}>
                    {t === "realizado" ? "Realizado" : "Orçado"}
                  </button>
                ))}
              </div>

              {!verTodos && (
                <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white">
                  <button onClick={() => navMes(-1)} className="p-0.5 hover:text-blue-600 transition-colors"><ChevronLeft size={15} /></button>
                  <span className="text-sm font-semibold text-gray-700 w-24 text-center">{periodoLabel(periodo)}</span>
                  <button onClick={() => navMes(1)} className="p-0.5 hover:text-blue-600 transition-colors"><ChevronRight size={15} /></button>
                </div>
              )}

              <button
                onClick={() => setVerTodos(v => !v)}
                className="px-3 py-2 text-sm font-medium border rounded-lg transition-colors"
                style={verTodos
                  ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" }
                  : { background: "white", color: "#374151", borderColor: "#e5e7eb" }}>
                Ver todos os períodos
              </button>

              <div className="relative ml-auto">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-56 bg-white"
                  placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>

            {/* ── Barra de ações em lote ── */}
            {selected.size > 0 && (
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-blue-200 bg-blue-50">
                <span className="text-sm font-semibold text-blue-700">
                  {selected.size} selecionado{selected.size !== 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-2 ml-2">
                  <button onClick={handleDuplicate}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition-colors">
                    <Copy size={12} /> Duplicar
                  </button>
                  <button onClick={() => setBulkEditOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition-colors">
                    <Pencil size={12} /> Editar em lote
                  </button>
                  <button onClick={handleBulkDelete}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-600 transition-colors">
                    <Trash2 size={12} /> Excluir
                  </button>
                </div>
                <button onClick={() => setSelected(new Set())}
                  className="ml-auto text-xs text-blue-500 hover:underline">
                  Desmarcar todos
                </button>
              </div>
            )}

            {/* ── Tabela ── */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {/* Checkbox header */}
                      <th className="px-3 py-2.5 w-10">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={el => { if (el) el.indeterminate = someChecked; }}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded cursor-pointer"
                          style={{ accentColor: "#1e3a5f" }} />
                      </th>
                      {verTodos && (
                        <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-24">Período</th>
                      )}
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-28">Data</th>
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left">Indicador</th>
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-right w-36">Valor</th>
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-center w-20">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row, idx) => {
                      const isSel = selected.has(row.id);
                      return (
                        <tr key={row.id}
                          className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                          style={isSel ? { background: "#eff6ff" } : undefined}>
                          {/* Checkbox */}
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={isSel}
                              onClick={e => handleCheckbox(row.id, idx, e as React.MouseEvent)}
                              onChange={() => {}}
                              className="w-4 h-4 rounded cursor-pointer"
                              style={{ accentColor: "#1e3a5f" }}
                              title="Shift+clique para selecionar intervalo" />
                          </td>
                          {verTodos && (
                            <td className="px-4 py-2 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                              {periodoLabel(row.periodo)}
                            </td>
                          )}
                          <td className="px-4 py-2 text-xs text-gray-600 tabular-nums whitespace-nowrap">
                            {row.data
                              ? new Date(row.data + "T00:00:00").toLocaleDateString("pt-BR")
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2">
                            <span className="font-mono text-xs font-semibold text-blue-700">{row.cod_indicador}</span>
                            {indMap.get(row.cod_indicador) && (
                              <span className="text-xs text-gray-500 ml-1.5">{indMap.get(row.cod_indicador)}</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            <span className={`text-sm font-semibold tabular-nums ${row.valor < 0 ? "text-red-600" : "text-gray-800"}`}>
                              {row.unidade === "percentual"
                                ? `${row.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                                : row.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </span>
                            {row.unidade === "percentual" && (
                              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700">%</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => setModal({ open: true, modo: "edit", form: { ...row } })}
                                className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors" title="Editar">
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => {
                                  const novo = { ...row, id: `li_${Date.now()}_${Math.random().toString(36).slice(2)}`, importacaoId: undefined };
                                  setData(d => [...d, novo]);
                                }}
                                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" title="Duplicar">
                                <Copy size={13} />
                              </button>
                              <button onClick={() => handleDelete(row.id)}
                                className="p-1.5 hover:bg-red-100 rounded-lg text-red-500 transition-colors" title="Excluir">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={verTodos ? 6 : 5} className="px-4 py-10 text-center text-gray-400 text-sm">
                          {verTodos
                            ? `Nenhum lançamento de ${tipo === "realizado" ? "Realizado" : "Orçado"}.`
                            : `Nenhum lançamento para ${periodoLabel(periodo)} — ${tipo === "realizado" ? "Realizado" : "Orçado"}.`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {filtered.length > 0 && (
                    <tfoot>
                      <tr style={{ background: "#f8fafc" }}>
                        <td colSpan={verTodos ? 3 : 2} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">
                          {selected.size > 0 ? `${selected.size} selecionado${selected.size !== 1 ? "s" : ""}` : "Total"}
                        </td>
                        <td className="px-4 py-2.5 text-left text-xs text-gray-500 uppercase font-semibold">
                          {filtered.length.toLocaleString("pt-BR")} linha{filtered.length !== 1 ? "s" : ""}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={`text-sm font-bold tabular-nums ${totalValor < 0 ? "text-red-600" : "text-gray-800"}`}>
                            {totalValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {modal?.open && (
        <LancamentoModal
          modo={modal.modo} tipo={tipo} form={modal.form}
          indRows={indRows}
          onSave={handleSave} onClose={() => setModal(null)} />
      )}

      {importOpen && (
        <ImportModal
          tipo={tipo} periodo={periodo}
          indRows={indRows}
          onImport={handleImport} onClose={() => setImportOpen(false)} />
      )}

      {bulkEditOpen && (
        <BulkEditModal
          count={selected.size}
          indRows={indRows}
          onSave={handleBulkSave}
          onClose={() => setBulkEditOpen(false)} />
      )}
    </div>
  );
}
