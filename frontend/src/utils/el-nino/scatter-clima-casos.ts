import { SerieMensal } from '@/services/el-nino-api';
import { lerAnoMesLinha, lerPrecipitacao, lerTemperatura } from './graficos-filtros';
import { MESES } from './constants';

/** Mês só tem clima real quando temperatura, umidade ou precipitação > 0. */
function climaPresenteLinha(r: Record<string, unknown>): boolean {
  const temp = lerTemperatura(r);
  const precip = lerPrecipitacao(r);
  const umid = Number(r.Umidade ?? r.umidade ?? r.umidade_pct ?? 0);
  return temp > 0 || precip > 0 || (Number.isFinite(umid) && umid > 0);
}

export interface ScatterPonto {
  precip: number;
  casos: number;
  elNino: boolean;
  rotulo: string;
  ano: number;
  mesNum: number;
}

/** Pontos chuva × casos para scatter, com flag El Niño. */
export function montarScatterChuvaCasos(
  serie: SerieMensal[] | Array<Record<string, unknown>> | null | undefined,
): ScatterPonto[] {
  const out: ScatterPonto[] = [];

  for (const row of serie ?? []) {
    const r = row as Record<string, unknown>;
    const par = lerAnoMesLinha(r);
    if (!par) continue;
    // Ignora meses sem clima real (precip 0 fabricada por ausência de ERA5/Open-Meteo).
    if (!climaPresenteLinha(r)) continue;
    const precip = lerPrecipitacao(r);
    const casos = Number(
      (row as SerieMensal).CasosDengue ?? r.casos_dengue ?? 0,
    );
    if (!Number.isFinite(precip) || precip < 0) continue;
    if (!Number.isFinite(casos) || casos < 0) continue;

    const oniRaw = r.ONI;
    const oni =
      oniRaw != null && oniRaw !== '' && Number.isFinite(Number(oniRaw))
        ? Number(oniRaw)
        : null;
    const elNino =
      Number(r.ElNino ?? (oni != null && oni >= 0.5 ? 1 : 0)) === 1;

    out.push({
      precip,
      casos,
      elNino,
      rotulo: `${MESES[par.mesNum - 1]}/${par.ano}`,
      ano: par.ano,
      mesNum: par.mesNum,
    });
  }

  return out;
}
