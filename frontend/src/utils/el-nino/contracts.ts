import fs from 'fs';
import path from 'path';
import { MUNICIPIOS_ICISMEP_BH } from './constants';
import { formatarNomeProprio } from './formatar-nome-municipio';
import { aplicarHistoricoConsolidado } from './historico-casos-consolidado';

const DATA_DIR = path.join(process.cwd(), 'src', 'utils', 'el-nino', 'data');
const LISTA_FILE = path.join(DATA_DIR, 'consorcios_lista_MG.json');
const IBGE_COORDS_FILE = path.join(DATA_DIR, 'ibge_coords_cache.json');
const NOMES_OFICIAIS_FILE = path.join(DATA_DIR, 'nomes_oficiais_mg.json');

let nomesOficiaisCache: Map<number, string> | null = null;

function carregarNomesOficiais(): Map<number, string> {
  if (nomesOficiaisCache) return nomesOficiaisCache;
  nomesOficiaisCache = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(NOMES_OFICIAIS_FILE, 'utf8'));
    for (const [k, v] of Object.entries(raw)) {
      const gc = Number(k);
      if (Number.isFinite(gc) && typeof v === 'string' && v.trim()) {
        nomesOficiaisCache.set(gc, v.trim());
      }
    }
  } catch {
    /* opcional até rodar corrigir-nomes-municipios.ts */
  }
  return nomesOficiaisCache;
}

function nomeOficialIbge(geocode: number): string | null {
  return carregarNomesOficiais().get(Number(geocode)) ?? null;
}

/** Nome canônico para exibição: IBGE oficial ou forma própria (não CAIXA ALTA). */
export function resolverNomeMunicipio(geocode: number, fallback?: string): string {
  const gc = Number(geocode);
  const oficial = nomeOficialIbge(gc);
  if (oficial) return oficial;
  const fb = String(fallback ?? '').trim();
  if (fb) return formatarNomeProprio(fb);
  return `Município ${gc}`;
}

let ibgeCoordsCache: Map<number, { lat: number; lon: number; nome: string }> | null = null;

function carregarIbgeCoords(): Map<number, { lat: number; lon: number; nome: string }> {
  if (ibgeCoordsCache) return ibgeCoordsCache;
  ibgeCoordsCache = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(IBGE_COORDS_FILE, 'utf8'));
    for (const [k, v] of Object.entries(raw)) {
      const gc = Number(k);
      const entry = v as { lat?: number; lon?: number; nome?: string };
      const lat = Number(entry?.lat);
      const lon = Number(entry?.lon);
      if (Number.isFinite(gc) && Number.isFinite(lat) && Number.isFinite(lon)) {
        ibgeCoordsCache.set(gc, {
          lat,
          lon,
          nome: nomeOficialIbge(gc) ?? (entry?.nome || `Município ${gc}`),
        });
      }
    }
  } catch {
    /* cache opcional */
  }
  return ibgeCoordsCache;
}

// ─── Contracts ───────────────────────────────────────────────────────────────

interface ConsorcioMunicipio {
  geocode: number;
  nome: string;
  id?: string;
}

interface Consorcio {
  id: number;
  nome: string;
  eConsorcio: number;
  tipo_financiamento: string;
  n_municipios: number;
  municipios: ConsorcioMunicipio[];
}

function normalizarMunicipios(raw: any): ConsorcioMunicipio[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && raw.geocode) return [raw];
  return [];
}

