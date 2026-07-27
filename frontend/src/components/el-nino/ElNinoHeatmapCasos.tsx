import React, { useMemo } from 'react';
import { SerieMensal } from '@/services/el-nino-api';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';
import {
  corHeatmap,
  intensidadeHeatmap,
  montarHeatmapCasos,
} from '@/utils/el-nino/heatmap-casos';
import { rotuloEscopoGrafico } from '@/utils/el-nino/graficos-filtros';

interface Props {
  serie: SerieMensal[] | null | undefined;
  anoInicio?: number;
  anoFim?: number;
  nMunicipios?: number;
  nomeMunicipio?: string | null;
  loading?: boolean;
}

/**
 * Heatmap mês × ano de casos de dengue.
 */
export const ElNinoHeatmapCasos: React.FC<Props> = ({
  serie,
  anoInicio,
  anoFim,
  nMunicipios = 0,
  nomeMunicipio,
  loading,
}) => {
  const matriz = useMemo(() => {
    let fatia = serie ?? [];
    if (anoInicio != null) {
      fatia = fatia.filter((r) => r.Ano >= anoInicio);
    }
    if (anoFim != null) {
      fatia = fatia.filter((r) => r.Ano <= anoFim);
    }
    return montarHeatmapCasos(fatia);
  }, [serie, anoInicio, anoFim]);

  const escopoRotulo = rotuloEscopoGrafico(nomeMunicipio, nMunicipios);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="h-64 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!matriz.anos.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-gray-400 text-sm">
        Heatmap indisponível — sem série mensal no período.
      </div>
    );
  }

  return (
    <article className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="heatmap-casos" />
      <header className="mb-3 pr-8">
        <h3 className="text-sm font-semibold text-gray-800">
          Heatmap de casos (mês × ano)
        </h3>
        <p className="text-xs text-gray-400">
          Intensidade proporcional aos casos
          {escopoRotulo ? ` · ${escopoRotulo}` : ''}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[10px] min-w-[480px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white z-10 p-1 text-left text-gray-400 font-medium w-12">
                Ano
              </th>
              {matriz.meses.map((m) => (
                <th
                  key={m}
                  className="p-1 text-center text-gray-400 font-medium w-9"
                >
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matriz.anos.map((ano) => (
              <tr key={ano}>
                <td className="sticky left-0 bg-white z-10 p-1 font-medium text-gray-600">
                  {ano}
                </td>
                {matriz.meses.map((_, mi) => {
                  const mesNum = mi + 1;
                  const casos =
                    matriz.celulas.get(`${ano}-${mesNum}`) ?? 0;
                  const inten = intensidadeHeatmap(casos, matriz.maxCasos);
                  const bg = corHeatmap(inten);
                  return (
                    <td
                      key={mesNum}
                      className="p-0.5"
                      title={`${matriz.meses[mi]}/${ano}: ${casos.toLocaleString('pt-BR')} casos`}
                    >
                      <div
                        className="h-7 rounded-sm flex items-center justify-center text-[9px] font-medium"
                        style={{
                          backgroundColor: bg,
                          color: inten > 0.5 ? '#fff' : '#78350f',
                        }}
                      >
                        {casos > 0
                          ? casos >= 1000
                            ? `${(casos / 1000).toFixed(1)}k`
                            : casos
                          : ''}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 mt-3 text-[10px] text-gray-400">
        <span>Menos</span>
        <div className="flex gap-0.5">
          {[0, 0.25, 0.5, 0.75, 1].map((i) => (
            <span
              key={i}
              className="w-5 h-3 rounded-sm"
              style={{ backgroundColor: corHeatmap(i) }}
            />
          ))}
        </div>
        <span>Mais casos</span>
        <span className="ml-auto">
          máx. {matriz.maxCasos.toLocaleString('pt-BR')}
        </span>
      </div>
    </article>
  );
};

export default ElNinoHeatmapCasos;
