"use client";

import { useState, useMemo } from "react";
import { Plus, RefreshCw, Pencil, Trash2, Search, X, Lock, Filter } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { projetosDataInicial, type ProjetoRow, type TipoRegistro } from "@/lib/mockData";
import { buildHierarchy } from "@/lib/utils";
import { loadConfig, loadSession, sankhyaQuery, QUERIES } from "@/lib/sankhya";
import { usePersistedData, markStorageInitialized } from "@/lib/storage";
import { FilterSection, FilterCheckbox, FilterDrawerShell } from "@/components/FilterAccordion";

const empty: Omit<ProjetoRow, "id"> = {
  CODPROJ: "", IDENTIFICACAO: "", ATIVO: true, GRAU: 1, ANALITICO: true, TIPO_REGISTRO: "GERENCIAL",
};

interface Filtros { tipo: string[]; grau: string[]; ativo: string[]; analitico: string[]; }
const filtrosVazios: Filtros = { tipo: [], grau: [], ativo: [], analitico: [] };

function grauRowStyle(grau: number): React.CSSProperties {
  if (grau === 1) return { background: "#002b5c", color: "#fff" };
  if (grau === 2) return { background: "#0078D4", color: "#fff" };
  if (grau === 3) return { background: "#dbeafe", color: "#1e3a5f" };
  if (grau === 4) return { background: "#eff6ff", color: "#1e3a5f" };
  return {};
}

function grauTextClass(grau: number): string {
  return grau <= 2 ? "text-white" : "text-gray-700";
}

