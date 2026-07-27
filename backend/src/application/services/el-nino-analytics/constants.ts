export interface MunicipioFoco {
  geocode: number;
  municipio: string;
  lat: number;
  lon: number;
}

export const MESES = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
] as const;

/** Início fixo dos filtros e séries (não janela móvel de N anos). */
export const ANO_INICIO_PADRAO = 2020;
/** Ano base da janela (inclui o ano corrente — dados parciais de dengue/clima). */
export const ANO_FIM = new Date().getFullYear();
export const ANO_INICIO = ANO_INICIO_PADRAO;
/** Janela de 5 anos para cálculo de sazonalidade e projeção */
export const ANOS_JANELA_PROJECAO = 5;
export const ANO_INICIO_PROJECAO = ANO_FIM - ANOS_JANELA_PROJECAO + 1;
/** Ano corrente — para projetar os meses restantes */
export const ANO_ATUAL = new Date().getFullYear();
export const MES_ATUAL = new Date().getMonth() + 1;

export const ONI_EL_NINO = 0.5;
export const ONI_LA_NINA = -0.5;

// ─── Intensidades ONI e fatores multiplicadores de projeção ────────────────────
export type OniIntensidadeLabel =
  | 'muito_forte'
  | 'forte'
  | 'moderado'
  | 'neutro'
  | 'la_nina';

export interface OniIntensidade {
  label: OniIntensidadeLabel;
  /** Texto amigável para exibição */
  rotulo: string;
  /** Fator multiplicador da projeção epidemiológica */
  fator: number;
  /** Nível de alerta para o sistema de alertas preditivos */
  nivel: 'alto' | 'medio' | 'baixo';
  /** Prioridade do alerta (0 = máxima, 9 = mínima) */
  prioridade: number;
}

/** Tabela de intensidades ONI com fatores de projeção epidemiológica. */
export const ONI_INTENSIDADES: Record<OniIntensidadeLabel, OniIntensidade> = {
  muito_forte: {
    label: 'muito_forte',
    rotulo: 'El Niño muito forte',
    fator: 1.8,
    nivel: 'alto',
    prioridade: 0,
  },
  forte: {
    label: 'forte',
    rotulo: 'El Niño forte',
    fator: 1.8,
    nivel: 'alto',
    prioridade: 1,
  },
  moderado: {
    label: 'moderado',
    rotulo: 'El Niño moderado',
    fator: 1.3,
    nivel: 'medio',
    prioridade: 2,
  },
  neutro: {
    label: 'neutro',
    rotulo: 'Neutro',
    fator: 1.0,
    nivel: 'baixo',
    prioridade: 8,
  },
  la_nina: {
    label: 'la_nina',
    rotulo: 'La Niña',
    fator: 0.9,
    nivel: 'medio',
    prioridade: 6,
  },
} as const;

/** Classifica o valor ONI retornando a intensidade e o fator multiplicador. */
export function classificarONI(oni: number | null | undefined): OniIntensidade {
  const v = Number(oni ?? 0);
  if (v >= 2.0) return ONI_INTENSIDADES.muito_forte;
  if (v >= 1.5) return ONI_INTENSIDADES.forte;
  if (v >= ONI_EL_NINO) return ONI_INTENSIDADES.moderado;
  if (v <= ONI_LA_NINA) return ONI_INTENSIDADES.la_nina;
  return ONI_INTENSIDADES.neutro;
}

// ─── Intervalos de confiança da projeção epidemiológica ───────────────────────
/** Limite superior da banda de projeção (+35%) */
export const PROJECAO_FATOR_SUP = 1.35;
/** Limite inferior da banda de projeção (-30%) */
export const PROJECAO_FATOR_INF = 0.7;
/** Teto em % da população (evita projeções absurdas) */
export const PROJECAO_TETO_PCT = 0.15;

/** Aliases usados por código legado/remoto */
export const PROJ_BANDA_SUP = PROJECAO_FATOR_SUP;
export const PROJ_BANDA_INF = PROJECAO_FATOR_INF;
export const TETO_INCIDENCIA = PROJECAO_TETO_PCT;

// ─── Projeção ONI futura ──────────────────────────────────────────────────────
/** Fator de amortecimento da extrapolação linear de ONI */
export const ONI_PROJECAO_AMORT = 0.85;
export const ONI_PROJECAO_ATENUACAO = ONI_PROJECAO_AMORT;
/** Cap máximo do ONI projetado */
export const ONI_PROJECAO_CAP = 2.5;

export const MUNICIPIOS_ELNINO: MunicipioFoco[] = [
  { geocode: 3106200, municipio: 'Belo Horizonte', lat: -19.92, lon: -43.94 },
  { geocode: 3118601, municipio: 'Contagem', lat: -19.932, lon: -44.054 },
  { geocode: 3106705, municipio: 'Betim', lat: -19.968, lon: -44.198 },
  { geocode: 3170206, municipio: 'Uberlândia', lat: -18.919, lon: -48.277 },
  { geocode: 3143302, municipio: 'Montes Claros', lat: -16.735, lon: -43.861 },
];

export const GEOCODES_ELNINO = new Set(MUNICIPIOS_ELNINO.map((m) => m.geocode));

export const NOMES_ELNINO: Record<number, string> = Object.fromEntries(
  MUNICIPIOS_ELNINO.map((m) => [m.geocode, m.municipio]),
);

