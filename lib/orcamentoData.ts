"use client";

import { loadData, saveData } from "./storage";

// ─── Types (mirrored from orcamento pages) ────────────────────────────────────

type Categoria    = "receita" | "gastos" | "impostos" | "indicador";
type TipoLinha    = "digitado" | "calculado" | "subtotal";
type OpFormula    = "*" | "+" | "-" | "/";

type ExprToken =
  | { t: "ref"; id: string; offset: 0 | -1 | 1 }
  | { t: "num"; v: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "(" | ")" };

interface FormulaOperando { linhaId: string; offset: 0 | -1 | 1; valorFixo?: number }
interface Formula         { op: OpFormula; left: FormulaOperando; right: FormulaOperando }
interface ComposicaoItem  { id: string; descricao: string; valores: Record<string, number>; comentario?: string; demoItemIdGerencial?: string; demoItemIdContabil?: string; centroId?: string }

interface LinhaOrcamento {
  id: string; descricao: string; categoria: Categoria; tipo: TipoLinha;
  isPercentual?: boolean;
  demoItemIdGerencial?: string;
  demoItemIdContabil?: string;
  composicao?: ComposicaoItem[];
  formula?: Formula;
  formulaExpr?: ExprToken[];
  subtotalLinhaIds?: string[];
  centroResultadoId?: string;
  naturezaId?: string;
  valores: Record<string, number>;
}

function _applyOp(op: string, stk: number[]) {
  const b = stk.pop() ?? 0, a = stk.pop() ?? 0;
  if (op === "+") stk.push(a + b);
  else if (op === "-") stk.push(a - b);
  else if (op === "*") stk.push(a * b);
  else stk.push(b !== 0 ? a / b : 0);
}

function evalExprTokens(
  tokens: ExprToken[],
  resolve: (id: string, offset: 0 | -1 | 1) => number
): number {
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const out: number[] = [], ops: string[] = [];
  for (const tok of tokens) {
    if (tok.t === "num") { out.push(tok.v); }
    else if (tok.t === "ref") { out.push(resolve(tok.id, tok.offset)); }
    else if (tok.t === "op") {
      if (tok.v === "(") { ops.push("("); }
      else if (tok.v === ")") {
        while (ops.length && ops[ops.length - 1] !== "(") _applyOp(ops.pop()!, out);
        ops.pop();
      } else {
        while (ops.length && ops[ops.length - 1] !== "(" && (prec[ops[ops.length - 1]] ?? 0) >= (prec[tok.v] ?? 0))
          _applyOp(ops.pop()!, out);
        ops.push(tok.v);
      }
    }
  }
  while (ops.length) _applyOp(ops.pop()!, out);
  return out[0] ?? 0;
}

interface SubBloco { id: string; descricao: string; linhas: LinhaOrcamento[] }
interface Bloco    { id: string; descricao: string; subBlocos: SubBloco[] }

// ─── Chaves de storage de todas as páginas de orçamento ───────────────────────

export const ORCAMENTO_KEYS = [
  "portal_orcamento_gestao_recursos",
  "portal_orcamento_advisory",
  "portal_orcamento_investment_banking",
  "portal_orcamento_research",
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
] as const;

// Chaves de receita: linhas calculado filtradas por keyHasCrMatch
// Chaves de gastos: linhas calculado sempre passam (valores derivados de composição)
const RECEITA_KEYS = new Set<string>([
  "portal_orcamento_gestao_recursos",
  "portal_orcamento_advisory",
  "portal_orcamento_investment_banking",
  "portal_orcamento_research",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pk(ano: number, m: number): string {
  return `${ano}-${String(m + 1).padStart(2, "0")}`;
}

function evalLinhaValue(
  linha: LinhaOrcamento,
  todas: LinhaOrcamento[],
  ano: number,
  mi: number,
  allLinhas?: Map<string, LinhaOrcamento>,
  _depth = 0
): number {
  if (_depth > 30) return 0;
  if (linha.tipo === "subtotal") {
    return (linha.subtotalLinhaIds ?? []).reduce((s, id) => {
      const ref = todas.find(x => x.id === id) ?? allLinhas?.get(id);
      if (!ref) return s;
      return s + evalLinhaValue(ref, todas, ano, mi, allLinhas, _depth + 1);
    }, 0);
  }
  if (linha.tipo === "digitado") {
    if (linha.composicao && linha.composicao.length > 0)
      return linha.composicao.reduce((s, item) => s + (item.valores[pk(ano, mi)] ?? 0), 0);
    return linha.valores[pk(ano, mi)] ?? 0;
  }
  if (linha.formulaExpr && linha.formulaExpr.length > 0) {
    if (linha.formulaExpr.length === 3) {
      const [t0, t1, t2] = linha.formulaExpr;
      if (t0.t === "ref" && t1.t === "op" && t1.v === "*" && t2.t === "ref") {
        const tl = mi + t0.offset, tr = mi + t2.offset;
        if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
          const lL = todas.find(x => x.id === t0.id) ?? allLinhas?.get(t0.id);
          const rL = todas.find(x => x.id === t2.id) ?? allLinhas?.get(t2.id);
          if (lL?.composicao?.length && rL?.composicao?.length) {
            return lL.composicao.reduce((sum, li, idx) => {
              const ri = rL.composicao![idx]; if (!ri) return sum;
              const lv = (li.valores[pk(ano, tl)] ?? 0) / (lL.isPercentual ? 100 : 1);
              const rv = (ri.valores[pk(ano, tr)] ?? 0) / (rL.isPercentual ? 100 : 1);
              return sum + lv * rv;
            }, 0);
          }
        }
      }
    }
    return evalExprTokens(linha.formulaExpr, (id, offset) => {
      const t = mi + offset;
      if (t < 0 || t > 11) return 0;
      const l = todas.find(x => x.id === id) ?? allLinhas?.get(id);
      if (!l) return 0;
      const v = evalLinhaValue(l, todas, ano, t, allLinhas, _depth + 1);
      return l.isPercentual ? v / 100 : v;
    });
  }
  if (!linha.formula) return 0;
  const { op, left, right } = linha.formula;
  if (op === "*" && left.valorFixo === undefined && right.valorFixo === undefined) {
    const tl = mi + left.offset, tr = mi + right.offset;
    if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
      const lL = todas.find(x => x.id === left.linhaId) ?? allLinhas?.get(left.linhaId);
      const rL = todas.find(x => x.id === right.linhaId) ?? allLinhas?.get(right.linhaId);
      if (lL?.composicao?.length && rL?.composicao?.length) {
        return lL.composicao.reduce((sum, li, idx) => {
          const ri = rL.composicao![idx];
          if (!ri) return sum;
          const lv = (li.valores[pk(ano, tl)] ?? 0) / (lL.isPercentual ? 100 : 1);
          const rv = (ri.valores[pk(ano, tr)] ?? 0) / (rL.isPercentual ? 100 : 1);
          return sum + lv * rv;
        }, 0);
      }
    }
  }
  const getV = (o: FormulaOperando) => {
    if (o.valorFixo !== undefined) return o.valorFixo;
    const t = mi + o.offset;
    if (t < 0 || t > 11) return 0;
    const l = todas.find(x => x.id === o.linhaId) ?? allLinhas?.get(o.linhaId);
    if (!l) return 0;
    const v = evalLinhaValue(l, todas, ano, t, allLinhas, _depth + 1);
    return l.isPercentual ? v / 100 : v;
  };
  const lv = getV(left), rv = getV(right);
  if (op === "*") return lv * rv;
  if (op === "+") return lv + rv;
  if (op === "-") return lv - rv;
  return rv !== 0 ? lv / rv : 0;
}

/**
 * Avalia o produto A × B aplicando filtro de CR — padrão Quantidade × Ticket Médio.
 * Retorna null se nenhum operando tem atribuição de CR → cai no fallback (evalExprTokens).
 *
 * Casos tratados:
 *  1. Ambos têm composição → filtra A por centroId (ou centroResultadoId da linha) e pareia com B por índice.
 *  2. Apenas A tem composição atribuída → filtra A, multiplica pelo valor escalar de B (unfiltered).
 *  3. Apenas B tem composição atribuída → filtra B, multiplica pelo valor escalar de A (unfiltered).
 */
