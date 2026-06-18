"use client";

import { loadData } from "./storage";
import { ORCAMENTO_KEYS } from "./orcamentoData";

// ─── Types ────────────────────────────────────────────────────────────────────

type Categoria    = "receita" | "gastos" | "impostos" | "indicador";
type TipoLinha    = "digitado" | "calculado";
type OpFormula    = "*" | "+" | "-" | "/";

interface FormulaOperando { linhaId: string; offset: 0 | -1 | 1; valorFixo?: number }
interface Formula         { op: OpFormula; left: FormulaOperando; right: FormulaOperando }
interface ComposicaoItem  {
  id: string; descricao: string; valores: Record<string, number>;
  demoItemIdGerencial?: string; demoItemIdContabil?: string; centroId?: string;
}

interface LinhaOrcamento {
  id: string; descricao: string; categoria: Categoria; tipo: TipoLinha;
  isPercentual?: boolean;
  demoItemIdGerencial?: string;
  demoItemIdContabil?: string;
  composicao?: ComposicaoItem[];
  formula?: Formula;
  centroResultadoId?: string;
  valores: Record<string, number>;
}

interface SubBloco { id: string; descricao: string; linhas: LinhaOrcamento[] }
interface Bloco    { id: string; descricao: string; subBlocos: SubBloco[] }

// Cenário-based format saved by orcamento/forecast pages
interface CenarioForecast { id: string; nome: string; cor: string; mesesRealizados?: number[] }
interface LinhaValoresCen { valores: Record<string, number>; composicaoValores?: Record<string, Record<string, number>> }
type ValoresCenarios = Record<string, Record<string, LinhaValoresCen>>;

// ─── Mapeamento orçamento → forecast ─────────────────────────────────────────

const RECEITA_KEYS = new Set<string>([
  "portal_orcamento_gestao_recursos",
  "portal_orcamento_advisory",
  "portal_orcamento_investment_banking",
  "portal_orcamento_research",
]);

