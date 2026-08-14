/**
 * Clima (previsão 14d) para municípios sem payload TechDengue.
 * Hot path: disco → Open-Meteo (coords MG) → grava disco.
 *
 * Runtime: .cache/el-nino/clima_nao_mapeados/{geocode}.json
 * Seed:    src/utils/el-nino/data/coords_municipios_mg.json
 */
import fs from 'fs';
import type { ClimaForecast } from '@/services/el-nino-api';
import { buscarClimaOpenMeteo } from './clima-atual';
import { buscarCoordenadasGeocode, resolverNomeMunicipio } from './contracts';
import { normalizarClimaForecast } from './clima-painel';
import {
  escreverJsonAtomico,
  garantirDirRuntime,
  runtimePath,
  seedPath,
} from './cache-paths';

const TTL_MS = 60 * 60 * 1000;
const COORDS_FILE = seedPath('coords_municipios_mg.json');

type CoordsPayload = {
  municipios?: Array<{
    geocode: number;
    lat: number;
    lon: number;
    nome?: string;
  }>;
};

type Envelope = {
  atualizado_em: string;
  expira_em: string;
  payload: ClimaForecast;
};

let coordsMap: Map<
  number,
  { lat: number; lon: number; nome?: string }
> | null = null;
const memoria = new Map<number, { expiraEm: number; payload: ClimaForecast }>();

function garantirDir(): void {
  garantirDirRuntime('clima_nao_mapeados');
}

function arquivo(geocode: number): string {
  return runtimePath('clima_nao_mapeados', `${Number(geocode)}.json`);
}

function carregarCoordsMg(): Map<
  number,
  { lat: number; lon: number; nome?: string }
> {
  if (coordsMap) return coordsMap;
  const map = new Map<number, { lat: number; lon: number; nome?: string }>();
  try {
    if (fs.existsSync(COORDS_FILE)) {
      const raw = JSON.parse(
        fs.readFileSync(COORDS_FILE, 'utf8'),
      ) as CoordsPayload;
      for (const m of raw.municipios ?? []) {
        const gc = Number(m.geocode);
        const lat = Number(m.lat);
        const lon = Number(m.lon);
        if (
          !Number.isFinite(gc) ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lon)
        ) {
          continue;
        }
        map.set(gc, { lat, lon, nome: m.nome });
      }
    }
  } catch {
    /* ignore */
  }
  coordsMap = map;
  return map;
}

function lerDisco(geocode: number): ClimaForecast | null {
  const gc = Number(geocode);
  const mem = memoria.get(gc);
  if (mem && mem.expiraEm > Date.now()) return mem.payload;

  try {
    const f = arquivo(gc);
    if (!fs.existsSync(f)) return null;
    const env = JSON.parse(fs.readFileSync(f, 'utf8')) as Envelope;
    const exp = env.expira_em ? Date.parse(env.expira_em) : 0;
    if (!Number.isFinite(exp) || exp <= Date.now() || !env.payload) return null;
    const payload = normalizarClimaForecast(env.payload);
    const temp = Number(payload.atual?.temperatura_c);
    if (!(Number.isFinite(temp) && temp > 0) && !payload.dias?.length) {
      return null;
    }
    memoria.set(gc, { payload, expiraEm: exp });
    return payload;
  } catch {
    return null;
  }
}

function gravarDisco(forecast: ClimaForecast): void {
  const gc = Number(forecast.geocode);
  if (!Number.isFinite(gc) || gc <= 0) return;
  const agora = Date.now();
  const env: Envelope = {
    atualizado_em: new Date(agora).toISOString(),
    expira_em: new Date(agora + TTL_MS).toISOString(),
    payload: forecast,
  };
  try {
    garantirDir();
    const f = arquivo(gc);
    if (!escreverJsonAtomico(f, env)) {
      throw new Error('escrita atômica falhou');
    }
    memoria.set(gc, { payload: forecast, expiraEm: agora + TTL_MS });
  } catch (err) {
    console.warn(
      '[clima-nao-mapeado] falha ao gravar:',
      (err as Error)?.message,
    );
  }
}

function resolverCoords(geocode: number): {
  geocode: number;
  lat: number;
  lon: number;
  cidade: string;
} | null {
  const gc = Number(geocode);
  const doMg = carregarCoordsMg().get(gc);
  if (doMg) {
    return {
      geocode: gc,
      lat: doMg.lat,
      lon: doMg.lon,
      cidade: resolverNomeMunicipio(gc, doMg.nome),
    };
  }
  const legacy = buscarCoordenadasGeocode(gc);
  if (!legacy) return null;
  return {
    geocode: gc,
    lat: legacy.lat,
    lon: legacy.lon,
    cidade: resolverNomeMunicipio(gc, legacy.nome),
  };
}

/**
 * Previsão local para qualquer geocode MG (não depende do Nest).
 */
export async function obterClimaLocalPorGeocode(
  geocode: number,
): Promise<ClimaForecast | null> {
  const gc = Number(geocode);
  if (!Number.isFinite(gc) || gc <= 0) return null;

  const cached = lerDisco(gc);
  if (cached) return cached;

  const coords = resolverCoords(gc);
  if (!coords) {
    console.warn(`[clima-nao-mapeado] sem coords para ${gc}`);
    return null;
  }

  try {
    const live = await buscarClimaOpenMeteo(coords);
    const normalizado = normalizarClimaForecast({
      ...live,
      geocode: gc,
      fonte: live.fonte || 'Open-Meteo Forecast (local)',
    });
    gravarDisco(normalizado);
    return normalizado;
  } catch (err) {
    console.warn(
      `[clima-nao-mapeado] Open-Meteo falhou ${gc}:`,
      (err as Error)?.message,
    );
    return null;
  }
}