function _eval3TokenFiltered(
  lL: LinhaOrcamento | undefined,
  rL: LinhaOrcamento | undefined,
  tl: number, tr: number,
  ano: number,
  crFilter: Set<string>,
  crIdToCod: Map<string, string>,
  todas?: LinhaOrcamento[],
  allLinhas?: Map<string, LinhaOrcamento>
): number | null {
  if (!lL || !rL) return null;

  const lHasComp = (lL.composicao?.length ?? 0) > 0;
  const rHasComp = (rL.composicao?.length ?? 0) > 0;

  function crOk(id: string | undefined) {
    if (!id) return false;
    const cod = crIdToCod.get(id);
    return !!cod && crFilter.has(cod);
  }

  // Avalia o valor escalar de uma linha (subtotal, calculado ou digitado simples)
  function scalarVal(linha: LinhaOrcamento, t: number): number {
    let v: number;
    if (todas || allLinhas) {
      v = evalLinhaValue(linha, todas ?? [], ano, t, allLinhas);
    } else if (linha.composicao && linha.composicao.length > 0) {
      v = linha.composicao.reduce((s, c) => s + (c.valores[pk(ano, t)] ?? 0), 0);
    } else {
      v = linha.valores[pk(ano, t)] ?? 0;
    }
    return v / (linha.isPercentual ? 100 : 1);
  }

  const lPassCR = crOk(lL.centroResultadoId);
  const rPassCR = crOk(rL.centroResultadoId);
  const lHasCentroId = lHasComp && lL.composicao!.some(c => !!c.centroId);
  const rHasCentroId = rHasComp && rL.composicao!.some(c => !!c.centroId);

  const lAttrib = lPassCR || lHasCentroId;
  const rAttrib = rPassCR || rHasCentroId;

  if (!lAttrib && !rAttrib) return null; // sem atribuição em nenhum operando

  // Retorna o produto filtrado quando ambos têm composição atribuída (preserva pareamento por índice)
  if (lHasComp && rHasComp && lAttrib) {
    return lL.composicao!.reduce((sum, li, idx) => {
      // Filtra pelo centroId do item, ou inclui tudo se a linha tem CR próprio
      if (!lPassCR) {
        if (!li.centroId) return sum;
        const cod = crIdToCod.get(li.centroId);
        if (!cod || !crFilter.has(cod)) return sum;
      }
      const ri = rL.composicao![idx];
      if (!ri) return sum;
      const lv = (li.valores[pk(ano, tl)] ?? 0) / (lL.isPercentual ? 100 : 1);
      const rv = (ri.valores[pk(ano, tr)] ?? 0) / (rL.isPercentual ? 100 : 1);
      return sum + lv * rv;
    }, 0);
  }

  // Apenas A tem composição atribuída → B é escalar (Ticket Médio global)
  if (lHasComp && lAttrib) {
    const rVal = scalarVal(rL, tr);
    if (rVal === 0) return 0;
    if (lPassCR) {
      const lv = lL.composicao!.reduce((s, c) => s + (c.valores[pk(ano, tl)] ?? 0), 0) / (lL.isPercentual ? 100 : 1);
      return lv * rVal;
    }
    return lL.composicao!.reduce((sum, li) => {
      if (!li.centroId) return sum;
      const cod = crIdToCod.get(li.centroId);
      if (!cod || !crFilter.has(cod)) return sum;
      return sum + (li.valores[pk(ano, tl)] ?? 0) / (lL.isPercentual ? 100 : 1) * rVal;
    }, 0);
  }

  // Apenas B tem composição atribuída → A é escalar
  if (rHasComp && rAttrib) {
    const lVal = scalarVal(lL, tl);
    if (lVal === 0) return 0;
    if (rPassCR) {
      const rv = rL.composicao!.reduce((s, c) => s + (c.valores[pk(ano, tr)] ?? 0), 0) / (rL.isPercentual ? 100 : 1);
      return lVal * rv;
    }
    return rL.composicao!.reduce((sum, ri) => {
      if (!ri.centroId) return sum;
      const cod = crIdToCod.get(ri.centroId);
      if (!cod || !crFilter.has(cod)) return sum;
      return sum + lVal * (ri.valores[pk(ano, tr)] ?? 0) / (rL.isPercentual ? 100 : 1);
    }, 0);
  }

  return null;
}

/**
 * Avalia o valor de uma linha aplicando filtro de CR.
 * Para digitado com composição: soma apenas os itens cujo comp.centroId está no filtro.
 * Para calculado: recursivamente avalia a fórmula com sub-avaliação filtrada.
 * Itens de composição sem centroId são ignorados (não podem ser atribuídos a nenhuma BU).
 */
function evalLinhaValueFiltered(
  linha: LinhaOrcamento,
  todas: LinhaOrcamento[],
  ano: number,
  mi: number,
  allLinhas: Map<string, LinhaOrcamento>,
  crFilter: Set<string>,
  crIdToCod: Map<string, string>,
  _depth = 0
): number {
  if (_depth > 30) return 0;

  if (linha.tipo === "digitado") {
    if (linha.composicao && linha.composicao.length > 0) {
      // Se a linha tem CR próprio que passa o filtro, todos os itens de composição
      // pertencem a esse CR — inclui todos independentemente do centroId por item.
      // (Espelha o comportamento de buildOrcamentoMap: linhaPassouCR=true → compsFiltrados=all)
      if (linha.centroResultadoId) {
        const cod = crIdToCod.get(linha.centroResultadoId);
        if (cod && crFilter.has(cod)) {
          return linha.composicao.reduce((s, c) => s + (c.valores[pk(ano, mi)] ?? 0), 0);
        }
        return 0; // CR da linha não passa o filtro
      }
      // Sem CR na linha → filtra por centroId de cada item
      return linha.composicao
        .filter(c => {
          if (!c.centroId) return false;
          const cod = crIdToCod.get(c.centroId);
          return !!cod && crFilter.has(cod);
        })
        .reduce((s, c) => s + (c.valores[pk(ano, mi)] ?? 0), 0);
    }
    if (linha.centroResultadoId) {
      const cod = crIdToCod.get(linha.centroResultadoId);
      return (cod && crFilter.has(cod)) ? (linha.valores[pk(ano, mi)] ?? 0) : 0;
    }
    // Taxas percentuais sem CR são parâmetros universais — retorna valor sem filtro
    if (linha.isPercentual) return linha.valores[pk(ano, mi)] ?? 0;
    return 0;
  }

  if (linha.tipo === "subtotal") {
    return (linha.subtotalLinhaIds ?? []).reduce((s, id) => {
      const ref = allLinhas.get(id) ?? todas.find(l => l.id === id);
      if (!ref) return s;
      return s + evalLinhaValueFiltered(ref, todas, ano, mi, allLinhas, crFilter, crIdToCod, _depth + 1);
    }, 0);
  }

  // calculado — percorre a fórmula com sub-avaliação filtrada
  if (linha.formulaExpr && linha.formulaExpr.length > 0) {
    if (linha.formulaExpr.length === 3) {
      const [t0, t1, t2] = linha.formulaExpr;
      if (t0.t === "ref" && t1.t === "op" && t1.v === "*" && t2.t === "ref") {
        const tl = mi + t0.offset, tr = mi + t2.offset;
        if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
          const lL = allLinhas.get(t0.id) ?? todas.find(x => x.id === t0.id);
          const rL = allLinhas.get(t2.id) ?? todas.find(x => x.id === t2.id);
          const result3 = _eval3TokenFiltered(lL, rL, tl, tr, ano, crFilter, crIdToCod, todas, allLinhas);
          if (result3 !== null) return result3;
        }
      }
    }
    return evalExprTokens(linha.formulaExpr, (id, offset) => {
      const t = mi + offset;
      if (t < 0 || t > 11) return 0;
      const l = allLinhas.get(id) ?? todas.find(x => x.id === id);
      if (!l) return 0;
      const v = evalLinhaValueFiltered(l, todas, ano, t, allLinhas, crFilter, crIdToCod, _depth + 1);
      return l.isPercentual ? v / 100 : v;
    });
  }

  if (!linha.formula) return 0;
  const { op, left, right } = linha.formula;
  if (op === "*" && left.valorFixo === undefined && right.valorFixo === undefined) {
    const tl = mi + left.offset, tr = mi + right.offset;
    if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
      const lL = allLinhas.get(left.linhaId) ?? todas.find(x => x.id === left.linhaId);
      const rL = allLinhas.get(right.linhaId) ?? todas.find(x => x.id === right.linhaId);
      const resultLeg = _eval3TokenFiltered(lL, rL, tl, tr, ano, crFilter, crIdToCod, todas, allLinhas);
      if (resultLeg !== null) return resultLeg;
    }
  }

  const getVF = (o: FormulaOperando) => {
    if (o.valorFixo !== undefined) return o.valorFixo;
    const t = mi + o.offset;
    if (t < 0 || t > 11) return 0;
    const l = allLinhas.get(o.linhaId) ?? todas.find(x => x.id === o.linhaId);
    if (!l) return 0;
    const v = evalLinhaValueFiltered(l, todas, ano, t, allLinhas, crFilter, crIdToCod, _depth + 1);
    return l.isPercentual ? v / 100 : v;
  };

  const lv = getVF(left), rv = getVF(right);
  if (op === "*") return lv * rv;
  if (op === "+") return lv + rv;
  if (op === "-") return lv - rv;
  return rv !== 0 ? lv / rv : 0;
}

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Agrega todos os blocos de orçamento por item de DRE e período.
 * Retorna Map<demoItemId, Map<"YYYY-MM", valor_total>>
 *
 * dreField: "gerencial" usa demoItemIdGerencial; "contabil" usa demoItemIdContabil
 * Categorias incluídas: receita, gastos, impostos (indicador é excluído)
 */
