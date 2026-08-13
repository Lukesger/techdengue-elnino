import React, {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
} from 'react';
import MapboxMap, {
  Source,
  Layer,
  NavigationControl,
  MapRef,
  MapMouseEvent,
} from 'react-map-gl/mapbox';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  MapaProjecaoResponse,
  ProjecaoMunicipio,
  ClimaForecast,
} from '@/services/el-nino-api';
import elNinoApi from '@/services/el-nino-api';
import { ENV } from '@/config/env';
import { extrairClimaPainel } from '@/utils/el-nino/clima-painel';
import type { BairroMapaFeature } from '@/utils/el-nino/projecao-bairros';
import {
  chaveBairro,
  identificarAreaNoPonto,
  pontoEmGeometry,
  type AreaIdentificavel,
} from '@/utils/el-nino/unir-bairros';
import {
  centroideGeometry,
  hoverInfoDeProps,
  montarInsightsMapa,
  type HoverInfoMapa,
} from '@/utils/el-nino/mapa-choropleth-helpers';
import {
  FaTimes,
  FaThermometerHalf,
  FaCloudRain,
  FaTint,
  FaMapMarkedAlt,
  FaBug,
} from 'react-icons/fa';

/** Camada unificada: projeção epidemiológica × contexto El Niño (ONI/fator). */

function normalizarGeometry(
  raw: unknown,
): GeoJSON.Geometry | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as GeoJSON.Geometry;
      if (!parsed?.type) return null;
      if ('coordinates' in parsed && Array.isArray(parsed.coordinates)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }
  const g = raw as GeoJSON.Geometry;
  if (!g?.type) return null;
  if (
    (g.type === 'Polygon' || g.type === 'MultiPolygon' || g.type === 'LineString') &&
  'coordinates' in g &&
    Array.isArray((g as { coordinates?: unknown }).coordinates)
  ) {
    return g;
  }
  return null;
}

interface Props {
  data: MapaProjecaoResponse | null;
  loading?: boolean;
  /** Carregamento das geometrias por bairro — não bloqueia o mapa municipal. */
  bairrosLoading?: boolean;
  mesNumSelecionado: number | null;
  onMesMudou: (mesNum: number) => void;
  onMunicipioFocado: (geocode: number | null) => void;
  geocodeFocado: number | null;
  /** Contrato/consórcio ativo — evita buscar clima no cache errado. */
  contratoId?: number | null;
  /** Municípios de verba direta: divide o mapa por bairro. */
  bairros?: BairroMapaFeature[] | null;
  /** Origem da geometria dos bairros (rótulo). */
  bairrosModo?: 'areas_mapeadas' | 'envoltoria_pois' | 'indisponivel' | null;
  /** Verba direta ativa — exibe aviso quando cai no fallback municipal. */
  ehVerbaDireta?: boolean;
  bairrosFallbackAtivo?: boolean;
  /** Geometrias originais da API — identificação do hover por ponto (point-in-polygon). */
  areasIdentificacao?: AreaIdentificavel[] | null;
  /** Exporta KML das áreas unificadas (verba direta). */
  onBaixarKml?: () => void;
  poligonosUnificadosKml?: number;
  /** Ranking + Cenário ONI só na visão gerencial (visao=todos). */
  visaoGerencial?: boolean;
  /**
   * Hectares reais do export PostGIS (verba direta) — mesma fonte do KPI
   * Densidade de POIs (bruto / unificado). Preferir em vez de poi_hectare da API.
   */
  hectaresAreaMapeada?: {
    totalBruto: number;
    unificadas: number;
    totalPois?: number | null;
  } | null;
}

const MAPBOX_TOKEN = String(ENV.NEXT_PUBLIC_MAPBOX_TOKEN || '').trim();
if (MAPBOX_TOKEN) {
  mapboxgl.accessToken = MAPBOX_TOKEN;
}
const GEOJSON_VAZIO: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

