import { NextRequest, NextResponse } from "next/server";

function getBaseUrl(env: string): string {
  return env === "sandbox"
    ? "https://api.sandbox.sankhya.com.br"
    : "https://api.sankhya.com.br";
}

export async function POST(req: NextRequest) {
  try {
    const config = await req.json();
    const { authMethod, environment } = config;
    const baseUrl = getBaseUrl(environment);

    if (authMethod === "oauth") {
      const { clientId, clientSecret, xToken } = config;
      if (!clientId || !clientSecret || !xToken) {
        return NextResponse.json({ error: "Preencha client_id, client_secret e X-Token." }, { status: 400 });
      }

      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await fetch(`${baseUrl}/authenticate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Token": xToken,
        },
        body: body.toString(),
      });

      const text = await response.text();
      if (!response.ok) {
        return NextResponse.json(
          { error: `Sankhya retornou HTTP ${response.status}: ${text.slice(0, 200)}` },
          { status: 502 }
        );
      }

      const data = JSON.parse(text);
      const bearerToken = data.access_token || data.bearerToken || data.token;
      if (!bearerToken) {
        return NextResponse.json({ error: "Token não encontrado na resposta." }, { status: 401 });
      }

      return NextResponse.json({ ok: true, bearerToken });

    } else {
      // Legacy auth
      const { token, appkey, username, password } = config;
      if (!token || !appkey || !username || !password) {
        return NextResponse.json({ error: "Preencha token, appkey, usuário e senha." }, { status: 400 });
      }

      const response = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          token,
          appkey,
          username,
          password,
        },
      });

      const text = await response.text();
      if (!response.ok) {
        return NextResponse.json(
          { error: `Sankhya retornou HTTP ${response.status}: ${text.slice(0, 200)}` },
          { status: 502 }
        );
      }

      const data = JSON.parse(text);
      const bearerToken = data.access_token || data.bearerToken || data.token || data.jwtToken;
      if (!bearerToken) {
        return NextResponse.json({ error: "Token não encontrado na resposta." }, { status: 401 });
      }

      return NextResponse.json({ ok: true, bearerToken });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: `Erro de conexão: ${message}` }, { status: 500 });
  }
}
