"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { Plus, Trash2, Pencil, Search, Upload, X, AlertTriangle, Download, Clock, FileText, Copy, Filter } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { FilterSection, FilterCheckbox, FilterDrawerShell } from "@/components/FilterAccordion";
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

// ─── Hierarquia de indicadores ────────────────────────────────────────────────

function buildIndicadorLabels(rows: IndicadorRow[]): Map<string, string> {
  const labels = new Map<string, string>();
  const path: Record<number, string> = {};
  for (const row of rows) {
    if (row.tipo === "SUBTOTAL") {
      path[row.nivel] = row.nome;
      // limpa níveis filhos ao entrar num novo subtotal
      Object.keys(path).forEach(k => { if (Number(k) > row.nivel) delete path[Number(k)]; });
    } else {
      const parts = Object.entries(path)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, v]) => v);
      const label = parts.length > 0 ? `${parts.join(" › ")} › ${row.nome}` : row.nome;
      labels.set(row.codigo ?? row.id, label);
    }
  }
  return labels;
}

// ─── Modal add/edit ───────────────────────────────────────────────────────────

interface PoloRowL { id: string; POLO: string; ESTADO: string; CIDADE: string; DATA_CRIACAO: string; DATA_INATIVO: string; }
interface ParceiroRowL { id: string; CODPARC: string; NOMEPARC: string; }
interface ProjetoRowL { id: string; CODPROJ: string; IDENTIFICACAO: string; ANALITICO: boolean; }
interface AdquiridaRowL { id: string; EMPRESA: string; DATA: string; ESTADO_ORIGEM: string; AREA_NEGOCIO: string; }

