import { Injectable, Logger } from '@nestjs/common';
import {
  ANO_ATUAL,
  ANO_INICIO_PROJECAO,
  ANO_FIM,
  MES_ATUAL,
  MESES,
  MunicipioFoco,
  OniIntensidade,
  PROJECAO_FATOR_INF,
  PROJECAO_FATOR_SUP,
  PROJECAO_TETO_PCT,
  classificarONI,
  ONI_PROJECAO_AMORT,
  ONI_PROJECAO_CAP,
} from './constants';
import { round, climaPresente, validarPrecipitacao } from './formatacao';
import { OniMensal } from './noaa-oni.service';
import { MensalMunicipio } from './el-nino-alertas.service';
import { ClimaForecast, ClimaMensalMunicipio } from './open-meteo.service';
import { AlertaInfodengue } from './infodengue.service';

// ÔöÇÔöÇÔöÇ Interfaces de sa├¡da ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

export interface ProjecaoMes {
  mesNum: number;
  label: string;
  /** Valor central da proje├º├úo */
  valor: number;
  /** Limite superior (+35%) */
  sup: number;
  /** Limite inferior (-30%) */
  inf: number;
  /** Fator sazonal aplicado */
  fSazonal: number;
  /** Fator El Ni├▒o aplicado */
  fElnino: number;
  /** ONI usado neste m├¬s (pode ser projetado) */
  oni: number | null;
  /** Se o ONI deste m├¬s ├® projetado (extrapolado) */
  oniProjetado: boolean;
}

export interface ProjecaoMunicipio {
  geocode: number;
  nome: string;
  lat: number;
  lon: number;
  /** Populacao estimada */
  populacao: number;
  /** Base de casos: ├║ltimo m├¬s positivo dispon├¡vel */
  base: number;
  /** Fonte da base de casos */
  baseFonte: string;
  /** N├¡vel de alerta Infodengue mais recente */
  nivel_alerta: number;
  /** Incid├¬ncia por 100k hab */
  incidencia: number;
  /** Proje├º├Áes por m├¬s (meses restantes do ano corrente) */
  projecoes: ProjecaoMes[];
  /** Clima atual do munic├¡pio */
  clima: {
    temperatura_c: number;
    umidade_pct: number;
    precipitacao_mm: number;
    fonte: string;
  } | null;
}

export interface MesProjecaoMapa {
  mesNum: number;
  label: string;
  /** Fator El Ni├▒o para este m├¬s */
  fElnino: number;
  /** ONI para este m├¬s */
  oni: number | null;
  /** Se o ONI ├® projetado */
  oniProjetado: boolean;
  /** Descri├º├úo leg├¡vel da fase El Ni├▒o */
  descricao: string;
}

export interface PayloadMapaProjecao {
  ano_projecao: number;
  rotulo_conjunto: string;
  meses: MesProjecaoMapa[];
  municipios: ProjecaoMunicipio[];
  /** Malha IBGE filtrada ao escopo (choropleth). */
  geojson?: {
    type: string;
    features: Array<Record<string, unknown>>;
  } | null;
  malha_fonte?: string | null;
  elnino: {
    ativo: boolean;
    oni_atual: number | null;
    intensidade: string;
    fator_atual: number;
    periodo_atual: string;
    fonte: string;
  };
  formula: {
    expressao: string;
    teto_pct: number;
    f_sazonal: string;
    f_elnino: string;
  };
  fontes: string[];
  avisos: string[];
  atualizado_em: string;
}

// ÔöÇÔöÇÔöÇ Payload da s├®rie cons├│rcio (para gr├ífico ComposedChart) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

export interface SerieConsorcioPayload {
  rotulo_conjunto: string;
  n_municipios: number;
  anos_janela: number;
  ano_fim: number;
  mes_fim: number;
  /** Ano civil no momento da montagem (filtro do gráfico de chuva). */
  ano_calendario_atual: number;
  mes_calendario_atual: number;
  /** Rótulo do último mês consolidado (ex.: "Jul/26"). */
  label_se_hoje: string | null;
  /** Rótulos do eixo X */
  labels: string[];
  /** Casos observados (null = mês futuro) */
  casos: (number | null)[];
  /** Precipitação observada (mm); null = mês futuro ou sem clima */
  precip: (number | null)[];
  /** Precipitação projetada (climatologia mensal) */
  precip_proj: (number | null)[];
  /** Temperatura histórica observada */
  temp: (number | null)[];
  /** Temperatura projetada (Copernicus/Open-Meteo) */
  temp_proj: (number | null)[];
  /** Série ONI (observado + projetado para meses futuros) */
  oni: (number | null)[];
  /** true quando o ONI do ponto é extrapolado */
  oni_projetado: boolean[];
  /** Projeção central de casos (null = meses já com dado real) */
  proj: (number | null)[];
  /** Limite superior da projeção */
  sup: (number | null)[];
  /** Limite inferior da projeção */
  inf: (number | null)[];
  /** Flag: true se o ponto é projeção */
  projetado: boolean[];
  /** Índice do último ponto com dado real */
  idx_ultimo_real: number;
  /** Índice onde inicia a projeção */
  idx_inicio_proj: number;
  /** Média histórica de casos/mês (5 anos) */
  media_historica: number;
  elnino: {
    ativo: boolean;
    oni_atual: number | null;
    intensidade: string;
    fator_atual: number;
    intensidade_obj: OniIntensidade;
  };
  semana_epi: string;
  atualizado_em: string;
}

