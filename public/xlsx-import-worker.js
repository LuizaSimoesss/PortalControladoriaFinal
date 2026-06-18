/* Web Worker: processa e valida arquivo Excel/CSV sem bloquear o thread principal */
importScripts('/xlsx.full.min.js');

const CHUNK = 2000;

function dataHoje() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function parseValor(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "-" || s.toLowerCase() === "null") return null;
  const isNeg = s.startsWith("(") && s.endsWith(")");
  let clean = s.replace(/[R$\s()'"]/g, "");
  const hasDot   = clean.includes(".");
  const hasComma = clean.includes(",");
  if (hasComma && hasDot) {
    if (clean.lastIndexOf(",") > clean.lastIndexOf(".")) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      clean = clean.replace(/,/g, "");
    }
  } else if (hasComma) {
    const afterComma = clean.split(",")[1] || "";
    if (afterComma.length === 3 && !afterComma.includes(".")) {
      clean = clean.replace(",", "");
    } else {
      clean = clean.replace(",", ".");
    }
  }
  const n = parseFloat(clean);
  if (isNaN(n)) return null;
  return isNeg ? -Math.abs(n) : n;
}

function excelSerialToISO(serial) {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return date.toISOString().slice(0, 10);
}

function parsePeriodo(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4,6}$/.test(s)) {
    const n = parseInt(s);
    if (n > 40000 && n < 60000) return excelSerialToISO(n).slice(0, 7);
  }
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{2}\/\d{4}$/.test(s)) return `${s.slice(3)}-${s.slice(0, 2)}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return `${s.slice(6)}-${s.slice(3, 5)}`;
  const mISO = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (mISO) return mISO[1].slice(0, 7);
  const mShort = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mShort) {
    const mon = mShort[2].padStart(2, "0");
    const yr  = parseInt(mShort[3]) >= 50 ? `19${mShort[3]}` : `20${mShort[3]}`;
    return `${yr}-${mon}`;
  }
  return null;
}

function parseDataCompleta(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4,6}$/.test(s)) {
    const n = parseInt(s);
    if (n > 40000 && n < 60000) return excelSerialToISO(n);
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return `${s.slice(6)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
  const mISO = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (mISO) return mISO[1];
  const mShort = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mShort) {
    const day = mShort[1].padStart(2, "0");
    const mon = mShort[2].padStart(2, "0");
    const yr  = parseInt(mShort[3]) >= 50 ? `19${mShort[3]}` : `20${mShort[3]}`;
    return `${yr}-${mon}-${day}`;
  }
  const p = parsePeriodo(s);
  return p ? p + "-01" : null;
}

function resolveRaw(raw, ...candidates) {
  for (const c of candidates) {
    const v = raw[c];
    if (v !== undefined) {
      const t = String(v).trim();
      if (t !== "" && t !== "-") return t;
    }
  }
  return "";
}

