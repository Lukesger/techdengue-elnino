import React from 'react';
import { FaBook } from 'react-icons/fa';

interface CausaDengue {
  titulo: string;
  pontos: string[];
}

interface Props {
  causa: CausaDengue | null;
  loading?: boolean;
}

/**
 * Card "Por que dengue cresce com clima e El Niño?" — equivalente ao
 * `#causa-box` do DASH.COMPLETO. Texto vem do backend (CAUSA_DENGUE em
 * el-nino-alertas.service.ts), exposto pelo overview em `causa_dengue`.
 */
export const ElNinoCausaDengue: React.FC<Props> = ({ causa, loading }) => {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-5 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-2/3 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!causa || !causa.pontos?.length) return null;

  return (
    <article className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg bg-gradient-to-br from-orange-400 to-amber-500 text-white">
          <FaBook className="w-4 h-4" />
        </div>
        <h2 className="text-base font-semibold text-gray-800">
          Porque o El Niño e o clima influenciam na dengue?
        </h2>
      </header>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {causa.pontos.map((ponto, i) => (
          <li
            key={i}
            className="text-sm text-gray-600 leading-relaxed pl-3 border-l-2 border-orange-300/60 bg-orange-50/40 rounded-r-md py-2 pr-3"
          >
            {ponto}
          </li>
        ))}
      </ul>
    </article>
  );
};

export default ElNinoCausaDengue;