// Builds a map from gerencial DRE item id → contabil DRE item id by matching descriptions.
// Used as a fallback when demoItemIdContabil is not set on an orcamento line.
interface GerContabRef {
  gerToCtb: Map<string, string>;      // gerencial id → contabil id (positional)
  currentContabilIds: Set<string>;    // valid ids in portal_dre_contabil
}

function buildGerToContabMap(): GerContabRef {
  type DREItem = { id: string; descricao: string };
  const gerencial = loadData<DREItem[]>("portal_dre", []);
  const contabil  = loadData<DREItem[]>("portal_dre_contabil", []);
  const currentContabilIds = new Set(contabil.map(i => i.id));

  // Mapeamento POSICIONAL puro: gerencial[i] → contabil[i].
  // "Copiar da DRE" preserva IDs nas mesmas posições, então este mapeamento é sempre exato.
  const gerToCtb = new Map<string, string>();
  const minLen = Math.min(gerencial.length, contabil.length);
  for (let i = 0; i < minLen; i++) gerToCtb.set(gerencial[i].id, contabil[i].id);

  console.log("[CTB-MAP] gerencial:", gerencial.length, "contabil:", contabil.length, "gerToCtb:", gerToCtb.size);
  return { gerToCtb, currentContabilIds };
}

export function buildOrcamentoMap(
  dreField: "gerencial" | "contabil",
  ano: number,
  crFilter?: Set<string> | null   // Set de CODCENCUS — null/undefined = sem filtro
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();

  const contabRef = dreField === "contabil" ? buildGerToContabMap() : null;
  const gerToCtb = contabRef?.gerToCtb ?? null;
  const currentContabilIds = contabRef?.currentContabilIds ?? null;
  const validCtb = (id: string | undefined | null): boolean =>
    !!id && (currentContabilIds ? currentContabilIds.has(id) : true);

  // Resolve o ID contábil usando SOMENTE código (nunca nome/descrição).
  // (1) demoItemIdContabil válido — usa direto.
  // (2) stale ou ausente + demoItemIdGerencial → mapeamento posicional gerencial→contabil.
  // (3) nenhum resolve → undefined (sem dado para este item).
  const resolveCtb = (ctb: string | undefined, ger: string | undefined): string | undefined =>
    validCtb(ctb) ? ctb : (ger ? gerToCtb?.get(ger) : undefined);

  // debug acumulador
  const _staleLog: { key: string; desc: string; ctbStale: string; ger: string; gerToCtbResult: string; resolved: string }[] = [];
  function _logResolve(key: string, desc: string, ctb: string | undefined, ger: string | undefined, resolvedId: string | undefined) {
    if (dreField !== "contabil") return;
    if (!ctb || validCtb(ctb)) return; // só loga quando stale
    _staleLog.push({
      key, desc,
      ctbStale: ctb ?? "",
      ger: ger || "(vazio)",
      gerToCtbResult: (ger ? gerToCtb?.get(ger) : undefined) ?? "(sem match)",
      resolved: resolvedId ?? "(NENHUM)",
    });
  }

  // Mapa id → CODCENCUS para resolver centroResultadoId das linhas
  type CRRow = { id: string; CODCENCUS: string };
  const crIdToCod = crFilter
    ? new Map(loadData<CRRow[]>("portal_centro_resultado", []).map(r => [r.id, r.CODCENCUS]))
    : null;

  for (const key of ORCAMENTO_KEYS) {
    const blocos = loadData<Bloco[]>(key, []);
    if (blocos.length > 0) {
      const totalLinhas = blocos.reduce((s,b)=>s+b.subBlocos.reduce((s2,sb)=>s2+sb.linhas.length,0),0);
      const comDemoCtb = blocos.reduce((s,b)=>s+b.subBlocos.reduce((s2,sb)=>s2+sb.linhas.filter(l=>!!l.demoItemIdContabil).length,0),0);
      const comDemoGer = blocos.reduce((s,b)=>s+b.subBlocos.reduce((s2,sb)=>s2+sb.linhas.filter(l=>!!l.demoItemIdGerencial).length,0),0);
      console.log("[ORC-DEBUG] key=" + key + " blocos=" + blocos.length + " linhas=" + totalLinhas + " c/demoCtb=" + comDemoCtb + " c/demoGer=" + comDemoGer);
    }

    // Mapa cross-bloco: necessário para formulaExpr que referenciam linhas de outros sub-blocos
    const allLinhasMap = new Map<string, LinhaOrcamento>();
    for (const bloco of blocos)
      for (const sub of bloco.subBlocos)
        for (const l of sub.linhas)
          allLinhasMap.set(l.id, l);

    // Pré-verificação: esta chave tem alguma linha digitado que passa o filtro de CR?
    // Usado para decidir se linhas calculado (sem centroResultadoId) devem ser incluídas.
    let keyHasCrMatch = !crIdToCod;
    if (crIdToCod) {
      outerKey: for (const bloco of blocos) {
        for (const sub of bloco.subBlocos) {
          for (const l of sub.linhas) {
            if (l.categoria === "indicador" || l.tipo === "calculado" || l.tipo === "subtotal") continue;
            if (l.centroResultadoId) {
              const cod = crIdToCod.get(l.centroResultadoId);
              if (cod && crFilter!.has(cod)) { keyHasCrMatch = true; break outerKey; }
            } else if (l.composicao?.length) {
              for (const c of l.composicao) {
                if (!c.centroId) continue;
                const cod = crIdToCod.get(c.centroId);
                if (cod && crFilter!.has(cod)) { keyHasCrMatch = true; break outerKey; }
              }
            }
          }
        }
      }
    }

    for (const bloco of blocos) {
      for (const sub of bloco.subBlocos) {
        for (const linha of sub.linhas) {
          if (linha.categoria === "indicador") continue;
          if (linha.tipo === "subtotal") continue;

          const temComposicao = (linha.composicao?.length ?? 0) > 0;
          const linhaPassouCR = crIdToCod && linha.centroResultadoId
            ? (() => { const cod = crIdToCod.get(linha.centroResultadoId!); return !!cod && crFilter!.has(cod); })()
            : false;
          if (crIdToCod) {
            if (linha.tipo === "calculado") {
              // Sempre avalia via fórmula — composicao stale é ignorada.
              if (linha.centroResultadoId && !linhaPassouCR) continue;
            } else {
              if (linha.centroResultadoId) {
                if (!linhaPassouCR) continue;
              } else if (!temComposicao) {
                continue;
              }
            }
          }

          // Composição com mapeamento por item (apenas digitado/subtotal)
          if (temComposicao && linha.tipo !== "calculado") {
            const hasPerItem = linha.composicao!.some(c =>
              dreField === "gerencial"
                ? (!!c.demoItemIdGerencial || !!c.demoItemIdContabil)
                : (!!c.demoItemIdContabil  || !!c.demoItemIdGerencial)
            );
            if (hasPerItem) {
              const sign = (linha.categoria === "gastos" || linha.categoria === "impostos") ? -1 : 1;
              for (const comp of linha.composicao!) {
                // Só filtra por comp.centroId quando a linha não tem CR próprio validado
                if (!linhaPassouCR && crIdToCod) {
                  if (!comp.centroId) continue;
                  const cod = crIdToCod.get(comp.centroId);
                  if (!cod || !crFilter!.has(cod)) continue;
                }
                const itemId = dreField === "gerencial"
                  ? (comp.demoItemIdGerencial || comp.demoItemIdContabil || linha.demoItemIdGerencial || linha.demoItemIdContabil)
                  : (resolveCtb(comp.demoItemIdContabil, comp.demoItemIdGerencial)
                     || resolveCtb(linha.demoItemIdContabil, linha.demoItemIdGerencial));
                _logResolve(key, comp.descricao, comp.demoItemIdContabil, comp.demoItemIdGerencial, itemId);
                _logResolve(key, linha.descricao, linha.demoItemIdContabil, linha.demoItemIdGerencial, itemId);
                if (!itemId) continue;
                for (let mi = 0; mi < 12; mi++) {
                  const raw = comp.valores[pk(ano, mi)] ?? 0;
                  if (!raw) continue;
                  const value = raw * sign;
                  const period = pk(ano, mi);
                  let m = result.get(itemId);
                  if (!m) { m = new Map(); result.set(itemId, m); }
                  m.set(period, (m.get(period) ?? 0) + value);
                }
              }
              continue;
            }

            // Composição sem mapeamento individual
            {
              const itemId = dreField === "gerencial"
                ? (linha.demoItemIdGerencial || linha.demoItemIdContabil)
                : resolveCtb(linha.demoItemIdContabil, linha.demoItemIdGerencial);
              _logResolve(key, linha.descricao, linha.demoItemIdContabil, linha.demoItemIdGerencial, itemId);
              if (!itemId) continue;
              const sign = (linha.categoria === "gastos" || linha.categoria === "impostos") ? -1 : 1;
              const compsFiltrados = !linhaPassouCR && crIdToCod
                ? linha.composicao!.filter(c => {
                    if (!c.centroId) return false;
                    const cod = crIdToCod.get(c.centroId);
                    return !!cod && crFilter!.has(cod);
                  })
                : linha.composicao!;
              for (let mi = 0; mi < 12; mi++) {
                const raw = compsFiltrados.reduce((s, c) => s + (c.valores[pk(ano, mi)] ?? 0), 0);
                if (raw === 0) continue;
                const period = pk(ano, mi);
                let m = result.get(itemId);
                if (!m) { m = new Map(); result.set(itemId, m); }
                m.set(period, (m.get(period) ?? 0) + raw * sign);
              }
              continue;
            }
          }

          // Sem composição ou composição sem mapeamento individual
          const itemId = dreField === "gerencial"
            ? (linha.demoItemIdGerencial || linha.demoItemIdContabil)
            : resolveCtb(linha.demoItemIdContabil, linha.demoItemIdGerencial);
          _logResolve(key, linha.descricao, linha.demoItemIdContabil, linha.demoItemIdGerencial, itemId);
          if (!itemId) continue;
          const sign = (linha.categoria === "gastos" || linha.categoria === "impostos") ? -1 : 1;
          // Para calculado sem CR próprio com filtro ativo: avalia a fórmula de forma filtrada.
          // Exceção: linha calculado gastos de eventos onde NEM a linha NEM as referências de fórmula
          // têm CR configurado → usa eval não filtrado (custo compartilhado aparece em todas as BUs).
          const isEventosGastosCalcSemCREmNenhurRef = (() => {
            if (key !== "portal_orcamento_gastos_pacote_eventos") return false;
            if (linha.tipo !== "calculado" || linha.categoria !== "gastos" || !!linha.centroResultadoId) return false;
            // Extrai IDs dos operandos da fórmula
            let lId: string | undefined, rId: string | undefined;
            if (linha.formulaExpr?.length === 3) {
              const [t0,,t2] = linha.formulaExpr;
              if (t0.t === "ref" && t2.t === "ref") { lId = t0.id; rId = t2.id; }
            } else if (linha.formula?.op === "*" && linha.formula.left.valorFixo === undefined) {
              lId = linha.formula.left.linhaId;
              rId = linha.formula.right.linhaId;
            }
            const lRef = lId ? (allLinhasMap.get(lId) ?? sub.linhas.find(x => x.id === lId)) : undefined;
            const rRef = rId ? (allLinhasMap.get(rId) ?? sub.linhas.find(x => x.id === rId)) : undefined;
            const refHasCR =
              !!(lRef?.centroResultadoId) || !!(rRef?.centroResultadoId) ||
              !!(lRef?.composicao?.some(c => !!c.centroId)) ||
              !!(rRef?.composicao?.some(c => !!c.centroId));
            return !refHasCR; // só true quando não há CR em nenhum lugar da cadeia
          })();
          const useFilteredEval = !!(crIdToCod && linha.tipo === "calculado" && !linhaPassouCR && !isEventosGastosCalcSemCREmNenhurRef);
          for (let mi = 0; mi < 12; mi++) {
            const raw = useFilteredEval
              ? evalLinhaValueFiltered(linha, sub.linhas, ano, mi, allLinhasMap, crFilter!, crIdToCod!)
              : evalLinhaValue(linha, sub.linhas, ano, mi, allLinhasMap);
            if (raw === 0) continue;
            const value = raw * sign;
            const period = pk(ano, mi);
            let m = result.get(itemId);
            if (!m) { m = new Map(); result.set(itemId, m); }
            m.set(period, (m.get(period) ?? 0) + value);
          }
        }
      }
    }
  }

  if (dreField === "contabil" && _staleLog.length > 0) {
    console.group("[STALE-DEBUG] " + _staleLog.length + " linhas com demoItemIdContabil stale");
    for (const e of _staleLog) {
      console.log("key=" + e.key + " | desc=" + e.desc + " | ctbStale=" + e.ctbStale + " | ger=" + e.ger + " | gerToCtb→" + e.gerToCtbResult + " | RESOLVEU→" + e.resolved);
    }
    console.groupEnd();
  }
  if (dreField === "contabil") {
    console.log("[ORC-MAP] resultado final: " + result.size + " IDs no orcMap. Todos os IDs:", [...result.keys()]);
  }
  return result;
}

