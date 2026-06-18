"use client";

import { useState, useMemo, useEffect } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Search, X, Filter } from "lucide-react";
import { FilterSection, FilterCheckbox, FilterDrawerShell } from "@/components/FilterAccordion";
import PageHeader from "@/components/PageHeader";
import { naturezaDataInicial, type NaturezaRow, type TipoRegistro } from "@/lib/mockData";
import { buildHierarchy } from "@/lib/utils";
import { loadConfig, loadSession, sankhyaQuery, QUERIES } from "@/lib/sankhya";
import { usePersistedData, markStorageInitialized } from "@/lib/storage";
import { idbGet } from "@/lib/idb";

const CLASSIFICACAO_OPTS = ["RECEITA", "DEDUÇÕES", "IMPOSTOS", "DESPESA", "CUSTO", "VARIACAO"];
const PACOTES_OPTS = ["", "Pessoal", "Certificação", "Ocupação", "Tecnologia", "Institucional", "Eventos", "Viagens", "Jurídico", "Incentivos", "Serviços Especializados"];

const empty: Omit<NaturezaRow, "id"> = {
  CODNAT: "", DESCRNAT: "", GRAU: 1, ANALITICA: true, ATIVA: true,
  TIPO_REGISTRO: "GERENCIAL", ENTRA_RESULTADO: "DRE", CLASSIFICACAO: "", PACOTES: "",
};

interface Filtros { tipo: string[]; grau: string[]; classificacao: string[]; ativa: string[]; analitica: string[]; }
const filtrosVazios: Filtros = { tipo: [], grau: [], classificacao: [], ativa: [], analitica: [] };

function grauRowStyle(grau: number): React.CSSProperties {
  const styles: Record<number, React.CSSProperties> = {
    1: { background: "#002b5c", color: "white" },
    2: { background: "#0078D4", color: "white" },
    3: { background: "#dbeafe", color: "#1e3a5f" },
    4: { background: "#eff6ff", color: "#1e3a5f" },
  };
  return styles[grau] ?? { background: "white", color: "#374151" };
}

function grauCodeStyle(grau: number): React.CSSProperties {
  return grau <= 2 ? { color: "rgba(255,255,255,0.85)" } : { color: "#1d4ed8" };
}

const resultadoBadge = (v: string) =>
  v === "DRE" ? "bg-indigo-100 text-indigo-700" : v === "DFC" ? "bg-blue-100 text-blue-700" : v === "AMBOS" ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-500";

