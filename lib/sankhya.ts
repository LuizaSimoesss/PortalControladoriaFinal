export type AuthMethod = "oauth" | "legacy";
export type Environment = "production" | "sandbox";

export interface SankhyaConfig {
  environment: Environment;
  authMethod: AuthMethod;
  // OAuth 2.0
  clientId: string;
  clientSecret: string;
  xToken: string;
  // Legacy
  token: string;
  appkey: string;
  username: string;
  password: string;
}

export interface SankhyaSession {
  bearerToken: string;
  connectedAt: string;
}

const CONFIG_KEY = "sankhya_config_v2";
const SESSION_KEY = "sankhya_session_v2";

export function getBaseUrl(env: Environment): string {
  return env === "sandbox"
    ? "https://api.sandbox.sankhya.com.br"
    : "https://api.sankhya.com.br";
}

export function saveConfig(config: SankhyaConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function loadConfig(): SankhyaConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: SankhyaSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(): SankhyaSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export async function sankhyaLogin(config: SankhyaConfig): Promise<string> {
  const res = await fetch("/api/sankhya/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  let data: { ok?: boolean; bearerToken?: string; error?: string };
  try {
    data = await res.json();
  } catch {
    if (res.status === 404) {
      throw new Error("Rota da API não encontrada (HTTP 404). O servidor pode ainda estar inicializando — aguarde alguns segundos e tente novamente.");
    }
    throw new Error(`Servidor retornou HTTP ${res.status} sem JSON.`);
  }
  if (!data.ok) throw new Error(data.error || "Falha na autenticação");
  return data.bearerToken as string;
}

export interface SankhyaEntityQuery {
  entity: string;
  sqlTable: string;
  fields: string;
  filter?: string;
  sqlFilter?: string;
  sqlOrder?: string;
  // When set, bypasses CRUD entirely and runs this SQL via DbExplorerSP.
  // Use this for hierarchical tables where the CRUD entity endpoint returns
  // only root-level records instead of all rows.
  sql?: string;
}

export interface SankhyaQueryResult {
  rows: Record<string, unknown>[];
  sankhyaTotal: number;
}

function isAuthError(msg: string): boolean {
  return /HTTP 40[0-3]|token|sessão|session|autenti|unauthorized|invalid.*token|expired|acesso negado|access denied/i.test(msg);
}

async function doQueryRequest(
  config: SankhyaConfig,
  bearerToken: string,
  query: SankhyaEntityQuery
): Promise<{ ok: boolean; authExpired?: boolean; rows?: Record<string, unknown>[]; sankhyaTotal?: number; error?: string }> {
  const res = await fetch("/api/sankhya/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      environment: config.environment,
      bearerToken,
      xToken: config.xToken || undefined,
      appkey: config.appkey || undefined,
      // If the query has an explicit SQL string, send only that — the route will
      // use DbExplorerSP.executeQuery directly and skip the CRUD path entirely.
      ...(query.sql
        ? { sql: query.sql }
        : {
            entity: query.entity,
            sqlTable: query.sqlTable,
            fields: query.fields,
            filter: query.filter,
            sqlFilter: query.sqlFilter,
            sqlOrder: query.sqlOrder,
          }),
    }),
  });
  try {
    const data = await res.json();
    // HTTP 401 from the route always means the bearer token expired
    if (res.status === 401) return { ok: false, authExpired: true, error: data.error };
    return data;
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
}

export async function sankhyaQuery(
  config: SankhyaConfig,
  bearerToken: string,
  query: SankhyaEntityQuery
): Promise<SankhyaQueryResult> {
  let data = await doQueryRequest(config, bearerToken, query);

  // Auto-refresh token on auth errors (HTTP 401 or matching error string) and retry once
  if (!data.ok && (data.authExpired || isAuthError(data.error ?? ""))) {
    try {
      const newToken = await sankhyaLogin(config);
      saveSession({ bearerToken: newToken, connectedAt: new Date().toISOString() });
      data = await doQueryRequest(config, newToken, query);
    } catch {
      throw new Error("Sessão expirada e reconexão falhou. Verifique suas credenciais em Configurações.");
    }
  }

  if (!data.ok) throw new Error(data.error || "Erro na consulta");
  return { rows: data.rows as Record<string, unknown>[], sankhyaTotal: data.sankhyaTotal ?? data.rows?.length ?? 0 };
}

export async function sankhyaLogout(config: SankhyaConfig, bearerToken: string) {
  await fetch("/api/sankhya/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      environment: config.environment,
      bearerToken,
      xToken: config.xToken || undefined,
      appkey: config.appkey || undefined,
    }),
  }).catch(() => {});
  clearSession();
}

export const QUERIES: Record<string, SankhyaEntityQuery> = {
  NATUREZA: {
    entity: "Natureza", sqlTable: "TGFNAT",
    fields: "CODNAT,DESCRNAT,GRAU,ANALITICA,ATIVA", sqlOrder: "CODNAT",
    sql: "SELECT CODNAT, DESCRNAT, GRAU, ANALITICA, ATIVA FROM TGFNAT ORDER BY CODNAT",
  },
  CENTRO_RESULTADO: {
    entity: "CentroResultado", sqlTable: "TSICUS",
    fields: "CODCENCUS,DESCRCENCUS,ATIVO,GRAU,ANALITICO", sqlOrder: "CODCENCUS",
    sql: "SELECT CODCENCUS, DESCRCENCUS, ATIVO, GRAU, ANALITICO FROM TSICUS ORDER BY CODCENCUS",
  },
  PROJETOS: {
    entity: "Projeto", sqlTable: "TCSPRJ",
    fields: "CODPROJ,IDENTIFICACAO,ATIVO,GRAU,ANALITICO", sqlOrder: "CODPROJ",
    sql: "SELECT CODPROJ, IDENTIFICACAO, ATIVO, GRAU, ANALITICO FROM TCSPRJ ORDER BY CODPROJ",
  },
  PARCEIRO: {
    entity: "Parceiro", sqlTable: "TGFPAR",
    fields: "CODPARC,NOMEPARC", sqlOrder: "CODPARC",
    sql: "SELECT CODPARC, NOMEPARC FROM TGFPAR ORDER BY CODPARC",
  },
  EMPRESAS: {
    entity: "Empresa", sqlTable: "TSIEMP",
    fields: "CODEMP,RAZAOSOCIAL,AD_EMPCLASS", sqlOrder: "CODEMP",
    sql: "SELECT CODEMP, RAZAOSOCIAL, AD_EMPCLASS FROM TSIEMP ORDER BY CODEMP",
  },
};