// ─── Debug: rastreamento de linhas calculado de eventos no Por BU ─────────────

export interface EventosCalcDebugEntry {
  linhaDesc:      string;
  blocoDesc:      string;
  subBlocoDesc:   string;
  centroResultadoId?: string;
  crCod?:         string;
  crNoFiltro:     boolean;
  linhaPassouCR:  boolean;
  useFilteredEval: boolean;
  refHasCR:       boolean;
  isSemCREmNenhurRef: boolean;
  temDemoItemId:  boolean;
  formulaTokens:  string;
  lLinhaDesc?:    string;
  lEncontrada:    boolean;
  lHasComp:       boolean;
  lCompLen:       number;
  rLinhaDesc?:    string;
  rEncontrada:    boolean;
  rHasComp:       boolean;
  rCompLen:       number;
  rawJan:         number;
  rawTotal:       number;
  problema:       string;
}

export function buildEventosCalcDebug(
  ano: number,
  crFilter: Set<string>
): EventosCalcDebugEntry[] {
  const entries: EventosCalcDebugEntry[] = [];
  type CRRow = { id: string; CODCENCUS: string };
  const crIdToCod = new Map(loadData<CRRow[]>("portal_centro_resultado", []).map(r => [r.id, r.CODCENCUS]));

  const blocos = loadData<Bloco[]>("portal_orcamento_gastos_pacote_eventos", []);

  const allLinhasMap = new Map<string, LinhaOrcamento>();
  for (const bloco of blocos)
    for (const sub of bloco.subBlocos)
      for (const l of sub.linhas)
        allLinhasMap.set(l.id, l);

  for (const bloco of blocos) {
    for (const sub of bloco.subBlocos) {
      for (const linha of sub.linhas) {
        if (linha.tipo !== "calculado") continue;
        if (linha.categoria === "indicador") continue;

        const crCod = linha.centroResultadoId ? crIdToCod.get(linha.centroResultadoId) : undefined;
        const crNoFiltro = !!crCod && crFilter.has(crCod);
        const linhaPassouCR = crNoFiltro;
        const useFilteredEval = !linhaPassouCR; // !!(crFilter && calculado && !linhaPassouCR)

        const temDemoItemId = !!(linha.demoItemIdContabil || linha.demoItemIdGerencial);

        // Extrai tokens da fórmula
        let formulaTokens = "—";
        let lId: string | undefined, rId: string | undefined;
        if (linha.formulaExpr && linha.formulaExpr.length > 0) {
          formulaTokens = linha.formulaExpr.map(t => t.t === "ref" ? `ref(${t.id.slice(0,6)})` : t.t === "op" ? t.v : String(t.v)).join(" ");
          if (linha.formulaExpr.length === 3) {
            const [t0, , t2] = linha.formulaExpr;
            if (t0.t === "ref" && t2.t === "ref") { lId = t0.id; rId = t2.id; }
          }
        } else if (linha.formula) {
          formulaTokens = `${linha.formula.left.linhaId?.slice(0,6)} ${linha.formula.op} ${linha.formula.right.linhaId?.slice(0,6)}`;
          lId = linha.formula.left.linhaId;
          rId = linha.formula.right.linhaId;
        }

        const lL = lId ? (sub.linhas.find(x => x.id === lId) ?? allLinhasMap.get(lId)) : undefined;
        const rL = rId ? (sub.linhas.find(x => x.id === rId) ?? allLinhasMap.get(rId)) : undefined;

        // Verifica se alguma referência da fórmula possui atribuição de CR
        const refHasCR =
          !!(lL?.centroResultadoId) || !!(rL?.centroResultadoId) ||
          !!(lL?.composicao?.some(c => !!c.centroId)) ||
          !!(rL?.composicao?.some(c => !!c.centroId));
        const isSemCREmNenhurRef = !linha.centroResultadoId && !refHasCR;

        // Calcula raw para Janeiro (mi=0) e total anual
        let rawJan = 0, rawTotal = 0;
        for (let mi = 0; mi < 12; mi++) {
          const v = useFilteredEval
            ? evalLinhaValueFiltered(linha, sub.linhas, ano, mi, allLinhasMap, crFilter, crIdToCod)
            : evalLinhaValue(linha, sub.linhas, ano, mi, allLinhasMap);
          if (mi === 0) rawJan = v;
          rawTotal += v;
        }

        // Diagnóstico
        const problemas: string[] = [];
        if (!temDemoItemId) problemas.push("sem demoItemId → não chega à DRE");
        if (!linha.centroResultadoId) {
          if (refHasCR) {
            // CR está nos itens de composição do Qtd ou TM — atribuição correta por composição
            problemas.push("sem centroResultadoId na linha, mas Qtd/TM têm centroId nos itens → atribuído por composição por BU");
          } else {
            problemas.push("sem CR em nenhuma referência → aparece em TODAS as BUs (custo compartilhado). Adicione centroId nos itens de composição do Qtd para atribuir por BU");
          }
        } else if (!crNoFiltro) {
          problemas.push(`centroResultadoId existe mas CR '${crCod ?? "?"}' NÃO está no filtro de BU`);
        }
        if (lId && !lL) problemas.push(`linha Qtd id=${lId.slice(0,6)} NÃO encontrada`);
        if (rId && !rL) problemas.push(`linha TM id=${rId.slice(0,6)} NÃO encontrada`);
        if (useFilteredEval && rawTotal === 0 && refHasCR) problemas.push("evalFiltered retorna 0 — centroId nos itens não bate com nenhuma BU");
        if (useFilteredEval && rawTotal === 0 && !refHasCR) problemas.push("evalFiltered retorna 0 — adicione centroId nos itens de composição");
        if (!useFilteredEval && rawTotal === 0) problemas.push("evalLinhaValue retorna 0 — fórmula não resolve: verifique se Qtd e TM têm composição com valores");
        if (rawTotal !== 0 && !temDemoItemId) problemas.push("tem valor mas sem demoItemId → dado perdido");

        entries.push({
          linhaDesc: linha.descricao,
          blocoDesc: bloco.descricao,
          subBlocoDesc: sub.descricao,
          centroResultadoId: linha.centroResultadoId,
          crCod,
          crNoFiltro,
          linhaPassouCR,
          useFilteredEval,
          refHasCR,
          isSemCREmNenhurRef,
          temDemoItemId,
          formulaTokens,
          lLinhaDesc: lL?.descricao,
          lEncontrada: !!lL,
          lHasComp: (lL?.composicao?.length ?? 0) > 0,
          lCompLen: lL?.composicao?.length ?? 0,
          rLinhaDesc: rL?.descricao,
          rEncontrada: !!rL,
          rHasComp: (rL?.composicao?.length ?? 0) > 0,
          rCompLen: rL?.composicao?.length ?? 0,
          rawJan,
          rawTotal,
          problema: problemas.length ? problemas.join(" | ") : "OK",
        });
      }
    }
  }
  return entries;
}

