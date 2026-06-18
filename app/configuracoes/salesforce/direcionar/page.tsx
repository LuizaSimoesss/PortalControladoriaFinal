"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, RefreshCw, CheckCircle2, AlertCircle,
  GitMerge, Database, Search, List, Plus, Pencil, Trash2, Eye, EyeOff,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { saveData } from "@/lib/storage";
import {
  salesforceConnect, salesforceDescribe, salesforceSoql, salesforceNextPage,
  salesforceListObjects, isSessionExpired,
  type SalesforceConfig, type SalesforceSession, type SalesforceField, type SalesforceObject,
} from "@/lib/salesforce";
import { getSfTransfer, type SfTransferPayload as SfPayload } from "@/lib/sfTransfer";
import { saveQueryRecord } from "@/lib/sfHistory";

const DESTINATION_LABEL: Record<string, string> = Object.fromEntries(
  [
    ["portal_parceiro", "Parceiro"],
    ["portal_projetos", "Projetos"],
    ["portal_natureza", "Natureza"],
    ["portal_empresas", "Empresas"],
    ["portal_adquiridas", "Adquiridas"],
    ["portal_indicadores", "Indicadores"],
    ["portal_centro_resultado", "Centro de Resultado"],
  ]
);

interface ColConfig {
  source: string;       // original key in mergedRows (empty = computed)
  outputName: string;   // column name when saving
  include: boolean;
  constant?: string;    // for inserted columns
}

const DESTINATION_TABLES = [
  { key: "portal_parceiro",         label: "Parceiro" },
  { key: "portal_projetos",         label: "Projetos" },
  { key: "portal_natureza",         label: "Natureza" },
  { key: "portal_empresas",         label: "Empresas" },
  { key: "portal_adquiridas",       label: "Adquiridas" },
  { key: "portal_indicadores",      label: "Indicadores" },
  { key: "portal_centro_resultado", label: "Centro de Resultado" },
];

type LoadStatus = "idle" | "loading" | "ready" | "error";
type Step = "config" | "preview" | "done";

