import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

const PAINEL_LARGURA = 340;
const PAINEL_GAP = 6;
/** Acima da nav sticky (z-20) e do header (pt-16 / z típico de layout). */
const PAINEL_Z = 80;

interface Props {
  chave: GuiaChave;
  /** Rótulo do consórcio/escopo para personalizar textos da legenda (ex.: SIMSAUDE - ZURS UBÁ). */
  contexto?: string | null;
  /** Classes extras no wrapper do botão (ex.: posição em cards compactos). */
  className?: string;
}

type PainelPos = { top: number; left: number; maxHeight: number };

/**
 * Botão "!" no canto do card — abre painel com explicação em linguagem simples.
 * O painel vai para um portal (fixed) para não ficar sob nav sticky / stacking contexts.
 */
export const ElNinoGuiaGrafico: React.FC<Props> = ({
  chave,
  contexto,
  className,
}) => {
  const guia = guiaComContexto(chave, contexto);
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<PainelPos | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLElement>(null);

  const atualizarPosicao = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const largura = Math.min(PAINEL_LARGURA, window.innerWidth - 20);
    let left = r.right - largura;
    left = Math.max(10, Math.min(left, window.innerWidth - largura - 10));

    const espacoAbaixo = window.innerHeight - r.bottom - PAINEL_GAP - 12;
    const espacoAcima = r.top - PAINEL_GAP - 12;
    const abrirParaCima = espacoAbaixo < 220 && espacoAcima > espacoAbaixo;
    const maxHeight = Math.min(
      420,
      Math.max(160, abrirParaCima ? espacoAcima : espacoAbaixo),
    );

    const top = abrirParaCima
      ? Math.max(10, r.top - PAINEL_GAP - maxHeight)
      : r.bottom + PAINEL_GAP;

    setPos({ top, left, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!aberto) {
      setPos(null);
      return;
    }
    atualizarPosicao();
  }, [aberto, atualizarPosicao]);

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (painelRef.current?.contains(t)) return;
      setAberto(false);
    };
    const onReposition = () => atualizarPosicao();

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [aberto, atualizarPosicao]);

  if (!guia) return null;

  const painel =
    aberto &&
    pos &&
    typeof document !== 'undefined' &&
    createPortal(
      <aside
        ref={painelRef}
        role="dialog"
        aria-label={guia.titulo}
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          width: Math.min(PAINEL_LARGURA, window.innerWidth - 20),
          maxHeight: pos.maxHeight,
          zIndex: PAINEL_Z,
        }}
        className="overflow-y-auto rounded-lg border border-gray-200 border-l-[3px] border-l-sky-500 bg-white shadow-xl p-3"
      >
        <h4 className="text-xs font-semibold text-gray-800 mb-2 pr-1">
          {guia.titulo}
        </h4>
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
                <p className="text-[11px] leading-relaxed text-gray-500 mt-0.5">
                  {item.texto}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </aside>,
      document.body,
    );

  return (
    <div
      ref={wrapRef}
      className={className ?? 'absolute top-3 right-3 z-20'}
    >
      <button
        ref={btnRef}
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
      {painel}
    </div>
  );
};

export default ElNinoGuiaGrafico;
