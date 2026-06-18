"use client";

import { useSyncExternalStore, useCallback, useRef, useEffect } from "react";
import { idbGet, idbSet } from "@/lib/idb";

const PORTAL_VERSION_KEY = "portal_data_version";
const PORTAL_VERSION = "3";
const PORTAL_KEYS = [
  "portal_natureza",
  "portal_centro_resultado",
  "portal_projetos",
  "portal_parceiro",
  "portal_empresas",
  "portal_adquiridas",
  "portal_indicadores",
  "portal_fechamentos",
  "portal_lancamentos_financeiro",
];

// Keys stored in IndexedDB instead of localStorage — no size limit.
// Sankhya sync tables can have tens of thousands of rows.
const IDB_KEYS = new Set([
  "portal_parceiro",
  "portal_natureza",
  "portal_centro_resultado",
  "portal_projetos",
  "portal_empresas",
]);

const EVENT_NAME = "portal-data-update";

// Keys that have already been loaded from Supabase in this session
const _remoteLoaded = new Set<string>();

// Cross-tab sync: the browser fires the native `storage` event in every OTHER tab
// when localStorage changes. Invalidate the cache for that key and re-dispatch our
// custom event so useSyncExternalStore subscribers re-render with fresh data.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (!e.key || !e.key.startsWith("portal_") || e.newValue === null) return;
    const cached = _cache.get(e.key);
    if (cached && cached.raw === e.newValue) return; // no real change
    _cache.delete(e.key);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key: e.key } }));
  });
}

// Per-key snapshot cache: stores the last-parsed value alongside its raw JSON string.
// useSyncExternalStore uses Object.is to compare consecutive snapshots, so we must
// return the SAME object reference when the underlying data hasn't changed — otherwise
// every subscriber notification triggers an unnecessary re-render.
const _cache = new Map<string, { raw: string; value: unknown }>();

// Run migration at most once per page load — avoids repeated localStorage reads on every render.
let _migrated = false;

function migrateIfNeeded() {
  if (_migrated) return;
  try {
    if (localStorage.getItem(PORTAL_VERSION_KEY) !== PORTAL_VERSION) {
      PORTAL_KEYS.forEach((k) => {
        localStorage.removeItem(k);
        _cache.delete(k);
      });
      localStorage.setItem(PORTAL_VERSION_KEY, PORTAL_VERSION);
    }
    // Free up localStorage by evicting any IDB_KEYS that may still be there.
    IDB_KEYS.forEach((k) => {
      if (localStorage.getItem(k)) {
        localStorage.removeItem(k);
        _cache.delete(k);
      }
    });
    _migrated = true;
  } catch {}
}

function setLocalStorage(key: string, raw: string): boolean {
  try {
    localStorage.setItem(key, raw);
    return true;
  } catch {
    // QuotaExceededError — data lives in _cache only for this session
    console.warn(`[storage] ${key} localStorage quota excedido — dados mantidos só em memória`);
    return false;
  }
}

function getSnapshot<T>(key: string, fallback: T): T {
  try {
    migrateIfNeeded();
    // Check in-memory cache first — it's authoritative when localStorage is over quota.
    const cached = _cache.get(key);
    const raw = localStorage.getItem(key);
    if (cached) {
      // Cache was set from a write that may have skipped localStorage (quota exceeded).
      // Use the cache value if localStorage is empty or matches the cached raw.
      if (!raw || cached.raw === raw) return cached.value as T;
    }
    if (!raw) return fallback;
    const value = JSON.parse(raw) as T;
    // If the caller expects an array but storage holds a non-array (e.g. {}), discard it.
    if (Array.isArray(fallback) && !Array.isArray(value)) return fallback;
    _cache.set(key, { raw, value });
    return value;
  } catch {
    return fallback;
  }
}