const FORECAST_KEY_MAP: Record<string, string> = {
  portal_orcamento_gestao_recursos:                      "portal_forecast_receita_gestao_recursos",
  portal_orcamento_advisory:                             "portal_forecast_receita_advisory",
  portal_orcamento_investment_banking:                   "portal_forecast_receita_investment_banking",
  portal_orcamento_research:                             "portal_forecast_receita_research",
  portal_orcamento_gastos_pacote_pessoal:                "portal_forecast_gastos_pacote_pessoal",
  portal_orcamento_gastos_pacote_certificacao:           "portal_forecast_gastos_pacote_certificacao",
  portal_orcamento_gastos_pacote_incentivos_comerciais:  "portal_forecast_gastos_pacote_incentivos_comerciais",
  portal_orcamento_gastos_pacote_institucional:          "portal_forecast_gastos_pacote_institucional",
  portal_orcamento_gastos_pacote_ocupacao:               "portal_forecast_gastos_pacote_ocupacao",
  portal_orcamento_gastos_pacote_eventos:                "portal_forecast_gastos_pacote_eventos",
  portal_orcamento_gastos_pacote_servicos_especializados:"portal_forecast_gastos_pacote_servicos_especializados",
  portal_orcamento_gastos_pacote_servicos_juridicos:     "portal_forecast_gastos_pacote_servicos_juridicos",
  portal_orcamento_gastos_pacote_tecnologia:             "portal_forecast_gastos_pacote_tecnologia",
  portal_orcamento_gastos_pacote_viagens:                "portal_forecast_gastos_pacote_viagens",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pk(ano: number, m: number): string {
  return `${ano}-${String(m + 1).padStart(2, "0")}`;
}

function buildFcValsFromCenario(
  valoresCenarios: ValoresCenarios,
  cenarioId: string
): Record<string, Record<string, number>> {
  const fcVals: Record<string, Record<string, number>> = {};
  const cenData = valoresCenarios[cenarioId] ?? {};
  for (const [linhaId, linhaData] of Object.entries(cenData)) {
    if (linhaData.valores && Object.keys(linhaData.valores).length > 0) {
      fcVals[linhaId] = linhaData.valores;
    }
    if (linhaData.composicaoValores) {
      for (const [compId, compVals] of Object.entries(linhaData.composicaoValores)) {
        fcVals[compId] = compVals;
      }
    }
  }
  return fcVals;
}

function evalLinhaFcValue(
  linha: LinhaOrcamento,
  todas: LinhaOrcamento[],
  fcVals: Record<string, Record<string, number>>,
  ano: number,
  mi: number
): number {
  const period = pk(ano, mi);

  if (linha.tipo === "digitado") {
    if (linha.composicao && linha.composicao.length > 0) {
      return linha.composicao.reduce((s, c) => {
        return s + (fcVals[c.id]?.[period] ?? c.valores[period] ?? 0);
      }, 0);
    }
    return fcVals[linha.id]?.[period] ?? linha.valores[period] ?? 0;
  }

  if (!linha.formula) return 0;
  const { op, left, right } = linha.formula;
  if (op === "*" && left.valorFixo === undefined && right.valorFixo === undefined) {
    const tl = mi + left.offset, tr = mi + right.offset;
    if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {
      const lL = todas.find(x => x.id === left.linhaId);
      const rL = todas.find(x => x.id === right.linhaId);
      if (lL?.composicao?.length && rL?.composicao?.length) {
        return lL.composicao.reduce((sum, li, idx) => {
          const ri = rL.composicao![idx];
          if (!ri) return sum;
          const pl = pk(ano, tl), pr = pk(ano, tr);
          const lv = (fcVals[li.id]?.[pl] ?? li.valores[pl] ?? 0) / (lL.isPercentual ? 100 : 1);
          const rv = (fcVals[ri.id]?.[pr] ?? ri.valores[pr] ?? 0) / (rL.isPercentual ? 100 : 1);
          return sum + lv * rv;
        }, 0);
      }
    }
  }
  const getV = (o: FormulaOperando) => {
    if (o.valorFixo !== undefined) return o.valorFixo;
    const t = mi + o.offset;
    if (t < 0 || t > 11) return 0;
    const l = todas.find(x => x.id === o.linhaId);
    if (!l) return 0;
    const v = evalLinhaFcValue(l, todas, fcVals, ano, t);
    return l.isPercentual ? v / 100 : v;
  };
  const lv = getV(left), rv = getV(right);
  if (op === "*") return lv * rv;
  if (op === "+") return lv + rv;
  if (op === "-") return lv - rv;
  return rv !== 0 ? lv / rv : 0;
}

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Agrega todos os blocos de forecast por item de DRE e período.
 * Para cada linha, aplica os overrides de fcVals sobre os valores de orçamento.
 * Retorna Map<demoItemId, Map<"YYYY-MM", valor_total>>
 */
export function buildForecastMap(
  dreField: "gerencial" | "contabil",
  ano: number,
  crFilter?: Set<string> | null,
  cenarioNome?: string
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();

  type CRRow = { id: string; CODCENCUS: string };
  const crIdToCod = crFilter
    ? new Map(loadData<CRRow[]>("portal_centro_resultado", []).map(r => [r.id, r.CODCENCUS]))
    : null;

  for (const orcKey of ORCAMENTO_KEYS) {
    const fcKey = FORECAST_KEY_MAP[orcKey];
    const blocos = loadData<Bloco[]>(orcKey, []);

    // Prefer cenário-based format (saved by orcamento/forecast pages)
    let fcVals: Record<string, Record<string, number>>;
    if (fcKey) {
      const cenarios = loadData<CenarioForecast[]>(fcKey + "_cenarios", []);
      if (cenarios.length > 0) {
        const valoresCenarios = loadData<ValoresCenarios>(fcKey + "_valores", {});
        const cenario = cenarioNome
          ? (cenarios.find(c => c.nome === cenarioNome) ?? cenarios[0])
          : cenarios[0];
        fcVals = buildFcValsFromCenario(valoresCenarios, cenario.id);
      } else {
        fcVals = loadData<Record<string, Record<string, number>>>(fcKey, {});
      }
    } else {
      fcVals = {};
    }

    // Pré-verificação: esta chave tem alguma linha digitado que passa o filtro de CR?
    let keyHasCrMatch = !crIdToCod;
    if (crIdToCod) {
      outerKey: for (const bloco of blocos) {
        for (const sub of bloco.subBlocos) {
          for (const l of sub.linhas) {
            if (l.categoria === "indicador" || l.tipo === "calculado") continue;
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

          const temComposicao = linha.tipo === "digitado" && (linha.composicao?.length ?? 0) > 0;
          const linhaPassouCR = crIdToCod && linha.centroResultadoId
            ? (() => { const cod = crIdToCod.get(linha.centroResultadoId!); return !!cod && crFilter!.has(cod); })()
            : false;
          if (crIdToCod) {
            if (linha.tipo === "calculado") {
              if (RECEITA_KEYS.has(orcKey) && !keyHasCrMatch) continue;
            } else {
              if (linha.centroResultadoId) {
                if (!linhaPassouCR) continue;
              } else if (!temComposicao) {
                continue;
              }
            }
          }

          if (temComposicao) {
            const hasPerItem = linha.composicao!.some(c =>
              dreField === "gerencial"
                ? (!!c.demoItemIdGerencial || !!c.demoItemIdContabil)
                : (!!c.demoItemIdContabil  || !!c.demoItemIdGerencial)
            );
            if (hasPerItem) {
              const sign = linha.categoria === "gastos" ? -1 : 1;
              for (const comp of linha.composicao!) {
                if (!linhaPassouCR && crIdToCod) {
                  if (!comp.centroId) continue;
                  const cod = crIdToCod.get(comp.centroId);
                  if (!cod || !crFilter!.has(cod)) continue;
                }
                const itemId = dreField === "gerencial"
                  ? (comp.demoItemIdGerencial || comp.demoItemIdContabil || linha.demoItemIdGerencial || linha.demoItemIdContabil)
                  : (comp.demoItemIdContabil  || comp.demoItemIdGerencial || linha.demoItemIdContabil  || linha.demoItemIdGerencial);
                if (!itemId) continue;
                for (let mi = 0; mi < 12; mi++) {
                  const period = pk(ano, mi);
                  const raw = fcVals[comp.id]?.[period] ?? comp.valores[period] ?? 0;
                  if (!raw) continue;
                  let m = result.get(itemId);
                  if (!m) { m = new Map(); result.set(itemId, m); }
                  m.set(period, (m.get(period) ?? 0) + raw * sign);
                }
              }
              continue;
            }

            {
              const itemId = dreField === "gerencial"
                ? (linha.demoItemIdGerencial || linha.demoItemIdContabil)
                : (linha.demoItemIdContabil  || linha.demoItemIdGerencial);
              if (!itemId) continue;
              const sign = linha.categoria === "gastos" ? -1 : 1;
              const compsFiltrados = !linhaPassouCR && crIdToCod
                ? linha.composicao!.filter(c => {
                    if (!c.centroId) return false;
                    const cod = crIdToCod.get(c.centroId);
                    return !!cod && crFilter!.has(cod);
                  })
                : linha.composicao!;
              for (let mi = 0; mi < 12; mi++) {
                const period = pk(ano, mi);
                const raw = compsFiltrados.reduce((s, c) => s + (fcVals[c.id]?.[period] ?? c.valores[period] ?? 0), 0);
                if (!raw) continue;
                let m = result.get(itemId);
                if (!m) { m = new Map(); result.set(itemId, m); }
                m.set(period, (m.get(period) ?? 0) + raw * sign);
              }
              continue;
            }
          }

          const itemId = dreField === "gerencial"
            ? (linha.demoItemIdGerencial || linha.demoItemIdContabil)
            : (linha.demoItemIdContabil  || linha.demoItemIdGerencial);
          if (!itemId) continue;
          const sign = linha.categoria === "gastos" ? -1 : 1;
          for (let mi = 0; mi < 12; mi++) {
            const raw = evalLinhaFcValue(linha, sub.linhas, fcVals, ano, mi);
            if (raw === 0) continue;
            const period = pk(ano, mi);
            let m = result.get(itemId);
            if (!m) { m = new Map(); result.set(itemId, m); }
            m.set(period, (m.get(period) ?? 0) + raw * sign);
          }
        }
      }
    }
  }

  return result;
}

/** Anos que possuem valores lançados em qualquer página de forecast. */
export function getForecastAnos(): number[] {
  const anos = new Set<number>();

  for (const orcKey of ORCAMENTO_KEYS) {
    const fcKey = FORECAST_KEY_MAP[orcKey];
    const blocos = loadData<Bloco[]>(orcKey, []);

    // Years from forecast overrides (cenário-based or legacy flat format)
    if (fcKey) {
      const cenarios = loadData<CenarioForecast[]>(fcKey + "_cenarios", []);
      if (cenarios.length > 0) {
        const valoresCenarios = loadData<ValoresCenarios>(fcKey + "_valores", {});
        for (const cenarioData of Object.values(valoresCenarios)) {
          for (const linhaData of Object.values(cenarioData)) {
            for (const period of Object.keys(linhaData.valores ?? {})) {
              const y = parseInt(period.split("-")[0]);
              if (!isNaN(y)) anos.add(y);
            }
            for (const compVals of Object.values(linhaData.composicaoValores ?? {})) {
              for (const period of Object.keys(compVals)) {
                const y = parseInt(period.split("-")[0]);
                if (!isNaN(y)) anos.add(y);
              }
            }
          }
        }
      } else {
        const fcVals = loadData<Record<string, Record<string, number>>>(fcKey, {});
        for (const periodos of Object.values(fcVals)) {
          for (const period of Object.keys(periodos)) {
            const y = parseInt(period.split("-")[0]);
            if (!isNaN(y)) anos.add(y);
          }
        }
      }
    }

    // Fall back to orcamento years if no forecast overrides yet
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

/** Retorna os meses realizados do cenário selecionado (usa o primeiro módulo que tiver dados). */
export function getForecastMesesRealizados(cenarioNome?: string): number[] {
  for (const orcKey of ORCAMENTO_KEYS) {
    const fcKey = FORECAST_KEY_MAP[orcKey];
    if (!fcKey) continue;
    const cenarios = loadData<CenarioForecast[]>(fcKey + "_cenarios", []);
    if (cenarios.length === 0) continue;
    const c = cenarioNome
      ? (cenarios.find(c2 => c2.nome === cenarioNome) ?? cenarios[0])
      : cenarios[0];
    if (c.mesesRealizados && c.mesesRealizados.length > 0) return [...c.mesesRealizados];
  }
  return [];
}

/** Retorna todos os cenários únicos (por nome) disponíveis em qualquer módulo de forecast. */
export function getAllForecastCenarios(): { nome: string; cor: string }[] {
  const seen = new Set<string>();
  const result: { nome: string; cor: string }[] = [];
  for (const orcKey of ORCAMENTO_KEYS) {
    const fcKey = FORECAST_KEY_MAP[orcKey];
    if (!fcKey) continue;
    const cenarios = loadData<CenarioForecast[]>(fcKey + "_cenarios", []);
    for (const c of cenarios) {
      if (!seen.has(c.nome)) {
        seen.add(c.nome);
        result.push({ nome: c.nome, cor: c.cor });
      }
    }
  }
  return result;
}