export const ENDPOINTS = {
  OPEN_METEO_FORECAST: 'https://api.open-meteo.com/v1/forecast',
  OPEN_METEO_ARCHIVE: 'https://archive-api.open-meteo.com/v1/archive',
  ALERTCITY: 'https://info.dengue.mat.br/api/alertcity',
  IBGE_MUNICIPIOS_MG:
    'https://servicodados.ibge.gov.br/api/v1/localidades/estados/31/municipios',
  /** Malha de um município (funciona; /municipios/31 retorna 500). */
  IBGE_MALHA_MUNICIPIO:
    'https://servicodados.ibge.gov.br/api/v3/malhas/municipios',
  /** Malha de todos os municípios de MG via estado + intrarregiao. */
  IBGE_MALHA_MG: 'https://servicodados.ibge.gov.br/api/v3/malhas/estados/31',
  NOAA_ONI_TXT: 'https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt',
  NOAA_CDO_BASE: 'https://www.ncei.noaa.gov/cdo-web/api/v2',
  INMET_RSS: 'https://apiprevmet3.inmet.gov.br/avisos/rss',
  INMET_CAP_BASE: 'https://apiprevmet3.inmet.gov.br/avisos/cap',
  INMET_WIS2_BASE: 'https://wis2bra.inmet.gov.br/oapi',
  COPERNICUS_CDS_BASE: 'https://cds.climate.copernicus.eu/api/v2',
  COPERNICUS_ERA5_DATASET: 'reanalysis-era5-single-levels-monthly-means',
  COPERNICUS_SEAS5_DATASET: 'seasonal-monthly-single-levels',
} as const;

/** Severidade INMET CAP → nível de alerta */
export const INMET_NIVEL: Record<string, 'alto' | 'medio' | 'baixo'> = {
  extreme: 'alto',
  severe: 'alto',
  moderate: 'medio',
  minor: 'medio',
  unknown: 'baixo',
};

/** ColorRisk CAP → nível de alerta */
export const INMET_CORRISCO_NIVEL: Record<string, 'alto' | 'medio' | 'baixo'> =
  {
    vermelho: 'alto',
    red: 'alto',
    laranja: 'alto',
    orange: 'alto',
    amarelo: 'medio',
    yellow: 'medio',
  };

export function classificarOniMensal(
  valor: number | null | undefined,
): 'El Nino' | 'Sem El Nino' {
  return Number(valor ?? 0) >= ONI_EL_NINO ? 'El Nino' : 'Sem El Nino';
}

export function tipoElNinoAnual(
  oniMedio: number | null | undefined,
): 'Com El Nino' | 'Sem El Nino' {
  return Number(oniMedio ?? 0) >= ONI_EL_NINO ? 'Com El Nino' : 'Sem El Nino';
}

export const CACHE_KEYS = {
  ONI: 'elnino:oni',
  CLIMA_HISTORICO: 'elnino:clima-historico',
  CLIMA_FORECAST: 'elnino:clima-forecast',
  CASOS_MENSAIS: 'elnino:casos-mensais',
  ALERTAS_INFODENGUE: 'elnino:alertas-infodengue',
  IBGE_MUNICIPIOS: 'elnino:ibge-municipios',
  IBGE_MALHA: 'elnino:ibge-malha',
  IBGE_SIDRA_AREA: 'elnino:ibge-sidra-area',
  OVERVIEW: 'elnino:overview',
  CLIMA_COPERNICUS: 'elnino:clima-copernicus',
  INMET_ALERTAS: 'elnino:inmet-alertas',
  PROJECAO_MAPA: 'elnino:projecao-mapa',
  COPERNICUS_ERA5: 'elnino:copernicus-era5',
  COPERNICUS_SEAS5: 'elnino:copernicus-seas5',
  MAPA_PROJECAO: 'elnino:mapa-projecao',
  SERIE_CONSORCIO: 'elnino:serie-consorcio',
} as const;

export const CACHE_TTL = {
  OVERVIEW_MS: 6 * 60 * 60 * 1000,
  ONI_MS: 24 * 60 * 60 * 1000,
  CLIMA_HISTORICO_MS: 24 * 60 * 60 * 1000,
  CLIMA_FORECAST_MS: 60 * 60 * 1000,
  CASOS_MENSAIS_MS: 12 * 60 * 60 * 1000,
  ALERTAS_INFODENGUE_MS: 60 * 60 * 1000,
  IBGE_MUNICIPIOS_MS: 7 * 24 * 60 * 60 * 1000,
  IBGE_MALHA_MS: 7 * 24 * 60 * 60 * 1000,
  IBGE_SIDRA_AREA_MS: 30 * 24 * 60 * 60 * 1000,
  CLIMA_COPERNICUS_MS: 24 * 60 * 60 * 1000,
  INMET_ALERTAS_MS: 15 * 60 * 1000,
  PROJECAO_MAPA_MS: 7 * 24 * 60 * 60 * 1000,
  COPERNICUS_ERA5_MS: 24 * 60 * 60 * 1000,
  COPERNICUS_SEAS5_MS: 24 * 60 * 60 * 1000,
  MAPA_PROJECAO_MS: 6 * 60 * 60 * 1000,
  SERIE_CONSORCIO_MS: 6 * 60 * 60 * 1000,
} as const;
