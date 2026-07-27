import React from 'react';
import { ElNinoKpi } from '@/services/el-nino-api';
import { FaThermometerHalf, FaCloudRain, FaVirus, FaWater, FaChartLine } from 'react-icons/fa';

interface Props {
  kpis: ElNinoKpi[];
  loading?: boolean;
}

const ICONS = [
  <FaThermometerHalf key="temp" className="w-6 h-6" />,
  <FaWater key="oni" className="w-6 h-6" />,
  <FaVirus key="casos" className="w-6 h-6" />,
  <FaChartLine key="corr" className="w-6 h-6" />,
  <FaCloudRain key="chuva" className="w-6 h-6" />,
];

const COLORS = [
  'from-orange-500 to-red-500',
  'from-amber-500 to-orange-500',
  'from-red-500 to-rose-600',
  'from-purple-500 to-indigo-600',
  'from-sky-400 to-blue-600',
];

export const ElNinoKpiCards: React.FC<Props> = ({ kpis, loading }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
            <div className="h-8 bg-gray-200 rounded w-1/2 mb-1" />
            <div className="h-3 bg-gray-200 rounded w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {kpis.map((kpi, idx) => (
        <div
          key={idx}
          className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between mb-2">
            <p className="text-xs text-gray-500 font-medium leading-tight">{kpi.titulo}</p>
            <div className={`p-1.5 rounded-lg bg-gradient-to-br ${COLORS[idx] ?? COLORS[0]} text-white flex-shrink-0 ml-2`}>
              {ICONS[idx] ?? ICONS[0]}
            </div>
          </div>
          <p className="text-xl font-bold text-gray-800 mt-1">{kpi.valor}</p>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{kpi.subtitulo}</p>
        </div>
      ))}
    </div>
  );
};

export default ElNinoKpiCards;
