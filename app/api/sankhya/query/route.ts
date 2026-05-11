import { NextRequest, NextResponse } from "next/server";

function getBaseUrl(env: string): string {
  return env === "sandbox"
    ? "https://api.sandbox.sankhya.com.br"
    : "https://api.sankhya.com.br";
}

// ── DbExplorerSP (raw SQL, paginated via SQL OFFSET/FETCH) ───────────────────
// DbExplorerSP imposes a hard server-side row cap (~5 000). API-level pagination
// parameters (totalPerPage/currentPage) are silently ignored. The only reliable
// way to retrieve all rows is to embed OFFSET…ROWS FETCH NEXT…ROWS ONLY in the
// SQL itself (Oracle 12c+ syntax, which all modern Sankhya installations use).

const SQL_PAGE_SIZE = 500; // rows per SQL page
const SQL_BATCH = 10;      // concurrent requests per round

function parseSqlRows(data: Record<string, unknown>): Record<string, unknown>[] {
  const body = data?.responseBody as Record<string, unknown> | undefined;
  const fields: { name: string }[] = (body?.fieldsMetadata as { name: string }[]) || [];
  const rawRows: unknown[][] = (body?.rows as unknown[][]) || [];

  return rawRows.map((row) => {
    const obj: Record<string, unknown> = {};
    fields.forEach((f, i) => {
      const cell = row[i];
      obj[f.name] =
        cell && typeof cell === "object" && "$" in (cell as Record<string, unknown>)
          ? (cell as { $: unknown }).$
          : cell;
    });
    return obj;
  });
}

async function fetchSqlOffset(
  url: string,
  headers: Record<string, string>,
  baseSql: string,
  offset: number
): Promise<Record<string, unknown>[]> {
  const sqlUrl = url.replace("CRUDServiceProvider.loadRecords", "DbExplorerSP.executeQuery");
  // Append Oracle pagination clause directly to the caller's SQL.
  // The base SQL already contains ORDER BY; OFFSET/FETCH must follow ORDER BY.
  const pagedSql = `${baseSql} OFFSET ${offset} ROWS FETCH NEXT ${SQL_PAGE_SIZE} ROWS ONLY`;

  const response = await fetch(sqlUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ serviceName: "DbExplorerSP.executeQuery", requestBody: { sql: pagedSql } }),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);

  const data = JSON.parse(text);
  if (data?.status !== "1") {
    throw new Error(data?.statusMessage || JSON.stringify(data?.error) || "Erro SQL");
  }

  return parseSqlRows(data);
}

async function fetchAllBySql(
  url: string,
  headers: Record<string, string>,
  baseSql: string
): Promise<Record<string, unknown>[]> {
  const allRows: Record<string, unknown>[] = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Fire SQL_BATCH pages concurrently, each with its own OFFSET clause.
    const offsets = Array.from({ length: SQL_BATCH }, (_, i) => offset + i * SQL_PAGE_SIZE);
    const results = await Promise.all(offsets.map((off) => fetchSqlOffset(url, headers, baseSql, off)));

    let done = false;
    for (const rows of results) {
      if (rows.length === 0) { done = true; break; }
      allRows.push(...rows);
      if (rows.length < SQL_PAGE_SIZE) { done = true; break; } // last page
    }
    if (done) break;
    offset += SQL_BATCH * SQL_PAGE_SIZE;
  }

  return allRows;
}

// ── CRUDServiceProvider (entity-based, paginated) ────────────────────────────

function parseEntities(data: Record<string, unknown>): Record<string, unknown>[] {
  const entities = (data?.responseBody as Record<string, unknown>)
    ?.entities as Record<string, unknown>;
  const entityData = entities?.entity;
  const list: Record<string, unknown>[] = Array.isArray(entityData)
    ? entityData
    : entityData
    ? [entityData as Record<string, unknown>]
    : [];

  return list.map((e) => {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e)) {
      obj[k] =
        v && typeof v === "object" && "$" in (v as Record<string, unknown>)
          ? (v as { $: unknown }).$
          : v;
    }
    return obj;
  });
}

