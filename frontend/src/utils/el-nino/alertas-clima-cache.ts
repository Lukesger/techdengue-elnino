import {
  analisarPrevisaoChuva,
  detectarOndaCalor,
  isClimaGranularidadeMensal,
  type ClimaLike,
} from './analisar-previsao-chuva';

const ACAO_INFODENGUE_VETORIAL =
  'Compare os alertas Infodengue (AlertCity) com a previsão climática. Reforce controle vetorial: busca ativa de criadores, eliminação de água parada em até 48 h após chuvas, nebulização e visita domiciliar nas áreas de maior incidência.';

function fmt(v: number): string {
  return String(v).replace('.', ',');
}

function mediaChuvaHistoricaMes(
  mensal: any[],
  mesNum: number,
  geocode: number | 'todos',
): number | null {
  const fatia = mensal.filter(
    (r) =>
      r.MesNum === mesNum &&
      (geocode === 'todos' || Number(r.geocode) === geocode),
  );
  if (!fatia.length) return null;
  return Math.round(
    (fatia.reduce((s, r) => s + Number(r.Precipitacao || 0), 0) / fatia.length) *
      10,
  ) / 10;
}

function mediaUmidadeHistoricaMes(
  mensal: any[],
  mesNum: number,
  geocode: number | 'todos',
): number | null {
  const fatia = mensal.filter(
    (r) =>
      r.MesNum === mesNum &&
      (geocode === 'todos' || Number(r.geocode) === geocode),
  );
  if (!fatia.length) return null;
  return Math.round(
    fatia.reduce((s, r) => s + Number(r.Umidade || 0), 0) / fatia.length,
  );
}

function ordenarAlertas(alertas: any[]): any[] {
  const ordem: Record<string, number> = { alto: 0, medio: 1, baixo: 2 };
  return [...alertas].sort(
    (a, b) =>
      (a.prioridade ?? 9) - (b.prioridade ?? 9) ||
      ordem[a.nivel] - ordem[b.nivel],
  );
}

function descricaoTemChuvaSemanalErrada(descricao: string): boolean {
  return /mm\/7d|mm em 7 dias|mm chuva\/7d/i.test(descricao || '');
}

function alertaDependeDeChuvaErrada(a: any): boolean {
  const titulo = String(a.titulo || '');
  const descricao = String(a.descricao || '');

  if (a.categoria === 'chuva') return true;

  if (a.categoria === 'previsao_clima') {
    if (
      /chuva|umidade prevista|14 dias|cruzamento infodengue/i.test(titulo)
    ) {
      return true;
    }
    if (descricaoTemChuvaSemanalErrada(descricao)) return true;
  }

  if (a.categoria === 'dengue') {
    if (
      /pós-chuva|pos-chuva|calor \+ chuva|cruzamento infodengue/i.test(titulo)
    ) {
      return true;
    }
    if (descricaoTemChuvaSemanalErrada(descricao)) return true;
  }

  return false;
}

