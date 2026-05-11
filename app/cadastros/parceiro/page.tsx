"use client";

import { useState, useMemo } from "react";
import { Plus, RefreshCw, Pencil, Trash2, Search, X, Filter } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { parceirosDataInicial, type ParceiroRow, type TipoRegistro } from "@/lib/mockData";
import { loadConfig, loadSession, sankhyaQuery, QUERIES } from "@/lib/sankhya";
import { usePersistedData, markStorageInitialized } from "@/lib/storage";
import { FilterSection, FilterCheckbox, FilterDrawerShell } from "@/components/FilterAccordion";

interface Filtros { tipo: string[]; }
const filtrosVazios: Filtros = { tipo: [] };

export default function ParceiroPage() {
  const [data, setData] = usePersistedData<ParceiroRow[]>("portal_parceiro", parceirosDataInicial);
  const [search, setSearch] = useState("");
  const [filtros, setFiltros] = usePersistedData<Filtros>("portal_filtros_parceiro", filtrosVazios);
  const [rascunho, setRascunho] = useState<Filtros>(filtrosVazios);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<ParceiroRow>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<Partial<ParceiroRow>>({ CODPARC: "", NOMEPARC: "", TIPO_REGISTRO: "GERENCIAL" });
  const [syncing, setSyncing] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchFields, setBatchFields] = useState<Set<string>>(new Set());
  const [batchValues, setBatchValues] = useState({ NOMEPARC: "" });

  const nfiltros = { tipo: Array.isArray(filtros.tipo) ? filtros.tipo : [] };
  const filtrosAtivos = nfiltros.tipo.length > 0;
  const isNativoEdit = !!(editId && data.find((r) => r.id === editId)?.TIPO_REGISTRO === "NATIVO");

  const filtered = useMemo(() => {
    const nf = { tipo: Array.isArray(filtros.tipo) ? filtros.tipo : [] };
    const sorted = [...data].sort((a, b) => a.CODPARC.localeCompare(b.CODPARC, undefined, { numeric: true, sensitivity: "base" }));
    return sorted.filter((r) => {
      if (search) { const q = search.toLowerCase(); if (!r.CODPARC.toLowerCase().includes(q) && !r.NOMEPARC.toLowerCase().includes(q)) return false; }
      if (nf.tipo.length && !nf.tipo.includes(r.TIPO_REGISTRO)) return false;
      return true;
    });
  }, [data, search, filtros]);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  function toggleAll() {
    if (allSelected) {
      setSelected((s) => { const n = new Set(s); filtered.forEach((r) => n.delete(r.id)); return n; });
    } else {
      setSelected((s) => { const n = new Set(s); filtered.forEach((r) => n.add(r.id)); return n; });
    }
  }

  function handleSelect(id: string, shift: boolean) {
    if (shift && lastSelected) {
      const ids = filtered.map((r) => r.id);
      const a = ids.indexOf(lastSelected);
      const b = ids.indexOf(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected((s) => { const n = new Set(s); ids.slice(lo, hi + 1).forEach((i) => n.add(i)); return n; });
    } else {
      setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    }
    setLastSelected(id);
  }

  function applyBatch() {
    setData((d) => d.map((r) => {
      if (!selected.has(r.id)) return r;
      if (r.TIPO_REGISTRO === "NATIVO") return r;
      const patch: Partial<ParceiroRow> = {};
      if (batchFields.has("NOMEPARC")) patch.NOMEPARC = batchValues.NOMEPARC;
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
      const { rows } = await sankhyaQuery(cfg, sess.bearerToken, QUERIES.PARCEIRO);
      const synced: ParceiroRow[] = rows.map((r, i) => ({
        id: `sync_parc_${i}`,
        CODPARC: String(r.CODPARC ?? ""),
        NOMEPARC: String(r.NOMEPARC ?? ""),
        TIPO_REGISTRO: "NATIVO" as TipoRegistro,
      }));
      setData((prev) => [...synced, ...prev.filter((r) => r.TIPO_REGISTRO === "GERENCIAL")]);
    } catch (err) {
      alert(`Erro: ${err instanceof Error ? err.message : err}\n\nConfigure a integração em Configurações.`);
    }
    setSyncing(false);
  }

  function openEdit(row: ParceiroRow) {
    setForm({ ...row });
    setEditId(row.id);
  }

  function handleSave() {
    if (!form.CODPARC || !form.NOMEPARC) return alert("Preencha todos os campos.");
    if (isNativoEdit) {
      setEditId(null);
      return;
    }
    setData((d) => d.map((r) => (r.id === editId ? { ...r, ...form } : r)));
    setEditId(null);
  }

  function handleAdd() {
    const row = addForm as ParceiroRow;
    if (!row.CODPARC || !row.NOMEPARC) return alert("Preencha todos os campos.");
    setData((d) => [...d, { ...row, id: `parc${Date.now()}`, TIPO_REGISTRO: "GERENCIAL" }]);
    setAddOpen(false);
    setAddForm({ CODPARC: "", NOMEPARC: "", TIPO_REGISTRO: "GERENCIAL" });
  }

  function handleDelete(id: string) {
    const row = data.find((r) => r.id === id);
    if (!row || row.TIPO_REGISTRO === "NATIVO") return;
    if (confirm("Excluir?")) setData((d) => d.filter((r) => r.id !== id));
  }

  function openFilter() {
    setRascunho({ tipo: Array.isArray(filtros.tipo) ? filtros.tipo : [] });
    setFilterOpen(true);
  }
  function applyFilter() { setFiltros({ ...rascunho }); setFilterOpen(false); }
  function clearFilter() { setRascunho(filtrosVazios); }

  function toggleRascunho(val: string) {
    setRascunho(p => {
      const arr = Array.isArray(p.tipo) ? p.tipo : [];
      return { tipo: arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val] };
    });
  }

  return (
    <div>
      <PageHeader title="Parceiro" subtitle={`Tabela TGFPAR · ${data.length} parceiros`}>
        <button
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Sincronizando..." : "Sincronizar Sankhya"}
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg"
          style={{ background: "#1e3a5f" }}
          onClick={() => setAddOpen(true)}
        >
          <Plus size={15} /> Novo Parceiro
        </button>
      </PageHeader>

      <div className="p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 p-4 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-56 bg-white"
                placeholder="Buscar parceiro..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              onClick={openFilter}
              className="relative flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors"
              style={filtrosAtivos ? { background: "#1e3a5f", color: "white", borderColor: "#1e3a5f" } : { background: "white", color: "#374151", borderColor: "#d1d5db" }}
            >
              <Filter size={14} />
              Filtros
              {filtrosAtivos && <span className="w-1.5 h-1.5 rounded-full bg-white absolute top-1 right-1" />}
            </button>
            <span className="text-xs text-gray-400 ml-auto">{filtered.length} de {data.length} registros</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">TIPO</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">CÓD. PARCEIRO</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">NOME DO PARCEIRO</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-center">AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isSel = selected.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                      style={isSel ? { outline: "2px solid #0078D4", outlineOffset: "-1px" } : {}}
                    >
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={(e) => handleSelect(row.id, e.nativeEvent instanceof MouseEvent && (e.nativeEvent as MouseEvent).shiftKey)}
                          onClick={(e) => handleSelect(row.id, e.shiftKey)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-4 py-1.5 text-sm">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${row.TIPO_REGISTRO === "NATIVO" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                          {row.TIPO_REGISTRO}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-sm font-mono text-blue-700 font-medium">{row.CODPARC}</td>
                      <td className="px-4 py-1.5 text-sm font-medium text-gray-800">{row.NOMEPARC}</td>
                      <td className="px-4 py-1.5 text-sm">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => selected.size > 1 ? setBatchOpen(true) : openEdit(row)} className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors"><Pencil size={15} /></button>
                          {row.TIPO_REGISTRO === "GERENCIAL" && (
                            <button onClick={() => handleDelete(row.id)} className="p-1.5 hover:bg-red-100 rounded-lg text-red-500 transition-colors"><Trash2 size={15} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Nenhum parceiro encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setEditId(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Editar Parceiro</h2>
                {isNativoEdit && <p className="text-xs text-amber-600 mt-0.5">Registro NATIVO — campos Sankhya somente leitura</p>}
              </div>
              <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" onClick={() => setEditId(null)}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código (CODPARC)</label>
                <input
                  className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase ${isNativoEdit ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}`}
                  value={form.CODPARC || ""}
                  onChange={(e) => setForm({ ...form, CODPARC: e.target.value.toUpperCase() })}
                  disabled={isNativoEdit}
                  placeholder="Ex: 005"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Parceiro (NOMEPARC)</label>
                <input
                  className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase ${isNativoEdit ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}`}
                  value={form.NOMEPARC || ""}
                  onChange={(e) => setForm({ ...form, NOMEPARC: e.target.value.toUpperCase() })}
                  disabled={isNativoEdit}
                  placeholder="Razão social ou nome fantasia"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 pb-5">
              <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={() => setEditId(null)}>Cancelar</button>
              {!isNativoEdit && (
                <button className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }} onClick={handleSave}>Salvar</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setAddOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">Novo Parceiro</h2>
              <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" onClick={() => setAddOpen(false)}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código (CODPARC)</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  value={addForm.CODPARC || ""}
                  onChange={(e) => setAddForm({ ...addForm, CODPARC: e.target.value.toUpperCase() })}
                  placeholder="Ex: 005"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Parceiro (NOMEPARC)</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  value={addForm.NOMEPARC || ""}
                  onChange={(e) => setAddForm({ ...addForm, NOMEPARC: e.target.value.toUpperCase() })}
                  placeholder="Razão social ou nome fantasia"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 pb-5">
              <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={() => setAddOpen(false)}>Cancelar</button>
              <button className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }} onClick={handleAdd}>Adicionar</button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Edit Modal */}
      {batchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setBatchOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Editar em lote</h2>
                <p className="text-xs text-gray-500 mt-0.5">{selected.size} parceiro{selected.size > 1 ? "s" : ""} selecionado{selected.size > 1 ? "s" : ""} · apenas registros GERENCIAL serão alterados</p>
              </div>
              <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" onClick={() => setBatchOpen(false)}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="bf_nomeparc"
                  checked={batchFields.has("NOMEPARC")}
                  onChange={(e) => setBatchFields((s) => { const n = new Set(s); e.target.checked ? n.add("NOMEPARC") : n.delete("NOMEPARC"); return n; })}
                  className="mt-2 rounded"
                />
                <div className="flex-1">
                  <label htmlFor="bf_nomeparc" className="block text-sm font-medium text-gray-700 mb-1">Nome do Parceiro (NOMEPARC)</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase disabled:bg-gray-100 disabled:text-gray-400"
                    value={batchValues.NOMEPARC}
                    onChange={(e) => setBatchValues((v) => ({ ...v, NOMEPARC: e.target.value.toUpperCase() }))}
                    disabled={!batchFields.has("NOMEPARC")}
                    placeholder="Novo nome..."
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 pb-5">
              <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={() => setBatchOpen(false)}>Cancelar</button>
              <button
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ background: "#0078D4" }}
                onClick={applyBatch}
                disabled={batchFields.size === 0}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter drawer */}
      {filterOpen && (
        <FilterDrawerShell
          totalAtivos={nfiltros.tipo.length}
          onClose={() => setFilterOpen(false)}
          onApply={applyFilter}
          onClear={clearFilter}
        >
          <FilterSection label="Tipo" count={(Array.isArray(rascunho.tipo) ? rascunho.tipo : []).length} onClear={() => setRascunho({ tipo: [] })}>
            {["NATIVO", "GERENCIAL"].map(v => (
              <FilterCheckbox key={v} label={v} checked={(Array.isArray(rascunho.tipo) ? rascunho.tipo : []).includes(v)} onChange={() => toggleRascunho(v)} />
            ))}
          </FilterSection>
        </FilterDrawerShell>
      )}
    </div>
  );
}
