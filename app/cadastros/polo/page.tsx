"use client";

import { useState, useMemo } from "react";
import { Plus, Pencil, Trash2, Search, X, ChevronUp, ChevronDown as ChevronDownIcon } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePersistedData } from "@/lib/storage";

interface PoloRow {
  id: string;
  POLO: string;
  ESTADO: string;
  CIDADE: string;
  DATA_CRIACAO: string;
  DATA_INATIVO: string;
}

type SortCol = "POLO" | "ESTADO" | "CIDADE" | "DATA_CRIACAO" | "DATA_INATIVO";
type SortDir = "asc" | "desc";

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM: Omit<PoloRow, "id"> = { POLO: "", ESTADO: "", CIDADE: "", DATA_CRIACAO: today(), DATA_INATIVO: "" };

const COL_LABELS: Record<SortCol, string> = {
  POLO: "POLO",
  ESTADO: "ESTADO",
  CIDADE: "CIDADE",
  DATA_CRIACAO: "DATA DE CRIAÇÃO",
  DATA_INATIVO: "DATA DE INATIVO",
};

function fmtDate(d: string) {
  if (!d) return <span className="opacity-30">—</span>;
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
}

const ESTADOS_BR = [
  "AC – ACRE", "AL – ALAGOAS", "AP – AMAPÁ", "AM – AMAZONAS",
  "BA – BAHIA", "CE – CEARÁ", "DF – DISTRITO FEDERAL", "ES – ESPÍRITO SANTO",
  "GO – GOIÁS", "MA – MARANHÃO", "MT – MATO GROSSO", "MS – MATO GROSSO DO SUL",
  "MG – MINAS GERAIS", "PA – PARÁ", "PB – PARAÍBA", "PR – PARANÁ",
  "PE – PERNAMBUCO", "PI – PIAUÍ", "RJ – RIO DE JANEIRO", "RN – RIO GRANDE DO NORTE",
  "RS – RIO GRANDE DO SUL", "RO – RONDÔNIA", "RR – RORAIMA", "SC – SANTA CATARINA",
  "SP – SÃO PAULO", "SE – SERGIPE", "TO – TOCANTINS",
];

function ChevronUpIcon({ size, className }: { size: number; className?: string }) {
  return <ChevronUp size={size} className={className} />;
}

