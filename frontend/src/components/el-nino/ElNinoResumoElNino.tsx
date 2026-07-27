import React from 'react';
import { ResumoElNino } from '@/services/el-nino-api';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';

interface Props {
  resumo: ResumoElNino | null | undefined;
  loading?: boolean;
}

function fmt(n: number | null | undefined, casas = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(n);
}

/**
 * Card com resumo expandido Com × Sem El Niño (médias e variação %).
 */
export const ElNinoResumoElNino: React.FC<Props> = ({ resumo, loading }) => {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!resumo) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-gray-400 text-sm">
        Resumo El Niño indisponível para o escopo atual.
      </div>
    );
  }

  const varPct = resumo.variacao_casos_pct;
  const varPositiva = varPct > 0;

  return (
    <article className="relative bg-white rounded-xl border border-gray-100 p-4 h-full">
      <ElNinoGuiaGrafico chave="resumo-elnino" />
      <header className="mb-3 pr-8">
        <h3 className="text-sm font-semibold text-gray-800">
          Resumo Com × Sem El Niño
        </h3>
        <p className="text-xs text-gray-400">
          Médias mensais no período filtrado · correlação ≠ causalidade
        </p>
      </header>

      <div
        className={`rounded-xl p-3 mb-3 text-center ${
          varPositiva
            ? 'bg-orange-50 border border-orange-100'
            : 'bg-emerald-50 border border-emerald-100'
        }`}
      >
        <p className="text-xs text-gray-500 mb-0.5">Variação de casos (El Niño vs neutro)</p>
        <p
          className={`text-2xl font-bold ${
            varPositiva ? 'text-orange-600' : 'text-emerald-600'
          }`}
        >
          {varPositiva ? '+' : ''}
          {fmt(varPct, 1)}%
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
          <p className="text-gray-500 mb-1 font-medium">Casos / mês</p>
          <p className="text-gray-800">
            <span className="text-sky-600 font-semibold">{fmt(resumo.casos_media_mensal_sem, 0)}</span>
            <span className="text-gray-400 mx-1">sem</span>
          </p>
          <p className="text-gray-800 mt-0.5">
            <span className="text-orange-600 font-semibold">{fmt(resumo.casos_media_mensal_com, 0)}</span>
            <span className="text-gray-400 mx-1">com</span>
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
          <p className="text-gray-500 mb-1 font-medium">Temperatura (°C)</p>
          <p className="text-gray-800">
            <span className="text-sky-600 font-semibold">{fmt(resumo.temp_media_sem)}</span>
            <span className="text-gray-400 mx-1">sem</span>
          </p>
          <p className="text-gray-800 mt-0.5">
            <span className="text-orange-600 font-semibold">{fmt(resumo.temp_media_com)}</span>
            <span className="text-gray-400 mx-1">com</span>
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
          <p className="text-gray-500 mb-1 font-medium">Chuva (mm)</p>
          <p className="text-gray-800">
            <span className="text-sky-600 font-semibold">{fmt(resumo.chuva_media_sem)}</span>
            <span className="text-gray-400 mx-1">sem</span>
          </p>
          <p className="text-gray-800 mt-0.5">
            <span className="text-orange-600 font-semibold">{fmt(resumo.chuva_media_com)}</span>
            <span className="text-gray-400 mx-1">com</span>
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
          <p className="text-gray-500 mb-1 font-medium">Anos no cálculo</p>
          <p className="text-sky-700">
            Sem: <span className="font-medium">{resumo.anos_sem || '—'}</span>
          </p>
          <p className="text-orange-700 mt-0.5">
            Com: <span className="font-medium">{resumo.anos_com || '—'}</span>
          </p>
        </div>
      </div>
    </article>
  );
};

export default ElNinoResumoElNino;
