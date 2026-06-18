"use client";

import { useState, useMemo } from "react";
import { Plus, RefreshCw, Pencil, Trash2, Search, X, Filter, ChevronDown } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { empresasDataInicial, type EmpresaRow, type TipoRegistro } from "@/lib/mockData";
import { loadConfig, loadSession, sankhyaQuery, QUERIES } from "@/lib/sankhya";
import { usePersistedData, markStorageInitialized } from "@/lib/storage";

interface Filtros { tipo: string[]; resultado: string[]; classificacao: string[]; }
const filtrosVazios: Filtros = { tipo: [], resultado: [], classificacao: [] };

const RESULTADO_OPTS = ["DRE", "DFC", "AMBOS", "NÃO ENTRA"] as const;

const resultadoBadge = (v: string) =>
  v === "DRE" ? "bg-indigo-100 text-indigo-700"
  : v === "DFC" ? "bg-blue-100 text-blue-700"
  : v === "AMBOS" ? "bg-teal-100 text-teal-700"
  : "bg-gray-100 text-gray-500";

const emptyAdd: Partial<EmpresaRow> = { CODEMP: "", RAZAOSOCIAL: "", TIPO_REGISTRO: "GERENCIAL", ENTRA_RESULTADO: "NÃO ENTRA", AD_EMPCLASS: "" };

function FilterSection({ label, count, onClear, children }: { label: string; count: number; onClear: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-gray-100 last:border-0">
      <div className="flex items-center px-5 py-3 hover:bg-gray-50 transition-colors">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 flex-1 text-left">
          <span className="text-sm font-medium text-gray-700">{label}</span>
          {count > 0 && <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-xs" style={{ background: "#1e3a5f" }}>{count}</span>}
        </button>
        {count > 0 && (
          <button onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors mr-2">
            Limpar
          </button>
        )}
        <button onClick={() => setOpen(o => !o)}>
          <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && <div className="px-5 pb-3 space-y-0.5">{children}</div>}
    </div>
  );
}

function FilterCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2.5 py-1.5 cursor-pointer group">
      <input type="checkbox" checked={checked} onChange={onChange}
        className="w-4 h-4 rounded cursor-pointer flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
      <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">{label}</span>
    </label>
  );
}

interface Rascunho { tipo: string[]; resultado: string[]; classificacao: string[]; }
function FilterDrawer({ rascunho, setRascunho, classificacoes, onApply, onClear, onClose }: {
  rascunho: Rascunho;
  setRascunho: React.Dispatch<React.SetStateAction<Rascunho>>;
  classificacoes: string[];
  onApply: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const toggle = (field: keyof Rascunho, opt: string) =>
    setRascunho(p => ({
      ...p,
      [field]: p[field].includes(opt) ? p[field].filter(v => v !== opt) : [...p[field], opt],
    }));

  const totalAtivos = rascunho.tipo.length + rascunho.resultado.length + rascunho.classificacao.length;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full z-50 flex flex-col bg-white shadow-2xl" style={{ width: 300 }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <span className="text-base font-semibold text-gray-800 flex items-center gap-2">
            Filtros
            {totalAtivos > 0 && <span className="text-xs font-medium px-1.5 py-0.5 rounded-full text-white" style={{ background: "#1e3a5f" }}>{totalAtivos}</span>}
          </span>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <FilterSection label="Tipo" count={rascunho.tipo.length} onClear={() => setRascunho(p => ({ ...p, tipo: [] }))}>
            {["NATIVO", "GERENCIAL"].map(opt => (
              <FilterCheckbox key={opt} label={opt} checked={rascunho.tipo.includes(opt)} onChange={() => toggle("tipo", opt)} />
            ))}
          </FilterSection>
          <FilterSection label="Resultado" count={rascunho.resultado.length} onClear={() => setRascunho(p => ({ ...p, resultado: [] }))}>
            {RESULTADO_OPTS.map(opt => (
              <FilterCheckbox key={opt} label={opt} checked={rascunho.resultado.includes(opt)} onChange={() => toggle("resultado", opt)} />
            ))}
          </FilterSection>
          {classificacoes.length > 0 && (
            <FilterSection label="Classificação" count={rascunho.classificacao.length} onClear={() => setRascunho(p => ({ ...p, classificacao: [] }))}>
              {classificacoes.map(opt => (
                <FilterCheckbox key={opt} label={opt} checked={rascunho.classificacao.includes(opt)} onChange={() => toggle("classificacao", opt)} />
              ))}
            </FilterSection>
          )}
        </div>
        <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-200 flex-shrink-0">
          <button onClick={onApply} className="flex-1 py-2 text-sm font-semibold text-white rounded-lg" style={{ background: "#1e3a5f" }}>Aplicar</button>
          <button onClick={onClear} className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">Limpar</button>
        </div>
      </div>
    </>
  );
}

