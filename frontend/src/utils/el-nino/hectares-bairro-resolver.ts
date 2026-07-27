import dashboardApi from '@/services/dashboard-api';
import {
  alocarHectaresProporcionalPois,
  BairroPeso,
  pesosDeHectaresPorBairro,
} from '@/utils/el-nino/projecao-bairros';

export interface ResolverHectaresBairroOpts {
  municipioId: number;
  contratoId?: number | null;
  pesosPois: BairroPeso[];
}

/**
 * Carrega hectares por bairro (API) ou reparte o total municipal pelos POIs.
 */
export async function resolverPesosHectaresPorBairro(
  opts: ResolverHectaresBairroOpts,
): Promise<BairroPeso[]> {
  const resp = await dashboardApi.getHectaresMapeadosPorBairro({
    idMunicipio: opts.municipioId,
  });

  const pesosApi = pesosDeHectaresPorBairro(resp?.bairros ?? []);
  if (pesosApi.length) return pesosApi;

  let totalHa = Number(resp?.totalHectares) || 0;

  if (totalHa <= 0 && opts.contratoId) {
    const porContrato =
      await dashboardApi.getHectaresMapeadosPorMunicipiosDoContrato({
        idContrato: opts.contratoId,
      });
    const mun = porContrato?.municipios?.find(
      (m) => Number(m.idMunicipio) === Number(opts.municipioId),
    );
    totalHa = Number(mun?.hectaresMapeados) || 0;
  }

  if (totalHa <= 0) {
    totalHa = await dashboardApi.getHectaresMapeados(opts.municipioId);
  }

  if (totalHa > 0 && opts.pesosPois.length) {
    return alocarHectaresProporcionalPois(totalHa, opts.pesosPois);
  }

  return [];
}
