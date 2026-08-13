/**
 * Visão gerencial: cruza malha IBGE (MG completa) com área/POI TechDengue.
 * Prioridade: runtime cache → seed → CDN (jsDelivr/geodata-br) → API IBGE.
 */
import fs from 'fs';
import poiHectarePayload from './data/poi_hectare.json';
import {
  escreverJsonAtomico,
  runtimePath,
  seedPath,
} from './cache-paths';

const MALHA_RUNTIME = runtimePath('malha_mg_ibge.json');
const MALHA_SEED = seedPath('malha_mg_ibge.json');

const CDN_MALHA_MG =
  'https://cdn.jsdelivr.net/gh/tbrugz/geodata-br@master/geojson/geojs-31-mun.json';

const IBGE_MALHA_MG =
  'https://servicodados.ibge.gov.br/api/v3/malhas/estados/31';

/** MG tem 853 municípios — abaixo disso a malha ainda é só o foco. */
const LIMITE_MALHA_COMPLETA = 800;

type PoiRow = {
  geocode: number;
  municipio_nome?: string;
  total_registros?: number;
  hectares_mapeados?: number;
};

type GeoFeature = {
  type?: string;
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: unknown;
};

type GeoCollection = {
  type: string;
  features: GeoFeature[];
};

let cacheMalhaMemoria: GeoCollection | null = null;

function ehTechDengue(poi: {
  total_registros?: number;
  hectares_mapeados?: number;
} | null | undefined): boolean {
  if (!poi) return false;
  const ha = Number(poi.hectares_mapeados);
  const pois = Number(poi.total_registros);
  return (Number.isFinite(ha) && ha > 0) || (Number.isFinite(pois) && pois > 0);
}

function mapaPoi(): Map<number, PoiRow> {
  const map = new Map<number, PoiRow>();
  const lista = (poiHectarePayload as { municipios?: PoiRow[] })?.municipios;
  for (const m of lista ?? []) {
    const gc = Number(m.geocode);
    if (Number.isFinite(gc) && gc > 0) map.set(gc, m);
  }
  return map;
}

export function geocodeDaFeatureMalha(f: GeoFeature): number {
  const p = f.properties ?? {};
  const raw = p.codarea ?? p.geocode ?? p.id ?? f.id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function malhaGerencialIncompleta(
  payload: Record<string, unknown>,
): boolean {
  const fonte = String(payload.malha_fonte ?? '');
  const geo = payload.geojson as { features?: unknown[] } | null | undefined;
  const n = geo?.features?.length ?? 0;
  if (n >= LIMITE_MALHA_COMPLETA && /completa/i.test(fonte)) return false;
  return n < LIMITE_MALHA_COMPLETA;
}

function lerMalhaDeArquivo(arquivo: string): GeoCollection | null {
  try {
    if (!fs.existsSync(arquivo)) return null;
    const raw = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as GeoCollection;
    if (!raw?.features?.length) return null;
    return { type: raw.type ?? 'FeatureCollection', features: raw.features };
  } catch {
    return null;
  }
}

function lerMalhaLocal(): GeoCollection | null {
  return lerMalhaDeArquivo(MALHA_RUNTIME) ?? lerMalhaDeArquivo(MALHA_SEED);
}

function persistirMalhaLocal(malha: GeoCollection): void {
  try {
    // Não regrava se runtime já tem malha completa equivalente
    const atual = lerMalhaDeArquivo(MALHA_RUNTIME);
    if (
      atual &&
      (atual.features?.length ?? 0) >= LIMITE_MALHA_COMPLETA &&
      (atual.features?.length ?? 0) === (malha.features?.length ?? 0)
    ) {
      return;
    }
    escreverJsonAtomico(MALHA_RUNTIME, malha);
  } catch {
    /* cache em disco é best-effort */
  }
}

async function fetchJsonMalha(
  url: string,
  timeoutMs: number,
): Promise<GeoCollection | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as GeoCollection;
    if (!data?.features?.length) return null;
    return { type: data.type ?? 'FeatureCollection', features: data.features };
  } catch {
    return null;
  }
}

