import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Maps localStorage portal keys → Supabase table names
const TABLE_MAP: Record<string, string> = {
  portal_natureza: "natureza",
  portal_centro_resultado: "centro_resultado",
  portal_projetos: "projetos",
  portal_parceiro: "parceiros",
  portal_empresas: "empresas",
  portal_adquiridas: "adquiridas",
  portal_fechamentos: "fechamentos",
  portal_lancamentos_financeiro: "lancamentos_financeiro",
  portal_lancamentos_indicadores: "lancamentos_indicadores",
  portal_importacoes_indicadores: "importacoes_indicadores",
};

// Tables whose rows are stored as a single JSONB "data" column
const JSONB_TABLES = new Set<string>([]);

// Keys whose entire value is stored as a single JSON blob in the "configuracoes" table
// (arrays where order matters and there is no natural delete-by-ID sync)
const BLOB_KEYS = new Set([
  "portal_receita_folha_business",
  // Indicadores: hierarchical, manually ordered — must be stored as a blob to preserve order.
  // Reading individual rows from Supabase without ORDER BY returns arbitrary order.
  "portal_indicadores",
  "portal_dre",
  "portal_dfc",
  "portal_dre_contabil",
  // Orçamento — receita
  "portal_orcamento_gestao_recursos",
  "portal_orcamento_investment_banking",
  "portal_orcamento_advisory",
  "portal_orcamento_research",
  // Orçamento — gastos
  "portal_orcamento_gastos_pacote_pessoal",
  "portal_orcamento_gastos_pacote_certificacao",
  "portal_orcamento_gastos_pacote_incentivos_comerciais",
  "portal_orcamento_gastos_pacote_institucional",
  "portal_orcamento_gastos_pacote_ocupacao",
  "portal_orcamento_gastos_pacote_eventos",
  "portal_orcamento_gastos_pacote_servicos_especializados",
  "portal_orcamento_gastos_pacote_servicos_juridicos",
  "portal_orcamento_gastos_pacote_tecnologia",
  "portal_orcamento_gastos_pacote_viagens",
  // Forecast — valores (fcVals)
  "portal_forecast_receita_gestao_recursos",
  "portal_forecast_receita_advisory",
  "portal_forecast_receita_investment_banking",
  "portal_forecast_receita_research",
  "portal_forecast_gastos_pacote_pessoal",
  "portal_forecast_gastos_pacote_certificacao",
  "portal_forecast_gastos_pacote_incentivos_comerciais",
  "portal_forecast_gastos_pacote_institucional",
  "portal_forecast_gastos_pacote_ocupacao",
  "portal_forecast_gastos_pacote_eventos",
  "portal_forecast_gastos_pacote_servicos_especializados",
  "portal_forecast_gastos_pacote_servicos_juridicos",
  "portal_forecast_gastos_pacote_tecnologia",
  "portal_forecast_gastos_pacote_viagens",
  // Forecast — meses realizados (_mr)
  "portal_forecast_receita_gestao_recursos_mr",
  "portal_forecast_receita_advisory_mr",
  "portal_forecast_receita_investment_banking_mr",
  "portal_forecast_receita_research_mr",
  "portal_forecast_gastos_pacote_pessoal_mr",
  "portal_forecast_gastos_pacote_certificacao_mr",
  "portal_forecast_gastos_pacote_incentivos_comerciais_mr",
  "portal_forecast_gastos_pacote_institucional_mr",
  "portal_forecast_gastos_pacote_ocupacao_mr",
  "portal_forecast_gastos_pacote_eventos_mr",
  "portal_forecast_gastos_pacote_servicos_especializados_mr",
  "portal_forecast_gastos_pacote_servicos_juridicos_mr",
  "portal_forecast_gastos_pacote_tecnologia_mr",
  "portal_forecast_gastos_pacote_viagens_mr",
]);

type Params = { params: Promise<{ table: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { table: key } = await params;

  if (BLOB_KEYS.has(key)) {
    const { data } = await supabase
      .from("configuracoes")
      .select("valor")
      .eq("chave", key)
      .single();
    return NextResponse.json((data as { valor: unknown } | null)?.valor ?? []);
  }

  const tableName = TABLE_MAP[key];
  // Chave não mapeada (ex: chaves de filtro) → 200 vazio, sem poluir o log com 404
  if (!tableName) return NextResponse.json([]);

  // Supabase defaults to 1000 rows per query — paginate to get all records.
  const PAGE = 1000;
  let allData: Record<string, unknown>[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(tableName).select("*").range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    allData = allData.concat((data as Record<string, unknown>[]) ?? []);
    if ((data ?? []).length < PAGE) break;
    from += PAGE;
  }

  if (JSONB_TABLES.has(tableName)) {
    return NextResponse.json(allData.map((r) => r.data));
  }
  return NextResponse.json(allData);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { table: key } = await params;

  if (BLOB_KEYS.has(key)) {
    const valor = await req.json();
    const { error } = await supabase
      .from("configuracoes")
      .upsert({ chave: key, valor, atualizado_em: new Date().toISOString() });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const tableName = TABLE_MAP[key];
  // Unmapped keys (e.g. filter/preference state) are client-only — silently ignore.
  if (!tableName) return NextResponse.json({ ok: true });

  const rows: Record<string, unknown>[] = await req.json();
  if (!Array.isArray(rows)) return NextResponse.json({ error: "Expected array" }, { status: 400 });

  // Upsert current rows in batches (Supabase has limits on payload size)
  if (rows.length > 0) {
    const insertRows = JSONB_TABLES.has(tableName)
      ? rows.map((r) => ({ id: r.id, data: r }))
      : rows;
    const UPSERT_BATCH = 500;
    for (let i = 0; i < insertRows.length; i += UPSERT_BATCH) {
      const batch = insertRows.slice(i, i + UPSERT_BATCH);
      const { error: upsertErr } = await supabase.from(tableName).upsert(batch, { onConflict: "id" });
      if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  }

  // Delete rows removed from the client
  const { data: existing } = await supabase.from(tableName).select("id");
  const currentIds = new Set(rows.map((r) => r.id as string));
  const toDelete = (existing ?? [])
    .map((r: { id: string }) => r.id)
    .filter((id: string) => !currentIds.has(id));

  if (toDelete.length > 0) {
    await supabase.from(tableName).delete().in("id", toDelete);
  }

  return NextResponse.json({ ok: true });
}
