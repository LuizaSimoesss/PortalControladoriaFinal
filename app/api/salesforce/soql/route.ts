import { NextRequest, NextResponse } from "next/server";

async function runSoql(soql: string, accessToken: string, urlBase: string) {
  const base = urlBase.replace(/\/$/, "");
  const url = `${base}/services/data/v66.0/query/?q=${encodeURIComponent(soql)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Sforce-Query-Options": "batchSize=2000",
    },
  });
  const text = await response.text();
  if (response.status === 401) throw new Error("Token expirado ou inválido.");
  if (!response.ok) throw new Error(`Salesforce HTTP ${response.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text);
  return {
    ok: true,
    records: data.records ?? [],
    totalSize: data.totalSize ?? 0,
    done: data.done ?? true,
    nextRecordsUrl: data.nextRecordsUrl ?? null,
  };
}

// POST — body: { q, token, urlBase }  (avoids URL length limits for large field lists)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { q, token, urlBase } = body ?? {};
    if (!q || !token || !urlBase) {
      return NextResponse.json({ error: "Parâmetros obrigatórios: q, token, urlBase." }, { status: 400 });
    }
    return NextResponse.json(await runSoql(q, token, urlBase));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: message.includes("Token") ? 401 : 502 });
  }
}

// GET — kept for backward compatibility with short queries
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q");
    const accessToken = req.headers.get("x-sf-token");
    const urlBase = req.headers.get("x-sf-url-base");
    if (!q || !accessToken || !urlBase) {
      return NextResponse.json({ error: "Parâmetros obrigatórios: q, x-sf-token, x-sf-url-base." }, { status: 400 });
    }
    return NextResponse.json(await runSoql(q, accessToken, urlBase));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: message.includes("Token") ? 401 : 502 });
  }
}
