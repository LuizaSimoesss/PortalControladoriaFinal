// Shared formula evaluation for orçamento linhas.
// Used by individual orçamento pages and by the orcado aggregator.

export type ExprToken =
  | { t: "ref"; id: string; offset: 0 | -1 | 1 }
  | { t: "num"; v: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "(" | ")" };

export interface FormulaOperando { linhaId: string; offset: 0 | -1 | 1; valorFixo?: number }
export interface Formula { op: "*" | "+" | "-" | "/"; left: FormulaOperando; right: FormulaOperando }
export interface ComposicaoItem { id: string; descricao: string; valores: Record<string, number> }

export interface LinhaEval {
  id: string;
  tipo: "digitado" | "calculado" | "subtotal";
  isPercentual?: boolean;
  composicao?: ComposicaoItem[];
  formula?: Formula;
  formulaExpr?: ExprToken[];
  valores: Record<string, number>;
  subtotalLinhaIds?: string[];
}

export function pk(ano: number, m: number): string {
  return `${ano}-${String(m + 1).padStart(2, "0")}`;
}

function _applyOp(op: string, stk: number[]) {
  const b = stk.pop() ?? 0, a = stk.pop() ?? 0;
  if (op === "+") stk.push(a + b);
  else if (op === "-") stk.push(a - b);
  else if (op === "*") stk.push(a * b);
  else stk.push(b !== 0 ? a / b : 0);
}

export function evalExprTokens(
  tokens: ExprToken[],
  resolve: (id: string, offset: 0 | -1 | 1) => number
): number {
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const out: number[] = [], ops: string[] = [];
  for (const tok of tokens) {
    if (tok.t === "ref") { out.push(resolve(tok.id, tok.offset)); }
    else if (tok.t === "num") { out.push(tok.v); }
    else {
      const v = tok.v;
      if (v === "(") { ops.push(v); }
      else if (v === ")") {
        while (ops.length && ops[ops.length - 1] !== "(") _applyOp(ops.pop()!, out);
        ops.pop();
      } else {
        while (ops.length && ops[ops.length - 1] !== "(" && (prec[ops[ops.length - 1]] ?? 0) >= (prec[v] ?? 0))
          _applyOp(ops.pop()!, out);
        ops.push(v);
      }
    }
  }
  while (ops.length) _applyOp(ops.pop()!, out);
  return out[0] ?? 0;
}

export function evalLinha(
  linha: LinhaEval,
  todas: LinhaEval[],
  ano: number,
  mi: number,
  allLinhas?: Map<string, LinhaEval>,
  _depth = 0
): number {
  if (_depth > 30) return 0;

  if (linha.tipo === "subtotal") {
    return (linha.subtotalLinhaIds ?? []).reduce((s, id) => {
      const ref = allLinhas?.get(id) ?? todas.find(l => l.id === id);
      if (!ref) return s;
      return s + evalLinha(ref, todas, ano, mi, allLinhas, _depth + 1);
    }, 0);
  }

  if (linha.tipo === "digitado") {
    if (linha.composicao && linha.composicao.length > 0)
      return linha.composicao.reduce((s, item) => s + (item.valores[pk(ano, mi)] ?? 0), 0);
    return linha.valores[pk(ano, mi)] ?? 0;
  }

  // calculado — try formulaExpr first, fall back to legacy formula
  if (linha.formulaExpr && linha.formulaExpr.length > 0) {
    if (linha.formulaExpr.length === 3) {
      const [t0, t1, t2] = linha.formulaExpr;
      if (t0.t === "ref" && t1.t === "op" && t1.v === "*" && t2.t === "ref") {
        const tl = mi + t0.offset, tr = mi + t2.offset;
        if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
          const lL = todas.find(x => x.id === (t0 as { t: "ref"; id: string; offset: 0 | -1 | 1 }).id) ?? allLinhas?.get((t0 as { t: "ref"; id: string; offset: 0 | -1 | 1 }).id);
          const rL = todas.find(x => x.id === (t2 as { t: "ref"; id: string; offset: 0 | -1 | 1 }).id) ?? allLinhas?.get((t2 as { t: "ref"; id: string; offset: 0 | -1 | 1 }).id);
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
      const t = mi + offset; if (t < 0 || t > 11) return 0;
      const l = todas.find(x => x.id === id) ?? allLinhas?.get(id); if (!l) return 0;
      const v = evalLinha(l, todas, ano, t, allLinhas, _depth + 1);
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
          const ri = rL.composicao![idx]; if (!ri) return sum;
          const lv = (li.valores[pk(ano, tl)] ?? 0) / (lL.isPercentual ? 100 : 1);
          const rv = (ri.valores[pk(ano, tr)] ?? 0) / (rL.isPercentual ? 100 : 1);
          return sum + lv * rv;
        }, 0);
      }
      const lv = lL ? evalLinha(lL, todas, ano, tl, allLinhas, _depth + 1) : (left.valorFixo ?? 0);
      const rv = rL ? evalLinha(rL, todas, ano, tr, allLinhas, _depth + 1) : (right.valorFixo ?? 0);
      const lvAdj = lL?.isPercentual ? lv / 100 : lv;
      const rvAdj = rL?.isPercentual ? rv / 100 : rv;
      return lvAdj * rvAdj;
    }
  }
  const resolve = (operando: FormulaOperando) => {
    if (operando.valorFixo !== undefined) return operando.valorFixo;
    const t = mi + operando.offset; if (t < 0 || t > 11) return 0;
    const l = todas.find(x => x.id === operando.linhaId) ?? allLinhas?.get(operando.linhaId);
    if (!l) return 0;
    const v = evalLinha(l, todas, ano, t, allLinhas, _depth + 1);
    return l.isPercentual ? v / 100 : v;
  };
  const lv = resolve(left), rv = resolve(right);
  if (op === "+") return lv + rv;
  if (op === "-") return lv - rv;
  if (op === "/") return rv !== 0 ? lv / rv : 0;
  return lv * rv;
}
