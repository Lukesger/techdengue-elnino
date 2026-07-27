import elNinoApi, {
  type ProjecaoMunicipio,
  type ElNinoGeojsonBairroFeature,
} from '@/services/el-nino-api';
import {
  getAreaMapeadaExportGeojson,
  getAreaMapeadaResumoMunicipio,
} from '@/services/area-mapeada-api';
import {
  featuresDeExportAreaMapeada,
  montarAreasMapeadasDoGeojson,
  montarBairrosDiretoDoGeojson,
  municipioIdDeProjecao,
  unificarAreasMapeadasSobrepostas,
  type BairroMapaFeature,
} from '@/utils/el-nino/projecao-bairros';
import {
  hectaresDeGeometria,
  type AreaIdentificavel,
} from '@/utils/el-nino/unir-bairros';

export type ModoGeometriasMapa =
  | 'areas_mapeadas'
  | 'envoltoria_pois'
  | 'indisponivel';

export interface ResultadoGeometriasVerbaDireta {
  bairros: BairroMapaFeature[];
  modo: ModoGeometriasMapa;
  areasIdentificacao: AreaIdentificavel[];
  resumoBairrosApi: {
    totalHa: number;
    totalHaBruto?: number;
    totalPois?: number;
    metodo?: string;
    fonte?: string;
  } | null;
  contagemPoligonos: { brutos: number; unificados: number } | null;
  avisoFallback?: string;
}

function extrairMensagemErro(err: unknown): string {
  const e = err as {
    response?: { data?: { message?: string; error?: string } };
    message?: string;
  };
  return (
    e?.response?.data?.message ??
    e?.response?.data?.error ??
    e?.message ??
    'Erro ao carregar geometrias'
  );
}

function geojsonElNinoParaFeatures(
  features: ElNinoGeojsonBairroFeature[],
) {
  return features
    .filter((f) => f.geometry)
    .map((f) => {
      const p = f.properties as ElNinoGeojsonBairroFeature['properties'] & {
        area_id?: number;
        id_sistema?: number | null;
        id_atividade?: string | null;
      };
      return {
        type: 'Feature' as const,
        geometry: f.geometry,
        properties: {
          id: p.area_id,
          name: p.nome,
          pois: p.pois,
          areaHa: p.hectares_unicos,
          idSistema: p.id_sistema,
          idAtividade: p.id_atividade,
          metodo_atribuicao: p.metodo_atribuicao,
          fonte_geom: p.fonte_geom,
          criterio_atribuicao: p.criterio_atribuicao,
        },
      };
    });
}

async function processarFeaturesAreaMapeada(
  geocode: number,
  mun: ProjecaoMunicipio,
  resp: Awaited<ReturnType<typeof getAreaMapeadaExportGeojson>>,
  resumoPostgis?: Awaited<
    ReturnType<typeof getAreaMapeadaResumoMunicipio>
  > | null,
): Promise<ResultadoGeometriasVerbaDireta> {
  const brutas = featuresDeExportAreaMapeada(resp);
  const featuresNormalizadas = unificarAreasMapeadasSobrepostas(brutas);

  const totalHaBruto =
    resumoPostgis?.totalHaBruto ??
    brutas.reduce(
      (sum, feature) =>
        sum + (Number(feature.properties.hectares_unicos) || 0),
      0,
    );
  const totalHaSemOverlap =
    resumoPostgis?.totalHaUnificado ??
    featuresNormalizadas.reduce(
      (sum, feature) => sum + hectaresDeGeometria(feature.geometry),
      0,
    );

  const bairrosDiretos = montarAreasMapeadasDoGeojson(
    featuresNormalizadas,
    mun,
  );

  if (!bairrosDiretos.length) {
    throw new Error(
      'Nenhuma área mapeada com geometria em area_mapeadas para este município (export/geojson).',
    );
  }

  return {
    bairros: bairrosDiretos,
    modo: 'areas_mapeadas',
    areasIdentificacao: featuresNormalizadas
      .filter((f) => f.geometry)
      .map((f) => ({
        nome: f.properties.nome,
        pois: f.properties.pois,
        hectaresUnicos: f.properties.hectaresUnicos,
        metodoAtribuicao: f.properties.metodoAtribuicao,
        fonteGeom: f.properties.fonteGeom,
        criterioAtribuicao: f.properties.criterioAtribuicao,
        geometry: f.geometry,
      })),
    resumoBairrosApi: {
      totalHa: totalHaSemOverlap,
      totalHaBruto,
      totalPois: resumoPostgis?.totalPois,
      metodo: 'area_mapeada_sem_overlap',
      fonte: resumoPostgis?.fonte ?? 'area_mapeadas',
    },
    contagemPoligonos: {
      brutos: brutas.length,
      unificados: featuresNormalizadas.length,
    },
  };
}

function aplicarResumoPostgis(
  base: ResultadoGeometriasVerbaDireta,
  resumoPostgis: Awaited<
    ReturnType<typeof getAreaMapeadaResumoMunicipio>
  > | null,
): ResultadoGeometriasVerbaDireta {
  if (!resumoPostgis) return base;
  return {
    ...base,
    resumoBairrosApi: {
      totalHa: resumoPostgis.totalHaUnificado ?? base.resumoBairrosApi?.totalHa ?? 0,
      totalHaBruto: resumoPostgis.totalHaBruto ?? base.resumoBairrosApi?.totalHaBruto,
      totalPois: resumoPostgis.totalPois,
      metodo: base.resumoBairrosApi?.metodo ?? 'area_mapeada_sem_overlap',
      fonte: resumoPostgis.fonte ?? base.resumoBairrosApi?.fonte ?? 'area_mapeadas',
    },
  };
}

