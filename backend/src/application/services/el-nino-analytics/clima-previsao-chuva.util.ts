import {
  round,
  validarCasos,
  validarPrecipitacao,
  validarTemperatura,
} from './formatacao';
import { ClimaForecast, DiaPrevisao } from './open-meteo.service';

const ROTULO_MENSAL = /^[A-Za-zÀ-ÿ]{3}\/\d{2,4}$/;
const DIAS_POR_MES = 30;
const SEMANAS_POR_MES = 4.3;

export type GranularidadeClima = 'diario' | 'mensal';

export interface AnalisePrevisaoChuva {
  chuva3: number;
  chuva7: number;
  chuva14: number;
  diasChuva: number;
  diasChuvaFortes: number;
  maxSeqChuva: number;
  maiorDia: { mm: number; rotulo: string };
  umidMedia7: number;
  rotuloChuva3d: string;
  granularidade: GranularidadeClima;
}

type ClimaMeta = Pick<ClimaForecast, 'fonte' | 'modo' | 'atual'>;

export function isClimaGranularidadeMensal(
  dias: DiaPrevisao[],
  clima?: ClimaMeta,
): boolean {
  if (clima?.atual?.condicao?.toLowerCase().includes('mensal')) return true;
  if (clima?.fonte?.includes('ERA5')) return true;
  if (clima?.modo === 'historico') return true;

  const amostra = (dias ?? []).slice(0, 7);
  if (!amostra.length) return false;

  const rotulosMensais = amostra.filter((d) =>
    ROTULO_MENSAL.test((d.periodo || '').trim()),
  ).length;
  if (rotulosMensais >= Math.min(3, amostra.length)) return true;

  const precipSuspeita = amostra.filter(
    (d) => validarPrecipitacao(d.chuva_mm) > 80,
  ).length;
  return precipSuspeita >= 2 && rotulosMensais >= 1;
}

export function analisarPrevisaoChuva(
  dias: DiaPrevisao[],
  clima?: ClimaMeta,
): AnalisePrevisaoChuva {
  const fatia = (dias ?? []).slice(0, 14);
  const mensal = isClimaGranularidadeMensal(fatia, clima);

  if (mensal) {
    const recentes = fatia.slice(-3);
    const ultimo = fatia.at(-1) ?? fatia[0];
    const mmMes = validarPrecipitacao(ultimo?.chuva_mm ?? 0);
    const rotuloMes = ultimo?.periodo || ultimo?.data || '';
    const mesAnterior =
      fatia.length >= 2 ? validarPrecipitacao(fatia.at(-2)!.chuva_mm) : 0;

    return {
      chuva3: round((mmMes * 3) / DIAS_POR_MES, 1),
      chuva7: round(mmMes / SEMANAS_POR_MES, 1),
      chuva14: round((mmMes + mesAnterior) / (SEMANAS_POR_MES * 2), 1),
      diasChuva: mmMes >= 5 ? 1 : 0,
      diasChuvaFortes: mmMes >= 80 ? 1 : 0,
      maxSeqChuva: 0,
      maiorDia: { mm: mmMes, rotulo: rotuloMes },
      umidMedia7: recentes.length
        ? Math.round(
            recentes.reduce((s, d) => s + validarCasos(d.umidade_pct), 0) /
              recentes.length,
          )
        : 0,
      rotuloChuva3d: rotuloMes,
      granularidade: 'mensal',
    };
  }

  const soma = (n: number) =>
    round(
      fatia
        .slice(0, n)
        .reduce((s, d) => s + validarPrecipitacao(d.chuva_mm), 0),
      1,
    );

  const diario = fatia.map((d) => ({
    mm: validarPrecipitacao(d.chuva_mm),
    rotulo: d.periodo || d.data || '',
  }));

  const diasChuva = diario.filter((d) => d.mm >= 1);
  const diasChuvaFortes = diario.filter((d) => d.mm >= 10);
  let maxSeq = 0;
  let seq = 0;
  for (const d of diario.slice(0, 7)) {
    if (d.mm >= 1) {
      seq += 1;
      maxSeq = Math.max(maxSeq, seq);
    } else {
      seq = 0;
    }
  }

  const maiorDia = diario
    .slice(0, 7)
    .reduce((m, d) => (d.mm > m.mm ? d : m), { mm: 0, rotulo: '' });
  const umidMedia7 = fatia.slice(0, 7).length
    ? Math.round(
        fatia.slice(0, 7).reduce((s, d) => s + validarCasos(d.umidade_pct), 0) /
          Math.min(7, fatia.length),
      )
    : 0;

  return {
    chuva3: soma(3),
    chuva7: soma(7),
    chuva14: soma(14),
    diasChuva: diasChuva.length,
    diasChuvaFortes: diasChuvaFortes.length,
    maxSeqChuva: maxSeq,
    maiorDia,
    umidMedia7,
    rotuloChuva3d: diario
      .slice(0, 3)
      .filter((d) => d.mm >= 1)
      .map((d) => d.rotulo)
      .join(', '),
    granularidade: 'diario',
  };
}

export function detectarOndaCalor(dias: DiaPrevisao[], clima?: ClimaMeta) {
  const mensal = isClimaGranularidadeMensal(dias, clima);
  const janela = mensal ? dias.slice(-3) : dias.slice(0, 7);
  const maxs = janela.map((d) => validarTemperatura(d.max_c));
  const diasQuentes = maxs.filter((t) => t >= 32).length;
  const media = maxs.length ? maxs.reduce((a, b) => a + b, 0) / maxs.length : 0;
  return {
    diasQuentes,
    tempMax: maxs.length ? Math.max(...maxs) : 0,
    tempMedia: round(media, 1),
  };
}

export function rotuloChuvaCurta(chuva: AnalisePrevisaoChuva): string {
  return chuva.granularidade === 'mensal' ? 'mm/semana (estim. ERA5)' : 'mm/7d';
}

export function rotuloPeriodo7d(chuva: AnalisePrevisaoChuva): string {
  return chuva.granularidade === 'mensal'
    ? 'na semana (estim. ERA5)'
    : 'em 7 dias';
}

export function rotuloPeriodo3d(chuva: AnalisePrevisaoChuva): string {
  return chuva.granularidade === 'mensal'
    ? 'em 3 dias (estim. proporcional ao mês ERA5)'
    : 'em 3 dias';
}
