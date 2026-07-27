import React from 'react';
import Link from 'next/link';
import { FaMap, FaArrowLeft } from 'react-icons/fa';
import {
  buildMapaProjecaoHref,
  MapaProjecaoQuery,
} from '@/utils/el-nino/mapa-projecao-href';

interface Props {
  /** Subtítulo dinâmico (ex: "Período 2021–2025 · 22 municípios"). */
  subtitulo?: string | null;
  /** Esconde os chips de navegação interna (útil em /guia e /mapa). */
  esconderLinks?: boolean;
  /** Filtro territorial aplicado — define o destino do link "Mapa projeção". */
  mapaQuery?: MapaProjecaoQuery;
  /**
   * Na página do mapa: troca o chip "Mapa projeção →" por um botão de retorno
   * ao gerencial (o filtro é restaurado via sessionStorage na volta).
   */
  voltarGerencial?: boolean;
}

/**
 * Header de página El Niño com legenda azul/laranja + links chip
 * (Mapa de Projeção, Guia 2026). Equivalente ao `<header class="header">`
 * do `index.html` do DASH.COMPLETO.
 */
export const ElNinoHeaderLegenda: React.FC<Props> = ({
  subtitulo,
  esconderLinks,
  mapaQuery,
  voltarGerencial,
}) => {
  const hrefMapa = buildMapaProjecaoHref(mapaQuery);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex-1 min-w-[200px]">
        <h1 className="text-base font-semibold text-gray-800 leading-tight">
          TechDengue — Análise Preditiva El Niño
        </h1>
        {subtitulo && (
          <p className="text-xs text-gray-500 mt-0.5">{subtitulo}</p>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="inline-flex items-center gap-1.5 text-gray-600">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-sky-400" />
          Sem El Niño
        </span>
        <span className="inline-flex items-center gap-1.5 text-gray-600">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400" />
          El Niño (ONI ≥ +0,5)
        </span>

        {!esconderLinks &&
          (voltarGerencial ? (
            <Link
              href="/el-nino-analytics"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[#0087a8] border border-[#0087a8]/30 hover:bg-[#0087a8]/10 transition-colors font-medium"
            >
              <FaArrowLeft className="w-3 h-3" />
              Voltar ao gerencial
            </Link>
          ) : (
            <Link
              href={hrefMapa}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[#0087a8] border border-[#0087a8]/30 hover:bg-[#0087a8]/10 transition-colors font-medium"
            >
              <FaMap className="w-3 h-3" />
              Mapa projeção →
            </Link>
          ))}
      </div>
    </div>
  );
};

export default ElNinoHeaderLegenda;
