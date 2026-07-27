import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../../shared/services/cache.service';
import {
  ANO_FIM,
  ANO_INICIO,
  CACHE_KEYS,
  CACHE_TTL,
  MESES,
  MUNICIPIOS_ELNINO,
  MunicipioFoco,
  tipoElNinoAnual,
} from './constants';
import {
  climaPresente,
  contarParesFinitos,
  interpretarR,
  pearson,
  round,
  validarPrecipitacao,
  validarTemperatura,
  validarUmidade,
  valorClimaOuNull,
} from './formatacao';

/** Minimo de pares com dado real para uma correlacao ser considerada robusta. */
const MIN_PARES_CORRELACAO = 6;
import { NoaaOniService, OniAnual, OniMensal } from './noaa-oni.service';
import {
  ClimaForecast,
  ClimaMensalMunicipio,
  OpenMeteoService,
} from './open-meteo.service';
import {
  AlertaInfodengue,
  CasoMensalMunicipio,
  InfodengueService,
} from './infodengue.service';
import { IbgeMgService, MunicipioFocoValidado } from './ibge-mg.service';
import {
  AlertaPreditivo,
  CAUSA_DENGUE,
  ElNinoAlertasService,
  MensalMunicipio,
  SerieMensal,
} from './el-nino-alertas.service';
import { CopernicusCdsService } from './copernicus-cds.service';
import { InmetWis2Service, InmetAlerta } from './inmet-wis2.service';
import { ClimaHistoricoStoreService } from './clima-historico-store.service';

export interface ResumoMunicipio {
  geocode: number;
  municipio: string;
  casos_estimados: number;
  casos_notificados: number;
}

export interface MapaMunicipio extends ResumoMunicipio {
  geocode_padded: string;
  intensidade: number;
}

export interface CorrelacaoClima {
  variavel_clima: string;
  correlacao: number;
  interpretacao: string;
  /** Pares (mes) com dado real usados no calculo do r. */
  n: number;
}

export interface CorrelacaoElNino {
  variavel: string;
  correlacao: number;
  interpretacao: string;
}

export interface HistoricoAnual {
  Ano: number;
  TipoElNino: string;
  ONIMedio: number | null;
  TemperaturaMedia: number;
  PrecipitacaoAnual: number;
  CasosDengueTotal: number;
}

export interface ResumoElNino {
  casos_media_mensal_sem: number;
  casos_media_mensal_com: number;
  temp_media_sem: number;
  temp_media_com: number;
  chuva_media_sem: number;
  chuva_media_com: number;
  anos_sem: string;
  anos_com: string;
  variacao_casos_pct: number;
}

export interface ComparativoMensal {
  MesNum: number;
  Mes: string;
  ElNino: number;
  Periodo: 'Com El Nino' | 'Sem El Nino';
  CasosDengue: number;
  Temperatura: number;
}

export interface ComparativoMunicipio {
  municipio: string;
  TipoElNino: string;
  CasosDengue: number;
}

export interface AnaliseElNino {
  correlacoes: CorrelacaoElNino[];
  comparativo_mensal: ComparativoMensal[];
  comparativo_municipio: ComparativoMunicipio[];
  resumo: ResumoElNino;
}

export interface ResumoEscopoPipeline {
  qtd_municipios: number;
  populacao_total: number;
  agregacao_default: 'soma' | 'ponderada';
  populacoes: Array<{ geocode: number; populacao: number }>;
}

export interface PacoteOverview {
  versao: number;
  ano_inicio: number;
  ano_fim: number;
  municipios: MunicipioFoco[];
  municipios_foco: string[];
  municipios_ibge: MunicipioFocoValidado[];
  df_serie: SerieMensal[];
  df_serie_ponderada: SerieMensal[];
  df_mensal_mun: MensalMunicipio[];
  df_historico: HistoricoAnual[];
  df_historico_ponderado: HistoricoAnual[];
  df_municipios: ResumoMunicipio[];
  mapa_df: MapaMunicipio[];
  oni_mensal: OniMensal[];
  oni_anual: OniAnual[];
  correlacoes: CorrelacaoClima[];
  elnino: AnaliseElNino;
  alertas: AlertaPreditivo[];
  alertas_por_geocode: Record<string, AlertaPreditivo[]>;
  /** Alertas brutos do Infodengue AlertCity (para uso em proje├º├Áes) */
  alertas_infodengue: AlertaInfodengue[];
  /** Alertas meteorol├│gicos INMET WIS2 */
  inmet_alertas: InmetAlerta[];
  clima: ClimaForecast | null;
  clima_municipios: Record<number, ClimaForecast>;
  clima_historico: ClimaMensalMunicipio[];
  causa_dengue: typeof CAUSA_DENGUE;
  fontes: string[];
  avisos: string[];
  resumo_escopo: ResumoEscopoPipeline;
  atualizado_em: string;
}

export interface ExecutarPipelineOpts {
  municipios?: MunicipioFoco[];
  populacoes?: Map<number, number>;
  forceRefresh?: boolean;
}

