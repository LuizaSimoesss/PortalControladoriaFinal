export interface SalesforceConfig {
  clientId: string;
  clientSecret: string;
  urlBase: string;
}

export interface SalesforceSession {
  accessToken: string;
  connectedAt: string;
  expiresAt: number | null;
}

const CONFIG_KEY   = "salesforce_config_v1";
const SESSION_KEY  = "salesforce_session_v1";

export const DEFAULT_URL_BASE = "https://apxorg2.my.salesforce.com";

// ─── Module-level active session ─────────────────────────────────────────────
// Shared across all calls in the same browser tab.
// Updated whenever a token refresh happens, so paginated loops automatically
// use the new token without the caller needing to re-read localStorage.
let _active: SalesforceSession | null = null;

function getToken(): string | null {
  return (_active ?? loadSession())?.accessToken ?? null;
}

// ─── Config / session persistence ────────────────────────────────────────────

export function saveConfig(config: SalesforceConfig) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch {}
}

export function loadConfig(): SalesforceConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveSession(session: SalesforceSession) {
  _active = session;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
}

export function loadSession(): SalesforceSession | null {
  if (_active) return _active;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const s = raw ? (JSON.parse(raw) as SalesforceSession) : null;
    if (s) _active = s;
    return s;
  } catch { return null; }
}

export function clearSession() {
  _active = null;
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

export function isSessionExpired(session: SalesforceSession): boolean {
  if (!session.expiresAt) return false;
  return Date.now() >= session.expiresAt - 60_000; // 1-min safety margin
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function salesforceConnect(config: SalesforceConfig): Promise<SalesforceSession> {
  const res  = await fetch("/api/salesforce/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Falha na autenticação Salesforce");
  const session: SalesforceSession = {
    accessToken: data.accessToken,
    connectedAt: new Date().toISOString(),
    expiresAt: data.expiresIn ? Date.now() + data.expiresIn * 1000 : null,
  };
  saveSession(session); // updates _active + localStorage
  return session;
}

// ─── Auto-refresh helper ──────────────────────────────────────────────────────
// On 401, gets a new token and retries the fetch once. Transparent to callers.

async function fetchWithRefresh(
  config: SalesforceConfig,
  buildRequest: (token: string) => RequestInfo | URL,
  buildInit:    (token: string) => RequestInit | undefined,
): Promise<Response> {
  const token1 = getToken();
  if (!token1) throw new Error("Sessão não encontrada. Reconecte em Configurações › Salesforce.");

  const res = await fetch(buildRequest(token1), buildInit(token1));

  if (res.status !== 401) return res;

  // 401 → refresh token and retry once
  const config2 = config ?? loadConfig();
  if (!config2) throw new Error("Configuração Salesforce não encontrada.");

  const newSession = await salesforceConnect(config2); // saves to _active + localStorage
  const res2 = await fetch(buildRequest(newSession.accessToken), buildInit(newSession.accessToken));
  return res2;
}

// ─── API functions ────────────────────────────────────────────────────────────

export interface SalesforceObject {
  name: string;
  label: string;
  queryable: boolean;
  retrieveable: boolean;
}

export async function salesforceListObjects(
  config: SalesforceConfig,
  _session: SalesforceSession
): Promise<SalesforceObject[]> {
  const res  = await fetchWithRefresh(
    config,
    token => `/api/salesforce/objects`,
    token => ({ headers: { "x-sf-token": token, "x-sf-url-base": config.urlBase } }),
  );
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.sobjects;
}

export interface SalesforceField {
  name: string;
  label: string;
  type: string;
}

export async function salesforceDescribe(
  config: SalesforceConfig,
  _session: SalesforceSession,
  objeto: string
): Promise<{ fields: SalesforceField[]; label: string }> {
  const res  = await fetchWithRefresh(
    config,
    token => `/api/salesforce/describe?objeto=${encodeURIComponent(objeto)}`,
    token => ({ headers: { "x-sf-token": token, "x-sf-url-base": config.urlBase } }),
  );
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { fields: data.fields, label: data.label };
}

export async function salesforceSoql(
  config: SalesforceConfig,
  _session: SalesforceSession,
  soql: string
): Promise<{ records: Record<string, unknown>[]; totalSize: number; done: boolean; nextRecordsUrl: string | null }> {
  const res  = await fetchWithRefresh(
    config,
    token => `/api/salesforce/soql`,
    token => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: soql, token, urlBase: config.urlBase }),
    }),
  );
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { records: data.records, totalSize: data.totalSize, done: data.done, nextRecordsUrl: data.nextRecordsUrl };
}

export async function salesforceNextPage(
  config: SalesforceConfig,
  _session: SalesforceSession,
  nextPath: string
): Promise<{ records: Record<string, unknown>[]; done: boolean; nextRecordsUrl: string | null }> {
  const res  = await fetchWithRefresh(
    config,
    token => `/api/salesforce/next?nextPath=${encodeURIComponent(nextPath)}`,
    token => ({ headers: { "x-sf-token": token, "x-sf-url-base": config.urlBase } }),
  );
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { records: data.records, done: data.done, nextRecordsUrl: data.nextRecordsUrl };
}

export async function salesforceQuery(
  config: SalesforceConfig,
  _session: SalesforceSession,
  objeto: string,
  id: string,
  fields?: string
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ objeto, id });
  if (fields) params.set("fields", fields);

  const res  = await fetchWithRefresh(
    config,
    token => `/api/salesforce/query?${params}`,
    token => ({ headers: { "x-sf-token": token, "x-sf-url-base": config.urlBase } }),
  );
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.record;
}