async function fetchCrudPage(
  url: string,
  headers: Record<string, string>,
  entity: string,
  fields: string,
  filter: string | undefined,
  page: number
): Promise<Record<string, unknown>[]> {
  const dataSet: Record<string, unknown> = {
    rootEntity: entity,
    includePresentationFields: "N",
    offsetPage: String(page),
    entity: { fieldset: { list: fields } },
  };
  if (filter) dataSet.criteria = { expression: { $: filter } };

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      serviceName: "CRUDServiceProvider.loadRecords",
      requestBody: { dataSet },
    }),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);

  const data = JSON.parse(text);
  if (data?.status !== "1")
    throw new Error(data?.statusMessage || JSON.stringify(data?.error) || "Erro CRUD");

  return parseEntities(data);
}

async function fetchAllByCrud(
  url: string,
  headers: Record<string, string>,
  entity: string,
  fields: string,
  filter?: string
): Promise<Record<string, unknown>[]> {
  const allRows: Record<string, unknown>[] = [];
  // Fetch BATCH pages concurrently — 10× faster than sequential
  // offsetPage is a page number (0, 1, 2, ...) where each page returns ~50 rows
  const BATCH = 10;
  let page = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const pageNums = Array.from({ length: BATCH }, (_, i) => page + i);
    const results = await Promise.all(
      pageNums.map((p) => fetchCrudPage(url, headers, entity, fields, filter, p))
    );

    let done = false;
    for (const rows of results) {
      if (rows.length === 0) { done = true; break; }
      allRows.push(...rows);
    }

    if (done) break;
    page += BATCH;
  }

  return allRows;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const {
      environment, bearerToken, xToken, appkey,
      entity, sqlTable, fields, filter, sqlFilter, sqlOrder, sql,
    } = await req.json();


    if (!bearerToken || (!entity && !sql) || (!fields && !sql)) {
      return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
    }

    const baseUrl = getBaseUrl(environment || "production");
    const crudUrl = `${baseUrl}/gateway/v1/mge/service.sbr?serviceName=CRUDServiceProvider.loadRecords&outputType=json`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    };
    if (xToken) headers["X-Token"] = xToken;
    if (appkey) headers["appkey"] = appkey;

    let rows: Record<string, unknown>[];
    let method = "crud";

    if (sql) {
      rows = await fetchAllBySql(crudUrl, headers, sql);
      method = "sql-direct";
    } else {
      const table = sqlTable || entity;
      const fieldList = fields.split(",").map((f: string) => f.trim()).join(", ");
      const where = sqlFilter ? ` WHERE ${sqlFilter}` : "";
      const order = sqlOrder ? ` ORDER BY ${sqlOrder}` : "";
      const sqlFallback = `SELECT ${fieldList} FROM ${table}${where}${order}`;

      let crudErr: unknown = null;
      try {
        rows = await fetchAllByCrud(crudUrl, headers, entity, fields, filter);
      } catch (e) {
        crudErr = e;
        rows = [];
      }

      if (rows.length === 0) {
        // CRUD returned empty (or threw) — try SQL fallback
        console.log(`[query] CRUD result=0 (${crudErr ? String(crudErr) : "empty"}), tentando SQL: ${sqlFallback}`);
        try {
          rows = await fetchAllBySql(crudUrl, headers, sqlFallback);
          method = "sql-fallback";
        } catch (sqlErr) {
          // Both failed — re-throw CRUD error if it exists (preserves auth context for client retry)
          throw crudErr ?? sqlErr;
        }
      }
    }

    console.log(`[query] entity=${entity ?? "sql"} method=${method} rows=${rows.length}`);
    return NextResponse.json({ ok: true, rows, total: rows.length, sankhyaTotal: rows.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isAuth = /HTTP 40[0-3]|token|bearer|expired|unauthorized/i.test(message);
    if (isAuth) {
      // Auth errors are expected when the token expires — the client will auto-retry.
      console.log(`[query] token expirado, cliente fará re-autenticação`);
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error(`[query] erro: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
