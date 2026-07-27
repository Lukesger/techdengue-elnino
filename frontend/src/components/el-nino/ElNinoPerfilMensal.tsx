import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ComparativoMensal } from '@/services/el-nino-api';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';
import { perfilMensalElNino, rotuloEscopoGrafico } from '@/utils/el-nino/graficos-filtros';

const MESES_ORDEM = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

interface Props {
  mensalMun?: Array<Record<string, unknown>> | null;
  comparativoMensal?: ComparativoMensal[] | null;
  anoInicio?: number;
  anoFim?: number;
  nMunicipios?: number;
  nomeMunicipio?: string | null;
  loading?: boolean;
}

/**
 * Perfil mensal Sem x Com El Niño (equivalente a `chartElNinoMensal`).
 */
export const ElNinoPerfilMensal: React.FC<Props> = ({
  mensalMun,
  comparativoMensal,
  anoInicio,
  anoFim,
  nMunicipios = 0,
  nomeMunicipio,
  loading,
}) => {
  const chartData = useMemo(() => {
    let dados: ComparativoMensal[] = [];

    if (mensalMun?.length && anoInicio != null && anoFim != null) {
      const filtrado = mensalMun.filter((r) => {
        const a = Number(r.Ano);
        return a >= anoInicio && a <= anoFim;
      });
      dados = perfilMensalElNino(filtrado).dados;
    } else if (comparativoMensal?.length) {
      dados = comparativoMensal;
    }

    const sem = dados
      .filter((c) => c.Periodo === 'Sem El Nino' || c.ElNino === 0)
      .sort((a, b) => a.MesNum - b.MesNum);
    const com = dados
      .filter((c) => c.Periodo === 'Com El Nino' || c.ElNino === 1)
      .sort((a, b) => a.MesNum - b.MesNum);

    return MESES_ORDEM.map((mes, i) => {
      const mesNum = i + 1;
      const s = sem.find((r) => r.MesNum === mesNum);
      const c = com.find((r) => r.MesNum === mesNum);
      return {
        mes,
        sem: s?.CasosDengue ?? null,
        com: c?.CasosDengue ?? null,
      };
    });
  }, [mensalMun, comparativoMensal, anoInicio, anoFim]);

  const temDados = chartData.some((d) => d.sem != null || d.com != null);

  const escopoRotulo = rotuloEscopoGrafico(nomeMunicipio, nMunicipios);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="h-72 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!temDados) return null;

  return (
    <article className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="elnino-mes" />
      <header className="mb-3 pr-8">
        <h3 className="text-sm font-semibold text-gray-800">Perfil mensal de casos</h3>
        <p className="text-xs text-gray-400">
          Sem x Com El Niño
          {escopoRotulo ? ` · ${escopoRotulo}` : ''}
          {' · média anual'}
        </p>
      </header>

      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickFormatter={(v) => Number(v).toLocaleString('pt-BR')}
            label={{ value: 'Casos (média mensal)', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#9ca3af' }}
          />
          <Tooltip
            formatter={(v: number, name: string) => [
              v != null ? Math.round(v).toLocaleString('pt-BR') : '—',
              name,
            ]}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            type="monotone"
            dataKey="sem"
            stroke="#3b82f6"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#3b82f6' }}
            name="Sem El Niño (2020–2022)"
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="com"
            stroke="#f97316"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#f97316' }}
            name="Com El Niño (2023–2024)"
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </article>
  );
};

export default ElNinoPerfilMensal;
