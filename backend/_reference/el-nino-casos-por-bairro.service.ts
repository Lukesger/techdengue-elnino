import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TotalPorTipoCriadourosPorBairroService } from '../total-por-tipo-criadouros-por-bairro.service';
import { ElNinoPipelineService } from './el-nino-pipeline.service';
import { ElNinoScopeService, MunicipioEscopo } from './el-nino-scope.service';
import { IbgeMgService } from './ibge-mg.service';
import {
  ElNinoBairroCasosItemDto,
  ElNinoCasosPorBairroResponseDto,
  ElNinoGeojsonBairrosResponseDto,
} from '../../dtos/el-nino-analytics/el-nino-casos-por-bairro-response.dto';
import {
  BairroPeso,
  casosNotificadosMunicipio,
  distribuirCasosPorBairro,
  pesosDeCriadourosPorBairro,
} from './el-nino-bairro-distribuicao.util';
import type { User } from '../../../domain/entities/user.entity';
import type { MunicipioFoco } from './constants';
import type { AreasMapeadasAudit } from '../total-por-tipo-criadouros-por-bairro.service';

export interface CasosPorBairroQuery {
  geocode: number;
  idMunicipio?: number;
  idContrato?: number;
  limit?: number;
  refresh?: boolean;
}

@Injectable()
export class ElNinoCasosPorBairroService {
  private readonly logger = new Logger(ElNinoCasosPorBairroService.name);

  constructor(
    private readonly pipeline: ElNinoPipelineService,
    private readonly scope: ElNinoScopeService,
    private readonly ibge: IbgeMgService,
    private readonly tiposPorBairro: TotalPorTipoCriadourosPorBairroService,
  ) {}

  async getCasosPorBairro(
    user: User,
    query: CasosPorBairroQuery,
  ): Promise<ElNinoCasosPorBairroResponseDto> {
    const geocode = Number(query.geocode);
    if (!Number.isFinite(geocode) || geocode <= 0) {
      throw new BadRequestException('geocode é obrigatório e deve ser válido');
    }

    const munEscopo = await this.scope.resolverMunicipioParaGeometrias(
      user,
      geocode,
      query.idContrato,
    );

    /** Ignora idMunicipio do cliente (BOLA): usa apenas o resolvido pelo escopo. */
    if (
      query.idMunicipio != null &&
      Number(query.idMunicipio) > 0 &&
      Number(query.idMunicipio) !== Number(munEscopo.municipioId)
    ) {
      throw new ForbiddenException(
        'idMunicipio não corresponde ao município autorizado pelo geocode',
      );
    }
    const idMunicipio = munEscopo.municipioId;
    if (!idMunicipio || idMunicipio <= 0) {
      throw new BadRequestException(
        'idMunicipio indisponível para o geocode informado',
      );
    }

    const focoComCoords = await this.ibge.resolverMunicipiosFoco([geocode]);
    const municipiosFoco: MunicipioFoco[] = focoComCoords.length
      ? focoComCoords
      : [
          {
            geocode,
            municipio: munEscopo.nome,
            lat: 0,
            lon: 0,
          },
        ];

    const populacoes = new Map<number, number>([
      [geocode, munEscopo.populacao ?? 0],
    ]);

    const pacote = await this.pipeline.getOverview({
      municipios: municipiosFoco,
      populacoes,
      forceRefresh: query.refresh === true,
    });

    const { notificados, estimados } = casosNotificadosMunicipio(
      geocode,
      pacote.df_municipios ?? [],
      pacote.df_mensal_mun ?? [],
    );

    const fontes = [
      'Infodengue AlertCity — casos notificados/estimados (nível municipal)',
      'TechDengue banco_techdengue — POIs/criadouros por bairro',
    ];
    const avisos: string[] = [
      'Casos por bairro são estimados: o total municipal (Infodengue) é repartido na proporção dos POIs mapeados em cada bairro (TechDengue). Não há casos notificados oficiais por bairro na base epidemiológica.',
    ];

    let payloadBairros;
    try {
      payloadBairros =
        await this.tiposPorBairro.getTotalPorTipoCriadourosPorBairro({
          idMunicipio,
          ...(query.idContrato ? { idContrato: query.idContrato } : {}),
        });
    } catch (err) {
      this.logger.warn(
        `Falha ao carregar POIs por bairro (municipio ${idMunicipio}): ${(err as Error).message}`,
      );
      throw new NotFoundException(
        'Não foi possível carregar bairros com POIs para o município informado',
      );
    }

    const pesos = pesosDeCriadourosPorBairro(payloadBairros?.bairros ?? []);
    if (!pesos.length) {
      return this.montarRespostaVazia(
        geocode,
        idMunicipio,
        munEscopo,
        notificados,
        estimados,
        fontes,
        [
          ...avisos,
          'Nenhum bairro com POIs mapeados encontrado para este município.',
        ],
      );
    }

    const totalPois = pesos.reduce((s, p) => s + p.peso, 0);
    const mapaNotificados =
      notificados > 0
        ? distribuirCasosPorBairro(notificados, pesos)
        : new Map<string, number>();
    const mapaEstimados =
      estimados > 0
        ? distribuirCasosPorBairro(estimados, pesos)
        : new Map<string, number>();

    const tiposPorNome = new Map<string, Record<string, number>>();
    for (const b of payloadBairros?.bairros ?? []) {
      const chave = pesosDeCriadourosPorBairro([b])[0]?.nome;
      if (chave && b.tiposCriadouros) {
        tiposPorNome.set(chave, b.tiposCriadouros);
      }
    }

    const bairros = this.montarRankingBairros(
      pesos,
      mapaNotificados,
      mapaEstimados,
      totalPois,
      notificados,
      tiposPorNome,
      query.limit ?? 50,
    );

    return {
      geocode,
      idMunicipio,
      nomeMunicipio:
        payloadBairros?.nomeMunicipio ?? munEscopo.nome ?? String(geocode),
      casos_notificados_municipio: notificados,
      casos_estimados_municipio: estimados,
      total_pois_municipio: totalPois,
      metodo: 'distribuicao_proporcional_pois',
      fontes,
      avisos,
      bairros,
      atualizado_em: new Date().toISOString(),
    };
  }