export default function EmpresasPage() {
  const [data, setData] = usePersistedData<EmpresaRow[]>("portal_empresas", empresasDataInicial);
  const [search, setSearch] = useState("");
  const [filtros, setFiltros] = usePersistedData<Filtros>("portal_filtros_empresas", filtrosVazios);
  const [rascunho, setRascunho] = useState<Filtros>(filtrosVazios);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<EmpresaRow>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<Partial<EmpresaRow>>({ ...emptyAdd });
  const [syncing, setSyncing] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchFields, setBatchFields] = useState<Set<string>>(new Set());
  const [batchValues, setBatchValues] = useState<{ RAZAOSOCIAL: string; ENTRA_RESULTADO: EmpresaRow["ENTRA_RESULTADO"]; AD_EMPCLASS: string }>({
    RAZAOSOCIAL: "",
    ENTRA_RESULTADO: "NÃO ENTRA",
    AD_EMPCLASS: "",
  });

  const tipoArr = Array.isArray(filtros.tipo) ? filtros.tipo : [];
  const resultadoArr = Array.isArray(filtros.resultado) ? filtros.resultado : [];
  const classificacaoArr = Array.isArray(filtros.classificacao) ? filtros.classificacao : [];
  const filtrosAtivos = !!(tipoArr.length || resultadoArr.length || classificacaoArr.length);
  const classificacoes = useMemo(() => [...new Set(data.map(r => r.AD_EMPCLASS).filter(Boolean))].sort(), [data]);
  const isNativoEdit = !!(editId && data.find((r) => r.id === editId)?.TIPO_REGISTRO === "NATIVO");

  const filtered = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.CODEMP.localeCompare(b.CODEMP, undefined, { numeric: true, sensitivity: "base" }));
    return sorted.filter((r) => {
      if (search) { const q = search.toLowerCase(); if (!r.CODEMP.toLowerCase().includes(q) && !r.RAZAOSOCIAL.toLowerCase().includes(q)) return false; }
      if (tipoArr.length && !tipoArr.includes(r.TIPO_REGISTRO)) return false;
      if (resultadoArr.length && !resultadoArr.includes(r.ENTRA_RESULTADO ?? "NÃO ENTRA")) return false;
      if (classificacaoArr.length && !classificacaoArr.includes(r.AD_EMPCLASS)) return false;
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
      const patch: Partial<EmpresaRow> = {};
      if (batchFields.has("ENTRA_RESULTADO")) patch.ENTRA_RESULTADO = batchValues.ENTRA_RESULTADO;
      if (r.TIPO_REGISTRO === "GERENCIAL") {
        if (batchFields.has("RAZAOSOCIAL")) patch.RAZAOSOCIAL = batchValues.RAZAOSOCIAL;
        if (batchFields.has("AD_EMPCLASS")) patch.AD_EMPCLASS = batchValues.AD_EMPCLASS;
      }
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
      const { rows } = await sankhyaQuery(cfg, sess.bearerToken, QUERIES.EMPRESAS);
      setData((prev) => {
        const existingMap = new Map(prev.filter(r => r.TIPO_REGISTRO === "NATIVO").map(r => [r.CODEMP, r]));
        const synced: EmpresaRow[] = rows.map((r, i) => {
          const existing = existingMap.get(String(r.CODEMP ?? ""));
          return {
            id: existing?.id ?? `sync_emp_${i}`,
            CODEMP: String(r.CODEMP ?? ""),
            RAZAOSOCIAL: String(r.RAZAOSOCIAL ?? ""),
            TIPO_REGISTRO: "NATIVO" as TipoRegistro,
            ENTRA_RESULTADO: existing?.ENTRA_RESULTADO ?? "DRE",
            AD_EMPCLASS: String(r.AD_EMPCLASS ?? ""),
          };
        });
        return [...synced, ...prev.filter(r => r.TIPO_REGISTRO === "GERENCIAL")];
      });
    } catch (err) {
      alert(`Erro: ${err instanceof Error ? err.message : err}\n\nConfigure a integração em Configurações.`);
    }
    setSyncing(false);
  }

  function openEdit(row: EmpresaRow) {
    setForm({ ...row });
    setEditId(row.id);
  }

  function handleSave() {
    if (!form.CODEMP || !form.RAZAOSOCIAL) return alert("Preencha todos os campos.");
    if (isNativoEdit) {
      setData((d) => d.map((r) => r.id === editId ? { ...r, ENTRA_RESULTADO: form.ENTRA_RESULTADO ?? "NÃO ENTRA" } : r));
      setEditId(null);
      return;
    }
    setData((d) => d.map((r) => (r.id === editId ? { ...r, ...form } : r)));
    setEditId(null);
  }

  function handleAdd() {
    const row = addForm as EmpresaRow;
    if (!row.CODEMP || !row.RAZAOSOCIAL) return alert("Preencha todos os campos.");
    setData((d) => [...d, { ...row, id: `emp${Date.now()}`, TIPO_REGISTRO: "GERENCIAL" }]);
    setAddOpen(false);
    setAddForm({ ...emptyAdd });
  }

  function handleDelete(id: string) {
    const row = data.find((r) => r.id === id);
    if (!row || row.TIPO_REGISTRO === "NATIVO") return;
    if (confirm("Excluir?")) setData((d) => d.filter((r) => r.id !== id));
  }

  function openFilter() {
    setRascunho({
      tipo: Array.isArray(filtros.tipo) ? filtros.tipo : [],
      resultado: Array.isArray(filtros.resultado) ? filtros.resultado : [],
      classificacao: Array.isArray(filtros.classificacao) ? filtros.classificacao : [],
    });
    setFilterOpen(true);
  }
  function applyFilter() { setFiltros({ ...rascunho }); setFilterOpen(false); }
  function clearFilter() { setRascunho(filtrosVazios); }

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Empresas" subtitle={`Tabela TSIEMP · ${data.length} empresas`}>
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
          <Plus size={15} /> Nova Empresa
        </button>
      </PageHeader>

      <div className="p-6 flex-1 overflow-hidden flex flex-col">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 p-4 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-56 bg-white"
                placeholder="Buscar empresa..."
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

          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                  </th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">TIPO</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">CÓD. EMPRESA</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">RAZÃO SOCIAL</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-center">RESULTADO</th>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left">CLASSIFICAÇÃO</th>
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
                          className="rounded"
                        />
                      </td>
                      <td className="px-4 py-1.5 text-sm">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${row.TIPO_REGISTRO === "NATIVO" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                          {row.TIPO_REGISTRO}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-sm font-mono text-blue-700 font-medium">{row.CODEMP}</td>
                      <td className="px-4 py-1.5 text-sm font-medium text-gray-800">{row.RAZAOSOCIAL}</td>
                      <td className="px-4 py-1.5 text-sm text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${resultadoBadge(row.ENTRA_RESULTADO ?? "NÃO ENTRA")}`}>
                          {row.ENTRA_RESULTADO ?? "NÃO ENTRA"}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-sm text-gray-600">{row.AD_EMPCLASS || <span className="text-gray-300">—</span>}</td>
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
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Nenhuma empresa encontrada.</td></tr>
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
                <h2 className="text-lg font-semibold text-gray-800">Editar Empresa</h2>
                {isNativoEdit && <p className="text-xs text-amber-600 mt-0.5">Registro NATIVO — campos Sankhya somente leitura</p>}
              </div>
              <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" onClick={() => setEditId(null)}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código (CODEMP)</label>
                <input
                  className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase ${isNativoEdit ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}`}
                  value={form.CODEMP || ""}
                  onChange={(e) => setForm({ ...form, CODEMP: e.target.value.toUpperCase() })}
                  disabled={isNativoEdit}
                  placeholder="Ex: 04"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Razão Social</label>
                <input
                  className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase ${isNativoEdit ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}`}
                  value={form.RAZAOSOCIAL || ""}
                  onChange={(e) => setForm({ ...form, RAZAOSOCIAL: e.target.value.toUpperCase() })}
                  disabled={isNativoEdit}
                  placeholder="Razão social completa"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Resultado</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={form.ENTRA_RESULTADO ?? "NÃO ENTRA"}
                  onChange={(e) => setForm({ ...form, ENTRA_RESULTADO: e.target.value as EmpresaRow["ENTRA_RESULTADO"] })}
                >
                  {RESULTADO_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Classificação (AD_EMPCLASS)</label>
                <input
                  className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase ${isNativoEdit ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}`}
                  value={form.AD_EMPCLASS || ""}
                  onChange={(e) => setForm({ ...form, AD_EMPCLASS: e.target.value.toUpperCase() })}
                  disabled={isNativoEdit}
                  placeholder="Ex: HOLDING, OPERACIONAL..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 pb-5">
              <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={() => setEditId(null)}>Cancelar</button>
              <button className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }} onClick={handleSave}>Salvar</button>
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
              <h2 className="text-lg font-semibold text-gray-800">Nova Empresa</h2>
              <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" onClick={() => setAddOpen(false)}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código (CODEMP)</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  value={addForm.CODEMP || ""}
                  onChange={(e) => setAddForm({ ...addForm, CODEMP: e.target.value.toUpperCase() })}
                  placeholder="Ex: 04"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Razão Social</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  value={addForm.RAZAOSOCIAL || ""}
                  onChange={(e) => setAddForm({ ...addForm, RAZAOSOCIAL: e.target.value.toUpperCase() })}
                  placeholder="Razão social completa"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Resultado</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={addForm.ENTRA_RESULTADO ?? "NÃO ENTRA"}
                  onChange={(e) => setAddForm({ ...addForm, ENTRA_RESULTADO: e.target.value as EmpresaRow["ENTRA_RESULTADO"] })}
                >
                  {RESULTADO_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Classificação (AD_EMPCLASS)</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  value={addForm.AD_EMPCLASS || ""}
                  onChange={(e) => setAddForm({ ...addForm, AD_EMPCLASS: e.target.value.toUpperCase() })}
                  placeholder="Ex: HOLDING, OPERACIONAL..."
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
                <p className="text-xs text-gray-500 mt-0.5">{selected.size} empresa{selected.size > 1 ? "s" : ""} selecionada{selected.size > 1 ? "s" : ""}</p>
              </div>
              <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" onClick={() => setBatchOpen(false)}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3">
                <input type="checkbox" id="bf_resultado" checked={batchFields.has("ENTRA_RESULTADO")}
                  onChange={(e) => setBatchFields((s) => { const n = new Set(s); e.target.checked ? n.add("ENTRA_RESULTADO") : n.delete("ENTRA_RESULTADO"); return n; })}
                  className="mt-6 rounded flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
                <div className="flex-1">
                  <label htmlFor="bf_resultado" className="block text-sm font-medium text-gray-700 mb-1">Resultado</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    value={batchValues.ENTRA_RESULTADO}
                    onChange={(e) => setBatchValues((v) => ({ ...v, ENTRA_RESULTADO: e.target.value as EmpresaRow["ENTRA_RESULTADO"] }))}
                    disabled={!batchFields.has("ENTRA_RESULTADO")}
                  >
                    {RESULTADO_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <input type="checkbox" id="bf_razaosocial" checked={batchFields.has("RAZAOSOCIAL")}
                  onChange={(e) => setBatchFields((s) => { const n = new Set(s); e.target.checked ? n.add("RAZAOSOCIAL") : n.delete("RAZAOSOCIAL"); return n; })}
                  className="mt-6 rounded flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
                <div className="flex-1">
                  <label htmlFor="bf_razaosocial" className="block text-sm font-medium text-gray-700 mb-1">Razão Social <span className="text-gray-400 font-normal">(somente GERENCIAL)</span></label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase disabled:bg-gray-50 disabled:text-gray-400"
                    value={batchValues.RAZAOSOCIAL}
                    onChange={(e) => setBatchValues((v) => ({ ...v, RAZAOSOCIAL: e.target.value.toUpperCase() }))}
                    disabled={!batchFields.has("RAZAOSOCIAL")}
                    placeholder="Nova razão social..."
                  />
                </div>
              </div>
              <div className="flex items-start gap-3">
                <input type="checkbox" id="bf_empclass" checked={batchFields.has("AD_EMPCLASS")}
                  onChange={(e) => setBatchFields((s) => { const n = new Set(s); e.target.checked ? n.add("AD_EMPCLASS") : n.delete("AD_EMPCLASS"); return n; })}
                  className="mt-6 rounded flex-shrink-0" style={{ accentColor: "#1e3a5f" }} />
                <div className="flex-1">
                  <label htmlFor="bf_empclass" className="block text-sm font-medium text-gray-700 mb-1">Classificação <span className="text-gray-400 font-normal">(somente GERENCIAL)</span></label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase disabled:bg-gray-50 disabled:text-gray-400"
                    value={batchValues.AD_EMPCLASS}
                    onChange={(e) => setBatchValues((v) => ({ ...v, AD_EMPCLASS: e.target.value.toUpperCase() }))}
                    disabled={!batchFields.has("AD_EMPCLASS")}
                    placeholder="Ex: HOLDING, OPERACIONAL..."
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 pb-5">
              <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={() => setBatchOpen(false)}>Cancelar</button>
              <button
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ background: "#1e3a5f" }}
                onClick={applyBatch}
                disabled={batchFields.size === 0}
              >
                Aplicar a {selected.size} registro{selected.size > 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter drawer */}
      {filterOpen && (
        <FilterDrawer
          rascunho={rascunho}
          setRascunho={setRascunho}
          classificacoes={classificacoes}
          onApply={applyFilter}
          onClear={clearFilter}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </div>
  );
}
