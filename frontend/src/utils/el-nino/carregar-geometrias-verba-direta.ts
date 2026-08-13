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
  unirGeometriasBairro,
  extrairNomeBairroDeAreaMapeada,
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

/** Une todas as áreas em 1 geometria (sem sobreposição visual no mapa). */
function unificarAreasParaVisualizacao(
  features: Array<{
    type?: 'Feature';
    properties: Record<string, unknown> & {
      nome?: string;
      pois?: number;
      hectaresUnicos?: number;
      hectares_unicos?: number;
      metodoAtribuicao?: string;
      metodo_atribuicao?: string;
      fonteGeom?: string;
      fonte_geom?: string;
      criterioAtribuicao?: string;
      criterio_atribuicao?: string;
    };
    geometry: GeoJSON.Geometry;
  }>,
): typeof features {
  const validas = features.filter((f) => f.geometry);
  if (validas.length <= 1) return validas;

  const geometria = unirGeometriasBairro(validas.map((f) => f.geometry));
  if (!geometria) return validas;

  const totalPois = validas.reduce(
    (sum, f) => sum + (Number(f.properties.pois) || 0),
    0,
  );
  const hectaresUnicos = hectaresDeGeometria(geometria);
  const fonte =
    validas[0]?.properties.fonteGeom ??
    validas[0]?.properties.fonte_geom ??
    'area_mapeadas';

  return [
    {
      type: 'Feature' as const,
      properties: {
        nome: 'Área mapeada unificada',
        pois: totalPois,
        hectaresUnicos,
        hectares_unicos: hectaresUnicos,
        metodoAtribuicao: 'area_mapeada_unificada',
        metodo_atribuicao: 'area_mapeada_unificada',
        fonteGeom: String(fonte),
        fonte_geom: String(fonte),
        criterioAtribuicao: 'uniao_completa_sem_overlap',
        criterio_atribuicao: 'uniao_completa_sem_overlap',
      },
      geometry: geometria,
    },
  ];
}

function resolverTotalPoisResumo(
  totalPoisResumo: number | null | undefined,
  totalPoisFeatures: number,
): number | null | undefined {
  if (totalPoisResumo != null && totalPoisResumo > 0) return totalPoisResumo;
  if (totalPoisFeatures > 0) return totalPoisFeatures;
  return totalPoisResumo;
}

function resolverHaBrutoPreferencial(
  haBrutoResumo: number,
  haBrutoBase: number,
  haStore: number,
  totalHa: number,
): number {
  if (haBrutoResumo > 0) return haBrutoResumo;
  if (haBrutoBase > 0) return haBrutoBase;
  if (haStore > 0) return haStore;
  return totalHa;
}

function resolverTotalPoisPreferencial(
  poisResumo: number,
  poisBase: number,
  poisStore: number,
  fallback: number | null | undefined,
): number | null | undefined {
  if (poisResumo > 0) return poisResumo;
  if (poisBase > 0) return poisBase;
  if (poisStore > 0) return poisStore;
  return fallback;
}