export const PREFETCH_ORCADO_KEYS: readonly string[] = [
  // Orçamento — receita
  "portal_orcamento_gestao_recursos",
  "portal_orcamento_advisory",
  "portal_orcamento_investment_banking",
  "portal_orcamento_research",
  // Orçamento — gastos
  "portal_orcamento_gastos_pacote_pessoal",
  "portal_orcamento_gastos_pacote_certificacao",
  "portal_orcamento_gastos_pacote_incentivos_comerciais",
  "portal_orcamento_gastos_pacote_institucional",
  "portal_orcamento_gastos_pacote_ocupacao",
  "portal_orcamento_gastos_pacote_eventos",
  "portal_orcamento_gastos_pacote_servicos_especializados",
  "portal_orcamento_gastos_pacote_servicos_juridicos",
  "portal_orcamento_gastos_pacote_tecnologia",
  "portal_orcamento_gastos_pacote_viagens",
  // Forecast — receita
  "portal_forecast_receita_gestao_recursos",
  "portal_forecast_receita_advisory",
  "portal_forecast_receita_investment_banking",
  "portal_forecast_receita_research",
  // Forecast — gastos
  "portal_forecast_gastos_pacote_pessoal",
  "portal_forecast_gastos_pacote_certificacao",
  "portal_forecast_gastos_pacote_incentivos_comerciais",
  "portal_forecast_gastos_pacote_institucional",
  "portal_forecast_gastos_pacote_ocupacao",
  "portal_forecast_gastos_pacote_eventos",
  "portal_forecast_gastos_pacote_servicos_especializados",
  "portal_forecast_gastos_pacote_servicos_juridicos",
  "portal_forecast_gastos_pacote_tecnologia",
  "portal_forecast_gastos_pacote_viagens",
  // Forecast — meses realizados (_mr)
  "portal_forecast_receita_gestao_recursos_mr",
  "portal_forecast_receita_advisory_mr",
  "portal_forecast_receita_investment_banking_mr",
  "portal_forecast_receita_research_mr",
  "portal_forecast_gastos_pacote_pessoal_mr",
  "portal_forecast_gastos_pacote_certificacao_mr",
  "portal_forecast_gastos_pacote_incentivos_comerciais_mr",
  "portal_forecast_gastos_pacote_institucional_mr",
  "portal_forecast_gastos_pacote_ocupacao_mr",
  "portal_forecast_gastos_pacote_eventos_mr",
  "portal_forecast_gastos_pacote_servicos_especializados_mr",
  "portal_forecast_gastos_pacote_servicos_juridicos_mr",
  "portal_forecast_gastos_pacote_tecnologia_mr",
  "portal_forecast_gastos_pacote_viagens_mr",
];

export function prefetchKeys(keys: readonly string[]): void {
  for (const key of keys) {
    if (_remoteLoaded.has(key)) continue;
    _remoteLoaded.add(key);
    fetch(`/api/data/${key}`)
      .then((r) => r.json())
      .then((serverData: unknown) => {
        if (Array.isArray(serverData) && serverData.length > 0) {
          const raw = JSON.stringify(serverData);
          localStorage.setItem(key, raw);
          _cache.set(key, { raw, value: serverData });
          window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key } }));
        }
      })
      .catch(() => {});
  }
}

export function markStorageInitialized() {
  try {
    localStorage.setItem(PORTAL_VERSION_KEY, PORTAL_VERSION);
  } catch {}
}

export function loadData<T>(key: string, fallback: T): T {
  // In-memory cache is authoritative for IDB_KEYS (localStorage won't have them).
  const cached = _cache.get(key);
  if (cached) return cached.value as T;
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {}
  return fallback;
}

// Async version for IDB_KEYS — use in async contexts (e.g. handleSyncAll).
export async function loadDataAsync<T>(key: string, fallback: T): Promise<T> {
  if (IDB_KEYS.has(key)) {
    const cached = _cache.get(key);
    if (cached) return cached.value as T;
    const stored = await idbGet<T>(key, fallback);
    if (stored && Array.isArray(stored) && (stored as unknown[]).length > 0) {
      const raw = JSON.stringify(stored);
      _cache.set(key, { raw, value: stored });
    }
    return stored;
  }
  return loadData(key, fallback);
}

