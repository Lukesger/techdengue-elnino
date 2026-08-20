import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as https from 'node:https';
import { CacheService } from '../../../shared/services/cache.service';
import {
  ANO_FIM,
  ANO_INICIO,
  ANO_ATUAL,
  CACHE_KEYS,
  CACHE_TTL,
  ENDPOINTS,
  OniIntensidade,
  ONI_PROJECAO_AMORT,
  ONI_PROJECAO_CAP,
  classificarONI,
} from './constants';
import { round } from './formatacao';

export interface OniMensal {
  ano: number;
  mes: number;
  oni: number;
}

export interface OniAnual {
  ano: number;
  oni_medio: number;
  oni_max: number;
  oni_min: number;
}

export interface OniPayload {
  fonte: string;
  atualizado_em: string;
  linhas: OniMensal[];
}

const SEAS_MEIO_MES: Record<string, number> = {
  DJF: 1,
  JFM: 2,
  FMA: 3,
  MAM: 4,
  AMJ: 5,
  MJJ: 6,
  JJA: 7,
  JAS: 8,
  ASO: 9,
  SON: 10,
  OND: 11,
  NDJ: 12,
};

@Injectable()
export class NoaaOniService {
  private readonly logger = new Logger(NoaaOniService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  async carregarOniMensal(forceRefresh = false): Promise<OniPayload> {
    if (!forceRefresh) {
      const cached = await this.cache.getAsync<OniPayload>(CACHE_KEYS.ONI);
      if (cached?.linhas?.length) return cached;
    }

    let linhas: OniMensal[] | null = null;
    let fonte = 'NOAA CPC (ONI ascii)';

    try {
      const texto = await this.fetchOniAscii();
      linhas = this.parseOniAscii(texto).filter(
        (r) => r.ano >= ANO_INICIO && r.ano <= ANO_FIM,
      );
    } catch (err) {
      if (this.isErroCertificadoSsl(err)) {
        this.logger.warn(
          'ONI ascii: falha SSL, tentando novamente sem verificação de certificado',
        );
        try {
          const texto = await this.fetchOniAscii(false);
          linhas = this.parseOniAscii(texto).filter(
            (r) => r.ano >= ANO_INICIO && r.ano <= ANO_FIM,
          );
        } catch (errSsl) {
          this.logger.debug(
            `ONI ascii indisponível após retry SSL: ${(errSsl as Error).message}`,
          );
        }
      } else {
        this.logger.debug(`ONI ascii indisponível: ${(err as Error).message}`);
      }
    }

    if (!linhas?.length) {
      const cdo = await this.buscarOniCdo(ANO_INICIO, ANO_FIM);
      if (cdo?.length) {
        linhas = cdo;
        fonte = 'NOAA CDO v2 (NINO34)';
      }
    }

    const payload: OniPayload = {
      fonte,
      atualizado_em: new Date().toISOString(),
      linhas: linhas ?? [],
    };

    if (payload.linhas.length) {
      await this.cache.setAsync(CACHE_KEYS.ONI, payload, CACHE_TTL.ONI_MS);
    }
    return payload;
  }

  /**
   * Classifica o valor ONI atual retornando intensidade + fator multiplicador.
   * Delega para a fun├º├úo pura `classificarONI` de constants.ts.
   */
  classificarIntensidade(oni: number | null | undefined): OniIntensidade {
    return classificarONI(oni);
  }

  /**
   * Extrapola linearmente os valores ONI para meses futuros sem dado real.
   * F├│rmula: oni_proj = oni_ultimo + delta ├ù meses_ahead ├ù AMORT (cap ┬▒2.5)
   * Retorna apenas os registros projetados (n├úo inclui os observados).
   */
  projetarONIFuturo(
    linhas: OniMensal[],
    anoAtual: number = ANO_ATUAL,
  ): OniMensal[] {
    if (!linhas.length) return [];
    const sorted = [...linhas].sort((a, b) => a.ano - b.ano || a.mes - b.mes);

    // Delta = varia├º├úo m├®dia dos ├║ltimos 3 meses
    const recentes = sorted.slice(-3);
    const ultimo = recentes.at(-1)!;
    let delta = 0;
    if (recentes.length >= 2) {
      delta = (ultimo.oni - recentes[0].oni) / (recentes.length - 1);
    }

    const existentes = new Set(sorted.map((r) => `${r.ano}-${r.mes}`));
    const extras: OniMensal[] = [];

    for (let mes = 1; mes <= 12; mes++) {
      if (existentes.has(`${anoAtual}-${mes}`)) continue;
      const mesesAhead = (anoAtual - ultimo.ano) * 12 + (mes - ultimo.mes);
      if (mesesAhead <= 0 || mesesAhead > 18) continue;
      let oniProj = ultimo.oni + delta * mesesAhead * ONI_PROJECAO_AMORT;
      oniProj = Math.min(oniProj, ONI_PROJECAO_CAP);
      oniProj = Math.max(oniProj, -ONI_PROJECAO_CAP);
      extras.push({ ano: anoAtual, mes, oni: round(oniProj, 2) });
    }
    return extras;
  }

  oniPorAno(linhas: OniMensal[]): OniAnual[] {
    const map = new Map<number, number[]>();
    for (const r of linhas) {
      if (!map.has(r.ano)) map.set(r.ano, []);
      map.get(r.ano)!.push(r.oni);
    }
    return Array.from(map.entries())
      .map(([ano, vals]) => ({
        ano,
        oni_medio:
          Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) /
          100,
        oni_max: Math.round(Math.max(...vals) * 100) / 100,
        oni_min: Math.round(Math.min(...vals) * 100) / 100,
      }))
      .sort((a, b) => a.ano - b.ano);
  }