/** Rótulo canônico do pipeline (ex.: SIMSAUDE - ZURS UBÁ). */
function rotuloConsorcioPipeline(contratoId: number): string | null {
  const file = path.join(DATA_DIR, `pipeline_v2_cache_${contratoId}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rotulo = (raw?.dados ?? raw)?.rotulo_consorcio;
    return typeof rotulo === 'string' && rotulo.trim() ? rotulo.trim() : null;
  } catch {
    return null;
  }
}

let listaCache: { consorcios: Consorcio[] } | null = null;
let listaCacheMtime = 0;

function carregarLista() {
  try {
    const stat = fs.statSync(LISTA_FILE);
    const mtimeMs = stat.mtimeMs;
    if (listaCache && mtimeMs === listaCacheMtime) return listaCache;
    const raw = JSON.parse(fs.readFileSync(LISTA_FILE, 'utf8'));
    raw.consorcios = (raw.consorcios || []).map((c: any) => {
      const municipios = normalizarMunicipios(c.municipios).map((m) => ({
        ...m,
        nome: resolverNomeMunicipio(Number(m.geocode), m.nome),
      }));
      const verbaDireta = Number(c.eConsorcio) === 0;
      const rotuloCache = verbaDireta ? null : rotuloConsorcioPipeline(Number(c.id));
      const nome =
        verbaDireta && municipios.length === 1
          ? resolverNomeMunicipio(municipios[0].geocode, c.nome)
          : rotuloCache ?? String(c.nome ?? '');
      return { ...c, nome, municipios };
    });
    listaCache = raw;
    listaCacheMtime = mtimeMs;
    return listaCache!;
  } catch {
    return listaCache || { consorcios: [] as Consorcio[] };
  }
}

export function listarConsorcios(): Consorcio[] {
  return carregarLista().consorcios;
}

/**
 * Contrato (verba direta ou consórcio) dono do geocode.
 * Preferência: verba direta (eConsorcio=0) > consórcio; sem fallback global.
 */
export function contratoIdDoGeocode(geocode: number): number | null {
  const gc = Number(geocode);
  if (!Number.isFinite(gc) || gc <= 0) return null;
  const lista = listarConsorcios();
  const vd = lista.find(
    (c) =>
      Number(c.eConsorcio) === 0 &&
      c.municipios.some((m) => Number(m.geocode) === gc),
  );
  if (vd) return vd.id;
  const cons = lista.find((c) =>
    c.municipios.some((m) => Number(m.geocode) === gc),
  );
  return cons?.id ?? null;
}

/** IDs de contratos cujo escopo contém o geocode (VD + consórcios), sem seed fixo. */
export function contratosDoGeocode(geocode: number): number[] {
  const gc = Number(geocode);
  const ids: number[] = [];
  for (const c of listarConsorcios()) {
    if (c.municipios.some((m) => Number(m.geocode) === gc)) {
      ids.push(c.id);
    }
  }
  return ids;
}

export function obterConsorcio(id: number): Consorcio | undefined {
  return carregarLista().consorcios.find((c) => c.id === id);
}

/** Nome IBGE a partir da lista de consórcios ou catálogo ICISMEP. */
export function buscarNomeMunicipioLista(geocode: number): string | null {
  const gc = Number(geocode);
  const oficial = nomeOficialIbge(gc);
  if (oficial) return oficial;

  for (const c of listarConsorcios()) {
    const mun = c.municipios.find((m) => Number(m.geocode) === gc);
    if (mun?.nome) return mun.nome;
  }
  const icismep = MUNICIPIOS_ICISMEP_BH.find((m) => m.geocode === gc);
  if (icismep?.municipio) return resolverNomeMunicipio(gc, icismep.municipio);
  return null;
}

function mesclarEscopoConsorcio(dados: any, consorcio: Consorcio): any {
  const geocodes = consorcio.municipios.map((m) => Number(m.geocode));
  const coordsMap = new Map(
    (dados.municipios ?? []).map((m: any) => [Number(m.geocode), m]),
  );

  const municipiosLista = consorcio.municipios.map((m) => {
    const gc = Number(m.geocode);
    const extra = (coordsMap.get(gc) ??
      MUNICIPIOS_ICISMEP_BH.find((x) => x.geocode === gc) ??
      null) as { lat?: number | null; lon?: number | null } | null;
    return {
      geocode: gc,
      municipio: resolverNomeMunicipio(gc, m.nome),
      nome: resolverNomeMunicipio(gc, m.nome),
      lat: extra?.lat ?? null,
      lon: extra?.lon ?? null,
    };
  });

  const dfMun = [...(dados.df_mensal_mun ?? [])];
  const presentes = new Set(dfMun.map((r: any) => Number(r.geocode)));
  for (const gc of geocodes) {
    if (presentes.has(gc)) continue;
    const rows = buscarMensalMunGeocode(gc);
    if (rows.length) {
      dfMun.push(...rows);
      presentes.add(gc);
    }
  }

  return {
    ...dados,
    rotulo_consorcio: consorcio.nome,
    municipios: municipiosLista,
    df_mensal_mun: dfMun,
  };
}

// ─── Pipeline cache ──────────────────────────────────────────────────────────

interface PipelineCache {
  dados: any;
  atualizadoEm: number;
}

const memoriaCache = new Map<number, PipelineCache>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function lerCacheDisco(contratoId: number): any | null {
  const file = path.join(DATA_DIR, `pipeline_v2_cache_${contratoId}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw?.dados || raw || null;
  } catch {
    return null;
  }
}

