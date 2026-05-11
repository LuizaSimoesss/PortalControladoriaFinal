"use client";

import { useState, useMemo } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Search, X, Filter } from "lucide-react";
import { FilterSection, FilterCheckbox, FilterDrawerShell } from "@/components/FilterAccordion";
import PageHeader from "@/components/PageHeader";
import { centroResultadoDataInicial, type CentroResultadoRow, type TipoRegistro } from "@/lib/mockData";
import { buildHierarchy } from "@/lib/utils";
import { loadConfig, loadSession, sankhyaQuery, QUERIES } from "@/lib/sankhya";
import { usePersistedData, markStorageInitialized } from "@/lib/storage";

const CLASSIFICACAO_OPTS = ["DESPESA", "CUSTO"];

const empty: Omit<CentroResultadoRow, "id"> = {
  CODCENCUS: "", DESCRCENCUS: "", ATIVO: true, GRAU: 1, ANALITICO: true,
  TIPO_REGISTRO: "GERENCIAL", ENTRA_RESULTADO: "DRE", CLASSIFICACAO: "",
};

interface Filtros { tipo: string[]; grau: string[]; classificacao: string[]; ativo: string[]; analitico: string[]; }
const filtrosVazios: Filtros = { tipo: [], grau: [], classificacao: [], ativo: [], analitico: [] };

function grauRowStyle(grau: number): React.CSSProperties {
  const s: Record<number, React.CSSProperties> = {
    1: { background: "#002b5c", color: "white" },
    2: { background: "#0078D4", color: "white" },
    3: { background: "#dbeafe", color: "#1e3a5f" },
    4: { background: "#eff6ff", color: "#1e3a5f" },
  };
  return s[grau] ?? { background: "white", color: "#374151" };
}

const resultadoBadge = (v: string) =>
  v === "DRE" ? "bg-indigo-100 text-indigo-700" : v === "DFC" ? "bg-blue-100 text-blue-700" : v === "AMBOS" ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-500";

