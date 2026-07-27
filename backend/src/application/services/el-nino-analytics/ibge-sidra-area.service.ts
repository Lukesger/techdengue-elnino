import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CacheService } from '../../../shared/services/cache.service';
import { CACHE_KEYS, CACHE_TTL } from './constants';

export interface IbgeAreaUrbanaRuralMunicipio {
  geocode: number;
  areaTotalKm2: number | null;
  areaUrbanaKm2: number | null;
  areaRuralKm2: number | null;
  areaTotalHa: number | null;
  areaUrbanaHa: number | null;
  areaRuralHa: number | null;
  fonte: string;
  periodo: string;
  aviso?: string;
}

type SidraRow = Record<string, string>;

const SIDRA_BASE = 'https://apisidra.ibge.gov.br/values';

function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseNumeroSidra(valor: unknown): number | null {
  if (valor == null) return null;
  const bruto = String(valor).trim();
  if (!bruto || bruto === '-' || bruto === '..' || bruto === 'X') return null;
  const normalizado = bruto.includes(',')
    ? bruto.replace(/\./g, '').replace(',', '.')
    : bruto;
  const n = Number(normalizado);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function rotulosLinhaSidra(row: SidraRow): string[] {
  return Object.entries(row)
    .filter(([chave]) => /N$/i.test(chave) && chave !== 'NN')
    .map(([, valor]) => normalizarTexto(String(valor ?? '')))
    .filter(Boolean);
}

function extrairValorPorRotulo(
  rows: SidraRow[] | null,
  matcher: (label: string) => boolean,
): number | null {
  if (!rows?.length) return null;
  for (const row of rows.slice(1)) {
    const rotulos = rotulosLinhaSidra(row);
    if (!rotulos.some(matcher)) continue;
    const valor = parseNumeroSidra(row.V);
    if (valor != null) return valor;
  }
  return null;
}

function extrairPrimeiroValor(rows: SidraRow[] | null): number | null {
  if (!rows?.length) return null;
  for (const row of rows.slice(1)) {
    const valor = parseNumeroSidra(row.V);
    if (valor != null) return valor;
  }
  return null;
}

@Injectable()
export class IbgeSidraAreaService {
  private readonly logger = new Logger(IbgeSidraAreaService.name);

  constructor(
    private readonly http: HttpService,
    private readonly cache: CacheService,
  ) {}

  async buscarAreasMunicipio(
    geocode: number,
  ): Promise<IbgeAreaUrbanaRuralMunicipio> {
    const cacheKey = `${CACHE_KEYS.IBGE_SIDRA_AREA}:${geocode}`;
    const cached =
      await this.cache.getAsync<IbgeAreaUrbanaRuralMunicipio>(cacheKey);
    if (cached) return cached;

    const [areaTotalKm2, areaUrbana8418Km2, popSidra] = await Promise.all([
      this.consultarSidra(`t/4714/n6/${geocode}/v/6318/p/2022`).then(
        extrairPrimeiroValor,
      ),
      this.consultarSidra(`t/8418/n6/${geocode}/v/all/p/2019`).then((rows) =>
        extrairValorPorRotulo(rows, (label) =>
          label.includes('total de areas urbanizadas'),
        ),
      ),
      this.consultarSidra(`t/9923/n6/${geocode}/v/93/p/2022/c1/all`),
    ]);

    const popUrbana =
      extrairValorPorRotulo(popSidra, (label) => label === 'urbana') ??
      extrairValorPorRotulo(popSidra, (label) => label.includes('urbana'));
    const popRural =
      extrairValorPorRotulo(popSidra, (label) => label === 'rural') ??
      extrairValorPorRotulo(popSidra, (label) => label.includes('rural'));
    const popTotal =
      extrairValorPorRotulo(popSidra, (label) => label === 'total') ??
      (popUrbana != null && popRural != null ? popUrbana + popRural : null);

    let areaUrbanaKm2 = areaUrbana8418Km2;
    let aviso: string | undefined;

    if (
      areaUrbanaKm2 == null &&
      areaTotalKm2 != null &&
      popUrbana &&
      popTotal
    ) {
      areaUrbanaKm2 = areaTotalKm2 * (popUrbana / popTotal);
      aviso =
        'Área urbana estimada pela proporção populacional do Censo 2022 (SIDRA 9923).';
    }

    let areaRuralKm2: number | null = null;
    if (areaTotalKm2 != null && areaUrbanaKm2 != null) {
      areaRuralKm2 = Math.max(0, areaTotalKm2 - areaUrbanaKm2);
    } else if (areaTotalKm2 != null && popRural && popTotal) {
      areaRuralKm2 = areaTotalKm2 * (popRural / popTotal);
      if (!aviso) {
        aviso =
          'Área rural estimada pela proporção populacional do Censo 2022 (SIDRA 9923).';
      }
    }

    const resultado: IbgeAreaUrbanaRuralMunicipio = {
      geocode,
      areaTotalKm2,
      areaUrbanaKm2,
      areaRuralKm2,
      areaTotalHa: areaTotalKm2 != null ? areaTotalKm2 * 100 : null,
      areaUrbanaHa: areaUrbanaKm2 != null ? areaUrbanaKm2 * 100 : null,
      areaRuralHa: areaRuralKm2 != null ? areaRuralKm2 * 100 : null,
      fonte: areaUrbana8418Km2
        ? 'IBGE SIDRA — tabela 4714 (área total) e 8418 (área urbanizada)'
        : 'IBGE SIDRA — tabela 4714 (área total) e 9923 (proporção urbana/rural)',
      periodo: areaUrbana8418Km2 ? '2019–2022' : '2022',
      aviso,
    };

    await this.cache.setAsync(
      cacheKey,
      resultado,
      CACHE_TTL.IBGE_SIDRA_AREA_MS,
    );
    return resultado;
  }

  private async consultarSidra(path: string): Promise<SidraRow[] | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<SidraRow[]>(`${SIDRA_BASE}/${path}`, {
          timeout: 45000,
        }),
      );
      return Array.isArray(res.data) ? res.data : null;
    } catch (err) {
      this.logger.warn(
        `SIDRA indisponível (${path}): ${(err as Error).message}`,
      );
      return null;
    }
  }
}
