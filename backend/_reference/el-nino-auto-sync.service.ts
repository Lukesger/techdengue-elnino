import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { CacheService } from '../../../shared/services/cache.service';
import { CACHE_KEYS, CACHE_TTL, MUNICIPIOS_ELNINO } from './constants';
import { ClimaForecastStoreService } from './clima-forecast-store.service';
import {
  AutoSyncState,
  estadoInicial,
  fingerprintMesConsolidado,
  fingerprintPoiAreaMapeada,
  mesConsolidadoAvancou,
  MesConsolidado,
  poiAreaAvancou,
  timestampStale,
} from './el-nino-auto-sync.helpers';
import { ElNinoPipelineService } from './el-nino-pipeline.service';
import { ElNinoPoiHectareStoreService } from './el-nino-poi-hectare-store.service';
import { ElNinoVisaoGerencialStoreService } from './el-nino-visao-gerencial-store.service';
import { InfodengueService } from './infodengue.service';
import { NoaaOniService } from './noaa-oni.service';
import { OpenMeteoService } from './open-meteo.service';

const STATE_FILE = 'auto_sync_state.json';
/** Throttle padrão do probe de freshness no hot path (5 min). */
const FRESHNESS_PROBE_MIN_MS_DEFAULT = 5 * 60 * 1000;

export type FreshnessAvaliacao = {
  precisaRebuild: boolean;
};

/**
 * Bloco único de auto-sync El Niño:
 * - Poll Infodengue (listener de mês consolidado) a cada 6h
 * - Sync completo diário 04:00 (rede de segurança)
 * - Rematerializa POI + área mapeada (hectares) a cada 24h (03:00);
 *   se fingerprint avançar (novos POIs ⇒ nova área), invalida mapa/gerencial
 * - Atualiza casos + ONI + clima/chuva + forecast e invalida caches
 * - Gate de freshness no acesso (avaliarFreshnessInfodengue)
 */
