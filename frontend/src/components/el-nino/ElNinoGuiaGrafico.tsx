import React, { useEffect, useRef, useState } from 'react';
import { GuiaChave, GuiaMarcador, guiaComContexto } from './guias-graficos';

const MARCADOR_CLASS: Record<GuiaMarcador, string> = {
  'laranja-forte': 'bg-orange-500',
  'laranja-claro': 'bg-orange-300',
  laranja: 'bg-orange-500',
  azul: 'bg-blue-500',
  verde: 'bg-green-500',
  vermelho: 'bg-red-500',
  'vermelho-claro': 'bg-red-300',
  amarelo: 'bg-amber-400',
  neutro: 'bg-slate-400',
};

interface Props {
  chave: GuiaChave;
  /** Rótulo do consórcio/escopo para personalizar textos da legenda (ex.: SIMSAUDE - ZURS UBÁ). */
  contexto?: string | null;
}

/**
 * Botão "!" no canto do card — abre painel com explicação em linguagem simples.
 * Equivalente ao `guia-btn` do Dash_Completo.
 */
export const ElNinoGuiaGrafico: React.FC<Props> = ({ chave, contexto }) => {
  const guia = guiaComContexto(chave, contexto);
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [aberto]);

  if (!guia) return null;

  return (
    <div ref={ref} className="absolute top-3 right-3 z-20">
      <button
        type="button"
        className={`w-7 h-7 rounded-full border text-sm font-bold flex items-center justify-center transition-colors ${
          aberto
            ? 'bg-sky-500 text-white border-sky-500'
            : 'bg-sky-50 text-sky-600 border-sky-300 hover:bg-sky-100 hover:border-sky-400'
        }`}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        aria-label={guia.titulo}
        title={guia.titulo}
        onClick={(e) => {
          e.stopPropagation();
          setAberto((v) => !v);
        }}
      >
        <span aria-hidden="true">!</span>
      </button>

      {aberto && (
        <aside
          role="dialog"
          aria-label={guia.titulo}
          className="absolute top-[calc(100%+6px)] right-0 w-[min(340px,calc(100vw-2.5rem))] max-h-[min(420px,70vh)] overflow-y-auto rounded-lg border border-gray-200 border-l-[3px] border-l-sky-500 bg-white shadow-xl p-3"
        >
          <h4 className="text-xs font-semibold text-gray-800 mb-2 pr-1">{guia.titulo}</h4>
          <ul className="space-y-2.5 list-none m-0 p-0">
            {guia.itens.map((item, i) => (
              <li key={i} className="flex gap-2.5 items-start">
                <span
                  className={`w-3.5 h-3.5 rounded-sm shrink-0 mt-0.5 ${MARCADOR_CLASS[item.marcador]}`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <strong className="block text-[11px] font-semibold text-gray-700">
                    {item.rotulo}
                  </strong>
                  <p className="text-[11px] leading-relaxed text-gray-500 mt-0.5">{item.texto}</p>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
};

export default ElNinoGuiaGrafico;
