import React, { useState } from 'react';
import { AlertaPreditivo } from '@/services/el-nino-api';
import { FaExclamationTriangle, FaInfoCircle, FaCheckCircle, FaThermometerHalf, FaVirus, FaCloud, FaBroadcastTower } from 'react-icons/fa';
import { FaCloudSunRain } from 'react-icons/fa6';

interface Props {
  alertas: AlertaPreditivo[];
  loading?: boolean;
}

const CATEGORIA_CONFIG: Record<string, { label: string; icon: React.ReactNode; bg: string; border: string }> = {
  inmet:         { label: 'INMET',      icon: <FaBroadcastTower className="w-4 h-4" />, bg: 'bg-red-50',    border: 'border-red-300' },
  elnino:        { label: 'El Niño',    icon: <FaCloudSunRain className="w-4 h-4" />,   bg: 'bg-orange-50', border: 'border-orange-300' },
  chuva:         { label: 'Chuva',      icon: <FaCloud className="w-4 h-4" />,           bg: 'bg-blue-50',   border: 'border-blue-300' },
  previsao_clima:{ label: 'Clima',      icon: <FaCloud className="w-4 h-4" />,           bg: 'bg-sky-50',    border: 'border-sky-300' },
  onda_calor:    { label: 'Calor',      icon: <FaThermometerHalf className="w-4 h-4" />, bg: 'bg-yellow-50', border: 'border-yellow-400' },
  umidade:       { label: 'Umidade',    icon: <FaCloud className="w-4 h-4" />,           bg: 'bg-teal-50',   border: 'border-teal-300' },
  dengue:        { label: 'Dengue',     icon: <FaVirus className="w-4 h-4" />,           bg: 'bg-rose-50',   border: 'border-rose-300' },
};

const NIVEL_CONFIG = {
  alto:  { label: 'Alto',   icon: <FaExclamationTriangle className="w-3 h-3 text-red-600" />,   badge: 'bg-red-100 text-red-700' },
  medio: { label: 'Médio',  icon: <FaInfoCircle className="w-3 h-3 text-amber-600" />,           badge: 'bg-amber-100 text-amber-700' },
  baixo: { label: 'Baixo',  icon: <FaCheckCircle className="w-3 h-3 text-green-600" />,          badge: 'bg-green-100 text-green-700' },
};

export const ElNinoAlertas: React.FC<Props> = ({ alertas, loading }) => {
  const [expandido, setExpandido] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg p-3 border border-gray-100 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-1" />
            <div className="h-3 bg-gray-200 rounded w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!alertas.length) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
        <FaCheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
        <p className="text-sm text-green-700">Nenhum alerta crítico nas fontes consultadas.</p>
      </div>
    );
  }

  // Agrupar por categoria
  const grupos: Record<string, AlertaPreditivo[]> = {};
  for (const a of alertas) {
    if (!grupos[a.categoria]) grupos[a.categoria] = [];
    grupos[a.categoria].push(a);
  }

  return (
    <div className="space-y-3">
      {Object.entries(grupos).map(([cat, items]) => {
        const cfg = CATEGORIA_CONFIG[cat] ?? CATEGORIA_CONFIG.dengue;
        const maxNivel = items.some(a => a.nivel === 'alto') ? 'alto' : items.some(a => a.nivel === 'medio') ? 'medio' : 'baixo';
        const nivelCfg = NIVEL_CONFIG[maxNivel];

        return (
          <div key={cat} className={`rounded-xl border ${cfg.border} ${cfg.bg} overflow-hidden`}>
            {/* Header da categoria */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-gray-600">{cfg.icon}</span>
                <span className="text-sm font-semibold text-gray-700">{cfg.label}</span>
                <span className="text-xs text-gray-400">({items.length})</span>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${nivelCfg.badge}`}>
                {nivelCfg.icon}
                {nivelCfg.label}
              </span>
            </div>

            {/* Itens */}
            <div className="divide-y divide-gray-100/50">
              {items.map((alerta, idx) => {
                const key = `${cat}-${idx}`;
                const aberto = expandido === parseInt(key.replace(/\D/g, '').slice(0, 3), 10);
                return (
                  <div
                    key={idx}
                    className="px-4 py-2 cursor-pointer hover:bg-white/50 transition-colors"
                    onClick={() => setExpandido(expandido === idx ? null : idx)}
                  >
                    <p className="text-sm font-medium text-gray-800">{alerta.titulo}</p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{alerta.descricao}</p>
                    {alerta.acao && expandido === idx && (
                      <p className="text-xs text-blue-700 mt-2 bg-blue-50 rounded p-2">
                        <span className="font-semibold">Ação recomendada: </span>{alerta.acao}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ElNinoAlertas;