async function buscarMalhaIbgeMgAoVivo(): Promise<GeoCollection | null> {
  const url = new URL(IBGE_MALHA_MG);
  url.searchParams.set('formato', 'application/vnd.geo+json');
  url.searchParams.set('qualidade', 'minima');
  url.searchParams.set('intrarregiao', 'municipio');
  return fetchJsonMalha(url.toString(), 90_000);
}

/**
 * Resolve malha MG completa: memória → disco → CDN → IBGE.
 */
export async function resolverMalhaMgCompleta(): Promise<GeoCollection | null> {
  if (cacheMalhaMemoria?.features?.length) return cacheMalhaMemoria;

  const local = lerMalhaLocal();
  if (local?.features?.length) {
    cacheMalhaMemoria = local;
    return local;
  }

  const cdn = await fetchJsonMalha(CDN_MALHA_MG, 60_000);
  if (cdn?.features?.length) {
    persistirMalhaLocal(cdn);
    cacheMalhaMemoria = cdn;
    return cdn;
  }

  const ibge = await buscarMalhaIbgeMgAoVivo();
  if (ibge?.features?.length) {
    persistirMalhaLocal(ibge);
    cacheMalhaMemoria = ibge;
    return ibge;
  }

  return null;
}

function montarFeaturesCruzadas(
  malha: GeoCollection,
  munis: Array<Record<string, unknown>>,
  poiMap: Map<number, PoiRow>,
): { features: GeoFeature[]; nTech: number } {
  const porNome = new Map<number, string>();
  const munPorGc = new Map<number, Record<string, unknown>>();
  for (const m of munis) {
    const gc = Number(m.geocode);
    if (!gc) continue;
    porNome.set(gc, String(m.nome ?? ''));
    munPorGc.set(gc, m);
  }

  let nTech = 0;
  const features = malha.features.map((f) => {
    const gc = geocodeDaFeatureMalha(f);
    const poi = poiMap.get(gc);
    const mun = munPorGc.get(gc);
    const tech =
      ehTechDengue(poi) ||
      ehTechDengue(
        mun?.poi_hectare as {
          total_registros?: number;
          hectares_mapeados?: number;
        },
      ) ||
      ehTechDengue(mun?.hectares as { hectares_mapeados?: number }) ||
      mun?.techdengue === true;
    if (tech) nTech += 1;
    return {
      ...f,
      properties: {
        ...(f.properties ?? {}),
        geocode: gc,
        codarea: String(gc).padStart(7, '0'),
        id: String(gc).padStart(7, '0'),
        techdengue: tech ? 1 : 0,
        mapeado: tech ? 1 : 0,
        name:
          porNome.get(gc) ||
          poi?.municipio_nome ||
          (f.properties?.name as string | undefined) ||
          (f.properties?.nome as string | undefined) ||
          `Município ${gc}`,
      },
    };
  });

  return { features, nTech };
}

/**
 * Substitui geojson do mapa gerencial pela malha MG completa,
 * marcando techdengue (área/POI) vs não mapeado.
 */
/** Anexa o polígono IBGE de um município (cache MG local/CDN) se o payload veio sem geojson. */
export async function anexarMalhaIbgeFoco<T extends Record<string, unknown>>(
  payload: T,
  geocode: number,
): Promise<T> {
  const gc = Number(geocode);
  if (!Number.isFinite(gc) || gc <= 0) return payload;
  const existing = payload.geojson as { features?: unknown[] } | null | undefined;
  if (existing?.features?.length) return payload;

  const malha = await resolverMalhaMgCompleta();
  if (!malha?.features?.length) return payload;

  const nome =
    ((payload.municipios as Array<{ geocode?: number; nome?: string }>) ?? []).find(
      (m) => Number(m.geocode) === gc,
    )?.nome ?? '';

  const features = malha.features
    .filter((f) => geocodeDaFeatureMalha(f) === gc)
    .map((f) => ({
      ...f,
      properties: {
        ...(f.properties ?? {}),
        geocode: gc,
        codarea: String(gc).padStart(7, '0'),
        name:
          nome ||
          (f.properties?.name as string | undefined) ||
          (f.properties?.nome as string | undefined) ||
          `Município ${gc}`,
      },
    }));

  if (!features.length) return payload;

  return {
    ...payload,
    geojson: { type: 'FeatureCollection', features },
    malha_fonte: 'IBGE/MG local · município',
  };
}