@Injectable()
export class ElNinoAutoSyncService {
  private readonly logger = new Logger(ElNinoAutoSyncService.name);
  private emExecucao = false;
  private emExecucaoPoi = false;
  /** Timestamp do último probe AlertCity (throttle em memória). */
  private ultimoProbeAt = 0;
  /** Singleflight: probes concorrentes compartilham a mesma Promise. */
  private probeInFlight: Promise<MesConsolidado | null> | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => ElNinoPipelineService))
    private readonly pipeline: ElNinoPipelineService,
    private readonly infodengue: InfodengueService,
    private readonly noaa: NoaaOniService,
    private readonly openMeteo: OpenMeteoService,
    private readonly climaForecastStore: ClimaForecastStoreService,
    private readonly poiHectareStore: ElNinoPoiHectareStoreService,
    private readonly visaoGerencialStore: ElNinoVisaoGerencialStoreService,
    private readonly cache: CacheService,
  ) {}

  private freshnessProbeMinMs(): number {
    const n = Number(
      process.env.ELNINO_FRESHNESS_PROBE_MIN_MS ??
        FRESHNESS_PROBE_MIN_MS_DEFAULT,
    );
    return Number.isFinite(n) && n >= 0 ? n : FRESHNESS_PROBE_MIN_MS_DEFAULT;
  }

  private probePermitido(agora = Date.now()): boolean {
    if (this.ultimoProbeAt <= 0) return true;
    return agora - this.ultimoProbeAt >= this.freshnessProbeMinMs();
  }

  private async probeMesConsolidadoSingleflight(): Promise<MesConsolidado | null> {
    if (this.probeInFlight != null) return this.probeInFlight;
    this.probeInFlight = this.probeMesConsolidadoInfodengue().finally(() => {
      this.probeInFlight = null;
    });
    return this.probeInFlight;
  }

  /**
   * Gate de freshness no hot path (overview):
   * - Dentro do throttle: não chama AlertCity; só compara pacote vs auto_sync_state.
   * - Fora do throttle: probe Infodengue (singleflight); se mês avançou,
   *   invalida caches e atualiza estado — o caller faz rebuild só do escopo.
   * Não dispara syncCompleto (pesado / escopo foco fixo).
   */
  async avaliarFreshnessInfodengue(
    fingerprintDoPacote: MesConsolidado | null,
  ): Promise<FreshnessAvaliacao> {
    const estado = this.lerEstado();
    const estadoAdiantado = mesConsolidadoAvancou(
      fingerprintDoPacote,
      estado.ultimo_mes_consolidado,
    );

    if (!this.probePermitido()) {
      if (estadoAdiantado) {
        this.logger.log(
          `Freshness (throttle): estado adiantado vs pacote ` +
            `${fingerprintDoPacote?.chave ?? 'null'} → ${estado.ultimo_mes_consolidado?.chave} — invalidando`,
        );
        this.invalidarCachesElNino();
        return { precisaRebuild: true };
      }
      return { precisaRebuild: false };
    }

    try {
      const mesNovo = await this.probeMesConsolidadoSingleflight();
      this.ultimoProbeAt = Date.now();
      const iso = new Date().toISOString();

      if (mesConsolidadoAvancou(estado.ultimo_mes_consolidado, mesNovo)) {
        this.logger.log(
          `Freshness: Infodengue mês avançou ` +
            `${estado.ultimo_mes_consolidado?.chave ?? 'null'} → ${mesNovo?.chave}`,
        );
        this.invalidarCachesElNino();
        this.gravarEstado({
          ...estado,
          ultimo_mes_consolidado: mesNovo,
          ultimo_probe_em: iso,
          ultimo_motivo: 'freshness-probe-mes-novo',
        });
        return { precisaRebuild: true };
      }

      // Cron já avançou o estado, ou probe > pacote mesmo sem avançar o estado conhecido.
      const pacoteAtrasado =
        mesConsolidadoAvancou(
          fingerprintDoPacote,
          estado.ultimo_mes_consolidado,
        ) || mesConsolidadoAvancou(fingerprintDoPacote, mesNovo);

      if (pacoteAtrasado) {
        this.logger.log(
          `Freshness: pacote atrasado vs estado/probe ` +
            `(pacote=${fingerprintDoPacote?.chave ?? 'null'}, ` +
            `estado=${estado.ultimo_mes_consolidado?.chave ?? 'null'}, ` +
            `probe=${mesNovo?.chave ?? 'null'}) — invalidando`,
        );
        this.invalidarCachesElNino();
        const mesParaEstado =
          mesNovo &&
          (!estado.ultimo_mes_consolidado ||
            mesNovo.chave >= estado.ultimo_mes_consolidado.chave)
            ? mesNovo
            : estado.ultimo_mes_consolidado;
        this.gravarEstado({
          ...estado,
          ultimo_mes_consolidado: mesParaEstado,
          ultimo_probe_em: iso,
          ultimo_motivo: 'freshness-pacote-atrasado',
        });
        return { precisaRebuild: true };
      }

      this.gravarEstado({
        ...estado,
        ultimo_probe_em: iso,
      });
      return { precisaRebuild: false };
    } catch (err) {
      this.logger.warn(`Freshness probe falhou: ${(err as Error).message}`);
      if (estadoAdiantado) {
        this.invalidarCachesElNino();
        return { precisaRebuild: true };
      }
      return { precisaRebuild: false };
    }
  }

  private cronEnabled(): boolean {
    return (
      String(
        process.env.ELNINO_ANALYTICS_CRON_ENABLED ?? 'true',
      ).toLowerCase() === 'true'
    );
  }

  private resolveDir(): string {
    const configured = (
      this.config.get<string>('EL_NINO_DATA_DIR') ?? ''
    ).trim();
    if (configured) return path.resolve(configured);
    return path.join(process.cwd(), 'data', 'el-nino');
  }

  private statePath(): string {
    return path.join(this.resolveDir(), STATE_FILE);
  }

  lerEstado(): AutoSyncState {
    try {
      const arquivo = this.statePath();
      if (!fs.existsSync(arquivo)) return estadoInicial();
      const raw = JSON.parse(
        fs.readFileSync(arquivo, 'utf-8'),
      ) as AutoSyncState;
      return {
        ...estadoInicial(),
        ...raw,
        ultimo_mes_consolidado: raw.ultimo_mes_consolidado ?? null,
      };
    } catch (err) {
      this.logger.warn(`Falha ao ler ${STATE_FILE}: ${(err as Error).message}`);
      return estadoInicial();
    }
  }

  gravarEstado(estado: AutoSyncState): void {
    try {
      const dir = this.resolveDir();
      fs.mkdirSync(dir, { recursive: true });
      const arquivo = this.statePath();
      const tmp = `${arquivo}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
      fs.renameSync(tmp, arquivo);
    } catch (err) {
      this.logger.warn(
        `Falha ao gravar ${STATE_FILE}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Consulta Infodengue ao vivo (amostra MUNICIPIOS_ELNINO) e retorna
   * o fingerprint do último mês consolidado.
   */
  async probeMesConsolidadoInfodengue(): Promise<MesConsolidado | null> {
    const casos = await this.infodengue.carregarCasosMensais(
      MUNICIPIOS_ELNINO,
      {
        forceRefresh: true,
      },
    );
    return fingerprintMesConsolidado(casos);
  }

  /** Invalida caches em memória relacionados ao El Niño Analytics. */
  invalidarCachesElNino(): void {
    this.cache.deletePattern('^elnino:overview');
    this.cache.deletePattern('^elnino:casos-mensais');
    this.cache.deletePattern('^elnino:serie-consorcio');
    this.cache.deletePattern('^elnino:mapa-projecao');
    this.cache.deletePattern('^elnino:projecao-mapa');
    this.cache.delete(CACHE_KEYS.ONI);
    this.cache.deletePattern('^elnino:clima-forecast');
    this.cache.deletePattern('^elnino:clima-historico');
    this.visaoGerencialStore.invalidar();
    this.logger.log(
      'Caches El Niño invalidados (overview/casos/série/mapa/ONI/clima).',
    );
  }

  async refreshForecastMunicipios(): Promise<number> {
    const previsoes: Awaited<
      ReturnType<OpenMeteoService['buscarPrevisaoMunicipio']>
    >[] = [];
    for (const mun of MUNICIPIOS_ELNINO) {
      try {
        const fc = await this.openMeteo.buscarPrevisaoMunicipio(mun, true);
        previsoes.push(fc);
      } catch (err) {
        this.logger.warn(
          `Forecast falhou ${mun.geocode}: ${(err as Error).message}`,
        );
      }
    }
    if (previsoes.length) {
      this.climaForecastStore.salvarMesclado(previsoes, {
        fonte: 'Open-Meteo Forecast (auto-sync)',
      });
    }
    return previsoes.length;
  }

  async syncCompleto(motivo: string): Promise<void> {
    const inicio = Date.now();
    const pacote = await this.pipeline.refresh({
      municipios: MUNICIPIOS_ELNINO,
      forceRefresh: true,
    });

    await this.noaa.carregarOniMensal(true);
    const nForecast = await this.refreshForecastMunicipios();
    this.invalidarCachesElNino();

    const mes =
      fingerprintMesConsolidado(
        pacote.df_mensal_mun?.map((r) => ({
          Ano: r.Ano,
          MesNum: r.MesNum,
          casos_notificados: r.casos_notificados ?? r.CasosDengue,
          casos_estimados: r.CasosDengue,
        })) ?? [],
      ) ?? this.lerEstado().ultimo_mes_consolidado;

    const agora = new Date().toISOString();
    const poiPayload = this.poiHectareStore.carregarMapa();
    const fpFromStore = fingerprintPoiAreaMapeada([...poiPayload.values()]);
    this.gravarEstado({
      ultimo_mes_consolidado: mes,
      ultimo_sync_em: agora,
      ultimo_oni_em: agora,
      ultimo_clima_forecast_em: agora,
      ultimo_poi_hectare_em: agora,
      ultimo_poi_area: fpFromStore,
      ultimo_motivo: motivo,
    });

    const elapsed = ((Date.now() - inicio) / 1000).toFixed(1);
    this.logger.log(
      `Auto-sync completo (${motivo}) em ${elapsed}s — mes=${mes ? `${mes.ano}-${mes.mes}` : 'n/a'}, ` +
        `${pacote.df_serie?.length ?? 0} meses série, ${pacote.df_municipios?.length ?? 0} mun., ` +
        `forecast=${nForecast}, fontes=${(pacote.fontes ?? []).slice(0, 4).join('; ')}`,
    );
    if (pacote.avisos?.length) {
      this.logger.warn(`Avisos auto-sync: ${pacote.avisos.join(' | ')}`);
    }
  }

  async syncLeve(): Promise<void> {
    const estado = this.lerEstado();
    const agora = Date.now();
    let oniOk = false;
    let forecastOk = false;

    if (timestampStale(estado.ultimo_oni_em, CACHE_TTL.ONI_MS, agora)) {
      await this.noaa.carregarOniMensal(true);
      this.cache.delete(CACHE_KEYS.ONI);
      oniOk = true;
    }

    if (
      timestampStale(
        estado.ultimo_clima_forecast_em,
        CACHE_TTL.CLIMA_FORECAST_MS,
        agora,
      )
    ) {
      await this.refreshForecastMunicipios();
      this.cache.deletePattern('^elnino:clima-forecast');
      forecastOk = true;
    }

    if (!oniOk && !forecastOk) {
      this.logger.debug('Sync leve: ONI e forecast ainda frescos — skip.');
      return;
    }

    const iso = new Date().toISOString();
    this.gravarEstado({
      ...estado,
      ultimo_oni_em: oniOk ? iso : estado.ultimo_oni_em,
      ultimo_clima_forecast_em: forecastOk
        ? iso
        : estado.ultimo_clima_forecast_em,
      ultimo_motivo: 'leve',
    });
    this.logger.log(
      `Auto-sync leve — oni=${oniOk ? 'refresh' : 'ok'}, forecast=${forecastOk ? 'refresh' : 'ok'}`,
    );
  }

  /**
   * Rematerializa POI + área mapeada (hectares) da view GIS.
   * Se o fingerprint avançar (novos POIs ⇒ nova área), invalida mapa/gerencial.
   */
  async syncPoiHectare(motivo = 'poi-area-24h'): Promise<{
    avancou: boolean;
    fingerprint: ReturnType<typeof fingerprintPoiAreaMapeada>;
  }> {
    const inicio = Date.now();
    const estado = this.lerEstado();
    const anterior = estado.ultimo_poi_area;

    const payload = await this.poiHectareStore.materializarDaView();
    const atual = fingerprintPoiAreaMapeada(payload?.municipios ?? []);
    const avancou = poiAreaAvancou(anterior, atual);

    this.cache.deletePattern('^elnino:mapa-projecao');
    this.cache.deletePattern('^elnino:projecao-mapa');
    this.cache.deletePattern('^elnino:overview');
    this.visaoGerencialStore.invalidar();

    const agora = new Date().toISOString();
    this.gravarEstado({
      ...estado,
      ultimo_poi_hectare_em: agora,
      ultimo_poi_area: atual,
      ultimo_motivo: avancou ? `${motivo}:novas-areas-pois` : motivo,
    });

    const elapsed = ((Date.now() - inicio) / 1000).toFixed(1);
    if (avancou) {
      this.logger.log(
        `Auto-sync POI/área mapeada (${motivo}) em ${elapsed}s — NOVOS dados: ` +
          `mun ${anterior?.n_municipios ?? 0}→${atual.n_municipios}, ` +
          `pois ${anterior?.total_pois ?? 0}→${atual.total_pois}, ` +
          `ha ${anterior?.total_hectares ?? 0}→${atual.total_hectares}`,
      );
    } else {
      this.logger.log(
        `Auto-sync POI/área mapeada (${motivo}) em ${elapsed}s — sem novidade ` +
          `(${atual.n_municipios} mun., ${atual.total_pois} pois, ${atual.total_hectares} ha).`,
      );
    }
    return { avancou, fingerprint: atual };
  }

  /**
   * Força refresh do ONI NOAA, grava snapshot em data/el-nino/oni_atual.json
   * e atualiza auto_sync_state (ultimo_oni_em).
   */
  async syncOniSemanal(motivo = 'oni-semanal'): Promise<{
    ano: number;
    mes: number;
    oni: number;
  } | null> {
    const inicio = Date.now();
    const payload = await this.noaa.carregarOniMensal(true);

    const ultimo = payload?.linhas?.length
      ? [...payload.linhas].sort(
          (a, b) => a.ano - b.ano || a.mes - b.mes,
        ).at(-1)!
      : null;

    const agora = new Date().toISOString();
    const snapshot = {
      fonte: payload?.fonte ?? 'NOAA CPC',
      consultado_em: agora,
      motivo,
      atual: ultimo
        ? {
            ano: ultimo.ano,
            mes: ultimo.mes,
            rotulo: `${String(ultimo.mes).padStart(2, '0')}/${ultimo.ano}`,
            oni: ultimo.oni,
          }
        : null,
    };

    try {
      const dir = this.resolveDir();
      fs.mkdirSync(dir, { recursive: true });
      const arquivo = path.join(dir, 'oni_atual.json');
      const tmp = `${arquivo}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf-8');
      fs.renameSync(tmp, arquivo);
    } catch (err) {
      this.logger.warn(
        `Falha ao gravar oni_atual.json: ${(err as Error).message}`,
      );
    }

    const estado = this.lerEstado();
    this.gravarEstado({
      ...estado,
      ultimo_oni_em: agora,
      ultimo_motivo: motivo,
    });

    const elapsed = ((Date.now() - inicio) / 1000).toFixed(1);
    if (ultimo) {
      this.logger.log(
        `ONI semanal (${motivo}) em ${elapsed}s — ${ultimo.ano}/${String(ultimo.mes).padStart(2, '0')} = ${ultimo.oni}`,
      );
      return { ano: ultimo.ano, mes: ultimo.mes, oni: ultimo.oni };
    }
    this.logger.warn(`ONI semanal (${motivo}) em ${elapsed}s — sem linhas.`);
    return null;
  }

  /**
   * Listener Infodengue: se o mês consolidado avançou → sync completo;
   * senão → sync leve (ONI/forecast).
   */
  async pollInfodengueESync(): Promise<'completo' | 'leve' | 'skip'> {
    if (!this.cronEnabled()) return 'skip';
    if (this.emExecucao) {
      this.logger.debug('Auto-sync já em execução — poll ignorado.');
      return 'skip';
    }

    this.emExecucao = true;
    try {
      const estado = this.lerEstado();
      const mesNovo = await this.probeMesConsolidadoInfodengue();
      const avancou = mesConsolidadoAvancou(
        estado.ultimo_mes_consolidado,
        mesNovo,
      );

      if (avancou) {
        this.logger.log(
          `Infodengue mês avançou: ${estado.ultimo_mes_consolidado?.chave ?? 'null'} → ${mesNovo?.chave}`,
        );
        await this.syncCompleto('infodengue-mes-novo');
        return 'completo';
      }

      await this.syncLeve();
      return 'leve';
    } finally {
      this.emExecucao = false;
    }
  }

  @Cron(process.env.ELNINO_AUTO_SYNC_POLL_CRON || '0 */6 * * *', {
    name: 'el-nino-auto-sync-poll',
    timeZone: 'America/Sao_Paulo',
  })
  async cronPoll(): Promise<void> {
    if (!this.cronEnabled()) {
      this.logger.debug(
        'Auto-sync El Niño desabilitado (ELNINO_ANALYTICS_CRON_ENABLED=false).',
      );
      return;
    }
    try {
      await this.pollInfodengueESync();
    } catch (err) {
      this.logger.error(
        `Falha no poll Infodengue auto-sync: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM, {
    name: 'el-nino-auto-sync-diario',
    timeZone: 'America/Sao_Paulo',
  })
  async cronDiario(): Promise<void> {
    if (!this.cronEnabled()) {
      this.logger.debug(
        'Auto-sync El Niño desabilitado (ELNINO_ANALYTICS_CRON_ENABLED=false).',
      );
      return;
    }
    if (this.emExecucao) {
      this.logger.debug('Auto-sync já em execução — diário adiado.');
      return;
    }
    this.emExecucao = true;
    try {
      await this.syncCompleto('diario');
    } catch (err) {
      this.logger.error(
        `Falha no sync diário El Niño: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.emExecucao = false;
    }
  }

  /** A cada 24h: rematerializa POI + área mapeada (novos POIs ⇒ nova área). */
  @Cron(
    process.env.ELNINO_POI_HECTARE_CRON || CronExpression.EVERY_DAY_AT_3AM,
    {
      name: 'el-nino-auto-sync-poi-hectare',
      timeZone: 'America/Sao_Paulo',
    },
  )
  async cronPoiHectare(): Promise<void> {
    if (!this.cronEnabled()) {
      this.logger.debug(
        'Auto-sync El Niño desabilitado (ELNINO_ANALYTICS_CRON_ENABLED=false).',
      );
      return;
    }
    if (this.emExecucaoPoi || this.emExecucao) {
      this.logger.debug('Auto-sync POI/área mapeada adiado (já em execução).');
      return;
    }
    this.emExecucaoPoi = true;
    try {
      await this.syncPoiHectare('poi-area-24h');
    } catch (err) {
      this.logger.error(
        `Falha no sync POI/área mapeada: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.emExecucaoPoi = false;
    }
  }

  /**
   * Segunda-feira 05:00 (America/Sao_Paulo): atualiza ONI NOAA + snapshot.
   * Override: ELNINO_ONI_WEEKLY_CRON (cron expr).
   */
  @Cron(process.env.ELNINO_ONI_WEEKLY_CRON || '0 5 * * 1', {
    name: 'el-nino-oni-semanal',
    timeZone: 'America/Sao_Paulo',
  })
  async cronOniSemanal(): Promise<void> {
    if (!this.cronEnabled()) {
      this.logger.debug(
        'Auto-sync El Niño desabilitado (ELNINO_ANALYTICS_CRON_ENABLED=false).',
      );
      return;
    }
    if (this.emExecucao) {
      this.logger.debug('ONI semanal adiado (sync já em execução).');
      return;
    }
    this.emExecucao = true;
    try {
      await this.syncOniSemanal('oni-semanal');
    } catch (err) {
      this.logger.error(
        `Falha no ONI semanal: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.emExecucao = false;
    }
  }
}
