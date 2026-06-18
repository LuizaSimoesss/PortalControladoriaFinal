import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("x-sf-token");
    const urlBase = req.headers.get("x-sf-url-base");

    if (!accessToken || !urlBase) {
      return NextResponse.json(
        { error: "Headers obrigatórios: x-sf-token, x-sf-url-base." },
        { status: 400 }
      );
    }

    const url = `${urlBase.replace(/\/$/, "")}/services/data/v66.0/sobjects/`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();

    if (response.status === 401) {
      return NextResponse.json({ error: "Token expirado ou inválido." }, { status: 401 });
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Salesforce retornou HTTP ${response.status}: ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = JSON.parse(text);
    const sobjects: { name: string; label: string; queryable: boolean; retrieveable: boolean }[] =
      (data.sobjects ?? [])
        .filter((o: { retrieveable?: boolean }) => o.retrieveable)
        .map((o: { name: string; label: string; queryable: boolean; retrieveable: boolean }) => ({
          name: o.name,
          label: o.label,
          queryable: o.queryable,
          retrieveable: o.retrieveable,
        }));

    return NextResponse.json({ ok: true, sobjects });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: `Erro ao listar objetos: ${message}` }, { status: 500 });
  }
}
