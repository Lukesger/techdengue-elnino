/**
 * Stub do dashboard-api do TechDengue completo.
 * No monorepo El Niño (demo/público) o ranking usa el-nino-api;
 * estes métodos só existem para satisfazer o typecheck.
 */

export type CriadourosPorBairroResponse = {
  bairros: Array<{
    tiposCriadouros: Record<string, number>;
    nomeBairro: string;
    idMunicipio: number;
    nomeMunicipio: string;
    idContrato: number;
    nomeContrato: string;
    quantidadeAtividades: number;
    totalGeral: number;
  }>;
  idMunicipio: number;
  nomeMunicipio: string;
  idContrato: number;
  nomeContrato: string;
  totalGeral: number;
} | null;

const dashboardApi = {
  getTotalPorTipoCriadourosPorBairroPorContrato: async (
    _idContrato: number | string,
    _dataInicio?: string | null,
    _dataFim?: string | null,
  ): Promise<CriadourosPorBairroResponse> => null,

  getTotalPorTipoCriadourosPorBairro: async (
    _municipioId: number | string,
    _dataInicio?: string | null,
    _dataFim?: string | null,
  ): Promise<CriadourosPorBairroResponse> => null,
};

export default dashboardApi;