/**
 * Repara os demoItemIdContabil stale em todas as chaves de orçamento.
 *
 * Estratégia (somente por código):
 *  1. Mapeamento posicional gerencial[i] → contabil[i] (cobre os itens da cópia gerencial).
 *  2. Para linhas que tinham demoItemIdContabil stale mas têm demoItemIdGerencial válido
 *     → substitui ctb pelo ID contábil na mesma posição (gerToCtb).
 *  3. Para linhas cujo stale ctb aponta para uma posição além do gerencial (itens extras de
 *     CUSTOS/DESPESAS que foram adicionados manualmente ao DRE Contábil) → usa a lista de
 *     todos os IDs contábeis agrupados por descrição para fazer a correspondência 1-para-1
 *     dentro de cada grupo, na ordem em que aparecem no DRE.
 *
 * Retorna { reparadas, ignoradas } para feedback ao usuário.
 */
export function repararOrcamentoContabilIds(): { reparadas: number; ignoradas: number } {
  type DREItem = { id: string; descricao: string };
  const gerencial = loadData<DREItem[]>("portal_dre", []);
  const contabil  = loadData<DREItem[]>("portal_dre_contabil", []);
  const currentCtbIds = new Set(contabil.map(i => i.id));

  // Mapeamento posicional: gerencial[i].id → contabil[i].id
  const gerToCtb = new Map<string, string>();
  const minLen = Math.min(gerencial.length, contabil.length);
  for (let i = 0; i < minLen; i++) gerToCtb.set(gerencial[i].id, contabil[i].id);

  // Para itens extras (posição >= gerencial.length): agrupados por descrição em ordem de aparição.
  // Cada grupo é uma fila — cada linha stale com aquela descrição retira o próximo ID disponível.
  const extraByDesc = new Map<string, string[]>();
  contabil.forEach((c, i) => {
    if (i < gerencial.length) return;
    const key = c.descricao.trim().toLowerCase();
    if (!extraByDesc.has(key)) extraByDesc.set(key, []);
    extraByDesc.get(key)!.push(c.id);
  });
  // Ponteiros de consumo por descrição (para atribuição sequencial)
  const extraPtr = new Map<string, number>();

  let reparadas = 0, ignoradas = 0;

  for (const key of ORCAMENTO_KEYS) {
    const blocos = loadData<Bloco[]>(key, []);
    if (!blocos.length) continue;
    let changed = false;

    for (const bloco of blocos) {
      for (const sub of bloco.subBlocos) {
        for (const linha of sub.linhas) {
          changed = _repararLinha(linha) || changed;
          for (const comp of linha.composicao ?? []) {
            changed = _repararComp(comp) || changed;
          }
        }
      }
    }
    if (changed) saveData(key, blocos);
  }

  return { reparadas, ignoradas };

  function _resolve(ctb: string | undefined, ger: string | undefined, desc: string): string | undefined {
    if (ctb && currentCtbIds.has(ctb)) return undefined; // já válido
    // 1. via gerToCtb
    if (ger) {
      const via = gerToCtb.get(ger);
      if (via) return via;
    }
    // 2. via itens extras (fila por descrição)
    const descKey = desc.trim().toLowerCase();
    const lista = extraByDesc.get(descKey);
    if (lista) {
      const ptr = extraPtr.get(descKey) ?? 0;
      if (ptr < lista.length) {
        extraPtr.set(descKey, ptr + 1);
        return lista[ptr];
      }
    }
    return undefined;
  }

  function _repararLinha(linha: LinhaOrcamento): boolean {
    const novo = _resolve(linha.demoItemIdContabil, linha.demoItemIdGerencial, linha.descricao);
    if (!novo) { if (linha.demoItemIdContabil && !currentCtbIds.has(linha.demoItemIdContabil)) ignoradas++; return false; }
    linha.demoItemIdContabil = novo;
    reparadas++;
    return true;
  }

  function _repararComp(comp: ComposicaoItem): boolean {
    const novo = _resolve(comp.demoItemIdContabil, comp.demoItemIdGerencial, comp.descricao);
    if (!novo) { if (comp.demoItemIdContabil && !currentCtbIds.has(comp.demoItemIdContabil)) ignoradas++; return false; }
    comp.demoItemIdContabil = novo;
    reparadas++;
    return true;
  }
}