  /**
   * GeoJSON de áreas mapeadas de um município (verba direta) para o choropleth.
   * Plota somente polígonos brutos de `area_mapeadas` (1 feature por registro).
   */
  async getGeojsonBairros(
    user: User,
    query: { geocode: number; idMunicipio?: number; idContrato?: number },
  ): Promise<ElNinoGeojsonBairrosResponseDto> {
    const geocode = Number(query.geocode);
    if (!Number.isFinite(geocode) || geocode <= 0) {
      throw new BadRequestException('geocode é obrigatório e deve ser válido');
    }

    const munEscopo = await this.scope.resolverMunicipioParaGeometrias(
      user,
      geocode,
      query.idContrato,
    );

    if (
      query.idMunicipio != null &&
      Number(query.idMunicipio) > 0 &&
      Number(query.idMunicipio) !== Number(munEscopo.municipioId)
    ) {
      throw new ForbiddenException(
        'idMunicipio não corresponde ao município autorizado pelo geocode',
      );
    }
    const idMunicipio = munEscopo.municipioId;

    let atividadeIds: number[] = [];
    try {
      atividadeIds =
        await this.tiposPorBairro.resolveAtividadeIdsForMunicipio(idMunicipio);
    } catch (err) {
      this.logger.warn(
        `Falha ao resolver atividades do município ${idMunicipio}: ${(err as Error).message}`,
      );
    }

    let areasRaw: Awaited<
      ReturnType<typeof this.tiposPorBairro.getAreasMapeadasRaw>
    > = [];
    try {
      areasRaw = await this.tiposPorBairro.getAreasMapeadasRaw(geocode, {
        atividadeIds,
      });
    } catch (err) {
      this.logger.warn(
        `Falha ao carregar áreas mapeadas brutas (geocode ${geocode}): ${(err as Error).message}`,
      );
    }

    let areasAudit: AreasMapeadasAudit | null = null;
    if (!areasRaw.length) {
      try {
        areasAudit = await this.tiposPorBairro.auditAreasMapeadas(geocode);
      } catch (err) {
        this.logger.warn(
          `Falha ao auditar area_mapeadas (geocode ${geocode}): ${(err as Error).message}`,
        );
      }
    }

    const features: ElNinoGeojsonBairrosResponseDto['features'] = [];
    const idSistemasSet = new Set<number>();

    for (const area of areasRaw) {
      if (area.idSistema) idSistemasSet.add(area.idSistema);
      let geometry: Record<string, unknown>;
      try {
        geometry = JSON.parse(area.geojson) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!geometry) continue;
      features.push({
        type: 'Feature',
        properties: {
          area_id: area.id,
          nome: area.nome,
          pois: area.pois,
          hectares_unicos: area.hectaresUnicos,
          id_sistema: area.idSistema,
          id_atividade: area.idAtividade,
          metodo_atribuicao: area.metodoAtribuicao,
          fonte_geom: area.fonteGeom,
          criterio_atribuicao: area.criterioAtribuicao,
        },
        geometry,
      });
    }

    const fonteGeometria: 'areas_mapeadas' | 'indisponivel' = features.length
      ? 'areas_mapeadas'
      : 'indisponivel';

    const avisos: string[] =
      fonteGeometria === 'areas_mapeadas'
        ? [
            'Polígonos brutos de area_mapeadas (1 feature por área importada do geopackage), sem dissolve por bairro e sem envoltória de POIs.',
          ]
        : [
            'Nenhuma geometria válida em area_mapeadas para este município. Verifique id_sistemas e areas_audit.',
          ];

    if (!features.length) {
      if (areasAudit?.resumo.total_no_municipio === 0) {
        avisos.push(
          'Nenhum registro em area_mapeadas para o cd_mun deste município.',
        );
      } else if (areasAudit?.areas_problematicas.length) {
        avisos.push(
          `${areasAudit.areas_problematicas.length} área(s) com cd_mun ausente ou geometria vazia.`,
        );
      }
    }

    return {
      type: 'FeatureCollection',
      geocode,
      idMunicipio,
      nomeMunicipio: munEscopo.nome ?? String(geocode),
      modo: fonteGeometria,
      total_pois: 0,
      fontes: ['TechDengue area_mapeadas — polígonos diretos do PostGIS'],
      avisos,
      features,
      id_sistemas:
        idSistemasSet.size > 0
          ? Array.from(idSistemasSet).sort((a, b) => a - b)
          : (areasAudit?.id_sistemas ?? atividadeIds),
      id_sistemas_problematicos: areasAudit?.id_sistemas_problematicos ?? [],
      id_sistemas_municipio: atividadeIds,
      areas_audit: areasAudit ?? undefined,
      atualizado_em: new Date().toISOString(),
    };
  }

