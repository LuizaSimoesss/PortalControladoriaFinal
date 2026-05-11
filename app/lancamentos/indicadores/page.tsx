"use client";

import { useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { Plus, Trash2, Pencil, Search, Upload, X, AlertTriangle, ChevronLeft, ChevronRight, Download } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData, loadData } from "@/lib/storage";
import type { LancamentoIndicador, IndicadorRow, UnidadeIndicador } from "@/lib/mockData";

type Tipo = "realizado" | "orcado";

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
  const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? null : n;
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

// ─── Página principal ─────────────────────────────────────────────────────────

export default function LancamentosIndicadoresPage() {
  const { ano: anoHoje, mes: mesHoje } = hoje();
  const [ano, setAno] = useState(anoHoje);
  const [mes, setMes] = useState(mesHoje);
  const [tipo, setTipo] = useState<Tipo>("realizado");
  const [search, setSearch] = useState("");

  const [data, setData] = usePersistedData<LancamentoIndicador[]>("portal_lancamentos_indicadores", []);
  const [modal, setModal] = useState<{ open: boolean; modo: "add" | "edit"; form: Partial<LancamentoIndicador> } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const indRows = useMemo(() => loadData<IndicadorRow[]>("portal_indicadores", []), []);
  const periodo = periodoStr(ano, mes);

  const indMap = useMemo(() => new Map(
    indRows.filter(r => r.tipo === "INDICADOR").map(r => [r.codigo ?? r.id, r.nome])
  ), [indRows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.filter(r => {
      if (r.tipo !== tipo || r.periodo !== periodo) return false;
      if (!q) return true;
      return (
        r.cod_indicador.toLowerCase().includes(q) ||
        (indMap.get(r.cod_indicador) || "").toLowerCase().includes(q)
      );
    });
  }, [data, tipo, periodo, search, indMap]);

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
    setData(d => {
      const sem  = d.filter(r => !(r.tipo === tipo && r.periodo === periodo));
      const novos = rows.map(r => ({ ...r, id: `li_${Date.now()}_${Math.random().toString(36).slice(2)}` }));
      return [...sem, ...novos];
    });
    setImportOpen(false);
  }

  function handleDelete(id: string) {
    if (confirm("Remover este lançamento?")) setData(d => d.filter(r => r.id !== id));
  }

  const totalValor = filtered.reduce((s, r) => s + r.valor, 0);

  return (
    <div>
      <PageHeader
        title="Lançamentos de Indicadores"
        subtitle={`${filtered.length} lançamento${filtered.length !== 1 ? "s" : ""} · ${periodoLabel(periodo)}`}>
        <button onClick={() => setImportOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
          <Upload size={14} /> Importar
        </button>
        <button onClick={() => setModal({ open: true, modo: "add", form: { periodo, tipo } })}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }}>
          <Plus size={14} /> Novo Lançamento
        </button>
      </PageHeader>

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(["realizado", "orcado"] as Tipo[]).map(t => (
              <button key={t} onClick={() => setTipo(t)}
                className="px-4 py-2 text-sm font-medium transition-colors"
                style={tipo === t ? { background: "#1e3a5f", color: "white" } : { background: "white", color: "#374151" }}>
                {t === "realizado" ? "Realizado" : "Orçado"}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <button onClick={() => navMes(-1)} className="p-0.5 hover:text-blue-600 transition-colors"><ChevronLeft size={15} /></button>
            <span className="text-sm font-semibold text-gray-700 w-24 text-center">{periodoLabel(periodo)}</span>
            <button onClick={() => navMes(1)} className="p-0.5 hover:text-blue-600 transition-colors"><ChevronRight size={15} /></button>
          </div>

          <div className="relative ml-auto">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-56 bg-white"
              placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-28">Data</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left">Indicador</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-right w-36">Valor</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-center w-20">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
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
                          className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => handleDelete(row.id)}
                          className="p-1.5 hover:bg-red-100 rounded-lg text-red-500 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">
                      Nenhum lançamento para {periodoLabel(periodo)} — {tipo === "realizado" ? "Realizado" : "Orçado"}.
                    </td>
                  </tr>
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#f8fafc" }}>
                    <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Total</td>
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
    </div>
  );
}