export default function CentroResultadoPage() {
  const [data, setData] = usePersistedData<CentroResultadoRow[]>("portal_centro_resultado", centroResultadoDataInicial);
  const [search, setSearch] = useState("");
  const [filtros, setFiltros] = usePersistedData<Filtros>("portal_filtros_centro_resultado", filtrosVazios);
  const [rascunho, setRascunho] = useState<Filtros>(filtrosVazios);
  const [filterOpen, setFilterOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<CentroResultadoRow, "id">>({ ...empty });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchFields, setBatchFields] = useState<Set<string>>(new Set());
  const [batchValues, setBatchValues] = useState({
    ENTRA_RESULTADO: "DRE" as CentroResultadoRow["ENTRA_RESULTADO"],
    CLASSIFICACAO: "" as CentroResultadoRow["CLASSIFICACAO"],
    ANALITICO: true,
    ATIVO: true,
  });

  const nfiltros = {
    tipo: Array.isArray(filtros.tipo) ? filtros.tipo : [],
    grau: Array.isArray(filtros.grau) ? filtros.grau : [],
    classificacao: Array.isArray(filtros.classificacao) ? filtros.classificacao : [],
    ativo: Array.isArray(filtros.ativo) ? filtros.ativo : [],
    analitico: Array.isArray(filtros.analitico) ? filtros.analitico : [],
  };
  const filtrosAtivos = !!(nfiltros.tipo.length || nfiltros.grau.length || nfiltros.classificacao.length || nfiltros.ativo.length || nfiltros.analitico.length);

  const withHierarchy = useMemo(() => buildHierarchy(
    [...data].sort((a, b) => a.CODCENCUS.localeCompare(b.CODCENCUS, undefined, { numeric: true, sensitivity: "base" })),
    "DESCRCENCUS"
  ), [data]);
  const maxGrau = useMemo(() => Math.max(...data.map((r) => r.GRAU), 0), [data]);

  const filtered = useMemo(() => {
    return withHierarchy.filter((r) => {
      if (search) { const q = search.toLowerCase(); if (!r.CODCENCUS.toLowerCase().includes(q) && !r.DESCRCENCUS.toLowerCase().includes(q)) return false; }
      if (nfiltros.tipo.length && !nfiltros.tipo.includes(r.TIPO_REGISTRO)) return false;
      if (nfiltros.grau.length && !nfiltros.grau.includes(String(r.GRAU))) return false;
      if (nfiltros.classificacao.length && !nfiltros.classificacao.includes(r.CLASSIFICACAO)) return false;
      if (nfiltros.ativo.length && !nfiltros.ativo.includes(r.ATIVO ? "S" : "N")) return false;
      if (nfiltros.analitico.length && !nfiltros.analitico.includes(r.ANALITICO ? "S" : "N")) return false;
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
      const patch: Partial<CentroResultadoRow> = {};
      if (batchFields.has("ENTRA_RESULTADO")) patch.ENTRA_RESULTADO = batchValues.ENTRA_RESULTADO;
      if (batchFields.has("CLASSIFICACAO")) patch.CLASSIFICACAO = batchValues.CLASSIFICACAO;
      if (r.TIPO_REGISTRO === "GERENCIAL") {
        if (batchFields.has("ANALITICO")) patch.ANALITICO = batchValues.ANALITICO;
        if (batchFields.has("ATIVO")) patch.ATIVO = batchValues.ATIVO;
      }
      return { ...r, ...patch };
    }));
    setBatchFields(new Set());
    setSelected(new Set());
    setBatchOpen(false);
  }

  function openAdd() { setForm({ ...empty }); setEditId(null); setModalOpen(true); }
  function openEdit(row: CentroResultadoRow) {
    setForm({ CODCENCUS: row.CODCENCUS, DESCRCENCUS: row.DESCRCENCUS, ATIVO: row.ATIVO, GRAU: row.GRAU, ANALITICO: row.ANALITICO, TIPO_REGISTRO: row.TIPO_REGISTRO, ENTRA_RESULTADO: row.ENTRA_RESULTADO, CLASSIFICACAO: row.CLASSIFICACAO });
    setEditId(row.id);
    setModalOpen(true);
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
      const { rows } = await sankhyaQuery(cfg, sess.bearerToken, QUERIES.CENTRO_RESULTADO);
      const synced: CentroResultadoRow[] = rows.map((r, i) => ({
        id: `sync_cr_${i}`, CODCENCUS: String(r.CODCENCUS ?? ""), DESCRCENCUS: String(r.DESCRCENCUS ?? ""),
        ATIVO: r.ATIVO === "S" || r.ATIVO === true, GRAU: Number(r.GRAU ?? 1),
        ANALITICO: r.ANALITICO === "S" || r.ANALITICO === true, TIPO_REGISTRO: "NATIVO" as TipoRegistro,
        ENTRA_RESULTADO: "DRE", CLASSIFICACAO: "",
      }));
      setData((prev) => [...synced, ...prev.filter((r) => r.TIPO_REGISTRO === "GERENCIAL")]);
    } catch (err) {
      alert(`Erro: ${err instanceof Error ? err.message : err}\n\nConfigure a integração em Configurações.`);
    }
    setSyncing(false);
  }

  function handleSave() {
    if (!form.CODCENCUS || !form.DESCRCENCUS) return alert("Preencha Código e Descrição.");
    if (editId) {
      const isNativo = data.find((r) => r.id === editId)?.TIPO_REGISTRO === "NATIVO";
      if (isNativo) {
        setData((d) => d.map((r) => r.id === editId ? { ...r, ENTRA_RESULTADO: form.ENTRA_RESULTADO, CLASSIFICACAO: form.CLASSIFICACAO } : r));
      } else {
        setData((d) => d.map((r) => r.id === editId ? { ...r, ...form } : r));
      }
    } else {
      setData((d) => [...d, { ...form, id: `cr${Date.now()}`, TIPO_REGISTRO: "GERENCIAL" } as CentroResultadoRow]);
    }
    setModalOpen(false);
  }

  function openFilter() {
    setRascunho({
      tipo: Array.isArray(filtros.tipo) ? filtros.tipo : [],
      grau: Array.isArray(filtros.grau) ? filtros.grau : [],
      classificacao: Array.isArray(filtros.classificacao) ? filtros.classificacao : [],
      ativo: Array.isArray(filtros.ativo) ? filtros.ativo : [],
      analitico: Array.isArray(filtros.analitico) ? filtros.analitico : [],
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
    <div>
      <PageHeader title="Centro de Resultado" subtitle={`Tabela TSICUS · ${data.length} registros`}>
        <button onClick={handleSync} disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Sincronizando..." : "Sincronizar Sankhya"}
        </button>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }}>
          <Plus size={15} /> Novo Registro
        </button>
      </PageHeader>

      <div className="p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
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

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100" style={{ background: "#f8fafc" }}>
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-4 h-4 cursor-pointer rounded" style={{ accentColor: "#1e3a5f" }} />
                  </th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">TIPO</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">CÓDIGO</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">DESCRIÇÃO</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">GRAU</th>
                  {Array.from({ length: maxGrau }, (_, i) => (
                    <th key={i} className="text-left px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">GRAU {i + 1}</th>
                  ))}
                  <th className="text-center px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">ANALÍTICO</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">ATIVO</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">RESULTADO</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">CLASSIFICAÇÃO</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-500 uppercase text-xs tracking-wide">AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const rowStyle = grauRowStyle(row.GRAU);
                  const isNativo = row.TIPO_REGISTRO === "NATIVO";
                  const isSel = selected.has(row.id);
                  return (
                    <tr key={row.id} style={isSel ? { ...rowStyle, outline: "2px solid #0078D4", outlineOffset: "-1px" } : rowStyle}
                      className="border-b border-gray-100 hover:brightness-95 transition-all select-none">
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
                      <td className="px-4 py-1.5 font-mono font-medium" style={row.GRAU <= 2 ? { color: "rgba(255,255,255,0.85)" } : { color: "#1d4ed8" }}>{row.CODCENCUS}</td>
                      <td className="px-4 py-1.5 font-medium">{row.DESCRCENCUS}</td>
                      <td className="px-4 py-1.5 text-center">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold">{row.GRAU}</span>
                      </td>
                      {Array.from({ length: maxGrau }, (_, i) => (
                        <td key={i} className="px-4 py-1.5 text-xs opacity-80">{(row as Record<string, unknown>)[`GRAU_${i + 1}`] as string || ""}</td>
                      ))}
                      <td className="px-4 py-1.5 text-center">
                        {isNativo ? <span className="font-mono text-xs opacity-75">{row.ANALITICO ? "S" : "N"}</span>
                          : <input type="checkbox" checked={row.ANALITICO} onChange={() => setData(d => d.map(r => r.id === row.id ? { ...r, ANALITICO: !r.ANALITICO } : r))} className="w-4 h-4 rounded cursor-pointer" style={{ accentColor: "#0078D4" }} />}
                      </td>
                      <td className="px-4 py-1.5 text-center">
                        {isNativo ? <span className="font-mono text-xs opacity-75">{row.ATIVO ? "S" : "N"}</span>
                          : <input type="checkbox" checked={row.ATIVO} onChange={() => setData(d => d.map(r => r.id === row.id ? { ...r, ATIVO: !r.ATIVO } : r))} className="w-4 h-4 rounded cursor-pointer" style={{ accentColor: "#0078D4" }} />}
                      </td>
                      <td className="px-4 py-1.5 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${resultadoBadge(row.ENTRA_RESULTADO)}`}>
                          {row.ENTRA_RESULTADO}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-xs opacity-80">{row.CLASSIFICACAO || "—"}</td>
                      <td className="px-4 py-1.5">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => selected.size > 1 ? setBatchOpen(true) : openEdit(row)} title={isNativo ? "Editar campos gerenciais" : "Editar"} className="p-1.5 hover:bg-blue-100 hover:text-blue-600 rounded-lg transition-colors"><Pencil size={14} /></button>
                          {!isNativo && <button onClick={() => setDeleteConfirm(row.id)} className="p-1.5 hover:bg-red-100 hover:text-red-500 rounded-lg transition-colors"><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan={10 + maxGrau} className="px-4 py-8 text-center text-gray-400">Nenhum registro encontrado.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModalOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">{editId ? "Editar Centro de Resultado" : "Novo Centro de Resultado"}</h3>
                {isNativoEdit && <p className="text-xs text-blue-600 mt-0.5">Registro Sankhya — apenas campos gerenciais são editáveis</p>}
              </div>
              <button onClick={() => setModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Código (CODCENCUS)</label>
                  <input disabled={isNativoEdit} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                    value={form.CODCENCUS} onChange={(e) => setForm({ ...form, CODCENCUS: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Grau</label>
                  <select disabled={isNativoEdit} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                    value={form.GRAU} onChange={(e) => setForm({ ...form, GRAU: Number(e.target.value) })}>
                    {[1, 2, 3, 4].map((g) => <option key={g} value={g}>Grau {g}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição (DESCRCENCUS)</label>
                <input disabled={isNativoEdit} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                  value={form.DESCRCENCUS} onChange={(e) => setForm({ ...form, DESCRCENCUS: e.target.value.toUpperCase() })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Resultado</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={form.ENTRA_RESULTADO} onChange={(e) => setForm({ ...form, ENTRA_RESULTADO: e.target.value as CentroResultadoRow["ENTRA_RESULTADO"] })}>
                    <option value="DRE">DRE</option><option value="DFC">DFC</option><option value="AMBOS">AMBOS</option><option value="NÃO ENTRA">NÃO ENTRA</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Classificação</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={form.CLASSIFICACAO} onChange={(e) => setForm({ ...form, CLASSIFICACAO: e.target.value as CentroResultadoRow["CLASSIFICACAO"] })}>
                    <option value="">— Selecione —</option>
                    {CLASSIFICACAO_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              {!isNativoEdit && (
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.ANALITICO} onChange={(e) => setForm({ ...form, ANALITICO: e.target.checked })} className="w-4 h-4 rounded" style={{ accentColor: "#0078D4" }} />
                    <span className="text-sm text-gray-700">Analítico</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.ATIVO} onChange={(e) => setForm({ ...form, ATIVO: e.target.checked })} className="w-4 h-4 rounded" style={{ accentColor: "#0078D4" }} />
                    <span className="text-sm text-gray-700">Ativo</span>
                  </label>
                </div>
              )}
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancelar</button>
              <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }}>Salvar</button>
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
                    value={batchValues.ENTRA_RESULTADO} onChange={(e) => setBatchValues(v => ({ ...v, ENTRA_RESULTADO: e.target.value as CentroResultadoRow["ENTRA_RESULTADO"] }))}>
                    <option value="DRE">DRE</option><option value="DFC">DFC</option><option value="AMBOS">AMBOS</option><option value="NÃO ENTRA">NÃO ENTRA</option>
                  </select>
                )},
                { key: "CLASSIFICACAO", label: "Classificação", el: (
                  <select disabled={!batchFields.has("CLASSIFICACAO")} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    value={batchValues.CLASSIFICACAO} onChange={(e) => setBatchValues(v => ({ ...v, CLASSIFICACAO: e.target.value as CentroResultadoRow["CLASSIFICACAO"] }))}>
                    <option value="">— Selecione —</option>
                    {CLASSIFICACAO_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )},
                { key: "ANALITICO", label: "Analítico (somente GERENCIAL)", el: (
                  <div className="flex gap-2">
                    {[{ v: true, l: "Sim" }, { v: false, l: "Não" }].map(({ v, l }) => (
                      <button key={l} disabled={!batchFields.has("ANALITICO")} onClick={() => setBatchValues(b => ({ ...b, ANALITICO: v }))}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-all disabled:opacity-40"
                        style={batchValues.ANALITICO === v && batchFields.has("ANALITICO") ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
                        {l}
                      </button>
                    ))}
                  </div>
                )},
                { key: "ATIVO", label: "Ativo (somente GERENCIAL)", el: (
                  <div className="flex gap-2">
                    {[{ v: true, l: "Sim" }, { v: false, l: "Não" }].map(({ v, l }) => (
                      <button key={l} disabled={!batchFields.has("ATIVO")} onClick={() => setBatchValues(b => ({ ...b, ATIVO: v }))}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-all disabled:opacity-40"
                        style={batchValues.ATIVO === v && batchFields.has("ATIVO") ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
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

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Confirmar Exclusão</h3>
            <p className="text-gray-600 text-sm mb-4">Excluir este registro?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancelar</button>
              <button onClick={() => { setData(d => d.filter(r => r.id !== deleteConfirm)); setDeleteConfirm(null); }} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg">Excluir</button>
            </div>
          </div>
        </div>
      )}

      {filterOpen && (
        <FilterDrawerShell totalAtivos={rascunho.tipo.length + rascunho.grau.length + rascunho.classificacao.length + rascunho.ativo.length + rascunho.analitico.length}
          onClose={() => setFilterOpen(false)} onApply={applyFilter} onClear={clearFilter}>
          <FilterSection label="Tipo" count={rascunho.tipo.length} onClear={() => setRascunho(p => ({ ...p, tipo: [] }))}>
            {["NATIVO", "GERENCIAL"].map(opt => (
              <FilterCheckbox key={opt} label={opt} checked={rascunho.tipo.includes(opt)}
                onChange={() => setRascunho(p => ({ ...p, tipo: p.tipo.includes(opt) ? p.tipo.filter(v => v !== opt) : [...p.tipo, opt] }))} />
            ))}
          </FilterSection>
          <FilterSection label="Grau" count={rascunho.grau.length} onClear={() => setRascunho(p => ({ ...p, grau: [] }))}>
            {[1, 2, 3, 4].map(g => (
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
          <FilterSection label="Ativo" count={rascunho.ativo.length} onClear={() => setRascunho(p => ({ ...p, ativo: [] }))}>
            {[{ v: "S", l: "Sim" }, { v: "N", l: "Não" }].map(({ v, l }) => (
              <FilterCheckbox key={v} label={l} checked={rascunho.ativo.includes(v)}
                onChange={() => setRascunho(p => ({ ...p, ativo: p.ativo.includes(v) ? p.ativo.filter(x => x !== v) : [...p.ativo, v] }))} />
            ))}
          </FilterSection>
          <FilterSection label="Analítico" count={rascunho.analitico.length} onClear={() => setRascunho(p => ({ ...p, analitico: [] }))}>
            {[{ v: "S", l: "Sim" }, { v: "N", l: "Não" }].map(({ v, l }) => (
              <FilterCheckbox key={v} label={l} checked={rascunho.analitico.includes(v)}
                onChange={() => setRascunho(p => ({ ...p, analitico: p.analitico.includes(v) ? p.analitico.filter(x => x !== v) : [...p.analitico, v] }))} />
            ))}
          </FilterSection>
        </FilterDrawerShell>
      )}
    </div>
  );
}
