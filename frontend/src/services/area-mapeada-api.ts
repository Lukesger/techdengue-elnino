/**
 * Stub área mapeada — monorepo demo sem API PostGIS TechDengue.
 * Callers devem cair no fallback El Niño (geojson-bairros).
 */

export interface AreaMapeadaExportFeature {
  type: 'Feature';
  geometry: unknown;
  properties: {
    id: number;
    [key: string]: unknown;
  };
}

export interface AreaMapeadaExportGeoJSON {
  type: 'FeatureCollection';
  features: AreaMapeadaExportFeature[];
}

export interface AreaMapeadaResumoMunicipio {
  totalPois: number;
  totalHaBruto: number;
  totalHaUnificado: number;
  poligonosBrutos: number;
  fonte: string;
}

export interface AreaMapeadaExportParams {
  cdMun: string;
  idSistema?: number;
  siglaUf?: string;
}

export async function getAreaMapeadaExportGeojson(
  _params: AreaMapeadaExportParams,
): Promise<AreaMapeadaExportGeoJSON> {
  throw new Error('area-mapeada-api indisponível no monorepo demo');
}

export async function getAreaMapeadaResumoMunicipio(
  _cdMun: string,
): Promise<AreaMapeadaResumoMunicipio> {
  throw new Error('area-mapeada-api indisponível no monorepo demo');
}

export async function contarPoisAreaMapeadaGeometrias(
  _cdMun: string,
  geometries: unknown[],
): Promise<number[]> {
  return geometries.map(() => 0);
}

const areaMapeadaApi = {
  getAreaMapeadaExportGeojson,
  getAreaMapeadaResumoMunicipio,
  contarPoisAreaMapeadaGeometrias,
};

export default areaMapeadaApi;