export function saveData<T>(key: string, data: T): boolean {
  try {
    const raw = JSON.stringify(data);
    if (IDB_KEYS.has(key)) {
      idbSet(key, data); // async, no size limit
    } else {
      setLocalStorage(key, raw);
    }
    _cache.set(key, { raw, value: data });
    // Prevent the next usePersistedData mount from overwriting this freshly-saved value
    // with a stale GET from Supabase (race condition: POST may not have completed yet).
    _remoteLoaded.add(key);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key } }));
    // Sync to Supabase in background (fire-and-forget)
    fetch(`/api/data/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
    })
      .then((r) => r.json().then((j) => {
        if (!r.ok || j?.error) console.error(`[storage] POST Supabase ${key} FALHOU:`, j?.error ?? r.status);
      }))
      .catch((err) => console.error(`[storage] POST Supabase ${key} erro de rede:`, err));
    return true;
  } catch {
    return false;
  }
}

// Kept for call-site compatibility (configuracoes/sankhya uses this after saveData).
export function notifySync(key: string): void {
  try {
    // Invalidate cache so the next getSnapshot re-parses from localStorage.
    _cache.delete(key);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key } }));
  } catch {}
}

export function usePersistedData<T>(
  key: string,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  // subscribe: React calls this once on mount. We only notify React when data
  // for THIS specific key changes — no cross-key noise.
  const subscribe = useCallback(
    (callback: () => void) => {
      function handler(e: Event) {
        const ev = e as CustomEvent<{ key: string }>;
        if (ev.detail?.key === key) callback();
      }
      window.addEventListener(EVENT_NAME, handler);
      return () => window.removeEventListener(EVENT_NAME, handler);
    },
    [key]
  );

  // getSnapshot (client): reads from localStorage via the stable-reference cache.
  // Same JSON → same object reference → useSyncExternalStore bails out (no re-render).
  const clientSnapshot = useCallback(() => getSnapshot(key, initial), [key, initial]);

  // getServerSnapshot: used during SSR and React hydration.
  // Must return the same value the server rendered so there is no hydration mismatch.
  // The client transitions to clientSnapshot after hydration; React handles this
  // gracefully via useSyncExternalStore — no error, no flash.
  const serverSnapshot = useCallback(() => initial, [initial]);

  const data = useSyncExternalStore<T>(subscribe, clientSnapshot, serverSnapshot);

  // For IDB keys: load from IndexedDB on first mount (async → dispatch event when ready).
  useEffect(() => {
    if (!IDB_KEYS.has(key)) return;
    if (_cache.has(key)) return; // already in memory (e.g. from a prior save this session)
    idbGet<T>(key, null as unknown as T).then((stored) => {
      if (stored && Array.isArray(stored) && (stored as unknown[]).length > 0) {
        const raw = JSON.stringify(stored);
        _cache.set(key, { raw, value: stored });
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key } }));
      }
    });
  }, [key]);

  // On first mount for this key, pull latest data from Supabase
  useEffect(() => {
    if (_remoteLoaded.has(key)) return;
    _remoteLoaded.add(key);
    fetch(`/api/data/${key}`)
      .then((r) => r.json())
      .then((serverData: unknown) => {
        if (Array.isArray(serverData) && serverData.length > 0) {
          console.log(`[storage] ${key} Supabase retornou ${serverData.length} registros`);
          const raw = JSON.stringify(serverData);
          if (IDB_KEYS.has(key)) {
            idbSet(key, serverData);
          } else {
            setLocalStorage(key, raw);
          }
          _cache.set(key, { raw, value: serverData });
          window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key } }));
        }
      })
      .catch((err) => console.error(`[storage] ${key} erro ao buscar Supabase:`, err));
  }, [key]);

  // Always-current ref so setData can compute functional updates without a React
  // state updater (avoids side effects during render / StrictMode double-invocations).
  const dataRef = useRef<T>(data);
  dataRef.current = data;

  const setData = useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (action) => {
      const next =
        typeof action === "function"
          ? (action as (p: T) => T)(dataRef.current)
          : action;
      // Skip write when a functional update returns the same reference — prevents
      // no-op effects (e.g. dedup checks) from overwriting IDB with the empty
      // initial state before IDB has finished loading asynchronously.
      if (next === dataRef.current) return;
      // saveData writes to localStorage, updates the cache, and dispatches the event.
      // useSyncExternalStore's subscriber picks it up → React calls clientSnapshot →
      // detects new reference → re-renders with the correct data.
      saveData(key, next);
    },
    [key]
  );

  return [data, setData];
}