function resolverHaBrutoFeaturesOuStore(
  totalHaBrutoFeatures: number,
  haStore: number,
  totalHa: number,
): number {
  if (totalHaBrutoFeatures > 0) return totalHaBrutoFeatures;
  if (haStore > 0) return haStore;
  return totalHa;
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
  const featuresSemOverlap = unificarAreasMapeadasSobrepostas(brutas);
  const featuresUnificadas = unificarAreasParaVisualizacao(featuresSemOverlap);
  const featuresMapa =
    featuresSemOverlap.length > 0 ? featuresSemOverlap : featuresUnificadas;

  const totalHaBruto =
    resumoPostgis?.totalHaBruto ??
    brutas.reduce((sum, feature) => {
      const p = feature.properties as {
        hectares_unicos?: number;
        hectaresUnicos?: number;
        areaHa?: number;
        area_ha?: number;
      };
      return (
        sum +
        (Number(p.hectares_unicos) ||
          Number(p.hectaresUnicos) ||
          Number(p.areaHa) ||
          Number(p.area_ha) ||
          0)
      );
    }, 0);
  const totalHaSemOverlap =
    resumoPostgis?.totalHaUnificado ??
    featuresUnificadas.reduce(
      (sum, feature) => sum + hectaresDeGeometria(feature.geometry),
      0,
    );
  const totalPoisFeatures = brutas.reduce((sum, feature) => {
    const p = feature.properties as { pois?: number | null };
    return sum + (Number(p.pois) || 0);
  }, 0);
  const totalPoisResumo = resolverTotalPoisResumo(
    resumoPostgis?.totalPois,
    totalPoisFeatures,
  );

  const bairrosDiretos = montarAreasMapeadasDoGeojson(featuresMapa, mun);

  if (!bairrosDiretos.length) {
    throw new Error(
      'Nenhuma área mapeada com geometria em area_mapeadas para este município (export/geojson).',
    );
  }

  return {
    bairros: bairrosDiretos,
    modo: 'areas_mapeadas',
    areasIdentificacao: featuresMapa
      .filter((f) => f.geometry)
      .map((f) => ({
        nome: extrairNomeBairroDeAreaMapeada(
          String(f.properties.nome ?? 'Área mapeada'),
        ),
        pois: Number(f.properties.pois) || 0,
        hectaresUnicos: Number(f.properties.hectaresUnicos) || 0,
        metodoAtribuicao: String(f.properties.metodoAtribuicao ?? ''),
        fonteGeom: String(f.properties.fonteGeom ?? ''),
        criterioAtribuicao: String(f.properties.criterioAtribuicao ?? ''),
        geometry: f.geometry,
      })),
    resumoBairrosApi: {
      totalHa: totalHaSemOverlap,
      totalHaBruto,
      totalPois: totalPoisResumo,
      metodo: 'area_mapeada_unificada',
      fonte: resumoPostgis?.fonte ?? 'area_mapeadas',
    },
    contagemPoligonos: {
      brutos: brutas.length,
      unificados: featuresMapa.length,
    },
  };
}

