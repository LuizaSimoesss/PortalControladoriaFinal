"use client";

import { useState, useEffect } from "react";
import {
  Wifi, WifiOff, RefreshCw, CheckCircle2,
  AlertCircle, Eye, EyeOff, LogOut, Database, Download,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import {
  saveConfig, loadConfig, saveSession, loadSession, clearSession,
  sankhyaLogin, sankhyaLogout, sankhyaQuery, QUERIES,
  type SankhyaConfig, type SankhyaSession, type AuthMethod, type Environment,
} from "@/lib/sankhya";
import { saveData, loadDataAsync, markStorageInitialized } from "@/lib/storage";
import type {
  NaturezaRow, CentroResultadoRow, ProjetoRow, ParceiroRow, EmpresaRow, TipoRegistro,
} from "@/lib/mockData";

type Status = "idle" | "connecting" | "connected" | "error";

interface TestResult {
  table: string;
  rows: number;
  sankhyaTotal?: number;
  ok: boolean;
  error?: string;
}

const defaultConfig: SankhyaConfig = {
  environment: "production",
  authMethod: "oauth",
  clientId: "",
  clientSecret: "",
  xToken: "",
  token: "",
  appkey: "",
  username: "",
  password: "",
};

export default function ConfiguracoesPage() {
  const [config, setConfig] = useState<SankhyaConfig>(defaultConfig);
  const [session, setSession] = useState<SankhyaSession | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ label: string; count: number; status: "pending" | "running" | "done" | "error"; error?: string }[]>([]);

  useEffect(() => {
    const cfg = loadConfig();
    if (cfg) setConfig(cfg);
    const sess = loadSession();
    if (sess) { setSession(sess); setStatus("connected"); }
  }, []);

  function set<K extends keyof SankhyaConfig>(key: K, value: SankhyaConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleConnect(retryCount = 0) {
    setStatus("connecting");
    setErrorMsg(retryCount > 0 ? `Servidor iniciando, tentativa ${retryCount + 1}/3...` : "");
    saveConfig(config);
    try {
      const bearerToken = await sankhyaLogin(config);
      const sess: SankhyaSession = { bearerToken, connectedAt: new Date().toISOString() };
      saveSession(sess);
      setSession(sess);
      setStatus("connected");
      setErrorMsg("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro de conexão";
      // Auto-retry on 404 (server still warming up after restart), up to 2 retries
      if (msg.includes("HTTP 404") && retryCount < 2) {
        setErrorMsg(`Servidor iniciando, nova tentativa em 3s... (${retryCount + 1}/2)`);
        setTimeout(() => handleConnect(retryCount + 1), 3000);
        return;
      }
      setStatus("error");
      setErrorMsg(msg);
    }
  }

  async function handleDisconnect() {
    if (!session) return;
    await sankhyaLogout(config, session.bearerToken);
    clearSession();
    setSession(null);
    setStatus("idle");
    setTestResults([]);
  }

  async function handleSyncAll() {
    if (!session) return;
    setSyncingAll(true);
    markStorageInitialized();
    const tables = [
      { label: "Natureza (TGFNAT)",            query: QUERIES.NATUREZA,          key: "portal_natureza" },
      { label: "Centro de Resultado (TSICUS)", query: QUERIES.CENTRO_RESULTADO,  key: "portal_centro_resultado" },
      { label: "Projetos (TCSPRJ)",            query: QUERIES.PROJETOS,          key: "portal_projetos" },
      { label: "Parceiro (TGFPAR)",            query: QUERIES.PARCEIRO,          key: "portal_parceiro" },
      { label: "Empresas (TSIEMP)",            query: QUERIES.EMPRESAS,          key: "portal_empresas" },
    ];
    setSyncProgress(tables.map(t => ({ label: t.label, count: 0, status: "pending" })));

    for (let i = 0; i < tables.length; i++) {
      const t = tables[i];
      setSyncProgress(p => p.map((x, j) => j === i ? { ...x, status: "running" } : x));
      try {
        // Always reload session from localStorage — a previous table's auto-refresh may have saved a new token
        const currentSession = loadSession() ?? session;
        const { rows } = await sankhyaQuery(config, currentSession.bearerToken, t.query);
        // Update React state if token was refreshed during this query
        const refreshedSession = loadSession();
        if (refreshedSession && refreshedSession.bearerToken !== currentSession.bearerToken) {
          setSession(refreshedSession);
        }
        const nativo = mapToNativo(t.key, rows);
        // Preserve manually-created GERENCIAL records (use async load for IDB-backed keys)
        const prev = await loadDataAsync<{ TIPO_REGISTRO?: string }[]>(t.key, []);
        const gerencial = prev.filter(r => r.TIPO_REGISTRO === "GERENCIAL");
        saveData(t.key, [...nativo, ...gerencial]);
        setSyncProgress(p => p.map((x, j) => j === i ? { ...x, status: "done", count: nativo.length } : x));
      } catch (err) {
        setSyncProgress(p => p.map((x, j) => j === i ? { ...x, status: "error", error: err instanceof Error ? err.message : String(err) } : x));
      }
    }
    const finalSession = loadSession();
    if (finalSession) setSession(finalSession);
    setSyncingAll(false);
  }

  function mapToNativo(key: string, rows: Record<string, unknown>[]): unknown[] {
    if (key === "portal_natureza") {
      const uniqueNat = Array.from(new Map(rows.map(r => [String(r.CODNAT ?? ""), r])).values());
      return uniqueNat.map((r): NaturezaRow => ({
        id: `sync_nat_${String(r.CODNAT ?? "")}`, CODNAT: String(r.CODNAT ?? ""), DESCRNAT: String(r.DESCRNAT ?? ""),
        GRAU: Number(r.GRAU ?? 1), ANALITICA: r.ANALITICA === "S" || r.ANALITICA === true,
        ATIVA: r.ATIVA === "S" || r.ATIVA === true, TIPO_REGISTRO: "NATIVO" as TipoRegistro,
        ENTRA_RESULTADO: "DRE", CLASSIFICACAO: "", PACOTES: "",
      }));
    }
    if (key === "portal_centro_resultado") {
      return rows.map((r, i): CentroResultadoRow => ({
        id: `sync_cr_${i}`, CODCENCUS: String(r.CODCENCUS ?? ""), DESCRCENCUS: String(r.DESCRCENCUS ?? ""),
        ATIVO: r.ATIVO === "S" || r.ATIVO === true, GRAU: Number(r.GRAU ?? 1),
        ANALITICO: r.ANALITICO === "S" || r.ANALITICO === true, TIPO_REGISTRO: "NATIVO" as TipoRegistro,
        ENTRA_RESULTADO: "DRE", CLASSIFICACAO: "",
      }));
    }
    if (key === "portal_projetos") {
      return rows.map((r, i): ProjetoRow => ({
        id: `sync_prj_${i}`, CODPROJ: String(r.CODPROJ ?? ""), IDENTIFICACAO: String(r.IDENTIFICACAO ?? ""),
        ATIVO: r.ATIVO === "S" || r.ATIVO === true, GRAU: Number(r.GRAU ?? 1),
        ANALITICO: r.ANALITICO === "S" || r.ANALITICO === true, TIPO_REGISTRO: "NATIVO" as TipoRegistro,
      }));
    }
    if (key === "portal_parceiro") {
      return rows.map((r): ParceiroRow => ({
        id: `parc_${r.CODPARC ?? ""}`, CODPARC: String(r.CODPARC ?? ""),
        NOMEPARC: String(r.NOMEPARC ?? ""), TIPO_REGISTRO: "NATIVO" as TipoRegistro,
      }));
    }
    if (key === "portal_empresas") {
      return rows.map((r, i): EmpresaRow => ({
        id: `sync_emp_${i}`, CODEMP: String(r.CODEMP ?? ""), RAZAOSOCIAL: String(r.RAZAOSOCIAL ?? ""),
        TIPO_REGISTRO: "NATIVO" as TipoRegistro, ENTRA_RESULTADO: "NÃO ENTRA",
        AD_EMPCLASS: String(r.AD_EMPCLASS ?? ""),
      }));
    }
    return [];
  }

  async function handleTestTables() {
    if (!session) return;
    setTesting(true);
    setTestResults([]);
    const tables = [
      { table: "Natureza (TGFNAT)",             query: QUERIES.NATUREZA         },
      { table: "Centro de Resultado (TSICUS)",  query: QUERIES.CENTRO_RESULTADO },
      { table: "Projetos (TCSPRJ)",             query: QUERIES.PROJETOS         },
      { table: "Parceiro (TGFPAR)",             query: QUERIES.PARCEIRO         },
      { table: "Empresas (TSIEMP)",             query: QUERIES.EMPRESAS         },
    ];

    const results: TestResult[] = [];
    for (const t of tables) {
      try {
        const result = await sankhyaQuery(config, session.bearerToken, t.query);
        results.push({ table: t.table, rows: result.rows.length, sankhyaTotal: result.sankhyaTotal, ok: true });
      } catch (err: unknown) {
        results.push({ table: t.table, rows: 0, ok: false, error: err instanceof Error ? err.message : "Erro" });
      }
      setTestResults([...results]);
    }
    setTesting(false);
  }

  const connectedAt = session?.connectedAt
    ? new Date(session.connectedAt).toLocaleString("pt-BR")
    : null;

  return (
    <div>
      <PageHeader
        title="Configuração › Integrações › Sankhya"
        subtitle="Configuração da API Sankhya Gateway"
      />

      <div className="p-6 max-w-2xl space-y-6">

        {/* Status Banner */}
        <div className={`flex items-center gap-3 p-4 rounded-lg border ${
          status === "connected"   ? "bg-green-50 border-green-200 text-green-800"
          : status === "error"    ? "bg-red-50 border-red-200 text-red-800"
          : status === "connecting" ? "bg-blue-50 border-blue-200 text-blue-700"
          : "bg-slate-50 border-slate-200 text-slate-600"
        }`}>
          {status === "connected"   ? <Wifi size={18} /> :
           status === "connecting" ? <RefreshCw size={18} className="animate-spin" /> :
           <WifiOff size={18} />}
          <div className="flex-1">
            {status === "connected"   && <><strong>Conectado ao Sankhya</strong>{connectedAt && <span className="text-sm ml-2 opacity-70">desde {connectedAt}</span>}</>}
            {status === "error"       && <><strong>Falha na conexão</strong><span className="text-sm ml-2">{errorMsg}</span></>}
            {status === "connecting" && <strong>Conectando...</strong>}
            {status === "idle"        && <strong>Não conectado</strong>}
          </div>
          {status === "connected" && (
            <button onClick={handleDisconnect} className="flex items-center gap-1 text-sm font-medium hover:underline">
              <LogOut size={14} /> Desconectar
            </button>
          )}
        </div>

        {/* Environment & Auth Method */}
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-slate-700 text-sm">Ambiente e Método de Autenticação</span>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Ambiente</label>
                <select
                  className="form-input"
                  value={config.environment}
                  onChange={(e) => set("environment", e.target.value as Environment)}
                >
                  <option value="production">Produção</option>
                  <option value="sandbox">Sandbox</option>
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  {config.environment === "sandbox"
                    ? "api.sandbox.sankhya.com.br"
                    : "api.sankhya.com.br"}
                </p>
              </div>
              <div>
                <label className="form-label">Método de Autenticação</label>
                <select
                  className="form-input"
                  value={config.authMethod}
                  onChange={(e) => set("authMethod", e.target.value as AuthMethod)}
                >
                  <option value="oauth">OAuth 2.0 (recomendado)</option>
                  <option value="legacy">Legacy (depreciado)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* OAuth 2.0 Fields */}
        {config.authMethod === "oauth" && (
          <div className="card">
            <div className="card-header">
              <div>
                <span className="font-bold text-slate-700 text-sm">OAuth 2.0 — Credenciais</span>
                <p className="text-xs text-slate-400 mt-0.5">Credenciais geradas no Portal do Desenvolvedor Sankhya.</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="form-label">X-Token *</label>
                <input
                  className="form-input"
                  value={config.xToken}
                  onChange={(e) => set("xToken", e.target.value)}
                  placeholder="Token de acesso ao gateway"
                />
                <p className="text-xs text-slate-400 mt-1">Header <code className="bg-slate-100 px-1 rounded">X-Token</code> enviado na autenticação.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Client ID *</label>
                  <input
                    className="form-input"
                    value={config.clientId}
                    onChange={(e) => set("clientId", e.target.value)}
                    placeholder="client_id"
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="form-label">Client Secret *</label>
                  <div className="relative">
                    <input
                      className="form-input pr-10"
                      type={showSecret ? "text" : "password"}
                      value={config.clientSecret}
                      onChange={(e) => set("clientSecret", e.target.value)}
                      placeholder="client_secret"
                      autoComplete="current-password"
                    />
                    <button
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      onClick={() => setShowSecret((v) => !v)}
                      type="button"
                    >
                      {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Legacy Fields */}
        {config.authMethod === "legacy" && (
          <div className="card">
            <div className="card-header">
              <div>
                <span className="font-bold text-slate-700 text-sm">Legacy — Credenciais</span>
                <p className="text-xs text-slate-400 mt-0.5">
                  <span className="text-amber-600 font-medium">Depreciado em abril/2026.</span> Prefira OAuth 2.0.
                </p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Token *</label>
                  <input
                    className="form-input"
                    value={config.token}
                    onChange={(e) => set("token", e.target.value)}
                    placeholder="token"
                  />
                </div>
                <div>
                  <label className="form-label">App Key *</label>
                  <input
                    className="form-input"
                    value={config.appkey}
                    onChange={(e) => set("appkey", e.target.value)}
                    placeholder="appkey"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Usuário *</label>
                  <input
                    className="form-input"
                    value={config.username}
                    onChange={(e) => set("username", e.target.value)}
                    placeholder="usuário Sankhya"
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="form-label">Senha *</label>
                  <div className="relative">
                    <input
                      className="form-input pr-10"
                      type={showPass ? "text" : "password"}
                      value={config.password}
                      onChange={(e) => set("password", e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                    <button
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      onClick={() => setShowPass((v) => !v)}
                      type="button"
                    >
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button className="btn-secondary" onClick={handleSave}>
            {saved ? <><CheckCircle2 size={14} className="text-green-500" /> Salvo!</> : "Salvar Configurações"}
          </button>
          {status !== "connected" ? (
            <button
              className="btn-primary"
              onClick={() => handleConnect()}
              disabled={status === "connecting"}
            >
              {status === "connecting"
                ? <><RefreshCw size={14} className="animate-spin" /> Conectando...</>
                : <><Wifi size={14} /> Conectar</>}
            </button>
          ) : (
            <>
              <button className="btn-sync" onClick={handleTestTables} disabled={testing || syncingAll}>
                <Database size={14} className={testing ? "animate-pulse" : ""} />
                {testing ? "Verificando..." : "Verificar Tabelas"}
              </button>
              <button
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ background: "#16a34a" }}
                onClick={handleSyncAll}
                disabled={syncingAll || testing}
              >
                <Download size={14} className={syncingAll ? "animate-bounce" : ""} />
                {syncingAll ? "Sincronizando..." : "Sincronizar Todos"}
              </button>
            </>
          )}
        </div>

        {/* Test Results */}
        {testResults.length > 0 && (
          <div className="card">
            <div className="card-header">
              <span className="font-bold text-slate-700 text-sm">Resultado da Verificação de Tabelas</span>
              <span className="text-xs text-slate-400">{testResults.filter(r => r.ok).length}/{testResults.length} tabelas OK</span>
            </div>
            <div className="divide-y divide-slate-100">
              {testResults.map((r) => (
                <div key={r.table} className="flex items-center gap-3 px-5 py-3">
                  {r.ok
                    ? <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                    : <AlertCircle size={16} className="text-red-500 flex-shrink-0" />}
                  <div className="flex-1">
                    <span className="text-sm font-medium text-slate-700">{r.table}</span>
                    {r.error && <p className="text-xs text-red-500 mt-0.5">{r.error}</p>}
                  </div>
                  {r.ok && (
                    <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                      {r.rows} / {r.sankhyaTotal ?? "?"} registros
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sync All Progress */}
        {syncProgress.length > 0 && (
          <div className="card">
            <div className="card-header">
              <span className="font-bold text-slate-700 text-sm">Sincronização de Cadastros</span>
              <span className="text-xs text-slate-400">
                {syncProgress.filter(r => r.status === "done").length}/{syncProgress.length} concluídas
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {syncProgress.map((r) => (
                <div key={r.label} className="flex items-center gap-3 px-5 py-3">
                  {r.status === "done"    && <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />}
                  {r.status === "error"   && <AlertCircle  size={16} className="text-red-500 flex-shrink-0" />}
                  {r.status === "running" && <RefreshCw    size={16} className="text-blue-500 flex-shrink-0 animate-spin" />}
                  {r.status === "pending" && <div className="w-4 h-4 rounded-full border-2 border-slate-200 flex-shrink-0" />}
                  <div className="flex-1">
                    <span className="text-sm font-medium text-slate-700">{r.label}</span>
                    {r.error && <p className="text-xs text-red-500 mt-0.5">{r.error}</p>}
                  </div>
                  {r.status === "done" && (
                    <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                      {r.count} registros
                    </span>
                  )}
                  {r.status === "running" && (
                    <span className="text-xs text-blue-600">buscando...</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info */}
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 space-y-1">
          <p className="font-semibold">Como funciona a integração</p>
          <ul className="text-xs space-y-1 list-disc ml-4">
            <li>O portal usa a <strong>API Gateway Sankhya</strong> via OAuth 2.0 (<code className="bg-blue-100 px-1 rounded">client_credentials</code>).</li>
            <li>OAuth 2.0: <code className="bg-blue-100 px-1 rounded">POST /authenticate</code> com <code className="bg-blue-100 px-1 rounded">X-Token</code>, <code className="bg-blue-100 px-1 rounded">client_id</code> e <code className="bg-blue-100 px-1 rounded">client_secret</code>.</li>
            <li>Todas as consultas usam <code className="bg-blue-100 px-1 rounded">Authorization: Bearer &lt;token&gt;</code>.</li>
            <li>Credenciais ficam salvas apenas no seu navegador (localStorage).</li>
            <li>Dados sincronizados ficam marcados como <strong>NATIVO</strong> e não podem ser editados.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
