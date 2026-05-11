"use client";

import { useSyncExternalStore, useCallback, useRef } from "react";

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

const EVENT_NAME = "portal-data-update";

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
    _migrated = true;
  } catch {}
}

function getSnapshot<T>(key: string, fallback: T): T {
  try {
    migrateIfNeeded();
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const cached = _cache.get(key);
    // Same JSON string → return the same object reference (no re-render).
    if (cached && cached.raw === raw) return cached.value as T;
    const value = JSON.parse(raw) as T;
    _cache.set(key, { raw, value });
    return value;
  } catch {
    return fallback;
  }
}

export function markStorageInitialized() {
  try {
    localStorage.setItem(PORTAL_VERSION_KEY, PORTAL_VERSION);
  } catch {}
}

export function loadData<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {}
  return fallback;
}

export function saveData<T>(key: string, data: T): boolean {
  try {
    const raw = JSON.stringify(data);
    localStorage.setItem(key, raw);
    // Pre-populate the cache with the exact reference we just saved.
    // This way the next getSnapshot call returns the same reference → no extra re-render.
    _cache.set(key, { raw, value: data });
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key } }));
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
      // saveData writes to localStorage, updates the cache, and dispatches the event.
      // useSyncExternalStore's subscriber picks it up → React calls clientSnapshot →
      // detects new reference → re-renders with the correct data.
      saveData(key, next);
    },
    [key]
  );

  return [data, setData];
}
