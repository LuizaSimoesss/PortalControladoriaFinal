"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  Plus, Trash2, Pencil, Search, Upload, X, AlertTriangle,
  ChevronLeft, ChevronRight, CheckCircle2, Clock, FileText, Star,
  Filter, ChevronDown, Download,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData, loadData, saveData } from "@/lib/storage";
import { idbGet, idbSet } from "@/lib/idb";
import type {
  LancamentoFinanceiro, Fechamento, NaturezaRow, CentroResultadoRow,
  ProjetoRow, ParceiroRow, EmpresaRow,
} from "@/lib/mockData";

type Tipo = "realizado" | "orcado";
type Aba = "fechamentos" | "lancamentos";

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function periodoLabel(p: string) {
  if (!p) return "—";
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

function dataHoje() {
  return new Date().toISOString().slice(0, 10);
}

function dataToPeriodo(data: string) {
  return data.slice(0, 7);
}

// ─── parse helpers ────────────────────────────────────────────────────────────

function parseValor(v: string): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "-" || s.toLowerCase() === "null") return null;

  // Notação contábil com parênteses → negativo: (1.234,56) ou (1234.56)
  const isNeg = s.startsWith("(") && s.endsWith(")");
  // Remove R$, espaços, parênteses, aspas
  let clean = s.replace(/[R$\s()'"]/g, "");

  // Detecta formato: se contém vírgula E ponto, o último separador é o decimal
  // Ex: "1.234,56" → BR  |  "1,234.56" → EN  |  "1234,56" → BR  |  "1234.56" → EN
  const hasDot   = clean.includes(".");
  const hasComma = clean.includes(",");

  if (hasComma && hasDot) {
    // ambos presentes: o que vem por último é o decimal
    if (clean.lastIndexOf(",") > clean.lastIndexOf(".")) {
      // formato BR: 1.234,56
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      // formato EN: 1,234.56
      clean = clean.replace(/,/g, "");
    }
  } else if (hasComma) {
    // só vírgula: pode ser separador decimal BR (1234,56) ou separador de milhar EN (1,234)
    // se a parte após a vírgula tem exatamente 3 dígitos e não há dígitos depois → milhar
    const afterComma = clean.split(",")[1] ?? "";
    if (afterComma.length === 3 && !afterComma.includes(".")) {
      clean = clean.replace(",", ""); // trata como milhar
    } else {
      clean = clean.replace(",", "."); // trata como decimal BR
    }
  }
  // se só tem ponto, já está no formato EN (1234.56) ou é milhar (1.234) → parseFloat lida

  const n = parseFloat(clean);
  if (isNaN(n)) return null;
  return isNeg ? -Math.abs(n) : n;
}

function excelSerialToISO(serial: number): string {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return date.toISOString().slice(0, 10);
}

function parsePeriodo(v: string): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d{4,6}$/.test(s)) {
    const n = parseInt(s);
    if (n > 40000 && n < 60000) return excelSerialToISO(n).slice(0, 7);
  }
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{2}\/\d{4}$/.test(s)) return `${s.slice(3)}-${s.slice(0, 2)}`;
  // "DD/MM/YYYY"
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return `${s.slice(6)}-${s.slice(3, 5)}`;
  // "YYYY-MM-DD" ou "YYYY-MM-DD HH:MM:SS"
  const mISO = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (mISO) return mISO[1].slice(0, 7);
  // "D/M/AA" ou "DD/MM/AA" (Excel pt-BR com ano de 2 dígitos)
  const mShort = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mShort) {
    const day = mShort[1].padStart(2, "0");
    const mon = mShort[2].padStart(2, "0");
    const yr  = parseInt(mShort[3]) >= 50 ? `19${mShort[3]}` : `20${mShort[3]}`;
    void day; // dia não é necessário para o período
    return `${yr}-${mon}`;
  }
  return null;
}