export default function NaturezaPage() {
  const [data, setData] = usePersistedData<NaturezaRow[]>("portal_natureza", naturezaDataInicial);
  const [search, setSearch] = useState("");
  const [filtros, setFiltros] = usePersistedData<Filtros>("portal_filtros_natureza", filtrosVazios);
  const [rascunho, setRascunho] = useState<Filtros>(filtrosVazios);
  const [filterOpen, setFilterOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<NaturezaRow, "id">>({ ...empty });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchFields, setBatchFields] = useState<Set<string>>(new Set());
  const [batchValues, setBatchValues] = useState({
    ENTRA_RESULTADO: "DRE" as NaturezaRow["ENTRA_RESULTADO"],
    CLASSIFICACAO: "" as NaturezaRow["CLASSIFICACAO"],
    PACOTES: "" as NaturezaRow["PACOTES"],
    ANALITICA: true,
    ATIVA: true,
  });

  const nfiltros = {
    tipo: Array.isArray(filtros.tipo) ? filtros.tipo : [],
    grau: Array.isArray(filtros.grau) ? filtros.grau : [],
    classificacao: Array.isArray(filtros.classificacao) ? filtros.classificacao : [],
    ativa: Array.isArray(filtros.ativa) ? filtros.ativa : [],
    analitica: Array.isArray(filtros.analitica) ? filtros.analitica : [],
  };
  const filtrosAtivos = !!(nfiltros.tipo.length || nfiltros.grau.length || nfiltros.classificacao.length || nfiltros.ativa.length || nfiltros.analitica.length);

  // One-time migration: deduplicate rows that may have colliding ids from index-based sync
  useEffect(() => {
    setData(prev => {
      const seen = new Set<string>();
      const deduped = prev.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
      return deduped.length < prev.length ? deduped : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withHierarchy = useMemo(() => buildHierarchy(
    [...data].sort((a, b) => a.CODNAT.localeCompare(b.CODNAT, undefined, { numeric: true, sensitivity: "base" })),
    "DESCRNAT"
  ), [data]);
  const maxGrau = useMemo(() => Math.max(...data.map((r) => r.GRAU), 0), [data]);

  const filtered = useMemo(() => {
    return withHierarchy.filter((r) => {
      if (search) { const q = search.toLowerCase(); if (!r.CODNAT.toLowerCase().includes(q) && !r.DESCRNAT.toLowerCase().includes(q)) return false; }
      if (nfiltros.tipo.length && !nfiltros.tipo.includes(r.TIPO_REGISTRO)) return false;
      if (nfiltros.grau.length && !nfiltros.grau.includes(String(r.GRAU))) return false;
      if (nfiltros.classificacao.length && !nfiltros.classificacao.includes(r.CLASSIFICACAO)) return false;
      if (nfiltros.ativa.length && !nfiltros.ativa.includes(r.ATIVA ? "S" : "N")) return false;
      if (nfiltros.analitica.length && !nfiltros.analitica.includes(r.ANALITICA ? "S" : "N")) return false;
      return true;
    });
  }, [withHierarchy, search, filtros]);

  const allSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));

  function handleSelect(id: string, shiftKey: boolean) {
    if (shiftKey && lastSelected) {
      const ids = filtered.map(r => r.id);
      const a = ids.indexOf(lastSelected), b = ids.indexOf(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(prev => new Set([...prev, ...ids.slice(lo, hi + 1)]));
    } else {
      setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
      setLastSelected(id);
    }
  }

  function toggleAll() { setSelected(allSelected ? new Set() : new Set(filtered.map(r => r.id))); }

  function toggleBatchField(f: string, on: boolean) {
    setBatchFields(s => { const n = new Set(s); on ? n.add(f) : n.delete(f); return n; });
  }

  function applyBatch() {
    setData(d => d.map(r => {
      if (!selected.has(r.id)) return r;
      const patch: Partial<NaturezaRow> = {};
      if (batchFields.has("ENTRA_RESULTADO")) patch.ENTRA_RESULTADO = batchValues.ENTRA_RESULTADO;
      if (batchFields.has("CLASSIFICACAO")) patch.CLASSIFICACAO = batchValues.CLASSIFICACAO;
      if (batchFields.has("PACOTES")) patch.PACOTES = batchValues.PACOTES;
      if (r.TIPO_REGISTRO === "GERENCIAL") {
        if (batchFields.has("ANALITICA")) patch.ANALITICA = batchValues.ANALITICA;
        if (batchFields.has("ATIVA")) patch.ATIVA = batchValues.ATIVA;
      }
      return { ...r, ...patch };
    }));
    setBatchFields(new Set());
    setSelected(new Set());
    setBatchOpen(false);
  }

  function openAdd() { setForm({ ...empty }); setEditId(null); setModalOpen(true); }
  function openEdit(row: NaturezaRow) {
    setForm({ CODNAT: row.CODNAT, DESCRNAT: row.DESCRNAT, GRAU: row.GRAU, ANALITICA: row.ANALITICA, ATIVA: row.ATIVA, TIPO_REGISTRO: row.TIPO_REGISTRO, ENTRA_RESULTADO: row.ENTRA_RESULTADO, CLASSIFICACAO: row.CLASSIFICACAO, PACOTES: row.PACOTES });
    setEditId(row.id);
    setModalOpen(true);
  }

  function handleSave() {
    if (!form.CODNAT || !form.DESCRNAT) return alert("Preencha Código e Descrição.");
    if (editId) {
      const isNativo = data.find((r) => r.id === editId)?.TIPO_REGISTRO === "NATIVO";
      if (isNativo) {
        setData((d) => d.map((r) => r.id === editId ? { ...r, ENTRA_RESULTADO: form.ENTRA_RESULTADO, CLASSIFICACAO: form.CLASSIFICACAO, PACOTES: form.PACOTES } : r));
      } else {
        setData((d) => d.map((r) => r.id === editId ? { ...r, ...form } : r));
      }
    } else {
      setData((d) => [...d, { ...form, id: `n${Date.now()}`, TIPO_REGISTRO: "GERENCIAL" } as NaturezaRow]);
    }
    setModalOpen(false);
  }

  async function handleSync() {
    setSyncing(true);
    const cfg = loadConfig();
    const sess = loadSession();
    if (!cfg || !sess) {
      alert("Nenhuma sessão ativa. Conecte ao Sankhya em Configurações.");
      setSyncing(false);
      return;
    }
    try {
      markStorageInitialized();
      // Merge IDB and React state so GERENCIAL rows survive regardless of
      // which source is ahead: IDB may lag behind in-memory creations; React
      // state may be empty if IDB hasn't loaded yet when sync is triggered.
      const idbData = await idbGet<NaturezaRow[]>("portal_natureza", []);
      const { rows } = await sankhyaQuery(cfg, sess.bearerToken, QUERIES.NATUREZA);
      const gerencialById = new Map<string, NaturezaRow>([
        ...(idbData ?? []).filter(r => r.TIPO_REGISTRO === "GERENCIAL").map(r => [r.id, r] as const),
        ...data.filter(r => r.TIPO_REGISTRO === "GERENCIAL").map(r => [r.id, r] as const),
      ]);
      const existingNativo = new Map<string, NaturezaRow>([
        ...(idbData ?? []).filter(r => r.TIPO_REGISTRO === "NATIVO").map(r => [r.CODNAT, r] as const),
        ...data.filter(r => r.TIPO_REGISTRO === "NATIVO").map(r => [r.CODNAT, r] as const),
      ]);
      const uniqueRows = Array.from(new Map(rows.map(r => [String(r.CODNAT ?? ""), r])).values());
      const sankhyaRows: NaturezaRow[] = uniqueRows.map((r) => {
        const codnat = String(r.CODNAT ?? "");
        const existing = existingNativo.get(codnat);
        return {
          id: existing?.id ?? `sync_nat_${codnat}`,
          CODNAT: codnat, DESCRNAT: String(r.DESCRNAT ?? ""),
          GRAU: Number(r.GRAU ?? 1), ANALITICA: r.ANALITICA === "S" || r.ANALITICA === true,
          ATIVA: r.ATIVA === "S" || r.ATIVA === true, TIPO_REGISTRO: "NATIVO" as TipoRegistro,
          ENTRA_RESULTADO: existing?.ENTRA_RESULTADO ?? "DRE",
          CLASSIFICACAO: existing?.CLASSIFICACAO ?? "", PACOTES: existing?.PACOTES ?? "",
        };
      });
      setData([...sankhyaRows, ...[...gerencialById.values()]]);
    } catch (err) {
      alert(`Erro: ${err instanceof Error ? err.message : err}\n\nConfigure a integração em Configurações.`);
    }
    setSyncing(false);
  }

  function openFilter() {
    setRascunho({
      tipo: Array.isArray(filtros.tipo) ? filtros.tipo : [],
      grau: Array.isArray(filtros.grau) ? filtros.grau : [],
      classificacao: Array.isArray(filtros.classificacao) ? filtros.classificacao : [],
      ativa: Array.isArray(filtros.ativa) ? filtros.ativa : [],
      analitica: Array.isArray(filtros.analitica) ? filtros.analitica : [],
    });
    setFilterOpen(true);
  }
  function applyFilter() { setFiltros({ ...rascunho }); setFilterOpen(false); }
  function clearFilter() { setRascunho(filtrosVazios); }

  const isNativoEdit = !!(editId && data.find((r) => r.id === editId)?.TIPO_REGISTRO === "NATIVO");

  const chipStyle = (active: boolean) =>
    active ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" }
           : { background: "white", color: "#6b7280", borderColor: "#d1d5db" };

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Natureza" subtitle={`Tabela TGFNAT · ${data.length} registros`}>
        <button onClick={handleSync} disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Sincronizando..." : "Sincronizar Sankhya"}
        </button>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors" style={{ background: "#1e3a5f" }}>
          <Plus size={15} /> Nova Natureza
        </button>
      </PageHeader>

      <div className="p-6 flex-1 overflow-hidden flex flex-col">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 p-4 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-56 bg-white"
                placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button onClick={openFilter}
              className="relative flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors"
              style={filtrosAtivos ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
              <Filter size={14} /> Filtros
              {filtrosAtivos && <span className="w-1.5 h-1.5 rounded-full bg-white absolute top-1 right-1" />}
            </button>
            <span className="text-xs text-gray-400 ml-auto">{filtered.length} de {data.length} registros</span>
          </div>

          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100" style={{ background: "#f8fafc" }}>
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-4 h-4 cursor-pointer rounded" style={{ accentColor: "#1e3a5f" }} />
                  </th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">TIPO</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">CODNAT</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">DESCRIÇÃO</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">GRAU</th>
                  {Array.from({ length: maxGrau }, (_, i) => (
                    <th key={i} className="text-left px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">GRAU {i + 1}</th>
                  ))}
                  <th className="text-center px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">ANALÍTICA</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">ATIVA</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">RESULTADO</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">CLASSIFICAÇÃO</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">PACOTES</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const rowStyle = grauRowStyle(row.GRAU);
                  const codeStyle = grauCodeStyle(row.GRAU);
                  const isNativo = row.TIPO_REGISTRO === "NATIVO";
                  const isSel = selected.has(row.id);
                  return (
                    <tr key={row.id} style={isSel ? { ...rowStyle, outline: "2px solid #0078D4", outlineOffset: "-1px" } : rowStyle}
                      className="border-b border-gray-100 transition-all hover:brightness-95 select-none">
                      <td className="px-3 py-1.5 w-8" onClick={(e) => { e.stopPropagation(); handleSelect(row.id, e.shiftKey); }}>
                        <div className="flex items-center justify-center">
                          <div className="bg-white/90 rounded p-0.5">
                            <input type="checkbox" checked={isSel} onChange={() => {}}
                              className="w-3.5 h-3.5 cursor-pointer rounded" style={{ accentColor: "#1e3a5f" }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-1.5">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${isNativo ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                          {row.TIPO_REGISTRO}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 font-mono font-medium" style={codeStyle}>{row.CODNAT}</td>
                      <td className="px-4 py-1.5 font-medium">{row.DESCRNAT}</td>
                      <td className="px-4 py-1.5 text-center">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold">{row.GRAU}</span>
                      </td>
                      {Array.from({ length: maxGrau }, (_, i) => (
                        <td key={i} className="px-4 py-1.5 text-xs opacity-80">{(row as Record<string, unknown>)[`GRAU_${i + 1}`] as string || ""}</td>
                      ))}
                      <td className="px-4 py-1.5 text-center">
                        {isNativo
                          ? <span className="font-mono text-xs opacity-75">{row.ANALITICA ? "S" : "N"}</span>
                          : <input type="checkbox" checked={row.ANALITICA} onChange={() => setData(d => d.map(r => r.id === row.id ? { ...r, ANALITICA: !r.ANALITICA } : r))} className="w-4 h-4 rounded cursor-pointer" style={{ accentColor: "#0078D4" }} />}
                      </td>
                      <td className="px-4 py-1.5 text-center">
                        {isNativo
                          ? <span className="font-mono text-xs opacity-75">{row.ATIVA ? "S" : "N"}</span>
                          : <input type="checkbox" checked={row.ATIVA} onChange={() => setData(d => d.map(r => r.id === row.id ? { ...r, ATIVA: !r.ATIVA } : r))} className="w-4 h-4 rounded cursor-pointer" style={{ accentColor: "#0078D4" }} />}
                      </td>
                      <td className="px-4 py-1.5 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${resultadoBadge(row.ENTRA_RESULTADO)}`}>
                          {row.ENTRA_RESULTADO}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-xs opacity-80">{row.CLASSIFICACAO || "—"}</td>
                      <td className="px-4 py-1.5 text-xs opacity-80">{row.PACOTES || "—"}</td>
                      <td className="px-4 py-1.5">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => selected.size > 1 ? setBatchOpen(true) : openEdit(row)} title={isNativo ? "Editar campos gerenciais" : "Editar"} className="p-1.5 hover:bg-blue-100 hover:text-blue-600 rounded-lg transition-colors"><Pencil size={14} /></button>
                          {!isNativo && <button onClick={() => setDeleteConfirm(row.id)} className="p-1.5 hover:bg-red-100 hover:text-red-500 rounded-lg transition-colors"><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={11 + maxGrau} className="px-4 py-8 text-center text-gray-400">Nenhum registro encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal — Adicionar/Editar */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModalOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">{editId ? "Editar Natureza" : "Nova Natureza"}</h3>
                {isNativoEdit && <p className="text-xs text-blue-600 mt-0.5">Registro Sankhya — apenas campos gerenciais são editáveis</p>}
              </div>
              <button onClick={() => setModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-lg transition-colors"><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CODNAT</label>
                  <input disabled={isNativoEdit} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                    value={form.CODNAT} onChange={(e) => setForm({ ...form, CODNAT: e.target.value.toUpperCase() })} placeholder="Ex: 3.2.1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Grau</label>
                  <select disabled={isNativoEdit} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                    value={form.GRAU} onChange={(e) => setForm({ ...form, GRAU: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 5].map((g) => <option key={g} value={g}>Grau {g}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição (DESCRNAT)</label>
                <input disabled={isNativoEdit} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                  value={form.DESCRNAT} onChange={(e) => setForm({ ...form, DESCRNAT: e.target.value.toUpperCase() })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Resultado</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={form.ENTRA_RESULTADO} onChange={(e) => setForm({ ...form, ENTRA_RESULTADO: e.target.value as NaturezaRow["ENTRA_RESULTADO"] })}>
                    <option value="DRE">DRE</option><option value="DFC">DFC</option><option value="AMBOS">AMBOS</option><option value="NÃO ENTRA">NÃO ENTRA</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Classificação</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={form.CLASSIFICACAO} onChange={(e) => setForm({ ...form, CLASSIFICACAO: e.target.value as NaturezaRow["CLASSIFICACAO"] })}>
                    <option value="">— Selecione —</option>
                    {CLASSIFICACAO_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pacotes</label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={form.PACOTES} onChange={(e) => setForm({ ...form, PACOTES: e.target.value as NaturezaRow["PACOTES"] })}>
                  {PACOTES_OPTS.map((o) => <option key={o} value={o}>{o || "— Selecione —"}</option>)}
                </select>
              </div>
              {!isNativoEdit && (
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.ANALITICA} onChange={(e) => setForm({ ...form, ANALITICA: e.target.checked })} className="w-4 h-4 rounded" style={{ accentColor: "#0078D4" }} />
                    <span className="text-sm text-gray-700">Analítica</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.ATIVA} onChange={(e) => setForm({ ...form, ATIVA: e.target.checked })} className="w-4 h-4 rounded" style={{ accentColor: "#0078D4" }} />
                    <span className="text-sm text-gray-700">Ativa</span>
                  </label>
                </div>
              )}
              {!isNativoEdit && !editId && (
                <div className="p-3 bg-green-50 rounded-lg text-xs text-green-700 border border-green-100">
                  Este registro será salvo como <strong>GERENCIAL</strong>.
                </div>
              )}
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">Cancelar</button>
              <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors" style={{ background: "#1e3a5f" }}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Batch edit modal */}
      {batchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setBatchOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Edição em Lote</h3>
                <p className="text-xs text-gray-500 mt-0.5">{selected.size} registro{selected.size !== 1 ? "s" : ""} selecionado{selected.size !== 1 ? "s" : ""} · Marque os campos a alterar</p>
              </div>
              <button onClick={() => setBatchOpen(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="p-5 space-y-4">
              {[
                { key: "ENTRA_RESULTADO", label: "Resultado", el: (
                  <select disabled={!batchFields.has("ENTRA_RESULTADO")} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    value={batchValues.ENTRA_RESULTADO} onChange={(e) => setBatchValues(v => ({ ...v, ENTRA_RESULTADO: e.target.value as NaturezaRow["ENTRA_RESULTADO"] }))}>
                    <option value="DRE">DRE</option><option value="DFC">DFC</option><option value="AMBOS">AMBOS</option><option value="NÃO ENTRA">NÃO ENTRA</option>
                  </select>
                )},
                { key: "CLASSIFICACAO", label: "Classificação", el: (
                  <select disabled={!batchFields.has("CLASSIFICACAO")} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    value={batchValues.CLASSIFICACAO} onChange={(e) => setBatchValues(v => ({ ...v, CLASSIFICACAO: e.target.value as NaturezaRow["CLASSIFICACAO"] }))}>
                    <option value="">— Selecione —</option>
                    {CLASSIFICACAO_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )},
                { key: "PACOTES", label: "Pacotes", el: (
                  <select disabled={!batchFields.has("PACOTES")} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    value={batchValues.PACOTES} onChange={(e) => setBatchValues(v => ({ ...v, PACOTES: e.target.value as NaturezaRow["PACOTES"] }))}>
                    {PACOTES_OPTS.map(o => <option key={o} value={o}>{o || "— Selecione —"}</option>)}
                  </select>
                )},
                { key: "ANALITICA", label: "Analítica (somente GERENCIAL)", el: (
                  <div className="flex gap-2">
                    {[{ v: true, l: "Sim" }, { v: false, l: "Não" }].map(({ v, l }) => (
                      <button key={l} disabled={!batchFields.has("ANALITICA")} onClick={() => setBatchValues(b => ({ ...b, ANALITICA: v }))}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-all disabled:opacity-40"
                        style={batchValues.ANALITICA === v && batchFields.has("ANALITICA") ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
                        {l}
                      </button>
                    ))}
                  </div>
                )},
                { key: "ATIVA", label: "Ativa (somente GERENCIAL)", el: (
                  <div className="flex gap-2">
                    {[{ v: true, l: "Sim" }, { v: false, l: "Não" }].map(({ v, l }) => (
                      <button key={l} disabled={!batchFields.has("ATIVA")} onClick={() => setBatchValues(b => ({ ...b, ATIVA: v }))}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-all disabled:opacity-40"
                        style={batchValues.ATIVA === v && batchFields.has("ATIVA") ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
                        {l}
                      </button>
                    ))}
                  </div>
                )},
              ].map(({ key, label, el }) => (
                <div key={key} className="flex items-start gap-3">
                  <input type="checkbox" checked={batchFields.has(key)} onChange={(e) => toggleBatchField(key, e.target.checked)}
                    className="mt-6 w-4 h-4 cursor-pointer rounded flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                    {el}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setBatchOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancelar</button>
              <button onClick={applyBatch} disabled={batchFields.size === 0}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors" style={{ background: "#1e3a5f" }}>
                Aplicar a {selected.size} registro{selected.size !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Confirmar Exclusão</h3>
            <p className="text-gray-600 text-sm mb-4">Deseja excluir este registro?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancelar</button>
              <button onClick={() => { setData(d => d.filter(r => r.id !== deleteConfirm)); setDeleteConfirm(null); }} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg">Excluir</button>
            </div>
          </div>
        </div>
      )}

      {filterOpen && (
        <FilterDrawerShell totalAtivos={rascunho.tipo.length + rascunho.grau.length + rascunho.classificacao.length + rascunho.ativa.length + rascunho.analitica.length}
          onClose={() => setFilterOpen(false)} onApply={applyFilter} onClear={clearFilter}>
          <FilterSection label="Tipo" count={rascunho.tipo.length} onClear={() => setRascunho(p => ({ ...p, tipo: [] }))}>
            {["NATIVO", "GERENCIAL"].map(opt => (
              <FilterCheckbox key={opt} label={opt} checked={rascunho.tipo.includes(opt)}
                onChange={() => setRascunho(p => ({ ...p, tipo: p.tipo.includes(opt) ? p.tipo.filter(v => v !== opt) : [...p.tipo, opt] }))} />
            ))}
          </FilterSection>
          <FilterSection label="Grau" count={rascunho.grau.length} onClear={() => setRascunho(p => ({ ...p, grau: [] }))}>
            {[1, 2, 3, 4, 5].map(g => (
              <FilterCheckbox key={g} label={`Grau ${g}`} checked={rascunho.grau.includes(String(g))}
                onChange={() => setRascunho(p => ({ ...p, grau: p.grau.includes(String(g)) ? p.grau.filter(v => v !== String(g)) : [...p.grau, String(g)] }))} />
            ))}
          </FilterSection>
          <FilterSection label="Classificação" count={rascunho.classificacao.length} onClear={() => setRascunho(p => ({ ...p, classificacao: [] }))}>
            {CLASSIFICACAO_OPTS.map(opt => (
              <FilterCheckbox key={opt} label={opt} checked={rascunho.classificacao.includes(opt)}
                onChange={() => setRascunho(p => ({ ...p, classificacao: p.classificacao.includes(opt) ? p.classificacao.filter(v => v !== opt) : [...p.classificacao, opt] }))} />
            ))}
          </FilterSection>
          <FilterSection label="Ativa" count={rascunho.ativa.length} onClear={() => setRascunho(p => ({ ...p, ativa: [] }))}>
            {[{ v: "S", l: "Sim" }, { v: "N", l: "Não" }].map(({ v, l }) => (
              <FilterCheckbox key={v} label={l} checked={rascunho.ativa.includes(v)}
                onChange={() => setRascunho(p => ({ ...p, ativa: p.ativa.includes(v) ? p.ativa.filter(x => x !== v) : [...p.ativa, v] }))} />
            ))}
          </FilterSection>
          <FilterSection label="Analítica" count={rascunho.analitica.length} onClear={() => setRascunho(p => ({ ...p, analitica: [] }))}>
            {[{ v: "S", l: "Sim" }, { v: "N", l: "Não" }].map(({ v, l }) => (
              <FilterCheckbox key={v} label={l} checked={rascunho.analitica.includes(v)}
                onChange={() => setRascunho(p => ({ ...p, analitica: p.analitica.includes(v) ? p.analitica.filter(x => x !== v) : [...p.analitica, v] }))} />
            ))}
          </FilterSection>
        </FilterDrawerShell>
      )}
    </div>
  );
}