function gerarAlertasChuvaCorrigidos(
  clima: ClimaLike,
  mensal: any[],
  geocodeFoco: number | 'todos',
  rotuloLocal: string,
  alertasApi: any[],
): any[] {
  const dias = clima.dias ?? [];
  const chuva = analisarPrevisaoChuva(dias, clima);
  const calor = detectarOndaCalor(dias, clima);
  const prefixo = rotuloLocal ? `${rotuloLocal}: ` : '';
  const gcFoco = geocodeFoco === 'todos' ? null : Number(geocodeFoco);
  const mesAtual = new Date().getMonth() + 1;
  const mediaChuvaMes = mediaChuvaHistoricaMes(mensal, mesAtual, geocodeFoco);
  const mediaUmidMes = mediaUmidadeHistoricaMes(mensal, mesAtual, geocodeFoco);
  const chuvaSemanalHistorica =
    mediaChuvaMes != null ? Math.round((mediaChuvaMes / 4) * 10) / 10 : null;
  const rotulo7d =
    chuva.granularidade === 'mensal'
      ? 'mm/semana (estim. ERA5)'
      : 'mm/7d';
  const periodo7d =
    chuva.granularidade === 'mensal'
      ? 'na semana (estim. ERA5)'
      : 'em 7 dias';
  const periodo3d =
    chuva.granularidade === 'mensal'
      ? 'em 3 dias (estim. proporcional ao mês ERA5)'
      : 'em 3 dias';

  const alertas: any[] = [];
  const push = (base: any) =>
    alertas.push({
      ...base,
      municipio: gcFoco ? rotuloLocal || base.municipio || null : null,
      geocode: base.geocode ?? gcFoco ?? null,
    });

  if (chuva.chuva3 >= 15 || chuva.maiorDia.mm >= 20) {
    push({
      categoria: 'chuva',
      prioridade: 1,
      nivel: 'alto',
      titulo: `${prefixo}Chuva intensa iminente (48–72 h)`,
      descricao: `Previsão de ~${fmt(chuva.chuva3)} mm ${periodo3d}${
        chuva.maiorDia.mm >= 10
          ? chuva.granularidade === 'mensal'
            ? ` (mês ${chuva.maiorDia.rotulo}: ${fmt(chuva.maiorDia.mm)} mm)`
            : ` (pico ${fmt(chuva.maiorDia.mm)} mm)`
          : ''
      }${chuva.rotuloChuva3d ? ` — ${chuva.rotuloChuva3d}` : ''}.`,
      causa:
        'Chuvas fortes enchem calhas, pneus e recipientes em horas — janela crítica para novos criadouros do Aedes.',
      acao: 'Antecipe vistoria domiciliar e eliminação de água parada antes e logo após a chuva.',
    });
  } else if (chuva.chuva3 >= 5) {
    push({
      categoria: 'chuva',
      prioridade: 5,
      nivel: 'medio',
      titulo: `${prefixo}Chuva prevista nos próximos 3 dias`,
      descricao: `Acumulado previsto de ~${fmt(chuva.chuva3)} mm.`,
      causa:
        'Mesmo chuvas moderadas formam criadouros em objetos expostos no peridomicílio.',
      acao: "Revise calhas, vasos e caixas d'água nas próximas 48 h.",
    });
  }

  if (chuva.maxSeqChuva >= 3) {
    push({
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
    push({
      categoria: 'chuva',
      prioridade: chuva.chuva7 >= 40 ? 1 : 3,
      nivel: chuva.chuva7 >= 40 ? 'alto' : 'medio',
      titulo: `${prefixo}Chuva acumulada na semana`,
      descricao: `Previsão de ~${fmt(chuva.chuva7)} mm ${periodo7d} (${chuva.diasChuva} dia(s) com chuva).`,
      causa:
        'Acumulado semanal elevado aumenta risco de proliferação do vetor pós-chuva.',
      acao: 'Intensifique eliminação de criadores e monitore ovitrampas após o período chuvoso.',
    });
  }

  if (chuva.chuva14 >= 50) {
    push({
      categoria: 'previsao_clima',
      prioridade: 4,
      nivel: chuva.chuva14 >= 80 ? 'alto' : 'medio',
      titulo: `${prefixo}Previsibilidade: chuva acima do padrão (14 dias)`,
      descricao: `Acumulado previsto de ~${fmt(chuva.chuva14)} mm em 14 dias.`,
      causa:
        'Janelas prolongadas de chuva historicamente antecedem aumento de casos de dengue em MG.',
      acao: 'Planeje campanha de prevenção alinhada ao calendário de chuvas previsto.',
    });
  }

  if (
    chuvaSemanalHistorica != null &&
    chuva.chuva7 > chuvaSemanalHistorica * 1.35
  ) {
    push({
      categoria: 'previsao_clima',
      prioridade: 3,
      nivel: 'alto',
      titulo: `${prefixo}Chuva prevista acima da média histórica`,
      descricao: `Previsão semanal: ~${fmt(chuva.chuva7)} mm vs média histórica de ~${fmt(chuvaSemanalHistorica)} mm/semana para este mês.`,
      causa:
        'Desvio positivo de chuva em relação ao histórico aumenta probabilidade de surto pós-chuva.',
      acao: ACAO_INFODENGUE_VETORIAL,
    });
  }

  if (
    chuva.umidMedia7 >= 70 ||
    (mediaUmidMes != null && chuva.umidMedia7 > mediaUmidMes + 8)
  ) {
    push({
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

  if (calor.tempMax >= 28 && chuva.chuva7 >= 10) {
    push({
      categoria: 'dengue',
      prioridade: 0,
      nivel: 'alto',
      titulo: `${prefixo}Risco composto: calor + chuva prevista`,
      descricao: `Máxima ~${fmt(calor.tempMax)} °C e ~${fmt(chuva.chuva7)} mm de chuva ${periodo7d}.`,
      causa:
        'A combinação calor + umidade + água parada explica a maior parte do crescimento de casos em períodos de surto.',
      acao: 'Acione protocolo de vigilância entomológica e epidemiológica municipal.',
    });
  }

  if (chuva.chuva7 >= 10 && calor.tempMedia >= 24) {
    push({
      categoria: 'dengue',
      prioridade: 1,
      nivel: 'alto',
      titulo: `${prefixo}Alerta pós-chuva: proliferação prevista`,
      descricao: `Chuva (~${fmt(chuva.chuva7)} ${rotulo7d}) com temperatura média ~${fmt(calor.tempMedia)} °C.`,
      causa:
        'Pós-chuva com calor é a combinação mais associada a explosão de criadores do Aedes.',
      acao: ACAO_INFODENGUE_VETORIAL,
    });
  }

  const apiFiltrada =
    geocodeFoco === 'todos'
      ? alertasApi
      : alertasApi.filter((a) => Number(a.geocode) === geocodeFoco);
  const riscoClimaAtivo =
    chuva.chuva7 >= 10 || calor.tempMax >= 30 || chuva.chuva3 >= 10;

  if (apiFiltrada.length && riscoClimaAtivo) {
    const resumo = apiFiltrada
      .slice(0, 3)
      .map((r: any) => `${r.municipio || r.geocode} (nível ${r.nivel_alerta})`)
      .join('; ');
    push({
      categoria: 'previsao_clima',
      prioridade: 1,
      nivel: 'alto',
      titulo: `${prefixo}Cruzamento Infodengue × previsão climática`,
      descricao: `Infodengue: ${resumo}. Clima: ~${fmt(chuva.chuva7)} ${rotulo7d}, máx ${fmt(calor.tempMax)} °C.`,
      causa:
        'Quando alertas epidemiológicos coincidem com chuva e calor previstos, o risco de surto aumenta significativamente.',
      acao: ACAO_INFODENGUE_VETORIAL,
    });
  }

  return alertas;
}

/** Recalcula alertas de chuva quando o cache ERA5 usa série mensal rotulada como diária. */
export function corrigirAlertasClimaMensal(
  alertas: any[],
  clima: ClimaLike | undefined,
  mensal: any[],
  geocodeFoco: number | 'todos',
  rotuloLocal: string,
  alertasApi: any[] = [],
): any[] {
  if (!clima || !isClimaGranularidadeMensal(clima.dias ?? [], clima)) {
    return alertas;
  }

  const mantidos = alertas.filter((a) => !alertaDependeDeChuvaErrada(a));
  const novos = gerarAlertasChuvaCorrigidos(
    clima,
    mensal,
    geocodeFoco,
    rotuloLocal,
    alertasApi,
  );

  return ordenarAlertas([...mantidos, ...novos]);
}
