import React, { useEffect, useRef, useState } from 'react';
import { FaChevronLeft, FaChevronRight, FaPause, FaPlay } from 'react-icons/fa';

interface MunicipioOpcao {
  geocode: number;
  nome: string;
}

interface Props {
  municipios: MunicipioOpcao[];
  geocodeSelecionado: number | null;
  onGeocodeMudou: (geocode: number | null) => void;
  /** Intervalo em ms entre rotações automáticas (default 15s). */
  intervaloMs?: number;
  /** Esconde o carrossel quando há ≤ 1 município. */
  esconderSeUnico?: boolean;
}

/**
 * Carrossel de municípios com auto-avanço a cada 15s — equivalente ao
 * comportamento do `subtitulo` rotativo no DASH.COMPLETO (`app_completo.js`,
 * função `rotacionarKpis`). Quando o usuário interage manualmente, o
 * autoplay pausa temporariamente.
 */
export const ElNinoCarrosselMunicipios: React.FC<Props> = ({
  municipios,
  geocodeSelecionado,
  onGeocodeMudou,
  intervaloMs = 15000,
  esconderSeUnico = true,
}) => {
  const [autoplay, setAutoplay] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ordenados = React.useMemo(
    () =>
      [...municipios].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [municipios],
  );

  const indice = React.useMemo(() => {
    if (geocodeSelecionado == null) return -1;
    return ordenados.findIndex((m) => m.geocode === geocodeSelecionado);
  }, [ordenados, geocodeSelecionado]);

  const avancar = React.useCallback(
    (direcao: 1 | -1) => {
      if (!ordenados.length) return;
      const proximo =
        indice < 0
          ? 0
          : (indice + direcao + ordenados.length) % ordenados.length;
      onGeocodeMudou(ordenados[proximo].geocode);
    },
    [indice, ordenados, onGeocodeMudou],
  );

  useEffect(() => {
    if (!autoplay || ordenados.length <= 1) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => avancar(1), intervaloMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoplay, ordenados.length, intervaloMs, avancar]);

  if (esconderSeUnico && ordenados.length <= 1) return null;

  const atual = indice >= 0 ? ordenados[indice] : null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 px-4 py-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <button
          type="button"
          onClick={() => {
            setAutoplay(false);
            avancar(-1);
          }}
          className="w-7 h-7 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 flex items-center justify-center flex-shrink-0"
          aria-label="Município anterior"
        >
          <FaChevronLeft className="w-3 h-3" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">
            Visualizando município
          </p>
          <p className="text-sm font-semibold text-gray-800 truncate">
            {atual?.nome ?? `Agregado (${ordenados.length} municípios)`}
            <span className="text-xs text-gray-400 font-normal ml-2">
              {indice >= 0
                ? `${indice + 1}/${ordenados.length}`
                : `${ordenados.length} municípios`}
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setAutoplay(false);
            avancar(1);
          }}
          className="w-7 h-7 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 flex items-center justify-center flex-shrink-0"
          aria-label="Próximo município"
        >
          <FaChevronRight className="w-3 h-3" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        {indice >= 0 && (
          <button
            type="button"
            onClick={() => {
              setAutoplay(false);
              onGeocodeMudou(null);
            }}
            className="text-xs text-[#0087a8] hover:underline font-medium"
          >
            Ver agregado
          </button>
        )}
        <button
          type="button"
          onClick={() => setAutoplay((s) => !s)}
          className={`w-7 h-7 rounded-md border flex items-center justify-center transition-colors ${
            autoplay
              ? 'border-[#0087a8]/40 text-[#0087a8] bg-[#0087a8]/5'
              : 'border-gray-200 text-gray-400 hover:text-gray-600'
          }`}
          aria-label={autoplay ? 'Pausar autoplay' : 'Retomar autoplay'}
          title={autoplay ? 'Pausar autoplay' : 'Retomar autoplay'}
        >
          {autoplay ? (
            <FaPause className="w-2.5 h-2.5" />
          ) : (
            <FaPlay className="w-2.5 h-2.5" />
          )}
        </button>
      </div>
    </div>
  );
};

export default ElNinoCarrosselMunicipios;
