import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const objeto = searchParams.get("objeto");
    const id = searchParams.get("id");
    const fields = searchParams.get("fields");

    const accessToken = req.headers.get("x-sf-token");
    const urlBase = req.headers.get("x-sf-url-base");

    if (!objeto || !id || !accessToken || !urlBase) {
      return NextResponse.json(
        { error: "Parâmetros obrigatórios: objeto, id, x-sf-token, x-sf-url-base." },
        { status: 400 }
      );
    }

    const base = urlBase.replace(/\/$/, "");
    let url = `${base}/services/data/v66.0/sobjects/${objeto}/${id}`;
    if (fields) url += `?fields=${encodeURIComponent(fields)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();

    if (response.status === 401) {
      return NextResponse.json(
        { error: "Token expirado ou inválido." },
        { status: 401 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Salesforce retornou HTTP ${response.status}: ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const record = JSON.parse(text);
    return NextResponse.json({ ok: true, record });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: `Erro de consulta: ${message}` }, { status: 500 });
  }
}
