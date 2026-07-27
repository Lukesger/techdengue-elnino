import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RolePermissionGuard } from '../../shared/guards/role-permission.guard';
import {
  AdminOnly,
  AuthenticatedOnly,
  RequirePermission,
} from '../../shared/decorators/role-permission.decorator';
import { ElNinoPipelineService } from '../../application/services/el-nino-analytics/el-nino-pipeline.service';
import { IbgeMgService } from '../../application/services/el-nino-analytics/ibge-mg.service';
import { IbgeSidraAreaService } from '../../application/services/el-nino-analytics/ibge-sidra-area.service';
import {
  ElNinoScopeService,
  EscopoElNinoUsuario,
  MunicipioEscopo,
} from '../../application/services/el-nino-analytics/el-nino-scope.service';
import { ElNinoProjecaoService } from '../../application/services/el-nino-analytics/el-nino-projecao.service';
import { InmetWis2Service } from '../../application/services/el-nino-analytics/inmet-wis2.service';
import {
  MunicipioFoco,
  ANO_INICIO,
  ANO_FIM,
} from '../../application/services/el-nino-analytics/constants';
import {
  ElNinoAlertasQueryDto,
  ElNinoCasosPorBairroQueryDto,
  ElNinoClimaQueryDto,
  ElNinoGeocodeQueryDto,
  ElNinoOverviewQueryDto,
  ElNinoSerieQueryDto,
} from '../../application/dtos/el-nino-analytics/el-nino-filtros.dto';
import { KpiRespostaDto } from '../../application/dtos/el-nino-analytics/el-nino-resposta.dto';
import {
  ElNinoCasosPorBairroResponseDto,
  ElNinoGeojsonBairrosResponseDto,
} from '../../application/dtos/el-nino-analytics/el-nino-casos-por-bairro-response.dto';
import { ElNinoCasosPorBairroService } from '../../application/services/el-nino-analytics/el-nino-casos-por-bairro.service';
import { ClimaHistoricoStoreService } from '../../application/services/el-nino-analytics/clima-historico-store.service';
import type { User } from '../../domain/entities/user.entity';
import type { PacoteOverview } from '../../application/services/el-nino-analytics/el-nino-pipeline.service';

const SWAGGER_TAG = 'Relatórios - Análise El Niño';

function fmtInteiro(valor: number): string {
  return new Intl.NumberFormat('pt-BR').format(Math.round(Number(valor) || 0));
}

function fmtDecimal(valor: number, casas = 1): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(Number(valor) || 0);
}

function escolherSerie(
  pacote: PacoteOverview,
  agregacao: 'soma' | 'ponderada' | undefined,
) {
  if (
    agregacao === 'ponderada' ||
    (!agregacao && pacote.resumo_escopo?.agregacao_default === 'ponderada')
  ) {
    return {
      serie: pacote.df_serie_ponderada,
      historico: pacote.df_historico_ponderado,
      modo: 'ponderada' as const,
    };
  }
  return {
    serie: pacote.df_serie,
    historico: pacote.df_historico,
    modo: 'soma' as const,
  };
}

@ApiTags(SWAGGER_TAG)
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolePermissionGuard)
@Controller('el-nino-analytics')
export class ElNinoAnalyticsController {
  private readonly logger = new Logger(ElNinoAnalyticsController.name);

  constructor(
    private readonly pipeline: ElNinoPipelineService,
    private readonly ibge: IbgeMgService,
    private readonly scope: ElNinoScopeService,
    private readonly projecao: ElNinoProjecaoService,
    private readonly inmet: InmetWis2Service,
    private readonly casosPorBairroService: ElNinoCasosPorBairroService,
    private readonly ibgeSidraArea: IbgeSidraAreaService,
    private readonly climaHistoricoStore: ClimaHistoricoStoreService,
  ) {}

  /** 5xx genérico: detalhes só em log sanitizado. */
  private falhaInterna(
    contexto: string,
    err: unknown,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
  ): HttpException {
    const requestId = randomUUID();
    const detalhe = err instanceof Error ? err.message : String(err);
    this.logger.error(`[${requestId}] ${contexto}: ${detalhe}`);
    return new HttpException(
      {
        statusCode: status,
        message: 'Erro interno ao processar a solicitação',
        requestId,
      },
      status,
    );
  }