if (typeof window !== 'undefined' && typeof Cache !== 'undefined') {
  const proto = Cache.prototype as Cache & { __tdgElNinoPatch?: boolean };
  if (!proto.__tdgElNinoPatch) {
    proto.__tdgElNinoPatch = true;
    const originalPut = proto.put;
    proto.put = function patchedPut(request, response) {
      return originalPut.call(this, request, response).catch((err: unknown) => {
        const msg = String((err as Error)?.message ?? err ?? '');
        if (/Entry was not found|Failed to execute ['"]put['"]/i.test(msg)) {
          return undefined as unknown as void;
        }
        throw err;
      });
    };
  }
}

const MAP_STYLE_OSM = {
  version: 8 as const,
  name: 'elnino-osm',
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster' as const,
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

/** Raster light-v11 via api.mapbox.com — o estilo vetorial mapbox:// deixa o fundo branco neste app. */
const MAP_STYLE_MAPBOX_RASTER = MAPBOX_TOKEN
  ? {
      version: 8 as const,
      name: 'elnino-mapbox-light-raster',
      sources: {
        'mapbox-light': {
          type: 'raster' as const,
          tiles: [
            `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
          ],
          tileSize: 256,
          attribution: '© Mapbox © OpenStreetMap',
        },
      },
      layers: [
        {
          id: 'elnino-fundo',
          type: 'background' as const,
          paint: { 'background-color': '#e7e5e4' },
        },
        {
          id: 'mapbox-light',
          type: 'raster' as const,
          source: 'mapbox-light',
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    }
  : MAP_STYLE_OSM;

/** Cor neutra para território sem mapeamento TechDengue (igual visão gerencial). */
const COR_NAO_MAPEADO = '#94a3b8';

const CAMADAS_INTERATIVAS = ['elnino-areas-fill', 'elnino-limite-fill'];

type ProjetoLngLat = (lngLat: [number, number]) => { x: number; y: number };

function anelParaSvg(
  ring: GeoJSON.Position[],
  project: ProjetoLngLat,
): string {
  if (!ring.length) return '';
  const pts = ring.map((c) => project([Number(c[0]), Number(c[1])]));
  return (
    `M${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}` +
    pts
      .slice(1)
      .map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join('') +
    'Z'
  );
}

function geometriaParaSvgPath(
  geometry: GeoJSON.Geometry | null | undefined,
  project: ProjetoLngLat,
): string {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring) => anelParaSvg(ring, project)).join(' ');
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .flatMap((poly) => poly.map((ring) => anelParaSvg(ring, project)))
      .join(' ');
  }
  return '';
}

const LEGENDA_CASOS: Array<{ cor: string; rotulo: string }> = [
  { cor: '#991b1b', rotulo: '≥500 projetados' },
  { cor: '#ef4444', rotulo: '200–499' },
  { cor: '#f97316', rotulo: '100–199' },
  { cor: '#fbbf24', rotulo: '50–99' },
  { cor: '#a5f3fc', rotulo: '<50' },
  { cor: COR_NAO_MAPEADO, rotulo: 'Não mapeado (IBGE)' },
];

function classifica(valor: number): {
  label: 'Crítico' | 'Alto' | 'Médio' | 'Moderado' | 'Baixo';
  cor: string;
} {
  if (valor >= 500) return { label: 'Crítico', cor: '#991b1b' };
  if (valor >= 200) return { label: 'Alto', cor: '#ef4444' };
  if (valor >= 100) return { label: 'Médio', cor: '#f97316' };
  if (valor >= 50) return { label: 'Moderado', cor: '#fbbf24' };
  return { label: 'Baixo', cor: '#a5f3fc' };
}

const LIMIAR_ONI_EL_NINO = 0.5;
const TOP_MUN_LEGENDA = 8;

type AbaMapaLegenda = 'ranking' | 'cenario';

/**
 * Casos projetados além (ou aquém) do cenário sem El Niño (fElnino = 1).
 * valor ≈ base × fSazonal × fElnino → delta = valor − valor/fElnino.
 */
function deltaImpactoElnino(valor: number, fElnino: number): number {
  if (!(fElnino > 0) || !Number.isFinite(valor)) return 0;
  return Math.round(valor - valor / fElnino);
}

function fmtOni(oni: number | null | undefined): string {
  if (oni == null || !Number.isFinite(oni)) return '—';
  const s = oni >= 0 ? `+${oni.toFixed(2)}` : oni.toFixed(2);
  return s.replace('.', ',');
}

function fmtFator(f: number | null | undefined): string {
  if (f == null || !Number.isFinite(f)) return '—';
  return `×${f.toFixed(2).replace('.', ',')}`;
}

/** Progresso 0–100 em direção ao limiar El Niño (ONI ≥ +0,5). */
function progressoAteElNino(oni: number | null | undefined): number {
  if (oni == null || !Number.isFinite(oni)) return 0;
  if (oni >= LIMIAR_ONI_EL_NINO) return 100;
  // Escala de −1,0 (longe) até +0,5 (limiar)
  const min = -1;
  const pct = ((oni - min) / (LIMIAR_ONI_EL_NINO - min)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('pt-BR').format(Math.round(n));
}

function fmtHa(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)} ha`;
}

function fmtPoiHa(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} POIs/ha`;
}

function labelCriterioAtribuicao(criterio: string | null | undefined): string {
  if (!criterio) return 'Critério não informado';
  if (
    criterio ===
    'bairro_explicito>pois>atividade_recente>maior_intersecao>desempate_estavel'
  ) {
    return 'bairro explícito > quantidade de POIs > atividade mais recente > maior interseção > desempate estável';
  }
  if (criterio === 'pois>maior_intersecao>desempate_estavel') {
    return 'quantidade de POIs > maior interseção > desempate estável';
  }
  return criterio.replace(/_/g, ' ').replace(/>/g, ' > ');
}

function formatarNomeExibicao(nome: string): string {
  const t = (nome || '').trim();
  if (!t) return 'Bairro';
  return t
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function fmtTemp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
}

function fmtUmid(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.round(v)}% UR`;
}

function fmtChuva(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm`;
}

function populacaoMun(mun: ProjecaoMunicipio): number | null {
  const n = Number(mun.populacao ?? (mun as { pop?: number }).pop);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function dadosPoiHa(mun: ProjecaoMunicipio) {
  const poi = mun.poi_hectare;
  const ha =
    poi?.hectares_mapeados ??
    mun.hectares?.hectares_mapeados ??
    mun.pois?.hectares_mapeados ??
    null;
  const totalPois = poi?.total_registros ?? null;
  const haNum = ha != null && Number.isFinite(Number(ha)) ? Number(ha) : null;
  const poisNum =
    totalPois != null && Number.isFinite(Number(totalPois))
      ? Number(totalPois)
      : null;
  const ratioApi = Number(poi?.poi_por_hectare);
  const poiPorHa =
    Number.isFinite(ratioApi) && ratioApi > 0
      ? ratioApi
      : poisNum != null && haNum != null && haNum > 0
        ? Math.round((poisNum / haNum) * 100) / 100
        : null;
  return {
    totalPois: poisNum,
    hectares: haNum,
    poiPorHa,
    fonte: poi?.fonte ?? mun.hectares?.fonte ?? null,
  };
}

/** Casos notificados por 100 mil hab. — recalcula se o payload vier zerado. */
function incidenciaPor100k(
  casos: number | null | undefined,
  populacao: number | null | undefined,
  incidenciaApi?: number | null,
): number | null {
  const api = Number(incidenciaApi);
  if (Number.isFinite(api) && api > 0) return api;
  const c = Number(casos);
  const p = Number(populacao);
  if (!(c > 0) || !(p > 0)) return null;
  return Math.round((c / p) * 100_000 * 10) / 10;
}

/** Município com área/POIs TechDengue — senão entra na legenda “Não mapeado”. */
function municipioFoiMapeado(mun: ProjecaoMunicipio | undefined): boolean {
  if (!mun) return false;
  if (mun.techdengue === true) return true;
  if (mun.techdengue === false) return false;
  const { totalPois, hectares } = dadosPoiHa(mun);
  if (hectares != null && Number.isFinite(hectares) && hectares > 0) return true;
  if (totalPois != null && Number.isFinite(totalPois) && totalPois > 0) {
    return true;
  }
  return false;
}

/** Stub mínimo para painel de município presente só na malha IBGE (sem projeção). */
function stubMunicipioDaMalha(
  geocode: number,
  nome: string,
  meses: MapaProjecaoResponse['meses'] | undefined,
): ProjecaoMunicipio {
  return {
    geocode,
    nome: nome || `Município ${geocode}`,
    lat: 0,
    lon: 0,
    populacao: 0,
    base: 0,
    baseFonte: 'Sem série Infodengue no escopo',
    nivel_alerta: 0,
    incidencia: 0,
    projecoes: (meses ?? []).map((m) => ({
      mesNum: m.mesNum,
      label: m.label,
      valor: 0,
      sup: 0,
      inf: 0,
      fSazonal: 0,
      fElnino: 0,
      oni: null,
      oniProjetado: false,
    })),
    clima: null,
    techdengue: false,
    poi_hectare: null,
    hectares: null,
  };
}

/** Extrai geocode IBGE (7 dígitos) das propriedades do GeoJSON. */
function geocodeDaFeature(f: GeoJSON.Feature): number {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const candidatos = [
    p.codarea,
    p.geocode,
    p.CD_MUN,
    p.cd_mun,
    p.codigo_ibge,
    p.cod_ibge,
    p.CD_GEOCODM,
    p.CD_GEOCODMU,
    p.id,
    typeof f.id === 'string' || typeof f.id === 'number' ? f.id : null,
  ];
  for (const raw of candidatos) {
    if (raw == null || raw === '') continue;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length === 7 || digits.length === 6) {
      const n = Number(digits);
      if (Number.isFinite(n) && n >= 1100015 && n <= 5300108) return n;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1100015 && n <= 5300108) return n;
  }
  return 0;
}

function nomeDaFeatureMalha(f: GeoJSON.Feature): string {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  return String(p.name ?? p.nome ?? p.NM_MUN ?? p.description ?? '')
    .trim()
    .toLowerCase();
}

/** Bounding box aproximada de Minas Gerais (WGS84). */
const MG_BBOX = {
  minLng: -51.2,
  maxLng: -39.5,
  minLat: -23.5,
  maxLat: -14.0,
} as const;

function pontoDentroDeMg(lng: number, lat: number): boolean {
  return (
    lng >= MG_BBOX.minLng &&
    lng <= MG_BBOX.maxLng &&
    lat >= MG_BBOX.minLat &&
    lat <= MG_BBOX.maxLat
  );
}

function geocodeEhMg(geocode: number): boolean {
  return geocode >= 3100000 && geocode <= 3199999;
}

function bboxDoGeojson(
  collection: GeoJSON.FeatureCollection,
): [[number, number], [number, number]] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const [lng, lat] = coords as [number, number];
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const c of coords) walk(c);
  };

  for (const f of collection.features) {
    if (f.geometry && 'coordinates' in f.geometry) {
      walk(f.geometry.coordinates);
    }
  }

  if (!Number.isFinite(minLng)) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

function featuresNoPonto(
  map: { queryRenderedFeatures: (...args: any[]) => unknown[] },
  point: { x: number; y: number },
): GeoJSON.Feature[] {
  try {
    return map.queryRenderedFeatures(point, {
      layers: CAMADAS_INTERATIVAS,
    }) as GeoJSON.Feature[];
  } catch {
    return [];
  }
}

/**
 * Mapa choropleth Mapbox GL para a página /mapa.
 * Faz join do GeoJSON com as projeções por município no mês selecionado e
 * pinta cada polígono pela faixa epidemiológica. Click no polígono abre o
 * painel lateral com o detalhe completo.
 */
export const ElNinoMapaChoropleth: React.FC<Props> = ({
  data,
  loading,
  bairrosLoading = false,
  mesNumSelecionado,
  onMesMudou,
  onMunicipioFocado,
  geocodeFocado,
  contratoId = null,
  bairros = null,
  bairrosModo = null,
  ehVerbaDireta = false,
  bairrosFallbackAtivo = false,
  areasIdentificacao = null,
  onBaixarKml,
  poligonosUnificadosKml,
  visaoGerencial = false,
  hectaresAreaMapeada = null,
}) => {
  const mapRef = useRef<MapRef | null>(null);
  const mapaContainerRef = useRef<HTMLDivElement | null>(null);
  const [mapaDimensao, setMapaDimensao] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [mapPronto, setMapPronto] = useState(false);
  const [mapStyle, setMapStyle] = useState<object>(
    MAPBOX_TOKEN ? MAP_STYLE_MAPBOX_RASTER : MAP_STYLE_OSM,
  );
  const [abaLegenda, setAbaLegenda] = useState<AbaMapaLegenda>('ranking');
  const [climaAoVivo, setClimaAoVivo] = useState<ClimaForecast | null>(null);
  const [climaLoading, setClimaLoading] = useState(false);
  const [painelExtra, setPainelExtra] = useState<{
    geocode: number;
    populacao: number | null;
    base: number;
    baseFonte: string;
    nivel_alerta: number;
    incidencia: number;
    nome?: string;
    fonte_populacao?: string | null;
    projecoes?: ProjecaoMunicipio['projecoes'];
  } | null>(null);
  const [painelExtraLoading, setPainelExtraLoading] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [bairroFocadoIdx, setBairroFocadoIdx] = useState<number | null>(null);
  const [painelMunAberto, setPainelMunAberto] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<HoverInfoMapa | null>(null);

  const modoBairros = Boolean(bairros && bairros.length);

  const malhaBase = data?.geojson ?? null;

  const geocodesProj = useMemo(() => {
    if (!data?.municipios?.length) return null;
    return new Set(data.municipios.map((m) => Number(m.geocode)));
  }, [data?.municipios]);

  const mesElninoMeta = useMemo(() => {
    if (!data?.meses?.length || mesNumSelecionado == null) return null;
    return data.meses.find((m) => m.mesNum === mesNumSelecionado) ?? null;
  }, [data?.meses, mesNumSelecionado]);

  /** valor projetado + fator El Niño do mês por geocode. */
  const projecoesMap = useMemo(() => {
    if (!data || mesNumSelecionado == null) {
      return new Map<number, { valor: number; fElnino: number; oni: number | null }>();
    }
    const m = new Map<
      number,
      { valor: number; fElnino: number; oni: number | null }
    >();
    const fMes = Number(mesElninoMeta?.fElnino) || 1;
    const oniMes =
      mesElninoMeta?.oni != null && Number.isFinite(mesElninoMeta.oni)
        ? Number(mesElninoMeta.oni)
        : null;
    for (const mun of data.municipios) {
      const gc = Number(mun.geocode);
      const p = mun.projecoes.find((x) => x.mesNum === mesNumSelecionado);
      const fElnino = Number(p?.fElnino) > 0 ? Number(p!.fElnino) : fMes;
      const oni =
        p?.oni != null && Number.isFinite(p.oni) ? Number(p.oni) : oniMes;
      m.set(gc, {
        valor: p?.valor ?? 0,
        fElnino,
        oni,
      });
    }
    return m;
  }, [data, mesNumSelecionado, mesElninoMeta]);

  const rankingUltimoElNino = useMemo(() => {
    if (!data?.municipios?.length || mesNumSelecionado == null) return [];
    return [...data.municipios]
      .map((m) => {
        const gc = Number(m.geocode);
        const hit = projecoesMap.get(gc);
        const projetados = Math.max(0, Math.round(Number(hit?.valor) || 0));
        const base = Math.max(0, Math.round(Number(m.base) || 0));
        return {
          geocode: gc,
          nome: m.nome,
          /** Ranking no mês selecionado = projeção daquele mês. */
          casos: projetados,
          base,
          techdengue: municipioFoiMapeado(m),
        };
      })
      .filter((m) => m.casos > 0 || m.base > 0)
      .sort((a, b) => b.casos - a.casos || b.base - a.base)
      .slice(0, TOP_MUN_LEGENDA);
  }, [data?.municipios, mesNumSelecionado, projecoesMap]);

  const progressoProximoElNino = useMemo(() => {
    const meses = data?.meses ?? [];
    const municipios = data?.municipios ?? [];
    const casosPorMes = new Map<number, number>();
    for (const mun of municipios) {
      for (const p of mun.projecoes ?? []) {
        const mes = Number(p.mesNum);
        const valor = Math.max(0, Math.round(Number(p.valor) || 0));
        if (!Number.isFinite(mes) || mes <= 0) continue;
        casosPorMes.set(mes, (casosPorMes.get(mes) ?? 0) + valor);
      }
    }
    const mesesComCasos = meses.map((m) => ({
      ...m,
      casosProjetados: casosPorMes.get(m.mesNum) ?? 0,
    }));
    const oniAtual = data?.elnino?.oni_atual ?? null;
    const ativo = Boolean(data?.elnino?.ativo);
    const projetados = mesesComCasos.filter((m) => m.oniProjetado);
    const comElNino = mesesComCasos.filter(
      (m) => m.oni != null && Number(m.oni) >= LIMIAR_ONI_EL_NINO,
    );
    const proximoMesElNino = mesesComCasos.find(
      (m) =>
        m.oniProjetado &&
        m.oni != null &&
        Number(m.oni) >= LIMIAR_ONI_EL_NINO,
    );
    const progresso = progressoAteElNino(oniAtual);
    const casosMesSelecionado =
      mesNumSelecionado != null
        ? (casosPorMes.get(mesNumSelecionado) ?? 0)
        : 0;
    return {
      ativo,
      oniAtual,
      intensidade: data?.elnino?.intensidade ?? '—',
      periodoAtual: data?.elnino?.periodo_atual ?? '—',
      progresso,
      projetados,
      comElNino,
      proximoMesElNino,
      meses: mesesComCasos,
      casosMesSelecionado,
      nMunicipios: municipios.length,
    };
  }, [data?.meses, data?.elnino, data?.municipios, mesNumSelecionado]);

  const rotuloPeriodoUltimo = useMemo(() => {
    if (!data?.elnino) return 'Último período El Niño';
    const e = data.elnino;
    if (e.ativo) {
      return `El Niño ativo · ${e.intensidade} · ref. ${e.periodo_atual}`;
    }
    const mesesAtivos = (data.meses ?? []).filter(
      (m) => !m.oniProjetado && m.oni != null && Number(m.oni) >= LIMIAR_ONI_EL_NINO,
    );
    if (mesesAtivos.length) {
      const a = mesesAtivos[0]!;
      const b = mesesAtivos[mesesAtivos.length - 1]!;
      return `Último período no recorte · ${a.label}–${b.label}`;
    }
    return `Referência ONI ${e.periodo_atual} · ${e.intensidade}`;
  }, [data?.elnino, data?.meses]);

  const geojsonEnriquecido = useMemo(() => {
    if (!malhaBase?.features?.length) return null;
    const munPorGc = new Map(
      (data?.municipios ?? []).map((m) => [Number(m.geocode), m] as const),
    );
    // Payload com poucos municípios + malha enorme = filtro territorial
    // (ex.: contratoId=42) que veio com malha gerencial por engano.
    const escopoRestrito =
      munPorGc.size > 0 &&
      munPorGc.size < 200 &&
      malhaBase.features.length >
        Math.max(munPorGc.size * 2, munPorGc.size + 20);
    const malhaCompleta =
      !escopoRestrito &&
      (/completa/i.test(String(data?.malha_fonte ?? '')) ||
        /gerencial/i.test(String(data?.malha_fonte ?? '')) ||
        malhaBase.features.length >= 800 ||
        malhaBase.features.length >
          Math.max(munPorGc.size * 1.5, munPorGc.size + 50));

    const features = malhaBase.features
      .map((f: GeoJSON.Feature) => {
        const geometry = normalizarGeometry(f.geometry) ?? f.geometry;
        const geocode = geocodeDaFeature(f);
        const hit = projecoesMap.get(geocode);
        const valor = hit?.valor ?? 0;
        const fElnino = hit?.fElnino ?? (Number(mesElninoMeta?.fElnino) || 1);
        const oni = hit?.oni ?? mesElninoMeta?.oni ?? null;
        const impacto = deltaImpactoElnino(valor, fElnino);
        const mun = munPorGc.get(geocode);
        const casosReg = Math.max(0, Math.round(Number(mun?.base) || 0));
        const props = (f.properties ?? {}) as Record<string, unknown>;
        const flagProp = props.techdengue ?? props.mapeado;
        const mapeado =
          flagProp != null
            ? Number(flagProp) === 1
            : mun != null
              ? Boolean(
                  (mun as { techdengue?: boolean }).techdengue === true ||
                    municipioFoiMapeado(mun),
                )
              : false;
        const { cor: corProj } = classifica(valor);
        // Igual gerencial: sem mapeamento TechDengue → cinza IBGE,
        // mesmo que haja projeção Infodengue no município.
        const cor = mapeado ? corProj : COR_NAO_MAPEADO;
        const nome =
          String(
            props?.name ?? props?.nome ?? props?.description ?? '',
          ) || mun?.nome;
        return {
          ...f,
          geometry,
          properties: {
            ...f.properties,
            geocode,
            fid: geocode,
            nome,
            valor_proj: valor,
            casos_registrados: casosReg,
            impacto_elnino: impacto,
            f_elnino: fElnino,
            oni: oni,
            mapeado: mapeado ? 1 : 0,
            techdengue: mapeado ? 1 : 0,
            cor,
          },
        };
      })
      .filter((f: GeoJSON.Feature) => {
        // Contrato/município filtrado: só polígonos do escopo.
        if (escopoRestrito && geocodesProj) {
          const gc = Number((f.properties as Record<string, unknown>)?.geocode);
          return geocodesProj.has(gc);
        }
        // Gerencial com malha IBGE completa: mantém também os não mapeados.
        if (malhaCompleta || !geocodesProj) return true;
        const gc = Number((f.properties as Record<string, unknown>)?.geocode);
        const mapeado = Number(
          (f.properties as Record<string, unknown>)?.mapeado,
        );
        if (mapeado === 0) return true;
        return geocodesProj.has(gc);
      });

    if (!features.length) return null;
    return { ...malhaBase, features };
  }, [
    malhaBase,
    projecoesMap,
    geocodesProj,
    data?.municipios,
    data?.malha_fonte,
    mesElninoMeta,
  ]);

  const bairrosGeojson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!modoBairros || !bairros) return null;
    const features = bairros
      .map((b) => ({ b, geometry: normalizarGeometry(b.geometry) }))
      .filter((item): item is { b: BairroMapaFeature; geometry: GeoJSON.Geometry } =>
        item.geometry != null,
      )
      .map(({ b, geometry }, idx) => {
        const proj = b.projecoes.find((p) => p.mesNum === mesNumSelecionado);
        const valor = proj?.valor ?? 0;
        const fElnino = Number(mesElninoMeta?.fElnino) || 1;
        const impacto = deltaImpactoElnino(valor, fElnino);
        const cor = classifica(valor).cor;
        return {
          type: 'Feature' as const,
          properties: {
            fid: idx,
            nome: b.nome,
            pois: b.pois,
            hectares_unicos: b.hectaresUnicos ?? null,
            metodo_atribuicao: b.metodoAtribuicao ?? null,
            fonte_geom: b.fonteGeom ?? null,
            criterio_atribuicao: b.criterioAtribuicao ?? null,
            valor_proj: valor,
            casos_registrados: valor,
            impacto_elnino: impacto,
            f_elnino: fElnino,
            cor,
          },
          geometry,
        };
      });
    if (!features.length) return null;
    return { type: 'FeatureCollection', features };
  }, [modoBairros, bairros, mesNumSelecionado, mesElninoMeta]);

  /** Insignias no centro dos municípios já mapeados (TechDengue). */
  const insigniasMapeados = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!geojsonEnriquecido?.features?.length) return null;
    const munPorGc = new Map(
      (data?.municipios ?? []).map((m) => [Number(m.geocode), m] as const),
    );
    const features: GeoJSON.Feature[] = [];
    for (const f of geojsonEnriquecido.features) {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      if (Number(props.mapeado) !== 1) continue;
      const geocode = Number(props.geocode) || geocodeDaFeature(f);
      if (!geocodeEhMg(geocode)) continue;
      const mun = munPorGc.get(geocode);
      // Centro da geometria IBGE (evita lat/lon fora de MG).
      const coords = centroideGeometry(f.geometry);
      if (!coords) continue;
      const [lng, lat] = coords;
      if (!pontoDentroDeMg(lng, lat)) continue;
      features.push({
        type: 'Feature',
        properties: {
          geocode,
          nome: String(props.nome ?? mun?.nome ?? ''),
          insignia: 'techdengue',
        },
        geometry: { type: 'Point', coordinates: coords },
      });
    }
    if (!features.length) return null;
    return { type: 'FeatureCollection', features };
  }, [geojsonEnriquecido, data?.municipios]);

  /** Insights: elevação El Niño, salto mês a mês; Top 3 só com ≥4 mun; card próprio se 1 mun. */
  const insightsMapa = useMemo(
    () =>
      montarInsightsMapa({
        data,
        mesNumSelecionado,
        projecoesMap,
        hectaresAreaMapeada,
        deltaImpactoElnino,
        dadosPoiHa,
        municipioFoiMapeado,
      }),
    [
      data,
      mesNumSelecionado,
      projecoesMap,
      hectaresAreaMapeada,
    ],
  );

  const modoBairrosEfetivo = Boolean(
    modoBairros && bairrosGeojson && !bairrosLoading,
  );
  const geojsonAtivo = modoBairrosEfetivo
    ? bairrosGeojson
    : geojsonEnriquecido ?? (malhaBase?.features?.length ? malhaBase : null);

  /** Limite IBGE do município focado — base “não mapeado” + contorno das áreas. */
  const malhaLimiteMunicipio = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!malhaBase?.features?.length) return null;
    const gcAlvo =
      geocodeFocado ??
      (data?.municipios?.length === 1
        ? Number(data.municipios[0]!.geocode)
        : null);
    const nomeAlvo = (
      gcAlvo != null
        ? data?.municipios?.find((m) => Number(m.geocode) === gcAlvo)?.nome
        : data?.municipios?.length === 1
          ? data.municipios[0]!.nome
          : null
    )
      ?.trim()
      .toLowerCase();

    let origem =
      gcAlvo != null && Number.isFinite(gcAlvo)
        ? malhaBase.features.filter((f) => geocodeDaFeature(f) === gcAlvo)
        : [];
    if (!origem.length && nomeAlvo) {
      origem = malhaBase.features.filter((f) => {
        const nome = nomeDaFeatureMalha(f);
        return (
          nome === nomeAlvo ||
          (nome.length > 2 &&
            nomeAlvo.length > 2 &&
            (nome.includes(nomeAlvo) || nomeAlvo.includes(nome)))
        );
      });
    }
    if (!origem.length && malhaBase.features.length === 1) {
      origem = malhaBase.features;
    }
    const features = origem
      .map((f) => {
        const geometry = normalizarGeometry(f.geometry) ?? f.geometry;
        return {
          ...f,
          geometry,
          properties: {
            ...f.properties,
            cor: COR_NAO_MAPEADO,
            mapeado: 0,
            nome: 'Área não mapeada',
          },
        };
      })
      .filter((f) => f.geometry != null);
    if (!features.length) return null;
    return { type: 'FeatureCollection', features };
  }, [malhaBase, geocodeFocado, data?.municipios]);

  const aplicarBounds = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const bbox = bboxDoGeojson({
      type: 'FeatureCollection',
      features: [
        ...(malhaLimiteMunicipio?.features ?? []),
        ...(geojsonAtivo?.features ?? []),
      ],
    });
    if (!bbox) return;
    const [[minLng, minLat], [maxLng, maxLat]] = bbox;
    const centroLng = (minLng + maxLng) / 2;
    const centroLat = (minLat + maxLat) / 2;
    if (
      !(
        minLng >= -180 &&
        maxLng <= 180 &&
        minLat >= -90 &&
        maxLat <= 90 &&
        maxLng > minLng &&
        maxLat > minLat &&
        pontoDentroDeMg(centroLng, centroLat)
      )
    ) {
      return;
    }
    map.fitBounds(bbox, {
      padding: 56,
      maxZoom: modoBairrosEfetivo ? 13 : 11,
      duration: 0,
    });
  }, [geojsonAtivo, malhaLimiteMunicipio, modoBairrosEfetivo]);

  useEffect(() => {
    if (mapPronto) aplicarBounds();
  }, [mapPronto, aplicarBounds]);

  useLayoutEffect(() => {
    const el = mapaContainerRef.current;
    if (!el) return undefined;
    const medir = () => {
      const box = el.getBoundingClientRect();
      const w = Math.round(box.width);
      const h = Math.round(box.height) || 540;
      if (w < 32) return;
      setMapaDimensao((prev) =>
        prev && prev.w === w && prev.h === h ? prev : { w, h },
      );
    };
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, geojsonAtivo]);

  const forcarPinturaMapa = useCallback(() => {
    const map = mapRef.current?.getMap() as
      | {
          resize?: () => void;
          triggerRepaint?: () => void;
        }
      | undefined;
    try {
      map?.resize?.();
      map?.triggerRepaint?.();
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event('resize'));
    aplicarBounds();
  }, [aplicarBounds]);

  useEffect(() => {
    if (!mapPronto) return;
    forcarPinturaMapa();
    const timers = [50, 200, 500, 1000].map((ms) =>
      window.setTimeout(forcarPinturaMapa, ms),
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [mapPronto, mapaDimensao, geojsonAtivo, malhaLimiteMunicipio, forcarPinturaMapa]);

  const [cameraTick, setCameraTick] = useState(0);
  useEffect(() => {
    if (!mapPronto) return;
    const map = mapRef.current?.getMap() as
      | { on?: (ev: string, fn: () => void) => void; off?: (ev: string, fn: () => void) => void }
      | undefined;
    if (!map?.on || !map.off) return;
    let frame = 0;
    const marcar = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setCameraTick((n) => n + 1);
      });
    };
    map.on('move', marcar);
    map.on('zoom', marcar);
    map.on('idle', marcar);
    marcar();
    return () => {
      map.off('move', marcar);
      map.off('zoom', marcar);
      map.off('idle', marcar);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [mapPronto]);

  const usarOverlaySvg = !visaoGerencial;

  const overlaySvg = useMemo(() => {
    if (!usarOverlaySvg || !mapPronto || !mapaDimensao) {
      return { limiteFill: '', limiteLinha: '', areas: [] as Array<{ d: string; cor: string; key: string }> };
    }
    const map = mapRef.current?.getMap() as
      | { project?: (ll: { lng: number; lat: number }) => { x: number; y: number } }
      | undefined;
    if (!map?.project) {
      return { limiteFill: '', limiteLinha: '', areas: [] as Array<{ d: string; cor: string; key: string }> };
    }
    // cameraTick está nas deps: pan/zoom recompõe os paths SVG.
    const project: ProjetoLngLat = ([lng, lat]) => {
      const p = map.project!({ lng, lat });
      return { x: p.x, y: p.y };
    };
    const limiteGeom = malhaLimiteMunicipio?.features[0]?.geometry
      ? malhaLimiteMunicipio.features
          .map((f) => geometriaParaSvgPath(f.geometry, project))
          .filter(Boolean)
          .join(' ')
      : '';
    const areas = (geojsonAtivo?.features ?? [])
      .map((f, idx) => {
        const d = geometriaParaSvgPath(f.geometry, project);
        if (!d) return null;
        const cor = String(
          (f.properties as Record<string, unknown> | null)?.cor ?? '#22c55e',
        );
        return { d, cor, key: String(f.id ?? idx) };
      })
      .filter((x): x is { d: string; cor: string; key: string } => x != null);
    return { limiteFill: limiteGeom, limiteLinha: limiteGeom, areas };
  }, [
    usarOverlaySvg,
    mapPronto,
    mapaDimensao,
    cameraTick,
    malhaLimiteMunicipio,
    geojsonAtivo,
  ]);

  const munFocado: ProjecaoMunicipio | null = useMemo(() => {
    if (!data || geocodeFocado == null) return null;
    const doPayload =
      data.municipios.find((m) => Number(m.geocode) === geocodeFocado) ?? null;
    if (doPayload) return doPayload;

    // Município só na malha IBGE (não mapeado / fora do escopo de projeção).
    const feat =
      geojsonAtivo?.features?.find(
        (f) => Number((f.properties as Record<string, unknown>)?.geocode) === geocodeFocado,
      ) ??
      malhaBase?.features?.find((f) => geocodeDaFeature(f) === geocodeFocado) ??
      null;
    if (!feat) return null;
    const props = (feat.properties ?? {}) as Record<string, unknown>;
    const nome = String(props.nome ?? props.name ?? props.description ?? '');
    return stubMunicipioDaMalha(geocodeFocado, nome, data.meses);
  }, [data, geocodeFocado, geojsonAtivo, malhaBase]);

  /** Alinha o painel à cor do mapa: só TechDengue mostra bloco de POI/ha. */
  const munFocadoTechDengue = useMemo(() => {
    if (!munFocado || geocodeFocado == null) return false;
    const feat =
      geojsonAtivo?.features?.find(
        (f) =>
          Number((f.properties as Record<string, unknown>)?.geocode) ===
          geocodeFocado,
      ) ?? null;
    const flag = (feat?.properties as Record<string, unknown> | undefined)
      ?.techdengue ??
      (feat?.properties as Record<string, unknown> | undefined)?.mapeado;
    if (flag != null) return Number(flag) === 1;
    return municipioFoiMapeado(munFocado);
  }, [munFocado, geocodeFocado, geojsonAtivo]);

  const geocodeMunAtivo = useMemo(() => {
    if (geocodeFocado != null) return geocodeFocado;
    if (data?.municipios?.length === 1) {
      return Number(data.municipios[0]!.geocode);
    }
    return null;
  }, [geocodeFocado, data?.municipios]);

  const pontoNoLimiteMunicipio = useCallback(
    (lng: number, lat: number) => {
      if (!malhaLimiteMunicipio?.features.length) return false;
      return malhaLimiteMunicipio.features.some(
        (f) => f.geometry && pontoEmGeometry(lng, lat, f.geometry),
      );
    },
    [malhaLimiteMunicipio],
  );

  useEffect(() => {
    setBairroFocadoIdx(null);
    setPainelMunAberto(false);
  }, [bairros]);

  const bairroFocado = useMemo<BairroMapaFeature | null>(() => {
    if (!modoBairrosEfetivo || bairroFocadoIdx == null || !bairros) return null;
    return bairros[bairroFocadoIdx] ?? null;
  }, [modoBairrosEfetivo, bairroFocadoIdx, bairros]);

  const focadoFid = modoBairrosEfetivo ? bairroFocadoIdx : geocodeFocado;
  const exibirPainelMunicipio =
    Boolean(munFocado) && !bairroFocado && (!modoBairrosEfetivo || painelMunAberto);
  const painelAberto = Boolean(bairroFocado) || exibirPainelMunicipio;

  const contratoClima = useMemo(() => {
    if (contratoId != null && contratoId > 0) return contratoId;
    const d = data as MapaProjecaoResponse & {
      _contrato_id?: number;
      poi_hectare_contrato?: { contrato_id?: number };
    };
    const resolved =
      d?._contrato_id ?? d?.poi_hectare_contrato?.contrato_id ?? null;
    return resolved != null && Number(resolved) > 0 ? Number(resolved) : undefined;
  }, [contratoId, data]);

  useEffect(() => {
    if (geocodeFocado == null) {
      setClimaAoVivo(null);
      return;
    }
    let cancelado = false;
    setClimaLoading(true);
    elNinoApi
      .getClima({
        geocode: geocodeFocado,
        // Não mapeado: sem contrato — proxy resolve Open-Meteo local.
        ...(munFocadoTechDengue && contratoClima
          ? { contratoId: contratoClima }
          : {}),
        ano: 'previsao',
      })
      .then((resp) => {
        if (!cancelado) setClimaAoVivo(resp);
      })
      .catch(() => {
        if (!cancelado) setClimaAoVivo(null);
      })
      .finally(() => {
        if (!cancelado) setClimaLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [geocodeFocado, contratoClima, munFocadoTechDengue]);

  /** Complementa casos/população/projeção — sempre para não mapeados. */
  useEffect(() => {
    if (geocodeFocado == null || !munFocado) {
      setPainelExtra(null);
      return;
    }
    const popOk = (populacaoMun(munFocado) ?? 0) > 0;
    const projOk =
      munFocado.projecoes?.some((p) => Number(p.valor) > 0) ?? false;
    const casosOk =
      Number.isFinite(munFocado.base) &&
      munFocado.base >= 0 &&
      Boolean(munFocado.baseFonte) &&
      !/sem série|stub|indispon|fallback mínimo/i.test(munFocado.baseFonte);
    // Não mapeado: sempre busca (Censo + Infodengue) — payload do mapa costuma
    // omitir pop/projeção desses municípios.
    if (munFocadoTechDengue && popOk && casosOk && projOk) {
      setPainelExtra(null);
      return;
    }

    let cancelado = false;
    setPainelExtraLoading(true);
    elNinoApi
      .getMunicipioPainel({ geocode: geocodeFocado })
      .then((resumo) => {
        if (cancelado) return;
        setPainelExtra({
          geocode: resumo.geocode,
          populacao: resumo.populacao,
          base: resumo.base,
          baseFonte: resumo.baseFonte,
          nivel_alerta: resumo.nivel_alerta,
          incidencia: resumo.incidencia,
          nome: resumo.nome,
          fonte_populacao: resumo.fonte_populacao,
          projecoes: resumo.projecoes,
        });
      })
      .catch(() => {
        if (!cancelado) setPainelExtra(null);
      })
      .finally(() => {
        if (!cancelado) setPainelExtraLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [geocodeFocado, munFocado, munFocadoTechDengue]);

  const munPainel: ProjecaoMunicipio | null = useMemo(() => {
    if (!munFocado) return null;
    if (!painelExtra || painelExtra.geocode !== Number(munFocado.geocode)) {
      return munFocado;
    }
    const popAtual = populacaoMun(munFocado) ?? 0;
    const baseAtual = Number(munFocado.base) || 0;
    const projStubZerada =
      !munFocado.projecoes?.length ||
      munFocado.projecoes.every((p) => !(Number(p.valor) > 0));
    const projExtra = painelExtra.projecoes;
    const oniPorMes = new Map(
      (data?.meses ?? []).map((m) => [m.mesNum, m] as const),
    );
    let projecoes = munFocado.projecoes;
    if (projExtra?.length && (projStubZerada || !munFocadoTechDengue)) {
      if (munFocado.projecoes?.length) {
        const porMes = new Map(projExtra.map((p) => [p.mesNum, p]));
        projecoes = munFocado.projecoes.map((p) => {
          const hit = porMes.get(p.mesNum);
          const mesMeta = oniPorMes.get(p.mesNum);
          if (!hit) {
            return mesMeta
              ? {
                  ...p,
                  fElnino: Number(mesMeta.fElnino) > 0 ? Number(mesMeta.fElnino) : p.fElnino,
                  oni: mesMeta.oni ?? p.oni,
                  oniProjetado: mesMeta.oniProjetado ?? p.oniProjetado,
                }
              : p;
          }
          return {
            ...p,
            valor: hit.valor,
            sup: hit.sup,
            inf: hit.inf,
            fSazonal: hit.fSazonal,
            fElnino:
              Number(mesMeta?.fElnino) > 0
                ? Number(mesMeta!.fElnino)
                : hit.fElnino,
            oni: mesMeta?.oni ?? hit.oni,
            oniProjetado: mesMeta?.oniProjetado ?? hit.oniProjetado,
          };
        });
      } else {
        projecoes = projExtra.map((p) => {
          const mesMeta = oniPorMes.get(p.mesNum);
          return {
            ...p,
            fElnino:
              Number(mesMeta?.fElnino) > 0
                ? Number(mesMeta!.fElnino)
                : p.fElnino,
            oni: mesMeta?.oni ?? p.oni,
            oniProjetado: mesMeta?.oniProjetado ?? p.oniProjetado,
          };
        });
      }
    }
    return {
      ...munFocado,
      nome: munFocado.nome || painelExtra.nome || munFocado.nome,
      populacao:
        popAtual > 0 ? munFocado.populacao : (painelExtra.populacao ?? 0),
      base: baseAtual > 0 ? munFocado.base : painelExtra.base,
      baseFonte:
        baseAtual > 0 ? munFocado.baseFonte : painelExtra.baseFonte,
      nivel_alerta:
        munFocado.nivel_alerta > 0
          ? munFocado.nivel_alerta
          : painelExtra.nivel_alerta,
      incidencia:
        incidenciaPor100k(
          baseAtual > 0 ? munFocado.base : painelExtra.base,
          popAtual > 0 ? munFocado.populacao : painelExtra.populacao,
          munFocado.incidencia > 0
            ? munFocado.incidencia
            : painelExtra.incidencia,
        ) ?? 0,
      projecoes,
    };
  }, [munFocado, painelExtra, data?.meses, munFocadoTechDengue]);

  const climaPainel = useMemo(() => {
    if (geocodeFocado == null) return null;
    return extrairClimaPainel(climaAoVivo, munPainel?.clima ?? null);
  }, [geocodeFocado, munPainel, climaAoVivo]);

  const poiPainel = useMemo(() => {
    if (!munFocado || !munFocadoTechDengue) return null;
    const poi = dadosPoiHa(munFocado);
    const temDado =
      (poi.totalPois != null && poi.totalPois > 0) ||
      (poi.hectares != null && poi.hectares > 0);
    return temDado ? poi : null;
  }, [munFocado, munFocadoTechDengue]);

  const resolverBairroNoEvento = useCallback(
    (lng: number, lat: number) => {
      if (!modoBairros || !bairros?.length) return null;

      const hit =
        areasIdentificacao?.length
          ? identificarAreaNoPonto(areasIdentificacao, lng, lat)
          : null;

      const chave = hit ? chaveBairro(hit.nome) : null;
      const idx =
        chave != null
          ? bairros.findIndex((b) => chaveBairro(b.nome) === chave)
          : -1;
      const bRef = idx >= 0 ? bairros[idx]! : null;
      const nome = hit?.nome ?? bRef?.nome ?? 'Bairro';
      const proj =
        bRef?.projecoes.find((p) => p.mesNum === mesNumSelecionado) ??
        null;

      return {
        idx: idx >= 0 ? idx : null,
        nome: formatarNomeExibicao(nome),
        valor: proj?.valor ?? 0,
        hectaresUnicos: bRef?.hectaresUnicos ?? hit?.hectaresUnicos ?? null,
      };
    },
    [modoBairros, bairros, areasIdentificacao, mesNumSelecionado],
  );

  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      const map = e.target;
      const { lng, lat } = e.lngLat;

      if (modoBairrosEfetivo) {
        const hit = resolverBairroNoEvento(lng, lat);
        if (hit?.idx != null) {
          setBairroFocadoIdx(hit.idx);
          setPainelMunAberto(false);
          return;
        }
        setBairroFocadoIdx(null);
        if (geocodeMunAtivo != null && pontoNoLimiteMunicipio(lng, lat)) {
          onMunicipioFocado(geocodeMunAtivo);
          setPainelMunAberto(true);
          return;
        }
        onMunicipioFocado(null);
        setPainelMunAberto(false);
        return;
      }

      if (usarOverlaySvg) {
        const feat =
          geojsonAtivo?.features.find(
            (f) => f.geometry && pontoEmGeometry(lng, lat, f.geometry),
          ) ?? null;
        const geocode = Number(
          (feat?.properties as Record<string, unknown> | undefined)?.geocode,
        );
        onMunicipioFocado(
          Number.isFinite(geocode) && geocode > 0 ? geocode : null,
        );
        return;
      }

      const feats =
        e.features?.length ? e.features : featuresNoPonto(map, e.point);
      const feat = feats[0];
      if (!feat) {
        onMunicipioFocado(null);
        return;
      }
      const props = feat.properties as Record<string, unknown>;
      const geocode = Number(props?.geocode);
      if (Number.isFinite(geocode) && geocode > 0) onMunicipioFocado(geocode);
    },
    [
      onMunicipioFocado,
      modoBairrosEfetivo,
      resolverBairroNoEvento,
      geocodeMunAtivo,
      pontoNoLimiteMunicipio,
      usarOverlaySvg,
      geojsonAtivo,
    ],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      const map = e.target;

      if (modoBairrosEfetivo) {
        const { lng, lat } = e.lngLat;
        const hit = resolverBairroNoEvento(lng, lat);
        setHovered(hit?.idx ?? null);
        setHoverInfo(null);
        map.getCanvas().style.cursor = hit ? 'pointer' : 'default';
        return;
      }

      if (usarOverlaySvg) {
        const { lng, lat } = e.lngLat;
        const feat =
          geojsonAtivo?.features.find(
            (f) => f.geometry && pontoEmGeometry(lng, lat, f.geometry),
          ) ?? null;
        if (!feat) {
          setHovered(null);
          setHoverInfo(null);
          map.getCanvas().style.cursor = '';
          return;
        }
        const props = (feat.properties ?? {}) as Record<string, unknown>;
        const fid = Number(props.fid ?? props.geocode);
        setHovered(Number.isFinite(fid) ? fid : null);
        setHoverInfo(hoverInfoDeProps(props, e.point.x, e.point.y));
        map.getCanvas().style.cursor = 'pointer';
        return;
      }

      const feats =
        e.features?.length ? e.features : featuresNoPonto(map, e.point);
      const feat = feats[0];
      if (!feat) {
        setHovered(null);
        setHoverInfo(null);
        map.getCanvas().style.cursor = '';
        return;
      }
      const props = feat.properties as Record<string, unknown>;
      const fid = Number(props?.fid);
      setHovered(Number.isFinite(fid) ? fid : null);
      setHoverInfo(hoverInfoDeProps(props, e.point.x, e.point.y));
      map.getCanvas().style.cursor = 'pointer';
    },
    [
      modoBairrosEfetivo,
      resolverBairroNoEvento,
      usarOverlaySvg,
      geojsonAtivo,
    ],
  );

  const initialView = useMemo(() => {
    if (data?.municipios?.length === 1) {
      const mun = data.municipios[0]!;
      const lat = Number(mun.lat);
      const lon = Number(mun.lon);
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        pontoDentroDeMg(lon, lat)
      ) {
        return { longitude: lon, latitude: lat, zoom: 10 };
      }
    }
    return { longitude: -44.5, latitude: -18.5, zoom: 6 };
  }, [data?.municipios]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-96 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!data || !geojsonAtivo) {
    const nMunicipios = data?.municipios?.length ?? 0;
    const temMalhaBruta = Boolean(malhaBase?.features?.length);
    const msgMalha =
      data?.avisos?.find((a) => a.includes('Malha geográfica')) ??
      data?.avisos?.find((a) => a.includes('Malha IBGE'));

    if (ehVerbaDireta && bairrosLoading) {
      return (
        <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
          <div className="h-5 bg-gray-200 rounded w-1/3 mb-4" />
          <div className="h-96 bg-gray-100 rounded" />
          <p className="text-xs text-gray-400 text-center mt-3">
            Carregando polígonos das áreas mapeadas (bairros)…
          </p>
        </div>
      );
    }

    if (ehVerbaDireta && !bairros?.length) {
      return (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-500 space-y-2">
          <p className="font-medium text-gray-700">
            Áreas mapeadas por bairro indisponíveis.
          </p>
          <p className="text-xs text-gray-400">
            Com município em foco o mapa plota polígonos de{' '}
            <code className="text-[11px]">area_mapeadas</code> (GIS), não a malha
            IBGE. Verifique permissão (`area-mapeada:read` / `analytics:elnino:read`)
            e a conexão com o PostGIS.
          </p>
          {!temMalhaBruta && msgMalha ? (
            <p className="text-xs text-gray-400">{msgMalha}</p>
          ) : null}
        </div>
      );
    }

    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-500 space-y-2">
        {!data ? (
          <p>Dados de projeção do mapa não disponíveis.</p>
        ) : !temMalhaBruta ? (
          <>
            <p className="font-medium text-gray-700">
              Malha geográfica dos municípios não disponível.
            </p>
            <p className="text-xs text-gray-400">
              {msgMalha ??
                `Nenhum polígono IBGE encontrado para ${nMunicipios} município(s). Verifique mapa_geojson_*.json ou o pipeline El Niño.`}
            </p>
          </>
        ) : (
          <>
            <p className="font-medium text-gray-700">
              Não foi possível alinhar a malha às projeções.
            </p>
            <p className="text-xs text-gray-400">
              {nMunicipios} município(s) na projeção, mas o join por geocode IBGE
              não encontrou polígonos correspondentes. Confira codarea/geocode nos
              arquivos de cache.
            </p>
          </>
        )}
      </div>
    );
  }

  if (!MAPBOX_TOKEN) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-800">
        <p className="font-semibold mb-1">Mapbox token não configurado</p>
        <p>
          Defina <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> em{' '}
          <code>.env.local</code> para visualizar o mapa choropleth.
        </p>
      </div>
    );
  }

  const nKml = poligonosUnificadosKml ?? bairros?.length ?? 0;
  const rotuloAreas = modoBairrosEfetivo
    ? bairrosModo === 'areas_mapeadas'
      ? 'áreas mapeadas'
      : bairrosModo === 'indisponivel'
        ? 'áreas indisponíveis'
        : 'envoltória POIs'
    : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
      <header className="px-3 sm:px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
          <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 truncate max-w-[14rem]">
            {data.rotulo_conjunto}
          </span>
          {mesElninoMeta?.oni != null && (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-amber-200/80 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 tabular-nums"
              title="Oceanic Niño Index (NOAA)"
            >
              ONI {fmtOni(mesElninoMeta.oni)}
            </span>
          )}
          {mesElninoMeta?.fElnino != null && (
            <span
              className="inline-flex items-center rounded-md border border-orange-200/80 bg-orange-50 px-2 py-1 text-[11px] font-medium text-orange-900 tabular-nums"
              title="Fator multiplicador do El Niño na projeção"
            >
              fator {fmtFator(mesElninoMeta.fElnino)}
            </span>
          )}
          {modoBairrosEfetivo && (
            <span className="inline-flex items-center rounded-md border border-[#0087a8]/20 bg-[#0087a8]/[0.07] px-2 py-1 text-[11px] font-medium text-[#006d8a]">
              {bairros?.length ?? 0} {rotuloAreas}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 ml-auto">
          {onBaixarKml && (
            <button
              type="button"
              onClick={onBaixarKml}
              className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#0087a8] bg-[#0087a8]/[0.06] border border-[#0087a8]/25 hover:bg-[#0087a8]/10 transition-colors"
            >
              KML ({nKml})
            </button>
          )}
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white pl-2 pr-1 py-0.5">
            <label
              htmlFor="mapa-mes-sel"
              className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold"
            >
              Mês
            </label>
            <select
              id="mapa-mes-sel"
              className="text-xs border-0 bg-transparent text-slate-800 font-medium focus:ring-0 outline-none py-1 pr-1 cursor-pointer tabular-nums"
              value={mesNumSelecionado ?? ''}
              onChange={(e) => onMesMudou(Number(e.target.value))}
            >
              {data.meses.map((m) => (
                <option key={m.mesNum} value={m.mesNum}>
                  {m.label}
                  {m.oni != null ? ` · ONI ${fmtOni(m.oni)}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="mx-3 sm:mx-4 mt-2.5 rounded-xl border border-slate-200/90 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5">
        <div className="flex flex-wrap items-stretch gap-2">
          {insightsMapa.maiorElevacao && (
            <button
              type="button"
              onClick={() => {
                onMunicipioFocado(insightsMapa.maiorElevacao!.geocode);
                setPainelMunAberto(true);
              }}
              className="min-w-[9.5rem] flex-1 sm:flex-none inline-flex flex-col justify-center gap-0.5 rounded-lg border border-orange-200/90 bg-orange-50/80 px-2.5 py-2 text-left hover:bg-orange-50 transition-colors"
            >
              <span className="text-[10px] uppercase tracking-[0.04em] font-semibold text-orange-700/80">
                {insightsMapa.unicoMun ? 'Efeito El Niño' : 'Elevação El Niño'}
              </span>
              <span className="text-sm font-bold text-orange-950 tabular-nums leading-tight">
                {insightsMapa.unicoMun
                  ? `+${fmt(insightsMapa.maiorElevacao.delta)} casos`
                  : `${insightsMapa.maiorElevacao.nome}: +${fmt(insightsMapa.maiorElevacao.delta)}`}
              </span>
              <span className="text-[10px] text-orange-800/75 leading-snug">
                {insightsMapa.unicoMun
                  ? 'a mais neste mês por causa do El Niño'
                  : 'vs. cenário sem El Niño'}
              </span>
            </button>
          )}

          {insightsMapa.maiorSalto && (
            <button
              type="button"
              onClick={() => {
                onMunicipioFocado(insightsMapa.maiorSalto!.geocode);
                setPainelMunAberto(true);
              }}
              className="min-w-[9.5rem] flex-1 sm:flex-none inline-flex flex-col justify-center gap-0.5 rounded-lg border border-sky-200/90 bg-sky-50/80 px-2.5 py-2 text-left hover:bg-sky-50 transition-colors"
            >
              <span className="text-[10px] uppercase tracking-[0.04em] font-semibold text-sky-700/80">
                {insightsMapa.unicoMun ? 'Vs. mês anterior' : 'Maior salto'}
              </span>
              <span className="text-sm font-bold text-sky-950 tabular-nums leading-tight">
                {insightsMapa.unicoMun
                  ? `${insightsMapa.maiorSalto.deltaMes > 0 ? '+' : ''}${fmt(insightsMapa.maiorSalto.deltaMes)} casos`
                  : `${insightsMapa.maiorSalto.nome}: ${insightsMapa.maiorSalto.deltaMes > 0 ? '+' : ''}${fmt(insightsMapa.maiorSalto.deltaMes)}`}
              </span>
              <span className="text-[10px] text-sky-800/75 leading-snug">
                {insightsMapa.unicoMun
                  ? insightsMapa.maiorSalto.deltaMes > 0
                    ? 'acima do mês passado'
                    : 'abaixo do mês passado'
                  : 'vs. mês anterior'}
              </span>
            </button>
          )}

          {insightsMapa.unicoMun ? (
            <button
              type="button"
              onClick={() => {
                onMunicipioFocado(insightsMapa.unicoMun!.geocode);
                setPainelMunAberto(true);
              }}
              className="min-w-[11rem] flex-[1.4] sm:flex-none inline-flex flex-col justify-center gap-0.5 rounded-lg border border-[#0087a8]/20 bg-[#0087a8]/[0.06] px-2.5 py-2 text-left hover:bg-[#0087a8]/10 transition-colors"
            >
              <span className="text-[10px] uppercase tracking-[0.04em] font-semibold text-[#006d8a]">
                Neste mês
              </span>
              <span className="text-sm font-bold text-slate-900 tabular-nums leading-tight">
                {insightsMapa.unicoMun.pctElnino != null
                  ? `~${insightsMapa.unicoMun.pctElnino}% do total`
                  : 'El Niño quase neutro'}
              </span>
              <span className="text-[10px] text-slate-600 leading-snug">
                {fmt(insightsMapa.unicoMun.projetado)} casos
                {insightsMapa.unicoMun.deltaElnino > 0
                  ? ` (seriam ${fmt(insightsMapa.unicoMun.baseSemElnino)} sem EN)`
                  : ''}
                {insightsMapa.unicoMun.mapeado &&
                insightsMapa.unicoMun.hectares != null &&
                insightsMapa.unicoMun.hectares > 0
                  ? insightsMapa.unicoMun.hectaresFonte === 'unificado' &&
                    insightsMapa.unicoMun.hectaresBruto != null &&
                    Math.abs(
                      insightsMapa.unicoMun.hectaresBruto -
                        insightsMapa.unicoMun.hectares,
                    ) >= 0.01
                    ? ` · unif. ${fmtHa(insightsMapa.unicoMun.hectares)} · bruto ${fmtHa(insightsMapa.unicoMun.hectaresBruto)}`
                    : ` · ${fmtHa(insightsMapa.unicoMun.hectares)} mapeados`
                  : insightsMapa.unicoMun.mapeado
                    ? ' · mapeado TD'
                    : ' · sem mapeamento TD'}
              </span>
            </button>
          ) : (
            insightsMapa.concentracaoTop3Pct != null && (
              <div className="min-w-[11rem] flex-[1.4] sm:flex-none inline-flex flex-col justify-center gap-0.5 rounded-lg border border-[#0087a8]/20 bg-[#0087a8]/[0.06] px-2.5 py-2">
                <span className="text-[10px] uppercase tracking-[0.04em] font-semibold text-[#006d8a]">
                  Concentração
                </span>
                <span className="text-sm font-bold text-slate-900 tabular-nums leading-tight">
                  Top 3 = {insightsMapa.concentracaoTop3Pct}%
                </span>
                <span className="text-[10px] text-slate-600 leading-snug">
                  dos {fmt(insightsMapa.totalProjetado)} projetados
                  {insightsMapa.nMapeados > 0
                    ? ` · ${insightsMapa.nMapeados} mapeados TD`
                    : ''}
                </span>
              </div>
            )
          )}
        </div>

        {visaoGerencial && (
          <div className="mt-2 pt-2 border-t border-slate-100/90 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-slate-300" aria-hidden />
              Sem mapeamento TD
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-orange-500" aria-hidden />
              Casos projetados
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-sm ring-2 ring-slate-700 ring-offset-1 bg-orange-400"
                aria-hidden
              />
              Mapeado TechDengue
            </span>
          </div>
        )}
      </div>

      {bairrosFallbackAtivo && ehVerbaDireta && (
        <div className="mx-3 sm:mx-4 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Exibindo apenas o limite municipal — as áreas mapeadas por bairro não
          puderam ser carregadas.
        </div>
      )}

      <div
        ref={mapaContainerRef}
        className="relative w-full"
        style={{
          height: 540,
          minHeight: 540,
          transform: 'translateZ(0)',
          isolation: 'isolate',
        }}
      >
        {mapaDimensao ? (
        <MapboxMap
          ref={mapRef}
          initialViewState={initialView}
          style={{ width: mapaDimensao.w, height: mapaDimensao.h }}
          mapStyle={mapStyle}
          mapboxAccessToken={MAPBOX_TOKEN}
          attributionControl
          fadeDuration={0}
          onError={() => {
            if (mapStyle !== MAP_STYLE_OSM) {
              setMapStyle(MAP_STYLE_OSM);
            }
          }}
          onLoad={() => {
            setMapPronto(true);
            forcarPinturaMapa();
            window.requestAnimationFrame(forcarPinturaMapa);
            window.setTimeout(forcarPinturaMapa, 150);
            window.setTimeout(forcarPinturaMapa, 400);
          }}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={(e) => {
            setHovered(null);
            setHoverInfo(null);
            e.target.getCanvas().style.cursor = '';
          }}
          interactiveLayerIds={usarOverlaySvg ? [] : CAMADAS_INTERATIVAS}
        >
          <NavigationControl position="top-right" showCompass={false} />
          {!usarOverlaySvg && (
            <>
          <Source
            id="elnino-limite-src"
            type="geojson"
            data={
              modoBairrosEfetivo
                ? malhaLimiteMunicipio ?? GEOJSON_VAZIO
                : GEOJSON_VAZIO
            }
            generateId
          >
            <Layer
              id="elnino-limite-fill"
              type="fill"
              paint={{
                'fill-color': COR_NAO_MAPEADO,
                'fill-opacity': 0.14,
              }}
            />
          </Source>
          <Source
            id="elnino-areas-src"
            type="geojson"
            data={geojsonAtivo ?? GEOJSON_VAZIO}
            generateId
          >
            <Layer
              id="elnino-areas-fill"
              type="fill"
              paint={{
                'fill-color': ['coalesce', ['get', 'cor'], '#22c55e'],
                'fill-opacity': 0.72,
              }}
            />
            <Layer
              id="elnino-areas-line"
              type="line"
              paint={{
                'line-color': '#166534',
                'line-width': 1.4,
                'line-opacity': 0.85,
              }}
            />
          </Source>
          <Source
            id="elnino-limite-outline-src"
            type="geojson"
            data={malhaLimiteMunicipio ?? GEOJSON_VAZIO}
            generateId
          >
            <Layer
              id="elnino-limite-halo"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': '#ffffff',
                'line-width': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  8,
                  2.4,
                  11,
                  3.2,
                  14,
                  4,
                ],
                'line-opacity': 0.9,
              }}
            />
            <Layer
              id="elnino-limite-line"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': '#0f172a',
                'line-width': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  8,
                  0.9,
                  11,
                  1.25,
                  14,
                  1.6,
                ],
                'line-opacity': 0.95,
              }}
            />
          </Source>
            </>
          )}
          {!modoBairrosEfetivo &&
            insigniasMapeados && (
              <Source
                id="insignias-mapeados"
                type="geojson"
                data={insigniasMapeados}
              >
                {/* Marca d'água: miúda no zoom out, legível só ao aproximar */}
                <Layer
                  id="insignias-mapeados-halo"
                  type="circle"
                  minzoom={5.5}
                  paint={{
                    'circle-radius': [
                      'interpolate',
                      ['exponential', 1.6],
                      ['zoom'],
                      5.5,
                      2,
                      6.5,
                      3.5,
                      7.5,
                      6,
                      8.5,
                      10,
                      10,
                      16,
                      11.5,
                      22,
                    ],
                    'circle-color': '#0087a8',
                    'circle-opacity': [
                      'interpolate',
                      ['linear'],
                      ['zoom'],
                      5.5,
                      0.05,
                      7,
                      0.08,
                      9,
                      0.12,
                      11,
                      0.16,
                    ],
                    'circle-blur': 0.4,
                  }}
                />
                <Layer
                  id="insignias-mapeados-core"
                  type="circle"
                  minzoom={6}
                  paint={{
                    'circle-radius': [
                      'interpolate',
                      ['exponential', 1.6],
                      ['zoom'],
                      6,
                      1.5,
                      7,
                      3,
                      8,
                      5,
                      9,
                      8,
                      10,
                      12,
                      11.5,
                      16,
                    ],
                    'circle-color': '#ffffff',
                    'circle-opacity': [
                      'interpolate',
                      ['linear'],
                      ['zoom'],
                      6,
                      0.12,
                      8,
                      0.2,
                      10,
                      0.28,
                    ],
                    'circle-stroke-width': [
                      'interpolate',
                      ['linear'],
                      ['zoom'],
                      6,
                      0.4,
                      9,
                      0.9,
                      11,
                      1.2,
                    ],
                    'circle-stroke-color': '#0087a8',
                    'circle-stroke-opacity': [
                      'interpolate',
                      ['linear'],
                      ['zoom'],
                      6,
                      0.2,
                      9,
                      0.4,
                      11,
                      0.5,
                    ],
                  }}
                />
                <Layer
                  id="insignias-mapeados-label"
                  type="symbol"
                  minzoom={7.2}
                  layout={{
                    'text-field': 'TD',
                    'text-size': [
                      'interpolate',
                      ['exponential', 1.5],
                      ['zoom'],
                      7.2,
                      7,
                      8.5,
                      10,
                      10,
                      14,
                      11.5,
                      18,
                    ],
                    'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                    'text-allow-overlap': false,
                    'text-ignore-placement': false,
                    'text-optional': true,
                    'text-letter-spacing': 0.05,
                  }}
                  paint={{
                    'text-color': '#00718f',
                    'text-opacity': [
                      'interpolate',
                      ['linear'],
                      ['zoom'],
                      7.2,
                      0.25,
                      9,
                      0.45,
                      11,
                      0.55,
                    ],
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 1.2,
                    'text-halo-blur': 0.4,
                  }}
                />
              </Source>
            )}
        </MapboxMap>
        ) : null}
        {usarOverlaySvg && mapPronto && mapaDimensao && (
          <svg
            className="pointer-events-none absolute inset-0 z-[2]"
            width={mapaDimensao.w}
            height={mapaDimensao.h}
            viewBox={`0 0 ${mapaDimensao.w} ${mapaDimensao.h}`}
          >
            {overlaySvg.limiteFill ? (
              <path
                d={overlaySvg.limiteFill}
                fill={COR_NAO_MAPEADO}
                fillOpacity={0.16}
                fillRule="evenodd"
              />
            ) : null}
            {overlaySvg.areas.map((area) => (
              <path
                key={area.key}
                d={area.d}
                fill={area.cor}
                fillOpacity={0.72}
                stroke="#166534"
                strokeWidth={1.4}
                fillRule="evenodd"
              />
            ))}
            {overlaySvg.limiteLinha ? (
              <>
                <path
                  d={overlaySvg.limiteLinha}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={3.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <path
                  d={overlaySvg.limiteLinha}
                  fill="none"
                  stroke="#0f172a"
                  strokeWidth={1.35}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </>
            ) : null}
          </svg>
        )}

        {bairrosLoading && ehVerbaDireta && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center pt-4">
            <div className="rounded-lg bg-white/90 border border-gray-200 px-3 py-2 text-xs text-gray-600 shadow-sm">
              Carregando geometrias por bairro…
            </div>
          </div>
        )}

        {hoverInfo && !painelAberto && !modoBairrosEfetivo && (
          <div
            className="pointer-events-none absolute z-20 rounded-lg bg-gray-900/90 text-white text-xs px-2.5 py-1.5 shadow-lg"
            style={{ left: hoverInfo.x + 12, top: hoverInfo.y + 12 }}
          >
            {hoverInfo.somenteProjecao ? (
              <p className="text-gray-100">
                Projeção: {fmt(hoverInfo.valor)} casos
              </p>
            ) : (
              <>
                <p className="font-semibold">{hoverInfo.nome}</p>
                <>
                  <p className="text-orange-200">
                    Projeção: {fmt(hoverInfo.valor)} casos
                  </p>
                  <p className="text-gray-300">
                    Base: {fmt(hoverInfo.casosRegistrados)} · ONI{' '}
                    {fmtOni(hoverInfo.oni)} · fator {fmtFator(hoverInfo.fElnino)}
                  </p>
                  {hoverInfo.naoMapeado ? (
                    <p className="text-slate-300">Sem mapeamento TechDengue</p>
                  ) : (
                    <p className="text-emerald-300">Mapeado TechDengue</p>
                  )}
                  {hoverInfo.hectaresUnicos != null && (
                    <p className="text-gray-300">
                      Área única: {fmtHa(hoverInfo.hectaresUnicos)}
                    </p>
                  )}
                </>
              </>
            )}
          </div>
        )}

        {/* Painel lateral do município */}
        {exibirPainelMunicipio && munPainel && (
          <aside className="absolute top-3 right-14 w-72 max-h-[510px] flex flex-col bg-white rounded-xl border border-gray-200 shadow-xl z-10">
            <div className="flex-shrink-0 p-4 pb-2">
              <button
                type="button"
                onClick={() => {
                  onMunicipioFocado(null);
                  setPainelMunAberto(false);
                }}
                className="absolute top-2 right-2 text-gray-400 hover:text-gray-700"
                aria-label="Fechar painel"
              >
                <FaTimes className="w-4 h-4" />
              </button>

              <h4 className="text-sm font-semibold text-gray-800 mb-1 pr-6">
                {munPainel.nome}
              </h4>

              {!munFocadoTechDengue && (
                <span className="inline-block text-[10px] uppercase tracking-wide font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full mb-2 mr-1">
                  Não mapeado
                </span>
              )}

              {munPainel.nivel_alerta > 0 && (
                <span className="inline-block text-[10px] uppercase tracking-wide font-semibold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full mb-2">
                  Infodengue nível {munPainel.nivel_alerta}
                </span>
              )}

              {climaLoading ? (
                <p className="text-[11px] text-gray-400 mb-2">Carregando clima…</p>
              ) : climaPainel ? (
                <div className="mb-2">
                  <div className="flex gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-700 px-2 py-1 rounded-md">
                      <FaThermometerHalf className="w-2.5 h-2.5 text-orange-500" />
                      {fmtTemp(climaPainel.temp)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-700 px-2 py-1 rounded-md">
                      <FaTint className="w-2.5 h-2.5 text-blue-500" />
                      {fmtUmid(climaPainel.umid)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-700 px-2 py-1 rounded-md">
                      <FaCloudRain className="w-2.5 h-2.5 text-sky-500" />
                      {fmtChuva(climaPainel.chuva)}
                    </span>
                  </div>
                  {climaPainel.periodo && (
                    <p className="text-[10px] text-gray-400 mt-1">
                      {climaPainel.periodo}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-amber-600 mb-2">
                  Clima indisponível — previsão ao vivo falhou e o cache local não tem
                  temperatura válida para este município.
                </p>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
              <div className="text-xs text-gray-600 space-y-1 mb-3 border-t border-gray-100 pt-3">
                <div className="flex justify-between gap-2">
                  <span>Casos notificados</span>
                  <span className="font-medium text-gray-800 text-right">
                    {painelExtraLoading && !(Number(munPainel.base) > 0)
                      ? '…'
                      : fmt(munPainel.base)}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 -mt-0.5 mb-1">
                  {munPainel.baseFonte}
                </p>
                <div className="flex justify-between gap-2">
                  <span>População estimada</span>
                  <span className="font-medium text-gray-800">
                    {painelExtraLoading && !(populacaoMun(munPainel) ?? 0)
                      ? '…'
                      : fmt(populacaoMun(munPainel))}
                  </span>
                </div>
                {(painelExtra?.fonte_populacao ||
                  (!munFocadoTechDengue && (populacaoMun(munPainel) ?? 0) > 0)) && (
                  <p className="text-[10px] text-gray-400 -mt-0.5 mb-1">
                    {painelExtra?.fonte_populacao || 'IBGE Censo 2022 (estimada)'}
                  </p>
                )}
                <div className="flex justify-between gap-2">
                  <span>Incidência /100k</span>
                  <span className="font-medium text-gray-800">
                    {(() => {
                      const inc = incidenciaPor100k(
                        munPainel.base,
                        populacaoMun(munPainel),
                        munPainel.incidencia,
                      );
                      if (painelExtraLoading && inc == null) return '…';
                      return inc != null ? inc.toFixed(1) : '—';
                    })()}
                  </span>
                </div>
              </div>

              {munFocadoTechDengue && poiPainel && (
                <div className="text-xs text-gray-600 space-y-1 mb-3 border-t border-gray-100 pt-3">
                  <p className="text-gray-500 uppercase tracking-wide font-medium text-[10px] mb-1.5 flex items-center gap-1">
                    <FaMapMarkedAlt className="w-3 h-3 text-[#0087a8]" />
                    Mapeamento TechDengue
                  </p>
                  <div className="flex justify-between gap-2">
                    <span className="inline-flex items-center gap-1">
                      <FaBug className="w-2.5 h-2.5 text-emerald-600" />
                      Total de POIs
                    </span>
                    <span className="font-medium text-gray-800">
                      {fmt(poiPainel.totalPois)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Área mapeada</span>
                    <span className="font-medium text-gray-800">
                      {fmtHa(poiPainel.hectares)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>POI por área</span>
                    <span className="font-medium text-gray-800">
                      {fmtPoiHa(poiPainel.poiPorHa)}
                    </span>
                  </div>
                  {poiPainel.fonte && (
                    <p className="text-[10px] text-gray-400 pt-0.5">{poiPainel.fonte}</p>
                  )}
                </div>
              )}

              <div className="border-t border-gray-100 pt-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2 sticky top-0 bg-white pb-1">
                  Projeção × El Niño (mês a mês)
                </div>
                <p className="text-[10px] text-orange-700/80 mb-1.5">
                  Valor = casos projetados · Δ = impacto vs. cenário sem El Niño
                  (fator 1,0). ONI e fator vêm do mês.
                </p>
                {!munFocadoTechDengue && (
                  <p className="text-[10px] text-gray-400 mb-1.5">
                    Estimativa Infodengue (sazonal) — município sem mapeamento
                    TechDengue
                  </p>
                )}
                {painelExtraLoading &&
                munPainel.projecoes.every((p) => !(Number(p.valor) > 0)) ? (
                  <p className="text-[11px] text-slate-500">Carregando projeção…</p>
                ) : (
                  <ul className="space-y-1 text-xs max-h-48 overflow-y-auto overscroll-contain pr-1">
                    {munPainel.projecoes.map((p) => {
                      const fElnino = Number(p.fElnino) > 0 ? Number(p.fElnino) : 1;
                      const delta = deltaImpactoElnino(p.valor, fElnino);
                      const cls = classifica(p.valor);
                      const ativo = p.mesNum === mesNumSelecionado;
                      return (
                        <li
                          key={p.mesNum}
                          className={`flex justify-between items-center gap-2 px-2 py-1 rounded ${
                            ativo
                              ? 'bg-orange-50 text-orange-800 font-semibold'
                              : 'text-gray-600'
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate">{p.label}</span>
                            <span className="block text-[10px] font-normal text-gray-400">
                              ONI {fmtOni(p.oni)} · {fmtFator(fElnino)}
                              {p.oniProjetado ? ' · proj.' : ''}
                              {delta !== 0
                                ? ` · Δ ${delta > 0 ? '+' : ''}${fmt(delta)}`
                                : ''}
                            </span>
                          </span>
                          <span className="flex items-center gap-2 shrink-0">
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ backgroundColor: cls.cor }}
                            />
                            {fmt(p.valor)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </aside>
        )}

        {/* Painel lateral do bairro (verba direta) */}
        {bairroFocado && (
          <aside className="absolute top-3 right-14 w-72 max-h-[510px] flex flex-col bg-white rounded-xl border border-gray-200 shadow-xl z-10">
            <div className="flex-shrink-0 p-4 pb-2">
              <button
                type="button"
                onClick={() => setBairroFocadoIdx(null)}
                className="absolute top-2 right-2 text-gray-400 hover:text-gray-700"
                aria-label="Fechar painel"
              >
                <FaTimes className="w-4 h-4" />
              </button>

              <p className="text-[10px] uppercase tracking-wide text-[#0087a8] font-semibold">
                Bairro
              </p>
              <h4 className="text-sm font-semibold text-gray-800 pr-6">
                {bairroFocado.nome}
              </h4>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
              <div className="text-xs text-gray-600 space-y-1 mb-3 border-t border-gray-100 pt-3">
                <p className="text-gray-500 uppercase tracking-wide font-medium text-[10px] mb-1.5 flex items-center gap-1">
                  <FaMapMarkedAlt className="w-3 h-3 text-[#0087a8]" />
                  Geometria do bairro
                </p>
                <div className="flex justify-between gap-2">
                  <span>Área única</span>
                  <span className="font-medium text-gray-800">
                    {fmtHa(bairroFocado.hectaresUnicos)}
                  </span>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">
                  Projeção mês a mês
                </div>
                {bairroFocado.projecoes.length ? (
                  <ul className="space-y-1 text-xs">
                    {bairroFocado.projecoes.map((p) => {
                      const cls = classifica(p.valor);
                      const ativo = p.mesNum === mesNumSelecionado;
                      return (
                        <li
                          key={p.mesNum}
                          className={`flex justify-between items-center px-2 py-1 rounded ${
                            ativo
                              ? 'bg-[#0087a8]/10 text-[#0087a8] font-semibold'
                              : 'text-gray-600'
                          }`}
                        >
                          <span>{p.label}</span>
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ backgroundColor: cls.cor }}
                            />
                            {fmt(p.valor)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-[11px] text-amber-600">
                    Projeção indisponível para este bairro.
                  </p>
                )}
              </div>

              <p className="text-[10px] text-gray-400 pt-3">
                Casos do município repartidos entre bairros na proporção dos POIs
                mapeados (TechDengue).{' '}
                {bairrosModo === 'areas_mapeadas'
                  ? 'Polígono das áreas mapeadas do TechDengue sem overlap entre bairros.'
                  : 'Polígono aproximado pela envoltória dos POIs.'}
                {bairroFocado.criterioAtribuicao
                  ? ` Critério espacial: ${labelCriterioAtribuicao(
                      bairroFocado.criterioAtribuicao,
                    )}.`
                  : null}
              </p>
            </div>
          </aside>
        )}
      </div>

      {/* Legenda de cores — sempre abaixo do mapa */}
      <div
        className="border-t border-gray-100 px-4 py-3"
        aria-label="Legenda de cores do mapa"
      >
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-gray-600">
          {LEGENDA_CASOS.map((item) => (
            <span key={item.rotulo} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded"
                style={{ backgroundColor: item.cor }}
              />
              {item.rotulo}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="relative inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#0087a8]/20 border border-[#0087a8]/40">
              <span className="text-[8px] font-bold text-[#00718f]/80 leading-none">
                TD
              </span>
            </span>
            Mapeado TechDengue
          </span>
        </div>
      </div>

      {/* Ranking + Cenário ONI — só visão gerencial */}
      {visaoGerencial && (
      <div className="border-t border-gray-100">
        <div
          className="px-4 pt-3 flex gap-1 border-b border-gray-100"
          role="tablist"
          aria-label="Painéis do mapa"
        >
          <button
            type="button"
            role="tab"
            aria-selected={abaLegenda === 'ranking'}
            onClick={() => setAbaLegenda('ranking')}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
              abaLegenda === 'ranking'
                ? 'border-orange-500 text-orange-700 bg-orange-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Ranking
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={abaLegenda === 'cenario'}
            onClick={() => setAbaLegenda('cenario')}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
              abaLegenda === 'cenario'
                ? 'border-orange-500 text-orange-700 bg-orange-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Cenário ONI
          </button>
        </div>

        {abaLegenda === 'ranking' ? (
          <div className="px-4 py-3 space-y-3" role="tabpanel">
            <p className="text-[11px] text-gray-500">
              {rotuloPeriodoUltimo}
              {mesElninoMeta ? (
                <>
                  {' · '}
                  <span className="text-orange-700 font-medium">
                    ranking de {mesElninoMeta.label}
                  </span>
                </>
              ) : null}
            </p>
            {rankingUltimoElNino.length ? (
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {[
                  rankingUltimoElNino.slice(0, 4),
                  rankingUltimoElNino.slice(4, 8),
                ].map((coluna, colIdx) => (
                  <ol key={colIdx === 0 ? 'top4' : 'next4'} className="space-y-1.5">
                    {coluna.map((m, i) => {
                      const idxRank = colIdx * 4 + i;
                      const { cor } = classifica(m.casos);
                      const ativo = geocodeFocado === m.geocode;
                      return (
                        <li key={m.geocode}>
                          <button
                            type="button"
                            onClick={() => {
                              onMunicipioFocado(m.geocode);
                              setPainelMunAberto(true);
                            }}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                              ativo
                                ? 'bg-orange-50 ring-1 ring-orange-300'
                                : 'hover:bg-gray-50'
                            }`}
                          >
                            <span className="w-5 text-[10px] font-semibold text-gray-400">
                              {idxRank + 1}º
                            </span>
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: cor }}
                            />
                            <span className="flex-1 min-w-0 truncate font-medium text-gray-800">
                              {m.nome}
                            </span>
                            {m.techdengue ? (
                              <span className="shrink-0 text-[9px] font-bold text-[#00718f]/70">
                                TD
                              </span>
                            ) : null}
                            <span className="shrink-0 font-semibold text-orange-700">
                              {fmt(m.casos)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-700">
                Sem projeção no mês selecionado para montar o ranking.
              </p>
            )}
            <p className="text-[10px] text-gray-400">
              Ranking pelos casos projetados no mês do filtro · borda grossa + TD
              no mapa = mapeado TechDengue · clique para abrir o painel.
            </p>
          </div>
        ) : (
          <div className="px-4 py-3 space-y-3" role="tabpanel">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-gray-800">
                  {progressoProximoElNino.ativo
                    ? 'El Niño em curso — evolução projetada'
                    : 'Progressão até o próximo El Niño'}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  ONI atual {fmtOni(progressoProximoElNino.oniAtual)} ·{' '}
                  {progressoProximoElNino.intensidade} · limiar ≥ +0,50
                  {mesNumSelecionado != null ? (
                    <>
                      {' · '}
                      <span className="text-orange-700 font-medium">
                        {fmt(progressoProximoElNino.casosMesSelecionado)} casos
                        projetados
                      </span>
                      {progressoProximoElNino.nMunicipios > 0
                        ? ` (${progressoProximoElNino.nMunicipios} mun.)`
                        : ''}
                    </>
                  ) : null}
                </p>
              </div>
              {!progressoProximoElNino.ativo && (
                <span className="text-sm font-bold text-orange-600">
                  {progressoProximoElNino.progresso}%
                </span>
              )}
            </div>

            {!progressoProximoElNino.ativo && (
              <div
                className="h-2.5 rounded-full bg-gray-100 overflow-hidden"
                role="progressbar"
                aria-valuenow={progressoProximoElNino.progresso}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progresso até limiar El Niño"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 via-amber-400 to-orange-500 transition-all"
                  style={{ width: `${progressoProximoElNino.progresso}%` }}
                />
              </div>
            )}

            {progressoProximoElNino.proximoMesElNino ? (
              <p className="text-xs text-orange-800 bg-orange-50 border border-orange-100 rounded-lg px-2.5 py-1.5">
                {progressoProximoElNino.ativo
                  ? 'Próximo reforço projetado'
                  : 'Próximo mês com ONI ≥ +0,50'}
                :{' '}
                <strong>{progressoProximoElNino.proximoMesElNino.label}</strong>
                {' · ONI '}
                {fmtOni(progressoProximoElNino.proximoMesElNino.oni)}
                {' · fator '}
                {fmtFator(progressoProximoElNino.proximoMesElNino.fElnino)}
                {' · '}
                <strong>
                  {fmt(progressoProximoElNino.proximoMesElNino.casosProjetados)}{' '}
                  casos projetados
                </strong>
              </p>
            ) : !progressoProximoElNino.ativo ? (
              <p className="text-xs text-sky-800 bg-sky-50 border border-sky-100 rounded-lg px-2.5 py-1.5">
                Nenhum mês projetado no recorte atual cruza o limiar de El Niño
                (ONI ≥ +0,50).
              </p>
            ) : null}

            <ul className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {progressoProximoElNino.meses.map((m) => {
                const oni = m.oni;
                const elNinoMes =
                  oni != null && Number(oni) >= LIMIAR_ONI_EL_NINO;
                const ativoMes = m.mesNum === mesNumSelecionado;
                return (
                  <li key={m.mesNum}>
                    <button
                      type="button"
                      onClick={() => onMesMudou(m.mesNum)}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left ${
                        ativoMes
                          ? 'bg-orange-50 text-orange-800 font-semibold'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <span className="w-16 shrink-0">{m.label}</span>
                      <span
                        className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                          elNinoMes
                            ? 'bg-orange-500'
                            : oni != null && oni < -LIMIAR_ONI_EL_NINO
                              ? 'bg-sky-500'
                              : 'bg-gray-300'
                        }`}
                      />
                      <span className="flex-1 min-w-0 truncate text-[11px] text-gray-500">
                        ONI {fmtOni(oni)}
                        {m.oniProjetado ? ' · projetado' : ''}
                        {elNinoMes ? ' · El Niño' : ''}
                      </span>
                      <span className="shrink-0 text-[11px] font-medium text-gray-700 tabular-nums">
                        {fmt(m.casosProjetados)} casos
                      </span>
                      <span className="shrink-0 text-[11px] text-gray-400 w-10 text-right">
                        {fmtFator(m.fElnino)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-[10px] text-gray-400">
              Casos projetados = soma dos municípios do mapa · ONI NOAA CPC ·
              clique no mês para sincronizar cores e ranking.
            </p>
          </div>
        )}
      </div>
      )}
    </div>
  );
};

export default ElNinoMapaChoropleth;
