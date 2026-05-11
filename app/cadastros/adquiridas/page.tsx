"use client";

import { useState, useMemo } from "react";
import { Plus, Pencil, Trash2, Search, X, Filter } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { adquiridasDataInicial, type AdquiridaRow } from "@/lib/mockData";
import { usePersistedData } from "@/lib/storage";
import { ESTADOS_BRASILEIROS } from "@/lib/utils";
import { FilterSection, FilterCheckbox, FilterDrawerShell } from "@/components/FilterAccordion";

const empty: Omit<AdquiridaRow, "id"> = { EMPRESA: "", DATA: "", ESTADO_ORIGEM: "", AREA_NEGOCIO: "" };

interface Filtros { estado: string[]; area: string[]; }
const filtrosVazios: Filtros = { estado: [], area: [] };

export default function AdquiridasPage() {
  const [data, setData] = usePersistedData<AdquiridaRow[]>("portal_adquiridas", adquiridasDataInicial);
  const [search, setSearch] = useState("");
  const [filtros, setFiltros] = usePersistedData<Filtros>("portal_filtros_adquiridas", filtrosVazios);
  const [rascunho, setRascunho] = useState<Filtros>(filtrosVazios);
  const [filterOpen, setFilterOpen] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; mode: "add" | "edit"; row: Partial<AdquiridaRow> }>({
    open: false, mode: "add", row: { ...empty },
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchFields, setBatchFields] = useState<Set<string>>(new Set());
  const [batchValues, setBatchValues] = useState({ ESTADO_ORIGEM: "", AREA_NEGOCIO: "" });

  const nfiltros = {
    estado: Array.isArray(filtros.estado) ? filtros.estado : [],
    area: Array.isArray(filtros.area) ? filtros.area : [],
  };
  const filtrosAtivos = nfiltros.estado.length > 0 || nfiltros.area.length > 0;
  const areas = useMemo(() => [...new Set(data.map(r => r.AREA_NEGOCIO).filter(Boolean))].sort(), [data]);

  const filtered = useMemo(() => {
    const nf = {
      estado: Array.isArray(filtros.estado) ? filtros.estado : [],
      area: Array.isArray(filtros.area) ? filtros.area : [],
    };
    const sorted = [...data].sort((a, b) => a.EMPRESA.localeCompare(b.EMPRESA, "pt-BR"));
    return sorted.filter((r) => {
      if (search) { const q = search.toLowerCase(); if (!r.EMPRESA.toLowerCase().includes(q) && !r.ESTADO_ORIGEM.toLowerCase().includes(q) && !r.AREA_NEGOCIO.toLowerCase().includes(q)) return false; }
      if (nf.estado.length && !nf.estado.includes(r.ESTADO_ORIGEM)) return false;
      if (nf.area.length && !nf.area.includes(r.AREA_NEGOCIO)) return false;
      return true;
    });
  }, [data, search, filtros]);

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
      const patch: Partial<AdquiridaRow> = {};
      if (batchFields.has("ESTADO_ORIGEM") && batchValues.ESTADO_ORIGEM) patch.ESTADO_ORIGEM = batchValues.ESTADO_ORIGEM;
      if (batchFields.has("AREA_NEGOCIO")) patch.AREA_NEGOCIO = batchValues.AREA_NEGOCIO;
      return { ...r, ...patch };
    }));
    setBatchFields(new Set());
    setSelected(new Set());
    setBatchOpen(false);
  }

  function handleSave() {
    const row = modal.row as AdquiridaRow;
    if (!row.EMPRESA || !row.DATA || !row.ESTADO_ORIGEM) return alert("Preencha os campos obrigatórios.");
    if (modal.mode === "add") {
      setData((d) => [...d, { ...row, id: `aq${Date.now()}` }]);
    } else {
      setData((d) => d.map((r) => (r.id === row.id ? { ...r, ...row } : r)));
    }
    setModal({ open: false, mode: "add", row: { ...empty } });
  }

  function handleDelete(id: string) {
    if (confirm("Excluir?")) setData((d) => d.filter((r) => r.id !== id));
  }

  function openFilter() {
    setRascunho({
      estado: Array.isArray(filtros.estado) ? filtros.estado : [],
      area: Array.isArray(filtros.area) ? filtros.area : [],
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
    <div>
      <PageHeader title="Adquiridas" subtitle={`${data.length} empresas adquiridas`}>
        <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }}
          onClick={() => setModal({ open: true, mode: "add", row: { ...empty } })}>
          <Plus size={15} /> Nova Adquirida
        </button>
      </PageHeader>

      <div className="p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 p-4 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-56 bg-white"
                placeholder="Buscar empresa adquirida..." value={search} onChange={(e) => setSearch(e.target.value)} />
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
                <tr style={{ background: "#f8fafc" }}>
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-4 h-4 cursor-pointer rounded" style={{ accentColor: "#1e3a5f" }} />
                  </th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">EMPRESA</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">DATA DE AQUISIÇÃO</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">ESTADO DE ORIGEM</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">ÁREA DE NEGÓCIO</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-center">AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isSel = selected.has(row.id);
                  return (
                    <tr key={row.id} className="border-b border-gray-100 transition-colors select-none"
                      style={isSel ? { background: "#eff6ff", outline: "2px solid #0078D4", outlineOffset: "-1px" } : {}}>
                      <td className="px-3 py-1.5 w-8" onClick={(e) => { e.stopPropagation(); handleSelect(row.id, e.shiftKey); }}>
                        <input type="checkbox" checked={isSel} onChange={() => {}}
                          className="w-4 h-4 cursor-pointer rounded" style={{ accentColor: "#1e3a5f" }} />
                      </td>
                      <td className="px-4 py-1.5 text-sm font-medium text-gray-800">{row.EMPRESA}</td>
                      <td className="px-4 py-1.5 text-sm text-gray-500">{row.DATA ? new Date(row.DATA).toLocaleDateString("pt-BR") : "—"}</td>
                      <td className="px-4 py-1.5 text-sm">
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium" style={{ background: "#f0f9ff", color: "#0369a1" }}>{row.ESTADO_ORIGEM}</span>
                      </td>
                      <td className="px-4 py-1.5 text-sm text-gray-600">{row.AREA_NEGOCIO || <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-1.5 text-sm">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => selected.size > 1 ? setBatchOpen(true) : setModal({ open: true, mode: "edit", row: { ...row } })} className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors"><Pencil size={15} /></button>
                          <button onClick={() => handleDelete(row.id)} className="p-1.5 hover:bg-red-100 rounded-lg text-red-500 transition-colors"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhuma empresa adquirida encontrada.</td></tr>
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
              <h2 className="text-lg font-semibold text-gray-800">{modal.mode === "add" ? "Nova Empresa Adquirida" : "Editar Adquirida"}</h2>
              <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" onClick={() => setModal({ ...modal, open: false })}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Empresa *</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={modal.row.EMPRESA || ""} onChange={(e) => setModal({ ...modal, row: { ...modal.row, EMPRESA: e.target.value.toUpperCase() } })} placeholder="Razão social da empresa adquirida" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de Aquisição *</label>
                  <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={modal.row.DATA || ""} onChange={(e) => setModal({ ...modal, row: { ...modal.row, DATA: e.target.value } })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estado de Origem *</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={modal.row.ESTADO_ORIGEM || ""} onChange={(e) => setModal({ ...modal, row: { ...modal.row, ESTADO_ORIGEM: e.target.value } })}>
                    <option value="">— Selecione —</option>
                    {ESTADOS_BRASILEIROS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Área de Negócio</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={modal.row.AREA_NEGOCIO || ""} onChange={(e) => setModal({ ...modal, row: { ...modal.row, AREA_NEGOCIO: e.target.value.toUpperCase() } })} placeholder="Ex: TECNOLOGIA, FINANCEIRO, SAÚDE..." />
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
                <p className="text-xs text-gray-500 mt-0.5">{selected.size} selecionada{selected.size !== 1 ? "s" : ""} · Marque os campos a alterar</p>
              </div>
              <button onClick={() => setBatchOpen(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={batchFields.has("ESTADO_ORIGEM")} onChange={(e) => toggleBatchField("ESTADO_ORIGEM", e.target.checked)}
                  className="mt-6 w-4 h-4 cursor-pointer rounded flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estado de Origem</label>
                  <select disabled={!batchFields.has("ESTADO_ORIGEM")} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    value={batchValues.ESTADO_ORIGEM} onChange={(e) => setBatchValues(v => ({ ...v, ESTADO_ORIGEM: e.target.value }))}>
                    <option value="">— Selecione —</option>
                    {ESTADOS_BRASILEIROS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={batchFields.has("AREA_NEGOCIO")} onChange={(e) => toggleBatchField("AREA_NEGOCIO", e.target.checked)}
                  className="mt-6 w-4 h-4 cursor-pointer rounded flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Área de Negócio</label>
                  <input disabled={!batchFields.has("AREA_NEGOCIO")} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    value={batchValues.AREA_NEGOCIO} onChange={(e) => setBatchValues(v => ({ ...v, AREA_NEGOCIO: e.target.value.toUpperCase() }))} placeholder="Ex: TECNOLOGIA" />
                </div>
              </div>
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
          totalAtivos={nfiltros.estado.length + nfiltros.area.length}
          onClose={() => setFilterOpen(false)}
          onApply={applyFilter}
          onClear={clearFilter}
        >
          <FilterSection label="Estado de Origem" count={(Array.isArray(rascunho.estado) ? rascunho.estado : []).length} onClear={() => setRascunho(p => ({ ...p, estado: [] }))}>
            {ESTADOS_BRASILEIROS.map(v => (
              <FilterCheckbox key={v} label={v} checked={(Array.isArray(rascunho.estado) ? rascunho.estado : []).includes(v)} onChange={() => toggleRascunho("estado", v)} />
            ))}
          </FilterSection>
          {areas.length > 0 && (
            <FilterSection label="Área de Negócio" count={(Array.isArray(rascunho.area) ? rascunho.area : []).length} onClear={() => setRascunho(p => ({ ...p, area: [] }))}>
              {areas.map(v => (
                <FilterCheckbox key={v} label={v} checked={(Array.isArray(rascunho.area) ? rascunho.area : []).includes(v)} onChange={() => toggleRascunho("area", v)} />
              ))}
            </FilterSection>
          )}
        </FilterDrawerShell>
      )}
    </div>
  );
}