  /**
   * Resolve escopo + foco do usu├írio e converte para MunicipioFoco[] (com lat/lon)
   * que o pipeline aceita.
   */
  private async resolverFoco(
    user: User,
    query: ElNinoGeocodeQueryDto,
  ): Promise<{
    escopo: EscopoElNinoUsuario;
    foco: MunicipioEscopo[];
    municipiosFoco: MunicipioFoco[];
    populacoes: Map<number, number>;
  }> {
    const geocodesSolicitados =
      query.geocodes && query.geocodes.length
        ? query.geocodes
        : query.geocode
          ? [Number(query.geocode)]
          : undefined;
    const resolvido = await this.scope.resolverEFiltrar(
      user,
      geocodesSolicitados,
      query.contratoId,
    );
    const focoComCoords = await this.ibge.resolverMunicipiosFoco(
      resolvido.foco.map((m) => m.geocode),
    );
    const populacoes = new Map<number, number>();
    for (const m of resolvido.foco) populacoes.set(m.geocode, m.populacao);
    return {
      escopo: resolvido,
      foco: resolvido.foco,
      municipiosFoco: focoComCoords,
      populacoes,
    };
  }

  private async getPacote(
    user: User,
    query: ElNinoGeocodeQueryDto,
    forceRefresh = false,
  ): Promise<{
    pacote: PacoteOverview;
    escopo: EscopoElNinoUsuario;
    foco: MunicipioEscopo[];
  }> {
    const { escopo, foco, municipiosFoco, populacoes } =
      await this.resolverFoco(user, query);
    const pacote = await this.pipeline.getOverview({
      municipios: municipiosFoco,
      populacoes,
      forceRefresh,
    });
    return { pacote, escopo, foco };
  }

  /** Helper que retorna pacote + foco + municipiosFoco + populacoes juntos */
  private async getPacoteComFoco(
    user: User,
    query: ElNinoGeocodeQueryDto,
    forceRefresh = false,
  ): Promise<{
    pacote: PacoteOverview;
    escopo: EscopoElNinoUsuario;
    foco: MunicipioEscopo[];
    municipiosFoco: MunicipioFoco[];
    populacoes: Map<number, number>;
  }> {
    const { escopo, foco, municipiosFoco, populacoes } =
      await this.resolverFoco(user, query);
    const pacote = await this.pipeline.getOverview({
      municipios: municipiosFoco,
      populacoes,
      forceRefresh,
    });
    return { pacote, escopo, foco, municipiosFoco, populacoes };
  }

