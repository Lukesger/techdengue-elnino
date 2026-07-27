import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CacheService } from '../../../shared/services/cache.service';
import {
  CACHE_KEYS,
  CACHE_TTL,
  ENDPOINTS,
  MUNICIPIOS_ELNINO,
  MunicipioFoco,
} from './constants';

const OPEN_METEO_GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';

export interface MunicipioIbge {
  geocode: number;
  municipio: string;
  uf: string;
}

export interface MunicipioFocoValidado extends MunicipioFoco {
  municipio_ibge: string;
  validado: boolean;
}

interface GeocodingHit {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country_code?: string;
  population?: number;
}

interface GeoJsonFeature {
  type: string;
  id?: string | number;
  properties?: { codarea?: string; [k: string]: unknown };
  geometry?: unknown;
}

export interface GeoJson {
  type: string;
  features: GeoJsonFeature[];
}

@Injectable()
export class IbgeMgService {
  private readonly logger = new Logger(IbgeMgService.name);

  constructor(
    private readonly http: HttpService,
    private readonly cache: CacheService,
  ) {}

  async listarMunicipiosMg(forceRefresh = false): Promise<MunicipioIbge[]> {
    if (!forceRefresh) {
      const cached = await this.cache.getAsync<MunicipioIbge[]>(
        CACHE_KEYS.IBGE_MUNICIPIOS,
      );
      if (cached?.length) return cached;
    }
    try {
      const res = await firstValueFrom(
        this.http.get<
          Array<{
            id: number;
            nome: string;
            microrregiao?: { mesorregiao?: { UF?: { sigla?: string } } };
          }>
        >(ENDPOINTS.IBGE_MUNICIPIOS_MG, {
          params: { orderBy: 'nome' },
          timeout: 30000,
        }),
      );
      const dados = (res.data ?? []).map((m) => ({
        geocode: m.id,
        municipio: m.nome,
        uf: m.microrregiao?.mesorregiao?.UF?.sigla ?? 'MG',
      }));
      if (dados.length) {
        await this.cache.setAsync(
          CACHE_KEYS.IBGE_MUNICIPIOS,
          dados,
          CACHE_TTL.IBGE_MUNICIPIOS_MS,
        );
      }
      return dados;
    } catch (err) {
      this.logger.warn(
        `IBGE Localidades indisponível: ${(err as Error).message}`,
      );
      return [];
    }
  }

  async validarMunicipiosFoco(
    geocodes: number[] = MUNICIPIOS_ELNINO.map((m) => m.geocode),
  ): Promise<MunicipioFocoValidado[]> {
    const todos = await this.listarMunicipiosMg();
    const nomeMap = new Map(todos.map((m) => [m.geocode, m.municipio]));
    const seedMap = new Map(MUNICIPIOS_ELNINO.map((m) => [m.geocode, m]));
    const bulkMode = geocodes.length > 20;

    const resolvidos: MunicipioFocoValidado[] = [];
    for (const geocode of geocodes) {
      const seed = seedMap.get(geocode);
      const nomeIbge = nomeMap.get(geocode);
      const validado = nomeMap.has(geocode);

      if (seed) {
        resolvidos.push({
          ...seed,
          municipio_ibge: nomeIbge ?? seed.municipio,
          validado,
        });
        continue;
      }

      if (!nomeIbge) {
        this.logger.debug(
          `Geocode ${geocode} não encontrado no IBGE — ignorado.`,
        );
        continue;
      }

      if (bulkMode) {
        resolvidos.push({
          geocode,
          municipio: nomeIbge,
          lat: -18.5,
          lon: -44.5,
          municipio_ibge: nomeIbge,
          validado,
        });
        continue;
      }

      const coords = await this.obterCoordenadas(geocode, nomeIbge);
      resolvidos.push({
        geocode,
        municipio: nomeIbge,
        lat: coords.lat,
        lon: coords.lon,
        municipio_ibge: nomeIbge,
        validado,
      });
    }
    return resolvidos;
  }

