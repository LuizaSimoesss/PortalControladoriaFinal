import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const nextPath = searchParams.get("nextPath"); // e.g. /services/data/v66.0/query/01g...
    const accessToken = req.headers.get("x-sf-token");
    const urlBase = req.headers.get("x-sf-url-base");

    if (!nextPath || !accessToken || !urlBase) {
      return NextResponse.json({ error: "Parâmetros obrigatórios: nextPath, x-sf-token, x-sf-url-base." }, { status: 400 });
    }

    const url = `${urlBase.replace(/\/$/, "")}${nextPath}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Sforce-Query-Options": "batchSize=2000",
      },
    });

    const text = await response.text();
    if (response.status === 401) return NextResponse.json({ error: "Token expirado ou inválido." }, { status: 401 });
    if (!response.ok) return NextResponse.json({ error: `Salesforce HTTP ${response.status}: ${text.slice(0, 300)}` }, { status: 502 });

    const data = JSON.parse(text);
    return NextResponse.json({
      ok: true,
      records: data.records ?? [],
      done: data.done ?? true,
      nextRecordsUrl: data.nextRecordsUrl ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: `Erro ao buscar próxima página: ${message}` }, { status: 500 });
  }
}
