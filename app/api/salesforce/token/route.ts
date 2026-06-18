import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { clientId, clientSecret, urlBase } = await req.json();

    if (!clientId || !clientSecret || !urlBase) {
      return NextResponse.json(
        { error: "Preencha Client ID, Client Secret e URL Base." },
        { status: 400 }
      );
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });

    const endpoint = `${urlBase.replace(/\/$/, "")}/services/oauth2/token`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const text = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        { error: `Salesforce retornou HTTP ${response.status}: ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = JSON.parse(text);
    const accessToken = data.access_token;
    if (!accessToken) {
      return NextResponse.json(
        { error: "access_token não encontrado na resposta." },
        { status: 401 }
      );
    }

    return NextResponse.json({
      ok: true,
      accessToken,
      expiresIn: data.expires_in ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: `Erro de conexão: ${message}` }, { status: 500 });
  }
}