@Injectable()
export class ElNinoPipelineService {
  private readonly logger = new Logger(ElNinoPipelineService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly noaa: NoaaOniService,
    private readonly openMeteo: OpenMeteoService,
    private readonly infodengue: InfodengueService,
    private readonly ibge: IbgeMgService,
    private readonly alertasService: ElNinoAlertasService,
    private readonly copernicus: CopernicusCdsService,
    private readonly inmetService: InmetWis2Service,
    private readonly climaHistoricoStore: ClimaHistoricoStoreService,
  ) {}

  /**
   * Hash de cache: junta os geocodes ordenados. Cada combina├º├úo de escopo
   * tem sua pr├│pria entrada de cache para evitar requisi├º├Áes externas redundantes.
   */
  private chaveOverview(geocodes: number[]): string {
    const ordenado = [...new Set(geocodes)].sort((a, b) => a - b).join('-');
    return `${CACHE_KEYS.OVERVIEW}:${ordenado || 'default'}`;
  }

  async getOverview(
    opts: ExecutarPipelineOpts | boolean = {},
  ): Promise<PacoteOverview> {
    // Compatibilidade: assinatura antiga aceitava s├│ forceRefresh boolean
    const params: ExecutarPipelineOpts =
      typeof opts === 'boolean'
        ? { municipios: MUNICIPIOS_ELNINO, forceRefresh: opts }
        : {
            municipios: opts.municipios?.length
              ? opts.municipios
              : MUNICIPIOS_ELNINO,
            populacoes: opts.populacoes,
            forceRefresh: opts.forceRefresh ?? false,
          };

    const geocodes = params.municipios.map((m) => m.geocode);
    const cacheKey = this.chaveOverview(geocodes);
    if (!params.forceRefresh) {
      const cached = await this.cache.getAsync<PacoteOverview>(cacheKey);
      if (cached) {
        // Store JSON pode ter ganhado clima (ex.: Contagem) depois do cache —
        // reprocessa para não servir série sem temperatura/chuva.
        if (!this.climaStoreMaisCompletoQueCache(cached, geocodes)) {
          return cached;
        }
        this.cache.delete(cacheKey);
        this.logger.log(
          `Cache overview invalidado: clima no store cobre geocodes ausentes no pacote (${geocodes.join(',')})`,
        );
      }
    }
    const pacote = await this.executar(params);
    await this.cache.setAsync(cacheKey, pacote, CACHE_TTL.OVERVIEW_MS);
    return pacote;
  }

  /**
   * True quando o JSON local tem clima real para algum geocode do escopo
   * que o pacote em cache ainda não trouxe (sentinela / ausência).
   */
  private climaStoreMaisCompletoQueCache(
    cached: PacoteOverview,
    geocodes: number[],
  ): boolean {
    const doStore = this.climaHistoricoStore.carregarPorMunicipios(
      geocodes,
      ANO_INICIO,
      ANO_FIM,
    );
    const storeComClima = new Set(
      doStore.filter((r) => climaPresente(r)).map((r) => Number(r.geocode)),
    );
    if (!storeComClima.size) return false;

    const cacheComClima = new Set(
      (cached.clima_historico ?? [])
        .filter((r) => climaPresente(r))
        .map((r) => Number(r.geocode)),
    );

    for (const g of geocodes) {
      const gc = Number(g);
      if (storeComClima.has(gc) && !cacheComClima.has(gc)) return true;
    }
    return false;
  }

  async refresh(
    opts: ExecutarPipelineOpts = { municipios: MUNICIPIOS_ELNINO },
  ): Promise<PacoteOverview> {
    const municipios = opts.municipios?.length
      ? opts.municipios
      : MUNICIPIOS_ELNINO;
    this.cache.delete(this.chaveOverview(municipios.map((m) => m.geocode)));
    return this.getOverview({ ...opts, municipios, forceRefresh: true });
  }

