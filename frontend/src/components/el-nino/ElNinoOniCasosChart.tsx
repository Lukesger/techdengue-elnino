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
  ReferenceArea,
  ReferenceLine,
  Cell,
} from 'recharts';
import { SerieMensal } from '@/services/el-nino-api';

interface Props {
  /** `pacote.df_serie` do overview. */
  serie: SerieMensal[] | null | undefined;
  loading?: boolean;
}

interface Ponto {
  oni: number;
  casos: number;
  rotulo: string;
  faseElNino: boolean;
}

const TooltipCustom = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Ponto;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl">
      <p className="font-semibold mb-1">{p.rotulo}</p>
      <p>ONI: {p.oni > 0 ? '+' : ''}{p.oni.toFixed(2)} °C</p>
      <p>Casos: {p.casos.toLocaleString('pt-BR')}</p>
      <p className="mt-1 text-orange-300">
        {p.faseElNino ? 'Fase El Niño' : 'Fase neutra/La Niña'}
      </p>
    </div>
  );
};

/**
 * Gráfico ONI × Casos — equivalente ao `grafico-oni` do `index.html` do
 * DASH.COMPLETO. Scatter cruzando ONI mensal vs casos mensais; cada ponto
 * colorido pela fase (laranja = El Niño ≥+0,5; azul = neutro/La Niña).
 */
export const ElNinoOniCasosChart: React.FC<Props> = ({ serie, loading }) => {
  const pontos = useMemo<Ponto[]>(() => {
    if (!serie?.length) return [];
    return serie
      .filter((r) => r.ONI != null)
      .map((r) => ({
        oni: r.ONI as number,
        casos: r.CasosDengue,
        rotulo: `${r.Mes}/${r.Ano}`,
        faseElNino: (r.ONI as number) >= 0.5,
      }));
  }, [serie]);

  const maxCasos = useMemo(
    () => (pontos.length ? Math.max(...pontos.map((p) => p.casos)) : 100),
    [pontos],
  );

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-64 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!pontos.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-400">
        Sem dados de ONI para o período.
      </div>
    );
  }

  return (
    <article className="bg-white rounded-xl border border-gray-100 p-4">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-gray-800">
          ONI × Casos de dengue
        </h3>
        <p className="text-xs text-gray-400">
          Cada ponto = um mês · faixa laranja marca El Niño (ONI ≥ +0,5 °C)
        </p>
      </header>

      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            type="number"
            dataKey="oni"
            name="ONI"
            domain={[-2, 3]}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            label={{
              value: 'ONI (°C)',
              position: 'insideBottom',
              offset: -2,
              fontSize: 11,
              fill: '#6b7280',
            }}
          />
          <YAxis
            type="number"
            dataKey="casos"
            name="Casos"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            label={{
              value: 'Casos',
              angle: -90,
              position: 'insideLeft',
              fontSize: 11,
              fill: '#6b7280',
            }}
          />
          <Tooltip content={<TooltipCustom />} cursor={{ strokeDasharray: '3 3' }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />

          {/* Faixa de El Niño moderado (0.5 a 1.5) */}
          <ReferenceArea
            x1={0.5}
            x2={1.5}
            y1={0}
            y2={maxCasos * 1.05}
            fill="#fb923c"
            fillOpacity={0.07}
            stroke="none"
          />
          {/* Faixa de El Niño forte (>= 1.5) */}
          <ReferenceArea
            x1={1.5}
            x2={3}
            y1={0}
            y2={maxCasos * 1.05}
            fill="#dc2626"
            fillOpacity={0.1}
            stroke="none"
          />

          <ReferenceLine
            x={0.5}
            stroke="#fb923c"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
          />
          <ReferenceLine
            x={0}
            stroke="#94a3b8"
            strokeOpacity={0.4}
          />

          <Scatter name="Mensal" data={pontos}>
            {pontos.map((p, i) => (
              <Cell
                key={i}
                fill={p.faseElNino ? '#fb923c' : '#38bdf8'}
                fillOpacity={0.75}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-sky-400" />
          Sem El Niño
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400" />
          El Niño (ONI ≥ +0,5)
        </span>
        <span className="ml-auto text-gray-400">
          {pontos.length} pontos · {pontos.filter((p) => p.faseElNino).length}{' '}
          em fase El Niño
        </span>
      </div>
    </article>
  );
};

export default ElNinoOniCasosChart;
