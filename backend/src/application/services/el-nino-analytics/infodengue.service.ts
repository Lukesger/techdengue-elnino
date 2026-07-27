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
import { validarCasos } from './formatacao';

export interface CasoMensalMunicipio {
  geocode: number;
  municipio: string;
  Ano: number;
  MesNum: number;
  Mes: string;
  AnoMes: string;
  casos_estimados: number;
  casos_notificados: number;
}

export interface AlertaInfodengue {
  geocode: number;
  semana_epi: string;
  nivel_alerta: number;
  casos_est: number;
  incidencia: number;
  umidade: number;
  temp_med: number;
  fonte: string;
}

interface RegistroSemanal {
  SE?: string | number;
  data_iniSE?: string | number;
  casos_est?: number;
  casos?: number;
  nivel?: number;
  incidencia?: number;
  umidademed?: number;
  tempmed?: number;
}

function anoMesDeSemana(reg: RegistroSemanal): [number, number] | null {
  const ts = reg.data_iniSE;
  if (ts) {
    try {
      const dt = new Date(Number(ts));
      if (Number.isFinite(dt.getTime())) {
        return [dt.getUTCFullYear(), dt.getUTCMonth() + 1];
      }
    } catch {
      /* skip */
    }
  }
  const se = String(reg.SE ?? '');
  if (se.length >= 6) {
    const ano = Number(se.slice(0, 4));
    const semana = Number(se.slice(4));
    const jan4 = new Date(Date.UTC(ano, 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (semana - 1) * 7);
    return [monday.getUTCFullYear(), monday.getUTCMonth() + 1];
  }
  return null;
}

@Injectable()
export class InfodengueService {
  private readonly logger = new Logger(InfodengueService.name);

  constructor(
    private readonly http: HttpService,
    private readonly cache: CacheService,
  ) {}

  async carregarCasosMensais(
    municipios: MunicipioFoco[],
    forceRefresh = false,
  ): Promise<CasoMensalMunicipio[]> {
    const geocodeHash = municipios
      .map((m) => m.geocode)
      .sort((a, b) => a - b)
      .join('-');
    const key = this.cache.generateKey(
      CACHE_KEYS.CASOS_MENSAIS,
      geocodeHash,
      ANO_INICIO,
      ANO_FIM,
    );
    if (!forceRefresh) {
      const cached = await this.cache.getAsync<CasoMensalMunicipio[]>(key);
      if (cached?.length) return cached;
    }

    const linhas: CasoMensalMunicipio[] = [];
    const concorrencia = municipios.length > 20 ? 12 : 4;

    const blocos = await this.mapComConcorrencia(
      municipios,
      async (mun) => {
        try {
          const semanas = await this.buscarSemanas(
            mun.geocode,
            ANO_INICIO,
            ANO_FIM,
          );
          if (!Array.isArray(semanas)) return [] as CasoMensalMunicipio[];
          const mensal = this.agregarSemanasMensal(semanas);
          const parciais: CasoMensalMunicipio[] = [];
          for (const [k, vals] of mensal.entries()) {
            const [ano, mes] = k.split('-').map(Number);
            if (ano < ANO_INICIO || ano > ANO_FIM) continue;
            parciais.push({
              geocode: mun.geocode,
              municipio: mun.municipio,
              Ano: ano,
              MesNum: mes,
              Mes: MESES[mes - 1],
              AnoMes: `${ano}-${String(mes).padStart(2, '0')}`,
              casos_estimados: vals.casos_est,
              casos_notificados: vals.casos,
            });
          }
          return parciais;
        } catch (err) {
          this.logger.warn(
            `Infodengue indisponível para ${mun.municipio} (${mun.geocode}): ${(err as Error).message}`,
          );
          return [] as CasoMensalMunicipio[];
        }
      },
      concorrencia,
    );
    for (const bloco of blocos) linhas.push(...bloco);

    linhas.sort(
      (a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum || a.geocode - b.geocode,
    );
    if (linhas.length) {
      await this.cache.setAsync(key, linhas, CACHE_TTL.CASOS_MENSAIS_MS);
    }
    return linhas;
  }

  async buscarAlertasRecentes(
    geocodes: number[],
    ano?: number,
    forceRefresh = false,
  ): Promise<AlertaInfodengue[]> {
    const ey = ano || new Date().getFullYear();
    const key = this.cache.generateKey(
      CACHE_KEYS.ALERTAS_INFODENGUE,
      geocodes.join('-'),
      ey,
    );
    if (!forceRefresh) {
      const cached = await this.cache.getAsync<AlertaInfodengue[]>(key);
      if (cached) return cached;
    }

    const linhas: AlertaInfodengue[] = [];
    const concorrencia = geocodes.length > 20 ? 12 : 4;
    const blocos = await this.mapComConcorrencia(
      geocodes,
      async (geocode) => {
        try {
          const semanas = await this.buscarSemanas(geocode, ey, ey, 40, 53);
          if (!Array.isArray(semanas) || !semanas.length) return null;
          const ultima = semanas.reduce((a, b) =>
            Number(a.SE ?? 0) > Number(b.SE ?? 0) ? a : b,
          );
          return {
            geocode,
            semana_epi: String(ultima.SE ?? ''),
            nivel_alerta: Number(ultima.nivel ?? 0),
            casos_est: validarCasos(ultima.casos_est),
            incidencia: Number(ultima.incidencia ?? 0),
            umidade: Number(ultima.umidademed ?? 0),
            temp_med: Number(ultima.tempmed ?? 0),
            fonte: 'Infodengue AlertCity',
          } satisfies AlertaInfodengue;
        } catch (err) {
          this.logger.debug(`Alerta ${geocode}: ${(err as Error).message}`);
          return null;
        }
      },
      concorrencia,
    );
    for (const hit of blocos) {
      if (hit) linhas.push(hit);
    }

    await this.cache.setAsync(key, linhas, CACHE_TTL.ALERTAS_INFODENGUE_MS);
    return linhas;
  }

  private async buscarSemanas(
    geocode: number,
    eyStart: number,
    eyEnd: number,
    ewStart = 1,
    ewEnd = 53,
  ): Promise<RegistroSemanal[]> {
    const res = await firstValueFrom(
      this.http.get<RegistroSemanal[]>(ENDPOINTS.ALERTCITY, {
        params: {
          geocode,
          disease: 'dengue',
          format: 'json',
          ew_start: ewStart,
          ew_end: ewEnd,
          ey_start: eyStart,
          ey_end: eyEnd,
        },
        timeout: 30000,
      }),
    );
    return Array.isArray(res.data) ? res.data : [];
  }

  private agregarSemanasMensal(
    semanas: RegistroSemanal[],
  ): Map<string, { casos_est: number; casos: number }> {
    const map = new Map<string, { casos_est: number; casos: number }>();
    for (const reg of semanas) {
      const chave = anoMesDeSemana(reg);
      if (!chave) continue;
      const k = chave.join('-');
      if (!map.has(k)) map.set(k, { casos_est: 0, casos: 0 });
      const g = map.get(k)!;
      g.casos_est += validarCasos(reg.casos_est);
      g.casos += validarCasos(reg.casos);
    }
    return map;
  }

  /** Executa promises em lotes com limite de concorrência. */
  private async mapComConcorrencia<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concorrencia = 8,
  ): Promise<R[]> {
    if (!items.length) return [];
    const resultados: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(concorrencia, items.length) },
      async () => {
        while (cursor < items.length) {
          const i = cursor++;
          resultados[i] = await fn(items[i]);
        }
      },
    );
    await Promise.all(workers);
    return resultados;
  }
}