  private montarRankingBairros(
    pesos: BairroPeso[],
    mapaNotificados: Map<string, number>,
    mapaEstimados: Map<string, number>,
    totalPois: number,
    totalNotificados: number,
    tiposPorNome: Map<string, Record<string, number> | undefined>,
    limit: number,
  ): ElNinoBairroCasosItemDto[] {
    const usarPoisComoReferencia = totalNotificados <= 0;

    return pesos
      .map((p) => {
        const casosNotif = mapaNotificados.get(p.nome) ?? 0;
        const casosEst = mapaEstimados.get(p.nome) ?? 0;
        const referencia = usarPoisComoReferencia ? p.peso : casosNotif;
        return {
          nome: p.nome,
          pois: p.peso,
          casos_notificados: casosNotif,
          casos_estimados: casosEst,
          percentual_pois:
            totalPois > 0 ? Math.round((p.peso / totalPois) * 1000) / 10 : 0,
          percentual_casos_notificados:
            totalNotificados > 0
              ? Math.round((casosNotif / totalNotificados) * 1000) / 10
              : 0,
          tipos_criadouros: tiposPorNome.get(p.nome),
          _ref: referencia,
        };
      })
      .filter(
        (b) =>
          b.pois > 0 && (usarPoisComoReferencia || b.casos_notificados > 0),
      )
      .sort(
        (a, b) =>
          b._ref - a._ref ||
          b.pois - a.pois ||
          a.nome.localeCompare(b.nome, 'pt-BR'),
      )
      .slice(0, Math.max(1, Math.min(limit, 100)))
      .map((b) => {
        const { _ref, ...rest } = b;
        void _ref;
        return rest;
      });
  }

  private montarRespostaVazia(
    geocode: number,
    idMunicipio: number,
    munEscopo: MunicipioEscopo,
    notificados: number,
    estimados: number,
    fontes: string[],
    avisos: string[],
  ): ElNinoCasosPorBairroResponseDto {
    return {
      geocode,
      idMunicipio,
      nomeMunicipio: munEscopo.nome,
      casos_notificados_municipio: notificados,
      casos_estimados_municipio: estimados,
      total_pois_municipio: 0,
      metodo: 'distribuicao_proporcional_pois',
      fontes,
      avisos,
      bairros: [],
      atualizado_em: new Date().toISOString(),
    };
  }
}