  private async executar(opts: ExecutarPipelineOpts): Promise<PacoteOverview> {
    const municipios = opts.municipios;
    const forceRefresh = opts.forceRefresh ?? false;
    const populacoes = opts.populacoes ?? new Map<number, number>();
    const avisos: string[] = [];
    const fontes: string[] = [];

    // ÔöÇÔöÇ ONI NOAA ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    const oniPayload = await this.noaa.carregarOniMensal(forceRefresh);
    const oniLinhas = oniPayload.linhas ?? [];
    if (oniLinhas.length) fontes.push(`NOAA — ${oniPayload.fonte}`);
    else
      avisos.push(
        'Índice ONI indisponível; classificação El Niño pode ficar incompleta.',
      );

    const oniAnual = this.noaa.oniPorAno(oniLinhas);
    const oniAnualMap = new Map(oniAnual.map((r) => [r.ano, r]));
    const tipoFn = (ano: number) =>
      tipoElNinoAnual(oniAnualMap.get(ano)?.oni_medio);

    // ── Casos Infodengue + clima histórico (JSON local; APIs só no refresh) ──
    const casos = await this.infodengue.carregarCasosMensais(
      municipios,
      forceRefresh,
    );

    if (casos.length)
      fontes.push('Infodengue AlertCity — casos mensais (10 anos)');
    else avisos.push('Casos Infodengue indisponíveis.');

    const geocodes = municipios.map((m) => m.geocode);
    let climaHistorico = this.climaHistoricoStore.carregarPorMunicipios(
      geocodes,
      ANO_INICIO,
      ANO_FIM,
    );

    const coberturaClimaOk = this.copernicus.coberturaClimaCompleta(
      climaHistorico,
      casos,
    );

    if (climaHistorico.length && coberturaClimaOk) {
      fontes.push(
        `JSON local (${this.climaHistoricoStore.metaAtualizadoEm() ?? 'cache'}) — clima histórico`,
      );
    }

    if (forceRefresh || !coberturaClimaOk) {
      let climaOpenMeteo: ClimaMensalMunicipio[] = [];
      if (forceRefresh || !climaHistorico.length) {
        climaOpenMeteo = await this.openMeteo.buscarClimaHistoricoAoVivo(
          municipios,
          forceRefresh,
        );
        if (climaOpenMeteo.length) {
          fontes.push('Open-Meteo Archive — atualização clima histórico');
        }
      }

      let climaMesclado =
        climaOpenMeteo.length > climaHistorico.length
          ? climaOpenMeteo
          : climaHistorico;

      const precisaEra5 = !this.copernicus.coberturaClimaCompleta(
        climaMesclado,
        casos,
      );

      if (precisaEra5) {
        try {
          const copernicusRows = await this.copernicus.carregarClimaMunicipios(
            municipios,
            ANO_INICIO,
            ANO_FIM,
            forceRefresh,
          );
          if (copernicusRows.length) {
            climaMesclado = this.copernicus.mesclarClimaHistorico(
              climaMesclado,
              copernicusRows,
            );
            fontes.push(
              'Copernicus ERA5 — complemento onde Open-Meteo falhou ou incompleto',
            );
          }
        } catch {
          /* mantém parcial */
        }
      }

      if (climaMesclado.length) {
        this.climaHistoricoStore.salvarMesclado(climaMesclado, {
          fonte: fontes.find((f) => /Open-Meteo|ERA5|Copernicus/i.test(f)),
        });
        climaHistorico = this.climaHistoricoStore.carregarPorMunicipios(
          geocodes,
          ANO_INICIO,
          ANO_FIM,
        );
      } else if (!climaHistorico.length) {
        avisos.push(
          'Clima histórico indisponível. Rode POST /el-nino-analytics/refresh (admin) para popular o JSON.',
        );
      }
    }

    // ÔöÇÔöÇ IBGE valida├º├úo ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    const municipiosIbge = await this.ibge.validarMunicipiosFoco(
      municipios.map((m) => m.geocode),
    );
    fontes.push('IBGE Localidades — validação geocodes MG');

    // ÔöÇÔöÇ Previs├úo de clima atual por munic├¡pio ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    const climaMunicipios: Record<number, ClimaForecast> = {};
    await Promise.all(
      municipios.map(async (mun) => {
        try {
          climaMunicipios[mun.geocode] =
            await this.openMeteo.buscarPrevisaoMunicipio(mun, forceRefresh);
        } catch (err) {
          this.logger.warn(
            `Forecast indisponível para ${mun.municipio}: ${(err as Error).message}`,
          );
        }
      }),
    );
    const clima = municipios.length
      ? (climaMunicipios[municipios[0].geocode] ?? null)
      : null;
    if (clima) fontes.push(`Clima atual/previsão — ${clima.fonte}`);

    // ── Alertas Infodengue ──
    const alertasApi = await this.infodengue.buscarAlertasRecentes(
      geocodes,
      undefined,
      forceRefresh,
    );
    if (alertasApi.length)
      fontes.push('Infodengue AlertCity — alertas epidemiológicos');
    else avisos.push('Alertas Infodengue AlertCity indisponíveis.');

    // ÔöÇÔöÇ Alertas INMET WIS2 ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    let inmetAlertas: InmetAlerta[] = [];
    try {
      inmetAlertas = await this.inmetService.buscarAlertasPorGeocodes(
        geocodes,
        forceRefresh,
      );
      if (inmetAlertas.length) {
        fontes.push(
          `INMET WIS2 — ${inmetAlertas.length} alerta(s) meteorológico(s)`,
        );
      }
    } catch (err) {
      this.logger.warn(`INMET WIS2 indisponível: ${(err as Error).message}`);
    }

