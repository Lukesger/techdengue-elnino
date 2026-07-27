import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CacheService } from '../../../shared/services/cache.service';
import {
  ANO_FIM,
  ANO_INICIO,
  CACHE_KEYS,
  CACHE_TTL,
  ENDPOINTS,
  MESES,
  MunicipioFoco,
} from './constants';
import {
  round,
  validarCasos,
  validarPrecipitacao,
  validarTemperatura,
} from './formatacao';

export interface ClimaMensalMunicipio {
  geocode: number;
  municipio: string;
  Ano: number;
  MesNum: number;
  Mes: string;
  Temperatura: number;
  TempMax: number;
  Precipitacao: number;
  Umidade: number;
}

export interface DiaPrevisao {
  data: string;
  periodo: string;
  cidade: string;
  max_c: number;
  min_c: number;
  chuva_mm: number;
  umidade_pct: number;
  temp_media?: number | null;
  casos?: number | null;
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
  dias: DiaPrevisao[];
}

function formatarDataBR(iso: string): string {
  if (!iso) return '';
  const [, m, d] = String(iso).split('-');
  return d && m ? `${d}/${m}` : iso;
}

@Injectable()
export class OpenMeteoService {
  private readonly logger = new Logger(OpenMeteoService.name);

  constructor(
    private readonly http: HttpService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Busca clima histórico ao vivo (Open-Meteo Archive).
   * Uso restrito ao refresh/admin — leituras normais vêm do JSON local.
   */
  async buscarClimaHistoricoAoVivo(
    municipios: MunicipioFoco[],
    forceRefresh = false,
  ): Promise<ClimaMensalMunicipio[]> {
    const key = this.cache.generateKey(
      CACHE_KEYS.CLIMA_HISTORICO,
      municipios
        .map((m) => m.geocode)
        .sort((a, b) => a - b)
        .join('-'),
      ANO_INICIO,
      ANO_FIM,
    );
    if (!forceRefresh) {
      const cached = await this.cache.getAsync<ClimaMensalMunicipio[]>(key);
      if (cached?.length) return cached;
    }

    const linhas: ClimaMensalMunicipio[] = [];
    for (const mun of municipios) {
      try {
        const parte = await this.buscarHistoricoMunicipio(
          mun,
          ANO_INICIO,
          ANO_FIM,
        );
        linhas.push(...parte);
      } catch (err) {
        this.logger.warn(
          `Clima histórico indisponível para ${mun.municipio}: ${(err as Error).message}`,
        );
      }
    }

    if (linhas.length) {
      await this.cache.setAsync(key, linhas, CACHE_TTL.CLIMA_HISTORICO_MS);
    }
    return linhas;
  }

  /** @deprecated Use buscarClimaHistoricoAoVivo + ClimaHistoricoStoreService */
  async carregarClimaMunicipios(
    municipios: MunicipioFoco[],
    forceRefresh = false,
  ): Promise<ClimaMensalMunicipio[]> {
    return this.buscarClimaHistoricoAoVivo(municipios, forceRefresh);
  }

  async buscarPrevisaoMunicipio(
    mun: MunicipioFoco,
    forceRefresh = false,
  ): Promise<ClimaForecast> {
    const key = this.cache.generateKey(CACHE_KEYS.CLIMA_FORECAST, mun.geocode);
    if (!forceRefresh) {
      const cached = await this.cache.getAsync<ClimaForecast>(key);
      if (cached) return cached;
    }

    const res = await firstValueFrom(
      this.http.get(ENDPOINTS.OPEN_METEO_FORECAST, {
        params: {
          latitude: mun.lat,
          longitude: mun.lon,
          current:
            'temperature_2m,relative_humidity_2m,precipitation,weather_code',
          daily:
            'temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean',
          timezone: 'America/Sao_Paulo',
          forecast_days: 14,
        },
        timeout: 20000,
      }),
    );

    const dados = res.data ?? {};
    const atual = dados.current ?? {};
    const daily = dados.daily ?? {};
    const datas: string[] = daily.time ?? [];

    const payload: ClimaForecast = {
      fonte: 'Open-Meteo Forecast',
      cidade: mun.municipio,
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
        cidade: mun.municipio,
        max_c: validarTemperatura(daily.temperature_2m_max?.[i]),
        min_c: validarTemperatura(daily.temperature_2m_min?.[i]),
        chuva_mm: validarPrecipitacao(daily.precipitation_sum?.[i]),
        umidade_pct: validarCasos(daily.relative_humidity_2m_mean?.[i]),
      })),
    };

    await this.cache.setAsync(key, payload, CACHE_TTL.CLIMA_FORECAST_MS);
    return payload;
  }

  private async buscarHistoricoMunicipio(
    mun: MunicipioFoco,
    anoInicio: number,
    anoFim: number,
  ): Promise<ClimaMensalMunicipio[]> {
    const res = await firstValueFrom(
      this.http.get(ENDPOINTS.OPEN_METEO_ARCHIVE, {
        params: {
          latitude: mun.lat,
          longitude: mun.lon,
          start_date: `${anoInicio}-01-01`,
          end_date: `${anoFim}-12-31`,
          daily:
            'temperature_2m_mean,temperature_2m_max,precipitation_sum,relative_humidity_2m_mean',
          timezone: 'America/Sao_Paulo',
        },
        timeout: 45000,
      }),
    );

    const daily = res.data?.daily ?? {};
    const times: string[] = daily.time ?? [];
    const porMes = new Map<
      string,
      { temps: number[]; maxs: number[]; chuvas: number[]; umids: number[] }
    >();

    for (let i = 0; i < times.length; i += 1) {
      const [anoStr, mesStr] = times[i].split('-');
      const ano = Number(anoStr);
      const mes = Number(mesStr);
      const k = `${ano}-${mes}`;
      if (!porMes.has(k)) {
        porMes.set(k, { temps: [], maxs: [], chuvas: [], umids: [] });
      }
      const g = porMes.get(k)!;
      g.temps.push(validarTemperatura(daily.temperature_2m_mean?.[i]));
      g.maxs.push(validarTemperatura(daily.temperature_2m_max?.[i]));
      g.chuvas.push(validarPrecipitacao(daily.precipitation_sum?.[i]));
      g.umids.push(validarCasos(daily.relative_humidity_2m_mean?.[i]));
    }

    const linhas: ClimaMensalMunicipio[] = [];
    for (const [k, g] of porMes.entries()) {
      const [ano, mes] = k.split('-').map(Number);
      linhas.push({
        geocode: mun.geocode,
        municipio: mun.municipio,
        Ano: ano,
        MesNum: mes,
        Mes: MESES[mes - 1],
        Temperatura: round(
          g.temps.reduce((a, b) => a + b, 0) / g.temps.length,
          1,
        ),
        TempMax: round(g.maxs.reduce((a, b) => a + b, 0) / g.maxs.length, 1),
        Precipitacao: round(
          g.chuvas.reduce((a, b) => a + b, 0),
          1,
        ),
        Umidade: Math.round(
          g.umids.reduce((a, b) => a + b, 0) / g.umids.length,
        ),
      });
    }
    return linhas.sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum);
  }
}