function parseDataCompleta(v: string): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d{4,6}$/.test(s)) {
    const n = parseInt(s);
    if (n > 40000 && n < 60000) return excelSerialToISO(n);
  }
  // "DD/MM/YYYY"
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return `${s.slice(6)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
  // "YYYY-MM-DD" ou "YYYY-MM-DD HH:MM:SS"
  const mISO = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (mISO) return mISO[1];
  // "D/M/AA" ou "DD/MM/AA" (Excel pt-BR com ano de 2 dígitos)
  const mShort = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mShort) {
    const day = mShort[1].padStart(2, "0");
    const mon = mShort[2].padStart(2, "0");
    const yr  = parseInt(mShort[3]) >= 50 ? `19${mShort[3]}` : `20${mShort[3]}`;
    return `${yr}-${mon}-${day}`;
  }
  const p = parsePeriodo(s);
  return p ? p + "-01" : null;
}

// ─── Modal Adicionar/Editar Lançamento ────────────────────────────────────────

const emptyForm = (): Omit<LancamentoFinanceiro, "id" | "tipo" | "fechamentoId"> => {
  const data = dataHoje();
  return { data, periodo: dataToPeriodo(data), codnat: "", codcencus: "", codemp: "", codproj: "", codparc: "", valor: 0 };
};

function LancamentoModal({ modo, tipo, periodo, form: initial, natRows, crRows, projRows, parcRows, empRows, onSave, onClose }: {
  modo: "add" | "edit";
  tipo: Tipo;
  periodo: string;
  form: Partial<LancamentoFinanceiro>;
  natRows: NaturezaRow[];
  crRows: CentroResultadoRow[];
  projRows: ProjetoRow[];
  parcRows: ParceiroRow[];
  empRows: EmpresaRow[];
  onSave: (f: Omit<LancamentoFinanceiro, "id" | "fechamentoId">) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<LancamentoFinanceiro>>({ ...initial });
  const set = (k: keyof LancamentoFinanceiro, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  function handleSave() {
    if (!form.data)      { alert("Informe a data.");                return; }
    if (!form.codnat)    { alert("Informe a Natureza.");            return; }
    if (!form.codcencus) { alert("Informe o Centro de Resultado."); return; }
    if (tipo === "realizado" && !form.codemp) { alert("Informe a Empresa."); return; }
    const data = form.data!;
    onSave({ tipo, data, periodo: dataToPeriodo(data), codnat: form.codnat!, codcencus: form.codcencus!,
      codemp: form.codemp!, codproj: form.codproj || undefined, codparc: form.codparc || undefined,
      valor: Number(form.valor ?? 0) });
  }

  const inp = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const sel = inp + " bg-white";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: "90vh" }}>
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
            <input type="date" className={inp} value={form.data || ""} onChange={e => set("data", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Natureza *</label>
              <select className={sel} value={form.codnat || ""} onChange={e => set("codnat", e.target.value)}>
                <option value="">— Selecionar —</option>
                {natRows.filter(r => r.ANALITICA && r.ATIVA).map(r => (
                  <option key={r.CODNAT} value={r.CODNAT}>{r.CODNAT} — {r.DESCRNAT}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Centro de Resultado *</label>
              <select className={sel} value={form.codcencus || ""} onChange={e => set("codcencus", e.target.value)}>
                <option value="">— Selecionar —</option>
                {crRows.filter(r => r.ANALITICO && r.ATIVO).map(r => (
                  <option key={r.CODCENCUS} value={r.CODCENCUS}>{r.CODCENCUS} — {r.DESCRCENCUS}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Empresa *</label>
            <select className={sel} value={form.codemp || ""} onChange={e => set("codemp", e.target.value)}>
              <option value="">— Selecionar —</option>
              {empRows.map(r => <option key={r.CODEMP} value={r.CODEMP}>{r.CODEMP} — {r.RAZAOSOCIAL}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Projeto</label>
              <select className={sel} value={form.codproj || ""} onChange={e => set("codproj", e.target.value)}>
                <option value="">— Nenhum —</option>
                {projRows.filter(r => r.ANALITICO && r.ATIVO).map(r => (
                  <option key={r.CODPROJ} value={r.CODPROJ}>{r.CODPROJ} — {r.IDENTIFICACAO}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Parceiro</label>
              <select className={sel} value={form.codparc || ""} onChange={e => set("codparc", e.target.value)}>
                <option value="">— Nenhum —</option>
                {parcRows.map(r => <option key={r.CODPARC} value={r.CODPARC}>{r.CODPARC} — {r.NOMEPARC}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Valor *</label>
            <input type="number" step="0.01" className={inp}
              value={form.valor ?? ""} onChange={e => set("valor", parseFloat(e.target.value) || 0)} placeholder="0,00" />
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

// ─── Modal de Importação (2 etapas) ──────────────────────────────────────────

interface ImportRow {
  raw: Record<string, string>;
  erros: string[];
  lancamento?: Omit<LancamentoFinanceiro, "id" | "fechamentoId">;
}

function ImportModal({ tipo, natRows, crRows, projRows, parcRows, empRows, onImport, onClose }: {
  tipo: Tipo;
  natRows: NaturezaRow[];
  crRows: CentroResultadoRow[];
  projRows: ProjetoRow[];
  parcRows: ParceiroRow[];
  empRows: EmpresaRow[];
  onImport: (fech: Omit<Fechamento, "id" | "totalLinhas">, rows: Omit<LancamentoFinanceiro, "id" | "fechamentoId">[]) => Promise<void>;
  onClose: () => void;
}) {
  const { ano: anoHoje, mes: mesHoje } = hoje();
  const [step, setStep] = useState<1 | 2>(1);

  // Etapa 1 — info do fechamento
  const [mesRef, setMesRef] = useState(periodoStr(anoHoje, mesHoje));
  const [label, setLabel] = useState(`Fechamento ${periodoLabel(periodoStr(anoHoje, mesHoje))}`);
  const [marcarAtivo, setMarcarAtivo] = useState(true);

  // auto-atualiza label quando mês muda (se usuário não editou manualmente)
  const labelEditado = useRef(false);
  function handleMesRefChange(v: string) {
    setMesRef(v);
    if (!labelEditado.current) setLabel(`Fechamento ${periodoLabel(v)}`);
  }

  // Etapa 2 — arquivo + validação
  // Armazena separado: linhas válidas (sem raw, só lancamento) e inválidas (com raw para exibição de erro)
  const [validRows,   setValidRows]   = useState<Omit<LancamentoFinanceiro, "id" | "fechamentoId">[]>([]);
  const [invalidRows, setInvalidRows] = useState<ImportRow[]>([]);
  const [totalRows,   setTotalRows]   = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ atual: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isRealizado = tipo === "realizado";
  const colPeriodo  = isRealizado ? "AD_DTDECOMPETENCIA" : "PERIODO";
  const colValor    = isRealizado ? "VALOR_FINAL" : "VALOR";

  // Tenta múltiplos nomes de coluna e retorna o primeiro valor não vazio e não "-" (traço isolado)
  function resolveRaw(raw: Record<string, string>, ...candidates: string[]): string {
    for (const c of candidates) {
      const v = raw[c];
      if (v !== undefined) {
        const t = v.trim();
        if (t !== "" && t !== "-") return t;
      }
    }
    return "";
  }

  const natSet  = useMemo(() => new Set(natRows.map(r => r.CODNAT)), [natRows]);
  const crSet   = useMemo(() => new Set(crRows.map(r => r.CODCENCUS)), [crRows]);
  const projSet = useMemo(() => new Set(projRows.map(r => r.CODPROJ)), [projRows]);
  const parcSet = useMemo(() => new Set(parcRows.map(r => r.CODPARC)), [parcRows]);
  const empSet  = useMemo(() => new Set(empRows.map(r => r.CODEMP)), [empRows]);

  function normalizeHeaders(row: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    Object.entries(row).forEach(([k, v]) => { out[k.trim().toUpperCase()] = v; });
    return out;
  }

  function parseSheetRows(wb: XLSX.WorkBook): Record<string, string>[] {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
    return json.map(row => {
      const obj: Record<string, string> = {};
      Object.entries(row).forEach(([k, v]) => { obj[k.trim().toUpperCase()] = String(v ?? "").trim(); });
      return obj;
    });
  }

  function parseCSVText(text: string): Record<string, string>[] {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(";").map(h => h.trim().replace(/^"|"$/g, "").toUpperCase());
    return lines.slice(1).map(line => {
      const vals = line.split(";").map(v => v.trim().replace(/^"|"$/g, ""));
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
      return obj;
    });
  }

  function validateRow(raw: Record<string, string>): ImportRow {
    const erros: string[] = [];

    // Período — tenta múltiplos nomes de coluna
    const periodoRaw = isRealizado
      ? resolveRaw(raw, "AD_DTDECOMPETENCIA", "PERIODO", "DATA", "COMPETENCIA")
      : resolveRaw(raw, "PERIODO", "AD_DTDECOMPETENCIA", "DATA", "COMPETENCIA", "MES", "MES_REF");
    const periodo    = parsePeriodo(periodoRaw);
    if (periodoRaw && !periodo) erros.push(`Período inválido: "${periodoRaw}"`);

    // Valor — tenta múltiplos nomes de coluna
    const valorRaw = isRealizado
      ? resolveRaw(raw, "VALOR_FINAL", "VLR_DESDOB", "VALOR", "VLR_FINAL", "VLRFINAL")
      : resolveRaw(raw, "VALOR", "VALOR_FINAL", "VALOR_ORCADO", "VLR_ORCADO", "VLRORCADO", "BUDGET", "VLR");
    const valorParsed = parseValor(valorRaw);
    // Vazio → 0 (lançamento de ajuste/zeramento); texto inválido → erro
    const valor = valorParsed !== null ? valorParsed : (valorRaw.trim() === "" ? 0 : null);
    if (valor === null) erros.push(`Valor inválido: "${valorRaw}"`);

    const codnat    = resolveRaw(raw, "CODNAT");
    const codcencus = resolveRaw(raw, "CODCENCUS");
    const codemp    = resolveRaw(raw, "CODEMP");
    const codproj   = resolveRaw(raw, "CODPROJ");
    const codparc   = resolveRaw(raw, "CODPARC");
    const nufin     = resolveRaw(raw, "NUFIN");
    const historico = resolveRaw(raw, "HISTORICO");

    if (!codnat)    erros.push("CODNAT obrigatório");
    else if (!natSet.has(codnat))   erros.push(`CODNAT "${codnat}" não encontrado`);
    if (!codcencus) erros.push("CODCENCUS obrigatório");
    else if (!crSet.has(codcencus)) erros.push(`CODCENCUS "${codcencus}" não encontrado`);
    if (tipo === "realizado" && !codemp) erros.push("CODEMP obrigatório");
    else if (codemp && !empSet.has(codemp)) erros.push(`CODEMP "${codemp}" não encontrado`);
    if (codproj && !projSet.has(codproj)) erros.push(`CODPROJ "${codproj}" não encontrado`);
    if (codparc && !parcSet.has(codparc)) erros.push(`CODPARC "${codparc}" não encontrado`);

    if (erros.length > 0) return { raw, erros };

    // Data: usa AD_DTDECOMPETENCIA; se vazio, cai para DTNEG
    const dataRaw = resolveRaw(raw, "AD_DTDECOMPETENCIA") || resolveRaw(raw, "DTNEG");
    const dataISO = parseDataCompleta(dataRaw) ?? parseDataCompleta(periodoRaw) ?? (periodo ? periodo + "-01" : dataHoje());
    return {
      raw, erros: [],
      lancamento: {
        tipo, data: dataISO, periodo: dataISO.slice(0, 7),
        codnat, codcencus, codemp,
        codproj: codproj || undefined, codparc: codparc || undefined,
        nufin: nufin || undefined, historico: historico || undefined, valor: valor!,
      },
    };
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    setLoading(true);
    setValidRows([]);
    setInvalidRows([]);
    setTotalRows(0);
    setProgress(null);

    const worker = new Worker("/xlsx-import-worker.js");

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (msg.type === "status") {
        // apenas lendo arquivo — mostra spinner sem barra
        setProgress(null);
      } else if (msg.type === "parsed") {
        setProgress({ atual: 0, total: msg.total });
      } else if (msg.type === "progress") {
        setProgress({ atual: msg.atual, total: msg.total });
      } else if (msg.type === "done") {
        setValidRows(msg.validRows);
        setInvalidRows(msg.invalidRows);
        setTotalRows(msg.total);
        setProgress(null);
        setDone(false);
        setLoading(false);
        worker.terminate();
      } else if (msg.type === "error") {
        setValidRows([]);
        setInvalidRows([]);
        setTotalRows(0);
        setProgress(null);
        setDone(false);
        setLoading(false);
        worker.terminate();
        alert(`Erro ao processar arquivo: ${msg.message}`);
      }
    };

    worker.onerror = () => {
      setLoading(false);
      setProgress(null);
      worker.terminate();
      alert("Erro ao iniciar processamento. Tente novamente.");
    };

    const reader = new FileReader();
    reader.onload = ev => {
      const result = ev.target?.result;
      worker.postMessage({
        buffer:   isExcel ? result : undefined,
        csvText:  isExcel ? undefined : result as string,
        isExcel,
        tipo,
        natArr:  [...natSet],
        crArr:   [...crSet],
        empArr:  [...empSet],
        projArr: [...projSet],
        parcArr: [...parcSet],
      }, isExcel ? [result as ArrayBuffer] : []);
    };
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file, "utf-8");
  }

  async function handleImport() {
    setLoading(true);
    try {
      await onImport(
        { label, mesReferencia: mesRef, tipo, ativo: marcarAtivo, criadoEm: new Date().toISOString() },
        validRows
      );
      // Se onImport não fechou o modal (ex: erro interno), marca como concluído
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  function baixarTemplate() {
    const wb = XLSX.utils.book_new();

    // Aba 1: Template (linha de exemplo zerada)
    const cols = isRealizado
      ? ["AD_DTDECOMPETENCIA","CODNAT","CODCENCUS","CODEMP","VALOR_FINAL","CODPROJ","CODPARC","NUFIN","HISTORICO"]
      : ["PERIODO","CODNAT","CODCENCUS","VALOR","CODEMP","CODPROJ","CODPARC","NUFIN"];
    const wsT = XLSX.utils.aoa_to_sheet([cols, cols.map((c, i) => {
      if (c.includes("PERIODO") || c.includes("DATA") || c.includes("COMPETENCIA")) return "01/2026";
      if (c === "VALOR_FINAL" || c === "VALOR") return "1000,00";
      if (c === "CODNAT")    return natRows.find(r => r.ANALITICA && r.ATIVA)?.CODNAT    ?? "";
      if (c === "CODCENCUS") return crRows.find(r  => r.ANALITICO && r.ATIVO)?.CODCENCUS ?? "";
      if (c === "CODEMP")    return empRows[0]?.CODEMP ?? "";
      return "";
    })]);
    XLSX.utils.book_append_sheet(wb, wsT, "Template");

    // Aba 2: Naturezas
    const nat = natRows.filter(r => r.ANALITICA && r.ATIVA);
    if (nat.length > 0) {
      const ws = XLSX.utils.json_to_sheet(nat.map(r => ({ CODNAT: r.CODNAT, Descrição: r.DESCRNAT })));
      XLSX.utils.book_append_sheet(wb, ws, "Naturezas");
    }

    // Aba 3: Centros_Resultado
    const cr = crRows.filter(r => r.ANALITICO && r.ATIVO);
    if (cr.length > 0) {
      const ws = XLSX.utils.json_to_sheet(cr.map(r => ({ CODCENCUS: r.CODCENCUS, Descrição: r.DESCRCENCUS })));
      XLSX.utils.book_append_sheet(wb, ws, "Centros_Resultado");
    }

    // Aba 4: Empresas
    if (empRows.length > 0) {
      const ws = XLSX.utils.json_to_sheet(empRows.map(r => ({ CODEMP: r.CODEMP, RazaoSocial: r.RAZAOSOCIAL })));
      XLSX.utils.book_append_sheet(wb, ws, "Empresas");
    }

    // Aba 5: Projetos
    const proj = projRows.filter(r => r.ANALITICO && r.ATIVO);
    if (proj.length > 0) {
      const ws = XLSX.utils.json_to_sheet(proj.map(r => ({ CODPROJ: r.CODPROJ, Identificação: r.IDENTIFICACAO })));
      XLSX.utils.book_append_sheet(wb, ws, "Projetos");
    }

    // Aba 6: Parceiros
    if (parcRows.length > 0) {
      const ws = XLSX.utils.json_to_sheet(parcRows.map(r => ({ CODPARC: r.CODPARC, Nome: r.NOMEPARC })));
      XLSX.utils.book_append_sheet(wb, ws, "Parceiros");
    }

    XLSX.writeFile(wb, `Template_Lancamentos_Financeiro_${tipo}.xlsx`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={loading ? undefined : onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col" style={{ maxHeight: "90vh" }}>
        {/* Overlay de carregando */}
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-white/90 px-10">
            <div className="w-10 h-10 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin mb-4" />
            {progress && progress.total > 0 ? (
              <>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Validando linhas… {progress.atual.toLocaleString("pt-BR")} / {progress.total.toLocaleString("pt-BR")}
                </p>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all duration-100"
                    style={{ width: `${Math.round((progress.atual / progress.total) * 100)}%`, background: "#1e3a5f" }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {Math.round((progress.atual / progress.total) * 100)}%
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-700">Lendo arquivo…</p>
                <p className="text-xs text-gray-400 mt-1">Arquivos grandes podem levar até 30 segundos.</p>
              </>
            )}
          </div>
        )}
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800">
              Importar Fechamento — {tipo === "realizado" ? "Realizado" : "Orçado"}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 1 ? "Etapa 1 de 2 · Identificação do fechamento" : "Etapa 2 de 2 · Arquivo de dados"}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {step === 1 && (
            <>
              {/* Mês de referência */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mês de referência do fechamento *</label>
                <p className="text-xs text-gray-400 mb-2">O mês em que este fechamento foi gerado (ex: se é o fechamento de Abril, selecione Abril/2025).</p>
                <input
                  type="month"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={mesRef}
                  onChange={e => handleMesRefChange(e.target.value)}
                />
              </div>

              {/* Label */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do fechamento *</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={label}
                  onChange={e => { labelEditado.current = true; setLabel(e.target.value); }}
                  placeholder="Ex: Fechamento Abril/2025"
                />
              </div>

              {/* Marcar como ativo */}
              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={marcarAtivo}
                  onChange={e => setMarcarAtivo(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded cursor-pointer"
                  style={{ accentColor: "#1e3a5f" }}
                />
                <div>
                  <p className="text-sm font-medium text-gray-700">Marcar como fechamento ativo</p>
                  <p className="text-xs text-gray-400 mt-0.5">O fechamento ativo será utilizado como fonte de dados nos relatórios. O fechamento atualmente ativo será desativado.</p>
                </div>
              </label>

              <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
                <strong>Lembre-se:</strong> a planilha de fechamento de Abril contém dados acumulados de Jan a Abr. Todos os lançamentos do arquivo serão vinculados a este fechamento.
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {/* Resumo do fechamento */}
              <div className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <FileText size={14} className="text-gray-500 flex-shrink-0" />
                <div className="text-xs text-gray-600">
                  <span className="font-semibold">{label}</span>
                  <span className="text-gray-400 ml-2">· {periodoLabel(mesRef)} · {marcarAtivo ? "será marcado como ativo" : "não será ativo"}</span>
                </div>
              </div>

              {/* Colunas esperadas */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-gray-600 mb-2">Colunas esperadas no arquivo:</p>
                <div className="flex flex-wrap gap-1.5">
                  {(isRealizado
                    ? [colPeriodo, "CODNAT", "CODCENCUS", "CODEMP", colValor, "CODPROJ", "CODPARC", "NUFIN"]
                    : [colPeriodo, "CODNAT", "CODCENCUS", colValor, "CODEMP", "CODPROJ", "CODPARC", "NUFIN"]
                  ).map((c, i) => {
                    const obrig = isRealizado ? i < 5 : i < 4;
                    return (
                      <span key={c} className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium ${obrig ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-500"}`}>
                        {c}{obrig ? " *" : ""}
                      </span>
                    );
                  })}
                </div>
                {!isRealizado && (
                  <p className="text-[11px] text-gray-400 mt-2">
                    Também aceito: período como <span className="font-mono">AD_DTDECOMPETENCIA / DATA / COMPETENCIA</span> · valor como <span className="font-mono">VALOR_FINAL / VALOR_ORCADO / VLR</span>
                  </p>
                )}
                <p className="text-[11px] text-gray-400 mt-1">* Obrigatórios. Período pode ser vazio (usará a data de hoje).</p>
              </div>

              {/* Upload */}
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

              {/* Preview */}
              {totalRows > 0 && !done && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700">{totalRows.toLocaleString("pt-BR")} linhas lidas</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">{validRows.length.toLocaleString("pt-BR")} válidas</span>
                    {invalidRows.length > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">{invalidRows.length.toLocaleString("pt-BR")} com erro</span>}
                  </div>
                  {invalidRows.length > 0 && (
                    <div className="border border-red-200 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-red-50 border-b border-red-200 flex items-center gap-2">
                        <AlertTriangle size={13} className="text-red-500" />
                        <span className="text-xs font-semibold text-red-700">Linhas com erro (não serão importadas)</span>
                      </div>
                      <div className="max-h-40 overflow-y-auto divide-y divide-red-100">
                        {invalidRows.map((r, i) => (
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
                </div>
              )}

              {done && (
                <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-3 font-medium">
                  ✓ {validRows.length.toLocaleString("pt-BR")} lançamentos importados com sucesso no fechamento <strong>{label}</strong>.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between gap-3 px-5 py-4 border-t border-gray-200 flex-shrink-0">
          <div>
            {step === 2 && !done && (
              <button onClick={() => setStep(1)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors">
                ← Voltar
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">
              {done ? "Fechar" : "Cancelar"}
            </button>
            {step === 1 && (
              <button
                onClick={() => setStep(2)}
                disabled={!label.trim() || !mesRef}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-40 transition-colors"
                style={{ background: "#1e3a5f" }}>
                Próximo →
              </button>
            )}
            {step === 2 && !done && validRows.length > 0 && (
              <button onClick={handleImport} disabled={loading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-60"
                style={{ background: "#16a34a" }}>
                {loading && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                {loading ? "Importando…" : `Importar ${validRows.length.toLocaleString("pt-BR")} lançamento${validRows.length !== 1 ? "s" : ""}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Fechamentos ─────────────────────────────────────────────────────────

function FechamentosTab({ tipo, fechamentos, lancamentos, onAtivar, onExcluir, onImportar }: {
  tipo: Tipo;
  fechamentos: Fechamento[];
  lancamentos: LancamentoFinanceiro[];
  onAtivar: (id: string) => void;
  onExcluir: (id: string) => void;
  onImportar: () => void;
}) {
  const lista = fechamentos
    .filter(f => f.tipo === tipo)
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));

  const contagemPorFech = useMemo(() => {
    const m = new Map<string, number>();
    lancamentos.forEach(l => {
      if (l.fechamentoId) m.set(l.fechamentoId, (m.get(l.fechamentoId) ?? 0) + 1);
    });
    return m;
  }, [lancamentos]);

  if (lista.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileText size={40} className="text-gray-300 mb-3" />
        <p className="text-gray-500 font-medium">Nenhum fechamento importado</p>
        <p className="text-gray-400 text-sm mt-1">Importe sua primeira planilha de fechamento para começar.</p>
        <button onClick={onImportar}
          className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
          style={{ background: "#1e3a5f" }}>
          <Upload size={14} /> Importar planilha
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {lista.map(f => {
        const qtd = contagemPorFech.get(f.id) ?? f.totalLinhas;
        const dataImport = new Date(f.criadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        return (
          <div key={f.id}
            className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${f.ativo ? "border-green-300 bg-green-50" : "border-gray-200 bg-white hover:border-gray-300"}`}>
            {/* Ícone de status */}
            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${f.ativo ? "bg-green-500" : "bg-gray-200"}`}>
              {f.ativo ? <CheckCircle2 size={18} className="text-white" /> : <Clock size={18} className="text-gray-400" />}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-800 text-sm">{f.label}</span>
                {f.ativo && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700">
                    <Star size={9} /> Ativo — usado nos relatórios
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                <span>Ref.: <strong className="text-gray-600">{periodoLabel(f.mesReferencia)}</strong></span>
                <span>·</span>
                <span>{qtd.toLocaleString("pt-BR")} lançamentos</span>
                <span>·</span>
                <span>Importado em {dataImport}</span>
              </div>
            </div>

            {/* Ações */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {!f.ativo && (
                <button onClick={() => onAtivar(f.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50 hover:text-green-700 transition-colors">
                  <Star size={11} /> Ativar
                </button>
              )}
              <button
                onClick={() => {
                  const aviso = f.ativo ? "\n\nAtenção: este é o fechamento ativo. Após excluir, nenhum fechamento estará ativo." : "";
                  if (!confirm(`Excluir "${f.label}"?\n\nEsta ação removerá ${qtd.toLocaleString("pt-BR")} lançamento${qtd !== 1 ? "s" : ""} permanentemente.${aviso}`)) return;
                  onExcluir(f.id);
                }}
                title="Excluir fechamento"
                className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Filter helpers ───────────────────────────────────────────────────────────

interface FiltrosLanc { nat: string[]; cr: string[]; emp: string[]; nufin: string[]; dataInicio: string; dataFim: string }
const filtrosVazios: FiltrosLanc = { nat: [], cr: [], emp: [], nufin: [], dataInicio: "", dataFim: "" };

function FilterSection({ title, count, onClear, items, renderLabel, isChecked, onToggle }: {
  title: string;
  count: number;
  onClear: () => void;
  items: string[];
  renderLabel: (item: string) => string;
  isChecked: (item: string) => boolean;
  onToggle: (item: string, checked: boolean) => void;
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
              <input
                value={q} onChange={e => setQ(e.target.value)}
                placeholder="Buscar..."
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

// ─── Página principal ─────────────────────────────────────────────────────────

export default function LancamentosFinanceiroPage() {
  const { ano: anoHoje, mes: mesHoje } = hoje();
  const [aba, setAba] = useState<Aba>("fechamentos");
  const [tipo, setTipo] = useState<Tipo>("realizado");
  const [ano, setAno] = useState(anoHoje);
  const [mes, setMes] = useState(mesHoje);
  const [verTodos, setVerTodos] = useState(true);
  const [search, setSearch] = useState("");
  const [fechamentoVisualId, setFechamentoVisualId] = useState<string>("__ativo__");
  const [filtros, setFiltros] = useState<FiltrosLanc>(filtrosVazios);
  const [rascunho, setRascunho] = useState<FiltrosLanc>(filtrosVazios);
  const [filterOpen, setFilterOpen] = useState(false);
  const [pagina, setPagina] = useState(0);
  const PAGE_SIZE = 200;

  const [fechamentos, setFechamentos] = usePersistedData<Fechamento[]>("portal_fechamentos", []);

  // Lançamentos armazenados no IndexedDB (sem limite de tamanho)
  const [data, setDataState] = useState<LancamentoFinanceiro[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  function setData(action: LancamentoFinanceiro[] | ((prev: LancamentoFinanceiro[]) => LancamentoFinanceiro[])) {
    setDataState(prev => {
      const next = typeof action === "function" ? action(prev) : action;
      idbSet("portal_lancamentos_financeiro", next);
      return next;
    });
  }

  const [modal, setModal] = useState<{ open: boolean; modo: "add" | "edit"; form: Partial<LancamentoFinanceiro> } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const [natRows]  = usePersistedData<NaturezaRow[]>("portal_natureza", []);
  const [crRows]   = usePersistedData<CentroResultadoRow[]>("portal_centro_resultado", []);
  const [projRows] = usePersistedData<ProjetoRow[]>("portal_projetos", []);
  const [parcRows] = usePersistedData<ParceiroRow[]>("portal_parceiro", []);
  const [empRows]  = usePersistedData<EmpresaRow[]>("portal_empresas", []);

  // ── Carrega lançamentos do IndexedDB no mount (+ migração legados) ──────────
  useEffect(() => {
    // Timeout de segurança: garante que a tela nunca fique presa no spinner
    const fallback = setTimeout(() => setDataLoaded(true), 4000);
    idbGet<LancamentoFinanceiro[]>("portal_lancamentos_financeiro", []).then(loaded => {
      clearTimeout(fallback);
      const orfaos = loaded.filter(l => !l.fechamentoId);
      if (orfaos.length > 0) {
        const legadoId = "fech_legado";
        setFechamentos(fs => {
          if (fs.some(f => f.id === legadoId)) return fs;
          return [{ id: legadoId, label: "Legado (importações anteriores)", mesReferencia: periodoStr(anoHoje, mesHoje),
            tipo: "realizado", ativo: false, criadoEm: new Date().toISOString(), totalLinhas: orfaos.length }, ...fs];
        });
        const migrated = loaded.map(l => l.fechamentoId ? l : { ...l, fechamentoId: legadoId });
        idbSet("portal_lancamentos_financeiro", migrated);
        setDataState(migrated);
      } else {
        setDataState(loaded);
      }
      setDataLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const periodo = periodoStr(ano, mes);

  const natMap  = useMemo(() => new Map(natRows.map(r => [r.CODNAT, r.DESCRNAT])), [natRows]);
  const crMap   = useMemo(() => new Map(crRows.map(r => [r.CODCENCUS, r.DESCRCENCUS])), [crRows]);
  const projMap = useMemo(() => new Map(projRows.map(r => [r.CODPROJ, r.IDENTIFICACAO])), [projRows]);
  const parcMap = useMemo(() => new Map(parcRows.map(r => [r.CODPARC, r.NOMEPARC])), [parcRows]);
  const empMap  = useMemo(() => new Map(empRows.map(r => [r.CODEMP, r.RAZAOSOCIAL])), [empRows]);

  // ── Fechamento ativo para o tipo atual ───────────────────────────────────
  const fechamentoAtivo = useMemo(
    () => fechamentos.find(f => f.tipo === tipo && f.ativo) ?? null,
    [fechamentos, tipo]
  );

  // ── Fechamento que o usuário quer visualizar na aba Lançamentos ──────────
  const fechamentoVisual = useMemo(() => {
    if (fechamentoVisualId === "__ativo__") return fechamentoAtivo;
    return fechamentos.find(f => f.id === fechamentoVisualId) ?? fechamentoAtivo;
  }, [fechamentoVisualId, fechamentos, fechamentoAtivo]);

  // ── Lançamentos filtrados (só computa quando na aba correta e dados carregados) ──
  const filtered = useMemo(() => {
    if (!dataLoaded || aba !== "lancamentos") return [];
    const q = search.toLowerCase();
    return data.filter(r => {
      if (r.tipo !== tipo) return false;
      if (!verTodos && r.periodo !== periodo) return false;
      if (fechamentoVisual && r.fechamentoId !== fechamentoVisual.id) return false;
      if (filtros.nat.length   > 0 && !filtros.nat.includes(r.codnat)) return false;
      if (filtros.cr.length    > 0 && !filtros.cr.includes(r.codcencus)) return false;
      if (filtros.emp.length   > 0 && !filtros.emp.includes(r.codemp)) return false;
      if (filtros.nufin.length > 0 && !filtros.nufin.includes(r.nufin ?? "")) return false;
      if (filtros.dataInicio && r.data < filtros.dataInicio) return false;
      if (filtros.dataFim    && r.data > filtros.dataFim)   return false;
      if (!q) return true;
      return (
        (r.nufin || "").toLowerCase().includes(q) ||
        (r.historico || "").toLowerCase().includes(q) ||
        r.codnat.toLowerCase().includes(q) ||
        r.codcencus.toLowerCase().includes(q) ||
        r.codemp.toLowerCase().includes(q) ||
        (r.codproj || "").toLowerCase().includes(q) ||
        (r.codparc || "").toLowerCase().includes(q) ||
        (natMap.get(r.codnat) || "").toLowerCase().includes(q) ||
        (crMap.get(r.codcencus) || "").toLowerCase().includes(q)
      );
    });
  }, [data, dataLoaded, aba, tipo, periodo, verTodos, search, fechamentoVisual, filtros, natMap, crMap]);

  // ── Opções dos filtros — só calcula quando na aba Lançamentos ────────────
  const dataFech = useMemo(
    () => (!dataLoaded || aba !== "lancamentos") ? [] :
      data.filter(r => r.tipo === tipo && (!fechamentoVisual || r.fechamentoId === fechamentoVisual.id)),
    [data, dataLoaded, aba, tipo, fechamentoVisual]
  );
  const uniqueNats   = useMemo(() => [...new Set(dataFech.map(r => r.codnat))].sort(), [dataFech]);
  const uniqueCrs    = useMemo(() => [...new Set(dataFech.map(r => r.codcencus))].sort(), [dataFech]);
  const uniqueEmps   = useMemo(() => [...new Set(dataFech.map(r => r.codemp))].sort(), [dataFech]);
  const uniqueNufins = useMemo(() => [...new Set(dataFech.map(r => r.nufin).filter(Boolean) as string[])].sort((a, b) => Number(a) - Number(b)), [dataFech]);

  const totalValor = filtered.reduce((s, r) => s + r.valor, 0);
  const totalPaginas = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginaAtual  = Math.min(pagina, totalPaginas - 1);
  const filteredPage = useMemo(
    () => filtered.slice(paginaAtual * PAGE_SIZE, (paginaAtual + 1) * PAGE_SIZE),
    [filtered, paginaAtual, PAGE_SIZE]
  );

  function navMes(delta: number) {
    let m = mes + delta, a = ano;
    if (m > 12) { m = 1;  a++; }
    if (m < 1)  { m = 12; a--; }
    setMes(m); setAno(a);
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSaveLancamento(f: Omit<LancamentoFinanceiro, "id" | "fechamentoId">) {
    if (modal?.modo === "add") {
      const fid = fechamentoVisual?.id;
      setData(d => [...d, { ...f, id: `lf_${Date.now()}`, fechamentoId: fid }]);
    } else {
      setData(d => d.map(r => r.id === (modal?.form as LancamentoFinanceiro).id ? { ...r, ...f } : r));
    }
    setModal(null);
  }

  async function handleImport(
    fechInfo: Omit<Fechamento, "id" | "totalLinhas">,
    rows: Omit<LancamentoFinanceiro, "id" | "fechamentoId">[]
  ) {
    const fechId = `fech_${Date.now()}`;

    const newFechamentos: Fechamento[] = [
      ...(fechInfo.ativo
        ? fechamentos.map(f => f.tipo === fechInfo.tipo ? { ...f, ativo: false } : f)
        : fechamentos),
      { ...fechInfo, id: fechId, totalLinhas: rows.length },
    ];

    const novos: LancamentoFinanceiro[] = rows.map((r, i) => ({
      ...r,
      id: `lf_${fechId}_${i}`,
      fechamentoId: fechId,
    }));
    const newData: LancamentoFinanceiro[] = [...data, ...novos];

    // Salva lançamentos no IndexedDB (sem limite de tamanho)
    const saved = await idbSet("portal_lancamentos_financeiro", newData);
    if (!saved) {
      alert("Erro ao salvar lançamentos. Verifique se o navegador permite armazenamento local.");
      return;
    }
    setDataState(newData);

    // Salva fechamento no localStorage
    saveData("portal_fechamentos", newFechamentos);

    const periodos = rows.map(r => r.periodo).filter(Boolean).sort();
    const ultimo = periodos[periodos.length - 1] ?? fechInfo.mesReferencia;
    if (ultimo) {
      const [y, m] = ultimo.split("-");
      setAno(parseInt(y));
      setMes(parseInt(m));
    }

    setImportOpen(false);
    setFechamentoVisualId(fechId);
    setVerTodos(true);
    setAba("lancamentos");
  }

  function handleAtivar(id: string) {
    setFechamentos(fs => fs.map(f => {
      if (f.id === id) return { ...f, ativo: true };
      if (f.tipo === tipo) return { ...f, ativo: false };
      return f;
    }));
  }

  function handleExcluir(id: string) {
    setFechamentos(fs => fs.filter(f => f.id !== id));
    setData(d => d.filter(l => l.fechamentoId !== id));
  }

  function handleDeleteLancamento(id: string) {
    if (confirm("Remover este lançamento?")) setData(d => d.filter(r => r.id !== id));
  }

  // ── Fechamentos do tipo atual para o seletor ──────────────────────────────
  const fechamentosTipo = useMemo(
    () => fechamentos.filter(f => f.tipo === tipo).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)),
    [fechamentos, tipo]
  );

  const subtitleFech = `${fechamentos.filter(f => f.tipo === tipo).length} fechamento${fechamentos.filter(f => f.tipo === tipo).length !== 1 ? "s" : ""}`;
  const subtitleLanc = `${filtered.length} lançamento${filtered.length !== 1 ? "s" : ""} · ${verTodos ? "todos os períodos" : periodoLabel(periodo)}`;

  return (
    <div>
      <PageHeader
        title="Lançamentos Financeiros"
        subtitle={aba === "fechamentos" ? subtitleFech : subtitleLanc}>
        {aba === "fechamentos" && (
          <button onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
            style={{ background: "#1e3a5f" }}>
            <Upload size={14} /> Importar planilha
          </button>
        )}
        {aba === "lancamentos" && fechamentoVisual && (
          <button onClick={() => setModal({ open: true, modo: "add", form: { ...emptyForm(), periodo } })}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg"
            style={{ background: "#1e3a5f" }}>
            <Plus size={14} /> Novo Lançamento
          </button>
        )}
      </PageHeader>

      <div className="p-6 space-y-4">
        {/* Tipo + Abas + controles de visualização */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(["realizado", "orcado"] as Tipo[]).map(t => (
              <button key={t} onClick={() => { setTipo(t); setFiltros(filtrosVazios); setRascunho(filtrosVazios); setSearch(""); setPagina(0); }}
                className="px-4 py-2 text-sm font-medium transition-colors"
                style={tipo === t ? { background: "#1e3a5f", color: "white" } : { background: "white", color: "#374151" }}>
                {t === "realizado" ? "Realizado" : "Orçado"}
              </button>
            ))}
          </div>

          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {([["fechamentos", "Fechamentos"], ["lancamentos", "Lançamentos"]] as [Aba, string][]).map(([a, lbl]) => (
              <button key={a} onClick={() => setAba(a)}
                className="px-4 py-2 text-sm font-medium transition-colors"
                style={aba === a ? { background: "#0078D4", color: "white" } : { background: "white", color: "#374151" }}>
                {lbl}
              </button>
            ))}
          </div>

          {/* Controles de visualização — só na aba Lançamentos */}
          {aba === "lancamentos" && fechamentosTipo.length > 0 && (
            <>
              <select
                className="border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={fechamentoVisualId}
                onChange={e => { setFechamentoVisualId(e.target.value); setFiltros(filtrosVazios); setRascunho(filtrosVazios); setSearch(""); setPagina(0); }}>
                {fechamentoAtivo && <option value="__ativo__">★ {fechamentoAtivo.label} (ativo)</option>}
                {fechamentosTipo.map(f => (
                  <option key={f.id} value={f.id}>{f.ativo ? `★ ${f.label}` : f.label}</option>
                ))}
              </select>

              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                <button onClick={() => setVerTodos(true)}
                  className="px-3 py-2 text-sm font-medium transition-colors"
                  style={verTodos ? { background: "#0078D4", color: "white" } : { background: "white", color: "#374151" }}>
                  Todos
                </button>
                <button onClick={() => setVerTodos(false)}
                  className="px-3 py-2 text-sm font-medium transition-colors"
                  style={!verTodos ? { background: "#0078D4", color: "white" } : { background: "white", color: "#374151" }}>
                  Por mês
                </button>
              </div>

              {!verTodos && (
                <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-2 py-2 bg-white">
                  <button onClick={() => navMes(-1)} className="p-0.5 hover:text-blue-600 transition-colors"><ChevronLeft size={14} /></button>
                  <span className="text-sm font-semibold text-gray-700 w-20 text-center">{periodoLabel(periodo)}</span>
                  <button onClick={() => navMes(1)} className="p-0.5 hover:text-blue-600 transition-colors"><ChevronRight size={14} /></button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Aba Fechamentos ───────────────────────────────────────────── */}
        {aba === "fechamentos" && (
          <FechamentosTab
            tipo={tipo}
            fechamentos={fechamentos}
            lancamentos={data}
            onAtivar={handleAtivar}
            onExcluir={handleExcluir}
            onImportar={() => setImportOpen(true)}
          />
        )}

        {/* ── Aba Lançamentos ───────────────────────────────────────────── */}
        {aba === "lancamentos" && (
          <>
            {!dataLoaded ? (
              <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
                <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                <span className="text-sm">Carregando lançamentos…</span>
              </div>
            ) : fechamentosTipo.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <FileText size={40} className="text-gray-300 mb-3" />
                <p className="text-gray-500 font-medium">Nenhum fechamento importado para {tipo === "realizado" ? "Realizado" : "Orçado"}</p>
                <button onClick={() => setAba("fechamentos")}
                  className="mt-4 px-4 py-2 text-sm font-medium text-blue-600 hover:underline">
                  Ir para Fechamentos →
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {/* ── Barra de filtros ─────────────────────────────────── */}
                {(() => {
                  const filtrosAtivos = filtros.nat.length > 0 || filtros.cr.length > 0 || filtros.emp.length > 0 || filtros.nufin.length > 0 || !!filtros.dataInicio || !!filtros.dataFim;
                  return (
                    <>
                      <div className="flex items-center gap-2 p-4 border-b border-gray-100">
                        <div className="relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-52 bg-white"
                            placeholder="Buscar..." value={search} onChange={e => { setSearch(e.target.value); setPagina(0); }} />
                        </div>

                        <button
                          onClick={() => { setRascunho(filtros); setFilterOpen(true); }}
                          className="relative flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors"
                          style={filtrosAtivos
                            ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" }
                            : { background: "white", color: "#374151", borderColor: "#e5e7eb" }}>
                          <Filter size={14} />
                          Filtros
                          {filtrosAtivos && <span className="w-1.5 h-1.5 rounded-full bg-white absolute top-1 right-1" />}
                        </button>

                        <span className="text-xs text-gray-400 ml-auto">
                          {filtered.length.toLocaleString("pt-BR")} de {dataFech.length.toLocaleString("pt-BR")} registros
                        </span>
                      </div>

                      {/* ── FilterDrawer ──────────────────────────────────── */}
                      {filterOpen && (
                        <>
                          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setFilterOpen(false)} />
                          <div className="fixed top-0 right-0 h-full w-[300px] z-50 bg-white shadow-xl flex flex-col">
                            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
                              <span className="text-sm font-semibold text-gray-800">Filtros</span>
                              <button onClick={() => setFilterOpen(false)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
                                <X size={16} />
                              </button>
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

                              <FilterSection title="Natureza" count={rascunho.nat.length}
                                onClear={() => setRascunho(r => ({ ...r, nat: [] }))}
                                items={uniqueNats}
                                renderLabel={c => `${c}${natMap.get(c) ? ` — ${natMap.get(c)}` : ""}`}
                                isChecked={c => rascunho.nat.includes(c)}
                                onToggle={(c, v) => setRascunho(r => ({ ...r, nat: v ? [...r.nat, c] : r.nat.filter(x => x !== c) }))} />

                              <FilterSection title="Centro de Resultado" count={rascunho.cr.length}
                                onClear={() => setRascunho(r => ({ ...r, cr: [] }))}
                                items={uniqueCrs}
                                renderLabel={c => `${c}${crMap.get(c) ? ` — ${crMap.get(c)}` : ""}`}
                                isChecked={c => rascunho.cr.includes(c)}
                                onToggle={(c, v) => setRascunho(r => ({ ...r, cr: v ? [...r.cr, c] : r.cr.filter(x => x !== c) }))} />

                              <FilterSection title="Empresa" count={rascunho.emp.length}
                                onClear={() => setRascunho(r => ({ ...r, emp: [] }))}
                                items={uniqueEmps}
                                renderLabel={c => `${c}${empMap.get(c) ? ` — ${empMap.get(c)}` : ""}`}
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
                              <button onClick={() => setRascunho(filtrosVazios)}
                                className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                                Limpar tudo
                              </button>
                              <button onClick={() => { setFiltros(rascunho); setPagina(0); setFilterOpen(false); }}
                                className="flex-1 px-3 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                                style={{ background: "#1e3a5f" }}>
                                Aplicar
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}

                <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-28">Data</th>
                        <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left">Natureza</th>
                        <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left">Centro de Resultado</th>
                        <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left">Empresa</th>
                        <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left">Projeto</th>
                        <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left">Parceiro</th>
                        <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-left w-24">NUFIN</th>
                        <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-right">Valor</th>
                        <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2.5 text-center w-20">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPage.map(row => (
                        <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-2 text-xs text-gray-600 tabular-nums whitespace-nowrap">
                            {row.data ? new Date(row.data + "T00:00:00").toLocaleDateString("pt-BR") : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2">
                            <span className="font-mono text-xs font-semibold text-blue-700">{row.codnat}</span>
                            {natMap.get(row.codnat) && <span className="text-xs text-gray-500 ml-1.5">{natMap.get(row.codnat)}</span>}
                          </td>
                          <td className="px-4 py-2">
                            <span className="font-mono text-xs font-semibold text-gray-700">{row.codcencus}</span>
                            {crMap.get(row.codcencus) && <span className="text-xs text-gray-500 ml-1.5">{crMap.get(row.codcencus)}</span>}
                          </td>
                          <td className="px-4 py-2">
                            <span className="font-mono text-xs font-semibold text-gray-700">{row.codemp}</span>
                            {empMap.get(row.codemp) && <span className="text-xs text-gray-500 ml-1.5">{empMap.get(row.codemp)}</span>}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-500">
                            {row.codproj ? <><span className="font-mono font-semibold text-gray-700">{row.codproj}</span><span className="ml-1">{projMap.get(row.codproj) || ""}</span></> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-500">
                            {row.codparc ? <><span className="font-mono font-semibold text-gray-700">{row.codparc}</span><span className="ml-1">{parcMap.get(row.codparc) || ""}</span></> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2 text-xs font-mono text-gray-600">
                            {row.nufin ?? <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span className={`text-sm font-semibold tabular-nums ${row.valor < 0 ? "text-red-600" : "text-gray-800"}`}>
                              {row.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => setModal({ open: true, modo: "edit", form: { ...row } })}
                                className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors"><Pencil size={13} /></button>
                              <button onClick={() => handleDeleteLancamento(row.id)}
                                className="p-1.5 hover:bg-red-100 rounded-lg text-red-500 transition-colors"><Trash2 size={13} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">
                          Nenhum lançamento em {periodoLabel(periodo)} para {fechamentoVisual?.label ?? "—"}.
                        </td></tr>
                      )}
                    </tbody>
                    {filtered.length > 0 && (
                      <tfoot>
                        <tr style={{ background: "#f8fafc" }}>
                          <td colSpan={7} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Total</td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={`text-sm font-bold tabular-nums ${totalValor < 0 ? "text-red-600" : "text-gray-800"}`}>
                              {totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {/* Paginação */}
                {totalPaginas > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
                    <span className="text-xs text-gray-500">
                      Página {paginaAtual + 1} de {totalPaginas} · {filtered.length.toLocaleString("pt-BR")} lançamentos
                    </span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setPagina(0)} disabled={paginaAtual === 0}
                        className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-30 hover:bg-white transition-colors">«</button>
                      <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={paginaAtual === 0}
                        className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-30 hover:bg-white transition-colors">‹</button>
                      {Array.from({ length: Math.min(5, totalPaginas) }, (_, i) => {
                        const start = Math.max(0, Math.min(paginaAtual - 2, totalPaginas - 5));
                        const p = start + i;
                        return (
                          <button key={p} onClick={() => setPagina(p)}
                            className="px-2.5 py-1 text-xs rounded border transition-colors"
                            style={p === paginaAtual ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", borderColor: "#e5e7eb", color: "#374151" }}>
                            {p + 1}
                          </button>
                        );
                      })}
                      <button onClick={() => setPagina(p => Math.min(totalPaginas - 1, p + 1))} disabled={paginaAtual >= totalPaginas - 1}
                        className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-30 hover:bg-white transition-colors">›</button>
                      <button onClick={() => setPagina(totalPaginas - 1)} disabled={paginaAtual >= totalPaginas - 1}
                        className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-30 hover:bg-white transition-colors">»</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {modal?.open && fechamentoVisual && (
        <LancamentoModal modo={modal.modo} tipo={tipo} periodo={periodo} form={modal.form}
          natRows={natRows} crRows={crRows} projRows={projRows} parcRows={parcRows} empRows={empRows}
          onSave={handleSaveLancamento} onClose={() => setModal(null)} />
      )}

      {importOpen && (
        <ImportModal tipo={tipo}
          natRows={natRows} crRows={crRows} projRows={projRows} parcRows={parcRows} empRows={empRows}
          onImport={handleImport} onClose={() => setImportOpen(false)} />
      )}
    </div>
  );
}