export async function anexarMalhaIbgeGerencial<
  T extends Record<string, unknown>,
>(payload: T): Promise<T> {
  const incompleta = malhaGerencialIncompleta(payload);
  const malha = incompleta ? await resolverMalhaMgCompleta() : null;

  if (!malha?.features?.length) {
    // Sem malha completa disponível: só marca flags no que já veio.
    return marcarTechDengueNoGeojson(payload);
  }

  const poiMap = mapaPoi();
  const munis = (payload.municipios as Array<Record<string, unknown>>) ?? [];
  const { features, nTech } = montarFeaturesCruzadas(malha, munis, poiMap);

  const avisos = [...((payload.avisos as string[]) ?? [])].filter(
    (a) => !/Malha gerencial/i.test(a),
  );
  avisos.push(
    `Malha gerencial: ${nTech} mun. TechDengue e ${features.length - nTech} sem mapeamento (IBGE/MG).`,
  );

  const fontes = [...((payload.fontes as string[]) ?? [])];
  if (!fontes.some((f) => /IBGE Malhas — todos/i.test(f))) {
    fontes.push('IBGE Malhas — todos os municípios de MG');
  }

  return {
    ...payload,
    municipios: munis.map((m) => {
      if (m.techdengue != null) return m;
      const gc = Number(m.geocode);
      const poi = poiMap.get(gc);
      return {
        ...m,
        techdengue:
          ehTechDengue(poi) ||
          ehTechDengue(
            m.poi_hectare as {
              total_registros?: number;
              hectares_mapeados?: number;
            },
          ) ||
          ehTechDengue(m.hectares as { hectares_mapeados?: number }),
      };
    }),
    geojson: { type: 'FeatureCollection', features },
    malha_fonte:
      'IBGE Malhas — MG completa (cache local / CDN · TechDengue × não mapeados)',
    fontes,
    avisos,
  };
}

/** Só marca flags techdengue/mapeado no geojson já presente. */
export function marcarTechDengueNoGeojson<T extends Record<string, unknown>>(
  payload: T,
): T {
  const geo = payload.geojson as { type?: string; features?: GeoFeature[] } | null;
  if (!geo?.features?.length) return payload;

  const poiMap = mapaPoi();
  const munis = (payload.municipios as Array<Record<string, unknown>>) ?? [];

  const features = geo.features.map((f) => {
    const gc = geocodeDaFeatureMalha(f);
    const props = f.properties ?? {};
    const poi = poiMap.get(gc);
    const mun = munis.find((m) => Number(m.geocode) === gc);
    const tech =
      Number(props.techdengue ?? props.mapeado) === 1 ||
      ehTechDengue(poi) ||
      ehTechDengue(
        mun?.poi_hectare as {
          total_registros?: number;
          hectares_mapeados?: number;
        },
      ) ||
      ehTechDengue(mun?.hectares as { hectares_mapeados?: number }) ||
      mun?.techdengue === true;
    return {
      ...f,
      properties: {
        ...props,
        geocode: gc || props.geocode,
        codarea: String(gc || props.geocode || '').padStart(7, '0'),
        techdengue: tech ? 1 : 0,
        mapeado: tech ? 1 : 0,
      },
    };
  });

  return {
    ...payload,
    geojson: { ...geo, features },
  };
}