  /**
   * Resolve lat/lon para um geocode IBGE que não está na lista hardcoded.
   * Usa o Open-Meteo Geocoding com cache de 30 dias.
   */
  async obterCoordenadas(
    geocode: number,
    nome: string,
  ): Promise<{ lat: number; lon: number }> {
    const seed = MUNICIPIOS_ELNINO.find((m) => m.geocode === geocode);
    if (seed) return { lat: seed.lat, lon: seed.lon };

    const cacheKey = this.cache.generateKey('elnino:coords', geocode);
    const cached = await this.cache.getAsync<{ lat: number; lon: number }>(
      cacheKey,
    );
    if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lon)) {
      return cached;
    }

    try {
      const res = await firstValueFrom(
        this.http.get<{ results?: GeocodingHit[] }>(OPEN_METEO_GEOCODING, {
          params: {
            name: nome,
            count: 5,
            language: 'pt',
            countryCode: 'BR',
          },
          timeout: 15000,
        }),
      );
      const hits = res.data?.results ?? [];
      const mg = hits.find((h) =>
        (h.admin1 ?? '').toLowerCase().includes('minas gerais'),
      );
      const escolhido = mg ?? hits[0];
      if (escolhido?.latitude && escolhido?.longitude) {
        const coords = {
          lat: Number(escolhido.latitude),
          lon: Number(escolhido.longitude),
        };
        await this.cache.setAsync(cacheKey, coords, 30 * 24 * 60 * 60 * 1000);
        return coords;
      }
    } catch (err) {
      this.logger.warn(
        `Geocoding falhou para ${nome} (${geocode}): ${(err as Error).message}`,
      );
    }
    // Fallback: centro aproximado de MG (não ideal, mas evita exception)
    return { lat: -18.5, lon: -44.5 };
  }

  /**
   * Resolve lista completa de municípios foco com lat/lon a partir dos geocodes.
   * É o que o pipeline usa para chamar Open-Meteo.
   */
  async resolverMunicipiosFoco(geocodes: number[]): Promise<MunicipioFoco[]> {
    const validados = await this.validarMunicipiosFoco(geocodes);
    return validados.map((v) => ({
      geocode: v.geocode,
      municipio: v.municipio_ibge,
      lat: v.lat,
      lon: v.lon,
    }));
  }

  async carregarMalhaMg(forceRefresh = false): Promise<GeoJson | null> {
    if (!forceRefresh) {
      const cached = await this.cache.getAsync<GeoJson>(CACHE_KEYS.IBGE_MALHA);
      if (cached?.features?.length) return cached;
    }
    try {
      const res = await firstValueFrom(
        this.http.get<GeoJson>(ENDPOINTS.IBGE_MALHA_MG, {
          params: {
            formato: 'application/vnd.geo+json',
            qualidade: 'minima',
            intrarregiao: 'municipio',
          },
          timeout: 90000,
        }),
      );
      const malha = res.data ?? null;
      if (malha?.features?.length) {
        await this.cache.setAsync(
          CACHE_KEYS.IBGE_MALHA,
          malha,
          CACHE_TTL.IBGE_MALHA_MS,
        );
      }
      return malha;
    } catch (err) {
      this.logger.warn(`IBGE Malha MG indisponível: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Busca polígonos IBGE só dos geocodes pedidos (endpoint por município).
   * Preferível ao download de MG inteiro quando o escopo é pequeno.
   */
  async carregarMalhaPorGeocodes(
    geocodes: number[],
    forceRefresh = false,
  ): Promise<GeoJson | null> {
    const unicos = [...new Set(geocodes.map((g) => Number(g)).filter(Boolean))];
    if (!unicos.length) return null;

    if (unicos.length > 40) {
      const malha = await this.carregarMalhaMg(forceRefresh);
      return this.filtrarMalhaFoco(malha, unicos);
    }

    const features: GeoJsonFeature[] = [];
    await Promise.all(
      unicos.map(async (gc) => {
        const cacheKey = `${CACHE_KEYS.IBGE_MALHA}:${gc}`;
        if (!forceRefresh) {
          const cached = await this.cache.getAsync<GeoJsonFeature>(cacheKey);
          if (cached?.geometry) {
            features.push(cached);
            return;
          }
        }
        try {
          const res = await firstValueFrom(
            this.http.get<GeoJson>(`${ENDPOINTS.IBGE_MALHA_MUNICIPIO}/${gc}`, {
              params: {
                formato: 'application/vnd.geo+json',
                qualidade: 'minima',
              },
              timeout: 30000,
            }),
          );
          const feat = res.data?.features?.[0];
          if (!feat?.geometry) return;
          const normalizada: GeoJsonFeature = {
            ...feat,
            id: gc,
            properties: {
              ...(feat.properties ?? {}),
              codarea: String(gc),
              geocode: gc,
            },
          };
          features.push(normalizada);
          await this.cache.setAsync(
            cacheKey,
            normalizada,
            CACHE_TTL.IBGE_MALHA_MS,
          );
        } catch (err) {
          this.logger.warn(
            `IBGE malha ${gc} falhou: ${(err as Error).message}`,
          );
        }
      }),
    );

    if (!features.length) return null;
    return { type: 'FeatureCollection', features };
  }

  filtrarMalhaFoco(
    geojson: GeoJson | null,
    geocodes: number[],
  ): GeoJson | null {
    if (!geojson?.features) return geojson;
    const alvo = new Set(geocodes.map((g) => String(g)));
    return {
      ...geojson,
      features: geojson.features.filter((f) =>
        alvo.has(
          String(f.properties?.codarea ?? f.properties?.geocode ?? f.id ?? ''),
        ),
      ),
    };
  }
}