export const ORCAMENTO_AREA_LABELS: Record<string, string> = {
  portal_orcamento_gestao_recursos:                        "Gestão de Recursos",
  portal_orcamento_advisory:                               "Advisory",
  portal_orcamento_investment_banking:                     "Investment Banking",
  portal_orcamento_research:                               "Research",
  portal_orcamento_gastos_pacote_pessoal:                  "Gastos · Pacote de Pessoal",
  portal_orcamento_gastos_pacote_certificacao:             "Gastos · Pacote de Certificação",
  portal_orcamento_gastos_pacote_incentivos_comerciais:    "Gastos · Pacote de Incentivos Comerciais",
  portal_orcamento_gastos_pacote_institucional:            "Gastos · Pacote Institucional",
  portal_orcamento_gastos_pacote_ocupacao:                 "Gastos · Pacote Ocupação",
  portal_orcamento_gastos_pacote_eventos:                  "Gastos · Pacote de Eventos",
  portal_orcamento_gastos_pacote_servicos_especializados:  "Gastos · Pacote de Serviços Especializados",
  portal_orcamento_gastos_pacote_servicos_juridicos:       "Gastos · Pacote de Serviços Jurídicos",
  portal_orcamento_gastos_pacote_tecnologia:               "Gastos · Pacote de Tecnologia",
  portal_orcamento_gastos_pacote_viagens:                  "Gastos · Pacote de Viagens",
};

export interface OrcamentoDebugEntry {
  itemId:      string;
  linhaDesc:   string;
  area:        string;
  storageKey:  string;
  blocoDesc:   string;
  subBlocoDesc: string;
  totalAno:    number;
  tipo:        TipoLinha;
}

/**
 * Retorna detalhes de diagnóstico: para cada (itemId, área), quais linhas de
 * orçamento estão mapeadas e qual o total anual. Útil para identificar de qual
 * área vem cada ID da DRE.
 */
export function buildOrcamentoDebug(
  dreField: "gerencial" | "contabil",
  ano: number
): OrcamentoDebugEntry[] {
  const entries: OrcamentoDebugEntry[] = [];

  for (const key of ORCAMENTO_KEYS) {
    const blocos = loadData<Bloco[]>(key, []);
    for (const bloco of blocos) {
      for (const sub of bloco.subBlocos) {
        for (const linha of sub.linhas) {
          if (linha.categoria === "indicador") continue;
          if (linha.tipo === "subtotal") continue;
          const itemId = dreField === "gerencial"
            ? linha.demoItemIdGerencial
            : linha.demoItemIdContabil;
          if (!itemId) continue;

          let total = 0;
          for (let mi = 0; mi < 12; mi++) {
            total += evalLinhaValue(linha, sub.linhas, ano, mi);
          }
          if (total === 0) continue;

          entries.push({
            itemId,
            linhaDesc:    linha.descricao,
            area:         ORCAMENTO_AREA_LABELS[key] ?? key,
            storageKey:   key,
            blocoDesc:    bloco.descricao,
            subBlocoDesc: sub.descricao,
            totalAno:     total,
            tipo:         linha.tipo,
          });
        }
      }
    }
  }

  return entries;
}

export interface OrcamentoSemMapeamentoEntry {
  area:         string;
  blocoDesc:    string;
  subBlocoDesc: string;
  linhaDesc:    string;
  tipo:         string;
  categoria:    string;
  totalAno:     number;
  motivo:       string;
}

/**
 * Retorna linhas de orçamento que têm valores mas NÃO têm demoItemId mapeado —
 * ou seja, dados que existem no orçamento mas nunca chegam à DRE.
 */
export function buildOrcamentoSemMapeamento(
  dreField: "gerencial" | "contabil",
  ano: number
): OrcamentoSemMapeamentoEntry[] {
  const entries: OrcamentoSemMapeamentoEntry[] = [];

  for (const key of ORCAMENTO_KEYS) {
    const blocos = loadData<Bloco[]>(key, []);
    for (const bloco of blocos) {
      for (const sub of bloco.subBlocos) {
        for (const linha of sub.linhas) {
          if (linha.categoria === "indicador") continue;
          if (linha.tipo === "subtotal") continue;

          // Mesmo fallback de buildOrcamentoMap: contabil || gerencial (e vice-versa)
          const itemIdLinha = dreField === "gerencial"
            ? (linha.demoItemIdGerencial || linha.demoItemIdContabil)
            : (linha.demoItemIdContabil  || linha.demoItemIdGerencial);
          const temComposicao = (linha.composicao?.length ?? 0) > 0;

          // Bloco de composicao: apenas para digitado (calculado usa fórmula, não comp.valores)
          if (temComposicao && linha.tipo !== "calculado") {
            const hasPerItem = linha.composicao!.some(c =>
              dreField === "gerencial"
                ? (!!c.demoItemIdGerencial || !!c.demoItemIdContabil)
                : (!!c.demoItemIdContabil  || !!c.demoItemIdGerencial)
            );
            if (hasPerItem) {
              // Para composição com mapeamento por item, verifica cada item
              for (const comp of linha.composicao!) {
                const compId = dreField === "gerencial"
                  ? (comp.demoItemIdGerencial || comp.demoItemIdContabil)
                  : (comp.demoItemIdContabil  || comp.demoItemIdGerencial);
                if (!compId) {
                  let totalComp = 0;
                  for (let mi = 0; mi < 12; mi++) totalComp += comp.valores[pk(ano, mi)] ?? 0;
                  if (totalComp !== 0)
                    entries.push({ area: ORCAMENTO_AREA_LABELS[key] ?? key, blocoDesc: bloco.descricao, subBlocoDesc: sub.descricao, linhaDesc: `${linha.descricao} › ${comp.descricao}`, tipo: linha.tipo, categoria: linha.categoria, totalAno: totalComp, motivo: "item de composição sem demoItemId" });
                }
              }
              continue;
            }
          }

          // Linha sem demoItemId — verifica se tem valor
          if (!itemIdLinha) {
            let total = 0;
            if (linha.tipo === "calculado") {
              for (let mi = 0; mi < 12; mi++) total += evalLinhaValue(linha, sub.linhas, ano, mi);
            } else if (temComposicao) {
              for (let mi = 0; mi < 12; mi++)
                for (const c of linha.composicao!) total += c.valores[pk(ano, mi)] ?? 0;
            } else {
              for (let mi = 0; mi < 12; mi++) total += evalLinhaValue(linha, sub.linhas, ano, mi);
            }
            if (total !== 0)
              entries.push({ area: ORCAMENTO_AREA_LABELS[key] ?? key, blocoDesc: bloco.descricao, subBlocoDesc: sub.descricao, linhaDesc: linha.descricao, tipo: linha.tipo, categoria: linha.categoria, totalAno: total, motivo: `sem demoItemId${dreField === "contabil" ? "Contabil" : "Gerencial"} — dado perdido` });
          }
        }
      }
    }
  }

  return entries;
}

