import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const objeto = searchParams.get("objeto");
    const accessToken = req.headers.get("x-sf-token");
    const urlBase = req.headers.get("x-sf-url-base");

    if (!objeto || !accessToken || !urlBase) {
      return NextResponse.json(
        { error: "Parâmetros obrigatórios: objeto, x-sf-token, x-sf-url-base." },
        { status: 400 }
      );
    }

    const url = `${urlBase.replace(/\/$/, "")}/services/data/v66.0/sobjects/${objeto}/describe/`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });

    const text = await response.text();
    if (response.status === 401) return NextResponse.json({ error: "Token expirado ou inválido." }, { status: 401 });
    if (!response.ok) return NextResponse.json({ error: `Salesforce HTTP ${response.status}: ${text.slice(0, 300)}` }, { status: 502 });

    const data = JSON.parse(text);

    // Exclude compound/non-queryable field types and fields Salesforce marks as non-queryable
    const NON_QUERYABLE_TYPES = new Set(["base64", "location", "address", "encryptedstring", "anyType"]);
    const fields = (data.fields ?? [])
      .filter((f: { name: string; type: string; queryable?: boolean }) =>
        !NON_QUERYABLE_TYPES.has(f.type) && f.queryable !== false
      )
      .map((f: { name: string; label: string; type: string }) => ({
        name: f.name,
        label: f.label,
        type: f.type,
      }));

    return NextResponse.json({ ok: true, fields, label: data.label });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: `Erro ao descrever objeto: ${message}` }, { status: 500 });
  }
}