  private isErroCertificadoSsl(err: unknown): boolean {
    const textos: string[] = [];
    const coletar = (valor: unknown, profundidade = 0): void => {
      if (valor == null || profundidade > 3) return;
      if (typeof valor === 'string') {
        textos.push(valor);
        return;
      }
      if (typeof valor !== 'object') return;
      const e = valor as {
        message?: string;
        code?: string;
        cause?: unknown;
      };
      if (e.message) textos.push(e.message);
      if (e.code) textos.push(e.code);
      if (e.cause) coletar(e.cause, profundidade + 1);
    };
    coletar(err);
    return /unable to verify the first certificate|self signed certificate|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(
      textos.join(' '),
    );
  }

  private async fetchOniAscii(rejectUnauthorized = true): Promise<string> {
    const res = await firstValueFrom(
      this.http.get<string>(ENDPOINTS.NOAA_ONI_TXT, {
        responseType: 'text' as never,
        timeout: 30000,
        httpsAgent: rejectUnauthorized
          ? undefined
          : new https.Agent({ rejectUnauthorized: false }),
      }),
    );
    return String(res.data ?? '');
  }

  private parseOniAscii(texto: string): OniMensal[] {
    const map = new Map<string, number[]>();
    for (const linha of texto.split(/\r?\n/)) {
      const parts = linha.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const seas = parts[0];
      const ano = Number(parts[1]);
      const anom = Number(parts[3]);
      const mes = SEAS_MEIO_MES[seas];
      if (
        !mes ||
        !Number.isFinite(ano) ||
        !Number.isFinite(anom) ||
        anom <= -90
      )
        continue;
      const k = `${ano}-${mes}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(anom);
    }
    return Array.from(map.entries())
      .map(([k, vals]) => {
        const [ano, mes] = k.split('-').map(Number);
        const oni =
          Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) /
          100;
        return { ano, mes, oni };
      })
      .sort((a, b) => a.ano - b.ano || a.mes - b.mes);
  }

  private async buscarOniCdo(
    anoInicio: number,
    anoFim: number,
  ): Promise<OniMensal[] | null> {
    const token = this.config.get<string>('NOAA_CDO_TOKEN') ?? '';
    if (!token) return null;
    try {
      const res = await firstValueFrom(
        this.http.get<{ results?: Array<{ date: string; value: number }> }>(
          `${ENDPOINTS.NOAA_CDO_BASE}/data`,
          {
            params: {
              datasetid: 'NINO34',
              datatypeid: 'ANOM',
              locationid: 'FIPS:US',
              startdate: `${anoInicio}-01-01`,
              enddate: `${anoFim}-12-31`,
              limit: 1000,
              units: 'metric',
            },
            headers: { token },
            timeout: 30000,
          },
        ),
      );
      const results = res.data?.results;
      if (!results?.length) return null;
      return results.map((r) => ({
        ano: Number(String(r.date).slice(0, 4)),
        mes: Number(String(r.date).slice(5, 7)),
        oni: Math.round(Number(r.value) * 100) / 100,
      }));
    } catch (err) {
      this.logger.debug(`NOAA CDO indisponível: ${(err as Error).message}`);
      return null;
    }
  }
}
