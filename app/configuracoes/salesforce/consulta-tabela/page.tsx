"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, AlertCircle, CheckCircle2, Search, Filter, FileDown } from "lucide-react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { loadQueries, type SavedQuery } from "@/lib/sfQuerySave";
import { loadConfig, loadSession, isSessionExpired, salesforceSoql, salesforceNextPage } from "@/lib/salesforce";
import { sfCacheGet, sfCacheSet, sfCacheClear, sfCacheAge } from "@/lib/sfCache";

const QUERY_A_ID = "seed_product2_v1";
const QUERY_B_ID = "seed_opportunity_v1";
const FIELD_A    = "Id";
const FIELD_B    = "Product__c";

const EXTRA_OPP_FIELDS = [
  "AccountId",
  "OpportunityCommittedCapitalBasis__c",
  "StructuringValue__c",
  "AdministrationValue__c",
  "ValueAdvisoryFee__c",
  "CloseDate",
  "AmountTotal__c",
];

const COLS: { key: string; label: string; source: "a" | "b" | "account" }[] = [
  { key: "Name",                              label: "Produto",                source: "a"       },
  { key: "AccountName",                       label: "Account Name",           source: "account" },
  { key: "AccountCPF",                        label: "CPF",                    source: "account" },
  { key: "AccountCNPJ",                       label: "CNPJ",                   source: "account" },
  { key: "IsActive",                          label: "Ativo",                  source: "a"       },
  { key: "RecordTypeId_a",                    label: "RecordType (Produto)",   source: "a"       },
  { key: "StageName",                         label: "Stage",                  source: "b"       },
  { key: "CloseDate",                         label: "Data Fechamento",        source: "b"       },
  { key: "AmountTotal__c",                    label: "Valor Total",            source: "b"       },
  { key: "OpportunityCommittedCapitalBasis__c", label: "Capital Comprometido", source: "b"       },
  { key: "StructuringValue__c",               label: "Estruturação",           source: "b"       },
  { key: "AdministrationValue__c",            label: "Administração",          source: "b"       },
  { key: "ValueAdvisoryFee__c",               label: "Advisory Fee",           source: "b"       },
  { key: "ProductRecordtypeFormula__c",       label: "Tipo Produto (Opp)",     source: "b"       },
  { key: "IsPaid__c",                         label: "Pago",                   source: "b"       },
  { key: "signedContract__c",                 label: "Contrato Assinado",      source: "b"       },
  { key: "Product__c",                        label: "Product (Opp)",          source: "b"       },
  { key: "AccountId",                         label: "Account ID",             source: "b"       },
  { key: "Id_a",                              label: "ID Produto",             source: "a"       },
  { key: "Id_b",                              label: "ID Oportunidade",        source: "b"       },
];

