import React from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { SerieConsorcioResponse } from '@/services/el-nino-api';

interface Props {
  data: SerieConsorcioResponse | null;
  loading?: boolean;
  /** Nome do município/escopo em foco (header). */
  rotuloMunicipio?: string;
}

interface PontoGrafico {
  label: string;
  casos: number | null;
  temp: number | null;
  tempProj: number | null;
  oni: number | null;
  proj: number | null;
  sup: number | null;
  inf: number | null;
  projetado: boolean;
}

const TooltipCustom = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl max-w-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map(
        (p: any, i: number) =>
          p.value != null && (
            <p key={i} style={{ color: p.color }}>
              {p.name}:{' '}
              {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
              {p.name?.includes('Casos') || p.name?.includes('Proj')
                ? ' casos'
                : ''}
              {p.name?.includes('Temp') ? ' °C' : ''}
            </p>
          ),
      )}
    </div>
  );
};

/**
 * Gráfico ComposedChart para a página /guia — exibe todas as séries
 * (casos, temperatura, ONI, projeções, bandas El Niño) em um único
 * painel didático, espelhando o `myChart` do Visu_unico.html.
 */
export const ElNinoGuiaGraficoMunicipal: React.FC<Props> = ({
  data,
  loading,
  rotuloMunicipio,
}) => {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="h-72 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-400">
        Selecione um município no filtro para visualizar.
      </div>
    );
  }

  const pontos: PontoGrafico[] = data.labels.map((label, i) => ({
    label,
    casos: data.casos[i],
    temp: data.temp[i],
    tempProj: data.temp_proj[i],
    oni: data.oni[i],
    proj: data.proj[i],
    sup: data.sup[i],
    inf: data.inf[i],
    projetado: data.projetado[i],
  }));

  const visiveis = pontos.slice(-36);

  return (
    <article className="bg-white rounded-xl border border-gray-100 p-5">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-gray-800">
          {rotuloMunicipio ?? data.rotulo_conjunto}
        </h3>
        <p className="text-xs text-gray-400">
          Série histórica + projeção · {data.n_municipios} município(s)
        </p>
      </header>

      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart
          data={visiveis}
          margin={{ top: 5, right: 40, left: 5, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            interval={5}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            label={{
              value: 'Casos',
              angle: -90,
              position: 'insideLeft',
              fontSize: 10,
              fill: '#9ca3af',
            }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            domain={[-2, 35]}
            label={{
              value: '°C / ONI',
              angle: 90,
              position: 'insideRight',
              fontSize: 10,
              fill: '#9ca3af',
            }}
          />
          <Tooltip content={<TooltipCustom />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />

          {/* Faixa de incerteza */}
          <Area
            yAxisId="left"
            dataKey="sup"
            fill="#f97316"
            stroke="none"
            fillOpacity={0.12}
            name=""
            legendType="none"
          />
          <Area
            yAxisId="left"
            dataKey="inf"
            fill="#fff"
            stroke="none"
            fillOpacity={1}
            name=""
            legendType="none"
          />

          {/* Casos */}
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="casos"
            stroke="#ef4444"
            strokeWidth={2}
            dot={false}
            name="Casos notif."
            connectNulls={false}
          />
          {/* Projeção de casos */}
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="proj"
            stroke="#f97316"
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
            name="Projeção casos"
            connectNulls={false}
          />
          {/* Temperatura */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="temp"
            stroke="#3b82f6"
            strokeWidth={1.5}
            dot={false}
            name="Temp obs. (°C)"
            connectNulls
          />
          {/* Temperatura projetada (SEAS5) */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="tempProj"
            stroke="#7dd3fc"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
            name="Temp proj."
            connectNulls
          />
          {/* ONI */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="oni"
            stroke="#f59e0b"
            strokeWidth={1.5}
            strokeDasharray="6 2"
            dot={false}
            name="ONI"
            connectNulls
          />

          {/* Limiar El Niño */}
          <ReferenceLine
            yAxisId="right"
            y={0.5}
            stroke="#f97316"
            strokeDasharray="3 3"
            strokeOpacity={0.4}
            label={{
              value: 'ONI = +0,5',
              fontSize: 9,
              fill: '#f97316',
              position: 'right',
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500">
        <div>
          <span className="font-semibold text-gray-700">Período:</span>{' '}
          {visiveis[0]?.label} – {visiveis[visiveis.length - 1]?.label}
        </div>
        <div>
          <span className="font-semibold text-gray-700">SE atual:</span>{' '}
          {data.semana_epi || '—'}
        </div>
        {data.elnino?.ativo && (
          <div className="col-span-2">
            <span className="font-semibold text-orange-700">Cenário:</span>{' '}
            El Niño {data.elnino.intensidade} · ONI{' '}
            {data.elnino.oni_atual?.toFixed(2)} · fator ×
            {data.elnino.fator_atual}
          </div>
        )}
      </div>
    </article>
  );
};

export default ElNinoGuiaGraficoMunicipal;
