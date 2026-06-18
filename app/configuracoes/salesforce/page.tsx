"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Wifi, WifiOff, RefreshCw, CheckCircle2, Eye, EyeOff, LogOut, ExternalLink,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import {
  saveConfig, loadConfig, saveSession, loadSession, clearSession,
  salesforceConnect, isSessionExpired,
  DEFAULT_URL_BASE,
  type SalesforceConfig, type SalesforceSession,
} from "@/lib/salesforce";

type Status = "idle" | "connecting" | "connected" | "error";

const defaultConfig: SalesforceConfig = {
  clientId: "",
  clientSecret: "",
  urlBase: DEFAULT_URL_BASE,
};

export default function SalesforceConfigPage() {
  const [config, setConfig] = useState<SalesforceConfig>(defaultConfig);
  const [session, setSession] = useState<SalesforceSession | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const cfg = loadConfig();
    if (cfg) setConfig(cfg);
    const sess = loadSession();
    if (sess) {
      if (isSessionExpired(sess)) clearSession();
      else { setSession(sess); setStatus("connected"); }
    }
  }, []);

  function setField<K extends keyof SalesforceConfig>(key: K, value: SalesforceConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleConnect() {
    setStatus("connecting");
    setErrorMsg("");
    saveConfig(config);
    try {
      const sess = await salesforceConnect(config);
      saveSession(sess);
      setSession(sess);
      setStatus("connected");
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Erro de conexão");
    }
  }

  function handleDisconnect() {
    clearSession();
    setSession(null);
    setStatus("idle");
  }

  const connectedAt = session?.connectedAt ? new Date(session.connectedAt).toLocaleString("pt-BR") : null;

  return (
    <div>
      <PageHeader
        title="Configuração › Integrações › Salesforce"
        subtitle="Credenciais OAuth 2.0"
      />

      <div className="p-6 space-y-6 max-w-2xl">

        {/* Status Banner */}
        <div className={`flex items-center gap-3 p-4 rounded-lg border ${
          status === "connected"     ? "bg-green-50 border-green-200 text-green-800"
          : status === "error"      ? "bg-red-50 border-red-200 text-red-800"
          : status === "connecting" ? "bg-blue-50 border-blue-200 text-blue-700"
          : "bg-slate-50 border-slate-200 text-slate-600"
        }`}>
          {status === "connected"   ? <Wifi size={18} /> :
           status === "connecting"  ? <RefreshCw size={18} className="animate-spin" /> :
           <WifiOff size={18} />}
          <div className="flex-1">
            {status === "connected"   && <><strong>Conectado ao Salesforce</strong>{connectedAt && <span className="text-sm ml-2 opacity-70">desde {connectedAt}</span>}</>}
            {status === "error"       && <><strong>Falha na conexão</strong><span className="text-sm ml-2">{errorMsg}</span></>}
            {status === "connecting"  && <strong>Conectando...</strong>}
            {status === "idle"        && <strong>Não conectado</strong>}
          </div>
          {status === "connected" && (
            <button onClick={handleDisconnect} className="flex items-center gap-1 text-sm font-medium hover:underline">
              <LogOut size={14} /> Desconectar
            </button>
          )}
        </div>

        {/* Credentials */}
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-slate-700 text-sm">OAuth 2.0 — Credenciais</span>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="form-label">URL Base *</label>
              <input className="form-input" value={config.urlBase} onChange={(e) => setField("urlBase", e.target.value)} placeholder={DEFAULT_URL_BASE} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Client ID *</label>
                <input className="form-input" value={config.clientId} onChange={(e) => setField("clientId", e.target.value)} placeholder="consumer_key" autoComplete="username" />
              </div>
              <div>
                <label className="form-label">Client Secret *</label>
                <div className="relative">
                  <input className="form-input pr-10" type={showSecret ? "text" : "password"} value={config.clientSecret} onChange={(e) => setField("clientSecret", e.target.value)} placeholder="consumer_secret" autoComplete="current-password" />
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setShowSecret((v) => !v)} type="button">
                    {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 flex-wrap">
          <button className="btn-secondary" onClick={handleSave}>
            {saved ? <><CheckCircle2 size={14} className="text-green-500" /> Salvo!</> : "Salvar Configurações"}
          </button>
          {status !== "connected" && (
            <button className="btn-primary" onClick={handleConnect} disabled={status === "connecting"}>
              {status === "connecting" ? <><RefreshCw size={14} className="animate-spin" /> Conectando...</> : <><Wifi size={14} /> Conectar</>}
            </button>
          )}
          {status === "connected" && (
            <Link
              href="/salesforce/consultas"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              <ExternalLink size={14} /> Ir para Consultas
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
