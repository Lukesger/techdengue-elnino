import { Injectable } from '@nestjs/common';
import { NOMES_ELNINO } from './constants';
import { round, validarCasos, validarTemperatura } from './formatacao';
import {
  analisarPrevisaoChuva,
  detectarOndaCalor,
  rotuloChuvaCurta,
  rotuloPeriodo3d,
  rotuloPeriodo7d,
} from './clima-previsao-chuva.util';
import { AlertaInfodengue } from './infodengue.service';
import { ClimaForecast } from './open-meteo.service';
import { InmetAlerta } from './inmet-wis2.service';

export type NivelAlerta = 'alto' | 'medio' | 'baixo';

export interface AlertaPreditivo {
  categoria:
    | 'chuva'
    | 'previsao_clima'
    | 'onda_calor'
    | 'umidade'
    | 'dengue'
    | 'elnino'
    | 'inmet';
  prioridade: number;
  nivel: NivelAlerta;
  titulo: string;
  descricao: string;
  causa?: string;
  acao?: string;
  /** geocode do munic├¡pio associado (null = regional) */
  geocode?: number | null;
  /** fonte do alerta */
  fonte?: string;
}

export interface SerieMensal {
  Ano: number;
  MesNum: number;
  Mes: string;
  AnoMes: string;
  Temperatura: number;
  Precipitacao: number;
  Umidade: number;
  ONI: number | null;
  TipoElNino: string;
  ElNino: number;
  CasosDengue: number;
}

export interface MensalMunicipio extends SerieMensal {
  geocode: number;
  municipio: string;
  TempMax: number;
  casos_notificados: number;
}

const ACAO_INFODENGUE_VETORIAL =
  'Compare os alertas Infodengue (AlertCity) com a previsão climática. Reforce controle vetorial: busca ativa de criadores, eliminação de água parada em até 48 h após chuvas, nebulização e visita domiciliar nas áreas de maior incidência.';

export const CAUSA_DENGUE = {
  titulo: 'Porque o El Niño e o clima influenciam na dengue?',
  pontos: [
    'O Aedes aegypti completa o ciclo larval mais rápido com temperaturas entre 26–32 °C e umidade acima de 60 %.',
    'Chuvas acima da média enchem recipientes e criam criadouros; pós-chuva é o período crítico para eliminação.',
    'Ondas de calor (máximas >= 32 °C por vários dias) aumentam picadas e aceleram a transmissão viral.',
    'Em anos El Niño (ONI >= +0,5), o Sudeste tende a ficar mais quente e com chuvas irregulares — padrão associado a surtos históricos de dengue.',
    'A combinação calor + umidade + água parada explica a maior parte do crescimento de casos observado nos municípios foco.',
  ],
};

function mediaHistoricaMes(
  mensal: MensalMunicipio[],
  mesNum: number,
  geocode: number | 'todos',
): number | null {
  const fatia = mensal.filter(
    (r) =>
      r.MesNum === mesNum && (geocode === 'todos' || r.geocode === geocode),
  );
  if (!fatia.length) return null;
  return Math.round(
    fatia.reduce((s, r) => s + r.CasosDengue, 0) / fatia.length,
  );
}

function mediaChuvaHistoricaMes(
  mensal: MensalMunicipio[],
  mesNum: number,
  geocode: number | 'todos',
): number | null {
  const fatia = mensal.filter(
    (r) =>
      r.MesNum === mesNum && (geocode === 'todos' || r.geocode === geocode),
  );
  if (!fatia.length) return null;
  return round(fatia.reduce((s, r) => s + r.Precipitacao, 0) / fatia.length, 1);
}

function mediaUmidadeHistoricaMes(
  mensal: MensalMunicipio[],
  mesNum: number,
  geocode: number | 'todos',
): number | null {
  const fatia = mensal.filter(
    (r) =>
      r.MesNum === mesNum && (geocode === 'todos' || r.geocode === geocode),
  );
  if (!fatia.length) return null;
  return Math.round(
    fatia.reduce((s, r) => s + (r.Umidade || 0), 0) / fatia.length,
  );
}

