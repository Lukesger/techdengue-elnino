import dashboardApi from '@/services/dashboard-api';
import elNinoApi from '@/services/el-nino-api';
import { ProjecaoMunicipio } from '@/services/el-nino-api';

export interface ResolverMunicipioIdOpts {
  geocode: number;
  contratoId?: number | null;
  munMapa?: ProjecaoMunicipio | null;
}

/** Resolve o ID interno TechDengue (tabela municipio) a partir do geocode IBGE. */
export async function resolverMunicipioIdTechdengue(
  opts: ResolverMunicipioIdOpts,
): Promise<number | null> {
  // 1) Banco local por geocode — nunca usar ID do mapa de produção antes disso
  try {
    const res = await elNinoApi.getMunicipioId({
      geocode: opts.geocode,
      ...(opts.contratoId != null && opts.contratoId > 0
        ? { contratoId: opts.contratoId }
        : {}),
    });
    if (res?.municipioId != null && res.municipioId > 0) {
      return res.municipioId;
    }
  } catch {
    /* endpoint indisponível */
  }

  if (opts.contratoId != null && opts.contratoId > 0) {
    try {
      const casos = await elNinoApi.getCasosPorBairro({
        geocode: opts.geocode,
        idContrato: opts.contratoId,
        limit: 1,
      });
      if (casos?.idMunicipio != null && casos.idMunicipio > 0) {
        return casos.idMunicipio;
      }
    } catch {
      /* endpoint indisponível */
    }

    try {
      const lista = await dashboardApi.getMunicipiosAtividadesPontosList({
        idContrato: opts.contratoId,
        limit: 50,
      });
      if (lista.length === 1 && lista[0].idMunicipio > 0) {
        return lista[0].idMunicipio;
      }
    } catch {
      /* API indisponível */
    }

    if (!opts.geocode) {
      try {
        const porContrato =
          await dashboardApi.getTotalPorTipoCriadourosPorBairroPorContrato(
            opts.contratoId,
          );
        if (porContrato?.idMunicipio != null && porContrato.idMunicipio > 0) {
          return porContrato.idMunicipio;
        }
        const idBairro = porContrato?.bairros?.find(
          (b) => b.idMunicipio != null && b.idMunicipio > 0,
        )?.idMunicipio;
        if (idBairro != null && idBairro > 0) return idBairro;
      } catch {
        /* API indisponível */
      }
    }
  }

  return null;
}
