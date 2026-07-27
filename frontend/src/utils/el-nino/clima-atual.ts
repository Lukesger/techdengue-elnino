import { normalizePublicApiBaseUrl } from '../../config/api';
import { buscarCoordenadasGeocode } from './contracts';
import type { ClimaForecast } from '@/services/el-nino-api';
import { fetchComTls } from './tls-fetch';
import { normalizarClimaForecast } from './clima-painel';

export {
  extrairClimaPainel,
  normalizarClimaForecast,
  type ClimaPainelMapa,
} from './clima-painel';

const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL_MS = 15 * 60 * 1000;

const memoriaClima = new Map<string, { exp: number; payload: ClimaForecast }>();

function validarTemperatura(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(45, Math.max(0, n));
}

function validarCasos(v: unknown): number {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, n);
}

function validarPrecipitacao(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatarDataBR(iso: string): string {
  if (!iso) return '';
  const [, m, d] = String(iso).split('-');
  return d && m ? `${d}/${m}` : iso;
}

export function climaEhPrevisaoAtual(clima: ClimaForecast | null | undefined): boolean {
  if (!clima?.atual) return false;
  if (String(clima.fonte || '').includes('Open-Meteo Forecast')) return true;
  if (
    clima.modo === 'previsao' &&
    !String(clima.atual.condicao || '').toLowerCase().includes('mensal')
  ) {
    return validarTemperatura(clima.atual.temperatura_c) > 0;
  }
  return false;
}

export function resolverCoordenadasMunicipio(
  dados: any,
  geocode: number,
): { geocode: number; lat: number; lon: number; cidade: string } | null {
  const gc = Number(geocode);
  const lista = [
    ...(dados?.municipios ?? []),
    ...(dados?.municipios_ibge ?? []),
  ];
  const mun = lista.find((m: any) => Number(m.geocode) === gc);
  const lat = Number(mun?.lat);
  const lon = Number(mun?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
    return {
      geocode: gc,
      lat,
      lon,
      cidade: mun?.municipio || mun?.nome || mun?.municipio_ibge || `Município ${gc}`,
    };
  }

  const coords = buscarCoordenadasGeocode(gc);
  if (!coords) return null;
  return {
    geocode: gc,
    lat: coords.lat,
    lon: coords.lon,
    cidade: coords.nome || `Município ${gc}`,
  };
}

export async function buscarClimaOpenMeteo(mun: {
  geocode: number;
  lat: number;
  lon: number;
  cidade: string;
}): Promise<ClimaForecast> {
  const cacheKey = `om:${mun.geocode}`;
  const hit = memoriaClima.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.payload;

  const url = new URL(OPEN_METEO_FORECAST);
  url.searchParams.set('latitude', String(mun.lat));
  url.searchParams.set('longitude', String(mun.lon));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,precipitation,weather_code',
  );
  url.searchParams.set(
    'daily',
    'temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean',
  );
  url.searchParams.set('timezone', 'America/Sao_Paulo');
  url.searchParams.set('forecast_days', '14');

  const res = await fetchComTls(url.toString(), {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`Open-Meteo ${res.status}`);
  }

  const dados = (await res.json()) as any;
  const atual = dados.current ?? {};
  const daily = dados.daily ?? {};
  const datas: string[] = daily.time ?? [];

  const payload: ClimaForecast = {
    fonte: 'Open-Meteo Forecast',
    cidade: mun.cidade,
    geocode: mun.geocode,
    lat: mun.lat,
    lon: mun.lon,
    atualizado_em: new Date().toISOString(),
    modo: 'previsao',
    atual: {
      temperatura_c: validarTemperatura(atual.temperature_2m),
      umidade_pct: validarCasos(atual.relative_humidity_2m),
      precipitacao_mm: validarPrecipitacao(atual.precipitation),
      condicao: 'Variável',
    },
    dias: datas.map((data, i) => ({
      data,
      periodo: formatarDataBR(data),
      cidade: mun.cidade,
      max_c: validarTemperatura(daily.temperature_2m_max?.[i]),
      min_c: validarTemperatura(daily.temperature_2m_min?.[i]),
      chuva_mm: validarPrecipitacao(daily.precipitation_sum?.[i]),
      umidade_pct: validarCasos(daily.relative_humidity_2m_mean?.[i]),
    })),
  };

  const normalizado = normalizarClimaForecast(payload);
  memoriaClima.set(cacheKey, {
    payload: normalizado,
    exp: Date.now() + CACHE_TTL_MS,
  });
  return normalizado;
}

async function buscarClimaBackend(
  auth: string,
  geocode: number,
  contratoId?: number,
): Promise<ClimaForecast | null> {
  const base = normalizePublicApiBaseUrl(process.env.NEXT_PUBLIC_API_URL || '');
  if (!base) return null;

  const q = new URLSearchParams({
    geocode: String(geocode),
    ano: 'previsao',
  });
  if (contratoId != null && contratoId > 0) {
    q.set('contratoId', String(contratoId));
  }

  const res = await fetch(`${base}/el-nino-analytics/clima?${q.toString()}`, {
    headers: { Authorization: auth, Accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) return null;
  return (await res.json()) as ClimaForecast;
}

function climaDoCache(dados: any, geocode: number): ClimaForecast | null {
  const gc = Number(geocode);
  const mapa = dados?.clima_municipios;
  const cached =
    mapa?.[gc] ?? mapa?.[String(gc)] ?? (dados?.clima?.geocode === gc ? dados.clima : null);
  return cached ?? null;
}

/** Clima atual + previsão 14d — prioriza backend autenticado e Open-Meteo ao vivo. */
export async function resolverClimaAtual(
  dados: any,
  geocode: number,
  opts: { auth?: string; contratoId?: number } = {},
): Promise<ClimaForecast> {
  const gc = Number(geocode);
  if (!gc) {
    return {
      fonte: 'Indisponível',
      cidade: '',
      lat: 0,
      lon: 0,
      atualizado_em: new Date().toISOString(),
      modo: 'previsao',
      atual: {
        temperatura_c: 0,
        umidade_pct: 0,
        precipitacao_mm: 0,
        condicao: '',
      },
      dias: [],
    };
  }

  if (opts.auth) {
    try {
      const upstream = await buscarClimaBackend(opts.auth, gc, opts.contratoId);
      if (upstream && (climaEhPrevisaoAtual(upstream) || upstream.dias?.length)) {
        return normalizarClimaForecast(upstream);
      }
    } catch {
      /* fallback abaixo */
    }
  }

  const coords = resolverCoordenadasMunicipio(dados, gc);
  if (coords) {
    try {
      return await buscarClimaOpenMeteo(coords);
    } catch {
      /* fallback cache */
    }
  }

  const cached = climaDoCache(dados, gc);
  if (cached) return normalizarClimaForecast(cached);

  return {
    fonte: 'Indisponível',
    cidade: coords?.cidade ?? `Município ${gc}`,
    geocode: gc,
    lat: coords?.lat ?? 0,
    lon: coords?.lon ?? 0,
    atualizado_em: new Date().toISOString(),
    modo: 'previsao',
    atual: {
      temperatura_c: 0,
      umidade_pct: 0,
      precipitacao_mm: 0,
      condicao: '',
    },
    dias: [],
  };
}
