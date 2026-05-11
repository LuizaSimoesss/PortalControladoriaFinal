export type TipoRegistro = "NATIVO" | "GERENCIAL";

export interface NaturezaRow {
  id: string;
  CODNAT: string;
  DESCRNAT: string;
  GRAU: number;
  ANALITICA: boolean;
  ATIVA: boolean;
  TIPO_REGISTRO: TipoRegistro;
  ENTRA_RESULTADO: "DRE" | "DFC" | "AMBOS" | "NÃO ENTRA";
  CLASSIFICACAO: "" | "RECEITA" | "DEDUCOES" | "IMPOSTOS" | "DESPESA" | "CUSTO" | "VARIACAO";
  PACOTES: "" | "Pessoal" | "Certificação" | "Ocupação" | "Tecnologia" | "Institucional" | "Eventos" | "Viagens" | "Jurídico" | "Incentivos" | "Serviços Especializados";
}

export interface CentroResultadoRow {
  id: string;
  CODCENCUS: string;
  DESCRCENCUS: string;
  ATIVO: boolean;
  GRAU: number;
  ANALITICO: boolean;
  TIPO_REGISTRO: TipoRegistro;
  ENTRA_RESULTADO: "DRE" | "DFC" | "AMBOS" | "NÃO ENTRA";
  CLASSIFICACAO: "" | "DESPESA" | "CUSTO";
}

export interface ProjetoRow {
  id: string;
  CODPROJ: string;
  IDENTIFICACAO: string;
  ATIVO: boolean;
  GRAU: number;
  ANALITICO: boolean;
  TIPO_REGISTRO: TipoRegistro;
}

export interface ParceiroRow {
  id: string;
  CODPARC: string;
  NOMEPARC: string;
  TIPO_REGISTRO: TipoRegistro;
}

export interface EmpresaRow {
  id: string;
  CODEMP: string;
  RAZAOSOCIAL: string;
  TIPO_REGISTRO: TipoRegistro;
  ENTRA_RESULTADO: "DRE" | "DFC" | "AMBOS" | "NÃO ENTRA";
  AD_EMPCLASS: string;
}

export interface AdquiridaRow {
  id: string;
  EMPRESA: string;
  DATA: string;
  ESTADO_ORIGEM: string;
  AREA_NEGOCIO: string;
}

export type RegraMode = "none" | "especifico" | "intervalo";

export interface RegraItem {
  modo: RegraMode;
  codEspecifico?: string;
  codDe?: string;
  codAte?: string;
}

export interface FonteIndicador {
  id: string;
  tipo: "DRE" | "DIRETO";
  demoItemId?: string;
  codIndicador?: RegraItem;
  centroResultado?: RegraItem;
}

export interface FormulaItem {
  subtotalId: string;
  sinal: "+" | "-";
}

export type IndicadorTipo = "SUBTOTAL" | "INDICADOR";

export interface IndicadorRow {
  id: string;
  tipo: IndicadorTipo;
  nivel: number;
  nome: string;
  codigo?: string;
  descricao?: string;
  categoria?: "ESTOQUE" | "MENSAL";
  fontes?: FonteIndicador[];
  formula?: FormulaItem[]; // SUBTOTAL: undefined=agrega filhos; array=fórmula personalizada
}

export interface Fechamento {
  id: string;
  label: string;         // "Fechamento Abril/2025"
  mesReferencia: string; // "YYYY-MM" — mês de competência do fechamento
  tipo: "realizado" | "orcado";
  ativo: boolean;        // true = fonte dos relatórios
  criadoEm: string;      // ISO datetime
  totalLinhas: number;
}

export interface LancamentoFinanceiro {
  id: string;
  fechamentoId?: string; // referência ao Fechamento pai
  tipo: "realizado" | "orcado";
  data: string;          // "YYYY-MM-DD"
  periodo: string;       // "YYYY-MM" derivado de data
  codnat: string;
  codcencus: string;
  codemp: string;
  codproj?: string;
  codparc?: string;
  nufin?: string;
  historico?: string;
  valor: number;
}

export type UnidadeIndicador = "valor" | "percentual";

export interface LancamentoIndicador {
  id: string;
  importacaoId?: string;
  tipo: "realizado" | "orcado";
  data: string;          // "YYYY-MM-DD"
  periodo: string;       // "YYYY-MM" derivado de data
  cod_indicador: string;
  unidade: UnidadeIndicador;
  valor: number;
}

export interface ImportacaoIndicador {
  id: string;
  tipo: "realizado" | "orcado";
  periodo: string;     // "YYYY-MM"
  criadoEm: string;   // ISO datetime
  totalLinhas: number;
}

export const naturezaDataInicial: NaturezaRow[] = [];
export const centroResultadoDataInicial: CentroResultadoRow[] = [];
export const projetosDataInicial: ProjetoRow[] = [];
export const parceirosDataInicial: ParceiroRow[] = [];
export const empresasDataInicial: EmpresaRow[] = [];
export const adquiridasDataInicial: AdquiridaRow[] = [];
export const indicadoresDataInicial: IndicadorRow[] = [];
