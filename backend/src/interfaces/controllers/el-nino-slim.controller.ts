import { Controller, Get, Post, Query, UseGuards, Logger } from '@nestjs/common';
import { DemoAuthGuard } from '../../shared/guards/demo-auth.guard';
import { ElNinoPipelineService } from '../../application/services/el-nino-analytics/el-nino-pipeline.service';
import { ClimaHistoricoStoreService } from '../../application/services/el-nino-analytics/clima-historico-store.service';
import { NoaaOniService } from '../../application/services/el-nino-analytics/noaa-oni.service';
import { OpenMeteoService } from '../../application/services/el-nino-analytics/open-meteo.service';
import {
  MUNICIPIOS_ELNINO,
  ANO_INICIO,
  ANO_FIM,
} from '../../application/services/el-nino-analytics/constants';

/**
 * Controller slim do monorepo — endpoints El Niño sem TypeORM/UserModule.
 * Escopo fixo nos municípios foco (MUNICIPIOS_ELNINO).
 */
@Controller('el-nino-analytics')
@UseGuards(DemoAuthGuard)
export class ElNinoSlimController {
  private readonly logger = new Logger(ElNinoSlimController.name);

  constructor(
    private readonly pipeline: ElNinoPipelineService,
    private readonly climaStore: ClimaHistoricoStoreService,
    private readonly noaa: NoaaOniService,
    private readonly openMeteo: OpenMeteoService,
  ) {}

  @Get('escopo')
  escopo() {
    const municipios = MUNICIPIOS_ELNINO.map((m, i) => ({
      geocode: m.geocode,
      municipioId: i + 1,
      nome: m.municipio,
      populacao: 0,
    }));
    return {
      tipo: 'global',
      rotulo: 'El Niño — municípios foco (demo)',
      descricao: 'Escopo demo do monorepo techdengue-elnino',
      municipios,
      geocodes: municipios.map((m) => m.geocode),
      populacaoTotal: 0,
      podeTrocar: true,
      podeAgregar: true,
      agregacaoDefault: 'soma',
      isGlobal: true,
    };
  }

  @Get('consorcios')
  consorcios() {
    return [
      {
        id: 1,
        nome: 'Demo El Niño MG',
        eConsorcio: 1,
        n_municipios: MUNICIPIOS_ELNINO.length,
        municipios: MUNICIPIOS_ELNINO.map((m) => ({
          geocode: m.geocode,
          nome: m.municipio,
        })),
      },
    ];
  }

  @Get('urs')
  urs() {
    return [];
  }

  @Get('overview')
  async overview() {
    return this.pipeline.getOverview({
      municipios: MUNICIPIOS_ELNINO,
      forceRefresh: false,
    });
  }

  @Get('kpis')
  async kpis() {
    const pacote = await this.pipeline.getOverview({
      municipios: MUNICIPIOS_ELNINO,
    });
    const serie = pacote.df_serie || [];
    const ultimo = serie[serie.length - 1];
    const oni = pacote.oni_mensal?.[pacote.oni_mensal.length - 1];
    return {
      temperatura_atual: ultimo?.Temperatura ?? null,
      umidade_atual: ultimo?.Umidade ?? null,
      casos_ultimo_mes: ultimo?.CasosDengue ?? null,
      oni_atual: oni?.oni ?? null,
      ano_inicio: pacote.ano_inicio ?? ANO_INICIO,
      ano_fim: pacote.ano_fim ?? ANO_FIM,
    };
  }

  @Get('serie')
  async serie() {
    const pacote = await this.pipeline.getOverview({
      municipios: MUNICIPIOS_ELNINO,
    });
    return pacote.df_serie ?? [];
  }

  @Get('correlacoes')
  async correlacoes() {
    const pacote = await this.pipeline.getOverview({
      municipios: MUNICIPIOS_ELNINO,
    });
    return pacote.correlacoes ?? [];
  }

  @Get('comparativo')
  async comparativo() {
    const pacote = await this.pipeline.getOverview({
      municipios: MUNICIPIOS_ELNINO,
    });
    return pacote.elnino ?? {};
  }

  @Get('alertas')
  async alertas() {
    const pacote = await this.pipeline.getOverview({
      municipios: MUNICIPIOS_ELNINO,
    });
    return pacote.alertas ?? [];
  }

  @Get('municipios')
  async municipios() {
    const pacote = await this.pipeline.getOverview({
      municipios: MUNICIPIOS_ELNINO,
    });
    return pacote.df_municipios ?? MUNICIPIOS_ELNINO;
  }

  @Get('clima')
  async clima(@Query('geocode') geocode?: string) {
    const g = Number(geocode) || MUNICIPIOS_ELNINO[0].geocode;
    const mun =
      MUNICIPIOS_ELNINO.find((m) => m.geocode === g) || MUNICIPIOS_ELNINO[0];
    try {
      return await this.openMeteo.buscarPrevisaoMunicipio(mun);
    } catch (e) {
      this.logger.warn(`clima falhou: ${(e as Error).message}`);
      return { dias: [], erro: (e as Error).message };
    }
  }

  @Get('clima-historico')
  climaHistorico(
    @Query('ano_inicio') anoInicio?: string,
    @Query('ano_fim') anoFim?: string,
  ) {
    const ai = Number(anoInicio) || ANO_INICIO;
    const af = Number(anoFim) || ANO_FIM;
    return {
      linhas: this.climaStore.carregarPorMunicipios(
        MUNICIPIOS_ELNINO.map((m) => m.geocode),
        ai,
        af,
      ),
      atualizado_em: this.climaStore.metaAtualizadoEm(),
    };
  }

  @Get('oni')
  async oni() {
    return this.noaa.carregarOniMensal();
  }

  @Post('refresh')
  async refresh() {
    const pacote = await this.pipeline.getOverview({
      municipios: MUNICIPIOS_ELNINO,
      forceRefresh: true,
    });
    return {
      ok: true,
      atualizado_em: pacote.atualizado_em,
      message: 'Pipeline refresh concluído',
    };
  }

  @Get('health')
  health() {
    return { ok: true, module: 'el-nino-analytics', mode: 'slim-demo' };
  }
}
