import React from 'react';
import Link from 'next/link';
import { FaMap, FaArrowLeft } from 'react-icons/fa';
import {
  buildElNinoDashboardHref,
  buildMapaProjecaoHref,
  MapaProjecaoQuery,
} from '@/utils/el-nino/mapa-projecao-href';

interface Props {
  /** Mantido por compatibilidade — título/subtítulo de página foram removidos. */
  subtitulo?: string | null;
  /** Esconde os chips de navegação interna (útil em /guia e /mapa). */
  esconderLinks?: boolean;
  /** Esconde a legenda de cores (útil em /mapa, onde a legenda fica abaixo do mapa). */
  esconderLegendaCores?: boolean;
  /** Filtro territorial aplicado — define o destino do link "Mapa projeção". */
  mapaQuery?: MapaProjecaoQuery;
  /**
   * Na página do mapa: troca o chip "Mapa projeção →" por um botão de retorno
   * ao dashboard do mesmo escopo (contrato/município) ou ao gerencial.
   */
  voltarGerencial?: boolean;
}

/**
 * Barra de contexto do mapa / analytics — sem título de página.
 * Legenda de cores + navegação (mapa ↔ dashboard).
 */
export const ElNinoHeaderLegenda: React.FC<Props> = ({
  esconderLinks,
  esconderLegendaCores,
  mapaQuery,
  voltarGerencial,
}) => {
  const hrefMapa = buildMapaProjecaoHref(mapaQuery);
  const hrefVoltar = buildElNinoDashboardHref(mapaQuery);
  const temFocoTerritorial =
    (mapaQuery?.contratoId != null && mapaQuery.contratoId > 0) ||
    (mapaQuery?.geocode != null && mapaQuery.geocode > 0);
  const rotuloVoltar = temFocoTerritorial
    ? 'Voltar ao dashboard'
    : 'Voltar ao gerencial';

  const mostrarLegenda = !esconderLegendaCores;
  const mostrarLinks = !esconderLinks;

  if (!mostrarLegenda && !mostrarLinks) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-wrap items-center justify-between gap-3">
      {mostrarLegenda ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-cyan-300" aria-hidden />
            Menos casos
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-orange-500" aria-hidden />
            Mais casos
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-red-800" aria-hidden />
            Crítico ≥500
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-orange-400" aria-hidden />
            El Niño (ONI ≥ +0,5)
          </span>
        </div>
      ) : (
        <span className="sr-only">Mapa de projeção El Niño</span>
      )}

      {mostrarLinks &&
        (voltarGerencial ? (
          <Link
            href={hrefVoltar}
            className="inline-flex items-center gap-1.5 shrink-0 ml-auto px-3.5 py-2 rounded-xl text-sm font-semibold text-[#0087a8] bg-[#0087a8]/[0.06] border border-[#0087a8]/20 hover:bg-[#0087a8]/10 hover:border-[#0087a8]/35 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0087a8]/35"
          >
            <FaArrowLeft className="w-3 h-3" aria-hidden />
            {rotuloVoltar}
          </Link>
        ) : (
          <Link
            href={hrefMapa}
            className="inline-flex items-center gap-1.5 shrink-0 ml-auto px-3.5 py-2 rounded-xl text-sm font-semibold text-[#0087a8] bg-[#0087a8]/[0.06] border border-[#0087a8]/20 hover:bg-[#0087a8]/10 hover:border-[#0087a8]/35 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0087a8]/35"
          >
            <FaMap className="w-3.5 h-3.5" aria-hidden />
            Abrir mapa de projeção
          </Link>
        ))}
    </div>
  );
};

export default ElNinoHeaderLegenda;