// ÔöÇÔöÇÔöÇ Servi├ºo ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

@Injectable()
export class ElNinoProjecaoService {
  private readonly logger = new Logger(ElNinoProjecaoService.name);

  // ÔöÇÔöÇÔöÇ Proje├º├úo ONI futura ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  /**
   * Extrapola linearmente os valores ONI para meses futuros sem dado real.
   * F├│rmula: oni_proj[mes] = oni_ultimo + delta ├ù meses_ahead ├ù AMORT
   * Cap em ┬▒ONI_PROJECAO_CAP.
   */
  projetarONIFuturo(
    oniLinhas: OniMensal[],
    anoAtual: number = ANO_ATUAL,
    mesAtual: number = new Date().getMonth() + 1,
  ): OniMensal[] {
    if (!oniLinhas.length) return [];

    const sorted = [...oniLinhas].sort(
      (a, b) => a.ano - b.ano || a.mes - b.mes,
    );

    // ONI dos ├║ltimos 3 meses para calcular delta
    const recentes = sorted.slice(-3);
    const ultimo = recentes.at(-1)!;
    let delta = 0;
    if (recentes.length >= 2) {
      const primeiro = recentes[0];
      delta = (ultimo.oni - primeiro.oni) / (recentes.length - 1);
    }

    const existentes = new Set(sorted.map((r) => `${r.ano}-${r.mes}`));
    const extras: OniMensal[] = [];

    // Projeta meses do ano corrente que ainda n├úo t├¬m dado
    for (let mes = 1; mes <= 12; mes++) {
      const chave = `${anoAtual}-${mes}`;
      if (!existentes.has(chave)) {
        const mesesAhead = (anoAtual - ultimo.ano) * 12 + (mes - ultimo.mes);
        if (mesesAhead <= 0 || mesesAhead > 18) continue;
        let oniProj = ultimo.oni + delta * mesesAhead * ONI_PROJECAO_AMORT;
        // Cap
        oniProj = Math.min(oniProj, ONI_PROJECAO_CAP);
        oniProj = Math.max(oniProj, -ONI_PROJECAO_CAP);
        extras.push({
          ano: anoAtual,
          mes,
          oni: round(oniProj, 2),
        });
      }
    }

    // Tamb├®m projeta meses futuros do ano em andamento
    if (mesAtual <= 12) {
      for (let mes = mesAtual + 1; mes <= 12; mes++) {
        const chave = `${anoAtual}-${mes}`;
        if (
          !existentes.has(chave) &&
          !extras.find((e) => e.ano === anoAtual && e.mes === mes)
        ) {
          const mesesAhead = (anoAtual - ultimo.ano) * 12 + (mes - ultimo.mes);
          if (mesesAhead <= 0 || mesesAhead > 18) continue;
          let oniProj = ultimo.oni + delta * mesesAhead * ONI_PROJECAO_AMORT;
          oniProj = Math.min(oniProj, ONI_PROJECAO_CAP);
          oniProj = Math.max(oniProj, -ONI_PROJECAO_CAP);
          extras.push({ ano: anoAtual, mes, oni: round(oniProj, 2) });
        }
      }
    }

    return extras;
  }

  // ÔöÇÔöÇÔöÇ Fatores sazonais ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  /**
   * Calcula os fatores sazonais mensais (1ÔÇô12) a partir da s├®rie hist├│rica.
   * f_sazonal[mes] = media_historica[mes] / media_geral
   * Janela: ├║ltimos 5 anos (ANO_INICIO_PROJECAO..ANO_FIM).
   */
  private calcularFatoresSazonais(
    mensal: MensalMunicipio[],
    geocode: number,
  ): Record<number, number> {
    const janela = mensal.filter(
      (r) =>
        r.geocode === geocode &&
        r.Ano >= ANO_INICIO_PROJECAO &&
        r.Ano <= ANO_FIM,
    );

    if (!janela.length) return {};

    const mediaGeral =
      janela.reduce((s, r) => s + r.CasosDengue, 0) / janela.length;
    if (!mediaGeral) return {};

    const porMes: Record<number, number[]> = {};
    for (const r of janela) {
      if (!porMes[r.MesNum]) porMes[r.MesNum] = [];
      porMes[r.MesNum].push(r.CasosDengue);
    }

    const fatores: Record<number, number> = {};
    for (let mes = 1; mes <= 12; mes++) {
      const vals = porMes[mes];
      if (!vals?.length) {
        fatores[mes] = 1.0;
        continue;
      }
      const mediaMes = vals.reduce((s, v) => s + v, 0) / vals.length;
      fatores[mes] = round(mediaMes / mediaGeral, 4);
    }
    return fatores;
  }

