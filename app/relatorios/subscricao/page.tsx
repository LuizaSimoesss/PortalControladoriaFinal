"use client";

import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { RefreshCw, AlertCircle, CheckCircle2, Filter, ChevronRight, ChevronDown } from "lucide-react";
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

const PT_MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

interface Filtros {
  periodoInicio: string;
  periodoFim: string;
  nameFilter: string;
}

const FILTROS_VAZIOS: Filtros = { periodoInicio: "", periodoFim: "", nameFilter: "" };
const FILTROS_DEFAULT: Filtros = { periodoInicio: "2026-01", periodoFim: "2026-12", nameFilter: "" };
const FILTROS_LS_KEY = "portal_subscricao_filtros";

const CACHE_KEY_MATCHED  = "sf_cache_subscricao_matched_v3";
const CACHE_KEY_ACCOUNTS = "sf_cache_accounts_v3";

function fmt(v: number | null): string {
  if (v === null || v === 0) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

async function fetchAccountMap(
  onStep: (msg: string) => void
): Promise<Map<string, string>> {
  const config = loadConfig();
  const session = loadSession();
  if (!config || !session) throw new Error("Salesforce não configurado.");

  onStep("Carregando Account...");
  let firstPage = await salesforceSoql(config, session, "SELECT Id, Name FROM Account");
  let all = [...firstPage.records];
  onStep(`Account: ${all.length} / ${firstPage.totalSize}`);

  let next: string | null = firstPage.done ? null : (firstPage.nextRecordsUrl ?? null);
  while (next) {
    const page = await salesforceNextPage(config, session, next);
    all = all.concat(page.records);
    onStep(`Account: ${all.length} / ${firstPage.totalSize}`);
    next = page.done ? null : (page.nextRecordsUrl ?? null);
  }

  const map = new Map<string, string>();
  for (const row of all) {
    const id   = String(row["Id"] ?? "");
    const name = String(row["Name"] ?? "(sem nome)");
    if (!id) continue;
    // Armazena 18-char e 15-char (prefixo) para cobrir ambos os formatos de ID do Salesforce
    map.set(id.toLowerCase(), name);
    if (id.length === 18) map.set(id.slice(0, 15).toLowerCase(), name);
  }
  return map;
}

function performJoin(
  rowsA: Record<string, unknown>[],
  rowsB: Record<string, unknown>[]
): Array<{ a: Record<string, unknown>; b: Record<string, unknown> }> {
  const mapA = new Map<string, Record<string, unknown>>();
  for (const row of rowsA) {
    const key = String(row[FIELD_A] ?? "").toLowerCase();
    if (key) mapA.set(key, row);
  }
  const matched: Array<{ a: Record<string, unknown>; b: Record<string, unknown> }> = [];
  for (const rowB of rowsB) {
    const key = String(rowB[FIELD_B] ?? "").toLowerCase();
    const rowA = mapA.get(key);
    if (rowA) matched.push({ a: rowA, b: rowB });
  }
  return matched;
}

type AccountRow  = { accountName: string; values: (number | null)[]; total: number };
type ProductRow  = { name: string; accounts: AccountRow[]; values: (number | null)[]; total: number };

function PivotTable({
  matched,
  accountMap,
  filtros,
}: {
  matched: Array<{ a: Record<string, unknown>; b: Record<string, unknown> }>;
  accountMap: Map<string, string>;
  filtros: Filtros;
}) {
  const { monthLabels, productRows, colTotals, grandTotal } = useMemo(() => {
    // Map: productName → accountName → monthKey → sum
    const tree = new Map<string, Map<string, Map<string, number>>>();
    const monthKeys = new Set<string>();
    const nameSearch = filtros.nameFilter.trim().toLowerCase();

    for (const { a, b } of matched) {
      const name = String(a["Name"] ?? "(sem nome)");
      if (nameSearch && !name.toLowerCase().includes(nameSearch)) continue;

      const closeDate = String(b["CloseDate"] ?? "");
      const amount = Number(b["AmountTotal__c"] ?? 0) || 0;
      if (!closeDate || closeDate.length < 7) continue;

      const monthKey = closeDate.slice(0, 7);
      if (filtros.periodoInicio && monthKey < filtros.periodoInicio) continue;
      if (filtros.periodoFim   && monthKey > filtros.periodoFim)   continue;

      const accountId   = String(b["AccountId"] ?? "").toLowerCase();
      const accountName = accountMap.get(accountId) ?? "(sem conta)";

      monthKeys.add(monthKey);
      if (!tree.has(name)) tree.set(name, new Map());
      const byAccount = tree.get(name)!;
      if (!byAccount.has(accountName)) byAccount.set(accountName, new Map());
      const byMonth = byAccount.get(accountName)!;
      byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + amount);
    }

    const sortedKeys = Array.from(monthKeys).sort();
    const monthLabels = sortedKeys.map(k => {
      const [year, month] = k.split("-");
      return `${PT_MONTHS[Number(month) - 1]}/${year}`;
    });

    const productRows: ProductRow[] = Array.from(tree.entries())
      .map(([name, byAccount]) => {
        const accounts: AccountRow[] = Array.from(byAccount.entries())
          .map(([accountName, byMonth]) => ({
            accountName,
            values: sortedKeys.map(k => byMonth.get(k) ?? null),
            total: sortedKeys.reduce((s, k) => s + (byMonth.get(k) ?? 0), 0),
          }))
          .sort((a, b) => a.accountName.localeCompare(b.accountName, "pt-BR"));

        const productByMonth = new Map<string, number>();
        for (const acc of accounts) {
          sortedKeys.forEach((k, i) => {
            const v = acc.values[i];
            if (v !== null) productByMonth.set(k, (productByMonth.get(k) ?? 0) + v);
          });
        }
        return {
          name,
          accounts,
          values: sortedKeys.map(k => productByMonth.get(k) ?? null),
          total: Array.from(productByMonth.values()).reduce((s, v) => s + v, 0),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    const colTotals = sortedKeys.map((_, ci) =>
      productRows.reduce((s, p) => s + (p.values[ci] ?? 0), 0)
    );
    const grandTotal = colTotals.reduce((s, v) => s + v, 0);

    return { monthLabels, productRows, colTotals, grandTotal };
  }, [matched, accountMap, filtros]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const allCollapsed = productRows.length > 0 && productRows.every(p => collapsed.has(p.name));

  useEffect(() => {
    setCollapsed(new Set(productRows.map(p => p.name)));
  }, [productRows]);

  function toggleProduct(name: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function toggleAll() {
    setCollapsed(allCollapsed ? new Set() : new Set(productRows.map(p => p.name)));
  }

  if (productRows.length === 0) {
    return <p className="px-4 py-10 text-center text-slate-400 text-sm">Nenhuma correspondência encontrada.</p>;
  }

  const nCols = monthLabels.length;

  return (
    <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
      <table className="w-full text-xs border-collapse" style={{ minWidth: (nCols + 2) * 130 }}>
        <thead className="sticky top-0 z-10">
          <tr className="bg-slate-100 border-b border-slate-200">
            <th className="px-2 py-2.5 text-left font-semibold text-slate-700 whitespace-nowrap sticky left-0 bg-slate-100 border-r border-slate-200 min-w-[240px]">
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleAll}
                  className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-slate-200 transition-colors text-slate-500"
                  title={allCollapsed ? "Expandir todos" : "Recolher todos"}
                >
                  {allCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                Produto / Conta
              </div>
            </th>
            {monthLabels.map(label => (
              <th key={label} className="px-3 py-2.5 text-right font-semibold text-slate-600 whitespace-nowrap">
                {label}
              </th>
            ))}
            <th className="px-3 py-2.5 text-right font-semibold text-slate-700 whitespace-nowrap bg-slate-50 border-l border-slate-200">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {productRows.map((product, pi) => {
            const isCollapsed = collapsed.has(product.name);
            const rowBg = pi % 2 === 0 ? "#f8fafc" : "#ffffff";
            return (
              <React.Fragment key={`p-${product.name}`}>
                {/* Linha do produto */}
                <tr
                  className={`border-b border-slate-200 cursor-pointer select-none hover:brightness-95 transition-all`}
                  onClick={() => toggleProduct(product.name)}
                  style={{ background: rowBg }}
                >
                  <td
                    className="px-2 py-2 font-semibold text-slate-800 whitespace-nowrap sticky left-0 border-r border-slate-200 truncate max-w-[280px]"
                    style={{ background: rowBg }}
                    title={product.name}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-slate-400">
                        {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      </span>
                      <span className="truncate">{product.name}</span>
                      <span className="ml-1 text-[10px] font-normal text-slate-400 flex-shrink-0">
                        ({product.accounts.length})
                      </span>
                    </div>
                  </td>
                  {product.values.map((v, j) => (
                    <td key={j} className="px-3 py-2 text-right font-semibold text-slate-700 whitespace-nowrap tabular-nums">
                      {fmt(v)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-bold text-slate-800 whitespace-nowrap tabular-nums border-l border-slate-200 bg-slate-100">
                    {fmt(product.total)}
                  </td>
                </tr>

                {/* Sub-linhas de conta */}
                {!isCollapsed && product.accounts.map(acc => (
                  <tr
                    key={`p-${product.name}-a-${acc.accountName}`}
                    className="border-b border-slate-50 hover:bg-blue-50/30 transition-colors"
                  >
                    <td
                      className="pl-8 pr-4 py-1.5 text-slate-500 whitespace-nowrap sticky left-0 bg-white border-r border-slate-100 truncate max-w-[280px]"
                      title={acc.accountName}
                    >
                      <span className="text-slate-300 mr-1.5">└</span>{acc.accountName}
                    </td>
                    {acc.values.map((v, j) => (
                      <td key={j} className="px-3 py-1.5 text-right text-slate-500 whitespace-nowrap tabular-nums">
                        {fmt(v)}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right text-slate-600 whitespace-nowrap tabular-nums border-l border-slate-100 bg-slate-50/40">
                      {fmt(acc.total)}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-200 bg-slate-100 font-semibold">
            <td className="px-4 py-2.5 text-slate-700 sticky left-0 bg-slate-100 border-r border-slate-200">Total</td>
            {colTotals.map((v, j) => (
              <td key={j} className="px-3 py-2.5 text-right text-slate-700 tabular-nums whitespace-nowrap">
                {fmt(v)}
              </td>
            ))}
            <td className="px-3 py-2.5 text-right text-slate-900 tabular-nums whitespace-nowrap border-l border-slate-200">
              {fmt(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SkeletonPivotTable() {
  const SKEL_COLS = 6;
  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="card-header flex-shrink-0 border-b border-slate-100">
        <div className="h-4 bg-slate-200 rounded w-64 animate-pulse" />
        <div className="h-3 bg-slate-100 rounded w-40 animate-pulse" />
      </div>
      <div className="overflow-auto">
        <table className="w-full text-xs border-collapse" style={{ minWidth: (SKEL_COLS + 2) * 130 }}>
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="px-4 py-2.5 sticky left-0 bg-slate-100 border-r border-slate-200 min-w-[240px]">
                <div className="h-3 bg-slate-300 rounded w-28 animate-pulse" />
              </th>
              {Array.from({ length: SKEL_COLS }, (_, i) => (
                <th key={i} className="px-3 py-2.5 text-right">
                  <div className="h-3 bg-slate-200 rounded w-14 ml-auto animate-pulse" />
                </th>
              ))}
              <th className="px-3 py-2.5 text-right border-l border-slate-200">
                <div className="h-3 bg-slate-200 rounded w-10 ml-auto animate-pulse" />
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, i) => (
              <tr key={i} className="border-b border-slate-100" style={{ background: i % 2 === 0 ? "#f8fafc" : "#ffffff" }}>
                <td className="px-4 py-3 sticky left-0 border-r border-slate-100" style={{ background: i % 2 === 0 ? "#f8fafc" : "#ffffff" }}>
                  <div className="h-3 bg-slate-200 rounded animate-pulse" style={{ width: `${100 + (i % 3) * 40}px` }} />
                </td>
                {Array.from({ length: SKEL_COLS }, (_, j) => (
                  <td key={j} className="px-3 py-3 text-right">
                    <div className="h-3 bg-slate-100 rounded w-16 ml-auto animate-pulse" />
                  </td>
                ))}
                <td className="px-3 py-3 text-right border-l border-slate-100 bg-slate-50/40">
                  <div className="h-3 bg-slate-200 rounded w-16 ml-auto animate-pulse" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SubscricaoPage() {
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [matched, setMatched] = useState<Array<{ a: Record<string, unknown>; b: Record<string, unknown> }> | null>(null);
  const [accountMap, setAccountMap] = useState<Map<string, string>>(new Map());
  const [stats, setStats] = useState<{ filteredA: number; filteredB: number } | null>(null);
  const [queriesFound, setQueriesFound] = useState(true);
  const [cacheAge, setCacheAge] = useState<string | null>(null);

  const [cacheChecked, setCacheChecked] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_DEFAULT);
  const [rascunho, setRascunho] = useState<Filtros>(FILTROS_DEFAULT);

  const filtrosAtivos = useMemo(() => {
    let n = 0;
    if (filtros.periodoInicio || filtros.periodoFim) n++;
    if (filtros.nameFilter.trim()) n++;
    return n;
  }, [filtros]);

  const loadFromCache = useCallback(() => {
    const cachedMatched  = sfCacheGet<Array<{ a: Record<string, unknown>; b: Record<string, unknown> }>>(CACHE_KEY_MATCHED);
    const cachedAccounts = sfCacheGet<Array<[string, string]>>(CACHE_KEY_ACCOUNTS);
    if (cachedMatched && cachedAccounts) {
      setMatched(cachedMatched.data);
      setAccountMap(new Map(cachedAccounts.data));
      setStats({ filteredA: 0, filteredB: cachedMatched.data.length });
      setCacheAge(sfCacheAge(cachedMatched.savedAt));
      return true;
    }
    return false;
  }, []);

  const run = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && loadFromCache()) return;

    setLoading(true);
    setError("");
    setMatched(null);
    setAccountMap(new Map());
    setStats(null);
    setCacheAge(null);

    try {
      const queries = loadQueries();
      const queryA  = queries.find(q => q.id === QUERY_A_ID);
      const queryB  = queries.find(q => q.id === QUERY_B_ID);

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
      const joinResult = performJoin(filteredA, filteredB);
      const accEntries = Array.from(accMap.entries()) as Array<[string, string]>;

      sfCacheSet(CACHE_KEY_MATCHED, joinResult);
      sfCacheSet(CACHE_KEY_ACCOUNTS, accEntries);

      setStats({ filteredA: filteredA.length, filteredB: filteredB.length });
      setMatched(joinResult);
      setAccountMap(accMap);
      setCacheAge(sfCacheAge(Date.now()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar dados");
    } finally {
      setLoading(false);
      setLoadingMsg("");
    }
  }, [loadFromCache]);

  // useLayoutEffect roda antes do browser pintar: lê localStorage de forma síncrona
  // para que o usuário nunca veja a tela em branco nem o skeleton.
  // No servidor (SSR) cai para useEffect inerte, sem problema.
  const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

  useIsomorphicLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(FILTROS_LS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Filtros;
        setFiltros(saved);
        setRascunho(saved);
      }
    } catch {}
    const found = loadFromCache();
    setCacheChecked(true);
    if (!found) run(true);
  }, [loadFromCache, run]);

  function aplicar() {
    setFiltros(rascunho);
    try { localStorage.setItem(FILTROS_LS_KEY, JSON.stringify(rascunho)); } catch {}
    setFilterOpen(false);
  }
  function limpar() { setRascunho(FILTROS_DEFAULT); }

  const periodoLabel = useMemo(() => {
    const ini = filtros.periodoInicio;
    const fim = filtros.periodoFim;
    if (!ini && !fim) return null;
    const f = (s: string) => {
      const [y, m] = s.split("-");
      return `${PT_MONTHS[Number(m) - 1]}/${y}`;
    };
    if (ini && fim) return `${f(ini)} – ${f(fim)}`;
    if (ini) return `a partir de ${f(ini)}`;
    return `até ${f(fim)}`;
  }, [filtros]);

  return (
    <div>
      <PageHeader title="Subscrição" subtitle="AmountTotal__c por produto e mês/ano de fechamento" />

      <div className="p-6 space-y-4">

        {/* Status bar */}
        <div className="flex items-center gap-4 flex-wrap">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <RefreshCw size={14} className="animate-spin text-blue-500" />
              {loadingMsg || "Carregando..."}
            </div>
          )}
          {!loading && matched !== null && stats && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
              <CheckCircle2 size={14} />
              <strong>{matched.length}</strong> correspondências
              {stats.filteredA > 0 && (
                <span className="text-xs text-slate-400 ml-1">
                  · Product2: {stats.filteredA} · Opportunity: {stats.filteredB} · Account: {accountMap.size}
                </span>
              )}
              {cacheAge && (
                <span className="text-xs text-slate-400 ml-1 border-l border-green-200 pl-2">
                  cache · {cacheAge}
                </span>
              )}
            </div>
          )}

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

          {periodoLabel && (
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">{periodoLabel}</span>
          )}

          <button
            onClick={() => { sfCacheClear(CACHE_KEY_MATCHED); sfCacheClear(CACHE_KEY_ACCOUNTS); run(true); }}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-40 ml-auto"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Buscar dados
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

        {/* Skeleton — verificando cache ou aguardando fetch sem dados ainda */}
        {(!cacheChecked || (loading && matched === null)) && <SkeletonPivotTable />}

        {/* Estado vazio — cache verificado, sem dados */}
        {cacheChecked && !loading && matched === null && !error && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
              <RefreshCw size={22} className="text-slate-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-600">Nenhum dado carregado</p>
              <p className="text-xs text-slate-400 mt-1">Clique em <strong>Buscar dados</strong> para carregar do Salesforce</p>
            </div>
            <button
              onClick={() => { sfCacheClear(CACHE_KEY_MATCHED); sfCacheClear(CACHE_KEY_ACCOUNTS); run(true); }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
              style={{ background: "#1e3a5f" }}
            >
              <RefreshCw size={14} /> Buscar dados
            </button>
          </div>
        )}

        {/* Pivot table */}
        {matched !== null && (
          <div className="card flex flex-col">
            <div className="card-header flex-shrink-0">
              <div className="flex items-center gap-3">
                <span className="font-bold text-slate-700 text-sm">AmountTotal__c por Produto × Mês/Ano</span>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{matched.length} linhas brutas</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">CloseDate → colunas · Name → linhas · Account → sub-linhas</span>
            </div>
            <PivotTable matched={matched} accountMap={accountMap} filtros={filtros} />
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

              <div className="border-b border-gray-100 px-4 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Produto (Name)</p>
                <input
                  type="text"
                  placeholder="Buscar produto..."
                  value={rascunho.nameFilter}
                  onChange={e => setRascunho(r => ({ ...r, nameFilter: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <p className="text-[11px] text-gray-400 mt-1.5">Use | para múltiplos termos</p>
              </div>
            </div>

            <div className="px-4 py-4 border-t border-gray-200 flex gap-2 flex-shrink-0">
              <button
                onClick={limpar}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                Limpar
              </button>
              <button
                onClick={aplicar}
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