    // ÔöÇÔöÇ Montagem da s├®rie mensal ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    const dfMensalMun = this.enriquecerMensal(
      casos,
      climaHistorico,
      oniLinhas,
      tipoFn,
    );
    const dfSerie = this.agregarSerieRegional(dfMensalMun);
    const dfSeriePonderada = this.agregarSeriePonderada(
      dfMensalMun,
      populacoes,
    );
    const dfHistorico = this.historicoAnual(dfSerie);
    const dfHistoricoPonderado = this.historicoAnual(dfSeriePonderada);
    const dfMunicipios = this.resumoMunicipios(dfMensalMun);
    const correlacoes = this.calcularCorrelacoes(dfSerie);
    const elnino = this.calcularElNinoComparativo(dfSerie, dfMensalMun);

    // ÔöÇÔöÇ Alertas preditivos (com INMET) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    const alertas_por_geocode = this.montarPacoteAlertas(
      climaMunicipios,
      dfSerie,
      dfMensalMun,
      alertasApi,
      municipios,
      inmetAlertas,
    );
    const alertas = alertas_por_geocode['todos'] ?? [];
    const mapa_df = this.prepararMapa(dfMunicipios);

    const populacaoTotal = municipios.reduce(
      (s, m) => s + (populacoes.get(m.geocode) ?? 0),
      0,
    );

    return {
      versao: 2,
      ano_inicio: ANO_INICIO,
      ano_fim: ANO_FIM,
      municipios,
      municipios_foco: municipios.map((m) => m.municipio),
      municipios_ibge: municipiosIbge,
      df_serie: dfSerie,
      df_serie_ponderada: dfSeriePonderada,
      df_mensal_mun: dfMensalMun,
      df_historico: dfHistorico,
      df_historico_ponderado: dfHistoricoPonderado,
      df_municipios: dfMunicipios,
      mapa_df,
      oni_mensal: oniLinhas,
      oni_anual: oniAnual,
      correlacoes,
      elnino,
      alertas,
      alertas_por_geocode,
      alertas_infodengue: alertasApi,
      inmet_alertas: inmetAlertas,
      clima,
      clima_municipios: climaMunicipios,
      clima_historico: climaHistorico,
      causa_dengue: CAUSA_DENGUE,
      fontes,
      avisos,
      resumo_escopo: {
        qtd_municipios: municipios.length,
        populacao_total: populacaoTotal,
        agregacao_default: populacaoTotal > 0 ? 'ponderada' : 'soma',
        populacoes: municipios.map((m) => ({
          geocode: m.geocode,
          populacao: populacoes.get(m.geocode) ?? 0,
        })),
      },
      atualizado_em: new Date().toISOString(),
    };
  }

  private enriquecerMensal(
    casosRows: CasoMensalMunicipio[],
    climaRows: ClimaMensalMunicipio[],
    oniLinhas: OniMensal[],
    tipoFn: (ano: number) => string,
  ): MensalMunicipio[] {
    const climaMap = new Map(
      climaRows.map((c) => [`${c.geocode}-${c.Ano}-${c.MesNum}`, c]),
    );
    const oniMap = new Map(oniLinhas.map((o) => [`${o.ano}-${o.mes}`, o.oni]));

    return casosRows.map((r) => {
      const clima = climaMap.get(`${r.geocode}-${r.Ano}-${r.MesNum}`);
      const oni = oniMap.get(`${r.Ano}-${r.MesNum}`);
      const tipo = tipoFn(r.Ano);
      return {
        geocode: r.geocode,
        municipio: r.municipio,
        Ano: r.Ano,
        MesNum: r.MesNum,
        Mes: r.Mes || MESES[r.MesNum - 1],
        AnoMes: `${r.Ano}-${String(r.MesNum).padStart(2, '0')}`,
        CasosDengue: r.casos_estimados,
        casos_notificados: r.casos_notificados,
        Temperatura: validarTemperatura(clima?.Temperatura),
        // TempMax so pode ser fabricada (Temperatura + 3) quando ha temperatura
        // real; caso contrario mantem sentinela 0 para nao inventar maxima.
        TempMax: validarTemperatura(
          clima?.TempMax ??
            (clima?.Temperatura != null && Number(clima.Temperatura) > 0
              ? Number(clima.Temperatura) + 3
              : 0),
        ),
        Precipitacao: validarPrecipitacao(clima?.Precipitacao),
        Umidade: validarUmidade(clima?.Umidade),
        ONI: oni != null ? oni : null,
        TipoElNino: tipo,
        ElNino: tipo === 'Com El Nino' ? 1 : 0,
      };
    });
  }

  /**
   * Agrega s├®rie mensal regional usando M├ëDIA PONDERADA pela popula├º├úo:
   *   - CasosDengue: incid├¬ncia por 100k hab ├ù popula├º├úo total ├À 100k (volume compar├ível)
   *   - Temperatura/Precipitacao/Umidade: pondera├º├úo por popula├º├úo
   * Quando n├úo h├í popula├º├Áes conhecidas, cai no comportamento de soma simples.
   */
  private agregarSeriePonderada(
    mensal: MensalMunicipio[],
    populacoes: Map<number, number>,
  ): SerieMensal[] {
    const totalPop = Array.from(populacoes.values()).reduce(
      (s, p) => s + (p || 0),
      0,
    );
    if (totalPop <= 0) return this.agregarSerieRegional(mensal);

    interface Acum {
      MesNum: number;
      Mes: string;
      Ano: number;
      casosPonderado: number;
      tempPonderado: number;
      chuvaPonderada: number;
      umidPonderada: number;
      pesoTotal: number;
      // Pesos por variavel: so acumulam meses com clima real, evitando que
      // meses sem ERA5/Open-Meteo (sentinela 0) dilua a media ponderada.
      pesoTemp: number;
      pesoChuva: number;
      pesoUmid: number;
      oni: number | null;
      tipo: string;
    }
    const map = new Map<string, Acum>();
    for (const r of mensal) {
      const peso = populacoes.get(r.geocode) ?? 0;
      if (peso <= 0) continue;
      const k = `${r.Ano}-${r.MesNum}`;
      if (!map.has(k)) {
        map.set(k, {
          MesNum: r.MesNum,
          Mes: r.Mes,
          Ano: r.Ano,
          casosPonderado: 0,
          tempPonderado: 0,
          chuvaPonderada: 0,
          umidPonderada: 0,
          pesoTotal: 0,
          pesoTemp: 0,
          pesoChuva: 0,
          pesoUmid: 0,
          oni: r.ONI,
          tipo: r.TipoElNino,
        });
      }
      const g = map.get(k)!;
      // Incid├¬ncia por 100k hab ├ù pop, somando ÔÇö devolve n┬║ casos esperados na pop total
      const incidencia = peso > 0 ? (r.CasosDengue / peso) * 100000 : 0;
      g.casosPonderado += (incidencia * peso) / 100000;
      const temClima = climaPresente(r);
      if (r.Temperatura > 0) {
        g.tempPonderado += r.Temperatura * peso;
        g.pesoTemp += peso;
      }
      // Precipitacao 0 e valida (mes seco) desde que o mes tenha clima real.
      if (temClima) {
        g.chuvaPonderada += r.Precipitacao * peso;
        g.pesoChuva += peso;
      }
      if (r.Umidade > 0) {
        g.umidPonderada += r.Umidade * peso;
        g.pesoUmid += peso;
      }
      g.pesoTotal += peso;
    }
    return Array.from(map.values())
      .sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum)
      .map((g) => ({
        MesNum: g.MesNum,
        Mes: g.Mes,
        Ano: g.Ano,
        AnoMes: `${g.Ano}-${String(g.MesNum).padStart(2, '0')}`,
        TipoElNino: g.tipo,
        ElNino: g.tipo === 'Com El Nino' ? 1 : 0,
        ONI: g.oni,
        Temperatura:
          g.pesoTemp > 0 ? round(g.tempPonderado / g.pesoTemp, 1) : 0,
        Precipitacao:
          g.pesoChuva > 0 ? round(g.chuvaPonderada / g.pesoChuva, 1) : 0,
        Umidade: g.pesoUmid > 0 ? Math.round(g.umidPonderada / g.pesoUmid) : 0,
        CasosDengue: Math.round(g.casosPonderado),
      }));
  }

  private agregarSerieRegional(mensal: MensalMunicipio[]): SerieMensal[] {
    const map = new Map<
      string,
      {
        MesNum: number;
        Mes: string;
        Ano: number;
        casos: number;
        temps: number[];
        chuvas: number[];
        umids: number[];
        oni: number | null;
        tipo: string;
      }
    >();
    for (const r of mensal) {
      const k = `${r.Ano}-${r.MesNum}`;
      if (!map.has(k)) {
        map.set(k, {
          MesNum: r.MesNum,
          Mes: r.Mes,
          Ano: r.Ano,
          casos: 0,
          temps: [],
          chuvas: [],
          umids: [],
          oni: r.ONI,
          tipo: r.TipoElNino,
        });
      }
      const g = map.get(k)!;
      g.casos += r.CasosDengue;
      // So agrega variavel de clima quando ha dado real (evita diluir com 0).
      if (r.Temperatura > 0) g.temps.push(r.Temperatura);
      if (climaPresente(r)) g.chuvas.push(r.Precipitacao);
      if (r.Umidade > 0) g.umids.push(r.Umidade);
    }
    const mediaArr = (arr: number[], casas: number): number =>
      arr.length
        ? round(arr.reduce((a, b) => a + b, 0) / arr.length, casas)
        : 0;
    return Array.from(map.values())
      .sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum)
      .map((g) => ({
        MesNum: g.MesNum,
        Mes: g.Mes,
        Ano: g.Ano,
        AnoMes: `${g.Ano}-${String(g.MesNum).padStart(2, '0')}`,
        TipoElNino: g.tipo,
        ElNino: g.tipo === 'Com El Nino' ? 1 : 0,
        ONI: g.oni,
        Temperatura: mediaArr(g.temps, 1),
        Precipitacao: mediaArr(g.chuvas, 1),
        Umidade: Math.round(mediaArr(g.umids, 0)),
        CasosDengue: g.casos,
      }));
  }

  private historicoAnual(serie: SerieMensal[]): HistoricoAnual[] {
    const map = new Map<
      number,
      {
        casos: number;
        temps: number[];
        chuvas: number[];
        oni: number[];
        tipo: string;
      }
    >();
    for (const r of serie) {
      if (!map.has(r.Ano)) {
        map.set(r.Ano, {
          casos: 0,
          temps: [],
          chuvas: [],
          oni: [],
          tipo: r.TipoElNino,
        });
      }
      const g = map.get(r.Ano)!;
      g.casos += r.CasosDengue;
      if (r.Temperatura > 0) g.temps.push(r.Temperatura);
      if (climaPresente(r)) g.chuvas.push(r.Precipitacao);
      if (r.ONI != null) g.oni.push(r.ONI);
    }
    return Array.from(map.entries())
      .map(([ano, g]) => {
        const oniMedio = g.oni.length
          ? round(g.oni.reduce((a, b) => a + b, 0) / g.oni.length, 2)
          : null;
        return {
          Ano: ano,
          // Regime anual pelo ONI médio (não pelo TipoElNino do 1º mês).
          TipoElNino: tipoElNinoAnual(oniMedio),
          ONIMedio: oniMedio,
          TemperaturaMedia: g.temps.length
            ? round(g.temps.reduce((a, b) => a + b, 0) / g.temps.length, 1)
            : 0,
          PrecipitacaoAnual: round(
            g.chuvas.reduce((a, b) => a + b, 0),
            1,
          ),
          CasosDengueTotal: g.casos,
        };
      })
      .sort((a, b) => a.Ano - b.Ano);
  }

  private resumoMunicipios(mensal: MensalMunicipio[]): ResumoMunicipio[] {
    const map = new Map<number, ResumoMunicipio>();
    for (const r of mensal) {
      if (!map.has(r.geocode)) {
        map.set(r.geocode, {
          geocode: r.geocode,
          municipio: r.municipio,
          casos_estimados: 0,
          casos_notificados: 0,
        });
      }
      const g = map.get(r.geocode)!;
      g.casos_estimados += r.CasosDengue;
      g.casos_notificados += r.casos_notificados;
    }
    return Array.from(map.values()).sort(
      (a, b) => b.casos_estimados - a.casos_estimados,
    );
  }

  private calcularCorrelacoes(serie: SerieMensal[]): CorrelacaoClima[] {
    if (serie.length < 6) return [];
    const casos = serie.map((r) => r.CasosDengue);
    const out: CorrelacaoClima[] = [];
    for (const [col, nome] of [
      ['Temperatura', 'Temperatura (°C)'],
      ['Precipitacao', 'Precipitação (mm)'],
      ['Umidade', 'Umidade (%)'],
      ['ONI', 'ONI (El Niño)'],
    ] as const) {
      const valores = serie.map((x) => {
        if (col === 'ONI') return x.ONI;
        // Precipitacao 0 e valida quando o mes tem clima; senao null.
        if (col === 'Precipitacao')
          return climaPresente(x) ? x.Precipitacao : null;
        // Temperatura/Umidade: sentinela <=0 vira null (mes sem dado climatico).
        return valorClimaOuNull(x[col]);
      });
      const n = contarParesFinitos(valores, casos);
      const r = pearson(valores, casos);
      // Exige um piso de pares com dado real: evita r espurio de poucos meses.
      if (r != null && n >= MIN_PARES_CORRELACAO) {
        out.push({
          variavel_clima: nome,
          correlacao: r,
          interpretacao: interpretarR(r),
          n,
        });
      }
    }
    return out;
  }

  /**
   * Correlação de Pearson com defasagem: CasosDengue[t] × variável[t − lag].
   * lag 0 = contemporâneo; lag 2 = clima de há 2 meses × casos atuais.
   */
  calcularCorrelacaoLag(
    serie: SerieMensal[],
    maxLag = 6,
  ): Array<{
    variavel: string;
    lag: number;
    r: number | null;
    n: number;
  }> {
    const ordenada = [...serie].sort(
      (a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum,
    );
    if (ordenada.length < 6) return [];

    const variaveis: Array<{
      chave: keyof SerieMensal;
      rotulo: string;
    }> = [
      { chave: 'Precipitacao', rotulo: 'Precipitação' },
      { chave: 'Temperatura', rotulo: 'Temperatura' },
      { chave: 'Umidade', rotulo: 'Umidade' },
      { chave: 'ONI', rotulo: 'ONI' },
    ];

    const out: Array<{
      variavel: string;
      lag: number;
      r: number | null;
      n: number;
    }> = [];

    for (const { chave, rotulo } of variaveis) {
      for (let lag = 0; lag <= maxLag; lag += 1) {
        const xs: Array<number | null> = [];
        const ys: Array<number | null> = [];
        for (let t = lag; t < ordenada.length; t += 1) {
          const linha = ordenada[t - lag];
          const xVal = linha[chave];
          const yVal = ordenada[t].CasosDengue;
          let xLimpo: number | null;
          if (chave === 'ONI') {
            xLimpo =
              xVal == null || !Number.isFinite(Number(xVal))
                ? null
                : Number(xVal);
          } else if (chave === 'Precipitacao') {
            xLimpo = climaPresente(linha) ? Number(xVal) : null;
          } else {
            // Temperatura/Umidade: sentinela <=0 = mes sem dado climatico.
            xLimpo = valorClimaOuNull(xVal);
          }
          xs.push(xLimpo);
          ys.push(Number.isFinite(Number(yVal)) ? Number(yVal) : null);
        }
        const paresValidos = xs.filter(
          (x, i) => x != null && ys[i] != null,
        ).length;
        const r = pearson(xs, ys);
        out.push({
          variavel: rotulo,
          lag,
          r: r != null ? round(r, 3) : null,
          n: paresValidos,
        });
      }
    }

    return out;
  }

  private calcularElNinoComparativo(
    serie: SerieMensal[],
    mensal: MensalMunicipio[],
  ): AnaliseElNino {
    const correlacoes: CorrelacaoElNino[] = [];
    for (const [col, label] of [
      ['CasosDengue', 'Casos dengue × El Niño'],
      ['Temperatura', 'Temperatura × El Niño'],
      ['Precipitacao', 'Precipitação × El Niño'],
      ['ONI', 'ONI × casos'],
    ] as const) {
      const xs =
        col === 'ONI' ? serie.map((x) => x.ONI) : serie.map((x) => x.ElNino);
      const ys =
        col === 'ONI'
          ? serie.map((x) => x.CasosDengue)
          : serie.map((x) => {
              if (col === 'CasosDengue') return x.CasosDengue;
              if (col === 'Precipitacao')
                return climaPresente(x) ? x.Precipitacao : null;
              return valorClimaOuNull(x[col]);
            });
      const r = pearson(xs, ys);
      if (r != null) {
        correlacoes.push({
          variavel: label,
          correlacao: r,
          interpretacao: interpretarR(r),
        });
      }
    }

    const sem = serie.filter((r) => r.TipoElNino !== 'Com El Nino');
    const com = serie.filter((r) => r.TipoElNino === 'Com El Nino');
    const media = (arr: SerieMensal[], col: keyof SerieMensal) =>
      arr.length
        ? round(
            arr.reduce((s, r) => s + Number(r[col] ?? 0), 0) / arr.length,
            1,
          )
        : 0;
    // Media de clima ignorando meses sem dado (sentinela) para nao subestimar.
    const mediaClima = (
      arr: SerieMensal[],
      col: 'Temperatura' | 'Precipitacao',
    ) => {
      const vals = arr
        .filter((r) =>
          col === 'Precipitacao' ? climaPresente(r) : r.Temperatura > 0,
        )
        .map((r) => Number(r[col]));
      return vals.length
        ? round(vals.reduce((s, v) => s + v, 0) / vals.length, 1)
        : 0;
    };

    const anosSem = Array.from(new Set(sem.map((r) => r.Ano))).sort();
    const anosCom = Array.from(new Set(com.map((r) => r.Ano))).sort();

    const casosMediaSem = media(sem, 'CasosDengue');
    const casosMediaCom = media(com, 'CasosDengue');

    const resumo: ResumoElNino = {
      casos_media_mensal_sem: casosMediaSem,
      casos_media_mensal_com: casosMediaCom,
      temp_media_sem: mediaClima(sem, 'Temperatura'),
      temp_media_com: mediaClima(com, 'Temperatura'),
      chuva_media_sem: mediaClima(sem, 'Precipitacao'),
      chuva_media_com: mediaClima(com, 'Precipitacao'),
      anos_sem: anosSem.length ? `${anosSem[0]}–${anosSem.at(-1)}` : '—',
      anos_com: anosCom.length ? `${anosCom[0]}–${anosCom.at(-1)}` : '—',
      variacao_casos_pct:
        casosMediaSem > 0
          ? round(((casosMediaCom - casosMediaSem) / casosMediaSem) * 100, 1)
          : 0,
    };

    const compMesMap = new Map<
      string,
      {
        MesNum: number;
        Mes: string;
        ElNino: number;
        casos: number[];
        temps: number[];
      }
    >();
    for (const r of serie) {
      const k = `${r.MesNum}|${r.Mes}|${r.ElNino}`;
      if (!compMesMap.has(k))
        compMesMap.set(k, {
          MesNum: r.MesNum,
          Mes: r.Mes,
          ElNino: r.ElNino,
          casos: [],
          temps: [],
        });
      const g = compMesMap.get(k)!;
      g.casos.push(r.CasosDengue);
      if (r.Temperatura > 0) g.temps.push(r.Temperatura);
    }
    const comparativo_mensal: ComparativoMensal[] = Array.from(
      compMesMap.values(),
    )
      .map((g) => ({
        MesNum: g.MesNum,
        Mes: g.Mes,
        ElNino: g.ElNino,
        Periodo: (g.ElNino ? 'Com El Nino' : 'Sem El Nino') as
          | 'Com El Nino'
          | 'Sem El Nino',
        CasosDengue: g.casos.length
          ? Math.round(g.casos.reduce((a, b) => a + b, 0) / g.casos.length)
          : 0,
        Temperatura: g.temps.length
          ? round(g.temps.reduce((a, b) => a + b, 0) / g.temps.length, 1)
          : 0,
      }))
      .sort((a, b) => a.MesNum - b.MesNum || a.ElNino - b.ElNino);

    const compMunMap = new Map<string, number>();
    for (const r of mensal) {
      const k = `${r.municipio}|${r.TipoElNino}`;
      compMunMap.set(k, (compMunMap.get(k) ?? 0) + r.CasosDengue);
    }
    const comparativo_municipio: ComparativoMunicipio[] = Array.from(
      compMunMap.entries(),
    )
      .map(([k, casos]) => {
        const [municipio, tipo] = k.split('|');
        return { municipio, TipoElNino: tipo, CasosDengue: casos };
      })
      .sort((a, b) => b.CasosDengue - a.CasosDengue);

    return { correlacoes, comparativo_mensal, comparativo_municipio, resumo };
  }

  private prepararMapa(municipios: ResumoMunicipio[]): MapaMunicipio[] {
    if (!municipios.length) return [];
    const max = Math.max(...municipios.map((m) => m.casos_estimados), 1);
    return municipios
      .map((m) => ({
        ...m,
        geocode_padded: String(m.geocode).padStart(7, '0'),
        intensidade: round(m.casos_estimados / max, 4),
      }))
      .sort((a, b) => b.casos_estimados - a.casos_estimados);
  }

  private montarPacoteAlertas(
    climaMunicipios: Record<number, ClimaForecast>,
    serie: SerieMensal[],
    mensal: MensalMunicipio[],
    alertasApi: AlertaInfodengue[],
    municipios: MunicipioFoco[],
    inmetAlertas: InmetAlerta[] = [],
  ): Record<string, AlertaPreditivo[]> {
    const climaRef = municipios.length
      ? climaMunicipios[municipios[0].geocode]
      : undefined;
    const out: Record<string, AlertaPreditivo[]> = {
      todos: this.alertasService.gerarAlertas(
        climaRef,
        serie,
        mensal,
        alertasApi,
        'todos',
        '',
        inmetAlertas,
      ),
    };
    for (const mun of municipios) {
      const climaMun = climaMunicipios[mun.geocode] ?? climaRef;
      // Filtra alertas INMET para o munic├¡pio espec├¡fico
      const inmetMun = inmetAlertas.filter((a) =>
        a.municipios.includes(mun.geocode),
      );
      out[String(mun.geocode)] = this.alertasService.gerarAlertas(
        climaMun,
        mensal.filter((r) => r.geocode === mun.geocode),
        mensal,
        alertasApi,
        mun.geocode,
        mun.municipio,
        inmetMun,
      );
    }
    return out;
  }

  /**
   * Previsão ao vivo (14 dias) — único uso de API externa no endpoint /clima.
   */
  async obterPrevisaoClima(pacote: PacoteOverview, geocode: number) {
    const fallbackGc = pacote.municipios[0]?.geocode;
    const gc = Number(geocode) || fallbackGc;
    if (!gc) return null;

    const mun =
      pacote.municipios.find((m) => m.geocode === gc) ??
      pacote.municipios.find((m) => m.geocode === fallbackGc);
    if (mun?.lat != null && mun?.lon != null) {
      try {
        return await this.openMeteo.buscarPrevisaoMunicipio(mun, false);
      } catch (err) {
        this.logger.warn(
          `Forecast ao vivo falhou para ${mun.municipio}: ${(err as Error).message}`,
        );
      }
    }
    return (
      pacote.clima_municipios[gc] ??
      (fallbackGc ? pacote.clima_municipios[fallbackGc] : null) ??
      null
    );
  }

  /** @deprecated Histórico via GET /clima-historico (JSON). Use obterPrevisaoClima. */
  async obterDadosGraficoClima(
    pacote: PacoteOverview,
    geocode: number,
    ano: number | 'previsao',
  ) {
    if (ano !== 'previsao' && ano) {
      const mun = pacote.municipios.find((m) => m.geocode === Number(geocode));
      const nome = mun?.municipio ?? 'Município';
      const fatia = pacote.clima_historico.filter(
        (c) => c.geocode === Number(geocode) && c.Ano === Number(ano),
      );
      const casosMap = new Map(
        pacote.df_mensal_mun
          .filter((r) => r.geocode === Number(geocode) && r.Ano === Number(ano))
          .map((r) => [r.MesNum, r.CasosDengue]),
      );
      return {
        fonte: 'JSON local — clima histórico',
        cidade: nome,
        geocode: Number(geocode),
        ano: Number(ano),
        modo: 'historico' as const,
        dias: fatia.map((c) => {
          // Sem temperatura real nao fabricamos min/max/media (evita 3 °C / -3 °C ficticios).
          const temTemp = c.Temperatura > 0;
          return {
            data: `${ano}-${String(c.MesNum).padStart(2, '0')}`,
            periodo: c.Mes,
            cidade: nome,
            max_c: temTemp
              ? validarTemperatura(c.TempMax || c.Temperatura + 3)
              : 0,
            min_c: temTemp ? validarTemperatura(c.Temperatura - 3) : 0,
            temp_media: c.Temperatura,
            chuva_mm: c.Precipitacao,
            umidade_pct: c.Umidade,
            casos: casosMap.get(c.MesNum) ?? null,
          };
        }),
      };
    }
    return this.obterPrevisaoClima(pacote, geocode);
  }
}