  /**
   * Calcula a base de casos para proje├º├úo:
   * 1) ├Ültimo m├¬s com casos > 0 no Infodengue
   * 2) M├®dia dos ├║ltimos 3 meses com dados
   * 3) M├®dia hist├│rica do m├¬s hom├│logo (janela 5 anos)
   * 4) Alerta Infodengue ├ù 4 (estimativa m├¡nima de casos/semana)
   */
  private calcularBase(
    mensal: MensalMunicipio[],
    geocode: number,
    alertas: AlertaInfodengue[],
  ): { base: number; fonte: string } {
    const porGeocode = mensal
      .filter(
        (r) =>
          r.geocode === geocode &&
          r.Ano >= ANO_INICIO_PROJECAO &&
          r.Ano <= ANO_FIM,
      )
      .sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum);

    // 1) ├Ültimo m├¬s com casos positivos
    const comCasos = [...porGeocode].reverse().find((r) => r.CasosDengue > 0);
    if (comCasos) {
      return {
        base: comCasos.CasosDengue,
        fonte: `Infodengue mensal (${comCasos.Mes}/${comCasos.Ano})`,
      };
    }

    // 2) M├®dia dos ├║ltimos 3 com dados
    const ultimos = porGeocode.slice(-3).filter((r) => r.CasosDengue >= 0);
    if (ultimos.length) {
      const media = Math.round(
        ultimos.reduce((s, r) => s + r.CasosDengue, 0) / ultimos.length,
      );
      return {
        base: media || 1,
        fonte: 'Média últimos 3 meses (Infodengue)',
      };
    }

    // 3) Alertas Infodengue como fallback
    const alerta = alertas.find((a) => a.geocode === geocode);
    if (alerta?.casos_est > 0) {
      return {
        base: Math.round(alerta.casos_est * 4),
        fonte: 'AlertCity × 4 semanas',
      };
    }

