/**
 * el-nino-api.ts — Cliente para o módulo El Niño Analytics.
 *
 * Chama as rotas Next.js /api/el-nino-analytics/* (cache local + proxy NestJS).
 */
import axios, { AxiosHeaders } from 'axios';

/** Instância local — aponta para as rotas Next.js */
const localApi = axios.create({
  baseURL: '/api/el-nino-analytics',
  timeout: 120_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  },
});

function lerTokenJwt(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('techdengue_token');
  if (!token || token === 'undefined' || token === 'null') return null;
  return token;
}

// Injeta token JWT (localStorage → Authorization header)
localApi.interceptors.request.use((config) => {
  const token = lerTokenJwt();
  if (token) {
    if (!config.headers) {
      config.headers = new AxiosHeaders();
    }
    if (config.headers instanceof AxiosHeaders) {
      config.headers.set('Authorization', `Bearer ${token}`);
    } else {
      (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Sem JWT / sessão inválida → login (o proxy responde 401 "Token não fornecido")
localApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      typeof window !== 'undefined' &&
      error?.response?.status === 401
    ) {
      const path = window.location.pathname || '';
      if (!path.startsWith('/auth/login') && !path.startsWith('/auth/first-access')) {
        window.location.href = '/auth/login';
      }
    }
    return Promise.reject(error);
  },
);

// ─── Interfaces de query params ───────────────────────────────────────────────

export interface ElNinoQueryParams {
  /** ID do contrato/consórcio (default: 19) */
  contratoId?: number;
  /** Geocode IBGE de um município específico (7 dígitos) */
  geocode?: number;
  /** Lista de geocodes IBGE para múltiplos municípios */
  geocodes?: number[];
  /** Agregação: 'soma' ou 'ponderada' (default: ponderada por população) */
  agregacao?: 'soma' | 'ponderada';
  /** Ano início do filtro temporal */
  ano_inicio?: number;
  /** Ano fim do filtro temporal */
  ano_fim?: number;
  /** Ano para o gráfico de clima histórico ou 'previsao' */
  ano?: number | 'previsao';
  /** Forçar refresh do cache (apenas admin) */
  refresh?: '1';
  /** Visão gerencial agregada de todos os contratos */
  visao?: 'todos';
}

// ─── Interfaces de resposta ──────────────────────────────────────────────────

export interface ElNinoEscopo {
  tipo: 'municipio' | 'consorcio' | 'urs' | 'macrorregiao' | 'microrregiao' | 'estado' | 'global';
  rotulo: string;
  descricao: string;
  municipios: Array<{
    geocode: number;
    municipioId: number;
    nome: string;
    populacao: number;
  }>;
  geocodes: number[];
  populacaoTotal: number;
  podeTrocar: boolean;
  podeAgregar: boolean;
  agregacaoDefault: 'soma' | 'ponderada';
  isGlobal: boolean;
}

export interface ElNinoKpi {
  titulo: string;
  valor: string;
  subtitulo: string;
}

export interface ElNinoKpisResponse {
  kpis: ElNinoKpi[];
}

export interface OniMensal {
  ano: number;
  mes: number;
  oni: number;
}

export interface SerieMensal {
  Ano: number;
  MesNum: number;
  Mes: string;
  AnoMes: string;
  Temperatura: number;
  Precipitacao: number;
  Umidade: number;
  ONI: number | null;
  TipoElNino: string;
  ElNino: number;
  CasosDengue: number;
}

export interface ComparativoMensal {
  MesNum: number;
  Mes: string;
  ElNino: number;
  Periodo: 'Com El Nino' | 'Sem El Nino';
  CasosDengue: number;
  Temperatura: number;
}

export interface CorrelacaoClima {
  variavel_clima: string;
  correlacao: number;
  interpretacao: string;
  /** Nº de meses com dado real usados no cálculo do r (quando disponível). */
  n?: number;
}

export interface CorrelacaoElNino {
  variavel: string;
  correlacao: number;
  interpretacao: string;
}

export interface CorrelacoesResponse {
  clima: CorrelacaoClima[];
  elnino: CorrelacaoElNino[];
}

export interface HistoricoAnual {
  Ano: number;
  TipoElNino: string;
  ONIMedio: number | null;
  TemperaturaMedia: number;
  PrecipitacaoAnual: number;
  CasosDengueTotal: number;
}

export interface ResumoElNino {
  casos_media_mensal_sem: number;
  casos_media_mensal_com: number;
  temp_media_sem: number;
  temp_media_com: number;
  chuva_media_sem: number;
  chuva_media_com: number;
  anos_sem: string;
  anos_com: string;
  variacao_casos_pct: number;
}

export interface CorrelacaoLagItem {
  variavel: string;
  lag: number;
  r: number | null;
  n: number;
}

export interface CorrelacaoLagResponse {
  items: CorrelacaoLagItem[];
  max_lag: number;
  periodo?: { ano_inicio: number; ano_fim: number };
}

export interface AlertaPreditivo {
  categoria: 'chuva' | 'previsao_clima' | 'onda_calor' | 'umidade' | 'dengue' | 'elnino' | 'inmet';
  prioridade: number;
  nivel: 'alto' | 'medio' | 'baixo';
  titulo: string;
  descricao: string;
  causa?: string;
  acao?: string;
  geocode?: number | null;
  fonte?: string;
}

export interface ClimaForecast {
  fonte: string;
  cidade: string;
  geocode?: number;
  lat: number;
  lon: number;
  atualizado_em: string;
  modo: 'previsao' | 'historico';
  atual: {
    temperatura_c: number;
    umidade_pct: number;
    precipitacao_mm: number;
    condicao: string;
  };
  dias: Array<{
    data: string;
    periodo: string;
    cidade: string;
    max_c: number;
    min_c: number;
    chuva_mm: number;
    umidade_pct: number;
    temp_media?: number | null;
    casos?: number | null;
  }>;
}

export interface ProjecaoMes {
  mesNum: number;
  label: string;
  valor: number;
  sup: number;
  inf: number;
  fSazonal: number;
  fElnino: number;
  oni: number | null;
  oniProjetado: boolean;
}

export interface ProjecaoMunicipio {
  geocode: number;
  nome: string;
  lat: number;
  lon: number;
  populacao: number;
  /** Alias legado no JSON estático (mapa_projecao_*.json) */
  pop?: number;
  base: number;
  baseFonte: string;
  nivel_alerta: number;
  incidencia: number;
  projecoes: ProjecaoMes[];
  clima: {
    temperatura_c: number;
    umidade_pct: number;
    precipitacao_mm: number;
    fonte: string;
    periodo?: string;
  } | null;
  hectares?: {
    municipio_id: number;
    municipio_nome: string;
    contrato_id: number;
    contrato_nome: string;
    hectares_mapeados: number;
    fonte: string;
  } | null;
  poi_hectare?: {
    municipio_id: number;
    municipio_nome: string;
    contrato_id: number;
    contrato_nome: string;
    total_registros: number;
    hectares_mapeados: number;
    poi_por_hectare: number;
    fonte: string;
  } | null;
  pois?: {
    municipio_id: number;
    municipio_nome: string;
    contrato_id: number;
    contrato_nome: string;
    hectares_mapeados: number;
    fonte: string;
  } | null;
}

export interface IbgeAreaUrbanaRuralResponse {
  geocode: number;
  areaTotalKm2: number | null;
  areaUrbanaKm2: number | null;
  areaRuralKm2: number | null;
  areaTotalHa: number | null;
  areaUrbanaHa: number | null;
  areaRuralHa: number | null;
  fonte: string;
  periodo: string;
  aviso?: string;
}

export interface MapaProjecaoResponse {
  ano_projecao: number;
  rotulo_conjunto: string;
  meses: Array<{
    mesNum: number;
    label: string;
    fElnino: number;
    oni: number | null;
    oniProjetado: boolean;
    descricao: string;
  }>;
  municipios: ProjecaoMunicipio[];
  /** Malha IBGE alinhada aos municípios do payload (unificado com mapa-projecao). */
  geojson?: GeoJSON.FeatureCollection | null;
  malha_fonte?: string | null;
  elnino: {
    ativo: boolean;
    oni_atual: number | null;
    intensidade: string;
    fator_atual: number;
    periodo_atual: string;
    fonte: string;
  };
  formula: {
    expressao: string;
    teto_pct: number;
    f_sazonal: string;
    f_elnino: string;
  };
  fontes: string[];
  avisos: string[];
  atualizado_em: string;
  /** Preenchido pela API para o painel do mapa resolver o contrato correto. */
  _contrato_id?: number;
  poi_hectare_contrato?: {
    contrato_id: number;
    contrato_nome: string;
    total_registros: number;
    hectares_mapeados: number;
    poi_por_hectare: number;
    fonte: string;
  } | null;
}

export interface ElNinoBairroCasosItem {
  nome: string;
  pois: number;
  casos_notificados: number;
  casos_estimados: number;
  percentual_pois: number;
  percentual_casos_notificados: number;
  tipos_criadouros?: Record<string, number>;
}

export interface ElNinoCasosPorBairroResponse {
  geocode: number;
  idMunicipio: number;
  nomeMunicipio: string;
  casos_notificados_municipio: number;
  casos_estimados_municipio: number;
  total_pois_municipio: number;
  metodo: string;
  fontes: string[];
  avisos: string[];
  bairros: ElNinoBairroCasosItem[];
  atualizado_em: string;
}

export interface ElNinoCasosPorBairroParams {
  geocode: number;
  idMunicipio?: number;
  idContrato?: number;
  limit?: number;
  refresh?: boolean;
}

export interface ElNinoGeojsonBairroFeature {
  type: 'Feature';
  properties: {
    nome: string;
    pois: number;
    hectares_unicos: number;
    metodo_atribuicao: string;
    fonte_geom: string;
    criterio_atribuicao: string;
  };
  geometry: GeoJSON.Geometry;
}

export interface ElNinoGeojsonBairrosResponse {
  type: 'FeatureCollection';
  geocode: number;
  idMunicipio: number;
  nomeMunicipio: string;
  /** Origem da geometria: polígonos reais das áreas mapeadas ou envoltória dos POIs. */
  modo?: 'areas_mapeadas' | 'envoltoria_pois';
  total_pois: number;
  fontes: string[];
  avisos: string[];
  features: ElNinoGeojsonBairroFeature[];
  atualizado_em: string;
}

export interface ElNinoGeojsonBairrosParams {
  geocode: number;
  idMunicipio?: number;
  idContrato?: number;
}

export interface SerieConsorcioResponse {
  rotulo_conjunto: string;
  n_municipios: number;
  anos_janela: number;
  ano_fim: number;
  mes_fim: number;
  /** Mês/ano do calendário no momento da montagem (projeção até dez do ano corrente). */
  ano_calendario_atual?: number;
  mes_calendario_atual?: number;
  labels: string[];
  casos: (number | null)[];
  precip?: (number | null)[];
  precip_proj?: (number | null)[];
  temp: (number | null)[];
  temp_proj: (number | null)[];
  oni: (number | null)[];
  oni_projetado?: boolean[];
  proj: (number | null)[];
  sup: (number | null)[];
  inf: (number | null)[];
  projetado: boolean[];
  elnino_moderado?: boolean[];
  elnino_forte?: boolean[];
  idx_ultimo_real: number;
  idx_inicio_proj: number;
  media_historica: number;
  label_se_hoje?: string | null;
  elnino: {
    ativo: boolean;
    oni_atual: number | null;
    intensidade: string;
    fator_atual: number;
  };
  semana_epi: string;
  atualizado_em: string;
}

export interface InmetAlerta {
  id: string;
  evento: string;
  severidade: string;
  nivel: 'alto' | 'medio' | 'baixo';
  corRisco: string;
  inicio: string;
  fim: string;
  descricao: string;
  instrucao: string;
  areaDesc: string;
  municipios: number[];
  estados: string[];
  fonte: string;
}

// ─── API Client ───────────────────────────────────────────────────────────────

// ─── API Client ───────────────────────────────────────────────────────────────

function buildParams(params?: ElNinoQueryParams): Record<string, unknown> {
  if (!params) return {};
  const out: Record<string, unknown> = {};
  if (params.contratoId != null) out.contratoId = params.contratoId;
  if (params.geocode != null)    out.geocode    = params.geocode;
  if (params.geocodes?.length)   out.geocodes   = params.geocodes.join(',');
  if (params.agregacao)          out.agregacao  = params.agregacao;
  if (params.ano_inicio != null) out.ano_inicio = params.ano_inicio;
  if (params.ano_fim    != null) out.ano_fim    = params.ano_fim;
  if (params.ano        != null) out.ano        = params.ano;
  if (params.refresh)            out.refresh    = params.refresh;
  if (params.visao)              out.visao      = params.visao;
  return out;
}

export const elNinoApi = {
  getEscopo: async (params?: ElNinoQueryParams): Promise<ElNinoEscopo> => {
    const res = await localApi.get('/escopo', { params: buildParams(params) });
    return res.data;
  },

  getOverview: async (params?: ElNinoQueryParams) => {
    const res = await localApi.get('/overview', { params: buildParams(params) });
    return res.data;
  },

  getKpis: async (params?: ElNinoQueryParams): Promise<ElNinoKpisResponse> => {
    const res = await localApi.get('/kpis', { params: buildParams(params) });
    return res.data;
  },

  getSerie: async (params?: ElNinoQueryParams) => {
    const res = await localApi.get('/serie', { params: buildParams(params) });
    return res.data;
  },

  getSerieConsorcio: async (params?: ElNinoQueryParams): Promise<SerieConsorcioResponse> => {
    const res = await localApi.get('/serie-consorcio', { params: buildParams(params) });
    return res.data;
  },

  getCorrelacoes: async (params?: ElNinoQueryParams): Promise<CorrelacoesResponse> => {
    const res = await localApi.get('/correlacoes', { params: buildParams(params) });
    const data = res.data;
    // Compat: proxy antigo devolvia array; NestJS e proxy novo devolvem { clima, elnino }.
    if (Array.isArray(data)) {
      return { clima: data, elnino: [] };
    }
    return {
      clima: data?.clima ?? [],
      elnino: data?.elnino ?? [],
    };
  },

  getCorrelacaoLag: async (params?: ElNinoQueryParams): Promise<CorrelacaoLagResponse> => {
    const res = await localApi.get('/correlacao-lag', { params: buildParams(params) });
    return res.data;
  },

  getComparativo: async (params?: ElNinoQueryParams) => {
    const res = await localApi.get('/comparativo', { params: buildParams(params) });
    return res.data;
  },

  getAlertas: async (params?: ElNinoQueryParams): Promise<{ geocode: string; alertas: AlertaPreditivo[] }> => {
    const res = await localApi.get('/alertas', { params: buildParams(params) });
    return res.data;
  },

  /** Resolve ID interno do município no banco local a partir do geocode IBGE. */
  getMunicipioId: async (params: {
    geocode: number;
    contratoId?: number;
  }): Promise<{ geocode: number; municipioId: number; nome: string } | null> => {
    try {
      const res = await localApi.get('/municipio-id', {
        params: {
          geocode: params.geocode,
          ...(params.contratoId != null ? { contratoId: params.contratoId } : {}),
        },
      });
      const data = res.data as { municipioId?: number };
      if (data?.municipioId != null && data.municipioId > 0) {
        return res.data;
      }
      return null;
    } catch {
      return null;
    }
  },

  getClima: async (params?: ElNinoQueryParams): Promise<ClimaForecast> => {
    const res = await localApi.get('/clima', {
      params: { ...buildParams(params), ano: params?.ano ?? 'previsao' },
    });
    return res.data;
  },

  /** Clima histórico mensal (JSON local no backend — sem Open-Meteo/ERA5 ao vivo). */
  getClimaHistorico: async (params?: ElNinoQueryParams) => {
    const res = await localApi.get('/clima-historico', { params: buildParams(params) });
    return res.data as {
      geocodes: number[];
      periodo: { ano_inicio: number; ano_fim: number };
      fonte: string;
      atualizado_em: string | null;
      linhas: Array<{
        geocode: number;
        municipio: string;
        Ano: number;
        MesNum: number;
        Mes: string;
        Temperatura: number;
        Precipitacao: number;
        Umidade: number;
      }>;
      total: number;
    };
  },

  getMunicipios: async (params?: ElNinoQueryParams) => {
    const res = await localApi.get('/municipios', { params: buildParams(params) });
    return res.data;
  },

  getMapaProjecao: async (params?: ElNinoQueryParams): Promise<MapaProjecaoResponse> => {
    const res = await localApi.get('/mapa-projecao', { params: buildParams(params) });
    const data = res.data as MapaProjecaoResponse;
    if (data?.geojson?.features?.length) return data;

    // Fallback: Nest antigo / produção sem geojson embutido → /malha-mg.
    try {
      const malhaRes = await localApi.get('/malha-mg', { params: buildParams(params) });
      const malha = malhaRes.data as GeoJSON.FeatureCollection | null;
      if (malha?.features?.length) {
        const porNome = new Map(
          (data?.municipios ?? []).map((m) => [Number(m.geocode), m.nome]),
        );
        const features = malha.features.map((f) => {
          const p = (f.properties ?? {}) as Record<string, unknown>;
          const gc = Number(p.codarea ?? p.geocode ?? p.id ?? f.id ?? 0);
          return {
            ...f,
            properties: {
              ...p,
              geocode: gc,
              codarea: String(gc).padStart(7, '0'),
              name: porNome.get(gc) ?? p.name ?? p.nome ?? `Município ${gc}`,
            },
          };
        });
        return {
          ...data,
          geojson: { type: 'FeatureCollection', features },
          malha_fonte: data.malha_fonte ?? 'IBGE /malha-mg (fallback cliente)',
        };
      }
    } catch {
      /* mantém payload sem malha */
    }
    return data;
  },

  getMalhaMg: async (params?: ElNinoQueryParams) => {
    const res = await localApi.get('/malha-mg', { params: buildParams(params) });
    return res.data;
  },

  getConsorcios: async () => {
    const res = await localApi.get('/consorcios');
    return res.data;
  },

  getUrs: async () => {
    const res = await localApi.get('/urs');
    return res.data;
  },

  getInmetAlertas: async (params?: ElNinoQueryParams): Promise<{ geocodes: number[]; n_alertas: number; alertas: InmetAlerta[] }> => {
    const res = await localApi.get('/inmet-alertas', { params: buildParams(params) });
    return res.data;
  },

  postRefresh: async (params?: ElNinoQueryParams) => {
    const res = await localApi.post('/refresh', {}, { params: buildParams(params) });
    return res.data;
  },

  /** Casos notificados por bairro — proxy Next.js → NestJS */
  getCasosPorBairro: async (
    params: ElNinoCasosPorBairroParams,
  ): Promise<ElNinoCasosPorBairroResponse> => {
    const res = await localApi.get('/casos-por-bairro', {
      params: {
        geocode: params.geocode,
        ...(params.idMunicipio != null ? { idMunicipio: params.idMunicipio } : {}),
        ...(params.idContrato != null ? { idContrato: params.idContrato } : {}),
        ...(params.limit != null ? { limit: params.limit } : {}),
        ...(params.refresh ? { refresh: '1' } : {}),
      },
    });
    return res.data;
  },

  /**
   * GeoJSON de bairros (verba direta) — NestJS direto (consulta PostGIS/GIS).
   * Timeout estendido: dissolve espacial pode levar alguns segundos.
   */
  getGeojsonBairros: async (
    params: ElNinoGeojsonBairrosParams,
  ): Promise<ElNinoGeojsonBairrosResponse> => {
    const res = await localApi.get('/geojson-bairros', {
      params: {
        geocode: params.geocode,
        ...(params.idMunicipio != null ? { idMunicipio: params.idMunicipio } : {}),
        ...(params.idContrato != null ? { idContrato: params.idContrato } : {}),
      },
      timeout: 60_000,
    });
    return res.data;
  },

  getAreaUrbanaRural: async (params: {
    geocode: number;
  }): Promise<IbgeAreaUrbanaRuralResponse> => {
    const res = await localApi.get('/area-urbana-rural', {
      params: { geocode: params.geocode },
      timeout: 60_000,
    });
    return res.data;
  },
};

export default elNinoApi;
