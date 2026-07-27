import React from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ClimaForecast } from '@/services/el-nino-api';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';

interface Props {
  clima: ClimaForecast | null;
  loading?: boolean;
}

export const ElNinoPrevisaoClima: React.FC<Props> = ({ clima, loading }) => {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="h-52 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!clima?.dias?.length) return null;

  const dados = clima.dias.slice(0, 14).map((d) => ({
    data: d.periodo || d.data,
    max: d.max_c,
    min: d.min_c,
    chuva: d.chuva_mm,
    umidade: d.umidade_pct,
  }));

  return (
    <div className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="previsao" />
      <div className="flex items-center justify-between mb-1 pr-8">
        <h3 className="text-sm font-semibold text-gray-800">Previsão Climática 14 dias</h3>
        <span className="text-xs text-gray-400">{clima.cidade} · {clima.fonte}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-orange-50 rounded-lg p-2 text-xs text-center">
          <p className="text-gray-500">Temperatura atual</p>
          <p className="font-bold text-lg text-orange-600">{clima.atual?.temperatura_c?.toFixed(1)}°C</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-2 text-xs text-center">
          <p className="text-gray-500">Umidade</p>
          <p className="font-bold text-lg text-blue-600">{clima.atual?.umidade_pct}%</p>
        </div>
        <div className="bg-sky-50 rounded-lg p-2 text-xs text-center">
          <p className="text-gray-500">Chuva atual</p>
          <p className="font-bold text-lg text-sky-600">{clima.atual?.precipitacao_mm?.toFixed(1)} mm</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={dados} margin={{ top: 5, right: 30, left: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="data" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={1} />
          <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#9ca3af' }} unit="°C" />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="left" dataKey="chuva" name="Chuva (mm)" fill="#93c5fd" radius={[2, 2, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="max" name="Máx (°C)" stroke="#ef4444" strokeWidth={2} dot={false} />
          <Line yAxisId="right" type="monotone" dataKey="min" name="Mín (°C)" stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ElNinoPrevisaoClima;