function ordenarAlertas(alertas: AlertaPreditivo[]): AlertaPreditivo[] {
  const ordem: Record<NivelAlerta, number> = { alto: 0, medio: 1, baixo: 2 };
  return [...alertas].sort(
    (a, b) =>
      (a.prioridade ?? 9) - (b.prioridade ?? 9) ||
      ordem[a.nivel] - ordem[b.nivel],
  );
}

@Injectable()
export class ElNinoAlertasService {
  gerarAlertas(
    clima: ClimaForecast | undefined,
    serie: SerieMensal[],
    mensal: MensalMunicipio[],
    alertasApi: AlertaInfodengue[],
    geocodeFoco: number | 'todos',
    rotuloLocal = '',
    alertasInmet: InmetAlerta[] = [],
  ): AlertaPreditivo[] {
    const alertas: AlertaPreditivo[] = [];
    const dias = clima?.dias ?? [];
    const atual = clima?.atual ?? {
      temperatura_c: 0,
      umidade_pct: 0,
      precipitacao_mm: 0,
      condicao: '',
    };
    const temp = validarTemperatura(atual.temperatura_c);
    const umid = validarCasos(atual.umidade_pct);
    const calor = detectarOndaCalor(dias, clima);
    const chuva = analisarPrevisaoChuva(dias, clima);
    const prefixo = rotuloLocal ? `${rotuloLocal}: ` : '';
    const apiFiltrada =
      geocodeFoco === 'todos'
        ? alertasApi
        : alertasApi.filter((a) => a.geocode === geocodeFoco);

    const mesAtual = new Date().getMonth() + 1;
    const mediaChuvaMes = mediaChuvaHistoricaMes(mensal, mesAtual, geocodeFoco);
    const mediaUmidMes = mediaUmidadeHistoricaMes(
      mensal,
      mesAtual,
      geocodeFoco,
    );
    const chuvaSemanalHistorica =
      mediaChuvaMes != null ? round(mediaChuvaMes / 4, 1) : null;

    // Chuva 3 dias
    if (chuva.chuva3 >= 15 || chuva.maiorDia.mm >= 20) {
      alertas.push({
        categoria: 'chuva',
        prioridade: 1,
        nivel: 'alto',
        titulo: `${prefixo}Chuva intensa iminente (48–72 h)`,
        descricao: `Previsão de ~${chuva.chuva3} mm ${rotuloPeriodo3d(chuva)}${
          chuva.maiorDia.mm >= 10
            ? chuva.granularidade === 'mensal'
              ? ` (mês ${chuva.maiorDia.rotulo}: ${round(chuva.maiorDia.mm, 1)} mm)`
              : ` (pico ${round(chuva.maiorDia.mm, 1)} mm)`
            : ''
        }${chuva.rotuloChuva3d ? ` — ${chuva.rotuloChuva3d}` : ''}.`,
        causa:
          'Chuvas fortes enchem calhas, pneus e recipientes em horas — janela crítica para novos criadouros do Aedes.',
        acao: 'Antecipe vistoria domiciliar e eliminação de água parada antes e logo após a chuva.',
      });
    } else if (chuva.chuva3 >= 5) {
      alertas.push({
        categoria: 'chuva',
        prioridade: 5,
        nivel: 'medio',
        titulo: `${prefixo}Chuva prevista nos próximos 3 dias`,
        descricao: `Acumulado previsto de ~${chuva.chuva3} mm.`,
        causa:
          'Mesmo chuvas moderadas formam criadouros em objetos expostos no peridomicílio.',
        acao: "Revise calhas, vasos e caixas d'água nas próximas 48 h.",
      });
    }

    if (chuva.maxSeqChuva >= 3) {
      alertas.push({
        categoria: 'chuva',
        prioridade: 2,
        nivel: 'alto',
        titulo: `${prefixo}Sequência de dias chuvosos (7 dias)`,
        descricao: `${chuva.maxSeqChuva} dia(s) seguidos com chuva prevista na semana.`,
        causa:
          'Chuva persistente mantém umidade alta e reabastece criadouros continuamente.',
        acao: ACAO_INFODENGUE_VETORIAL,
      });
    }

    if (chuva.chuva7 >= 20) {
      alertas.push({
        categoria: 'chuva',
        prioridade: chuva.chuva7 >= 40 ? 1 : 3,
        nivel: chuva.chuva7 >= 40 ? 'alto' : 'medio',
        titulo: `${prefixo}Chuva acumulada na semana`,
        descricao: `Previsão de ~${chuva.chuva7} mm ${rotuloPeriodo7d(chuva)} (${chuva.diasChuva} dia(s) com chuva).`,
        causa:
          'Acumulado semanal elevado aumenta risco de proliferação do vetor pós-chuva.',
        acao: 'Intensifique eliminação de criadores e monitore ovitrampas após o período chuvoso.',
      });
    }

    if (chuva.chuva14 >= 50) {
      alertas.push({
        categoria: 'previsao_clima',
        prioridade: 4,
        nivel: chuva.chuva14 >= 80 ? 'alto' : 'medio',
        titulo: `${prefixo}Previsibilidade: chuva acima do padrão (14 dias)`,
        descricao: `Acumulado previsto de ~${chuva.chuva14} mm em 14 dias.`,
        causa:
          'Janelas prolongadas de chuva historicamente antecedem aumento de casos de dengue em MG.',
        acao: 'Planeje campanha de prevenção alinhada ao calendário de chuvas previsto.',
      });
    }

    if (
      chuvaSemanalHistorica != null &&
      chuva.chuva7 > chuvaSemanalHistorica * 1.35
    ) {
      alertas.push({
        categoria: 'previsao_clima',
        prioridade: 3,
        nivel: 'alto',
        titulo: `${prefixo}Chuva prevista acima da média histórica`,
        descricao: `Previsão semanal: ~${chuva.chuva7} mm vs média histórica de ~${chuvaSemanalHistorica} mm/semana para este mês.`,
        causa:
          'Desvio positivo de chuva em relação ao histórico aumenta probabilidade de surto pós-chuva.',
        acao: ACAO_INFODENGUE_VETORIAL,
      });
    }

    if (
      chuva.umidMedia7 >= 70 ||
      (mediaUmidMes != null && chuva.umidMedia7 > mediaUmidMes + 8)
    ) {
      alertas.push({
        categoria: 'previsao_clima',
        prioridade: 4,
        nivel: 'medio',
        titulo: `${prefixo}Umidade prevista elevada (7 dias)`,
        descricao: `Média prevista de ${chuva.umidMedia7} %${
          mediaUmidMes != null ? ` (histórico do mês: ${mediaUmidMes} %)` : ''
        }.`,
        causa:
          'Umidade sustentada favorece sobrevivência do Aedes aegypti e picadas ao longo do dia.',
        acao: 'Combine vigilância de criadores com orientação sobre repelente e telas.',
      });
    }

    if (calor.diasQuentes >= 3 || calor.tempMax >= 35) {
      alertas.push({
        categoria: 'onda_calor',
        prioridade: 2,
        nivel: 'alto',
        titulo: `${prefixo}Onda de calor — risco elevado de dengue`,
        descricao: `${calor.diasQuentes} dia(s) com máxima >= 32 °C (pico ${round(calor.tempMax, 1)} °C).`,
        causa:
          'Calor acelera o ciclo do Aedes aegypti e eleva a transmissão viral.',
        acao: 'Intensifique busca ativa de criadores e comunicação de risco na população.',
      });
    } else if (calor.tempMax >= 30) {
      alertas.push({
        categoria: 'onda_calor',
        prioridade: 6,
        nivel: 'medio',
        titulo: `${prefixo}Temperaturas elevadas previstas`,
        descricao: `Máxima de ${round(calor.tempMax, 1)} °C nos próximos dias.`,
        causa: 'Faixa térmica favorável a reprodução do vetor transmissor.',
      });
    }

    if (temp >= 26 && umid >= 60) {
      alertas.push({
        categoria: 'umidade',
        prioridade: 5,
        nivel: 'alto',
        titulo: `${prefixo}Calor + umidade agora`,
        descricao: `${round(temp, 1)} °C e ${umid} % de umidade relativa.`,
        causa: 'Cenário clássico de proliferação do Aedes aegypti.',
        acao: 'Elimine água parada e use repelente nos horários de maior atividade do mosquito.',
      });
    }

    if (calor.tempMax >= 28 && chuva.chuva7 >= 10) {
      alertas.push({
        categoria: 'dengue',
        prioridade: 0,
        nivel: 'alto',
        titulo: `${prefixo}Risco composto: calor + chuva prevista`,
        descricao: `Máxima ~${round(calor.tempMax, 1)} °C e ~${chuva.chuva7} mm de chuva ${rotuloPeriodo7d(chuva)}.`,
        causa: CAUSA_DENGUE.pontos[4],
        acao: 'Acione protocolo de vigilância entomológica e epidemiológica municipal.',
      });
    }

    if (chuva.chuva7 >= 10 && calor.tempMedia >= 24) {
      alertas.push({
        categoria: 'dengue',
        prioridade: 1,
        nivel: 'alto',
        titulo: `${prefixo}Alerta pós-chuva: proliferação prevista`,
        descricao: `Chuva (~${chuva.chuva7} ${rotuloChuvaCurta(chuva)}) com temperatura média ~${calor.tempMedia} °C.`,
        causa:
          'Pós-chuva com calor é a combinação mais associada a explosão de criadores do Aedes.',
        acao: ACAO_INFODENGUE_VETORIAL,
      });
    }

    const mediaMes = mediaHistoricaMes(mensal, mesAtual, geocodeFoco);
    const ultimo = [...serie]
      .sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum)
      .at(-1);
    const casosAcimaMedia =
      mediaMes && ultimo && ultimo.CasosDengue > mediaMes * 1.2;

