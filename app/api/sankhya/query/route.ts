import { NextRequest, NextResponse } from "next/server";

function getBaseUrl(env: string): string {
  return env === "sandbox"
    ? "https://api.sandbox.sankhya.com.br"
    : "https://api.sankhya.com.br";
}

// ── DbExplorerSP (raw SQL, paginated via keyset) ─────────────────────────────
// DbExplorerSP imposes a hard server-side row cap per query (often ~1 000).
// OFFSET-based pagination fails because the server caps the dataset before
// applying OFFSET, so OFFSET beyond the cap always returns empty.
// The reliable approach is keyset pagination: each round sends
//   WHERE {pkField} > {lastValue} FETCH FIRST {N} ROWS ONLY
// — the WHERE changes the dataset, so the server cap resets for each page.
// For queries without a pkField, OFFSET/FETCH is used as a best-effort fallback.

const SQL_PAGE_SIZE = 500; // rows per SQL page
const SQL_BATCH = 10;      // concurrent requests per round (OFFSET fallback only)

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

async function executeSql(
  url: string,
  headers: Record<string, string>,
  sql: string
): Promise<Record<string, unknown>[]> {
  const sqlUrl = url.replace("CRUDServiceProvider.loadRecords", "DbExplorerSP.executeQuery");

  const response = await fetch(sqlUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ serviceName: "DbExplorerSP.executeQuery", requestBody: { sql } }),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);

  const data = JSON.parse(text);
  if (data?.status !== "1") {
    throw new Error(data?.statusMessage || JSON.stringify(data?.error) || "Erro SQL");
  }

  return parseSqlRows(data);
}

// Keyset pagination: uses WHERE pkField > lastPk to paginate beyond server cap.
async function fetchAllBySqlKeyset(
  url: string,
  headers: Record<string, string>,
  baseSql: string,
  pkField: string
): Promise<Record<string, unknown>[]> {
  const allRows: Record<string, unknown>[] = [];
  let lastPk: unknown = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let sql = baseSql;
    if (lastPk !== null) {
      // Inject WHERE before ORDER BY. All base SQLs follow the pattern
      // "SELECT ... FROM table ORDER BY pk" with no existing WHERE clause.
      const pkVal = Number(lastPk);
      sql = baseSql.replace(/ ORDER BY /i, ` WHERE ${pkField} > ${pkVal} ORDER BY `);
    }
    const pagedSql = `${sql} FETCH FIRST ${SQL_PAGE_SIZE} ROWS ONLY`;

    const rows = await executeSql(url, headers, pagedSql);
    if (rows.length === 0) break;
    allRows.push(...rows);
    lastPk = rows[rows.length - 1][pkField];
  }

  return allRows;
}

// OFFSET fallback for queries without a pkField.
async function fetchAllBySql(
  url: string,
  headers: Record<string, string>,
  baseSql: string
): Promise<Record<string, unknown>[]> {
  const allRows: Record<string, unknown>[] = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const offsets = Array.from({ length: SQL_BATCH }, (_, i) => offset + i * SQL_PAGE_SIZE);
    const results = await Promise.all(
      offsets.map((off) => executeSql(url, headers, `${baseSql} OFFSET ${off} ROWS FETCH NEXT ${SQL_PAGE_SIZE} ROWS ONLY`))
    );

    let done = false;
    for (const rows of results) {
      if (rows.length === 0) { done = true; break; }
      allRows.push(...rows);
      if (rows.length < SQL_PAGE_SIZE) { done = true; break; }
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
      entity, sqlTable, fields, filter, sqlFilter, sqlOrder, sql, pkField,
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
      rows = pkField
        ? await fetchAllBySqlKeyset(crudUrl, headers, sql, pkField)
        : await fetchAllBySql(crudUrl, headers, sql);
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
