import React, { useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ZAxis,
} from 'recharts';
import { SerieMensal } from '@/services/el-nino-api';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';
import { montarScatterChuvaCasos } from '@/utils/el-nino/scatter-clima-casos';
import { rotuloEscopoGrafico } from '@/utils/el-nino/graficos-filtros';

interface Props {
  serie: SerieMensal[] | null | undefined;
  anoInicio?: number;
  anoFim?: number;
  nMunicipios?: number;
  nomeMunicipio?: string | null;
  loading?: boolean;
}

const TooltipCustom = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl">
      <p className="font-semibold mb-1">{p.rotulo}</p>
      <p className="text-sky-300">Chuva: {p.precip?.toFixed(1)} mm</p>
      <p className="text-orange-300">
        Casos: {Number(p.casos).toLocaleString('pt-BR')}
      </p>
      <p className="text-gray-400 mt-1">
        {p.elNino ? 'Com El Niño' : 'Sem El Niño'}
      </p>
    </div>
  );
};

/**
 * Dispersão precipitação × casos, colorida por regime El Niño.
 */
export const ElNinoScatterChuvaCasos: React.FC<Props> = ({
  serie,
  anoInicio,
  anoFim,
  nMunicipios = 0,
  nomeMunicipio,
  loading,
}) => {
  const { com, sem } = useMemo(() => {
    let fatia = serie ?? [];
    if (anoInicio != null) fatia = fatia.filter((r) => r.Ano >= anoInicio);
    if (anoFim != null) fatia = fatia.filter((r) => r.Ano <= anoFim);
    const pts = montarScatterChuvaCasos(fatia);
    return {
      com: pts.filter((p) => p.elNino),
      sem: pts.filter((p) => !p.elNino),
    };
  }, [serie, anoInicio, anoFim]);

  const escopoRotulo = rotuloEscopoGrafico(nomeMunicipio, nMunicipios);
  const total = com.length + sem.length;

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="h-72 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!total) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-gray-400 text-sm">
        Dispersão chuva × casos indisponível.
      </div>
    );
  }

  return (
    <article className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="scatter-chuva" />
      <header className="mb-3 pr-8">
        <h3 className="text-sm font-semibold text-gray-800">
          Chuva × casos
        </h3>
        <p className="text-xs text-gray-400">
          Cada ponto = um mês
          {escopoRotulo ? ` · ${escopoRotulo}` : ''}
          {' · '}
          {total} meses
        </p>
      </header>

      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis
            type="number"
            dataKey="precip"
            name="Chuva"
            unit=" mm"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            label={{
              value: 'Precipitação (mm)',
              position: 'insideBottom',
              offset: -2,
              fontSize: 10,
              fill: '#94a3b8',
            }}
          />
          <YAxis
            type="number"
            dataKey="casos"
            name="Casos"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            label={{
              value: 'Casos',
              angle: -90,
              position: 'insideLeft',
              fontSize: 10,
              fill: '#94a3b8',
            }}
          />
          <ZAxis range={[40, 40]} />
          <Tooltip content={<TooltipCustom />} cursor={{ strokeDasharray: '3 3' }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Scatter
            name="Sem El Niño"
            data={sem}
            fill="#38bdf8"
            fillOpacity={0.7}
          />
          <Scatter
            name="Com El Niño"
            data={com}
            fill="#f97316"
            fillOpacity={0.75}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </article>
  );
};

export default ElNinoScatterChuvaCasos;