    if (casosAcimaMedia && ultimo && mediaMes) {
      alertas.push({
        categoria: 'dengue',
        prioridade: 2,
        nivel: 'alto',
        titulo: `${prefixo}Casos acima da média histórica do mês`,
        descricao: `Último registro: ${ultimo.CasosDengue} casos vs média de ${mediaMes} em ${ultimo.Mes}.`,
        causa:
          'Tendência epidêmica compatível com anos de clima favorável e/ou El Niño.',
        acao: ACAO_INFODENGUE_VETORIAL,
      });
    }

    const riscoClimaAtivo =
      chuva.chuva7 >= 10 || calor.tempMax >= 30 || chuva.chuva3 >= 10;

    for (const row of apiFiltrada
      .filter((a) => a.nivel_alerta >= 3)
      .slice(0, 5)) {
      const nome = NOMES_ELNINO[row.geocode] || rotuloLocal || 'Município';
      alertas.push({
        categoria: 'dengue',
        prioridade: 0,
        nivel: 'alto',
        titulo: `Infodengue nível ${row.nivel_alerta} — ${nome}`,
        descricao: `${row.casos_est} casos est. (SE ${row.semana_epi})${
          riscoClimaAtivo
            ? ` · Previsão: ~${chuva.chuva7} ${rotuloChuvaCurta(chuva)}`
            : ''
        }.`,
        causa:
          'Indicador epidemiológico oficial acima do limiar de atenção (Infodengue AlertCity).',
        acao: ACAO_INFODENGUE_VETORIAL,
      });
    }