function LancamentoModal({ modo, tipo, form: initial, indRows, poloData, parceiroData, projetoData, adquiridaData, onSave, onClose }: {
  modo: "add" | "edit"; tipo: Tipo;
  form: Partial<LancamentoIndicador>;
  indRows: IndicadorRow[];
  poloData: PoloRowL[];
  parceiroData: ParceiroRowL[];
  projetoData: ProjetoRowL[];
  adquiridaData: AdquiridaRowL[];
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
  const hierLabels = useMemo(() => buildIndicadorLabels(indRows), [indRows]);
  const unidade = form.unidade ?? "valor";
  const cidadesDisponiveis  = useMemo(() => Array.from(new Set(poloData.map(p => p.CIDADE).filter(Boolean))).sort(), [poloData]);
  const parceirosDisponiveis = useMemo(() => [...parceiroData].sort((a, b) => a.CODPARC.localeCompare(b.CODPARC, undefined, { numeric: true, sensitivity: "base" })), [parceiroData]);
  const projetosDisponiveis  = useMemo(() => projetoData.filter(p => p.ANALITICO).sort((a, b) => a.CODPROJ.localeCompare(b.CODPROJ, undefined, { numeric: true, sensitivity: "base" })), [projetoData]);
  const adquiridasDisponiveis = useMemo(() => [...adquiridaData].sort((a, b) => a.EMPRESA.localeCompare(b.EMPRESA)), [adquiridaData]);

  function handleSave() {
    if (!form.data)          { alert("Informe a data.");      return; }
    if (!form.cod_indicador) { alert("Informe o Indicador."); return; }
    const valor = parseValor(valorInput);
    if (valor === null) { alert("Valor inválido. Use vírgula como separador decimal (ex: 9.201.226.094,00)."); return; }
    const data = form.data!;
    onSave({
      tipo, data, periodo: dataToPeriodo(data),
      cod_indicador: form.cod_indicador!,
      unidade, valor,
      polo_cidade: form.polo_cidade || undefined,
      parceiro:   form.parceiro   ? (form.parceiro.split(" — ")[0].trim() || undefined) : undefined,
      projeto:    form.projeto    ? (form.projeto.split(" — ")[0].trim()  || undefined) : undefined,
      cliente:    form.cliente    || undefined,
      adquirida:  form.adquirida  || undefined,
      comentario: form.comentario || undefined,
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
              {indLeaves.map(r => {
                const key = r.codigo ?? r.id;
                return (
                  <option key={r.id} value={key}>
                    {hierLabels.get(key) ?? r.nome}
                  </option>
                );
              })}
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

          {/* Classificações */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Polo (Cidade)</label>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.polo_cidade ?? ""} onChange={e => setForm(f => ({ ...f, polo_cidade: e.target.value || undefined }))}>
                <option value="">— Selecione —</option>
                {cidadesDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Parceiro</label>
              <input list="dl-parceiros"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.parceiro ?? ""}
                onChange={e => setForm(f => ({ ...f, parceiro: e.target.value || undefined }))}
                placeholder="Código ou nome..." />
              <datalist id="dl-parceiros">
                {parceirosDisponiveis.map(p => (
                  <option key={p.id} value={`${p.CODPARC} — ${p.NOMEPARC}`} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Projeto</label>
              <input list="dl-projetos"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.projeto ?? ""}
                onChange={e => setForm(f => ({ ...f, projeto: e.target.value || undefined }))}
                placeholder="Código ou nome..." />
              <datalist id="dl-projetos">
                {projetosDisponiveis.map(p => (
                  <option key={p.id} value={`${p.CODPROJ} — ${p.IDENTIFICACAO}`} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Cliente</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.cliente ?? ""} onChange={e => setForm(f => ({ ...f, cliente: e.target.value || undefined }))}
                placeholder="Nome do cliente" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Adquirida</label>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.adquirida ?? ""} onChange={e => setForm(f => ({ ...f, adquirida: e.target.value || undefined }))}>
                <option value="">— Selecione —</option>
                {adquiridasDisponiveis.map(a => <option key={a.id} value={a.EMPRESA}>{a.EMPRESA}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Comentário</label>
            <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={2} value={form.comentario ?? ""} onChange={e => setForm(f => ({ ...f, comentario: e.target.value || undefined }))}
              placeholder="Observações..." />
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

function ImportModal({ tipo, periodo, indRows, poloData, parceiroData, projetoData, adquiridaData, onImport, onClose }: {
  tipo: Tipo; periodo: string;
  indRows: IndicadorRow[];
  poloData: PoloRowL[];
  parceiroData: ParceiroRowL[];
  projetoData: ProjetoRowL[];
  adquiridaData: AdquiridaRowL[];
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

    const dataISO    = parseData(periodoRaw) ?? periodoValido! + "-01";
    const polo_cidade = (raw["POLO_CIDADE"]  || "").trim() || undefined;
    const parceiro    = (raw["COD_PARCEIRO"] || "").trim() || undefined;
    const projeto     = (raw["COD_PROJETO"]  || "").trim() || undefined;
    const cliente     = (raw["CLIENTE"]      || "").trim() || undefined;
    const adquirida   = (raw["ADQUIRIDA"]    || "").trim() || undefined;
    const comentario  = (raw["COMENTARIO"]   || "").trim() || undefined;
    return {
      raw, erros: [],
      lancamento: { tipo, data: dataISO, periodo: dataToPeriodo(dataISO), cod_indicador, unidade, valor: valor!, polo_cidade, parceiro, projeto, cliente, adquirida, comentario },
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
    const hierLabels = buildIndicadorLabels(indRows);
    const leaves = indRows.filter(r => r.tipo === "INDICADOR");

    const exCod      = leaves[0]?.codigo ?? leaves[0]?.id ?? "COD_EXEMPLO";
    const exCidade   = poloData[0]?.CIDADE ?? "";
    const exParcCod  = parceiroData[0]?.CODPARC ?? "";
    const exParcNome = parceiroData[0]?.NOMEPARC ?? "";
    const exProj     = projetoData.find(p => p.ANALITICO);
    const exProjCod  = exProj?.CODPROJ ?? "";
    const exProjNome = exProj?.IDENTIFICACAO ?? "";

    // Aba Template
    const exAdquirida = adquiridaData[0]?.EMPRESA ?? "";
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["PERIODO", "COD_INDICADOR", "VALOR", "UNIDADE", "POLO_CIDADE", "COD_PARCEIRO", "NOME_PARCEIRO", "COD_PROJETO", "NOME_PROJETO", "CLIENTE", "ADQUIRIDA", "COMENTARIO"],
      ["01/2026", exCod, "1000,00", "valor", exCidade, exParcCod, exParcNome, exProjCod, exProjNome, "", exAdquirida, ""],
    ]), "Template");

    // Aba Adquiridas
    if (adquiridaData.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        [...adquiridaData].sort((a, b) => a.EMPRESA.localeCompare(b.EMPRESA))
          .map(a => ({ ADQUIRIDA: a.EMPRESA }))
      ), "Adquiridas");
    }

    // Aba Indicadores
    if (leaves.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        leaves.map(r => ({
          COD_INDICADOR: r.codigo ?? r.id,
          Nome: hierLabels.get(r.codigo ?? r.id) ?? r.nome,
          Categoria: r.categoria ?? "MENSAL",
        }))
      ), "Indicadores");
    }

    // Aba Polos
    const cidades = Array.from(new Set(poloData.map(p => p.CIDADE).filter(Boolean))).sort();
    if (cidades.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        cidades.map(c => ({ POLO_CIDADE: c }))
      ), "Polos");
    }

    // Aba Parceiros
    if (parceiroData.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        [...parceiroData]
          .sort((a, b) => a.CODPARC.localeCompare(b.CODPARC, undefined, { numeric: true, sensitivity: "base" }))
          .map(p => ({ COD_PARCEIRO: p.CODPARC, NOME_PARCEIRO: p.NOMEPARC }))
      ), "Parceiros");
    }

    // Aba Projetos
    const projAnaliticos = projetoData
      .filter(p => p.ANALITICO)
      .sort((a, b) => a.CODPROJ.localeCompare(b.CODPROJ, undefined, { numeric: true, sensitivity: "base" }));
    if (projAnaliticos.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        projAnaliticos.map(p => ({ COD_PROJETO: p.CODPROJ, NOME_PROJETO: p.IDENTIFICACAO }))
      ), "Projetos");
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
              {["PERIODO *", "COD_INDICADOR *", "VALOR *", "UNIDADE", "POLO_CIDADE", "COD_PARCEIRO", "NOME_PARCEIRO", "COD_PROJETO", "NOME_PROJETO", "CLIENTE", "ADQUIRIDA", "COMENTARIO"].map(c => (
                <span key={c} className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium ${c.endsWith("*") ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>{c}</span>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">* Obrigatórias. UNIDADE aceita "%" ou "percentual" (padrão: valor). Parametrização usa COD_PARCEIRO e COD_PROJETO; NOME_* é ignorado na importação.</p>
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
                  Os lançamentos de <strong>{tipo}</strong> nos períodos do arquivo serão substituídos.
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
  const hierLabels = useMemo(() => buildIndicadorLabels(indRows), [indRows]);

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
              {indLeaves.map(r => {
                const key = r.codigo ?? r.id;
                return (
                  <option key={r.id} value={key}>
                    {hierLabels.get(key) ?? r.nome}
                  </option>
                );
              })}
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
  const [tipo, setTipo] = useState<Tipo>("realizado");
  const [search, setSearch] = useState("");

  const [aba, setAba] = useState<Aba>("lancamentos");
  const [data, setData] = usePersistedData<LancamentoIndicador[]>("portal_lancamentos_indicadores", []);
  const [historico, setHistorico] = usePersistedData<ImportacaoIndicador[]>("portal_importacoes_indicadores", []);
  const [modal, setModal] = useState<{ open: boolean; modo: "add" | "edit"; form: Partial<LancamentoIndicador> } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const periodoHoje = periodoStr(anoHoje, mesHoje);
  interface Filtros { polo: string[]; parceiro: string[]; projeto: string[]; unidade: string[]; adquirida: string[]; indicador: string[]; periodoDE: string; periodoATE: string; }
  const filtrosVazios: Filtros = { polo: [], parceiro: [], projeto: [], unidade: [], adquirida: [], indicador: [], periodoDE: periodoHoje, periodoATE: periodoHoje };
  const [filtros, setFiltros] = usePersistedData<Filtros>("portal_filtros_lanc_indicadores", filtrosVazios);
  const [rascunho, setRascunho] = useState<Filtros>(filtrosVazios);

  const nfiltros: Filtros = {
    polo:       Array.isArray(filtros.polo)       ? filtros.polo       : [],
    parceiro:   Array.isArray(filtros.parceiro)   ? filtros.parceiro   : [],
    projeto:    Array.isArray(filtros.projeto)    ? filtros.projeto    : [],
    unidade:    Array.isArray(filtros.unidade)    ? filtros.unidade    : [],
    adquirida:  Array.isArray(filtros.adquirida)  ? filtros.adquirida  : [],
    indicador:  Array.isArray(filtros.indicador)  ? filtros.indicador  : [],
    periodoDE:  typeof filtros.periodoDE  === "string" ? filtros.periodoDE  : periodoHoje,
    periodoATE: typeof filtros.periodoATE === "string" ? filtros.periodoATE : periodoHoje,
  };
  const filtrosAtivos = !!(nfiltros.polo.length || nfiltros.parceiro.length || nfiltros.projeto.length || nfiltros.unidade.length || nfiltros.adquirida.length || nfiltros.indicador.length);

  // multi-select
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClickIdx = useRef<number | null>(null);

  const indRows = useMemo(() => loadData<IndicadorRow[]>("portal_indicadores", []), []);
  const [poloData] = usePersistedData<PoloRowL[]>("portal_polo", []);
  const [parceiroData] = usePersistedData<ParceiroRowL[]>("portal_parceiro", []);
  const [projetoData] = usePersistedData<ProjetoRowL[]>("portal_projetos", []);
  const [adquiridaData] = usePersistedData<AdquiridaRowL[]>("portal_adquiridas", []);

  const periodo = periodoHoje;

  const indMap = useMemo(() => new Map(
    indRows.filter(r => r.tipo === "INDICADOR").map(r => [r.codigo ?? r.id, r.nome])
  ), [indRows]);

  const parceiroMap = useMemo(() => new Map(parceiroData.map(p => [p.CODPARC, p.NOMEPARC])), [parceiroData]);
  const projetoMap  = useMemo(() => new Map(projetoData.map(p => [p.CODPROJ, p.IDENTIFICACAO])), [projetoData]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.filter(r => {
      if (r.tipo !== tipo) return false;
      if (nfiltros.periodoDE  && r.periodo < nfiltros.periodoDE)  return false;
      if (nfiltros.periodoATE && r.periodo > nfiltros.periodoATE) return false;
      if (nfiltros.indicador.length  && !nfiltros.indicador.includes(r.cod_indicador))   return false;
      if (nfiltros.polo.length      && !nfiltros.polo.includes(r.polo_cidade ?? ""))    return false;
      if (nfiltros.parceiro.length  && !nfiltros.parceiro.includes(r.parceiro ?? ""))   return false;
      if (nfiltros.projeto.length   && !nfiltros.projeto.includes(r.projeto ?? ""))     return false;
      if (nfiltros.unidade.length   && !nfiltros.unidade.includes(r.unidade))           return false;
      if (nfiltros.adquirida.length && !nfiltros.adquirida.includes(r.adquirida ?? "")) return false;
      if (!q) return true;
      return (
        r.cod_indicador.toLowerCase().includes(q) ||
        (indMap.get(r.cod_indicador) || "").toLowerCase().includes(q) ||
        (r.parceiro || "").toLowerCase().includes(q) ||
        (parceiroMap.get(r.parceiro ?? "") || "").toLowerCase().includes(q) ||
        (r.projeto || "").toLowerCase().includes(q) ||
        (projetoMap.get(r.projeto ?? "") || "").toLowerCase().includes(q) ||
        (r.cliente || "").toLowerCase().includes(q)
      );
    });
  }, [data, tipo, search, indMap, filtros, parceiroMap, projetoMap]);

  // Clear selection when filters change
  const filtrosKey = JSON.stringify(filtros);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSelected(new Set()); lastClickIdx.current = null; }, [tipo, filtrosKey]);

  const optsPolos       = useMemo(() => Array.from(new Set(data.map(r => r.polo_cidade).filter(Boolean) as string[])).sort(), [data]);
  const optsParceiros   = useMemo(() => Array.from(new Set(data.map(r => r.parceiro).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [data]);
  const optsProjetos    = useMemo(() => Array.from(new Set(data.map(r => r.projeto).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [data]);
  const optsAdquiridas  = useMemo(() => Array.from(new Set(data.map(r => r.adquirida).filter(Boolean) as string[])).sort(), [data]);
  const hierLabelsPage  = useMemo(() => buildIndicadorLabels(indRows), [indRows]);
  const optsIndicadores = useMemo(() => Array.from(new Set(data.filter(r => r.tipo === tipo).map(r => r.cod_indicador))).sort((a, b) => {
    const la = hierLabelsPage.get(a) ?? a;
    const lb = hierLabelsPage.get(b) ?? b;
    return la.localeCompare(lb, "pt-BR");
  }), [data, tipo, hierLabelsPage]);

  function openFilter() {
    setRascunho({ ...nfiltros });
    setFilterOpen(true);
  }
  function applyFilter() { setFiltros({ ...rascunho }); setFilterOpen(false); }
  function clearFilter() { setRascunho(filtrosVazios); }

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
    const periodosImport = new Set(rows.map(r => r.periodo));
    const periodoRef = rows[0]?.periodo ?? periodo;
    setHistorico(h => [...h, { id: importacaoId, tipo, periodo: periodoRef, criadoEm: new Date().toISOString(), totalLinhas: rows.length }]);
    setData(d => {
      const sem   = d.filter(r => !(r.tipo === tipo && periodosImport.has(r.periodo)));
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
          ? `${filtered.length} lançamento${filtered.length !== 1 ? "s" : ""}`
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

              <span className="text-sm font-semibold text-gray-600 px-1">
                {!nfiltros.periodoDE && !nfiltros.periodoATE
                  ? "Todos os períodos"
                  : nfiltros.periodoDE === nfiltros.periodoATE && nfiltros.periodoDE
                  ? periodoLabel(nfiltros.periodoDE)
                  : `${nfiltros.periodoDE ? periodoLabel(nfiltros.periodoDE) : "início"} – ${nfiltros.periodoATE ? periodoLabel(nfiltros.periodoATE) : "atual"}`}
              </span>

              <button onClick={openFilter}
                className="relative flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors"
                style={filtrosAtivos ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
                <Filter size={14} /> Filtros
                {filtrosAtivos && <span className="w-1.5 h-1.5 rounded-full bg-white absolute top-1 right-1" />}
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
              <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
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
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-24">Período</th>
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-28">Data</th>
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left">Indicador</th>
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-28">Polo</th>
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-32">Parceiro</th>
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-32">Projeto</th>
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-32">Cliente</th>
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-32">Adquirida</th>
                      <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-40">Comentário</th>
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
                          <td className="px-4 py-2 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                              {periodoLabel(row.periodo)}
                            </td>
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
                          <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{row.polo_cidade || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                            {row.parceiro ? <><span className="font-mono text-blue-700 font-semibold">{row.parceiro}</span>{parceiroMap.get(row.parceiro) && <span className="ml-1 text-gray-400">{parceiroMap.get(row.parceiro)}</span>}</> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                            {row.projeto ? <><span className="font-mono text-blue-700 font-semibold">{row.projeto}</span>{projetoMap.get(row.projeto) && <span className="ml-1 text-gray-400">{projetoMap.get(row.projeto)}</span>}</> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{row.cliente || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{row.adquirida || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2 text-xs text-gray-500 max-w-[160px] truncate" title={row.comentario}>{row.comentario || <span className="text-gray-300">—</span>}</td>
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
                        <td colSpan={12} className="px-4 py-10 text-center text-gray-400 text-sm">
                          {`Nenhum lançamento de ${tipo === "realizado" ? "Realizado" : "Orçado"} para o período selecionado.`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {filtered.length > 0 && (
                    <tfoot>
                      <tr style={{ background: "#f8fafc" }}>
                        <td colSpan={9} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">
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
          poloData={poloData} parceiroData={parceiroData} projetoData={projetoData} adquiridaData={adquiridaData}
          onSave={handleSave} onClose={() => setModal(null)} />
      )}

      {importOpen && (
        <ImportModal
          tipo={tipo} periodo={periodo}
          indRows={indRows}
          poloData={poloData} parceiroData={parceiroData} projetoData={projetoData} adquiridaData={adquiridaData}
          onImport={handleImport} onClose={() => setImportOpen(false)} />
      )}

      {bulkEditOpen && (
        <BulkEditModal
          count={selected.size}
          indRows={indRows}
          onSave={handleBulkSave}
          onClose={() => setBulkEditOpen(false)} />
      )}

      {filterOpen && (
        <FilterDrawerShell
          totalAtivos={nfiltros.indicador.length + nfiltros.polo.length + nfiltros.parceiro.length + nfiltros.projeto.length + nfiltros.unidade.length + nfiltros.adquirida.length}
          onClose={() => setFilterOpen(false)} onApply={applyFilter} onClear={clearFilter}>

          {/* ── Período ── */}
          <FilterSection
            label="Período"
            count={0}
            onClear={() => setRascunho(p => ({ ...p, periodoDE: periodoHoje, periodoATE: periodoHoje }))}>
            <div className="px-1 space-y-3">
              <div>
                <p className="text-xs text-gray-400 mb-1">De</p>
                <input type="month"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                  value={rascunho.periodoDE}
                  onChange={e => setRascunho(p => ({ ...p, periodoDE: e.target.value }))} />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Até</p>
                <input type="month"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                  value={rascunho.periodoATE}
                  onChange={e => setRascunho(p => ({ ...p, periodoATE: e.target.value }))} />
              </div>
              <button
                onClick={() => setRascunho(p => ({ ...p, periodoDE: "", periodoATE: "" }))}
                className="text-xs text-gray-400 hover:text-blue-600 transition-colors">
                Limpar datas (ver todos os períodos)
              </button>
            </div>
          </FilterSection>

          {/* ── Indicador ── */}
          <FilterSection label="Indicador" count={rascunho.indicador.length} onClear={() => setRascunho(p => ({ ...p, indicador: [] }))} searchable>
            {(srch) => {
              const opts = optsIndicadores.filter(v => {
                if (!srch) return true;
                const label = hierLabelsPage.get(v) ?? v;
                return label.toLowerCase().includes(srch.toLowerCase()) || v.toLowerCase().includes(srch.toLowerCase());
              });
              return <>
                {opts.map(v => (
                  <FilterCheckbox key={v} label={hierLabelsPage.get(v) ?? v} checked={rascunho.indicador.includes(v)}
                    onChange={() => setRascunho(p => ({ ...p, indicador: p.indicador.includes(v) ? p.indicador.filter(x => x !== v) : [...p.indicador, v] }))} />
                ))}
                {opts.length === 0 && <p className="text-xs text-gray-400 px-1">Nenhum resultado.</p>}
              </>;
            }}
          </FilterSection>

          {/* ── Polo ── */}
          <FilterSection label="Polo" count={rascunho.polo.length} onClear={() => setRascunho(p => ({ ...p, polo: [] }))} searchable>
            {(srch) => {
              const opts = optsPolos.filter(v => !srch || v.toLowerCase().includes(srch.toLowerCase()));
              return <>
                {opts.map(v => (
                  <FilterCheckbox key={v} label={v} checked={rascunho.polo.includes(v)}
                    onChange={() => setRascunho(p => ({ ...p, polo: p.polo.includes(v) ? p.polo.filter(x => x !== v) : [...p.polo, v] }))} />
                ))}
                {opts.length === 0 && <p className="text-xs text-gray-400 px-1">Nenhum resultado.</p>}
              </>;
            }}
          </FilterSection>

          {/* ── Parceiro ── */}
          <FilterSection label="Parceiro" count={rascunho.parceiro.length} onClear={() => setRascunho(p => ({ ...p, parceiro: [] }))} searchable>
            {(srch) => {
              const opts = optsParceiros.filter(v => !srch || v.toLowerCase().includes(srch.toLowerCase()) || (parceiroMap.get(v) || "").toLowerCase().includes(srch.toLowerCase()));
              return <>
                {opts.map(v => (
                  <FilterCheckbox key={v} label={`${v}${parceiroMap.get(v) ? ` — ${parceiroMap.get(v)}` : ""}`} checked={rascunho.parceiro.includes(v)}
                    onChange={() => setRascunho(p => ({ ...p, parceiro: p.parceiro.includes(v) ? p.parceiro.filter(x => x !== v) : [...p.parceiro, v] }))} />
                ))}
                {opts.length === 0 && <p className="text-xs text-gray-400 px-1">Nenhum resultado.</p>}
              </>;
            }}
          </FilterSection>

          {/* ── Projeto ── */}
          <FilterSection label="Projeto" count={rascunho.projeto.length} onClear={() => setRascunho(p => ({ ...p, projeto: [] }))} searchable>
            {(srch) => {
              const opts = optsProjetos.filter(v => !srch || v.toLowerCase().includes(srch.toLowerCase()) || (projetoMap.get(v) || "").toLowerCase().includes(srch.toLowerCase()));
              return <>
                {opts.map(v => (
                  <FilterCheckbox key={v} label={`${v}${projetoMap.get(v) ? ` — ${projetoMap.get(v)}` : ""}`} checked={rascunho.projeto.includes(v)}
                    onChange={() => setRascunho(p => ({ ...p, projeto: p.projeto.includes(v) ? p.projeto.filter(x => x !== v) : [...p.projeto, v] }))} />
                ))}
                {opts.length === 0 && <p className="text-xs text-gray-400 px-1">Nenhum resultado.</p>}
              </>;
            }}
          </FilterSection>

          {/* ── Unidade ── */}
          <FilterSection label="Unidade" count={rascunho.unidade.length} onClear={() => setRascunho(p => ({ ...p, unidade: [] }))}>
            {[{ v: "valor", l: "Valor (R$)" }, { v: "percentual", l: "Percentual (%)" }].map(({ v, l }) => (
              <FilterCheckbox key={v} label={l} checked={rascunho.unidade.includes(v)}
                onChange={() => setRascunho(p => ({ ...p, unidade: p.unidade.includes(v) ? p.unidade.filter(x => x !== v) : [...p.unidade, v] }))} />
            ))}
          </FilterSection>

          {/* ── Adquirida ── */}
          <FilterSection label="Adquirida" count={rascunho.adquirida.length} onClear={() => setRascunho(p => ({ ...p, adquirida: [] }))} searchable>
            {(srch) => {
              const opts = optsAdquiridas.filter(v => !srch || v.toLowerCase().includes(srch.toLowerCase()));
              return <>
                {opts.map(v => (
                  <FilterCheckbox key={v} label={v} checked={rascunho.adquirida.includes(v)}
                    onChange={() => setRascunho(p => ({ ...p, adquirida: p.adquirida.includes(v) ? p.adquirida.filter(x => x !== v) : [...p.adquirida, v] }))} />
                ))}
                {opts.length === 0 && <p className="text-xs text-gray-400 px-1">Nenhum resultado.</p>}
              </>;
            }}
          </FilterSection>

        </FilterDrawerShell>
      )}
    </div>
  );
}