export default function DirecionarPage() {
  const router = useRouter();

  const [payload, setPayload] = useState<SfPayload | null>(null);
  const [config, setConfig] = useState<SalesforceConfig | null>(null);
  const [session, setSession] = useState<SalesforceSession | null>(null);

  // Second SF object
  const [objects, setObjects] = useState<SalesforceObject[]>([]);
  const [objectSearch, setObjectSearch] = useState("");
  const [selectedObj2, setSelectedObj2] = useState<SalesforceObject | null>(null);
  const [obj2Fields, setObj2Fields] = useState<SalesforceField[]>([]);
  const [obj2Rows, setObj2Rows] = useState<Record<string, unknown>[]>([]);
  const [obj2Status, setObj2Status] = useState<LoadStatus>("idle");
  const [obj2Error, setObj2Error] = useState("");
  const abortRef = useRef(false);

  // Join config
  const [sfJoinField1, setSfJoinField1] = useState("");
  const [sfJoinField2, setSfJoinField2] = useState("");
  const [destTable, setDestTable] = useState("");

  // Column editor
  const [colConfigs, setColConfigs] = useState<ColConfig[]>([]);
  const [colSearch, setColSearch] = useState("");
  const [newColName, setNewColName] = useState("");
  const [newColValue, setNewColValue] = useState("");
  const [editingCol, setEditingCol] = useState<string | null>(null);

  // Steps / UI
  const [step, setStep] = useState<Step>("config");
  const [saving, setSaving] = useState(false);
  const [previewSearch, setPreviewSearch] = useState("");

  useEffect(() => {
    const p = getSfTransfer();
    if (!p) return;
    setPayload(p);
    setConfig(p.sfConfig);
    setSession(p.sfSession);
  }, []);

  useEffect(() => {
    if (!config || !session) return;
    loadObjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, session]);

  async function ensureSession(cfg: SalesforceConfig, sess: SalesforceSession): Promise<SalesforceSession> {
    if (isSessionExpired(sess)) {
      const newSess = await salesforceConnect(cfg);
      setSession(newSess);
      return newSess;
    }
    return sess;
  }

  async function loadObjects() {
    if (!config || !session) return;
    try {
      const sess = await ensureSession(config, session);
      const list = await salesforceListObjects(config, sess);
      setObjects(list.sort((a, b) => a.label.localeCompare(b.label)));
    } catch {}
  }

  async function loadObj2(obj: SalesforceObject) {
    if (!config || !session) return;
    abortRef.current = true;
    await new Promise(r => setTimeout(r, 0));
    abortRef.current = false;

    setSelectedObj2(obj);
    setObj2Status("loading");
    setObj2Error("");
    setObj2Fields([]);
    setObj2Rows([]);
    setSfJoinField1("");
    setSfJoinField2("");
    setColConfigs([]);

    try {
      const sess = await ensureSession(config, session);
      const { fields } = await salesforceDescribe(config, sess, obj.name);
      if (abortRef.current) return;

      let queryableFields = [...fields];
      let firstPage;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const fieldList = queryableFields.map(f => f.name).join(", ");
          firstPage = await salesforceSoql(config, sess, `SELECT ${fieldList} FROM ${obj.name}`);
          break;
        } catch (soqlErr) {
          const errMsg = soqlErr instanceof Error ? soqlErr.message : "";
          const badField =
            errMsg.match(/No such column '([^']+)'/i)?.[1] ||
            errMsg.match(/INVALID_FIELD[^']*'([^']+)'/i)?.[1] ||
            errMsg.match(/invalid field[^:]*:\s*(\S+)/i)?.[1];
          if (!badField) throw soqlErr;
          queryableFields = queryableFields.filter(f => f.name !== badField);
        }
      }
      if (!firstPage) throw new Error("Não foi possível carregar dados: muitos campos inválidos.");
      setObj2Fields(queryableFields);

      const { records, done, nextRecordsUrl } = firstPage;
      if (abortRef.current) return;
      setObj2Rows(records);
      setObj2Status("ready");

      if (!done && nextRecordsUrl) {
        let next: string | null = nextRecordsUrl;
        let accumulated = [...records];
        let pageCount = 0;
        while (next && !abortRef.current) {
          const page = await salesforceNextPage(config, sess, next);
          accumulated = accumulated.concat(page.records);
          pageCount++;
          next = page.done ? null : (page.nextRecordsUrl ?? null);
          if (pageCount % 5 === 0 || !next) setObj2Rows([...accumulated]);
        }
      }
    } catch (err: unknown) {
      if (abortRef.current) return;
      setObj2Error(err instanceof Error ? err.message : "Erro ao carregar objeto");
      setObj2Status("error");
    }
  }

  const sf1Fields = useMemo(() => {
    if (!payload) return [];
    return payload.sfAllFields.filter(f => payload.sfFields.includes(f.name));
  }, [payload]);

  // Build merged rows
  const mergedRows = useMemo(() => {
    if (!payload || !sfJoinField1 || !sfJoinField2 || !obj2Rows.length) return payload?.sfRows ?? [];

    const obj2Prefix = selectedObj2 ? `${selectedObj2.name}_` : "t2_";
    const index = new Map<string, Record<string, unknown>>();
    for (const row of obj2Rows) {
      const key = String(row[sfJoinField2] ?? "").toLowerCase();
      if (!index.has(key)) index.set(key, row);
    }

    return payload.sfRows.map(row1 => {
      const key = String(row1[sfJoinField1] ?? "").toLowerCase();
      const match = index.get(key);
      if (!match) return { ...row1 };
      const prefixed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(match)) prefixed[`${obj2Prefix}${k}`] = v;
      return { ...row1, ...prefixed };
    });
  }, [payload, sfJoinField1, sfJoinField2, obj2Rows, selectedObj2]);

  const mergedFields = useMemo(() => mergedRows.length ? Object.keys(mergedRows[0]) : [], [mergedRows]);

  // Initialize colConfigs when mergedFields change
  useEffect(() => {
    if (!mergedFields.length) return;
    setColConfigs(prev => {
      const existingMap = new Map(prev.map(c => [c.source, c]));
      const base = mergedFields.map(f => existingMap.get(f) ?? ({ source: f, outputName: f, include: true } as ColConfig));
      const computed = prev.filter(c => !c.source); // keep inserted columns
      return [...base, ...computed];
    });
  }, [mergedFields]);

  const includedCols = useMemo(() => colConfigs.filter(c => c.include), [colConfigs]);

  const filteredColConfigs = useMemo(() => {
    if (!colSearch.trim()) return colConfigs;
    const q = colSearch.toLowerCase();
    return colConfigs.filter(c => c.source.toLowerCase().includes(q) || c.outputName.toLowerCase().includes(q));
  }, [colConfigs, colSearch]);

  // Final rows with column config applied
  const finalRows = useMemo(() => {
    const included = colConfigs.filter(c => c.include);
    return mergedRows.map(row => {
      const out: Record<string, unknown> = {};
      for (const col of included) {
        out[col.outputName] = col.source ? row[col.source] : col.constant ?? "";
      }
      return out;
    });
  }, [mergedRows, colConfigs]);

  const filteredPreview = useMemo(() => {
    const base = finalRows.slice(0, 200);
    if (!previewSearch.trim()) return base;
    const q = previewSearch.toLowerCase();
    return base.filter(r => Object.values(r).some(v => String(v ?? "").toLowerCase().includes(q)));
  }, [finalRows, previewSearch]);

  const matchCount = useMemo(() => {
    if (!payload || !sfJoinField1 || !sfJoinField2 || !obj2Rows.length) return 0;
    const index = new Set(obj2Rows.map(r => String(r[sfJoinField2] ?? "").toLowerCase()));
    return payload.sfRows.filter(r => index.has(String(r[sfJoinField1] ?? "").toLowerCase())).length;
  }, [payload, sfJoinField1, sfJoinField2, obj2Rows]);

  const canPreview = !!destTable && mergedRows.length > 0 && includedCols.length > 0;

  function updateCol(source: string, patch: Partial<ColConfig>) {
    setColConfigs(prev => prev.map(c => c.source === source ? { ...c, ...patch } : c));
  }

  function addComputedCol() {
    if (!newColName.trim()) return;
    setColConfigs(prev => [...prev, { source: "", outputName: newColName.trim(), include: true, constant: newColValue }]);
    setNewColName("");
    setNewColValue("");
  }

  function removeComputedCol(outputName: string) {
    setColConfigs(prev => prev.filter(c => !(c.source === "" && c.outputName === outputName)));
  }

  function handleSave() {
    if (!canPreview || !payload || !selectedObj2) return;
    setSaving(true);
    try {
      saveData(destTable, finalRows);
      saveQueryRecord({
        obj1Name: payload.sfObject,
        obj1Label: payload.sfObjectLabel,
        obj1RowCount: payload.sfRows.length,
        obj1Fields: payload.sfFields,
        obj2Name: selectedObj2.name,
        obj2Label: selectedObj2.label,
        obj2RowCount: obj2Rows.length,
        joinField1: sfJoinField1,
        joinField2: sfJoinField2,
        matchCount,
        destKey: destTable,
        destLabel: DESTINATION_LABEL[destTable] ?? destTable,
        outputRowCount: finalRows.length,
        outputColCount: includedCols.length,
      });
      setStep("done");
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  if (!payload) {
    return (
      <div>
        <PageHeader title="Configuração › Salesforce › Direcionar" subtitle="" />
        <div className="p-6 flex items-start gap-3 text-red-600">
          <AlertCircle size={18} className="mt-0.5" />
          <div>
            <p className="font-medium">Nenhuma seleção encontrada.</p>
            <p className="text-sm text-red-400 mt-1">Volte ao explorador, selecione um objeto e clique em "Direcionar dados".</p>
            <button className="mt-3 text-sm text-blue-600 hover:underline flex items-center gap-1" onClick={() => router.back()}>
              <ArrowLeft size={13} /> Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Configuração › Salesforce › Direcionar dados"
        subtitle={`Tabela 1: ${payload.sfObjectLabel} · ${payload.sfRows.length} registros filtrados · ${sf1Fields.length} colunas`}
      />

      <div className="p-6 space-y-4 min-w-max">
        <button className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700" onClick={() => router.back()}>
          <ArrowLeft size={14} /> Voltar ao explorador
        </button>

        {step === "done" ? (
          <div className="card max-w-lg p-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 size={40} className="text-green-500" />
            <div>
              <p className="font-bold text-slate-700 text-lg">Dados salvos com sucesso!</p>
              <p className="text-sm text-slate-500 mt-1">
                {finalRows.length} registros com {includedCols.length} colunas salvos em <strong>{DESTINATION_TABLES.find(t => t.key === destTable)?.label}</strong>.
              </p>
            </div>
            <div className="flex gap-3">
              <button className="btn-secondary" onClick={() => setStep("config")}>Reconfigurar</button>
              <button className="btn-primary" onClick={() => router.back()}>Voltar ao explorador</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-4" style={{ minHeight: 600 }}>

            {/* ── Col 1: Join config ── */}
            <div className="flex-shrink-0 space-y-4" style={{ width: 280 }}>

              {/* T1 summary */}
              <div className="card">
                <div className="card-header py-2.5">
                  <div className="flex items-center gap-1.5">
                    <Database size={13} className="text-blue-500" />
                    <span className="font-bold text-slate-700 text-xs">Tabela 1</span>
                  </div>
                  <span className="text-[10px] text-blue-600 font-mono">{payload.sfObjectLabel}</span>
                </div>
                <div className="px-3 pb-3 flex flex-wrap gap-1">
                  {sf1Fields.slice(0, 5).map(f => (
                    <span key={f.name} className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-mono">{f.name}</span>
                  ))}
                  {sf1Fields.length > 5 && <span className="text-slate-400 text-[10px]">+{sf1Fields.length - 5}</span>}
                  <p className="w-full text-[10px] text-slate-400 mt-1">{payload.sfRows.length} registros (filtrados do explorador)</p>
                </div>
              </div>

              {/* T2: second SF object */}
              <div className="card flex flex-col" style={{ maxHeight: 300 }}>
                <div className="card-header py-2.5 flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    <List size={13} className="text-slate-400" />
                    <span className="font-bold text-slate-700 text-xs">Tabela 2 — SF</span>
                  </div>
                  {obj2Status === "ready" && <span className="text-[10px] text-slate-400">{obj2Rows.length} reg.</span>}
                  {obj2Status === "loading" && <RefreshCw size={10} className="animate-spin text-blue-400" />}
                </div>
                <div className="px-2 py-1.5 border-b border-slate-100 flex-shrink-0">
                  <div className="relative">
                    <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="form-input pl-6 py-1 text-xs" placeholder="Filtrar objeto..." value={objectSearch} onChange={e => setObjectSearch(e.target.value)} />
                  </div>
                </div>
                <div className="overflow-y-auto flex-1">
                  {objects.length === 0 && (
                    <div className="flex items-center gap-1.5 p-3 text-xs text-slate-400">
                      <RefreshCw size={11} className="animate-spin" /> Carregando...
                    </div>
                  )}
                  {(objectSearch ? objects.filter(o => o.name.toLowerCase().includes(objectSearch.toLowerCase()) || o.label.toLowerCase().includes(objectSearch.toLowerCase())) : objects).map(obj => {
                    const active = selectedObj2?.name === obj.name;
                    return (
                      <button key={obj.name} onClick={() => loadObj2(obj)}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors group ${active ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${active ? "text-blue-700" : "text-slate-700"}`}>{obj.label}</p>
                          <p className="text-[10px] text-slate-400 truncate font-mono">{obj.name}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {obj2Error && <p className="px-3 py-2 text-xs text-red-500 flex-shrink-0">{obj2Error}</p>}
              </div>

              {/* Join fields */}
              {obj2Status === "ready" && (
                <div className="card">
                  <div className="card-header py-2.5">
                    <div className="flex items-center gap-1.5">
                      <GitMerge size={13} className="text-slate-400" />
                      <span className="font-bold text-slate-700 text-xs">Join</span>
                    </div>
                    {matchCount > 0 && <span className="text-[10px] text-green-600 font-medium">{matchCount} matches</span>}
                  </div>
                  <div className="p-3 space-y-2">
                    <select className="form-input text-xs" value={sfJoinField1} onChange={e => setSfJoinField1(e.target.value)}>
                      <option value="">T1: campo de join...</option>
                      {sf1Fields.map(f => <option key={f.name} value={f.name}>{f.label} ({f.name})</option>)}
                    </select>
                    <div className="text-center text-xs text-slate-400">=</div>
                    <select className="form-input text-xs" value={sfJoinField2} onChange={e => setSfJoinField2(e.target.value)}>
                      <option value="">T2: campo de join...</option>
                      {obj2Fields.map(f => <option key={f.name} value={f.name}>{f.label} ({f.name})</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Destination */}
              <div className="card">
                <div className="card-header py-2.5">
                  <div className="flex items-center gap-1.5">
                    <ArrowRight size={13} className="text-slate-400" />
                    <span className="font-bold text-slate-700 text-xs">Destino no Portal</span>
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  <select className="form-input" value={destTable} onChange={e => setDestTable(e.target.value)}>
                    <option value="">Selecionar tabela...</option>
                    {DESTINATION_TABLES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  {destTable && <p className="text-[10px] text-amber-500">Os dados existentes serão substituídos.</p>}
                </div>
              </div>

              <button
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg disabled:opacity-40"
                style={{ background: "#0078D4" }}
                onClick={() => canPreview && setStep("preview")}
                disabled={!canPreview}
              >
                Pré-visualizar <ArrowRight size={13} />
              </button>
            </div>

            {/* ── Col 2: Column editor ── */}
            {mergedFields.length > 0 && (
              <div className="card flex-shrink-0 flex flex-col" style={{ width: 260 }}>
                <div className="card-header py-2.5 flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Pencil size={13} className="text-slate-400" />
                    <span className="font-bold text-slate-700 text-xs">Colunas</span>
                    <span className="text-[10px] text-slate-400">{includedCols.length}/{colConfigs.length}</span>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setColConfigs(p => p.map(c => ({ ...c, include: true })))} className="text-[10px] text-blue-600 hover:underline">Todas</button>
                    <button onClick={() => setColConfigs(p => p.map(c => ({ ...c, include: false })))} className="text-[10px] text-slate-400 hover:underline">Nenhuma</button>
                  </div>
                </div>

                <div className="px-2 py-1.5 border-b border-slate-100 flex-shrink-0">
                  <div className="relative">
                    <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="form-input pl-6 py-1 text-xs" placeholder="Filtrar coluna..." value={colSearch} onChange={e => setColSearch(e.target.value)} />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                  {filteredColConfigs.map(col => (
                    <div key={col.source || col.outputName} className="px-3 py-2 flex items-start gap-2 group">
                      <button onClick={() => col.source ? updateCol(col.source, { include: !col.include }) : setColConfigs(p => p.map(c => c.outputName === col.outputName && !c.source ? { ...c, include: !c.include } : c))}
                        className="mt-0.5 flex-shrink-0">
                        {col.include
                          ? <Eye size={13} className="text-blue-500" />
                          : <EyeOff size={13} className="text-slate-300" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        {editingCol === (col.source || col.outputName) ? (
                          <input
                            className="form-input py-0.5 text-xs w-full"
                            value={col.outputName}
                            onChange={e => col.source
                              ? updateCol(col.source, { outputName: e.target.value })
                              : setColConfigs(p => p.map(c => c.outputName === col.outputName && !c.source ? { ...c, outputName: e.target.value } : c))
                            }
                            onBlur={() => setEditingCol(null)}
                            autoFocus
                          />
                        ) : (
                          <p className={`text-xs truncate ${col.include ? "text-slate-700" : "text-slate-400"}`}>{col.outputName}</p>
                        )}
                        {col.source && col.source !== col.outputName && (
                          <p className="text-[10px] text-slate-400 font-mono truncate">{col.source}</p>
                        )}
                        {!col.source && (
                          <p className="text-[10px] text-purple-400">constante: &quot;{col.constant}&quot;</p>
                        )}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button onClick={() => setEditingCol(col.source || col.outputName)} title="Renomear">
                          <Pencil size={11} className="text-slate-400 hover:text-slate-600" />
                        </button>
                        {!col.source && (
                          <button onClick={() => removeComputedCol(col.outputName)} title="Remover">
                            <Trash2 size={11} className="text-red-400 hover:text-red-600" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add computed column */}
                <div className="border-t border-slate-100 p-3 space-y-2 flex-shrink-0">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Inserir coluna</p>
                  <input className="form-input text-xs py-1" placeholder="Nome da coluna" value={newColName} onChange={e => setNewColName(e.target.value)} />
                  <input className="form-input text-xs py-1" placeholder="Valor padrão" value={newColValue} onChange={e => setNewColValue(e.target.value)} />
                  <button
                    onClick={addComputedCol}
                    disabled={!newColName.trim()}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-lg disabled:opacity-40"
                    style={{ background: "#7c3aed" }}
                  >
                    <Plus size={12} /> Inserir coluna
                  </button>
                </div>
              </div>
            )}

            {/* ── Col 3: Preview / save ── */}
            <div className="flex-1 min-w-0 flex flex-col gap-3">

              {step === "config" && (
                <div className="card flex-1 flex items-center justify-center text-slate-400 text-sm text-center">
                  {!selectedObj2
                    ? "Selecione a segunda tabela do Salesforce"
                    : obj2Status === "loading"
                    ? <span className="flex items-center gap-2"><RefreshCw size={16} className="animate-spin text-blue-400" /> Carregando {selectedObj2.label}...</span>
                    : mergedFields.length === 0
                    ? "Configure o join para ver as colunas"
                    : !destTable
                    ? "Selecione o destino e clique em Pré-visualizar"
                    : "Clique em Pré-visualizar"}
                </div>
              )}

              {step === "preview" && (
                <div className="card flex flex-col flex-1 overflow-hidden">
                  <div className="card-header py-2.5">
                    <div className="flex items-center gap-2">
                      <GitMerge size={14} className="text-slate-500" />
                      <span className="font-bold text-slate-700 text-sm">Pré-visualização</span>
                      <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        {finalRows.length} reg · {includedCols.length} colunas · {matchCount} matches
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="text-xs text-slate-500 hover:underline" onClick={() => setStep("config")}>
                        ← Editar
                      </button>
                      <div className="relative">
                        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input className="form-input pl-7 py-1 text-xs w-40" placeholder="Filtrar..." value={previewSearch} onChange={e => setPreviewSearch(e.target.value)} />
                      </div>
                      <button
                        className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white rounded-lg disabled:opacity-50"
                        style={{ background: "#16a34a" }}
                        onClick={handleSave}
                        disabled={saving}
                      >
                        {saving ? <><RefreshCw size={12} className="animate-spin" /> Salvando...</> : <><CheckCircle2 size={12} /> Salvar</>}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-auto flex-1">
                    <table className="w-full text-xs" style={{ minWidth: includedCols.length * 140 }}>
                      <thead className="sticky top-0">
                        <tr className="bg-slate-100 border-b border-slate-200">
                          {includedCols.map(col => {
                            const isT1 = !!col.source && sf1Fields.some(f => f.name === col.source);
                            const isComputed = !col.source;
                            return (
                              <th key={col.outputName} className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">
                                <div className="flex items-center gap-1">
                                  <span className={`text-[9px] px-1 py-0.5 rounded font-normal ${isComputed ? "bg-purple-100 text-purple-600" : isT1 ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600"}`}>
                                    {isComputed ? "+" : isT1 ? "T1" : "T2"}
                                  </span>
                                  <span className="font-mono">{col.outputName}</span>
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredPreview.map((row, ri) => (
                          <tr key={ri} className="hover:bg-slate-50">
                            {includedCols.map(col => (
                              <td key={col.outputName} className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-[200px] truncate" title={String(row[col.outputName] ?? "")}>
                                {String(row[col.outputName] ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-400">
                    {filteredPreview.length} de {finalRows.length} · T1 azul · T2 laranja · colunas inseridas roxo
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