function fmtCurrency(v: unknown): string {
  const n = Number(v);
  if (!v || isNaN(n) || n === 0) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtBool(v: unknown): string {
  if (v === true  || v === "true"  || v === "True")  return "Sim";
  if (v === false || v === "false" || v === "False") return "Não";
  return String(v ?? "—");
}

function fmtDate(v: unknown): string {
  const s = String(v ?? "");
  if (!s || s.length < 10) return "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function accountField(col: typeof COLS[0], row: FlatRow): string {
  if (col.key === "AccountName") return row.AccountName;
  if (col.key === "AccountCPF")  return row.AccountCPF;
  if (col.key === "AccountCNPJ") return row.AccountCNPJ;
  return "";
}

function cellValue(col: typeof COLS[0], row: FlatRow): string {
  if (col.source === "account") return accountField(col, row);
  if (col.key === "Id_a") return String(row.a["Id"] ?? "");
  if (col.key === "Id_b") return String(row.b["Id"] ?? "");
  if (col.key === "RecordTypeId_a") return String(row.a["RecordTypeId"] ?? "");
  const src = row[col.source as "a" | "b"] as Record<string, unknown>;
  return String(src[col.key] ?? "");
}

function fmtDisplay(col: typeof COLS[0], row: FlatRow): string {
  const raw = col.source === "account" ? accountField(col, row)
    : col.key === "Id_a" ? String(row.a["Id"] ?? "")
    : col.key === "Id_b" ? String(row.b["Id"] ?? "")
    : col.key === "RecordTypeId_a" ? String(row.a["RecordTypeId"] ?? "")
    : String((row[col.source as "a" | "b"] as Record<string, unknown>)[col.key] ?? "");

  if (["AmountTotal__c","OpportunityCommittedCapitalBasis__c","StructuringValue__c","AdministrationValue__c","ValueAdvisoryFee__c"].includes(col.key)) {
    return fmtCurrency(raw);
  }
  if (["IsActive","IsPaid__c","signedContract__c"].includes(col.key)) return fmtBool(raw);
  if (col.key === "CloseDate") return fmtDate(raw);
  return raw || "—";
}

interface AccountData { name: string; cpf: string; cnpj: string }

interface FlatRow {
  a: Record<string, unknown>;
  b: Record<string, unknown>;
  AccountName: string;
  AccountCPF:  string;
  AccountCNPJ: string;
}

function applyFilters(
  rows: Record<string, unknown>[],
  filters: Record<string, string>,
  modes?: Record<string, boolean>
): Record<string, unknown>[] {
  return rows.filter(row =>
    Object.entries(filters).every(([col, val]) => {
      if (!val.trim()) return true;
      const cell = String(row[col] ?? "").toLowerCase();
      const exact = modes?.[col] === true;
      const parts = val.split("|").map(v => v.trim()).filter(Boolean);
      return parts.some(p => exact ? cell === p.toLowerCase() : cell.includes(p.toLowerCase()));
    })
  );
}

async function fetchAll(query: SavedQuery, onStep: (msg: string) => void): Promise<Record<string, unknown>[]> {
  const config = loadConfig();
  const session = loadSession();
  if (!config || !session) throw new Error("Salesforce não configurado.");
  if (isSessionExpired(session)) throw new Error("Sessão expirada. Reconecte em Configurações › Salesforce.");

  let queryableFields = [...query.selectedFields];
  let firstPage;
  onStep(`Carregando ${query.sfObjectLabel}...`);
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      firstPage = await salesforceSoql(config, session, `SELECT ${queryableFields.join(", ")} FROM ${query.sfObject}`);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const bad =
        msg.match(/No such column '([^']+)'/i)?.[1] ||
        msg.match(/INVALID_FIELD[^']*'([^']+)'/i)?.[1] ||
        msg.match(/invalid field[^:]*:\s*(\S+)/i)?.[1];
      if (!bad) throw err;
      queryableFields = queryableFields.filter(f => f !== bad);
      onStep(`Removendo campo inválido: ${bad}`);
    }
  }
  if (!firstPage) throw new Error("Não foi possível carregar: muitos campos inválidos.");

  let all = [...firstPage.records];
  onStep(`${query.sfObjectLabel}: ${all.length} / ${firstPage.totalSize}`);
  let next: string | null = firstPage.done ? null : (firstPage.nextRecordsUrl ?? null);
  while (next) {
    const page = await salesforceNextPage(config, session, next);
    all = all.concat(page.records);
    onStep(`${query.sfObjectLabel}: ${all.length} / ${firstPage.totalSize}`);
    next = page.done ? null : (page.nextRecordsUrl ?? null);
  }
  return all;
}

async function fetchAccountMap(onStep: (msg: string) => void): Promise<Map<string, AccountData>> {
  const config = loadConfig();
  const session = loadSession();
  if (!config || !session) throw new Error("Salesforce não configurado.");

  onStep("Carregando Account...");
  // Campo CPF_C / CNPJ_C — tenta trazer, ignora se não existir no org
  let fields = ["Id", "Name", "CPF__c", "CNPJ__c"];
  let firstPage: Awaited<ReturnType<typeof salesforceSoql>> | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      firstPage = await salesforceSoql(config, session, `SELECT ${fields.join(", ")} FROM Account`);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const bad = msg.match(/No such column '([^']+)'/i)?.[1] ||
                  msg.match(/INVALID_FIELD[^']*'([^']+)'/i)?.[1];
      if (!bad) throw err;
      fields = fields.filter(f => f !== bad);
      onStep(`Account: campo inválido removido: ${bad}`);
    }
  }
  if (!firstPage) throw new Error("Não foi possível carregar Account.");

  let all = [...firstPage.records];
  onStep(`Account: ${all.length} / ${firstPage.totalSize}`);
  let next: string | null = firstPage.done ? null : (firstPage.nextRecordsUrl ?? null);
  while (next) {
    const page = await salesforceNextPage(config, session, next);
    all = all.concat(page.records);
    onStep(`Account: ${all.length} / ${firstPage.totalSize}`);
    next = page.done ? null : (page.nextRecordsUrl ?? null);
  }

  const map = new Map<string, AccountData>();
  for (const row of all) {
    const id = String(row["Id"] ?? "");
    if (!id) continue;
    const data: AccountData = {
      name: String(row["Name"]   ?? ""),
      cpf:  String(row["CPF__c"] ?? ""),
      cnpj: String(row["CNPJ__c"] ?? ""),
    };
    map.set(id.toLowerCase(), data);
    if (id.length === 18) map.set(id.slice(0, 15).toLowerCase(), data);
  }
  return map;
}

const CACHE_KEY_MATCHED  = "sf_cache_subscricao_matched_v3";
const CACHE_KEY_ACCOUNTS = "sf_cache_accounts_full_v1"; // chave própria com CPF/CNPJ

interface Filtros {
  periodoInicio: string;
  periodoFim: string;
  produto: string;
  account: string;
  stage: string;
}

const FILTROS_VAZIOS: Filtros = { periodoInicio: "", periodoFim: "", produto: "", account: "", stage: "" };

const PT_MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

export default function ConsultaTabelaPage() {
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<FlatRow[] | null>(null);
  const [queriesFound, setQueriesFound] = useState(true);
  const [search, setSearch] = useState("");
  const [cacheAge, setCacheAge] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [rascunho, setRascunho] = useState<Filtros>(FILTROS_VAZIOS);

  const buildFlatRows = useCallback(
    (matched: Array<{ a: Record<string, unknown>; b: Record<string, unknown> }>, accMap: Map<string, AccountData>): FlatRow[] =>
      matched.map(({ a, b }) => {
        const accountId = String(b["AccountId"] ?? "").toLowerCase();
        const acc = accMap.get(accountId);
        return {
          a, b,
          AccountName: acc?.name ?? "(sem conta)",
          AccountCPF:  acc?.cpf  ?? "",
          AccountCNPJ: acc?.cnpj ?? "",
        };
      }),
    []
  );

  const loadFromCache = useCallback(() => {
    const cachedMatched  = sfCacheGet<Array<{ a: Record<string, unknown>; b: Record<string, unknown> }>>(CACHE_KEY_MATCHED);
    const cachedAccounts = sfCacheGet<Array<[string, AccountData]>>(CACHE_KEY_ACCOUNTS);
    if (cachedMatched && cachedAccounts) {
      const accMap = new Map(cachedAccounts.data);
      setRows(buildFlatRows(cachedMatched.data, accMap));
      setCacheAge(sfCacheAge(cachedMatched.savedAt));
      return true;
    }
    return false;
  }, [buildFlatRows]);

  const run = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && loadFromCache()) return;

    setLoading(true);
    setError("");
    setRows(null);
    setCacheAge(null);

    try {
      const queries = loadQueries();
      const queryA = queries.find(q => q.id === QUERY_A_ID);
      const queryB = queries.find(q => q.id === QUERY_B_ID);

      if (!queryA || !queryB) {
        setQueriesFound(false);
        setError("Consultas pré-configuradas não encontradas. Acesse Salesforce › Consultas primeiro.");
        return;
      }
      setQueriesFound(true);

      const rawA      = await fetchAll(queryA, setLoadingMsg);
      const filteredA = applyFilters(rawA, queryA.columnFilters, queryA.columnFilterModes);

      const queryBFull: typeof queryB = {
        ...queryB,
        selectedFields: [
          ...queryB.selectedFields,
          ...EXTRA_OPP_FIELDS.filter(f => !queryB.selectedFields.includes(f)),
        ],
        columnFilters: { ...queryB.columnFilters, StageName: "Fechado e Ganho" },
        columnFilterModes: { ...queryB.columnFilterModes, StageName: true },
      };
      const rawB      = await fetchAll(queryBFull, setLoadingMsg);
      const filteredB = applyFilters(rawB, queryBFull.columnFilters, queryBFull.columnFilterModes);

      const accMap = await fetchAccountMap(setLoadingMsg);

      setLoadingMsg("Cruzando dados...");

      const mapA = new Map<string, Record<string, unknown>>();
      for (const row of filteredA) {
        const key = String(row[FIELD_A] ?? "").toLowerCase();
        if (key) mapA.set(key, row);
      }

      const matched: Array<{ a: Record<string, unknown>; b: Record<string, unknown> }> = [];
      for (const rowB of filteredB) {
        const key  = String(rowB[FIELD_B] ?? "").toLowerCase();
        const rowA = mapA.get(key);
        if (rowA) matched.push({ a: rowA, b: rowB });
      }

      const accEntries = Array.from(accMap.entries()) as Array<[string, AccountData]>;
      sfCacheSet(CACHE_KEY_MATCHED, matched);
      sfCacheSet(CACHE_KEY_ACCOUNTS, accEntries);

      setRows(buildFlatRows(matched, accMap));
      setCacheAge(sfCacheAge(Date.now()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar dados");
    } finally {
      setLoading(false);
      setLoadingMsg("");
    }
  }, [loadFromCache, buildFlatRows]);

  useEffect(() => { run(false); }, [run]);

  const filtrosAtivos = useMemo(() => {
    let n = 0;
    if (filtros.periodoInicio || filtros.periodoFim) n++;
    if (filtros.produto.trim()) n++;
    if (filtros.account.trim()) n++;
    if (filtros.stage.trim()) n++;
    return n;
  }, [filtros]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    let result = rows;

    // Busca global
    const q = search.trim().toLowerCase();
    if (q) result = result.filter(row => COLS.some(col => cellValue(col, row).toLowerCase().includes(q)));

    // Período CloseDate
    if (filtros.periodoInicio || filtros.periodoFim) {
      result = result.filter(row => {
        const d = String(row.b["CloseDate"] ?? "").slice(0, 7);
        if (!d) return false;
        if (filtros.periodoInicio && d < filtros.periodoInicio) return false;
        if (filtros.periodoFim   && d > filtros.periodoFim)   return false;
        return true;
      });
    }

    // Produto
    if (filtros.produto.trim()) {
      const terms = filtros.produto.toLowerCase().split("|").map(s => s.trim()).filter(Boolean);
      result = result.filter(row => {
        const name = String(row.a["Name"] ?? "").toLowerCase();
        return terms.some(t => name.includes(t));
      });
    }

    // Account Name
    if (filtros.account.trim()) {
      const terms = filtros.account.toLowerCase().split("|").map(s => s.trim()).filter(Boolean);
      result = result.filter(row => terms.some(t => row.AccountName.toLowerCase().includes(t)));
    }

    // Stage
    if (filtros.stage.trim()) {
      const terms = filtros.stage.toLowerCase().split("|").map(s => s.trim()).filter(Boolean);
      result = result.filter(row => {
        const stage = String(row.b["StageName"] ?? "").toLowerCase();
        return terms.some(t => stage.includes(t));
      });
    }

    return result;
  }, [rows, search, filtros]);

  console.log("[consulta-tabela] render — rows:", rows?.length ?? "null", "filtered:", filtered.length, "loading:", loading);

  return (
    <div>
      <PageHeader
        title="Configuração › Integrações › Salesforce › Consulta Tabela"
        subtitle="Produto2 × Opportunity × Account — todas as colunas"
      />

      <div className="p-6 space-y-4">

        {/* Status bar */}
        <div className="flex items-center gap-4 flex-wrap">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <RefreshCw size={14} className="animate-spin text-blue-500" />
              {loadingMsg || "Carregando..."}
            </div>
          )}
          {!loading && rows !== null && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
              <CheckCircle2 size={14} />
              <strong>{filtered.length}</strong> de <strong>{rows.length}</strong> registros
              {cacheAge && (
                <span className="text-xs text-slate-400 ml-1 border-l border-green-200 pl-2">
                  cache · {cacheAge}
                </span>
              )}
            </div>
          )}

          {/* Filtros */}
          <button
            onClick={() => { setRascunho(filtros); setFilterOpen(true); }}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
            style={filtrosAtivos > 0 ? { borderColor: "#1e3a5f", color: "#1e3a5f" } : {}}>
            <Filter size={14} />
            Filtros
            {filtrosAtivos > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full text-white"
                style={{ background: "#1e3a5f" }}>{filtrosAtivos}</span>
            )}
          </button>

          {/* Busca global */}
          {rows !== null && (
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-52 bg-white"
                placeholder="Busca rápida..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          )}

          {filtered.length > 0 && (
            <button
              onClick={() => {
                const sep = ";";
                const esc = (v: string) =>
                  v.includes(sep) || v.includes('"') || v.includes("\n")
                    ? `"${v.replace(/"/g, '""')}"`
                    : v;
                const header = COLS.map(c => esc(c.label)).join(sep);
                const body = filtered
                  .map(row => COLS.map(col => esc(cellValue(col, row))).join(sep))
                  .join("\n");
                const blob = new Blob(["﻿" + header + "\n" + body], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `consulta_salesforce_${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors whitespace-nowrap"
            >
              <FileDown size={13} /> Exportar Excel
              <span className="opacity-60">({filtered.length} reg)</span>
            </button>
          )}

          <button
            onClick={() => { sfCacheClear(CACHE_KEY_MATCHED); sfCacheClear(CACHE_KEY_ACCOUNTS); run(true); }}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-40 ml-auto"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Atualizar
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg max-w-3xl">
            <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-700">{error}</p>
              {!queriesFound && (
                <Link href="/salesforce/consultas" className="text-xs text-blue-600 underline mt-1 block">
                  Ir para Salesforce › Consultas
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Tabela */}
        {rows !== null && (
          <div className="card">
            <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 260px)" }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: COLS.length * 140 }}>
                <thead className="sticky top-0 z-10">
                  <tr style={{ background: "#152d4a" }}>
                    <th className="px-3 py-2 text-left text-white/60 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap sticky left-0 z-20 border-r border-white/10" style={{ background: "#152d4a", minWidth: 200 }}>
                      #
                    </th>
                    {COLS.map(col => (
                      <th key={col.key} className="px-3 py-2 text-left text-white/80 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap border-l border-white/10">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => (
                    <tr key={i} className={`border-b border-slate-50 hover:bg-blue-50/40 transition-colors ${i % 2 === 1 ? "bg-slate-50/50" : ""}`}>
                      <td className="px-3 py-2 text-slate-400 sticky left-0 bg-white border-r border-slate-100 font-mono tabular-nums text-[10px] whitespace-nowrap"
                        style={{ background: i % 2 === 1 ? "#f8fafc" : "white" }}>
                        {i + 1}
                      </td>
                      {COLS.map(col => {
                        const display = fmtDisplay(col, row);
                        const isNum = ["AmountTotal__c","OpportunityCommittedCapitalBasis__c","StructuringValue__c","AdministrationValue__c","ValueAdvisoryFee__c"].includes(col.key);
                        return (
                          <td
                            key={col.key}
                            className={`px-3 py-2 whitespace-nowrap border-l border-slate-50 ${isNum ? "text-right tabular-nums text-slate-700" : "text-slate-600"} truncate max-w-[220px]`}
                            title={display}
                          >
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <p className="py-10 text-center text-slate-400 text-sm">Nenhum registro encontrado.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Filter Drawer ───────────────────────────────────────────────────────── */}
      {filterOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setFilterOpen(false)} />
          <div className="fixed top-0 right-0 h-full w-[300px] z-50 bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 flex-shrink-0">
              <span className="font-semibold text-gray-800">Filtros</span>
              <button onClick={() => setFilterOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto">

              {/* Período */}
              <div className="border-b border-gray-100 px-4 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Período (CloseDate)</p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">De</label>
                    <input
                      type="month"
                      value={rascunho.periodoInicio}
                      onChange={e => {
                        const v = e.target.value;
                        setRascunho(r => ({
                          ...r,
                          periodoInicio: v,
                          periodoFim: r.periodoFim && r.periodoFim < v ? v : r.periodoFim,
                        }));
                      }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Até</label>
                    <input
                      type="month"
                      value={rascunho.periodoFim}
                      onChange={e => {
                        const v = e.target.value;
                        setRascunho(r => ({
                          ...r,
                          periodoFim: v,
                          periodoInicio: r.periodoInicio && r.periodoInicio > v ? v : r.periodoInicio,
                        }));
                      }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Produto */}
              <div className="border-b border-gray-100 px-4 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Produto (Name)</p>
                <input
                  type="text"
                  placeholder="Buscar produto..."
                  value={rascunho.produto}
                  onChange={e => setRascunho(r => ({ ...r, produto: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <p className="text-[11px] text-gray-400 mt-1.5">Use | para múltiplos termos</p>
              </div>

              {/* Account */}
              <div className="border-b border-gray-100 px-4 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Account Name</p>
                <input
                  type="text"
                  placeholder="Buscar conta..."
                  value={rascunho.account}
                  onChange={e => setRascunho(r => ({ ...r, account: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <p className="text-[11px] text-gray-400 mt-1.5">Use | para múltiplos termos</p>
              </div>

              {/* Stage */}
              <div className="border-b border-gray-100 px-4 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Stage</p>
                <input
                  type="text"
                  placeholder="Buscar stage..."
                  value={rascunho.stage}
                  onChange={e => setRascunho(r => ({ ...r, stage: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <p className="text-[11px] text-gray-400 mt-1.5">Use | para múltiplos termos</p>
              </div>
            </div>

            <div className="px-4 py-4 border-t border-gray-200 flex gap-2 flex-shrink-0">
              <button
                onClick={() => setRascunho(FILTROS_VAZIOS)}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                Limpar
              </button>
              <button
                onClick={() => { setFiltros(rascunho); setFilterOpen(false); }}
                className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                style={{ background: "#1e3a5f" }}>
                Aplicar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