    for (const row of apiFiltrada.filter((a) => a.nivel_alerta === 2)) {
      if (!riscoClimaAtivo && !casosAcimaMedia) continue;
      const nome = NOMES_ELNINO[row.geocode] || rotuloLocal || 'Município';
      alertas.push({
        categoria: 'dengue',
        prioridade: 2,
        nivel: 'medio',
        titulo: `Infodengue nível 2 + clima favorável — ${nome}`,
        descricao: `AlertCity nível 2 com previsão de chuva/calor convergindo (SE ${row.semana_epi}).`,
        causa:
          'Cruzamento entre alerta epidemiológico e previsibilidade climática desfavorável.',
        acao: ACAO_INFODENGUE_VETORIAL,
      });
    }

    if (apiFiltrada.length && riscoClimaAtivo) {
      const resumo = apiFiltrada
        .slice(0, 3)
        .map(
          (r) =>
            `${NOMES_ELNINO[r.geocode] || r.geocode} (nível ${r.nivel_alerta})`,
        )
        .join('; ');
      alertas.push({
        categoria: 'previsao_clima',
        prioridade: 1,
        nivel: 'alto',
        titulo: `${prefixo}Cruzamento Infodengue × previsão climática`,
        descricao: `Infodengue: ${resumo}. Clima: ~${chuva.chuva7} ${rotuloChuvaCurta(chuva)}, máx ${round(calor.tempMax, 1)} °C.`,
        causa:
          'Quando alertas epidemiológicos coincidem com chuva e calor previstos, o risco de surto aumenta significativamente.',
        acao: ACAO_INFODENGUE_VETORIAL,
      });
    }

