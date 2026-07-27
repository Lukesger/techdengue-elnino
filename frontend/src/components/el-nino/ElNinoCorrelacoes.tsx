import React from 'react';
import { CorrelacaoClima } from '@/services/el-nino-api';
import { FaArrowUp, FaArrowDown, FaMinus } from 'react-icons/fa';

interface Props {
  correlacoes: CorrelacaoClima[];
  loading?: boolean;
}

function getStrengthConfig(r: number) {
  const a = Math.abs(r);
  if (a >= 0.5) return { label: 'Forte', color: r > 0 ? 'text-orange-600' : 'text-blue-600', bg: r > 0 ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200' };
  if (a >= 0.3) return { label: 'Moderada', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' };
  return { label: 'Fraca', color: 'text-gray-400', bg: 'bg-gray-50 border-gray-200' };
}

export const ElNinoCorrelacoes: React.FC<Props> = ({ correlacoes, loading }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-3 animate-pulse">
            <div className="h-3 bg-gray-200 rounded w-3/4 mb-2" />
            <div className="h-8 bg-gray-200 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (!correlacoes?.length) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Correlações Pearson</h3>
      <div className="grid grid-cols-2 gap-3">
        {correlacoes.map((c, i) => {
          const cfg = getStrengthConfig(c.correlacao);
          const Seta = c.correlacao > 0.1 ? FaArrowUp : c.correlacao < -0.1 ? FaArrowDown : FaMinus;
          return (
            <div key={i} className={`rounded-xl border p-3 ${cfg.bg}`}>
              <p className="text-xs text-gray-500 leading-tight">{c.variavel_clima}</p>
              <div className="flex items-center gap-1 mt-1">
                <Seta className={`w-3 h-3 ${cfg.color}`} />
                <span className={`text-lg font-bold ${cfg.color}`}>
                  r = {c.correlacao.toFixed(3)}
                </span>
              </div>
              <p className={`text-xs font-medium mt-0.5 ${cfg.color}`}>{cfg.label}</p>
              {typeof c.n === 'number' && (
                <p className="text-[10px] text-gray-400 mt-0.5">n = {c.n} meses</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 mt-2">|r| ≥ 0.5 = forte · ≥ 0.3 = moderada · &lt; 0.3 = fraca</p>
    </div>
  );
};

export default ElNinoCorrelacoes;