export interface OrcamentoCRDiagEntry {
  area: string;
  linhaDesc: string;
  tipo: string;
  categoria: string;
  crId?: string;
  crCod?: string;
  passou: boolean;
  motivo: string;
  composicaoTotal: number;
  composicaoPassou: number;
  totalAno: number;
}

/** Diagnóstico de quais linhas passam ou são excluídas pelo filtro de CR. */
export function buildOrcamentoCRDiag(
  dreField: "gerencial" | "contabil",
  ano: number,
  crFilter: Set<string>
): OrcamentoCRDiagEntry[] {
  const entries: OrcamentoCRDiagEntry[] = [];
  type CRRow = { id: string; CODCENCUS: string };
  const crIdToCod = new Map(loadData<CRRow[]>("portal_centro_resultado", []).map(r => [r.id, r.CODCENCUS]));

  for (const key of ORCAMENTO_KEYS) {
    const blocos = loadData<Bloco[]>(key, []);
    const area = ORCAMENTO_AREA_LABELS[key] ?? key;

    let keyHasCrMatch = false;
    outerKey: for (const bloco of blocos) {
      for (const sub of bloco.subBlocos) {
        for (const l of sub.linhas) {
          if (l.categoria === "indicador" || l.tipo === "calculado" || l.tipo === "subtotal") continue;
          if (l.centroResultadoId) {
            const cod = crIdToCod.get(l.centroResultadoId);
            if (cod && crFilter.has(cod)) { keyHasCrMatch = true; break outerKey; }
          } else if (l.composicao?.length) {
            for (const c of l.composicao) {
              if (!c.centroId) continue;
              const cod = crIdToCod.get(c.centroId);
              if (cod && crFilter.has(cod)) { keyHasCrMatch = true; break outerKey; }
            }
          }
        }
      }
    }

    for (const bloco of blocos) {
      for (const sub of bloco.subBlocos) {
        for (const linha of sub.linhas) {
          if (linha.categoria === "indicador") continue;
          if (linha.tipo === "subtotal") continue;
          const temComposicao = (linha.composicao?.length ?? 0) > 0;
          const crCod = linha.centroResultadoId ? crIdToCod.get(linha.centroResultadoId) : undefined;
          const linhaPassouCR = crCod ? crFilter.has(crCod) : false;

          let passou = false;
          let motivo = "";
          let composicaoTotal = 0;
          let composicaoPassou = 0;

          if (linha.tipo === "calculado") {
            // composicao stale é ignorada — buildOrcamentoMap sempre avalia via fórmula
            passou = linhaPassouCR || !linha.centroResultadoId;
            motivo = linhaPassouCR
              ? `calculado; CR próprio ${crCod} no filtro`
              : linha.centroResultadoId
                ? `calculado; CR próprio ${crCod ?? "?"} fora do filtro → excluído`
                : "calculado sem CR próprio → avalia fórmula filtrada pelos itens referenciados";
          } else if (linha.centroResultadoId) {
            passou = linhaPassouCR;
            motivo = linhaPassouCR ? `CR ${crCod} no filtro` : `CR ${crCod ?? "?"} fora do filtro`;
          } else if (temComposicao) {
            composicaoTotal = linha.composicao!.length;
            composicaoPassou = linha.composicao!.filter(c => {
              if (!c.centroId) return false;
              const cod = crIdToCod.get(c.centroId);
              return !!cod && crFilter.has(cod);
            }).length;
            passou = composicaoPassou > 0;
            motivo = `sem CR linha; composição ${composicaoPassou}/${composicaoTotal} itens com CR no filtro`;
          } else {
            passou = false;
            motivo = "sem CR e sem composição (excluído)";
          }

          const hasItemId = dreField === "gerencial"
            ? !!(linha.demoItemIdGerencial || linha.demoItemIdContabil)
            : !!(linha.demoItemIdContabil  || linha.demoItemIdGerencial);
          if (!hasItemId && !temComposicao) motivo += " · sem mapeamento DRE";

          let totalAno = 0;
          if (linha.tipo === "digitado") {
            if (temComposicao) {
              for (let mi = 0; mi < 12; mi++)
                for (const c of linha.composicao!)
                  totalAno += c.valores[`${ano}-${String(mi+1).padStart(2,"0")}`] ?? 0;
            } else {
              for (let mi = 0; mi < 12; mi++)
                totalAno += linha.valores[`${ano}-${String(mi+1).padStart(2,"0")}`] ?? 0;
            }
          }

          entries.push({ area, linhaDesc: linha.descricao, tipo: linha.tipo, categoria: linha.categoria, crId: linha.centroResultadoId, crCod, passou, motivo, composicaoTotal, composicaoPassou, totalAno });
        }
      }
    }
  }
  return entries;
}

export interface OrcamentoSemCRAtribEntry {
  area:         string;
  blocoDesc:    string;
  subBlocoDesc: string;
  linhaDesc:    string;
  tipo:         TipoLinha;
  categoria:    string;
  totalAno:     number;
  motivo:       string;
}

/**
 * Retorna linhas de orçamento que têm valores, estão mapeadas para a DRE,
 * mas NÃO têm atribuição de CR (nem centroResultadoId próprio nem centroId
 * em nenhum item de composição) → não aparecem em nenhuma coluna do Por BU.
 */