async function carregarViaGeojsonBairros(
  geocode: number,
  contratoId: number | null | undefined,
  mun: ProjecaoMunicipio,
): Promise<ResultadoGeometriasVerbaDireta> {
  const idMunicipio = municipioIdDeProjecao(mun);
  const resp = await elNinoApi.getGeojsonBairros({
    geocode,
    idMunicipio: idMunicipio ?? undefined,
    idContrato: contratoId ?? undefined,
  });

  const features = geojsonElNinoParaFeatures(resp.features ?? []);
  if (!features.length) {
    throw new Error(
      resp.avisos?.[0] ??
        'Nenhuma geometria disponível em area_mapeadas para este município.',
    );
  }

  const paraBairro = features.map((f) => ({
    properties: {
      nome: String(f.properties.name ?? 'Área mapeada'),
      pois: Number(f.properties.pois ?? 0),
      hectares_unicos: Number(f.properties.areaHa ?? 0),
      hectaresUnicos: Number(f.properties.areaHa ?? 0),
      metodo_atribuicao: String(f.properties.metodo_atribuicao ?? 'geojson_bairros'),
      metodoAtribuicao: String(f.properties.metodo_atribuicao ?? 'geojson_bairros'),
      fonte_geom: String(f.properties.fonte_geom ?? 'area_mapeadas'),
      fonteGeom: String(f.properties.fonte_geom ?? 'area_mapeadas'),
      criterio_atribuicao: String(
        f.properties.criterio_atribuicao ?? 'sem_transformacao',
      ),
      criterioAtribuicao: String(
        f.properties.criterio_atribuicao ?? 'sem_transformacao',
      ),
    },
    geometry: f.geometry,
  }));

  const bairros = montarBairrosDiretoDoGeojson(paraBairro, mun);
  if (!bairros.length) {
    throw new Error('Geometrias retornadas sem polígonos utilizáveis no mapa.');
  }

  const totalHa = bairros.reduce(
    (sum, b) =>
      sum + (hectaresDeGeometria(b.geometry) || Number(b.hectaresUnicos) || 0),
    0,
  );

  return {
    bairros,
    modo: resp.modo === 'envoltoria_pois' ? 'envoltoria_pois' : 'areas_mapeadas',
    areasIdentificacao: paraBairro.map((f) => ({
      nome: f.properties.nome,
      pois: f.properties.pois,
      hectaresUnicos: f.properties.hectaresUnicos,
      metodoAtribuicao: f.properties.metodoAtribuicao,
      fonteGeom: f.properties.fonteGeom,
      criterioAtribuicao: f.properties.criterioAtribuicao,
      geometry: f.geometry,
    })),
    resumoBairrosApi: {
      totalHa,
      totalHaBruto: totalHa,
      totalPois: resp.total_pois,
      metodo: features[0]?.properties.metodo_atribuicao ?? 'geojson_bairros',
      fonte: resp.fontes?.[0] ?? 'el-nino/geojson-bairros',
    },
    contagemPoligonos: {
      brutos: paraBairro.length,
      unificados: paraBairro.length,
    },
    avisoFallback:
      'Exportação area-mapeada indisponível; usando geometrias via El Niño Analytics (geojson-bairros).',
  };
}

/**
 * Carrega polígonos de verba direta: tenta export PostGIS direto e,
 * em falha (500/permissão), usa geojson-bairros do módulo El Niño.
 */
export async function carregarGeometriasVerbaDireta(opts: {
  geocode: number;
  contratoId?: number | null;
  mun: ProjecaoMunicipio;
  /** Dispara assim que os polígonos estiverem prontos (antes do resumo PostGIS). */
  onBairrosProntos?: (resultado: ResultadoGeometriasVerbaDireta) => void;
}): Promise<ResultadoGeometriasVerbaDireta> {
  const cdMun = String(opts.geocode).padStart(7, '0');

  try {
    const resumoPromise = getAreaMapeadaResumoMunicipio(cdMun).catch(() => null);
    const resp = await getAreaMapeadaExportGeojson({ cdMun });
    const rapido = await processarFeaturesAreaMapeada(
      opts.geocode,
      opts.mun,
      resp,
      null,
    );
    opts.onBairrosProntos?.(rapido);
    const resumoPostgis = await resumoPromise;
    return aplicarResumoPostgis(rapido, resumoPostgis);
  } catch (errArea) {
    const msgArea = extrairMensagemErro(errArea);
    try {
      const fallback = await carregarViaGeojsonBairros(
        opts.geocode,
        opts.contratoId,
        opts.mun,
      );
      return { ...fallback, avisoFallback: `${msgArea} · ${fallback.avisoFallback}` };
    } catch (errFallback) {
      const msgFb = extrairMensagemErro(errFallback);
      throw new Error(`${msgArea} · Fallback geojson-bairros: ${msgFb}`);
    }
  }
}