export default function PoloPage() {
  const [data, setData] = usePersistedData<PoloRow[]>("portal_polo", []);
  const [search, setSearch]   = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("POLO");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [editId, setEditId]   = useState<string | null>(null);
  const [form, setForm]       = useState<Omit<PoloRow, "id">>(EMPTY_FORM);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<Omit<PoloRow, "id">>(EMPTY_FORM);

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return [...data]
      .filter(r => !q || r.POLO.toLowerCase().includes(q) || r.CIDADE.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = a[sortCol] ?? "";
        const vb = b[sortCol] ?? "";
        const cmp = va.localeCompare(vb, "pt-BR", { sensitivity: "base" });
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [data, search, sortCol, sortDir]);

  function SortIcon({ col }: { col: SortCol }) {
    if (sortCol !== col) return <ChevronUpIcon size={11} className="opacity-20" />;
    return sortDir === "asc"
      ? <ChevronUpIcon size={11} className="text-blue-600" />
      : <ChevronDownIcon size={11} className="text-blue-600" />;
  }

  function openEdit(row: PoloRow) {
    setForm({ POLO: row.POLO, ESTADO: row.ESTADO ?? "", CIDADE: row.CIDADE, DATA_CRIACAO: row.DATA_CRIACAO ?? today(), DATA_INATIVO: row.DATA_INATIVO ?? "" });
    setEditId(row.id);
  }

  function handleSave() {
    if (!form.POLO.trim() || !form.CIDADE.trim() || !form.DATA_CRIACAO) return alert("Preencha Polo, Cidade e Data de Criação.");
    setData(d => d.map(r => r.id === editId ? { ...r, ...form } : r));
    setEditId(null);
  }

  function handleAdd() {
    if (!addForm.POLO.trim() || !addForm.CIDADE.trim() || !addForm.DATA_CRIACAO) return alert("Preencha Polo, Cidade e Data de Criação.");
    setData(d => [...d, { ...addForm, id: `polo_${Date.now()}` }]);
    setAddOpen(false);
    setAddForm({ ...EMPTY_FORM, DATA_CRIACAO: today() });
  }

  function handleDelete(id: string) {
    if (confirm("Excluir este polo?")) setData(d => d.filter(r => r.id !== id));
  }

  const COLS: SortCol[] = ["POLO", "ESTADO", "CIDADE", "DATA_CRIACAO", "DATA_INATIVO"];

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Polo" subtitle={`${data.length} polo${data.length !== 1 ? "s" : ""} cadastrado${data.length !== 1 ? "s" : ""}`}>
        <button
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg"
          style={{ background: "#1e3a5f" }}
          onClick={() => { setAddForm({ ...EMPTY_FORM, DATA_CRIACAO: today() }); setAddOpen(true); }}
        >
          <Plus size={15} /> Novo Polo
        </button>
      </PageHeader>

      <div className="p-6 flex-1 overflow-hidden flex flex-col">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col flex-1 min-h-0">

          {/* Toolbar */}
          <div className="flex items-center gap-2 p-4 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-56 bg-white"
                placeholder="Buscar polo ou cidade..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <span className="text-xs text-gray-400 ml-auto">{filtered.length} de {data.length} registros</span>
          </div>

          {/* Table */}
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-center w-10">#</th>
                  {COLS.map(col => (
                    <th key={col}
                      className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-left cursor-pointer select-none hover:bg-gray-100 transition-colors whitespace-nowrap"
                      onClick={() => handleSort(col)}>
                      <span className="flex items-center gap-1">
                        {COL_LABELS[col]}
                        <SortIcon col={col} />
                      </span>
                    </th>
                  ))}
                  <th className="font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-2 text-center">AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => (
                  <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2 text-center text-xs text-gray-400 tabular-nums">{idx + 1}</td>
                    <td className="px-4 py-2 font-medium text-gray-800">{row.POLO}</td>
                    <td className="px-4 py-2 text-gray-600">{row.ESTADO}</td>
                    <td className="px-4 py-2 text-gray-600">{row.CIDADE}</td>
                    <td className="px-4 py-2 text-gray-500 tabular-nums">{fmtDate(row.DATA_CRIACAO)}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {row.DATA_INATIVO
                        ? <span className="text-red-500">{fmtDate(row.DATA_INATIVO)}</span>
                        : <span className="opacity-30 text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(row)} className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors"><Pencil size={15} /></button>
                        <button onClick={() => handleDelete(row.id)} className="p-1.5 hover:bg-red-100 rounded-lg text-red-500 transition-colors"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Nenhum polo encontrado.</td></tr>
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
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">Editar Polo</h2>
              <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" onClick={() => setEditId(null)}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Polo</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  value={form.POLO} onChange={e => setForm(f => ({ ...f, POLO: e.target.value.toUpperCase() }))} placeholder="Ex: POLO SUL" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  list="estados-br" value={form.ESTADO} onChange={e => setForm(f => ({ ...f, ESTADO: e.target.value.toUpperCase() }))} placeholder="Ex: SP – SÃO PAULO" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  value={form.CIDADE} onChange={e => setForm(f => ({ ...f, CIDADE: e.target.value.toUpperCase() }))} placeholder="Ex: SÃO PAULO" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de Criação</label>
                  <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.DATA_CRIACAO} onChange={e => setForm(f => ({ ...f, DATA_CRIACAO: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Data de Inativo <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <div className="flex gap-1">
                    <input type="date" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={form.DATA_INATIVO} onChange={e => setForm(f => ({ ...f, DATA_INATIVO: e.target.value }))} />
                    {form.DATA_INATIVO && (
                      <button onClick={() => setForm(f => ({ ...f, DATA_INATIVO: "" }))}
                        className="px-2 py-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Limpar">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
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
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">Novo Polo</h2>
              <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" onClick={() => setAddOpen(false)}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Polo</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  value={addForm.POLO} onChange={e => setAddForm(f => ({ ...f, POLO: e.target.value.toUpperCase() }))} placeholder="Ex: POLO SUL" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  list="estados-br" value={addForm.ESTADO} onChange={e => setAddForm(f => ({ ...f, ESTADO: e.target.value.toUpperCase() }))} placeholder="Ex: SP – SÃO PAULO" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  value={addForm.CIDADE} onChange={e => setAddForm(f => ({ ...f, CIDADE: e.target.value.toUpperCase() }))} placeholder="Ex: SÃO PAULO" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de Criação</label>
                  <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={addForm.DATA_CRIACAO} onChange={e => setAddForm(f => ({ ...f, DATA_CRIACAO: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Data de Inativo <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <div className="flex gap-1">
                    <input type="date" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={addForm.DATA_INATIVO} onChange={e => setAddForm(f => ({ ...f, DATA_INATIVO: e.target.value }))} />
                    {addForm.DATA_INATIVO && (
                      <button onClick={() => setAddForm(f => ({ ...f, DATA_INATIVO: "" }))}
                        className="px-2 py-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Limpar">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 pb-5">
              <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={() => setAddOpen(false)}>Cancelar</button>
              <button className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "#1e3a5f" }} onClick={handleAdd}>Adicionar</button>
            </div>
          </div>
        </div>
      )}
      <datalist id="estados-br">
        {ESTADOS_BR.map(e => <option key={e} value={e} />)}
      </datalist>
    </div>
  );
}