function validateRow(raw, cfg) {
  const { isRealizado, tipo, natSet, crSet, empSet, projSet, parcSet } = cfg;
  const erros = [];

  const periodoRaw = isRealizado
    ? resolveRaw(raw, "AD_DTDECOMPETENCIA", "PERIODO", "DATA", "COMPETENCIA")
    : resolveRaw(raw, "PERIODO", "AD_DTDECOMPETENCIA", "DATA", "COMPETENCIA", "MES", "MES_REF");
  const periodo = parsePeriodo(periodoRaw);
  if (periodoRaw && !periodo) erros.push(`Período inválido: "${periodoRaw}"`);

  const valorRaw = isRealizado
    ? resolveRaw(raw, "VALOR_FINAL", "VLR_DESDOB", "VALOR", "VLR_FINAL", "VLRFINAL")
    : resolveRaw(raw, "VALOR", "VALOR_FINAL", "VALOR_ORCADO", "VLR_ORCADO", "VLRORCADO", "BUDGET", "VLR");
  const valorParsed = parseValor(valorRaw);
  const valor = valorParsed !== null ? valorParsed : (String(valorRaw).trim() === "" ? 0 : null);
  if (valor === null) erros.push(`Valor inválido: "${valorRaw}"`);

  const codnat    = resolveRaw(raw, "CODNAT");
  const codcencus = resolveRaw(raw, "CODCENCUS");
  const codemp    = resolveRaw(raw, "CODEMP");
  const codproj   = resolveRaw(raw, "CODPROJ");
  const codparc   = resolveRaw(raw, "CODPARC");
  const nufin     = resolveRaw(raw, "NUFIN");
  const historico = resolveRaw(raw, "HISTORICO");

  if (!codnat)    erros.push("CODNAT obrigatório");
  else if (!natSet.has(codnat))   erros.push(`CODNAT "${codnat}" não encontrado`);
  if (!codcencus) erros.push("CODCENCUS obrigatório");
  else if (!crSet.has(codcencus)) erros.push(`CODCENCUS "${codcencus}" não encontrado`);
  if (tipo === "realizado" && !codemp) erros.push("CODEMP obrigatório");
  else if (codemp && !empSet.has(codemp)) erros.push(`CODEMP "${codemp}" não encontrado`);
  if (codproj && !projSet.has(codproj)) erros.push(`CODPROJ "${codproj}" não encontrado`);
  if (codparc && !parcSet.has(codparc)) erros.push(`CODPARC "${codparc}" não encontrado`);

  if (erros.length > 0) return { erros, raw };

  const dataRaw = resolveRaw(raw, "AD_DTDECOMPETENCIA") || resolveRaw(raw, "DTNEG");
  const dataISO = parseDataCompleta(dataRaw) || parseDataCompleta(periodoRaw) || (periodo ? periodo + "-01" : dataHoje());

  return {
    erros: [],
    lancamento: {
      tipo, data: dataISO, periodo: dataISO.slice(0, 7),
      codnat, codcencus, codemp,
      codproj: codproj || undefined,
      codparc: codparc || undefined,
      nufin:   nufin   || undefined,
      historico: historico || undefined,
      valor,
    },
  };
}

self.onmessage = function(e) {
  const { buffer, isExcel, csvText, tipo, natArr, crArr, empArr, projArr, parcArr } = e.data;

  const cfg = {
    isRealizado: tipo === "realizado",
    tipo,
    natSet:  new Set(natArr),
    crSet:   new Set(crArr),
    empSet:  new Set(empArr),
    projSet: new Set(projArr),
    parcSet: new Set(parcArr),
  };

  // 1. Parsear arquivo
  self.postMessage({ type: "status", message: "Lendo arquivo…" });

  let parsed;
  try {
    if (isExcel) {
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
      parsed = json.map(function(row) {
        const obj = {};
        Object.entries(row).forEach(function([k, v]) {
          obj[k.trim().toUpperCase()] = String(v === null || v === undefined ? "" : v).trim();
        });
        return obj;
      });
    } else {
      const lines = csvText.trim().split(/\r?\n/);
      if (lines.length < 2) { parsed = []; }
      else {
        const headers = lines[0].split(";").map(function(h) { return h.trim().replace(/^"|"$/g, "").toUpperCase(); });
        parsed = lines.slice(1).map(function(line) {
          const vals = line.split(";").map(function(v) { return v.trim().replace(/^"|"$/g, ""); });
          const obj = {};
          headers.forEach(function(h, i) { obj[h] = vals[i] || ""; });
          return obj;
        });
      }
    }
  } catch (err) {
    self.postMessage({ type: "error", message: String(err) });
    return;
  }

  const total = parsed.length;
  self.postMessage({ type: "parsed", total });

  // 2. Validar em chunks
  const accValid   = [];
  const accInvalid = [];
  let offset = 0;

  function processChunk() {
    const fim = Math.min(offset + CHUNK, total);
    for (let i = offset; i < fim; i++) {
      try {
        const r = validateRow(parsed[i], cfg);
        if (r.erros.length === 0) {
          accValid.push(r.lancamento);
        } else {
          accInvalid.push({ raw: r.raw, erros: r.erros });
        }
      } catch (_) {
        // skip row that causes unexpected error
      }
    }
    offset = fim;

    self.postMessage({ type: "progress", atual: offset, total });

    if (offset < total) {
      setTimeout(processChunk, 0);
    } else {
      self.postMessage({ type: "done", validRows: accValid, invalidRows: accInvalid, total });
    }
  }

  processChunk();
};
