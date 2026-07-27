import { SerieMensal } from '@/services/el-nino-api';
import { lerAnoMesLinha } from './graficos-filtros';
import { MESES } from './constants';

export interface HeatmapCelula {
  ano: number;
  mesNum: number;
  mes: string;
  casos: number;
}

export interface HeatmapMatriz {
  anos: number[];
  meses: string[];
  /** chave `${ano}-${mesNum}` → casos */
  celulas: Map<string, number>;
  maxCasos: number;
  minCasos: number;
}

export function chaveHeatmap(ano: number, mesNum: number): string {
  return `${ano}-${mesNum}`;
}

/** Monta matriz mês × ano a partir da série mensal filtrada. */
export function montarHeatmapCasos(
  serie: SerieMensal[] | Array<Record<string, unknown>> | null | undefined,
): HeatmapMatriz {
  const celulas = new Map<string, number>();
  const anosSet = new Set<number>();

  for (const row of serie ?? []) {
    const par = lerAnoMesLinha(row as Record<string, unknown>);
    if (!par) continue;
    const casos = Number(
      (row as SerieMensal).CasosDengue ??
        (row as Record<string, unknown>).casos_dengue ??
        0,
    );
    if (!Number.isFinite(casos)) continue;
    anosSet.add(par.ano);
    const k = chaveHeatmap(par.ano, par.mesNum);
    celulas.set(k, (celulas.get(k) ?? 0) + casos);
  }

  const anos = [...anosSet].sort((a, b) => a - b);
  const vals = [...celulas.values()];
  return {
    anos,
    meses: [...MESES],
    celulas,
    maxCasos: vals.length ? Math.max(...vals) : 0,
    minCasos: vals.length ? Math.min(...vals) : 0,
  };
}

/** Intensidade 0–1 para coloração (laranja). */
export function intensidadeHeatmap(
  casos: number,
  maxCasos: number,
): number {
  if (maxCasos <= 0) return 0;
  return Math.min(1, casos / maxCasos);
}

export function corHeatmap(intensidade: number): string {
  if (intensidade <= 0) return '#fff7ed';
  if (intensidade < 0.25) return '#fed7aa';
  if (intensidade < 0.5) return '#fb923c';
  if (intensidade < 0.75) return '#ea580c';
  return '#c2410c';
}
