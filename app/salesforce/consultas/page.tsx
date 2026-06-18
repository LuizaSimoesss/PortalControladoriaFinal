"use client";

import { useState, useEffect, useMemo, useCallback, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw, CheckCircle2, AlertCircle,
  Search, List, ChevronRight, Settings2, ArrowRight, Trash2, BookmarkPlus, X, Pencil, Check, Columns2,
  WifiOff, FileDown,
} from "lucide-react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import {
  loadConfig, loadSession, saveSession, clearSession,
  salesforceConnect, salesforceDescribe, salesforceSoql, salesforceNextPage, isSessionExpired,
  DEFAULT_URL_BASE,
  type SalesforceConfig, type SalesforceSession, type SalesforceObject, type SalesforceField,
} from "@/lib/salesforce";
import { setSfTransfer } from "@/lib/sfTransfer";
import { saveQuery, loadQueries, deleteQuery, updateQuery, type SavedQuery } from "@/lib/sfQuerySave";

type ExplorerStatus = "idle" | "loading" | "ready" | "error";

function ColumnFilterCell({
  value, onChange, exact, onToggleExact,
}: {
  value: string;
  onChange: (v: string) => void;
  exact: boolean;
  onToggleExact: () => void;
}) {
  const [inputVal, setInputVal] = useState("");
  const parts = value ? value.split("|").map((v) => v.trim()).filter(Boolean) : [];

  function addPart(v: string) {
    const trimmed = v.trim();
    if (!trimmed || parts.includes(trimmed)) return;
    onChange([...parts, trimmed].join("|"));
    setInputVal("");
  }

  function removePart(p: string) {
    onChange(parts.filter((x) => x !== p).join("|"));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); addPart(inputVal); }
    else if (e.key === "Backspace" && !inputVal && parts.length > 0) removePart(parts[parts.length - 1]);
  }

  return (
    <div className="flex items-start gap-0.5">
      <button
        type="button"
        onClick={onToggleExact}
        title={exact ? "Modo: igual exato — clique para conter" : "Modo: contém — clique para igual exato"}
        className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded text-[10px] font-bold border transition-colors flex items-center justify-center ${exact ? "bg-amber-100 border-amber-400 text-amber-700" : "bg-slate-100 border-slate-200 text-slate-400 hover:border-slate-300"}`}
      >
        {exact ? "=" : "≈"}
      </button>
      <div className="flex flex-wrap gap-0.5 items-center border border-slate-200 rounded bg-slate-50 px-1 py-0.5 min-h-[26px] focus-within:border-blue-300 focus-within:bg-white transition-colors flex-1">
        {parts.map((p) => (
          <span key={p} className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${exact ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
            {p}
            <button type="button" onClick={() => removePart(p)} className="hover:opacity-70 leading-none"><X size={8} /></button>
          </span>
        ))}
        <input
          className="flex-1 bg-transparent text-xs focus:outline-none py-0.5 px-1"
          style={{ minWidth: 50 }}
          placeholder={parts.length === 0 ? "Filtrar..." : "+ valor"}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (inputVal.trim()) addPart(inputVal); }}
        />
      </div>
    </div>
  );
}

const defaultConfig: SalesforceConfig = { clientId: "", clientSecret: "", urlBase: DEFAULT_URL_BASE };

const SEED_KEY = "sf_queries_seeded_v4";

const EXTRA_OPP_FIELDS = ["OpportunityCommittedCapitalBasis__c", "StructuringValue__c", "AdministrationValue__c", "ValueAdvisoryFee__c"];

function seedDefaultQueries() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(SEED_KEY)) return;
  const existing = loadQueries();
  // Patch existing opportunity query with new fields, exact mode and updated stage filter
  const patched = existing.map(q => {
    if (q.id !== "seed_opportunity_v1") return q;
    const missing = EXTRA_OPP_FIELDS.filter(f => !q.selectedFields.includes(f));
    const needsExact = !q.columnFilterModes?.["StageName"];
    const needsStage = q.columnFilters?.["StageName"] !== "Fechado e Ganho";
    if (missing.length === 0 && !needsExact && !needsStage) return q;
    return {
      ...q,
      selectedFields: missing.length > 0 ? [...q.selectedFields, ...missing] : q.selectedFields,
      columnFilters: { ...q.columnFilters, StageName: "Fechado e Ganho" },
      columnFilterModes: { ...q.columnFilterModes, StageName: true },
    };
  });
  try { localStorage.setItem("salesforce_saved_queries_v1", JSON.stringify(patched)); } catch {}
  const existingIds = new Set(patched.map((q) => q.id));
  const toAdd: SavedQuery[] = [];

  if (!existingIds.has("seed_product2_v1")) {
    toAdd.push({
      id: "seed_product2_v1",
      name: "Product2 — Produtos",
      savedAt: new Date().toISOString(),
      sfObject: "Product2",
      sfObjectLabel: "Product2",
      selectedFields: ["Id", "Name", "IsActive", "CreatedDate", "RecordTypeId"],
      columnFilters: { IsActive: "true", RecordTypeId: "012U4000006DrkdIAC" },
      rowCount: 0,
      totalCount: 0,
    });
  }

  if (!existingIds.has("seed_opportunity_v1")) {
    toAdd.push({
      id: "seed_opportunity_v1",
      name: "Oportunidades — Fechadas OwnerApex",
      savedAt: new Date().toISOString(),
      sfObject: "Opportunity",
      sfObjectLabel: "Opportunity",
      selectedFields: ["Id", "IsDeleted", "AccountId", "RecordTypeId", "StageName", "ProductRecordtypeFormula__c", "AmountTotal__c", "CloseDate", "IsPaid__c", "signedContract__c", "Product__c", "OpportunityCommittedCapitalBasis__c", "StructuringValue__c", "AdministrationValue__c", "ValueAdvisoryFee__c"],
      columnFilters: { StageName: "Fechado e Ganho", ProductRecordtypeFormula__c: "OwnerApex" },
      columnFilterModes: { StageName: true },
      rowCount: 0,
      totalCount: 0,
    });
  }

  if (toAdd.length > 0) {
    try { localStorage.setItem("salesforce_saved_queries_v1", JSON.stringify([...toAdd, ...patched])); } catch {}
  }
  localStorage.setItem(SEED_KEY, "1");
}

export default function ConsultasSalesforcePage() {
  const [config, setConfig] = useState<SalesforceConfig>(defaultConfig);
  const [session, setSession] = useState<SalesforceSession | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Objects list
  const [objects, setObjects] = useState<SalesforceObject[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsError, setObjectsError] = useState("");
  const [objectSearch, setObjectSearch] = useState("");
  const [selectedObject, setSelectedObject] = useState<SalesforceObject | null>(null);

  // Explorer state
  const [explorerStatus, setExplorerStatus] = useState<ExplorerStatus>("idle");
  const [explorerError, setExplorerError] = useState("");
  const [explorerLoadingMsg, setExplorerLoadingMsg] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const abortRef = useRef(false);
  const explorerRef = useRef<HTMLDivElement>(null);
  const [allFields, setAllFields] = useState<SalesforceField[]>([]);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [columnFilterModes, setColumnFilterModes] = useState<Record<string, boolean>>({});
  const [fieldSearch, setFieldSearch] = useState("");
  const [tableColumnSearch, setTableColumnSearch] = useState("");

  // Saved queries
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveQueryName, setSaveQueryName] = useState("");
  const [showSavedPanel, setShowSavedPanel] = useState(true);
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null);
  const [editingQueryId, setEditingQueryId] = useState<string | null>(null);
  const [editingQueryName, setEditingQueryName] = useState("");
  const [updatedQueryId, setUpdatedQueryId] = useState<string | null>(null);
  const [editingColumnsId, setEditingColumnsId] = useState<string | null>(null);
  const [editingColumnsSet, setEditingColumnsSet] = useState<Set<string>>(new Set());
  const [editingColumnsSearch, setEditingColumnsSearch] = useState("");
  const [editingColumnsTab, setEditingColumnsTab] = useState<"all" | "selected" | "unselected">("all");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [columnPickerSearch, setColumnPickerSearch] = useState("");
  const [columnPickerTab, setColumnPickerTab] = useState<"all" | "selected" | "unselected">("all");
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableContainerH, setTableContainerH] = useState(600);
  const [, startTransition] = useTransition();
  const [rowLimit, setRowLimit] = useState<number | null>(100);

  useEffect(() => {
    const cfg = loadConfig();
    if (cfg) setConfig(cfg);
    const sess = loadSession();
    if (sess) {
      if (isSessionExpired(sess)) clearSession();
      else { setSession(sess); setIsConnected(true); }
    }
    seedDefaultQueries();
    setSavedQueries(loadQueries());
    const refresh = () => setSavedQueries(loadQueries());
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    if (isConnected && session && objects.length === 0) loadObjects(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  async function ensureSession(sess: SalesforceSession): Promise<SalesforceSession> {
    if (isSessionExpired(sess)) {
      const newSess = await salesforceConnect(config);
      saveSession(newSess);
      setSession(newSess);
      return newSess;
    }
    return sess;
  }

  async function withAutoRefresh<T>(fn: (sess: SalesforceSession) => Promise<T>): Promise<T> {
    if (!session) throw new Error("Não conectado. Configure o Salesforce primeiro.");
    try {
      const sess = await ensureSession(session);
      return await fn(sess);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "TOKEN_EXPIRED") {
        const newSess = await salesforceConnect(config);
        saveSession(newSess);
        setSession(newSess);
        return await fn(newSess);
      }
      throw err;
    }
  }

  function resetExplorer() {
    setSelectedObject(null);
    setExplorerStatus("idle");
    setExplorerError("");
    setExplorerLoadingMsg("");
    setLoadingMore(false);
    setAllFields([]);
    setSelectedFields(new Set());
    setRows([]);
    setTotalSize(0);
    setColumnFilters({});
    setColumnFilterModes({});
    setFieldSearch("");
    setTableColumnSearch("");
  }

  async function loadObjects(sess: SalesforceSession) {
    setObjectsLoading(true);
    setObjectsError("");
    try {
      const { salesforceListObjects } = await import("@/lib/salesforce");
      const list = await salesforceListObjects(config, sess);
      setObjects(list);
    } catch (err: unknown) {
      setObjectsError(err instanceof Error ? err.message : "Erro ao carregar objetos");
    } finally {
      setObjectsLoading(false);
    }
  }

  const loadExplorer = useCallback(async (
    obj: SalesforceObject,
    restore?: { fields: string[]; filters: Record<string, string> },
    limitOverride?: number | null
  ) => {
    const limit = limitOverride !== undefined ? limitOverride : rowLimit;
    abortRef.current = true;
    await new Promise((r) => setTimeout(r, 0));
    abortRef.current = false;

    setSelectedObject(obj);
    setExplorerStatus("loading");
    setExplorerError("");
    setExplorerLoadingMsg("Buscando estrutura de campos...");
    setLoadingMore(false);
    setAllFields([]);
    setSelectedFields(new Set());
    setRows([]);
    setTotalSize(0);
    setColumnFilters({});
    setColumnFilterModes({});
    setFieldSearch("");
    setTableColumnSearch("");

    try {
      await withAutoRefresh(async (sess) => {
        const { fields } = await salesforceDescribe(config, sess, obj.name);
        if (abortRef.current) return;
        setAllFields(fields);
        if (restore) {
          const valid = new Set(fields.map((f) => f.name));
          setSelectedFields(new Set(restore.fields.filter((f) => valid.has(f))));
        } else {
          setSelectedFields(new Set(fields.map((f) => f.name)));
        }

        setExplorerLoadingMsg("Carregando registros...");
        let queryableFields = [...fields];
        let firstPage;
        const limitClause = limit !== null ? ` LIMIT ${limit}` : "";
        for (let attempt = 0; attempt < 30; attempt++) {
          try {
            const fieldList = queryableFields.map((f) => f.name).join(", ");
            firstPage = await salesforceSoql(config, sess, `SELECT ${fieldList} FROM ${obj.name}${limitClause}`);
            break;
          } catch (soqlErr) {
            const errMsg = soqlErr instanceof Error ? soqlErr.message : "";
            const badField =
              errMsg.match(/No such column '([^']+)'/i)?.[1] ||
              errMsg.match(/INVALID_FIELD[^']*'([^']+)'/i)?.[1] ||
              errMsg.match(/invalid field[^:]*:\s*(\S+)/i)?.[1];
            if (!badField) throw soqlErr;
            queryableFields = queryableFields.filter((f) => f.name !== badField);
            if (attempt === 0) setExplorerLoadingMsg("Filtrando campos incompatíveis...");
          }
        }
        if (!firstPage) throw new Error("Não foi possível carregar dados: muitos campos inválidos.");
        if (queryableFields.length !== fields.length) {
          setAllFields(queryableFields);
          if (restore) {
            const valid = new Set(queryableFields.map((f) => f.name));
            setSelectedFields(new Set(restore.fields.filter((f) => valid.has(f))));
          } else {
            setSelectedFields(new Set(queryableFields.map((f) => f.name)));
          }
        }

        let allRecords = [...firstPage.records];
        const total = firstPage.totalSize;
        if (limit === null && !firstPage.done && firstPage.nextRecordsUrl) {
          let nextUrl: string | null = firstPage.nextRecordsUrl;
          while (nextUrl && !abortRef.current) {
            setExplorerLoadingMsg(`Carregando... ${allRecords.length} de ${total} registros`);
            const page = await salesforceNextPage(config, sess, nextUrl);
            allRecords = [...allRecords, ...page.records];
            nextUrl = page.nextRecordsUrl ?? null;
          }
        }
        if (abortRef.current) return;
        setRows(allRecords);
        setTotalSize(total);
        setExplorerStatus("ready");
        if (restore) setColumnFilters(restore.filters);
      });
    } catch (err: unknown) {
      if (abortRef.current) return;
      setExplorerError(err instanceof Error ? err.message : "Erro ao carregar dados");
      setExplorerStatus("error");
      setLoadingMore(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, session, rowLimit]);

  function toggleField(name: string) {
    startTransition(() => {
      setSelectedFields((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    });
  }

  function toggleAllFields() {
    if (selectedFields.size === allFields.length) setSelectedFields(new Set());
    else setSelectedFields(new Set(allFields.map((f) => f.name)));
  }

  function selectAllFields() {
    setSelectedFields(new Set(allFields.map((f) => f.name)));
  }

  const visibleFields = useMemo(() => {
    const selected = allFields.filter((f) => selectedFields.has(f.name));
    if (!tableColumnSearch.trim()) return selected;
    const q = tableColumnSearch.toLowerCase();
    return selected.filter((f) => f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q));
  }, [allFields, selectedFields, tableColumnSearch]);

  const filteredFields = useMemo(() => {
    if (!fieldSearch.trim()) return allFields;
    const q = fieldSearch.toLowerCase();
    return allFields.filter((f) => f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q));
  }, [allFields, fieldSearch]);

  const filteredColumnPickerFields = useMemo(() => {
    const byTab = columnPickerTab === "selected"
      ? allFields.filter((f) => selectedFields.has(f.name))
      : columnPickerTab === "unselected"
      ? allFields.filter((f) => !selectedFields.has(f.name))
      : allFields;
    if (!columnPickerSearch.trim()) return byTab;
    const q = columnPickerSearch.toLowerCase();
    return byTab.filter((f) => f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q));
  }, [allFields, selectedFields, columnPickerSearch, columnPickerTab]);

  useEffect(() => {
    if (!showColumnPicker) return;
    function handleClick(e: MouseEvent) {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
        setShowColumnPicker(false);
        setColumnPickerSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showColumnPicker]);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    setTableContainerH(el.clientHeight);
    const onScroll = () => setTableScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => setTableContainerH(el.clientHeight));
    ro.observe(el);
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); };
  }, [explorerStatus]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) =>
      Object.entries(columnFilters).every(([col, val]) => {
        if (!val.trim()) return true;
        const cell = String(row[col] ?? "").toLowerCase();
        const parts = val.split("|").map((v) => v.trim()).filter(Boolean);
        const exact = !!columnFilterModes[col];
        return exact
          ? parts.some((p) => cell === p.toLowerCase())
          : parts.some((p) => cell.includes(p.toLowerCase()));
      })
    );
  }, [rows, columnFilters, columnFilterModes]);

  const ROW_HEIGHT = 33;
  const VIRT_BUFFER = 8;
  const virtStart = Math.max(0, Math.floor(tableScrollTop / ROW_HEIGHT) - VIRT_BUFFER);
  const virtEnd = Math.min(filteredRows.length, virtStart + Math.ceil(tableContainerH / ROW_HEIGHT) + VIRT_BUFFER * 2);
  const virtualRows = filteredRows.slice(virtStart, virtEnd);
  const topPad = virtStart * ROW_HEIGHT;
  const bottomPad = (filteredRows.length - virtEnd) * ROW_HEIGHT;

  const filteredObjects = useMemo(() => {
    if (!objectSearch.trim()) return objects;
    const q = objectSearch.toLowerCase();
    return objects.filter((o) => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q));
  }, [objects, objectSearch]);

  const router = useRouter();

  function handleDeleteSavedQuery(id: string) {
    deleteQuery(id);
    setSavedQueries(loadQueries());
  }

  function handleStartRename(q: SavedQuery) {
    setEditingQueryId(q.id);
    setEditingQueryName(q.name);
  }

  function handleConfirmRename(id: string) {
    const name = editingQueryName.trim();
    if (name) { updateQuery(id, { name }); setSavedQueries(loadQueries()); }
    setEditingQueryId(null);
    setEditingQueryName("");
  }

  function handleStartEditColumns(q: SavedQuery) {
    setEditingColumnsId(q.id);
    setEditingColumnsSet(new Set(q.selectedFields));
    setEditingColumnsSearch("");
    setEditingColumnsTab("all");
  }

  function handleSaveColumnEdit(id: string) {
    const newFields = Array.from(editingColumnsSet);
    updateQuery(id, { selectedFields: newFields });
    setSavedQueries(loadQueries());
    setEditingColumnsId(null);
    setEditingColumnsSet(new Set());
    setEditingColumnsSearch("");
    setEditingColumnsTab("all");
    const q = loadQueries().find((x) => x.id === id);
    if (q && explorerStatus === "ready" && selectedObject?.name === q.sfObject) {
      const valid = new Set(allFields.map((f) => f.name));
      setSelectedFields(new Set(newFields.filter((f) => valid.has(f))));
    }
  }

  function handleUpdateQueryContent(id: string) {
    if (!selectedObject || explorerStatus !== "ready") return;
    updateQuery(id, {
      sfObject: selectedObject.name,
      sfObjectLabel: selectedObject.label,
      selectedFields: Array.from(selectedFields),
      columnFilters,
      rowCount: filteredRows.length,
      totalCount: totalSize,
    });
    setSavedQueries(loadQueries());
    setUpdatedQueryId(id);
    setTimeout(() => setUpdatedQueryId(null), 2000);
  }

  function handleSaveQuery() {
    if (!selectedObject || explorerStatus !== "ready") return;
    const name = saveQueryName.trim() || `${selectedObject.label} — ${new Date().toLocaleString("pt-BR")}`;
    const entry = saveQuery({
      name,
      sfObject: selectedObject.name,
      sfObjectLabel: selectedObject.label,
      selectedFields: Array.from(selectedFields),
      columnFilters,
      rowCount: filteredRows.length,
      totalCount: totalSize,
    });
    setSavedQueries([entry, ...loadQueries().filter((x) => x.id !== entry.id)].slice(0, 50));
    setShowSaveModal(false);
    setSaveQueryName("");
  }

  async function handleRestoreQuery(q: SavedQuery) {
    const obj = objects.find((o) => o.name === q.sfObject);
    if (!obj) return;
    explorerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    await loadExplorer(obj, { fields: q.selectedFields, filters: q.columnFilters });
  }

  function handleDirecionar() {
    if (!selectedObject || explorerStatus !== "ready" || !session) return;
    setSfTransfer({
      sfObject: selectedObject.name,
      sfObjectLabel: selectedObject.label,
      sfFields: Array.from(selectedFields),
      sfAllFields: allFields,
      sfRows: filteredRows,
      sfTotalSize: totalSize,
      sfConfig: config,
      sfSession: session,
    });
    router.push("/configuracoes/salesforce/direcionar");
  }

  function handleExportExcel() {
    if (!filteredRows.length || !visibleFields.length) return;
    const sep = ";";
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return s.includes(sep) || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const header = visibleFields.map((f) => escape(f.label || f.name)).join(sep);
    const body = filteredRows
      .map((row) => visibleFields.map((f) => escape(row[f.name])).join(sep))
      .join("\n");
    const csv = "﻿" + header + "\n" + body; // BOM para Excel reconhecer UTF-8
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedObject?.name ?? "consulta"}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Salesforce › Consultas"
        subtitle="Explorador de dados e consultas salvas"
      />

      <div className="p-6 space-y-6 min-w-max">

        {/* Not connected warning */}
        {!isConnected && (
          <div className="flex items-center gap-3 p-4 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 max-w-2xl">
            <WifiOff size={18} />
            <div className="flex-1">
              <strong>Salesforce não conectado.</strong>
              <span className="text-sm ml-2">Configure as credenciais e conecte primeiro.</span>
            </div>
            <Link href="/configuracoes/salesforce" className="text-sm font-medium underline">
              Configurar
            </Link>
          </div>
        )}

        {/* Action buttons */}
        {explorerStatus === "ready" && (
          <div className="flex gap-3 max-w-2xl flex-wrap">
            <button
              onClick={() => setShowSaveModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-500 hover:bg-indigo-600 transition-colors"
            >
              <BookmarkPlus size={14} /> Salvar consulta
            </button>
            <button
              onClick={handleExportExcel}
              disabled={filteredRows.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 transition-colors"
            >
              <FileDown size={14} /> Exportar Excel
              <span className="text-xs font-normal opacity-75">({filteredRows.length} reg · {visibleFields.length} col)</span>
            </button>
            <button
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg"
              style={{ background: "#0078D4" }}
              onClick={handleDirecionar}
            >
              Direcionar dados <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* Saved Queries Panel */}
        {savedQueries.length > 0 && (
          <div className="card max-w-4xl">
            <div className="card-header cursor-pointer select-none" onClick={() => setShowSavedPanel((v) => !v)}>
              <div className="flex items-center gap-2">
                <BookmarkPlus size={15} className="text-indigo-400" />
                <span className="font-bold text-slate-700 text-sm">Consultas salvas</span>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{savedQueries.length}</span>
              </div>
              <ChevronRight size={15} className={`text-slate-400 transition-transform ${showSavedPanel ? "rotate-90" : ""}`} />
            </div>

            {showSavedPanel && (
              <div className="divide-y divide-slate-100">
                {savedQueries.map((q, idx) => {
                  const isOpen = expandedQuery === q.id;
                  const activeFilters = Object.entries(q.columnFilters).filter(([, v]) => v.trim());
                  return (
                    <div key={q.id}>
                      <div className={`flex items-center gap-3 px-5 py-3 transition-colors ${isOpen ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                        <button
                          className="flex items-center gap-3 flex-1 min-w-0 text-left"
                          onClick={() => { if (editingQueryId !== q.id) setExpandedQuery(isOpen ? null : q.id); }}
                        >
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 text-[10px] font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            {editingQueryId === q.id ? (
                              <input
                                className="text-sm font-medium border border-indigo-300 rounded px-2 py-0.5 w-full max-w-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                                value={editingQueryName}
                                onChange={(e) => setEditingQueryName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleConfirmRename(q.id);
                                  if (e.key === "Escape") { setEditingQueryId(null); setEditingQueryName(""); }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                              />
                            ) : (
                              <span className={`text-sm font-medium ${isOpen ? "text-indigo-700" : "text-slate-700"}`}>{q.name}</span>
                            )}
                            <span className="ml-2 text-[10px] text-slate-400 font-mono">{q.sfObjectLabel}</span>
                          </div>
                        </button>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {activeFilters.length > 0 && (
                            <span className="text-[10px] font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                              {activeFilters.length} filtro{activeFilters.length > 1 ? "s" : ""}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400">{new Date(q.savedAt).toLocaleDateString("pt-BR")}</span>
                          {editingQueryId === q.id ? (
                            <button onClick={(e) => { e.stopPropagation(); handleConfirmRename(q.id); }} className="p-1 text-green-500 hover:text-green-700">
                              <Check size={13} />
                            </button>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); handleStartRename(q); }} className="p-1 text-slate-300 hover:text-indigo-500 transition-colors">
                              <Pencil size={12} />
                            </button>
                          )}
                          <ChevronRight
                            size={13}
                            className={`text-slate-400 transition-transform cursor-pointer ${isOpen ? "rotate-90" : ""}`}
                            onClick={() => setExpandedQuery(isOpen ? null : q.id)}
                          />
                        </div>
                      </div>

                      {isOpen && (
                        <div className="px-5 pb-4 pt-1 bg-indigo-50 border-t border-indigo-100">
                          <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                            <div>
                              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Objeto</p>
                              <span className="font-medium text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded font-mono">{q.sfObject}</span>
                              <span className="ml-2 text-slate-500">{q.sfObjectLabel}</span>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Registros</p>
                              <span className="text-slate-700">{q.rowCount} filtrados de {q.totalCount} totais</span>
                            </div>
                            <div className="col-span-2">
                              <div className="flex items-center justify-between mb-1.5">
                                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                                  Colunas selecionadas ({editingColumnsId === q.id ? editingColumnsSet.size : q.selectedFields.length})
                                </p>
                                {editingColumnsId !== q.id ? (
                                  <button onClick={() => handleStartEditColumns(q)} className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-700 font-medium">
                                    <Pencil size={10} /> Editar colunas
                                  </button>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => handleSaveColumnEdit(q.id)} className="flex items-center gap-1 text-[10px] text-white bg-indigo-500 hover:bg-indigo-600 px-2 py-0.5 rounded font-medium">
                                      <Check size={10} /> Salvar
                                    </button>
                                    <button onClick={() => { setEditingColumnsId(null); setEditingColumnsSet(new Set()); setEditingColumnsSearch(""); }} className="text-[10px] text-slate-400 hover:text-slate-600">
                                      Cancelar
                                    </button>
                                  </div>
                                )}
                              </div>

                              {editingColumnsId !== q.id ? (
                                <div className="flex flex-wrap gap-1">
                                  {q.selectedFields.slice(0, 12).map((f) => (
                                    <span key={f} className="text-[10px] bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-mono">{f}</span>
                                  ))}
                                  {q.selectedFields.length > 12 && (
                                    <span className="text-[10px] text-slate-400">+{q.selectedFields.length - 12} mais</span>
                                  )}
                                </div>
                              ) : (() => {
                                const objectLoaded = explorerStatus === "ready" && selectedObject?.name === q.sfObject;
                                const baseList = objectLoaded
                                  ? allFields
                                  : q.selectedFields.map((name) => ({ name, label: name, type: "" }));

                                const byTab = editingColumnsTab === "selected"
                                  ? baseList.filter((f) => editingColumnsSet.has(f.name))
                                  : editingColumnsTab === "unselected"
                                  ? baseList.filter((f) => !editingColumnsSet.has(f.name))
                                  : baseList;

                                const filtered = editingColumnsSearch.trim()
                                  ? byTab.filter((f) => f.name.toLowerCase().includes(editingColumnsSearch.toLowerCase()) || f.label.toLowerCase().includes(editingColumnsSearch.toLowerCase()))
                                  : byTab;

                                const unselectedCount = baseList.filter((f) => !editingColumnsSet.has(f.name)).length;

                                return (
                                  <div className="bg-white border border-indigo-200 rounded-lg overflow-hidden">
                                    {!objectLoaded && (
                                      <p className="text-[10px] text-amber-600 bg-amber-50 px-3 py-1.5 border-b border-amber-100">
                                        Restaure o objeto no explorer para ver e adicionar todas as colunas disponíveis.
                                      </p>
                                    )}
                                    <div className="flex border-b border-slate-100">
                                      {(["all", "selected", "unselected"] as const).map((tab) => {
                                        const labels: Record<string, string> = {
                                          all: `Todas (${baseList.length})`,
                                          selected: `Selecionadas (${editingColumnsSet.size})`,
                                          unselected: `Não selecionadas (${unselectedCount})`,
                                        };
                                        return (
                                          <button
                                            key={tab}
                                            onClick={() => setEditingColumnsTab(tab)}
                                            className={`flex-1 px-2 py-1.5 text-[10px] font-medium transition-colors ${editingColumnsTab === tab ? "text-indigo-600 border-b-2 border-indigo-500 bg-indigo-50" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"}`}
                                          >
                                            {labels[tab]}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <div className="px-2 py-1.5 border-b border-slate-100">
                                      <div className="relative">
                                        <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300" />
                                        <input
                                          className="w-full pl-5 pr-2 py-1 text-[10px] border border-slate-200 rounded bg-slate-50 focus:outline-none focus:border-indigo-300"
                                          placeholder="Filtrar coluna..."
                                          value={editingColumnsSearch}
                                          onChange={(e) => setEditingColumnsSearch(e.target.value)}
                                        />
                                      </div>
                                    </div>
                                    {objectLoaded && editingColumnsTab === "all" && (
                                      <button
                                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50 border-b border-slate-100"
                                        onClick={() => {
                                          if (editingColumnsSet.size === allFields.length) setEditingColumnsSet(new Set());
                                          else setEditingColumnsSet(new Set(allFields.map((f) => f.name)));
                                        }}
                                      >
                                        <span className={`w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center ${editingColumnsSet.size === allFields.length ? "bg-indigo-500 border-indigo-500" : "border-slate-300 bg-white"}`}>
                                          {editingColumnsSet.size === allFields.length && <span className="text-white text-[8px] leading-none">✓</span>}
                                        </span>
                                        <span className="text-[10px] font-semibold text-slate-500">
                                          {editingColumnsSet.size === allFields.length ? "Desmarcar todas" : "Selecionar todas"}
                                        </span>
                                      </button>
                                    )}
                                    <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
                                      {filtered.map((f) => {
                                        const checked = editingColumnsSet.has(f.name);
                                        return (
                                          <button
                                            key={f.name}
                                            onClick={() => setEditingColumnsSet((prev) => {
                                              const next = new Set(prev);
                                              if (next.has(f.name)) next.delete(f.name);
                                              else next.add(f.name);
                                              return next;
                                            })}
                                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${checked ? "bg-indigo-50" : "hover:bg-slate-50"}`}
                                          >
                                            <span className={`w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center ${checked ? "bg-indigo-500 border-indigo-500" : "border-slate-300 bg-white"}`}>
                                              {checked && <span className="text-white text-[8px] leading-none">✓</span>}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                              <p className={`text-[10px] truncate ${checked ? "text-indigo-700 font-medium" : "text-slate-500"}`}>{f.label !== f.name && f.label ? f.label : f.name}</p>
                                              {f.label !== f.name && f.label && <p className="text-[9px] text-slate-400 font-mono truncate">{f.name}</p>}
                                            </div>
                                          </button>
                                        );
                                      })}
                                      {filtered.length === 0 && (
                                        <p className="px-3 py-3 text-[10px] text-slate-400 text-center">Nenhuma coluna encontrada.</p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                            {activeFilters.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Filtros de coluna</p>
                                <div className="space-y-0.5">
                                  {activeFilters.map(([col, val]) => (
                                    <div key={col} className="flex items-center gap-1 text-[10px]">
                                      <span className="font-mono text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded">{col}</span>
                                      <span className="text-slate-400">contém</span>
                                      <span className="font-medium text-slate-600">&ldquo;{val}&rdquo;</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 pt-2 border-t border-indigo-100 flex-wrap">
                            <button
                              onClick={() => handleRestoreQuery(q)}
                              disabled={!isConnected}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg disabled:opacity-40 transition-colors"
                            >
                              <RefreshCw size={11} /> Restaurar consulta
                            </button>
                            <button
                              onClick={() => router.push(`/relatorios/subscricao?a=${q.id}`)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                            >
                              <ArrowRight size={11} /> Usar em Subscrição
                            </button>
                            {(() => {
                              const canUpdate = explorerStatus === "ready" && selectedObject?.name === q.sfObject;
                              const isUpdated = updatedQueryId === q.id;
                              return (
                                <button
                                  onClick={() => canUpdate && handleUpdateQueryContent(q.id)}
                                  disabled={!canUpdate}
                                  title={canUpdate ? "Substituir campos e filtros salvos pelo estado atual do explorer" : `Restaure "${q.name}" no explorador primeiro`}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${
                                    isUpdated
                                      ? "text-green-700 bg-green-50 border-green-300"
                                      : canUpdate
                                      ? "text-indigo-600 bg-white border-indigo-300 hover:bg-indigo-50"
                                      : "text-slate-400 bg-slate-50 border-slate-200 cursor-not-allowed"
                                  }`}
                                >
                                  {isUpdated ? <><CheckCircle2 size={11} /> Atualizado!</> : <><Check size={11} /> Atualizar com estado atual</>}
                                </button>
                              );
                            })()}
                            <span className="text-[10px] text-slate-400 flex-1">Salva em {new Date(q.savedAt).toLocaleString("pt-BR")}</span>
                            <button onClick={() => handleDeleteSavedQuery(q.id)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 size={11} /> Excluir
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Explorer */}
        {isConnected && (
          <div ref={explorerRef} className="flex gap-4" style={{ minHeight: 520 }}>

            {/* Left panel */}
            <div className="card flex-shrink-0 flex flex-col" style={{ width: 260 }}>
              <div className="card-header py-2.5 flex-shrink-0">
                <div className="flex items-center gap-1.5">
                  <List size={13} className="text-slate-400" />
                  <span className="font-bold text-slate-700 text-xs">Objetos</span>
                  {objects.length > 0 && <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{objects.length}</span>}
                </div>
                <button className="text-[10px] text-blue-600 hover:underline flex items-center gap-1" onClick={() => session && loadObjects(session)} disabled={objectsLoading}>
                  <RefreshCw size={9} className={objectsLoading ? "animate-spin" : ""} />
                </button>
              </div>
              <div className="px-2 py-1.5 border-b border-slate-100 flex-shrink-0">
                <div className="relative">
                  <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="form-input pl-6 py-1 text-xs" placeholder="Filtrar objeto..." value={objectSearch} onChange={(e) => setObjectSearch(e.target.value)} />
                </div>
              </div>
              {objectsLoading && objects.length === 0 && (
                <div className="flex items-center gap-1.5 p-4 text-xs text-slate-400 flex-shrink-0">
                  <RefreshCw size={11} className="animate-spin" /> Carregando...
                </div>
              )}
              {objectsError && <p className="text-xs text-red-500 p-3 flex-shrink-0">{objectsError}</p>}

              <div className="overflow-y-auto border-b border-slate-100" style={{ maxHeight: 220 }}>
                {filteredObjects.map((obj) => {
                  const active = selectedObject?.name === obj.name;
                  return (
                    <button
                      key={obj.name}
                      onClick={() => loadExplorer(obj)}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 text-left transition-colors group ${active ? "bg-blue-50" : "hover:bg-slate-50"}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium truncate ${active ? "text-blue-700" : "text-slate-700"}`}>{obj.label}</p>
                        <p className="text-[10px] text-slate-400 truncate font-mono">{obj.name}</p>
                      </div>
                      <ChevronRight size={11} className={`flex-shrink-0 ${active ? "text-blue-400" : "text-slate-200 group-hover:text-slate-400"}`} />
                    </button>
                  );
                })}
                {filteredObjects.length === 0 && objectSearch && (
                  <p className="px-3 py-4 text-xs text-slate-400 text-center">Nenhum resultado.</p>
                )}
              </div>

              {explorerStatus === "ready" && (
                <>
                  <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Settings2 size={12} className="text-slate-400" />
                      <span className="text-xs font-semibold text-slate-600">Colunas</span>
                      <span className="text-[10px] text-slate-400">{selectedFields.size}/{allFields.length}</span>
                    </div>
                    <button onClick={toggleAllFields} className="text-[10px] text-blue-600 hover:underline">
                      {selectedFields.size === allFields.length ? "Desmarcar" : "Todas"}
                    </button>
                  </div>
                  <div className="px-2 py-1.5 border-b border-slate-100 flex-shrink-0">
                    <div className="relative">
                      <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input className="form-input pl-6 py-1 text-xs" placeholder="Filtrar coluna..." value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {filteredFields.map((f) => {
                      const checked = selectedFields.has(f.name);
                      return (
                        <button
                          key={f.name}
                          onClick={() => toggleField(f.name)}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${checked ? "bg-blue-50" : "hover:bg-slate-50"}`}
                        >
                          <span className={`w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center ${checked ? "bg-blue-500 border-blue-500" : "border-slate-300 bg-white"}`}>
                            {checked && <span className="text-white text-[8px] leading-none">✓</span>}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs truncate ${checked ? "text-blue-700 font-medium" : "text-slate-500"}`}>{f.label}</p>
                            <p className="text-[10px] text-slate-400 truncate font-mono">{f.name}</p>
                          </div>
                        </button>
                      );
                    })}
                    {filteredFields.length === 0 && fieldSearch && (
                      <p className="px-3 py-4 text-xs text-slate-400 text-center">Nenhuma coluna encontrada.</p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Main explorer area */}
            <div className="flex-1 flex flex-col gap-4 min-w-0">
              {explorerStatus === "idle" && (
                <div className="card flex-1 flex items-center justify-center text-slate-400 text-sm">
                  Selecione um objeto na lista para explorar os dados
                </div>
              )}
              {explorerStatus === "loading" && (
                <div className="card flex-1 flex flex-col items-center justify-center gap-3 text-slate-500 text-sm">
                  <RefreshCw size={22} className="animate-spin text-blue-400" />
                  <div className="text-center">
                    <p className="font-medium">{selectedObject?.label}</p>
                    <p className="text-xs text-slate-400 mt-1">{explorerLoadingMsg}</p>
                  </div>
                </div>
              )}
              {explorerStatus === "error" && (
                <div className="card flex-1 flex items-center justify-center p-8">
                  <div className="flex items-start gap-3 max-w-md">
                    <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-700">Erro ao carregar objeto</p>
                      <p className="text-xs text-red-500 mt-1">{explorerError}</p>
                    </div>
                  </div>
                </div>
              )}

              {explorerStatus === "ready" && (
                <>
                  {/* Toolbar */}
                  <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-2.5 flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-700 text-sm">{selectedObject?.label}</span>
                      <span className="text-xs text-slate-400 font-mono">{selectedObject?.name}</span>
                    </div>
                    <div className="relative flex-1" style={{ minWidth: 180, maxWidth: 280 }}>
                      <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        className="w-full pl-7 pr-7 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:border-blue-300 focus:bg-white transition-colors"
                        placeholder="Buscar coluna na tabela..."
                        value={tableColumnSearch}
                        onChange={(e) => setTableColumnSearch(e.target.value)}
                      />
                      {tableColumnSearch && (
                        <button className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setTableColumnSearch("")}>
                          <X size={11} />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {tableColumnSearch ? `${visibleFields.length} col · ` : ""}{filteredRows.length} / {totalSize} reg
                      </span>
                      <button
                        onClick={handleExportExcel}
                        disabled={filteredRows.length === 0}
                        title={`Exportar ${filteredRows.length} registros · ${visibleFields.length} colunas visíveis`}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 transition-colors whitespace-nowrap"
                      >
                        <FileDown size={13} /> Exportar Excel
                      </button>
                      {selectedFields.size < allFields.length && (
                        <button
                          onClick={selectAllFields}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-colors whitespace-nowrap"
                        >
                          Todas as colunas
                        </button>
                      )}
                      <div className="relative" ref={columnPickerRef}>
                        <button
                          onClick={() => { setShowColumnPicker((v) => !v); setColumnPickerSearch(""); setColumnPickerTab("all"); }}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${showColumnPicker ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}
                        >
                          <Columns2 size={13} /> Colunas <span className="text-[10px] text-slate-400">({selectedFields.size}/{allFields.length})</span>
                        </button>
                        {showColumnPicker && (
                          <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg flex flex-col" style={{ width: 280, maxHeight: 460 }}>
                            <div className="flex border-b border-slate-100 flex-shrink-0">
                              {(["all", "selected", "unselected"] as const).map((tab) => {
                                const unselCount = allFields.length - selectedFields.size;
                                const labels: Record<string, string> = {
                                  all: `Todas (${allFields.length})`,
                                  selected: `Visíveis (${selectedFields.size})`,
                                  unselected: `Ocultas (${unselCount})`,
                                };
                                return (
                                  <button
                                    key={tab}
                                    onClick={() => setColumnPickerTab(tab)}
                                    className={`flex-1 px-2 py-2 text-[10px] font-medium transition-colors ${columnPickerTab === tab ? "text-blue-600 border-b-2 border-blue-500 bg-blue-50" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"}`}
                                  >
                                    {labels[tab]}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="px-2 py-1.5 border-b border-slate-100 flex items-center gap-1.5 flex-shrink-0">
                              <div className="relative flex-1">
                                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                  autoFocus
                                  className="w-full pl-6 pr-2 py-1 text-xs border border-slate-200 rounded bg-slate-50 focus:outline-none focus:border-blue-300"
                                  placeholder="Filtrar coluna..."
                                  value={columnPickerSearch}
                                  onChange={(e) => setColumnPickerSearch(e.target.value)}
                                />
                              </div>
                              {columnPickerTab === "all" && (
                                <button onClick={() => { startTransition(() => { if (selectedFields.size === allFields.length) setSelectedFields(new Set()); else setSelectedFields(new Set(allFields.map((f) => f.name))); }); }} className="text-[10px] text-blue-600 hover:underline whitespace-nowrap">
                                  {selectedFields.size === allFields.length ? "Desmarcar" : "Todas"}
                                </button>
                              )}
                            </div>
                            <div className="overflow-y-auto flex-1">
                              {filteredColumnPickerFields.map((f) => {
                                const checked = selectedFields.has(f.name);
                                return (
                                  <button
                                    key={f.name}
                                    onClick={() => toggleField(f.name)}
                                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${checked ? "bg-blue-50" : "hover:bg-slate-50"}`}
                                  >
                                    <span className={`w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center ${checked ? "bg-blue-500 border-blue-500" : "border-slate-300 bg-white"}`}>
                                      {checked && <span className="text-white text-[8px] leading-none">✓</span>}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-xs truncate ${checked ? "text-blue-700 font-medium" : "text-slate-500"}`}>{f.label}</p>
                                      <p className="text-[10px] text-slate-400 truncate font-mono">{f.name}</p>
                                    </div>
                                  </button>
                                );
                              })}
                              {filteredColumnPickerFields.length === 0 && (
                                <p className="px-3 py-4 text-xs text-slate-400 text-center">Nenhuma coluna encontrada.</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Data table */}
                  <div className="card flex-1 flex flex-col">
                    <div className="overflow-auto flex-1" ref={tableScrollRef}>
                      <table className="w-full text-xs" style={{ minWidth: visibleFields.length * 140 }}>
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-slate-100 border-b border-slate-200">
                            {visibleFields.map((f) => (
                              <th key={f.name} className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">
                                <div>{f.label}</div>
                                <div className="text-[10px] font-normal text-slate-400 font-mono">{f.name}</div>
                              </th>
                            ))}
                          </tr>
                          <tr className="bg-white border-b border-slate-100">
                            {visibleFields.map((f) => (
                              <th key={f.name} className="px-2 py-1.5">
                                <ColumnFilterCell
                                  value={columnFilters[f.name] ?? ""}
                                  onChange={(v) => setColumnFilters((prev) => ({ ...prev, [f.name]: v }))}
                                  exact={!!columnFilterModes[f.name]}
                                  onToggleExact={() => setColumnFilterModes((prev) => ({ ...prev, [f.name]: !prev[f.name] }))}
                                />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {topPad > 0 && <tr style={{ height: topPad }}><td colSpan={visibleFields.length} /></tr>}
                          {virtualRows.map((row, i) => (
                            <tr key={virtStart + i} className="hover:bg-slate-50 border-b border-slate-50" style={{ height: ROW_HEIGHT }}>
                              {visibleFields.map((f) => {
                                const val = row[f.name];
                                const display = val === null || val === undefined ? "" : String(val);
                                return (
                                  <td key={f.name} className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-[240px] truncate" title={display}>
                                    {display}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                          {bottomPad > 0 && <tr style={{ height: bottomPad }}><td colSpan={visibleFields.length} /></tr>}
                          {filteredRows.length === 0 && (
                            <tr>
                              <td colSpan={visibleFields.length} className="px-4 py-10 text-center text-slate-400">
                                Nenhum registro após filtros.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-400 flex items-center gap-3 flex-wrap">
                      <span>{rows.length} de {totalSize} registros{rowLimit !== null && rows.length < totalSize ? ` (exibindo até ${rowLimit})` : ""}</span>
                      <select
                        value={rowLimit ?? "all"}
                        onChange={(e) => {
                          const val = e.target.value === "all" ? null : Number(e.target.value);
                          setRowLimit(val);
                          if (selectedObject) loadExplorer(selectedObject, undefined, val);
                        }}
                        className="text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-600 cursor-pointer"
                        title="Limite de linhas"
                      >
                        <option value="100">100 linhas</option>
                        <option value="500">500 linhas</option>
                        <option value="2000">2000 linhas</option>
                        <option value="all">Todas</option>
                      </select>
                      {Object.values(columnFilters).some(Boolean) && (
                        <button className="text-blue-500 hover:underline ml-2" onClick={() => setColumnFilters({})}>
                          Limpar filtros
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Save Query Modal */}
      {showSaveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowSaveModal(false); setSaveQueryName(""); } }}
        >
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BookmarkPlus size={18} className="text-indigo-500" />
                <h3 className="font-bold text-slate-800 text-base">Salvar consulta</h3>
              </div>
              <button onClick={() => { setShowSaveModal(false); setSaveQueryName(""); }} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="form-label">Nome da consulta</label>
                <input
                  className="form-input"
                  placeholder={`${selectedObject?.label} — ${new Date().toLocaleDateString("pt-BR")}`}
                  value={saveQueryName}
                  onChange={(e) => setSaveQueryName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveQuery(); if (e.key === "Escape") { setShowSaveModal(false); setSaveQueryName(""); } }}
                  autoFocus
                />
              </div>
              <div className="text-[11px] text-slate-400 space-y-1 bg-slate-50 rounded-lg p-3">
                <p><span className="font-medium text-slate-600">Objeto:</span> {selectedObject?.label}</p>
                <p><span className="font-medium text-slate-600">Colunas:</span> {selectedFields.size} selecionadas</p>
                <p><span className="font-medium text-slate-600">Registros filtrados:</span> {filteredRows.length} de {totalSize}</p>
                {Object.values(columnFilters).some(Boolean) && (
                  <p className="text-orange-600">
                    <span className="font-medium">Filtros ativos:</span>{" "}
                    {Object.entries(columnFilters).filter(([, v]) => v.trim()).map(([k, v]) => `${k}="${v}"`).join(", ")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => { setShowSaveModal(false); setSaveQueryName(""); }}>Cancelar</button>
              <button className="btn-primary bg-indigo-500 hover:bg-indigo-600 border-indigo-500" onClick={handleSaveQuery}>
                <BookmarkPlus size={14} /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
