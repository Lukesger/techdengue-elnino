import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { ComparativoMensal } from '@/services/el-nino-api';

interface Props {
  comparativo: { comparativo_mensal: ComparativoMensal[]; resumo?: any } | null;
  loading?: boolean;
}

const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

export const ElNinoComparativoChart: React.FC<Props> = ({ comparativo, loading }) => {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="h-52 bg-gray-100 rounded" />
      </div>
    );
  }

  const dados = comparativo?.comparativo_mensal ?? [];
  if (!dados.length) return null;

  // Organizar em pares Com/Sem por mês
  const porMes: Record<number, { com?: number; sem?: number; mes: string }> = {};
  for (const r of dados) {
    if (!porMes[r.MesNum]) porMes[r.MesNum] = { mes: r.Mes || MESES_ABREV[r.MesNum - 1] };
    if (r.ElNino) porMes[r.MesNum].com = r.CasosDengue;
    else porMes[r.MesNum].sem = r.CasosDengue;
  }
  const chartData = Object.values(porMes).sort((a: any, b: any) =>
    MESES_ABREV.indexOf(a.mes) - MESES_ABREV.indexOf(b.mes)
  );

  const resumo = comparativo?.resumo;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">Comparativo El Niño por Mês</h3>
        {resumo && (
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
            resumo.variacao_casos_pct > 0
              ? 'bg-orange-100 text-orange-700'
              : 'bg-green-100 text-green-700'
          }`}>
            {resumo.variacao_casos_pct > 0 ? '+' : ''}{resumo.variacao_casos_pct?.toFixed(1)}% em anos El Niño
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#9ca3af' }} />
          <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <Tooltip
            formatter={(v: number, name: string) => [`${Math.round(v)} casos`, name]}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="sem" name="Sem El Niño" fill="#3b82f6" radius={[3, 3, 0, 0]} />
          <Bar dataKey="com" name="Com El Niño" fill="#f97316" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {resumo && (
        <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
          <div className="bg-blue-50 rounded-lg p-2">
            <p className="text-gray-500">Média mensal sem El Niño</p>
            <p className="font-semibold text-gray-700">{Math.round(resumo.casos_media_mensal_sem)} casos</p>
          </div>
          <div className="bg-orange-50 rounded-lg p-2">
            <p className="text-gray-500">Média mensal com El Niño</p>
            <p className="font-semibold text-gray-700">{Math.round(resumo.casos_media_mensal_com)} casos</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ElNinoComparativoChart;
