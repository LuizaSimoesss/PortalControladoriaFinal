"use client";

import { idbGet } from "./idb";
import { loadData } from "./storage";
import type { LancamentoFinanceiro } from "./mockData";

type RegraMode = "none" | "especifico" | "intervalo" | "multiplo";
interface RegraItem { modo: RegraMode; codEspecifico?: string; codDe?: string; codAte?: string; codMultiplos?: string[] }
interface DemoItemFc { id: string; nivel?: number; tipo: "SUBTOTAL" | "CONTA"; regras?: { centroResultado?: RegraItem; natureza?: RegraItem } }

function hasRule(r: RegraItem | undefined): boolean {
  if (!r || r.modo === "none") return false;
  if (r.modo === "especifico") return !!r.codEspecifico;
  if (r.modo === "multiplo")   return (r.codMultiplos?.length ?? 0) > 0;
  return !!(r.codDe || r.codAte);
}

function matches(cod: string, r: RegraItem): boolean {
  if (r.modo === "none") return true;
  if (r.modo === "especifico") return cod === (r.codEspecifico ?? "");
  if (r.modo === "multiplo")   return r.codMultiplos?.includes(cod) ?? false;
  const n = +cod; const isNum = !isNaN(n);
  if (r.codDe)  { const d = +r.codDe;  if (isNum && !isNaN(d) ? n < d : cod < r.codDe)  return false; }
  if (r.codAte) { const a = +r.codAte; if (isNum && !isNaN(a) ? n > a : cod > r.codAte) return false; }
  return true;
}

const pk = (ano: number, m: number) => `${ano}-${String(m + 1).padStart(2, "0")}`;

/**
 * Builds Map<demoItemId, Map<"YYYY-MM", valor_realizado>> by matching
 * lancamentos against DRE item rules (natureza + centroResultado).
 * dreKey: "portal_dre" (gerencial) or "portal_dre_contabil"
 */
export async function buildRealizadoMap(
  dreKey: string,
  ano: number
): Promise<Map<string, Map<string, number>>> {
  const dre = loadData<DemoItemFc[]>(dreKey, []);
  const allLans = await idbGet<LancamentoFinanceiro[]>("portal_lancamentos_financeiro", []);
  const result = new Map<string, Map<string, number>>();
  const lans = allLans.filter(l => l.tipo === "realizado" && l.periodo.startsWith(String(ano)));

  for (let mi = 0; mi < 12; mi++) {
    const period = pk(ano, mi);
    const pl = lans.filter(l => l.periodo === period);
    if (!pl.length) continue;

    for (const item of dre) {
      if (item.tipo !== "CONTA") continue;
      const hN = hasRule(item.regras?.natureza);
      const hC = hasRule(item.regras?.centroResultado);
      if (!hN && !hC) continue;
      let total = 0;
      for (const l of pl) {
        if ((!hN || matches(l.codnat, item.regras!.natureza!)) &&
            (!hC || matches(l.codcencus, item.regras!.centroResultado!))) {
          total += l.valor;
        }
      }
      if (!total) continue;
      let m = result.get(item.id);
      if (!m) { m = new Map(); result.set(item.id, m); }
      m.set(period, total);
    }
  }

  // Propagate CONTA values up to SUBTOTAL ancestors so that linhas linked
  // to a SUBTOTAL DRE item also get realized values.
  for (let i = 0; i < dre.length; i++) {
    const st = dre[i];
    if (st.tipo !== "SUBTOTAL") continue;
    const stNivel = st.nivel ?? 0;
    const stMap = new Map<string, number>();
    for (let j = i + 1; j < dre.length; j++) {
      const child = dre[j];
      const childNivel = child.nivel ?? 99;
      if (childNivel <= stNivel) break;
      if (child.tipo !== "CONTA") continue;
      const childVals = result.get(child.id);
      if (!childVals) continue;
      for (const [period, val] of childVals) {
        stMap.set(period, (stMap.get(period) ?? 0) + val);
      }
    }
    if (stMap.size > 0) result.set(st.id, stMap);
  }

  return result;
}