export function lerGeojson(contratoId: number): any | null {
  const file = path.join(DATA_DIR, `mapa_geojson_${contratoId}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw?.geojson ?? raw;
  } catch {
    return null;
  }
}

/**
 * Busca features de malha pelos geocodes em qualquer mapa_geojson_*.json.
 * Útil quando o contrato local (ex.: 101 Contagem) não tem arquivo, mas
 * produção/legado já gerou o polígono sob outro contratoId (ex.: 52).
 */
export function lerGeojsonPorGeocodes(geocodes: number[]): any | null {
  const alvo = new Set(
    geocodes.map((g) => Number(g)).filter((g) => Number.isFinite(g) && g > 0),
  );
  if (!alvo.size || !fs.existsSync(DATA_DIR)) return null;

  const porGeocode = new Map<number, any>();
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(DATA_DIR)
      .filter((f) => /^mapa_geojson_\d+\.json$/i.test(f));
  } catch {
    return null;
  }

  for (const file of files) {
    if (porGeocode.size >= alvo.size) break;
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(DATA_DIR, file), 'utf8'),
      );
      const feats = (raw?.geojson ?? raw)?.features;
      if (!Array.isArray(feats)) continue;
      for (const f of feats) {
        const gc = geocodeFeatureMalha(f);
        if (alvo.has(gc) && !porGeocode.has(gc)) {
          porGeocode.set(gc, f);
        }
      }
    } catch {
      /* ignora arquivo corrompido */
    }
  }

  if (!porGeocode.size) return null;
  return {
    type: 'FeatureCollection',
    features: [...porGeocode.values()],
  };
}

function geocodeFeatureMalha(f: any): number {
  const p = f?.properties ?? {};
  const raw = p.geocode ?? p.codarea ?? p.id ?? p.CD_MUN ?? f?.id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizarFeatureMalha(f: any, nome?: string): any {
  const gc = geocodeFeatureMalha(f);
  if (!gc) return f;
  const props = f.properties ?? {};
  return {
    ...f,
    properties: {
      ...props,
      geocode: gc,
      codarea: String(gc).padStart(7, '0'),
      name:
        nome ??
        props.name ??
        props.nome ??
        props.description ??
        `Município ${gc}`,
    },
  };
}

function normalizarGeojsonMalha(geojson: any): any {
  if (!geojson?.features?.length) return geojson;
  return {
    ...geojson,
    features: geojson.features.map((f: any) => normalizarFeatureMalha(f)),
  };
}

/** Alinha features do GeoJSON à lista de municípios do contrato (como Dash alinharMalhaMunicipios). */
export function alinharMalhaMunicipios(geojson: any, municipios: any[]): any {
  const alvo = (municipios || []).map((m) => Number(m.geocode)).filter(Boolean);
  if (!alvo.length) return geojson;

  const porGeocode = new Map<number, any>();
  for (const f of geojson?.features || []) {
    const gc = geocodeFeatureMalha(f);
    if (gc) porGeocode.set(gc, f);
  }

  const features = alvo
    .map((gc) => {
      const f = porGeocode.get(gc);
      if (!f) return null;
      const mun = municipios.find((m) => Number(m.geocode) === gc);
      const nome = mun?.nome ?? mun?.municipio;
      return normalizarFeatureMalha(
        f,
        nome ? resolverNomeMunicipio(gc, nome) : undefined,
      );
    })
    .filter(Boolean);

  if (!features.length) {
    return { type: 'FeatureCollection', features: [] };
  }
  return { type: 'FeatureCollection', features };
}

export interface MalhaContratoResult {
  geojson: any | null;
  malha_fonte: string | null;
  aviso?: string;
}

/**
 * Resolve malha IBGE do contrato com fallbacks em cascata:
 * geojson_foco → mapa_geojson_{id}.json → geojson embutido em mapa_projecao → pipeline cache.
 */
export function resolverMalhaContrato(
  contratoId: number,
  opts?: { geojsonFoco?: any; municipios?: any[] },
): MalhaContratoResult {
  const candidatos: Array<{ geojson: any; fonte: string }> = [];

  if (opts?.geojsonFoco?.features?.length) {
    candidatos.push({ geojson: opts.geojsonFoco, fonte: 'geojson_foco' });
  }

  const fromFile = lerGeojson(contratoId);
  if (fromFile?.features?.length) {
    candidatos.push({
      geojson: fromFile,
      fonte: `mapa_geojson_${contratoId}.json`,
    });
  }

  // Fallback por geocode: Contagem local (contrato 101) pode achar polígono
  // gerado sob outro id (ex.: mapa_geojson_52.json na base legado/produção).
  const geocodesMun = (opts?.municipios ?? [])
    .map((m) => Number(m.geocode))
    .filter(Boolean);
  if (geocodesMun.length) {
    const porGeocode = lerGeojsonPorGeocodes(geocodesMun);
    if (porGeocode?.features?.length) {
      candidatos.push({
        geojson: porGeocode,
        fonte: 'mapa_geojson_*.json (match por geocode)',
      });
    }
  }

  const mapaPack = lerMapaProjecao(contratoId);
  const embedded =
    mapaPack?.payload?.geojson ?? mapaPack?.geojson ?? null;
  if (embedded?.features?.length) {
    candidatos.push({
      geojson: embedded,
      fonte: 'mapa_projecao (geojson embutido)',
    });
  }

  const disco = lerCacheDisco(contratoId);
  if (disco?.geojson_foco?.features?.length) {
    candidatos.push({
      geojson: disco.geojson_foco,
      fonte: 'pipeline_v2_cache (geojson_foco)',
    });
  }

  for (const { geojson, fonte } of candidatos) {
    let normalizado = normalizarGeojsonMalha(geojson);
    if (opts?.municipios?.length) {
      normalizado = alinharMalhaMunicipios(normalizado, opts.municipios);
    }
    if (normalizado?.features?.length) {
      return { geojson: normalizado, malha_fonte: fonte };
    }
  }

  return {
    geojson: null,
    malha_fonte: null,
    aviso: `Malha geográfica indisponível para o contrato ${contratoId}. Gere mapa_geojson_${contratoId}.json ou atualize o pipeline El Niño.`,
  };
}

/** Anexa geojson alinhado ao payload de mapa-projecao (equivalente a montarPayloadMapaProjecao no Dash). */
export function montarPayloadMapaComMalha(
  payload: any,
  contratoId: number,
  opts?: { geojsonFoco?: any },
): any {
  if (!payload) return payload;

  const municipios = payload.municipios || [];
  const { geojson, malha_fonte, aviso } = resolverMalhaContrato(contratoId, {
    geojsonFoco: opts?.geojsonFoco ?? payload.geojson,
    municipios,
  });

  const avisos = [...(payload.avisos || [])];
  if (aviso) avisos.push(aviso);
  if (!geojson?.features?.length && municipios.length) {
    avisos.push(
      `Malha IBGE não encontrada para ${municipios.length} município(s) do contrato ${contratoId}.`,
    );
  }

  return {
    ...payload,
    geojson: geojson?.features?.length ? geojson : null,
    malha_fonte: malha_fonte ?? payload.malha_fonte ?? null,
    avisos,
  };
}

function lerMapaProjecao(contratoId: number): any | null {
  const file = path.join(DATA_DIR, `mapa_projecao_${contratoId}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Injeta a população real (do pipeline) em cada município do payload do mapa.
 * O gerador antigo gravou `pop` com fallback fixo (3260); aqui preenchemos
 * `populacao` a partir de `pipeline_v2_cache.municipios[].populacao`, que o
 * painel prioriza (`populacaoMun` usa `populacao ?? pop`).
 */
export function enriquecerPopulacaoMapa(inner: any, contratoId: number): any {
  if (!inner?.municipios?.length) return inner;
  const cid = Number(inner._contrato_id ?? contratoId);

  const popMap = new Map<number, number>();
  const adicionar = (lista: any[]) => {
    for (const m of lista ?? []) {
      const gc = Number(m?.geocode);
      const pop = Number(m?.populacao);
      if (gc && Number.isFinite(pop) && pop > 0 && !popMap.has(gc)) {
        popMap.set(gc, Math.round(pop));
      }
    }
  };

  adicionar(carregarDadosContrato(cid)?.municipios);
  // Fallback: procura a população em qualquer pipeline que tenha o geocode.
  const faltantes = inner.municipios.filter(
    (m: any) => !popMap.has(Number(m.geocode)),
  );
  if (faltantes.length) {
    for (const c of listarConsorcios()) {
      if (popMap.size >= inner.municipios.length) break;
      if (Number(c.id) === cid) continue;
      adicionar(carregarDadosContrato(c.id)?.municipios);
    }
  }

  if (!popMap.size) return inner;

  const municipios = inner.municipios.map((m: any) => {
    const pop = popMap.get(Number(m.geocode));
    return pop != null ? { ...m, populacao: pop } : m;
  });
  return { ...inner, municipios };
}

/** Busca payload de mapa contendo o município (útil para verba direta). */
export function buscarPayloadMapaPorGeocode(
  geocode: number,
  contratoPreferido?: number,
): any | null {
  const ids = new Set<number>();
  if (contratoPreferido) ids.add(contratoPreferido);
  for (const id of contratosDoGeocode(geocode)) ids.add(id);
  for (const id of listarContratosComMapaProjecao()) {
    ids.add(id);
  }

  for (const id of ids) {
    const pack = lerMapaProjecao(id);
    if (!pack) continue;
    const inner = pack.payload || pack;
    const mun = (inner.municipios || []).find(
      (m: any) => Number(m.geocode) === Number(geocode),
    );
    if (!mun) continue;
    const consorcio = obterConsorcio(id);
    return {
      ...inner,
      municipios: [mun],
      rotulo_conjunto: consorcio?.nome || inner.rotulo_conjunto,
      _contrato_id: id,
      _filtro_geocode: geocode,
    };
  }
  return null;
}

function extrairMunicipioIdDeProjecao(mun: any): number | null {
  const id =
    mun?.poi_hectare?.municipio_id ??
    mun?.hectares?.municipio_id ??
    mun?.pois?.municipio_id ??
    mun?.municipio_id ??
    mun?.municipioId;
  return id != null && Number(id) > 0 ? Number(id) : null;
}

function listarContratosComMapaProjecao(): number[] {
  try {
    return fs
      .readdirSync(DATA_DIR)
      .filter((f) => /^mapa_projecao_\d+\.json$/i.test(f))
      .map((f) => Number(f.replace(/^mapa_projecao_/i, '').replace(/\.json$/i, '')))
      .filter((n) => n > 0);
  } catch {
    return [];
  }
}

/** ID interno TechDengue do município (para APIs de bairro). */
export function buscarMunicipioIdGeocode(
  geocode: number,
  contratoPreferido?: number,
): number | null {
  const mapa = buscarPayloadMapaPorGeocode(geocode, contratoPreferido);
  const idMapa = extrairMunicipioIdDeProjecao(mapa?.municipios?.[0]);
  if (idMapa) return idMapa;

  const ids = new Set<number>([
    ...contratosDoGeocode(geocode),
    ...listarContratosComMapaProjecao(),
  ]);
  if (contratoPreferido) ids.add(contratoPreferido);
  for (const c of listarConsorcios()) ids.add(c.id);

  for (const cid of ids) {
    const pack = lerMapaProjecao(cid);
    const inner = pack?.payload || pack;
    const m = (inner?.municipios || []).find(
      (x: any) => Number(x.geocode) === Number(geocode),
    );
    const mid = extrairMunicipioIdDeProjecao(m);
    if (mid) return mid;
  }

  for (const cid of ids) {
    const d = lerCacheDisco(cid);
    const tabelas = [d?.mapa_df, d?.df_municipios, d?.municipios].filter(Boolean);
    for (const tbl of tabelas) {
      const row = (tbl as any[]).find(
        (m: any) => Number(m.geocode) === Number(geocode),
      );
      const mid = extrairMunicipioIdDeProjecao(row);
      if (mid) return mid;
    }
  }

  return null;
}

/** Coordenadas lat/lon de um município em qualquer cache pipeline. */
export function buscarCoordenadasGeocode(
  geocode: number,
): { lat: number; lon: number; nome: string } | null {
  const gc = Number(geocode);
  const nomeOficial = nomeOficialIbge(gc);
  const ibge = carregarIbgeCoords().get(gc);
  if (ibge) {
    return { ...ibge, nome: nomeOficial ?? ibge.nome };
  }

  const icismep = MUNICIPIOS_ICISMEP_BH.find((m) => m.geocode === gc);
  if (icismep) {
    return { lat: icismep.lat, lon: icismep.lon, nome: icismep.municipio };
  }
  const ids = new Set<number>([
    ...contratosDoGeocode(gc),
    ...listarConsorcios().map((c) => c.id),
  ]);
  for (const id of ids) {
    const d = lerCacheDisco(id);
    const m = (d?.municipios ?? []).find(
      (x: any) => Number(x.geocode) === gc,
    );
    const lat = Number(m?.lat);
    const lon = Number(m?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
      return {
        lat,
        lon,
        nome: nomeOficial ?? (m.municipio || m.nome || `Município ${gc}`),
      };
    }
  }
  return null;
}

/** Série mensal do município em qualquer pipeline em cache (prioriza dono do geocode). */
export function buscarMensalMunGeocode(geocode: number): any[] {
  const ids = new Set<number>([
    ...contratosDoGeocode(geocode),
    ...listarConsorcios().map((c) => c.id),
  ]);
  for (const id of ids) {
    const d = lerCacheDisco(id);
    const rows = (d?.df_mensal_mun ?? []).filter(
      (r: any) => Number(r.geocode) === Number(geocode),
    );
    if (rows.length) return rows;
  }
  return [];
}

/** Monta payload de mapa para verba direta quando não há cache do contrato. */
export function montarMapaFallbackGeocode(
  geocode: number,
  contratoPreferido?: number,
): any | null {
  const existente = buscarPayloadMapaPorGeocode(geocode, contratoPreferido);
  if (existente) return existente;

  const consorcio =
    (contratoPreferido ? obterConsorcio(contratoPreferido) : undefined) ||
    listarConsorcios().find((c) =>
      c.municipios.some((m) => Number(m.geocode) === Number(geocode)),
    );
  const contratoId =
    contratoPreferido ?? consorcio?.id ?? contratoIdDoGeocode(geocode) ?? null;

  // Usa meses/ONI do próprio cache do contrato, nunca template de outro.
  const packProprio =
    contratoId != null ? lerMapaProjecao(contratoId) : null;
  const template = packProprio?.payload || packProprio;
  const mesesBase =
    template?.meses?.length > 0
      ? template.meses
      : Array.from({ length: 6 }, (_, i) => {
          const agora = new Date();
          const dt = new Date(agora.getFullYear(), agora.getMonth() + i, 1);
          return {
            mesNum: dt.getMonth() + 1,
            label: `${MESES_LOCAL[dt.getMonth()]}/${String(dt.getFullYear()).slice(-2)}`,
            fElnino: 1,
            oni: null,
          };
        });

  const munMeta = consorcio?.municipios.find(
    (m) => Number(m.geocode) === Number(geocode),
  );
  const mensal = buscarMensalMunGeocode(geocode);
  const ultimo = [...mensal].sort(
    (a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum,
  ).at(-1);
  const base = Math.max(1, Number(ultimo?.CasosDengue) || 1);
  const nome =
    munMeta?.nome ||
    ultimo?.municipio ||
    resolverNomeMunicipio(geocode) ||
    `Município ${geocode}`;
  const coords = buscarCoordenadasGeocode(geocode);

  const projecoes = (mesesBase as any[]).map((mes) => {
    const fElnino = Number(mes.fElnino) || 1;
    const fSaz = 0.15;
    const valor = Math.max(1, Math.round(base * fSaz * fElnino));
    return {
      mesNum: mes.mesNum,
      label: mes.label,
      fSaz,
      fElnino,
      valor,
      bruto: valor,
      teto: Math.round(3260 * 0.15),
      tetoAtivado: false,
    };
  });

  const municipioId = buscarMunicipioIdGeocode(geocode, contratoPreferido);

  return {
    ano_projecao: new Date().getFullYear(),
    rotulo_conjunto: consorcio?.nome || template?.rotulo_conjunto || nome,
    meses: mesesBase,
    municipios: [
      {
        geocode,
        nome,
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        pop: 3260,
        base,
        baseFonte: ultimo
          ? `Infodengue mensal (${ultimo.Mes}/${ultimo.Ano})`
          : 'estimativa municipal',
        semana_epi: null,
        nivel_alerta: 1,
        incidencia: 0,
        fatoresSaz: Object.fromEntries(
          (mesesBase as any[]).map((m) => [m.mesNum, 0.15]),
        ),
        projecoes,
        clima: null,
        poi_hectare: municipioId
          ? {
              municipio_id: municipioId,
              municipio_nome: nome,
              contrato_id: contratoId,
              contrato_nome: consorcio?.nome,
              total_registros: 0,
              hectares_mapeados: 0,
              poi_por_hectare: 0,
              fonte: 'TechDengue API',
            }
          : null,
      },
    ],
    elnino: template?.elnino ?? {},
    formula: template?.formula ?? {
      expressao: 'base * f_sazonal * f_elnino',
      teto_pct: 35,
    },
    _fallback_geocode: geocode,
    _contrato_id: contratoId,
    avisos: [
      ...(template?.avisos || []),
      contratoId
        ? `Projeção municipal estimada (sem mapa_projecao_${contratoId} completo).`
        : 'Projeção municipal estimada (contrato não resolvido).',
    ],
    fontes: template?.fontes || [],
    atualizado_em: new Date().toISOString(),
  };
}

const MESES_LOCAL = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

/**
 * Resolve dados do contrato a partir do próprio cache `pipeline_v2_cache_{id}`.
 * Não reutiliza cache de outro contrato (ex.: ICISMEP 19) como fallback silencioso.
 */
export function resolverDadosContrato(
  contratoId: number,
  forceRefresh = false,
): any | null {
  const consorcio = obterConsorcio(contratoId);
  const dadosCache = carregarDadosContrato(contratoId, forceRefresh);
  if (dadosCache) {
    const mesclado = consorcio
      ? mesclarEscopoConsorcio(dadosCache, consorcio)
      : dadosCache;
    return aplicarHistoricoConsolidado(mesclado);
  }

  if (!consorcio) return null;

  const geocodes = consorcio.municipios.map((m) => Number(m.geocode));
  const municipiosLista = consorcio.municipios.map((m) => {
    const gc = Number(m.geocode);
    const coords = buscarCoordenadasGeocode(gc);
    return {
      geocode: gc,
      municipio: resolverNomeMunicipio(gc, m.nome),
      nome: resolverNomeMunicipio(gc, m.nome),
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null,
    };
  });

  // Casos/ONI do próprio geocode em outros caches só se for o município dono;
  // evita misturar série climatológica/agregada do consórcio 19.
  const dfMun = geocodes.flatMap((gc) => {
    const proprio = contratoIdDoGeocode(gc);
    if (proprio != null && proprio !== contratoId) return [];
    return buscarMensalMunGeocode(gc);
  });

  return aplicarHistoricoConsolidado({
    rotulo_consorcio: consorcio.nome,
    municipios: municipiosLista,
    df_serie: [],
    df_mensal_mun: dfMun,
    df_serie_ponderada: [],
    oni_mensal: [],
    elnino: {},
    avisos: [
      `Sem cache pipeline_v2_cache_${contratoId}.json — dados parciais; rode o pipeline deste contrato.`,
    ],
    _contrato_id: contratoId,
    fontes: [],
  });
}

export function carregarDadosContrato(contratoId: number, forceRefresh = false): any | null {
  if (!forceRefresh) {
    const mem = memoriaCache.get(contratoId);
    if (mem && Date.now() - mem.atualizadoEm < CACHE_TTL_MS) return mem.dados;
  }

  const disco = lerCacheDisco(contratoId);
  if (!disco) return null;

  const geojsonRaw = lerGeojson(contratoId);
  const geojson = geojsonRaw?.features?.length ? geojsonRaw : null;
  const mapaProj = lerMapaProjecao(contratoId);

  const dados = {
    ...disco,
    geojson_foco: geojson || disco.geojson_foco || null,
    mapa_projecao: mapaProj || null,
  };

  memoriaCache.set(contratoId, { dados, atualizadoEm: Date.now() });
  return dados;
}
