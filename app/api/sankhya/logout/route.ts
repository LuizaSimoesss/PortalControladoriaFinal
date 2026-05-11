import { NextRequest, NextResponse } from "next/server";

function getBaseUrl(env: string): string {
  return env === "sandbox"
    ? "https://api.sandbox.sankhya.com.br"
    : "https://api.sankhya.com.br";
}

export async function POST(req: NextRequest) {
  try {
    const { environment, bearerToken, xToken, appkey } = await req.json();
    if (!bearerToken) return NextResponse.json({ ok: true });

    const baseUrl = getBaseUrl(environment || "production");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    };
    if (xToken) headers["X-Token"] = xToken;
    if (appkey) headers["appkey"] = appkey;

    await fetch(`${baseUrl}/logout`, {
      method: "POST",
      headers,
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