export default function ProjetosPage() {
  const [data, setData] = usePersistedData<ProjetoRow[]>("portal_projetos", projetosDataInicial);
  const [search, setSearch] = useState("");
  const [filtros, setFiltros] = usePersistedData<Filtros>("portal_filtros_projetos", filtrosVazios);
  const [rascunho, setRascunho] = useState<Filtros>(filtrosVazios);
  const [filterOpen, setFilterOpen] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; mode: "add" | "edit"; row: Partial<ProjetoRow> }>({
    open: false, mode: "add", row: { ...empty },
  });
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchFields, setBatchFields] = useState<Set<string>>(new Set());
  const [batchValues, setBatchValues] = useState({ ANALITICO: true, ATIVO: true });

  const nfiltros = {
    tipo: Array.isArray(filtros.tipo) ? filtros.tipo : [],
    grau: Array.isArray(filtros.grau) ? filtros.grau : [],
    ativo: Array.isArray(filtros.ativo) ? filtros.ativo : [],
    analitico: Array.isArray(filtros.analitico) ? filtros.analitico : [],
  };
  const filtrosAtivos = nfiltros.tipo.length > 0 || nfiltros.grau.length > 0 || nfiltros.ativo.length > 0 || nfiltros.analitico.length > 0;

  const withHierarchy = useMemo(() => buildHierarchy(
    [...data].sort((a, b) => a.CODPROJ.localeCompare(b.CODPROJ, undefined, { numeric: true, sensitivity: "base" })),
    "IDENTIFICACAO"
  ), [data]);
  const maxGrau = useMemo(() => Math.max(...data.map((r) => r.GRAU), 0), [data]);

  const filtered = useMemo(() => {
    const nf = {
      tipo: Array.isArray(filtros.tipo) ? filtros.tipo : [],
      grau: Array.isArray(filtros.grau) ? filtros.grau : [],
      ativo: Array.isArray(filtros.ativo) ? filtros.ativo : [],
      analitico: Array.isArray(filtros.analitico) ? filtros.analitico : [],
    };
    return withHierarchy.filter((r) => {
      if (search) { const q = search.toLowerCase(); if (!r.CODPROJ.toLowerCase().includes(q) && !r.IDENTIFICACAO.toLowerCase().includes(q)) return false; }
      if (nf.tipo.length && !nf.tipo.includes(r.TIPO_REGISTRO)) return false;
      if (nf.grau.length && !nf.grau.includes(String(r.GRAU))) return false;
      if (nf.ativo.length && !nf.ativo.includes(r.ATIVO ? "S" : "N")) return false;
      if (nf.analitico.length && !nf.analitico.includes(r.ANALITICO ? "S" : "N")) return false;
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
      if (!selected.has(r.id) || r.TIPO_REGISTRO !== "GERENCIAL") return r;
      const patch: Partial<ProjetoRow> = {};
      if (batchFields.has("ANALITICO")) patch.ANALITICO = batchValues.ANALITICO;
      if (batchFields.has("ATIVO")) patch.ATIVO = batchValues.ATIVO;
      return { ...r, ...patch };
    }));
    setBatchFields(new Set());
    setSelected(new Set());
    setBatchOpen(false);
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
      const { rows } = await sankhyaQuery(cfg, sess.bearerToken, QUERIES.PROJETOS);
      const synced: ProjetoRow[] = rows.map((r, i) => ({
        id: `sync_prj_${i}`, CODPROJ: String(r.CODPROJ ?? ""), IDENTIFICACAO: String(r.IDENTIFICACAO ?? ""),
        ATIVO: r.ATIVO === "S" || r.ATIVO === true, GRAU: Number(r.GRAU ?? 1),
        ANALITICO: r.ANALITICO === "S" || r.ANALITICO === true, TIPO_REGISTRO: "NATIVO" as TipoRegistro,
      }));
      setData((prev) => [...synced, ...prev.filter((r) => r.TIPO_REGISTRO === "GERENCIAL")]);
    } catch (err) {
      alert(`Erro: ${err instanceof Error ? err.message : err}\n\nConfigure a integração em Configurações.`);
    }
    setSyncing(false);
  }

  function handleSave() {
    const row = modal.row as ProjetoRow;
    if (!row.CODPROJ || !row.IDENTIFICACAO) return alert("Preencha Código e Identificação.");
    if (modal.mode === "add") {
      setData((d) => [...d, { ...row, id: `p${Date.now()}`, TIPO_REGISTRO: "GERENCIAL" }]);
    } else {
      setData((d) => d.map((r) => (r.id === row.id ? { ...r, ...row } : r)));
    }
    setModal({ open: false, mode: "add", row: { ...empty } });
  }

  function handleDelete(id: string) {
    const row = data.find((r) => r.id === id);
    if (!row || row.TIPO_REGISTRO === "NATIVO") return;
    if (confirm("Excluir?")) setData((d) => d.filter((r) => r.id !== id));
  }

  function openFilter() {
    setRascunho({
      tipo: Array.isArray(filtros.tipo) ? filtros.tipo : [],
      grau: Array.isArray(filtros.grau) ? filtros.grau : [],
      ativo: Array.isArray(filtros.ativo) ? filtros.ativo : [],
      analitico: Array.isArray(filtros.analitico) ? filtros.analitico : [],
    });
    setFilterOpen(true);
  }
  function applyFilter() { setFiltros({ ...rascunho }); setFilterOpen(false); }
  function clearFilter() { setRascunho(filtrosVazios); }

  function toggleRascunho(field: keyof Filtros, val: string) {
    setRascunho(p => {
      const arr = Array.isArray(p[field]) ? (p[field] as string[]) : [];
      return { ...p, [field]: arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val] };
    });
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Projetos" subtitle={`Tabela TCSPRJ · ${data.length} registros`}>
        <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          onClick={handleSync} disabled={syncing}>
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Sincronizando..." : "Sincronizar Sankhya"}
        </button>
        <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }}
          onClick={() => setModal({ open: true, mode: "add", row: { ...empty } })}>
          <Plus size={15} /> Novo Projeto
        </button>
      </PageHeader>

      <div className="p-6 flex-1 overflow-hidden flex flex-col">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 p-4 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-56 bg-white"
                placeholder="Buscar projeto..." value={search} onChange={(e) => setSearch(e.target.value)} />
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
                <tr style={{ background: "#f8fafc" }}>
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-4 h-4 cursor-pointer rounded" style={{ accentColor: "#1e3a5f" }} />
                  </th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">TIPO</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">CÓDIGO</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">IDENTIFICAÇÃO</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-center">GRAU</th>
                  {Array.from({ length: maxGrau }, (_, i) => (
                    <th key={i} className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">GRAU {i + 1}</th>
                  ))}
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-center">ANALÍTICO</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-center">ATIVO</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-center">AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isSel = selected.has(row.id);
                  const isNativo = row.TIPO_REGISTRO === "NATIVO";
                  return (
                    <tr key={row.id} className="border-b border-gray-100 transition-colors select-none"
                      style={isSel ? { ...grauRowStyle(row.GRAU), outline: "2px solid #0078D4", outlineOffset: "-1px" } : grauRowStyle(row.GRAU)}>
                      <td className="px-3 py-1.5 w-8" onClick={(e) => { e.stopPropagation(); handleSelect(row.id, e.shiftKey); }}>
                        <div className="flex items-center justify-center">
                          <div className="bg-white/90 rounded p-0.5">
                            <input type="checkbox" checked={isSel} onChange={() => {}} className="w-3.5 h-3.5 cursor-pointer rounded" style={{ accentColor: "#1e3a5f" }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-1.5 text-sm">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${isNativo ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                          {row.TIPO_REGISTRO}
                        </span>
                      </td>
                      <td className={`px-4 py-1.5 text-sm font-mono ${grauTextClass(row.GRAU)}`}>{row.CODPROJ}</td>
                      <td className={`px-4 py-1.5 text-sm font-medium ${grauTextClass(row.GRAU)}`}>{row.IDENTIFICACAO}</td>
                      <td className="px-4 py-1.5 text-sm text-center">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${row.GRAU <= 2 ? "bg-white/20 text-white" : "bg-blue-100 text-blue-700"}`}>{row.GRAU}</span>
                      </td>
                      {Array.from({ length: maxGrau }, (_, i) => (
                        <td key={i} className={`px-4 py-1.5 text-sm ${grauTextClass(row.GRAU)}`}>{(row as Record<string, unknown>)[`GRAU_${i + 1}`] as string || ""}</td>
                      ))}
                      <td className="px-4 py-1.5 text-sm text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${row.ANALITICO ? (row.GRAU <= 2 ? "bg-white/20 text-white" : "bg-green-100 text-green-700") : (row.GRAU <= 2 ? "bg-white/10 text-white/70" : "bg-gray-100 text-gray-500")}`}>
                          {row.ANALITICO ? "Analítico" : "Sintético"}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-sm text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${row.ATIVO ? (row.GRAU <= 2 ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700") : (row.GRAU <= 2 ? "bg-white/10 text-white/70" : "bg-red-100 text-red-500")}`}>
                          {row.ATIVO ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-sm">
                        <div className="flex items-center justify-center gap-1">
                          {isNativo ? (
                            <span title="Registro nativo — somente leitura" className="p-1.5 text-gray-300"><Lock size={15} /></span>
                          ) : (
                            <>
                              <button onClick={() => selected.size > 1 ? setBatchOpen(true) : setModal({ open: true, mode: "edit", row: { ...row } })} className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors"><Pencil size={15} /></button>
                              <button onClick={() => handleDelete(row.id)} className="p-1.5 hover:bg-red-100 rounded-lg text-red-500 transition-colors"><Trash2 size={15} /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8 + maxGrau} className="px-4 py-8 text-center text-gray-400">Nenhum projeto encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal add/edit */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setModal({ ...modal, open: false })}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">{modal.mode === "add" ? "Novo Projeto" : "Editar Projeto"}</h2>
              <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" onClick={() => setModal({ ...modal, open: false })}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Código (CODPROJ)</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={modal.row.CODPROJ || ""} onChange={(e) => setModal({ ...modal, row: { ...modal.row, CODPROJ: e.target.value.toUpperCase() } })} placeholder="Ex: PRJ003" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Grau</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={modal.row.GRAU || 1} onChange={(e) => setModal({ ...modal, row: { ...modal.row, GRAU: Number(e.target.value) } })}>
                    {[1, 2, 3, 4].map((g) => <option key={g} value={g}>Grau {g}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Identificação</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={modal.row.IDENTIFICACAO || ""} onChange={(e) => setModal({ ...modal, row: { ...modal.row, IDENTIFICACAO: e.target.value.toUpperCase() } })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Analítico</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={modal.row.ANALITICO ? "sim" : "nao"} onChange={(e) => setModal({ ...modal, row: { ...modal.row, ANALITICO: e.target.value === "sim" } })}>
                    <option value="sim">Analítico</option><option value="nao">Sintético</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ativo</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={modal.row.ATIVO ? "sim" : "nao"} onChange={(e) => setModal({ ...modal, row: { ...modal.row, ATIVO: e.target.value === "sim" } })}>
                    <option value="sim">Ativo</option><option value="nao">Inativo</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 pb-5">
              <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={() => setModal({ ...modal, open: false })}>Cancelar</button>
              <button className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }} onClick={handleSave}>{modal.mode === "add" ? "Adicionar" : "Salvar"}</button>
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
                <p className="text-xs text-gray-500 mt-0.5">{selected.size} selecionado{selected.size !== 1 ? "s" : ""} · Aplica apenas a registros GERENCIAL</p>
              </div>
              <button onClick={() => setBatchOpen(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="p-5 space-y-4">
              {[
                { key: "ANALITICO", label: "Analítico", el: (
                  <div className="flex gap-2">
                    {[{ v: true, l: "Analítico" }, { v: false, l: "Sintético" }].map(({ v, l }) => (
                      <button key={l} disabled={!batchFields.has("ANALITICO")} onClick={() => setBatchValues(b => ({ ...b, ANALITICO: v }))}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-all disabled:opacity-40"
                        style={batchValues.ANALITICO === v && batchFields.has("ANALITICO") ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}>
                        {l}
                      </button>
                    ))}
                  </div>
                )},
                { key: "ATIVO", label: "Ativo", el: (
                  <div className="flex gap-2">
                    {[{ v: true, l: "Ativo" }, { v: false, l: "Inativo" }].map(({ v, l }) => (
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

      {/* Filter drawer */}
      {filterOpen && (
        <FilterDrawerShell
          totalAtivos={nfiltros.tipo.length + nfiltros.grau.length + nfiltros.ativo.length + nfiltros.analitico.length}
          onClose={() => setFilterOpen(false)}
          onApply={applyFilter}
          onClear={clearFilter}
        >
          <FilterSection label="Tipo" count={(Array.isArray(rascunho.tipo) ? rascunho.tipo : []).length} onClear={() => setRascunho(p => ({ ...p, tipo: [] }))}>
            {["NATIVO", "GERENCIAL"].map(v => (
              <FilterCheckbox key={v} label={v} checked={(Array.isArray(rascunho.tipo) ? rascunho.tipo : []).includes(v)} onChange={() => toggleRascunho("tipo", v)} />
            ))}
          </FilterSection>
          <FilterSection label="Grau" count={(Array.isArray(rascunho.grau) ? rascunho.grau : []).length} onClear={() => setRascunho(p => ({ ...p, grau: [] }))}>
            {["1", "2", "3", "4"].map(v => (
              <FilterCheckbox key={v} label={`Grau ${v}`} checked={(Array.isArray(rascunho.grau) ? rascunho.grau : []).includes(v)} onChange={() => toggleRascunho("grau", v)} />
            ))}
          </FilterSection>
          <FilterSection label="Ativo" count={(Array.isArray(rascunho.ativo) ? rascunho.ativo : []).length} onClear={() => setRascunho(p => ({ ...p, ativo: [] }))}>
            {[{ v: "S", l: "Ativo" }, { v: "N", l: "Inativo" }].map(({ v, l }) => (
              <FilterCheckbox key={v} label={l} checked={(Array.isArray(rascunho.ativo) ? rascunho.ativo : []).includes(v)} onChange={() => toggleRascunho("ativo", v)} />
            ))}
          </FilterSection>
          <FilterSection label="Analítico" count={(Array.isArray(rascunho.analitico) ? rascunho.analitico : []).length} onClear={() => setRascunho(p => ({ ...p, analitico: [] }))}>
            {[{ v: "S", l: "Analítico" }, { v: "N", l: "Sintético" }].map(({ v, l }) => (
              <FilterCheckbox key={v} label={l} checked={(Array.isArray(rascunho.analitico) ? rascunho.analitico : []).includes(v)} onChange={() => toggleRascunho("analitico", v)} />
            ))}
          </FilterSection>
        </FilterDrawerShell>
      )}
    </div>
  );
}
