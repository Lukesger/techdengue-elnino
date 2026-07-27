import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import MapboxMap, {
  Source,
  Layer,
  NavigationControl,
  MapRef,
  MapMouseEvent,
} from 'react-map-gl/mapbox';
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
import { FaTimes, FaThermometerHalf, FaCloudRain, FaTint, FaMapMarkedAlt, FaBug } from 'react-icons/fa';

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
}

const MAPBOX_TOKEN = ENV.NEXT_PUBLIC_MAPBOX_TOKEN;

function classifica(valor: number): {
  label: 'Crítico' | 'Alto' | 'Médio' | 'Baixo';
  cor: string;
} {
  if (valor >= 500) return { label: 'Crítico', cor: '#f87171' };
  if (valor >= 200) return { label: 'Alto', cor: '#fb923c' };
  if (valor >= 100) return { label: 'Médio', cor: '#d97706' };
  return { label: 'Baixo', cor: '#4ade80' };
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('pt-BR').format(Math.round(n));
}

function fmtHa(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n)} ha`;
}

function fmtPoiHa(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
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
  return {
    totalPois: poi?.total_registros ?? null,
    hectares: ha,
    poiPorHa: poi?.poi_por_hectare ?? null,
    fonte: poi?.fonte ?? mun.hectares?.fonte ?? null,
  };
}

/** Extrai geocode IBGE (7 dígitos) das propriedades do GeoJSON. */
function geocodeDaFeature(f: GeoJSON.Feature): number {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const raw =
    p.codarea ??
    p.geocode ??
    p.id ??
    p.CD_MUN ??
    p.cd_mun ??
    (typeof f.id === 'string' || typeof f.id === 'number' ? f.id : null);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
      layers: ['municipios-fill'],
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
}) => {
  const mapRef = useRef<MapRef | null>(null);
  const [mapPronto, setMapPronto] = useState(false);
  const [climaAoVivo, setClimaAoVivo] = useState<ClimaForecast | null>(null);
  const [climaLoading, setClimaLoading] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [bairroFocadoIdx, setBairroFocadoIdx] = useState<number | null>(null);
  const [painelMunAberto, setPainelMunAberto] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{
    nome: string;
    valor: number;
    hectaresUnicos?: number | null;
    somenteProjecao?: boolean;
    x: number;
    y: number;
  } | null>(null);

  const modoBairros = Boolean(bairros && bairros.length);

  const malhaBase = data?.geojson ?? null;

  const geocodesProj = useMemo(() => {
    if (!data?.municipios?.length) return null;
    return new Set(data.municipios.map((m) => Number(m.geocode)));
  }, [data?.municipios]);

  const projecoesMap = useMemo(() => {
    if (!data || mesNumSelecionado == null) return new Map<number, number>();
    const m = new Map<number, number>();
    for (const mun of data.municipios) {
      const gc = Number(mun.geocode);
      const p = mun.projecoes.find((x) => x.mesNum === mesNumSelecionado);
      m.set(gc, p?.valor ?? 0);
    }
    return m;
  }, [data, mesNumSelecionado]);

  const geojsonEnriquecido = useMemo(() => {
    if (!malhaBase?.features?.length) return null;
    const features = malhaBase.features
      .map((f: GeoJSON.Feature) => {
        const geocode = geocodeDaFeature(f);
        const valor = projecoesMap.get(geocode) ?? 0;
        const { cor } = classifica(valor);
        const nome =
          String(
            (f.properties as Record<string, unknown>)?.name ??
              (f.properties as Record<string, unknown>)?.nome ??
              (f.properties as Record<string, unknown>)?.description ??
              '',
          ) || data?.municipios.find((m) => m.geocode === geocode)?.nome;
        return {
          ...f,
          properties: {
            ...f.properties,
            geocode,
            fid: geocode,
            nome,
            valor_proj: valor,
            cor,
          },
        };
      })
      .filter((f: GeoJSON.Feature) => {
        if (!geocodesProj) return true;
        const gc = Number((f.properties as Record<string, unknown>)?.geocode);
        return geocodesProj.has(gc);
      });

    if (!features.length) return null;
    return { ...malhaBase, features };
  }, [malhaBase, projecoesMap, geocodesProj, data?.municipios]);

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
        const { cor } = classifica(valor);
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
            cor,
          },
          geometry,
        };
      });
    if (!features.length) return null;
    return { type: 'FeatureCollection', features };
  }, [modoBairros, bairros, mesNumSelecionado]);

  /** Modo áreas mapeadas: opacidade plena evita “empilhamento” visual residual. */
  const fillOpacityBairros = bairrosModo === 'areas_mapeadas' ? 0.78 : 0.68;

  const modoBairrosEfetivo = Boolean(
    modoBairros && bairrosGeojson && !bairrosLoading,
  );
  const geojsonAtivo = modoBairrosEfetivo
    ? bairrosGeojson
    : geojsonEnriquecido ?? (malhaBase?.features?.length ? malhaBase : null);

  /** Limite IBGE do município focado — exibido junto às áreas mapeadas. */
  const malhaLimiteMunicipio = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!malhaBase?.features?.length) return null;
    const gcAlvo =
      geocodeFocado ??
      (data?.municipios?.length === 1
        ? Number(data.municipios[0]!.geocode)
        : null);
    if (gcAlvo == null || !Number.isFinite(gcAlvo)) return null;
    const features = malhaBase.features.filter(
      (f) => geocodeDaFeature(f) === gcAlvo,
    );
    if (!features.length) return null;
    return { type: 'FeatureCollection', features };
  }, [malhaBase, geocodeFocado, data?.municipios]);

  const aplicarBounds = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const colecoes: GeoJSON.FeatureCollection[] = [];
    if (geojsonAtivo?.features?.length) colecoes.push(geojsonAtivo);
    if (modoBairrosEfetivo && malhaLimiteMunicipio?.features?.length) {
      colecoes.push(malhaLimiteMunicipio);
    }
    if (!colecoes.length) return;

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    const visit = (coords: unknown): void => {
      if (!Array.isArray(coords)) return;
      if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        const lng = coords[0];
        const lat = coords[1];
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
        return;
      }
      for (const c of coords) visit(c);
    };

    for (const fc of colecoes) {
      for (const f of fc.features) {
        const g = f.geometry;
        if (!g) continue;
        if ('coordinates' in g) visit(g.coordinates);
      }
    }

    if (!Number.isFinite(minLng)) return;
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      {
        padding: 56,
        maxZoom: modoBairrosEfetivo ? 14 : 11,
        duration: 800,
      },
    );
  }, [geojsonAtivo, modoBairrosEfetivo, malhaLimiteMunicipio]);

  useEffect(() => {
    if (mapPronto) aplicarBounds();
  }, [mapPronto, aplicarBounds]);

  /** Mapbox costuma inicializar com canvas 0×0 dentro de animações (framer-motion). */
  useEffect(() => {
    if (!mapPronto || loading) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const redimensionar = () => {
      try {
        map.resize();
      } catch {
        /* ignore */
      }
    };

    redimensionar();
    const t1 = window.setTimeout(redimensionar, 100);
    const t2 = window.setTimeout(redimensionar, 400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [mapPronto, loading, geojsonAtivo, bairrosLoading]);

  const munFocado: ProjecaoMunicipio | null = useMemo(() => {
    if (!data || geocodeFocado == null) return null;
    return data.municipios.find((m) => Number(m.geocode) === geocodeFocado) ?? null;
  }, [data, geocodeFocado]);

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
        contratoId: contratoClima,
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
  }, [geocodeFocado, contratoClima]);

  const climaPainel = useMemo(() => {
    if (!munFocado) return null;
    return extrairClimaPainel(climaAoVivo, munFocado.clima);
  }, [munFocado, climaAoVivo]);

  const poiPainel = useMemo(
    () => (munFocado ? dadosPoiHa(munFocado) : null),
    [munFocado],
  );

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
    ],
  );

  // viewport: ajusta para MG (ou bbox real do GeoJSON, se quiser refinar)
  const initialView = {
    longitude: -44.5,
    latitude: -18.5,
    zoom: 6,
  };

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
            Em verba direta o mapa plota polígonos de{' '}
            <code className="text-[11px]">area_mapeadas</code> (GIS), não a malha
            IBGE do município. Verifique permissão de geometrias e a conexão com o
            PostGIS.
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

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            Mapa de projeção epidemiológica {data.ano_projecao}
            {modoBairrosEfetivo ? ' · por bairro' : ''}
          </h3>
          <p className="text-xs text-gray-400">
            {data.rotulo_conjunto}
            {modoBairrosEfetivo
              ? ` · ${bairros?.length ?? 0} áreas (${
                  bairrosModo === 'areas_mapeadas'
                    ? 'áreas mapeadas TechDengue'
                    : bairrosModo === 'indisponivel'
                      ? 'áreas indisponíveis'
                      : 'envoltória dos POIs'
                })`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onBaixarKml && (
            <button
              type="button"
              onClick={onBaixarKml}
              className="px-3 py-1.5 rounded-lg bg-sky-700 text-white text-xs font-medium hover:bg-sky-800"
            >
              Baixar KML ({poligonosUnificadosKml ?? bairros?.length ?? 0}{' '}
              unificados)
            </button>
          )}
          <label
            htmlFor="mapa-mes-sel"
            className="text-xs text-gray-500 font-medium"
          >
            Mês:
          </label>
          <select
            id="mapa-mes-sel"
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:ring-1 focus:ring-[#0087a8]"
            value={mesNumSelecionado ?? ''}
            onChange={(e) => onMesMudou(Number(e.target.value))}
          >
            {data.meses.map((m) => (
              <option key={m.mesNum} value={m.mesNum}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {bairrosFallbackAtivo && ehVerbaDireta && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Exibindo apenas o limite municipal — as áreas mapeadas por bairro não
          puderam ser carregadas.
        </div>
      )}

      <div
        className="relative"
        style={{ height: 540, minHeight: 540 }}
      >
        <MapboxMap
          ref={mapRef}
          initialViewState={initialView}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/light-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          onLoad={() => {
            setMapPronto(true);
            window.setTimeout(() => {
              try {
                mapRef.current?.getMap()?.resize();
              } catch {
                /* ignore */
              }
            }, 0);
          }}
          onClick={handleClick}
          onMouseMove={(e) => {
            const map = e.target;

            if (modoBairrosEfetivo) {
              const { lng, lat } = e.lngLat;
              const hit = resolverBairroNoEvento(lng, lat);
              setHovered(hit?.idx ?? null);
              setHoverInfo(null);
              map.getCanvas().style.cursor = hit ? 'pointer' : 'default';
              return;
            }

            const feats =
              e.features?.length ? e.features : featuresNoPonto(map, e.point);
            const feat = feats[0];
            if (feat) {
              const props = feat.properties as Record<string, unknown>;
              const fid = Number(props?.fid);
              setHovered(Number.isFinite(fid) ? fid : null);
              setHoverInfo({
                nome: String(
                  props?.nome ?? props?.name ?? 'Município',
                ),
                valor: Number(props?.valor_proj ?? 0),
                x: e.point.x,
                y: e.point.y,
              });
              map.getCanvas().style.cursor = 'pointer';
            } else {
              setHovered(null);
              setHoverInfo(null);
              map.getCanvas().style.cursor = '';
            }
          }}
          onMouseLeave={(e) => {
            setHovered(null);
            setHoverInfo(null);
            e.target.getCanvas().style.cursor = '';
          }}
          interactiveLayerIds={['municipios-fill']}
        >
          <NavigationControl position="top-right" showCompass={false} />
          {mapPronto && geojsonAtivo && (
            <Source
              key={modoBairrosEfetivo ? 'bairros' : 'municipios'}
              id="municipios"
              type="geojson"
              data={geojsonAtivo}
              generateId
            >
              <Layer
                id="municipios-fill"
                type="fill"
                paint={{
                  'fill-color': ['coalesce', ['get', 'cor'], '#0087a8'],
                  'fill-opacity': [
                    'case',
                    ['==', ['to-number', ['get', 'fid']], focadoFid ?? -1],
                    0.92,
                    ['==', ['to-number', ['get', 'fid']], hovered ?? -1],
                    0.82,
                    modoBairrosEfetivo ? fillOpacityBairros : 0.68,
                  ],
                  'fill-outline-color': modoBairrosEfetivo ? 'transparent' : '#ffffff',
                }}
              />
              {modoBairrosEfetivo && bairrosModo !== 'areas_mapeadas' && (
              <Layer
                id="municipios-borda"
                type="line"
                paint={{
                  'line-color': modoBairrosEfetivo ? '#166534' : '#334155',
                  'line-width': [
                    'case',
                    ['==', ['to-number', ['get', 'fid']], focadoFid ?? -1],
                    modoBairrosEfetivo ? 2 : 2.5,
                    modoBairrosEfetivo ? 0.75 : 1,
                  ],
                  'line-opacity': modoBairrosEfetivo ? 0.55 : 0.85,
                }}
              />
              )}
              {modoBairrosEfetivo && bairrosModo === 'areas_mapeadas' && (
              <Layer
                id="municipios-borda"
                type="line"
                paint={{
                  'line-color': '#166534',
                  'line-width': [
                    'case',
                    ['==', ['to-number', ['get', 'fid']], focadoFid ?? -1],
                    1.5,
                    0.4,
                  ],
                  'line-opacity': 0.35,
                }}
              />
              )}
              {!modoBairrosEfetivo && (
              <Layer
                id="municipios-borda"
                type="line"
                paint={{
                  'line-color': '#334155',
                  'line-width': [
                    'case',
                    ['==', ['to-number', ['get', 'fid']], focadoFid ?? -1],
                    2.5,
                    1,
                  ],
                  'line-opacity': 0.85,
                }}
              />
              )}
            </Source>
          )}
          {mapPronto && modoBairrosEfetivo && malhaLimiteMunicipio && (
            <Source
              id="limite-municipio"
              type="geojson"
              data={malhaLimiteMunicipio}
            >
              <Layer
                id="limite-municipio-linha"
                type="line"
                paint={{
                  'line-color': '#1e3a5f',
                  'line-width': 0.75,
                  'line-opacity': 0.92,
                }}
              />
            </Source>
          )}
        </MapboxMap>

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
                <p className="text-gray-300">
                  Projeção: {fmt(hoverInfo.valor)} casos
                </p>
                {hoverInfo.hectaresUnicos != null && (
                  <p className="text-gray-300">
                    Área única: {fmtHa(hoverInfo.hectaresUnicos)}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Painel lateral do município */}
        {exibirPainelMunicipio && munFocado && (
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
                {munFocado.nome}
              </h4>

              {munFocado.nivel_alerta > 0 && (
                <span className="inline-block text-[10px] uppercase tracking-wide font-semibold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full mb-2">
                  Infodengue nível {munFocado.nivel_alerta}
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
                    {fmt(munFocado.base)}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 -mt-0.5 mb-1">
                  {munFocado.baseFonte}
                </p>
                <div className="flex justify-between gap-2">
                  <span>População estimada</span>
                  <span className="font-medium text-gray-800">
                    {fmt(populacaoMun(munFocado))}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Incidência /100k</span>
                  <span className="font-medium text-gray-800">
                    {Number.isFinite(munFocado.incidencia)
                      ? munFocado.incidencia.toFixed(1)
                      : '—'}
                  </span>
                </div>
              </div>

              {poiPainel && (
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
                  Projeção mês a mês
                </div>
                <ul className="space-y-1 text-xs max-h-40 overflow-y-auto overscroll-contain pr-1">
                  {munFocado.projecoes.map((p) => {
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

      {/* Legenda */}
      <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-4 flex-wrap text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded"
            style={{ backgroundColor: '#f87171' }}
          />
          Crítico ≥500
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded"
            style={{ backgroundColor: '#fb923c' }}
          />
          Alto 200–499
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded"
            style={{ backgroundColor: '#d97706' }}
          />
          Médio 100–199
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded"
            style={{ backgroundColor: '#4ade80' }}
          />
          Baixo &lt;100
        </span>
        <span className="ml-auto text-[10px] text-gray-400">
          {modoBairrosEfetivo
            ? 'Clique em um bairro para detalhes'
            : 'Clique em um município para detalhes'}
        </span>
      </div>
    </div>
  );
};

export default ElNinoMapaChoropleth;