function aplicarResumoPostgis(
  base: ResultadoGeometriasVerbaDireta,
  resumoPostgis: Awaited<
    ReturnType<typeof getAreaMapeadaResumoMunicipio>
  > | null,
  mun?: ProjecaoMunicipio,
): ResultadoGeometriasVerbaDireta {
  if (!resumoPostgis && !mun?.poi_hectare) return base;
  const poisStore = Number(mun?.poi_hectare?.total_registros) || 0;
  const haStore = Number(mun?.poi_hectare?.hectares_mapeados) || 0;
  const poisResumo = Number(resumoPostgis?.totalPois) || 0;
  const haBrutoResumo = Number(resumoPostgis?.totalHaBruto) || 0;
  const haUniResumo = Number(resumoPostgis?.totalHaUnificado) || 0;
  const haUniBase = Number(base.resumoBairrosApi?.totalHa) || 0;
  const haBrutoBase = Number(base.resumoBairrosApi?.totalHaBruto) || 0;

  const totalHa = haUniResumo > 0 ? haUniResumo : haUniBase;
  let totalHaBruto = resolverHaBrutoPreferencial(
    haBrutoResumo,
    haBrutoBase,
    haStore,
    totalHa,
  );
  // Evita bruto === unificado quando o store Nest tem hectares distintos.
  if (
    totalHa > 0 &&
    Math.abs(totalHaBruto - totalHa) < 1e-6 &&
    haStore > 0 &&
    Math.abs(haStore - totalHa) >= 1e-2
  ) {
    totalHaBruto = haStore;
  }

  const totalPois = resolverTotalPoisPreferencial(
    poisResumo,
    Number(base.resumoBairrosApi?.totalPois) || 0,
    poisStore,
    resumoPostgis?.totalPois ?? base.resumoBairrosApi?.totalPois,
  );

  return {
    ...base,
    resumoBairrosApi: {
      totalHa,
      totalHaBruto,
      totalPois,
      metodo: base.resumoBairrosApi?.metodo ?? 'area_mapeada_sem_overlap',
      fonte:
        resumoPostgis?.fonte ??
        base.resumoBairrosApi?.fonte ??
        (poisStore > 0 ? 'poi_hectare+area_mapeadas' : 'area_mapeadas'),
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
      nome: extrairNomeBairroDeAreaMapeada(
        String(f.properties.name ?? 'Área mapeada'),
      ),
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

  const paraBairroSemOverlap = unificarAreasMapeadasSobrepostas(paraBairro);
  const paraBairroUnificado = unificarAreasParaVisualizacao(paraBairroSemOverlap);
  const paraMapa =
    paraBairroSemOverlap.length > 0 ? paraBairroSemOverlap : paraBairroUnificado;
  const bairros = montarBairrosDiretoDoGeojson(paraMapa, mun);
  if (!bairros.length) {
    throw new Error('Geometrias retornadas sem polígonos utilizáveis no mapa.');
  }

  const totalHa = bairros.reduce(
    (sum, b) =>
      sum + (hectaresDeGeometria(b.geometry) || Number(b.hectaresUnicos) || 0),
    0,
  );
  const totalHaBrutoFeatures = paraBairro.reduce(
    (sum, f) => sum + (Number(f.properties.hectaresUnicos) || 0),
    0,
  );
  const totalPoisFeatures = paraBairro.reduce(
    (sum, f) => sum + (Number(f.properties.pois) || 0),
    0,
  );
  const poisStore = Number(mun.poi_hectare?.total_registros) || 0;
  const haStore = Number(mun.poi_hectare?.hectares_mapeados) || 0;

  return {
    bairros,
    modo: resp.modo === 'envoltoria_pois' ? 'envoltoria_pois' : 'areas_mapeadas',
    areasIdentificacao: paraMapa.map((f) => ({
      nome: String(f.properties.nome ?? 'Área mapeada'),
      pois: Number(f.properties.pois) || 0,
      hectaresUnicos: Number(f.properties.hectaresUnicos) || 0,
      metodoAtribuicao: String(f.properties.metodoAtribuicao ?? ''),
      fonteGeom: String(f.properties.fonteGeom ?? ''),
      criterioAtribuicao: String(f.properties.criterioAtribuicao ?? ''),
      geometry: f.geometry,
    })),
    resumoBairrosApi: {
      totalHa,
      totalHaBruto: resolverHaBrutoFeaturesOuStore(
        totalHaBrutoFeatures,
        haStore,
        totalHa,
      ),
      totalPois: resolverTotalPoisPreferencial(
        Number(resp.total_pois) || 0,
        totalPoisFeatures,
        poisStore,
        resp.total_pois,
      ),
      metodo: 'area_mapeada_unificada',
      fonte: resp.fontes?.[0] ?? 'el-nino/geojson-bairros',
    },
    contagemPoligonos: {
      brutos: paraBairro.length,
      unificados: paraMapa.length,
    },
    avisoFallback: undefined,
  };
}

function isErroPermissaoAreaMapeada(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  const msg = extrairMensagemErro(err).toLowerCase();
  return (
    status === 403 ||
    msg.includes('area-mapeada:read') ||
    msg.includes('access denied') ||
    msg.includes('permissão') ||
    msg.includes('permission')
  );
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
    return aplicarResumoPostgis(rapido, resumoPostgis, opts.mun);
  } catch (errArea) {
    const msgArea = extrairMensagemErro(errArea);
    try {
      const fallback = await carregarViaGeojsonBairros(
        opts.geocode,
        opts.contratoId,
        opts.mun,
      );
      // 403 em area-mapeada é esperado sem essa permissão — o mapa El Niño basta.
      if (isErroPermissaoAreaMapeada(errArea)) {
        return { ...fallback, avisoFallback: undefined };
      }
      return {
        ...fallback,
        avisoFallback:
          'Exportação area-mapeada indisponível; usando geometrias via El Niño Analytics (geojson-bairros).',
      };
    } catch (errFallback) {
      const msgFb = extrairMensagemErro(errFallback);
      if (isErroPermissaoAreaMapeada(errArea) && isErroPermissaoAreaMapeada(errFallback)) {
        throw new Error(
          'Sem permissão para carregar geometrias do município. É necessário analytics:elnino:read.',
        );
      }
      throw new Error(`${msgArea} · Fallback geojson-bairros: ${msgFb}`);
    }
  }
}