    if (ultimo?.ONI != null && ultimo.ONI >= 0.5) {
      const com = serie.filter((r) => r.ElNino);
      const sem = serie.filter((r) => !r.ElNino);
      if (com.length && sem.length) {
        const mediaElNino =
          com.reduce((s, r) => s + r.CasosDengue, 0) / com.length;
        const mediaOutros =
          sem.reduce((s, r) => s + r.CasosDengue, 0) / sem.length;
        if (mediaElNino > mediaOutros * 1.1) {
          alertas.push({
            categoria: 'elnino',
            prioridade: 5,
            nivel: 'medio',
            titulo: `${prefixo}Contexto El Niño (ONI positivo)`,
            descricao: `ONI ${round(ultimo.ONI, 2)}. Em anos El Niño, casos médios foram ${round((mediaElNino / mediaOutros - 1) * 100, 1)} % maiores.`,
            causa:
              'El Niño altera temperatura e chuvas no Sudeste, ampliando janelas favoráveis ao vetor.',
          });
        }
      }
    }

    if (!alertas.length) {
      alertas.push({
        categoria: 'dengue',
        prioridade: 9,
        nivel: 'baixo',
        titulo: `${prefixo}Situação relativamente estável`,
        descricao:
          'Nenhum indicador crítico nas fontes consultadas (clima + Infodengue).',
        acao: 'Mantenha vigilância rotineira e acompanhe atualizações do Infodengue AlertCity.',
      });
    }

    // --- Alertas INMET WIS2 ---
    const inmetFiltrados =
      geocodeFoco === 'todos'
        ? alertasInmet
        : alertasInmet.filter((a) =>
            a.municipios.includes(geocodeFoco as number),
          );

    for (const alerta of inmetFiltrados.slice(0, 10)) {
      // Apenas alertas "Actual" e não cancelados
      if (alerta.status !== 'Actual' && alerta.status !== '') continue;

      const nivel: NivelAlerta = alerta.nivel;
      const prioridade = nivel === 'alto' ? 0 : nivel === 'medio' ? 3 : 7;

      alertas.push({
        categoria: 'inmet',
        prioridade,
        nivel,
        titulo: `${prefixo}INMET: ${alerta.evento}`,
        descricao:
          alerta.descricao ||
          `${alerta.severidade} — vigência: ${alerta.inicio} até ${alerta.fim}`,
        causa: alerta.areaDesc ? `Área afetada: ${alerta.areaDesc}` : undefined,
        acao: alerta.instrucao || undefined,
        geocode: geocodeFoco === 'todos' ? null : (geocodeFoco as number),
        fonte: 'INMET WIS2',
      });
    }

    return ordenarAlertas(alertas);
  }
}
