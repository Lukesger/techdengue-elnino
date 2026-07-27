import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { CorrelacoesResponse } from '@/services/el-nino-api';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';

interface Props {
  data: CorrelacoesResponse | null;
  loading?: boolean;
}

type PontoCorr = {
  rotulo: string;
  r: number;
  interpretacao: string;
  grupo: 'clima' | 'elnino';
  n: number | null;
};

const TooltipCustom = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as PontoCorr | undefined;
  if (!p) return null;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl max-w-xs">
      <p className="font-semibold mb-1">{p.rotulo}</p>
      <p className={p.r >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
        r = {p.r.toFixed(3)}
      </p>
      <p className="text-gray-300 mt-1">{p.interpretacao}</p>
      {p.n != null && (
        <p className="text-gray-400 mt-1 text-[10px]">n = {p.n} meses</p>
      )}
      <p className="text-gray-500 mt-1 text-[10px]">
        Correlação ≠ causalidade
      </p>
    </div>
  );
};

function corBarra(r: number): string {
  if (r >= 0.5) return '#059669';
  if (r >= 0.2) return '#34d399';
  if (r > -0.2) return '#94a3b8';
  if (r > -0.5) return '#f87171';
  return '#dc2626';
}

/**
 * Painel de correlações Pearson clima × dengue e El Niño × variáveis.
 */
export const ElNinoCorrelacoesClima: React.FC<Props> = ({ data, loading }) => {
  const pontos = useMemo<PontoCorr[]>(() => {
    if (!data) return [];
    const clima = (data.clima ?? []).map((c) => ({
      rotulo: c.variavel_clima,
      r: Number(c.correlacao) || 0,
      interpretacao: c.interpretacao || '',
      grupo: 'clima' as const,
      n: typeof c.n === 'number' ? c.n : null,
    }));
    const elnino = (data.elnino ?? []).map((c) => ({
      rotulo: c.variavel,
      r: Number(c.correlacao) || 0,
      interpretacao: c.interpretacao || '',
      grupo: 'elnino' as const,
      n: null,
    }));
    return [...clima, ...elnino].sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  }, [data]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="h-72 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!pontos.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-gray-400 text-sm">
        Correlações indisponíveis (série com menos de 6 meses ou sem dados).
      </div>
    );
  }

  const altura = Math.max(280, pontos.length * 36 + 48);

  return (
    <article className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="correlacoes" />
      <header className="mb-3 pr-8">
        <h3 className="text-sm font-semibold text-gray-800">
          Correlações Pearson
        </h3>
        <p className="text-xs text-gray-400">
          Clima e El Niño × casos de dengue · escala −1 a +1
        </p>
      </header>

      <ResponsiveContainer width="100%" height={altura}>
        <BarChart
          data={pontos}
          layout="vertical"
          margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
          <XAxis
            type="number"
            domain={[-1, 1]}
            ticks={[-1, -0.5, 0, 0.5, 1]}
            tick={{ fontSize: 10, fill: '#94a3b8' }}
          />
          <YAxis
            type="category"
            dataKey="rotulo"
            width={120}
            tick={{ fontSize: 10, fill: '#64748b' }}
          />
          <Tooltip content={<TooltipCustom />} />
          <ReferenceLine x={0} stroke="#cbd5e1" strokeWidth={1} />
          <Bar dataKey="r" name="r" barSize={18} radius={[0, 4, 4, 0]}>
            {pontos.map((p, i) => (
              <Cell key={i} fill={corBarra(p.r)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </article>
  );
};

export default ElNinoCorrelacoesClima;