  @Get('escopo')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary:
      'Escopo territorial do usuário (municípios, populações, agregação default)',
  })
  async escopo(@Req() req: { user: User }) {
    return this.scope.resolverParaUsuario(req.user);
  }

  @Get('overview')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary:
      'Pacote completo de análise El Niño × dengue × clima filtrado pelo escopo do usuário',
  })
  @ApiResponse({ status: 200, description: 'Pacote de análise completo.' })
  async overview(
    @Query() query: ElNinoOverviewQueryDto,
    @Req() req: { user: User },
  ) {
    const force = query.refresh === '1';
    if (force && req.user?.role !== 'admin') {
      throw new ForbiddenException(
        'Apenas administradores podem forçar refresh do pipeline.',
      );
    }
    try {
      const { pacote, escopo, foco } = await this.getPacote(
        req.user,
        query,
        force,
      );
      const { modo } = escolherSerie(pacote, query.agregacao);
      return {
        ...pacote,
        escopo: {
          tipo: escopo.tipo,
          rotulo: escopo.rotulo,
          descricao: escopo.descricao,
          podeTrocar: escopo.podeTrocar,
          podeAgregar: escopo.podeAgregar,
          isGlobal: escopo.isGlobal,
          agregacaoEfetiva: modo,
          municipios_escopo: escopo.municipios,
          foco: foco.map((m) => m.geocode),
          populacao_total: escopo.populacaoTotal,
        },
      };
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof HttpException) {
        throw err;
      }
      throw this.falhaInterna('overview', err);
    }
  }

  @Get('kpis')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({ summary: 'KPIs do dashboard (5 cards)' })
  @ApiResponse({ status: 200, type: KpiRespostaDto })
  async kpis(
    @Query() query: ElNinoGeocodeQueryDto,
    @Req() req: { user: User },
  ): Promise<KpiRespostaDto> {
    const { pacote, foco } = await this.getPacote(req.user, query);
    const { serie } = escolherSerie(pacote, query.agregacao);
    const gc = query.geocode ? Number(query.geocode) : null;
    const mun =
      gc != null && Number.isFinite(gc)
        ? (pacote.clima_municipios[gc] ?? pacote.clima)
        : (pacote.clima ?? Object.values(pacote.clima_municipios)[0] ?? null);
    const atual = mun?.atual ?? null;
    const serieEscolhida =
      gc != null && Number.isFinite(gc)
        ? pacote.df_mensal_mun.filter((r) => Number(r.geocode) === gc)
        : serie;

    let casosTxt = '—';
    let mesRef = 'sem dados';
    if (serieEscolhida.length) {
      const ultimo = [...serieEscolhida]
        .sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum)
        .at(-1)!;
      casosTxt = fmtInteiro(ultimo.CasosDengue);
      mesRef = `${ultimo.Mes}/${ultimo.Ano}`;
    }

    const oniUlt = pacote.oni_mensal.at(-1);
    const elninoCorr = pacote.elnino.correlacoes.find((c) =>
      c.variavel.includes('ONI'),
    );

    return {
      kpis: [
        {
          titulo: 'Temperatura atual',
          valor:
            atual?.temperatura_c != null
              ? `${fmtDecimal(atual.temperatura_c)} °C`
              : '—',
          subtitulo:
            mun?.cidade ??
            (foco.length === 1 ? foco[0].nome : `${foco.length} municípios`),
        },
        {
          titulo: 'Umidade relativa',
          valor: atual?.umidade_pct != null ? `${atual.umidade_pct} %` : '—',
          subtitulo: 'fator de proliferação do vetor',
        },
        {
          titulo: gc ? 'Casos (último mês)' : 'Casos no escopo (último mês)',
          valor: casosTxt,
          subtitulo: mesRef,
        },
        {
          titulo: 'ONI / El Niño',
          valor: oniUlt ? fmtDecimal(oniUlt.oni, 2) : '—',
          subtitulo: oniUlt
            ? `Índice NOAA — ${oniUlt.ano}/${String(oniUlt.mes).padStart(2, '0')}`
            : '',
        },
        {
          titulo: 'Correlação ONI × casos',
          valor: elninoCorr
            ? `r = ${fmtDecimal(elninoCorr.correlacao, 3)}`
            : '—',
          subtitulo:
            pacote.elnino.resumo?.variacao_casos_pct != null
              ? `El Niño vs neutro: ${pacote.elnino.resumo.variacao_casos_pct > 0 ? '+' : ''}${fmtDecimal(
                  pacote.elnino.resumo.variacao_casos_pct,
                )} % casos`
              : '',
        },
      ],
    };
  }

  @Get('serie')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({ summary: 'Série temporal mensal filtrada' })
  async serie(@Query() query: ElNinoSerieQueryDto, @Req() req: { user: User }) {
    const { pacote } = await this.getPacote(req.user, query);
    const { serie, historico, modo } = escolherSerie(pacote, query.agregacao);
    const ai = query.ano_inicio ?? pacote.ano_inicio;
    const af = query.ano_fim ?? pacote.ano_fim;
    const gc = query.geocode;
    const mensal = gc
      ? pacote.df_mensal_mun.filter((r) => Number(r.geocode) === Number(gc))
      : pacote.df_mensal_mun;
    const filtrada = mensal.filter((r) => r.Ano >= ai && r.Ano <= af);
    return {
      periodo: { ano_inicio: ai, ano_fim: af },
      geocode: gc ?? 'todos',
      agregacao: modo,
      serie: gc ? filtrada : serie.filter((r) => r.Ano >= ai && r.Ano <= af),
      historico_anual: historico.filter((r) => r.Ano >= ai && r.Ano <= af),
    };
  }

  @Get('correlacoes')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({ summary: 'Correlações Pearson clima × dengue × ONI' })
  async correlacoes(
    @Query() query: ElNinoGeocodeQueryDto,
    @Req() req: { user: User },
  ) {
    const { pacote } = await this.getPacote(req.user, query);
    return {
      clima: pacote.correlacoes,
      elnino: pacote.elnino.correlacoes,
    };
  }

  @Get('correlacao-lag')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary:
      'Correlação Pearson com defasagem (0–6 meses): clima[t−lag] × casos[t]',
  })
  async correlacaoLag(
    @Query() query: ElNinoSerieQueryDto,
    @Req() req: { user: User },
  ) {
    const { pacote } = await this.getPacote(req.user, query);
    const { serie } = escolherSerie(pacote, query.agregacao);
    const ai = query.ano_inicio ?? pacote.ano_inicio;
    const af = query.ano_fim ?? pacote.ano_fim;
    const gc = query.geocode;
    const serieAlvo = gc
      ? pacote.df_mensal_mun
          .filter(
            (r) =>
              Number(r.geocode) === Number(gc) && r.Ano >= ai && r.Ano <= af,
          )
          .map((r) => ({
            Ano: r.Ano,
            MesNum: r.MesNum,
            Mes: r.Mes,
            AnoMes: r.AnoMes,
            CasosDengue: r.CasosDengue,
            Temperatura: r.Temperatura,
            Precipitacao: r.Precipitacao,
            Umidade: r.Umidade,
            ONI: r.ONI,
            TipoElNino: r.TipoElNino,
            ElNino: r.ElNino,
          }))
      : serie.filter((r) => r.Ano >= ai && r.Ano <= af);

    const maxLag = 6;
    const items = this.pipeline.calcularCorrelacaoLag(serieAlvo, maxLag);
    return {
      items,
      max_lag: maxLag,
      periodo: { ano_inicio: ai, ano_fim: af },
      geocode: gc ?? 'todos',
    };
  }

  @Get('comparativo')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary: 'Comparativo Com/Sem El Niño (mensal e por município)',
  })
  async comparativo(
    @Query() query: ElNinoGeocodeQueryDto,
    @Req() req: { user: User },
  ) {
    const { pacote } = await this.getPacote(req.user, query);
    return pacote.elnino;
  }

  @Get('alertas')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary: 'Alertas preditivos (chuva, calor, Infodengue, El Niño)',
  })
  async alertas(
    @Query() query: ElNinoAlertasQueryDto,
    @Req() req: { user: User },
  ) {
    const { pacote } = await this.getPacote(req.user, query);
    const key = query.geocode ? String(query.geocode) : 'todos';
    return {
      geocode: key,
      alertas: pacote.alertas_por_geocode[key] ?? pacote.alertas,
    };
  }

  @Get('clima')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary: 'Previsão de clima (14 dias) — Open-Meteo ao vivo',
  })
  async clima(@Query() query: ElNinoClimaQueryDto, @Req() req: { user: User }) {
    const { pacote, foco } = await this.getPacote(req.user, query);
    const gc = query.geocode ?? foco[0]?.geocode;
    if (!gc) {
      throw new HttpException(
        'Nenhum município disponível no escopo do usuário.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const noEscopo = foco.some((m) => m.geocode === gc);
    if (!noEscopo) {
      throw new ForbiddenException(
        'Município fora do escopo da análise para este usuário.',
      );
    }
    const ano = query.ano ?? 'previsao';
    if (ano !== 'previsao') {
      throw new BadRequestException(
        'Histórico de clima: use GET /el-nino-analytics/clima-historico (JSON local). Este endpoint é apenas para previsão.',
      );
    }
    return this.pipeline.obterPrevisaoClima(pacote, gc);
  }

  @Get('clima-historico')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary:
      'Clima histórico mensal (ERA5/Open-Meteo) — leitura do JSON local, sem API externa',
  })
  async climaHistorico(
    @Query() query: ElNinoGeocodeQueryDto,
    @Req() req: { user: User },
  ) {
    const { foco } = await this.resolverFoco(req.user, query);
    const geocodes = query.geocode
      ? [Number(query.geocode)]
      : foco.map((m) => m.geocode);
    const ai = query.ano_inicio ?? ANO_INICIO;
    const af = query.ano_fim ?? ANO_FIM;
    const linhas = this.climaHistoricoStore.filtrar(
      this.climaHistoricoStore.lerTodas(),
      { geocodes, anoInicio: ai, anoFim: af },
    );
    return {
      geocodes,
      periodo: { ano_inicio: ai, ano_fim: af },
      fonte: 'JSON local (data/el-nino/clima_historico.json)',
      atualizado_em: this.climaHistoricoStore.metaAtualizadoEm(),
      linhas,
      total: linhas.length,
    };
  }

  @Get('municipios')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({ summary: 'Municípios do escopo (validados via IBGE)' })
  async municipios(
    @Query() query: ElNinoGeocodeQueryDto,
    @Req() req: { user: User },
  ) {
    const { pacote, escopo } = await this.getPacote(req.user, query);
    const popMap = new Map(
      (pacote.resumo_escopo?.populacoes ?? []).map((p) => [
        p.geocode,
        p.populacao,
      ]),
    );
    const ranking = pacote.mapa_df.map((m) => {
      const populacao = popMap.get(m.geocode) ?? 0;
      const casos =
        Number(m.casos_notificados) > 0
          ? Number(m.casos_notificados)
          : Number(m.casos_estimados) || 0;
      const incidencia_100k =
        populacao > 0
          ? Math.round((casos / populacao) * 100_000 * 10) / 10
          : null;
      return {
        ...m,
        populacao,
        incidencia_100k,
      };
    });
    return {
      municipios: pacote.municipios_ibge,
      ranking,
      escopo: {
        tipo: escopo.tipo,
        rotulo: escopo.rotulo,
        podeTrocar: escopo.podeTrocar,
        podeAgregar: escopo.podeAgregar,
        isGlobal: escopo.isGlobal,
      },
    };
  }

  @Get('malha-mg')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary: 'GeoJSON IBGE dos municípios do escopo (para choropleth)',
  })
  async malha(
    @Query() query: ElNinoGeocodeQueryDto,
    @Req() req: { user: User },
  ) {
    const { foco } = await this.resolverFoco(req.user, query);
    const geocodes = foco.map((m) => m.geocode);
    return this.ibge.carregarMalhaPorGeocodes(geocodes);
  }

  @Post('refresh')
  @AdminOnly()
  @RequirePermission('analytics', 'elnino:refresh')
  @ApiOperation({ summary: 'Força refresh do pipeline (admin)' })
  async refresh(@Req() req: { user: User }) {
    const { municipiosFoco, populacoes } = await this.resolverFoco(
      req.user,
      {},
    );
    const pacote = await this.pipeline.refresh({
      municipios: municipiosFoco,
      populacoes,
    });
    return {
      ok: true,
      atualizado_em: pacote.atualizado_em,
      fontes: pacote.fontes,
      avisos: pacote.avisos,
    };
  }

  // ÔöÇÔöÇÔöÇ Novos endpoints Sprint 2 ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  @Get('mapa-projecao')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary:
      'Payload do mapa de projeção epidemiológica (Jul–Dez do ano corrente)',
  })
  async mapaProjecao(
    @Query() query: ElNinoGeocodeQueryDto,
    @Req() req: { user: User },
  ) {
    try {
      const { pacote, escopo, municipiosFoco, populacoes } =
        await this.getPacoteComFoco(req.user, query);

      const payload = this.projecao.montarPayloadMapaProjecao({
        municipios: municipiosFoco,
        mensal: pacote.df_mensal_mun,
        oniLinhas: pacote.oni_mensal,
        alertasApi: pacote.alertas_infodengue, // AlertaInfodengue[] do pipeline
        climaMunicipios: pacote.clima_municipios,
        populacoes,
        rotuloConjunto: escopo.rotulo,
        fontes: pacote.fontes,
        avisos: [
          ...pacote.avisos,
          ...(pacote.inmet_alertas.length
            ? [
                `${pacote.inmet_alertas.length} alerta(s) INMET ativos para a região.`,
              ]
            : []),
        ],
      });

      // Anexa malha IBGE ao payload (choropleth exige data.geojson).
      const geocodes = municipiosFoco.map((m) => m.geocode);
      try {
        const malhaFoco = await this.ibge.carregarMalhaPorGeocodes(geocodes);
        const features = malhaFoco?.features ?? [];
        if (features.length) {
          const porNome = new Map(
            municipiosFoco.map((m) => [m.geocode, m.municipio]),
          );
          const geojson = {
            type: 'FeatureCollection' as const,
            features: features.map((f) => {
              const gc = Number(
                f.properties?.codarea ?? f.properties?.geocode ?? f.id ?? 0,
              );
              return {
                ...f,
                properties: {
                  ...(f.properties ?? {}),
                  geocode: gc,
                  codarea: String(gc).padStart(7, '0'),
                  name:
                    porNome.get(gc) ??
                    f.properties?.name ??
                    f.properties?.nome ??
                    `Município ${gc}`,
                },
              };
            }),
          };
          return {
            ...payload,
            geojson,
            malha_fonte: 'IBGE Malhas API — por município',
            fontes: [...payload.fontes, 'IBGE Malhas — polígonos municipais'],
          };
        }
        return {
          ...payload,
          geojson: null,
          malha_fonte: null,
          avisos: [
            ...payload.avisos,
            `Malha geográfica indisponível: nenhum polígono IBGE para ${geocodes.length} município(s).`,
          ],
        };
      } catch {
        return {
          ...payload,
          geojson: null,
          malha_fonte: null,
          avisos: [
            ...payload.avisos,
            'Falha ao carregar malha IBGE para o mapa de projeção.',
          ],
        };
      }
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof HttpException) {
        throw err;
      }
      throw this.falhaInterna('mapa-projecao', err);
    }
  }

  @Get('serie-consorcio')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary:
      'Série temporal do consórcio/escopo com projeção Jul–Dez e bandas de confiança (formato Recharts)',
  })
  async serieConsorcio(
    @Query() query: ElNinoGeocodeQueryDto,
    @Req() req: { user: User },
  ) {
    try {
      const { pacote, escopo, foco, municipiosFoco, populacoes } =
        await this.getPacoteComFoco(req.user, query);

      const { serie, modo } = escolherSerie(pacote, query.agregacao);

      const gc = query.geocode ? Number(query.geocode) : null;
      let serieGrafico = serie;
      if (gc && Number.isFinite(gc)) {
        const mensalGc = pacote.df_mensal_mun.filter(
          (r) => Number(r.geocode) === Number(gc),
        );
        if (mensalGc.length) {
          serieGrafico = mensalGc.map((r) => ({
            Ano: r.Ano,
            MesNum: r.MesNum,
            Mes: r.Mes,
            AnoMes: r.AnoMes,
            CasosDengue: r.CasosDengue,
            Temperatura: r.Temperatura,
            Precipitacao: r.Precipitacao,
            Umidade: r.Umidade,
            ONI: r.ONI,
            TipoElNino: r.TipoElNino,
            ElNino: r.ElNino,
          }));
        }
      }

      const payload = this.projecao.montarSerieConsorcio({
        serie: serieGrafico,
        oniLinhas: pacote.oni_mensal,
        climaHistorico: pacote.clima_historico,
        municipios: municipiosFoco,
        populacoes,
        mensal: pacote.df_mensal_mun,
        alertasApi: pacote.alertas_infodengue,
        rotuloConjunto: escopo.rotulo,
      });

      return {
        ...payload,
        geocodes: foco.map((m) => m.geocode),
        agregacao: modo,
      };
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof HttpException) {
        throw err;
      }
      throw this.falhaInterna('serie-consorcio', err);
    }
  }

  @Get('consorcios')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary:
      'Lista consórcios acessíveis ao usuário (filtrados pelo escopo territorial)',
  })
  async consorcios(@Req() req: { user: User }) {
    const lista = await this.scope.listarConsorciosAcessiveis(req.user);
    return {
      uf: 'MG',
      n_consorcios: lista.length,
      consorcios: lista,
      atualizado_em: new Date().toISOString(),
    };
  }

  @Get('urs')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary:
      'Lista URS acessíveis ao usuário (filtradas pelo escopo territorial)',
  })
  async urs(@Req() req: { user: User }) {
    const lista = await this.scope.listarUrsAcessiveis(req.user);
    return {
      n_urs: lista.length,
      urs: lista,
      atualizado_em: new Date().toISOString(),
    };
  }

  @Get('inmet-alertas')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary: 'Alertas meteorológicos INMET WIS2 para os municípios do escopo',
  })
  async inmetAlertas(
    @Query() query: ElNinoGeocodeQueryDto,
    @Req() req: { user: User },
  ) {
    const forceRefresh = query.refresh === '1';
    if (forceRefresh && req.user?.role !== 'admin') {
      throw new ForbiddenException(
        'Apenas administradores podem forçar refresh dos alertas INMET.',
      );
    }
    const { foco } = await this.resolverFoco(req.user, query);
    const alertas = await this.inmet.buscarAlertasPorGeocodes(
      foco.map((m) => m.geocode),
      forceRefresh,
    );
    return {
      geocodes: foco.map((m) => m.geocode),
      n_alertas: alertas.length,
      alertas,
      atualizado_em: new Date().toISOString(),
    };
  }

  @Get('municipio-id')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary:
      'Resolve idMunicipio local (tabela municipio) a partir do geocode IBGE',
  })
  async municipioId(
    @Query() query: ElNinoGeocodeQueryDto,
    @Req() req: { user: User },
  ) {
    if (!query.geocode) {
      throw new BadRequestException('geocode é obrigatório');
    }
    const mun = await this.scope.resolverMunicipioParaGeometrias(
      req.user,
      Number(query.geocode),
      query.contratoId,
    );
    if (!mun.municipioId || mun.municipioId <= 0) {
      throw new NotFoundException(
        `Município com geocode ${query.geocode} não cadastrado no banco local`,
      );
    }
    return {
      geocode: Number(query.geocode),
      municipioId: mun.municipioId,
      nome: mun.nome,
    };
  }

  @Get('casos-por-bairro')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary:
      'Casos notificados por bairro/área — POIs TechDengue × total municipal Infodengue',
    description:
      'Retorna bairros com POIs mapeados e a estimativa de casos notificados por área, ' +
      'obtida pela repartição proporcional do total municipal (Infodengue) aos POIs de cada bairro (TechDengue).',
  })
  @ApiResponse({
    status: 200,
    description: 'Ranking de bairros com POIs e casos estimados por área',
    type: ElNinoCasosPorBairroResponseDto,
  })
  async casosPorBairro(
    @Query() query: ElNinoCasosPorBairroQueryDto,
    @Req() req: { user: User },
  ): Promise<ElNinoCasosPorBairroResponseDto> {
    if (!query.geocode) {
      throw new BadRequestException(
        'geocode é obrigatório para casos-por-bairro',
      );
    }
    if (query.refresh === '1' && req.user?.role !== 'admin') {
      throw new ForbiddenException(
        'Apenas administradores podem forçar refresh de casos por bairro.',
      );
    }
    try {
      return await this.casosPorBairroService.getCasosPorBairro(req.user, {
        geocode: Number(query.geocode),
        idMunicipio: query.idMunicipio,
        idContrato: query.idContrato,
        limit: query.limit,
        refresh: query.refresh === '1',
      });
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof HttpException) {
        throw err;
      }
      throw this.falhaInterna('casos-por-bairro', err);
    }
  }

  @Get('area-urbana-rural')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary: 'Área urbana e rural do município (IBGE SIDRA)',
    description:
      'Retorna área total, urbana e rural em km²/ha para cálculo de cobertura mapeada.',
  })
  async areaUrbanaRural(
    @Query() query: ElNinoGeocodeQueryDto,
    @Req() req: { user: User },
  ) {
    if (!query.geocode) {
      throw new BadRequestException('geocode é obrigatório');
    }
    /** BOLA: valida geocode contra escopo territorial antes do SIDRA. */
    await this.scope.resolverEFiltrar(
      req.user,
      [Number(query.geocode)],
      query.contratoId,
    );
    try {
      return await this.ibgeSidraArea.buscarAreasMunicipio(
        Number(query.geocode),
      );
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof HttpException) {
        throw err;
      }
      throw this.falhaInterna('area-urbana-rural', err, HttpStatus.BAD_GATEWAY);
    }
  }

  @Get('geojson-bairros')
  @AuthenticatedOnly()
  @RequirePermission('analytics', 'elnino:read')
  @ApiOperation({
    summary:
      'GeoJSON de bairros de um município (verba direta) para o choropleth do mapa',
    description:
      'Retorna polígonos brutos de area_mapeadas (1 feature por área do geopackage), sem dissolve por bairro e sem envoltória de POIs.',
  })
  @ApiResponse({
    status: 200,
    description: 'FeatureCollection com um polígono por bairro',
    type: ElNinoGeojsonBairrosResponseDto,
  })
  async geojsonBairros(
    @Query() query: ElNinoCasosPorBairroQueryDto,
    @Req() req: { user: User },
  ) {
    if (!query.geocode) {
      throw new BadRequestException(
        'geocode é obrigatório para geojson-bairros',
      );
    }
    try {
      return await this.casosPorBairroService.getGeojsonBairros(req.user, {
        geocode: Number(query.geocode),
        idMunicipio: query.idMunicipio,
        idContrato: query.idContrato,
      });
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof HttpException) {
        throw err;
      }
      throw this.falhaInterna('geojson-bairros', err);
    }
  }
}