    return { base: 1, fonte: 'Fallback mínimo' };
  }

  // ÔöÇÔöÇÔöÇ Proje├º├úo por munic├¡pio ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  /**
   * Projeta casos para os meses restantes do ano corrente por munic├¡pio.
   * F├│rmula: min(base ├ù f_sazonal ├ù f_elnino, pop ├ù TETO_PCT)
   */
  calcularProjecoesMunicipio(opts: {
    municipio: MunicipioFoco;
    mensal: MensalMunicipio[];
    oniLinhas: OniMensal[];
    oniProjetados: OniMensal[];
    alertas: AlertaInfodengue[];
    climaForecast: ClimaForecast | null;
    nivelAlerta: number;
    incidencia: number;
    populacao: number;
  }): ProjecaoMunicipio {
    const {
      municipio,
      mensal,
      oniLinhas,
      oniProjetados,
      alertas,
      climaForecast,
      nivelAlerta,
      incidencia,
      populacao,
    } = opts;

    const fatoresSaz = this.calcularFatoresSazonais(mensal, municipio.geocode);
    const { base, fonte: baseFonte } = this.calcularBase(
      mensal,
      municipio.geocode,
      alertas,
    );

    // Mapa de ONI por m├¬s (obs + projetados)
    const oniMap = new Map<string, { oni: number; projetado: boolean }>();
    for (const r of oniLinhas) {
      oniMap.set(`${r.ano}-${r.mes}`, { oni: r.oni, projetado: false });
    }
    for (const r of oniProjetados) {
      const k = `${r.ano}-${r.mes}`;
      if (!oniMap.has(k)) {
        oniMap.set(k, { oni: r.oni, projetado: true });
      }
    }

    // 2º semestre (Jul–Dez), sem projetar meses já passados
    const mesInicioProjec = Math.max(7, MES_ATUAL);
    const projecoes: ProjecaoMes[] = [];

    for (let mesNum = mesInicioProjec; mesNum <= 12; mesNum++) {
      const oniEntry = oniMap.get(`${ANO_ATUAL}-${mesNum}`);
      const oniValor = oniEntry?.oni ?? null;
      const intensidade = classificarONI(oniValor);
      const fSazonal = fatoresSaz[mesNum] ?? 1.0;
      const fElnino = intensidade.fator;

      const teto =
        populacao > 0
          ? Math.round(populacao * PROJECAO_TETO_PCT)
          : Number.MAX_SAFE_INTEGER;

      const valor = Math.min(Math.round(base * fSazonal * fElnino), teto);
      const sup = Math.min(Math.round(valor * PROJECAO_FATOR_SUP), teto);
      const inf = Math.round(valor * PROJECAO_FATOR_INF);

      projecoes.push({
        mesNum,
        label: `${MESES[mesNum - 1]}/${ANO_ATUAL}`,
        valor,
        sup,
        inf,
        fSazonal,
        fElnino,
        oni: oniValor,
        oniProjetado: oniEntry?.projetado ?? true,
      });
    }

    const clima = climaForecast
      ? {
          temperatura_c: climaForecast.atual?.temperatura_c ?? 0,
          umidade_pct: climaForecast.atual?.umidade_pct ?? 0,
          precipitacao_mm: climaForecast.atual?.precipitacao_mm ?? 0,
          fonte: climaForecast.fonte,
        }
      : null;

    return {
      geocode: municipio.geocode,
      nome: municipio.municipio,
      lat: municipio.lat,
      lon: municipio.lon,
      populacao,
      base,
      baseFonte,
      nivel_alerta: nivelAlerta,
      incidencia,
      projecoes,
      clima,
    };
  }

  // ÔöÇÔöÇÔöÇ Payload mapa de proje├º├úo ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  /**
   * Monta o payload completo do mapa de proje├º├úo epidemiol├│gica.
   * GeoJSON ├® servido separadamente via /malha-mg.
   */
  montarPayloadMapaProjecao(opts: {
    municipios: MunicipioFoco[];
    mensal: MensalMunicipio[];
    oniLinhas: OniMensal[];
    alertasApi: AlertaInfodengue[];
    climaMunicipios: Record<number, ClimaForecast>;
    populacoes: Map<number, number>;
    rotuloConjunto: string;
    fontes: string[];
    avisos: string[];
  }): PayloadMapaProjecao {
    const {
      municipios,
      mensal,
      oniLinhas,
      alertasApi,
      climaMunicipios,
      populacoes,
      rotuloConjunto,
      fontes,
      avisos,
    } = opts;

    // ONI atual (├║ltimo m├¬s dispon├¡vel)
    const oniOrdenado = [...oniLinhas].sort(
      (a, b) => a.ano - b.ano || a.mes - b.mes,
    );
    const oniAtual = oniOrdenado.at(-1) ?? null;
    const intensidadeAtual = classificarONI(oniAtual?.oni);

    // ONI projetado para meses futuros
    const oniProjetados = this.projetarONIFuturo(oniLinhas);

    // Meses a projetar: Jul–Dez (2º semestre), a partir do mês corrente
    const mesInicioProjec = Math.max(7, MES_ATUAL);
    const oniMapTotal = new Map<string, { oni: number; projetado: boolean }>();
    for (const r of oniLinhas) {
      oniMapTotal.set(`${r.ano}-${r.mes}`, { oni: r.oni, projetado: false });
    }
    for (const r of oniProjetados) {
      const k = `${r.ano}-${r.mes}`;
      if (!oniMapTotal.has(k)) {
        oniMapTotal.set(k, { oni: r.oni, projetado: true });
      }
    }

    const meses: MesProjecaoMapa[] = [];
    for (let mesNum = mesInicioProjec; mesNum <= 12; mesNum++) {
      const oniEntry = oniMapTotal.get(`${ANO_ATUAL}-${mesNum}`);
      const oniValor = oniEntry?.oni ?? null;
      const intens = classificarONI(oniValor);
      meses.push({
        mesNum,
        label: `${MESES[mesNum - 1]}/${ANO_ATUAL}`,
        fElnino: intens.fator,
        oni: oniValor,
        oniProjetado: oniEntry?.projetado ?? true,
        descricao: intens.rotulo,
      });
    }

    // Alertas indexados por geocode
    const alertasPorGeocode = new Map<number, AlertaInfodengue>();
    for (const a of alertasApi) {
      // Mant├®m o alerta de maior n├¡vel por geocode
      const existente = alertasPorGeocode.get(a.geocode);
      if (!existente || a.nivel_alerta > existente.nivel_alerta) {
        alertasPorGeocode.set(a.geocode, a);
      }
    }

    const projMunicipios: ProjecaoMunicipio[] = municipios.map((mun) => {
      const alerta = alertasPorGeocode.get(mun.geocode);
      const pop = populacoes.get(mun.geocode) ?? 0;

      return this.calcularProjecoesMunicipio({
        municipio: mun,
        mensal,
        oniLinhas,
        oniProjetados,
        alertas: alertasApi,
        climaForecast: climaMunicipios[mun.geocode] ?? null,
        nivelAlerta: alerta?.nivel_alerta ?? 1,
        incidencia: alerta?.incidencia ?? 0,
        populacao: pop,
      });
    });

    const periodoAtual = oniAtual
      ? `${oniAtual.ano}/${String(oniAtual.mes).padStart(2, '0')}`
      : '—';

    return {
      ano_projecao: ANO_ATUAL,
      rotulo_conjunto: rotuloConjunto,
      meses,
      municipios: projMunicipios,
      elnino: {
        ativo:
          intensidadeAtual.label !== 'neutro' &&
          intensidadeAtual.label !== 'la_nina',
        oni_atual: oniAtual?.oni ?? null,
        intensidade: intensidadeAtual.rotulo,
        fator_atual: intensidadeAtual.fator,
        periodo_atual: periodoAtual,
        fonte: 'NOAA CPC ONI',
      },
      formula: {
        expressao: 'min(base × f_sazonal × f_elnino, população × 15%)',
        teto_pct: Math.round(PROJECAO_TETO_PCT * 100),
        f_sazonal: 'Média histórica Infodengue por mês (5 anos)',
        f_elnino:
          'NOAA CPC ONI — moderado ×1,3 · forte/muito forte ×1,8 · La Niña ×0,9',
      },
      fontes: [...fontes, 'Projeção epidemiológica — ElNinoProjecaoService'],
      avisos,
      atualizado_em: new Date().toISOString(),
      geojson: null,
      malha_fonte: null,
    };
  }

  /** Média de temperaturas estritamente positivas (ERA5/Open-Meteo). */
  private mediaTempPositiva(vals: number[]): number | null {
    const fatia = vals.filter((v) => Number.isFinite(v) && v > 0);
    if (!fatia.length) return null;
    return round(fatia.reduce((a, b) => a + b, 0) / fatia.length, 1);
  }

  /** Média sazonal Jan–Dez a partir de clima histórico e/ou série mensal. */
  private mapaTempSazonal(
    mensal: MensalMunicipio[],
    climaHistorico: ClimaMensalMunicipio[],
    geocodes: number[],
  ): Map<number, number> {
    const geoSet = new Set(geocodes);
    const map = new Map<number, number>();
    for (let mes = 1; mes <= 12; mes++) {
      const vals: number[] = [];
      for (const r of climaHistorico) {
        if (!geoSet.has(r.geocode)) continue;
        if (r.MesNum === mes && r.Temperatura > 0) vals.push(r.Temperatura);
      }
      if (!vals.length) {
        for (const r of mensal) {
          if (!geoSet.has(r.geocode)) continue;
          if (r.MesNum === mes && r.Temperatura > 0) vals.push(r.Temperatura);
        }
      }
      const media = this.mediaTempPositiva(vals);
      if (media != null) map.set(mes, media);
    }
    return map;
  }

  private tempMesAnoClima(
    climaHistorico: ClimaMensalMunicipio[],
    geocodes: number[],
    ano: number,
    mes: number,
  ): number | null {
    const geoSet = new Set(geocodes);
    const vals = climaHistorico
      .filter(
        (r) =>
          geoSet.has(r.geocode) &&
          r.Ano === ano &&
          r.MesNum === mes &&
          r.Temperatura > 0,
      )
      .map((r) => r.Temperatura);
    return this.mediaTempPositiva(vals);
  }

  private tempMesAnoMensal(
    mensal: MensalMunicipio[],
    geocodes: number[],
    ano: number,
    mes: number,
  ): number | null {
    const geoSet = new Set(geocodes);
    const vals = mensal
      .filter(
        (r) =>
          geoSet.has(r.geocode) &&
          r.Ano === ano &&
          r.MesNum === mes &&
          r.Temperatura > 0,
      )
      .map((r) => r.Temperatura);
    return this.mediaTempPositiva(vals);
  }

  private resolverTempObservada(
    r: { Ano: number; MesNum: number; Temperatura: number },
    climaHistorico: ClimaMensalMunicipio[],
    mensal: MensalMunicipio[],
    geocodes: number[],
    sazonal: Map<number, number>,
  ): number | null {
    return (
      this.tempMesAnoClima(climaHistorico, geocodes, r.Ano, r.MesNum) ??
      (r.Temperatura > 0 ? r.Temperatura : null) ??
      this.tempMesAnoMensal(mensal, geocodes, r.Ano, r.MesNum) ??
      sazonal.get(r.MesNum) ??
      null
    );
  }

  private mediaPrecipitacao(vals: number[]): number | null {
    if (!vals.length) return null;
    return round(vals.reduce((s, v) => s + v, 0) / vals.length, 1);
  }

  /** Climatologia mensal de chuva (mm) a partir de clima histórico / série mensal. */
  private mapaPrecipSazonal(
    mensal: MensalMunicipio[],
    climaHistorico: ClimaMensalMunicipio[],
    geocodes: number[],
  ): Map<number, number> {
    const geoSet = new Set(geocodes);
    const map = new Map<number, number>();
    for (let mes = 1; mes <= 12; mes++) {
      const vals: number[] = [];
      for (const r of climaHistorico) {
        if (!geoSet.has(r.geocode) || r.MesNum !== mes) continue;
        if (climaPresente(r)) vals.push(validarPrecipitacao(r.Precipitacao));
      }
      if (!vals.length) {
        for (const r of mensal) {
          if (!geoSet.has(r.geocode) || r.MesNum !== mes) continue;
          if (climaPresente(r)) vals.push(validarPrecipitacao(r.Precipitacao));
        }
      }
      const media = this.mediaPrecipitacao(vals);
      if (media != null) map.set(mes, media);
    }
    return map;
  }

  private precipMesAnoClima(
    climaHistorico: ClimaMensalMunicipio[],
    geocodes: number[],
    ano: number,
    mes: number,
  ): number | null {
    const geoSet = new Set(geocodes);
    const vals = climaHistorico
      .filter(
        (r) =>
          geoSet.has(r.geocode) &&
          r.Ano === ano &&
          r.MesNum === mes &&
          climaPresente(r),
      )
      .map((r) => validarPrecipitacao(r.Precipitacao));
    return this.mediaPrecipitacao(vals);
  }

  private precipMesAnoMensal(
    mensal: MensalMunicipio[],
    geocodes: number[],
    ano: number,
    mes: number,
  ): number | null {
    const geoSet = new Set(geocodes);
    const vals = mensal
      .filter(
        (r) =>
          geoSet.has(r.geocode) &&
          r.Ano === ano &&
          r.MesNum === mes &&
          climaPresente(r),
      )
      .map((r) => validarPrecipitacao(r.Precipitacao));
    return this.mediaPrecipitacao(vals);
  }

  private resolverPrecipObservada(
    r: { Ano: number; MesNum: number; Precipitacao?: number | null },
    climaHistorico: ClimaMensalMunicipio[],
    mensal: MensalMunicipio[],
    geocodes: number[],
    sazonal: Map<number, number>,
  ): number | null {
    const daClima = this.precipMesAnoClima(
      climaHistorico,
      geocodes,
      r.Ano,
      r.MesNum,
    );
    if (daClima != null) return daClima;

    const daMensal = this.precipMesAnoMensal(mensal, geocodes, r.Ano, r.MesNum);
    if (daMensal != null) return daMensal;

    const daSerie =
      r.Precipitacao != null && Number.isFinite(Number(r.Precipitacao))
        ? validarPrecipitacao(r.Precipitacao)
        : null;
    // 0 na série costuma ser sentinela de clima ausente — preferir climatologia.
    if (daSerie != null && daSerie > 0) return daSerie;

    return sazonal.get(r.MesNum) ?? null;
  }

  // ─── Série consórcio para gráfico ─────────────────────────────────────────

  /**
   * Monta o payload da série temporal com projeção para o gráfico
   * ComposedChart do frontend (Recharts).
   * Inclui: casos, precipitação, temperatura, ONI, projeção e bandas.
   */
  montarSerieConsorcio(opts: {
    serie: Array<{
      Ano: number;
      MesNum: number;
      Mes: string;
      CasosDengue: number;
      Temperatura: number;
      Precipitacao?: number | null;
      ONI: number | null;
      TipoElNino: string;
    }>;
    oniLinhas: OniMensal[];
    climaHistorico: ClimaMensalMunicipio[];
    municipios: MunicipioFoco[];
    populacoes: Map<number, number>;
    mensal: MensalMunicipio[];
    alertasApi: AlertaInfodengue[];
    rotuloConjunto: string;
  }): SerieConsorcioPayload {
    const {
      serie,
      oniLinhas,
      climaHistorico,
      municipios,
      populacoes,
      mensal,
      alertasApi,
      rotuloConjunto,
    } = opts;

    const geocodes = municipios.map((m) => m.geocode);
    const sazonalTemp = this.mapaTempSazonal(mensal, climaHistorico, geocodes);
    const sazonalPrecip = this.mapaPrecipSazonal(
      mensal,
      climaHistorico,
      geocodes,
    );

    // Ordenar série
    const serieOrdenada = [...serie].sort(
      (a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum,
    );

    // ONI atual e projeções futuras
    const oniProjetados = this.projetarONIFuturo(oniLinhas);
    const oniMapTotal = new Map<string, { oni: number; projetado: boolean }>();
    for (const r of oniLinhas) {
      oniMapTotal.set(`${r.ano}-${r.mes}`, { oni: r.oni, projetado: false });
    }
    for (const r of oniProjetados) {
      const k = `${r.ano}-${r.mes}`;
      if (!oniMapTotal.has(k))
        oniMapTotal.set(k, { oni: r.oni, projetado: true });
    }

    const oniAtual = [...oniLinhas]
      .sort((a, b) => a.ano - b.ano || a.mes - b.mes)
      .at(-1);
    const intensidadeAtual = classificarONI(oniAtual?.oni);

    // Índice do último mês com dado real na série (inclui ano corrente parcial)
    const idxUltimoReal = serieOrdenada.findLastIndex(
      (r) =>
        r.Ano < ANO_ATUAL || (r.Ano === ANO_ATUAL && r.MesNum <= MES_ATUAL),
    );

    // Calcular projeção para meses a partir do próximo mês do ano corrente
    const mesInicioProjec = Math.min(12, MES_ATUAL + 1);
    const projPorMes = new Map<
      string,
      { valor: number; sup: number; inf: number }
    >();

    for (let mes = mesInicioProjec; mes <= 12; mes++) {
      let valorTotal = 0;
      let supTotal = 0;
      let infTotal = 0;
      let peso = 0;

      for (const mun of municipios) {
        const pop = populacoes.get(mun.geocode) ?? 0;
        const fatoresSaz = this.calcularFatoresSazonais(mensal, mun.geocode);
        const { base } = this.calcularBase(mensal, mun.geocode, alertasApi);
        const oniEntry = oniMapTotal.get(`${ANO_ATUAL}-${mes}`);
        const intens = classificarONI(oniEntry?.oni);
        const fSaz = fatoresSaz[mes] ?? 1.0;

        const teto =
          pop > 0
            ? Math.round(pop * PROJECAO_TETO_PCT)
            : Number.MAX_SAFE_INTEGER;
        const valor = Math.min(Math.round(base * fSaz * intens.fator), teto);
        const sup = Math.min(Math.round(valor * PROJECAO_FATOR_SUP), teto);
        const inf = Math.round(valor * PROJECAO_FATOR_INF);

        const p = pop > 0 ? pop : 1;
        valorTotal += valor * p;
        supTotal += sup * p;
        infTotal += inf * p;
        peso += p;
      }

      const pesoEfetivo = peso || municipios.length || 1;
      projPorMes.set(`${ANO_ATUAL}-${mes}`, {
        valor: Math.round(valorTotal / pesoEfetivo),
        sup: Math.round(supTotal / pesoEfetivo),
        inf: Math.round(infTotal / pesoEfetivo),
      });
    }

    // Montar arrays para o gráfico
    const labels: string[] = [];
    const casos: (number | null)[] = [];
    const precip: (number | null)[] = [];
    const precip_proj: (number | null)[] = [];
    const temp: (number | null)[] = [];
    const temp_proj: (number | null)[] = [];
    const oni: (number | null)[] = [];
    const oni_projetado: boolean[] = [];
    const proj: (number | null)[] = [];
    const sup: (number | null)[] = [];
    const inf: (number | null)[] = [];
    const projetado: boolean[] = [];

    const mesesNaSerie = new Set(
      serieOrdenada.map((r) => `${r.Ano}-${r.MesNum}`),
    );

    // Série histórica
    for (const r of serieOrdenada) {
      const lbl = `${r.Mes}/${String(r.Ano).slice(-2)}`;
      labels.push(lbl);
      casos.push(r.CasosDengue);
      precip.push(
        this.resolverPrecipObservada(
          r,
          climaHistorico,
          mensal,
          geocodes,
          sazonalPrecip,
        ),
      );
      precip_proj.push(null);
      temp.push(
        this.resolverTempObservada(
          r,
          climaHistorico,
          mensal,
          geocodes,
          sazonalTemp,
        ),
      );
      temp_proj.push(null);
      const oniEntry = oniMapTotal.get(`${r.Ano}-${r.MesNum}`);
      oni.push(oniEntry?.oni ?? r.ONI ?? null);
      oni_projetado.push(oniEntry?.projetado ?? false);
      proj.push(null);
      sup.push(null);
      inf.push(null);
      projetado.push(false);
    }

    // Preenche meses do ano corrente ainda sem linha na série (ex.: jan–jul/26)
    for (let mes = 1; mes <= MES_ATUAL; mes++) {
      const chave = `${ANO_ATUAL}-${mes}`;
      if (mesesNaSerie.has(chave)) continue;

      labels.push(`${MESES[mes - 1]}/${String(ANO_ATUAL).slice(-2)}`);
      casos.push(null);
      precip.push(
        this.resolverPrecipObservada(
          { Ano: ANO_ATUAL, MesNum: mes, Precipitacao: null },
          climaHistorico,
          mensal,
          geocodes,
          sazonalPrecip,
        ),
      );
      precip_proj.push(null);
      temp.push(
        this.resolverTempObservada(
          { Ano: ANO_ATUAL, MesNum: mes, Temperatura: 0 },
          climaHistorico,
          mensal,
          geocodes,
          sazonalTemp,
        ),
      );
      temp_proj.push(null);
      const oniEntry = oniMapTotal.get(chave);
      oni.push(oniEntry?.oni ?? null);
      oni_projetado.push(oniEntry?.projetado ?? false);
      proj.push(null);
      sup.push(null);
      inf.push(null);
      projetado.push(false);
    }

    // Meses projetados do ano corrente
    for (let mes = mesInicioProjec; mes <= 12; mes++) {
      const lbl = `${MESES[mes - 1]}/${String(ANO_ATUAL).slice(-2)}`;
      labels.push(lbl);
      casos.push(null);
      precip.push(null);

      const histPrecip = serieOrdenada
        .filter((r) => r.MesNum === mes)
        .map((r) =>
          this.resolverPrecipObservada(
            r,
            climaHistorico,
            mensal,
            geocodes,
            sazonalPrecip,
          ),
        )
        .filter((v): v is number => v != null);
      const chuvaSazonal =
        sazonalPrecip.get(mes) ??
        (histPrecip.length
          ? round(histPrecip.reduce((s, v) => s + v, 0) / histPrecip.length, 1)
          : null);
      precip_proj.push(chuvaSazonal);

      temp.push(null);
      const histMes = serieOrdenada
        .filter((r) => r.MesNum === mes)
        .map((r) =>
          this.resolverTempObservada(
            r,
            climaHistorico,
            mensal,
            geocodes,
            sazonalTemp,
          ),
        )
        .filter((v): v is number => v != null && v > 0);
      const tempProj =
        sazonalTemp.get(mes) ??
        (histMes.length
          ? round(histMes.reduce((s, v) => s + v, 0) / histMes.length, 1)
          : null);
      temp_proj.push(tempProj);

      const oniEntry = oniMapTotal.get(`${ANO_ATUAL}-${mes}`);
      oni.push(oniEntry?.oni ?? null);
      oni_projetado.push(oniEntry?.projetado ?? true);

      const p = projPorMes.get(`${ANO_ATUAL}-${mes}`);
      proj.push(p?.valor ?? null);
      sup.push(p?.sup ?? null);
      inf.push(p?.inf ?? null);
      projetado.push(true);
    }

    const idxInicioProjec = projetado.findIndex((v) => v);

    // Média histórica
    const casosHistoricos = serieOrdenada.map((r) => r.CasosDengue);
    const mediaHistorica = casosHistoricos.length
      ? Math.round(
          casosHistoricos.reduce((s, v) => s + v, 0) / casosHistoricos.length,
        )
      : 0;

    // Semana epi atual (estimativa)
    const agora = new Date();
    const inicioAno = new Date(agora.getFullYear(), 0, 1);
    const semanaEpi =
      String(agora.getFullYear()) +
      String(
        Math.ceil(
          ((agora.getTime() - inicioAno.getTime()) / 86400000 +
            inicioAno.getDay() +
            1) /
            7,
        ),
      ).padStart(2, '0');

    const labelSeHoje = (() => {
      for (let i = projetado.length - 1; i >= 0; i--) {
        if (!projetado[i]) return labels[i] ?? null;
      }
      return labels.at(-1) ?? null;
    })();

    return {
      rotulo_conjunto: rotuloConjunto,
      n_municipios: municipios.length,
      anos_janela: ANO_FIM - ANO_INICIO_PROJECAO + 1,
      ano_fim: ANO_FIM,
      mes_fim: serieOrdenada.at(-1)?.MesNum ?? MES_ATUAL,
      ano_calendario_atual: ANO_ATUAL,
      mes_calendario_atual: MES_ATUAL,
      label_se_hoje: labelSeHoje,
      labels,
      casos,
      precip,
      precip_proj,
      temp,
      temp_proj,
      oni,
      oni_projetado,
      proj,
      sup,
      inf,
      projetado,
      idx_ultimo_real: idxUltimoReal >= 0 ? idxUltimoReal : labels.length - 1,
      idx_inicio_proj: idxInicioProjec,
      media_historica: mediaHistorica,
      elnino: {
        ativo:
          intensidadeAtual.label !== 'neutro' &&
          intensidadeAtual.label !== 'la_nina',
        oni_atual: oniAtual?.oni ?? null,
        intensidade: intensidadeAtual.rotulo,
        fator_atual: intensidadeAtual.fator,
        intensidade_obj: intensidadeAtual,
      },
      semana_epi: semanaEpi,
      atualizado_em: new Date().toISOString(),
    };
  }
}