export function buildOrcamentoSemCRAtrib(
  dreField: "gerencial" | "contabil",
  ano: number
): OrcamentoSemCRAtribEntry[] {
  const entries: OrcamentoSemCRAtribEntry[] = [];
  const allLinhasMapGlobal = new Map<string, LinhaOrcamento>();

  for (const key of ORCAMENTO_KEYS) {
    const blocos = loadData<Bloco[]>(key, []);
    for (const bloco of blocos)
      for (const sub of bloco.subBlocos)
        for (const l of sub.linhas)
          allLinhasMapGlobal.set(l.id, l);
  }

  for (const key of ORCAMENTO_KEYS) {
    const blocos = loadData<Bloco[]>(key, []);
    const area = ORCAMENTO_AREA_LABELS[key] ?? key;

    for (const bloco of blocos) {
      for (const sub of bloco.subBlocos) {
        for (const linha of sub.linhas) {
          if (linha.categoria === "indicador" || linha.tipo === "subtotal") continue;

          const itemId = dreField === "gerencial"
            ? (linha.demoItemIdGerencial || linha.demoItemIdContabil)
            : (linha.demoItemIdContabil  || linha.demoItemIdGerencial);
          if (!itemId) continue; // já aparece em sem-mapeamento

          const temComposicao = (linha.composicao?.length ?? 0) > 0;
          const hasOwnCR   = !!linha.centroResultadoId;
          // Para calculado, composicao é ignorada — buildOrcamentoMap sempre avalia via fórmula
          const hasCompCR  = linha.tipo !== "calculado" && temComposicao && linha.composicao!.some(c => !!c.centroId);

          // Para linhas calculado, verifica se as referências de fórmula têm CR configurado
          let hasFormulaCR = false;
          if (!hasOwnCR && !hasCompCR && linha.tipo === "calculado") {
            const getLId = (): string | undefined => {
              if (linha.formulaExpr?.length === 3) {
                const [t0,,t2] = linha.formulaExpr;
                if (t0.t === "ref" && t2.t === "ref") return t0.id;
              }
              if (linha.formula?.op === "*") return linha.formula.left.linhaId;
              return undefined;
            };
            const getRId = (): string | undefined => {
              if (linha.formulaExpr?.length === 3) {
                const [t0,,t2] = linha.formulaExpr;
                if (t0.t === "ref" && t2.t === "ref") return t2.id;
              }
              if (linha.formula?.op === "*") return linha.formula.right.linhaId;
              return undefined;
            };
            const lRef = allLinhasMapGlobal.get(getLId() ?? "");
            const rRef = allLinhasMapGlobal.get(getRId() ?? "");
            hasFormulaCR =
              !!(lRef?.centroResultadoId) || !!(rRef?.centroResultadoId) ||
              !!(lRef?.composicao?.some(c => !!c.centroId)) ||
              !!(rRef?.composicao?.some(c => !!c.centroId));
          }

          if (hasOwnCR || hasCompCR || hasFormulaCR) continue; // tem atribuição → skip

          let totalAno = 0;
          if (linha.tipo === "calculado") {
            for (let mi = 0; mi < 12; mi++)
              totalAno += evalLinhaValue(linha, sub.linhas, ano, mi, allLinhasMapGlobal);
          } else if (temComposicao) {
            for (let mi = 0; mi < 12; mi++)
              for (const c of linha.composicao!) totalAno += c.valores[pk(ano, mi)] ?? 0;
          } else {
            for (let mi = 0; mi < 12; mi++)
              totalAno += evalLinhaValue(linha, sub.linhas, ano, mi, allLinhasMapGlobal);
          }

          if (Math.abs(totalAno) < 0.01) continue;

          let motivo = "";
          if (temComposicao) {
            const n = linha.composicao!.length;
            motivo = `${n} item${n !== 1 ? "s" : ""} de composição sem CR → atribua CR a cada item OU ao campo "C. Resultado" da linha`;
          } else if (linha.tipo === "calculado") {
            motivo = "calculado sem CR próprio → defina 'C. Resultado' na linha, OU defina 'C. Resultado' nas linhas digitadas referenciadas pela fórmula";
          } else {
            motivo = "sem CR próprio → atribua CR ao campo 'C. Resultado' da linha";
          }

          entries.push({ area, blocoDesc: bloco.descricao, subBlocoDesc: sub.descricao, linhaDesc: linha.descricao, tipo: linha.tipo, categoria: linha.categoria, totalAno, motivo });
        }
      }
    }
  }

  return entries;
}

// ─── Diagnóstico de atribuição Por BU para linhas com composição ─────────────

export interface GastosAtribDiagEntry {
  area:         string;
  blocoDesc:    string;
  subBlocoDesc: string;
  linhaDesc:    string;
  demoItemId:   string;
  totalAno:     number;
  atribAno:     number;       // itens COM centroId que mapeiam para ao menos uma BU
  semCentroAno: number;       // itens SEM centroId
  crSemBUAno:   number;       // itens COM centroId mas cujo CR não pertence a nenhuma BU
  crSemBU:      string[];     // CODCENCUS que não têm BU pai
  nItens:       number;
  nSemCentro:   number;
  nCrSemBU:     number;
}

/**
 * Para cada linha de gastos com composição (todos os pacotes), mostra
 * quanto vai para BUs (atribAno), quanto some por falta de centroId (semCentroAno),
 * e quanto some porque o CR não pertence a nenhuma BU da hierarquia (crSemBUAno).
 * Retorna apenas linhas com alguma divergência (atribAno < totalAno).
 */
export function buildGastosAtribDiag(
  dreField: "gerencial" | "contabil",
  ano: number,
  buCrSets: Map<string, Set<string>> // Map<buCod, Set<CODCENCUS>>
): GastosAtribDiagEntry[] {
  const entries: GastosAtribDiagEntry[] = [];
  type CRRow = { id: string; CODCENCUS: string };
  const crIdToCod = new Map(loadData<CRRow[]>("portal_centro_resultado", []).map(r => [r.id, r.CODCENCUS]));

  // Conjunto de todos os CODCENCUS que aparecem em alguma BU
  const allBUCods = new Set<string>();
  for (const set of buCrSets.values()) for (const c of set) allBUCods.add(c);

  const GASTOS_KEYS = ORCAMENTO_KEYS.filter(k =>
    k !== "portal_orcamento_gestao_recursos" &&
    k !== "portal_orcamento_advisory" &&
    k !== "portal_orcamento_investment_banking" &&
    k !== "portal_orcamento_research"
  );

  for (const key of GASTOS_KEYS) {
    const blocos = loadData<Bloco[]>(key, []);
    const area = ORCAMENTO_AREA_LABELS[key] ?? key;

    for (const bloco of blocos) {
      for (const sub of bloco.subBlocos) {
        for (const linha of sub.linhas) {
          if (linha.categoria === "indicador" || linha.tipo !== "digitado") continue;
          const comp = linha.composicao;
          if (!comp || comp.length === 0) continue;

          const demoItemId = dreField === "contabil"
            ? (linha.demoItemIdContabil || linha.demoItemIdGerencial)
            : (linha.demoItemIdGerencial || linha.demoItemIdContabil);

          // Detalhado: linha sem demoItemId próprio, mas itens têm demoItemId individual
          const hasPerItem = !demoItemId && comp.some(c =>
            dreField === "contabil"
              ? !!(c.demoItemIdContabil || c.demoItemIdGerencial)
              : !!(c.demoItemIdGerencial || c.demoItemIdContabil)
          );

          if (!demoItemId && !hasPerItem) continue;
          const effectiveDemoItemId = demoItemId ?? "(detalhado — por item)";

          let totalAno = 0, atribAno = 0, semCentroAno = 0, crSemBUAno = 0;
          let nSemCentro = 0, nCrSemBU = 0;
          const crSemBUSet = new Set<string>();

          for (const item of comp) {
            const itemTotal = Object.keys(item.valores)
              .filter(k => k.startsWith(`${ano}-`))
              .reduce((s, k) => s + (item.valores[k] ?? 0), 0);
            totalAno += itemTotal;

            if (!item.centroId) {
              semCentroAno += itemTotal;
              nSemCentro++;
            } else {
              const cod = crIdToCod.get(item.centroId);
              if (!cod || !allBUCods.has(cod)) {
                crSemBUAno += itemTotal;
                nCrSemBU++;
                if (cod) crSemBUSet.add(cod);
              } else {
                atribAno += itemTotal;
              }
            }
          }

          // Inclui só linhas com algum valor não atribuído a BU
          if (Math.abs(totalAno) < 0.01) continue;
          if (Math.abs(semCentroAno) < 0.01 && Math.abs(crSemBUAno) < 0.01) continue;

          entries.push({
            area, blocoDesc: bloco.descricao, subBlocoDesc: sub.descricao,
            linhaDesc: linha.descricao, demoItemId: effectiveDemoItemId,
            totalAno, atribAno, semCentroAno, crSemBUAno,
            crSemBU: [...crSemBUSet],
            nItens: comp.length, nSemCentro, nCrSemBU,
          });
        }
      }
    }
  }

  return entries.sort((a, b) => Math.abs(b.semCentroAno + b.crSemBUAno) - Math.abs(a.semCentroAno + a.crSemBUAno));
}

/** Anos que possuem valores lançados em qualquer página de orçamento. */
export function getOrcamentoAnos(): number[] {
  const anos = new Set<number>();

  for (const key of ORCAMENTO_KEYS) {
    const blocos = loadData<Bloco[]>(key, []);
    for (const bloco of blocos) {
      for (const sub of bloco.subBlocos) {
        for (const linha of sub.linhas) {
          for (const period of Object.keys(linha.valores)) {
            const y = parseInt(period.split("-")[0]);
            if (!isNaN(y)) anos.add(y);
          }
          for (const comp of linha.composicao ?? []) {
            for (const period of Object.keys(comp.valores)) {
              const y = parseInt(period.split("-")[0]);
              if (!isNaN(y)) anos.add(y);
            }
          }
        }
      }
    }
  }

  if (anos.size === 0) anos.add(new Date().getFullYear());
  return [...anos].sort((a, b) => b - a);
}
