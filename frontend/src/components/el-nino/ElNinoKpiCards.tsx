import React from 'react';
import { ElNinoKpi } from '@/services/el-nino-api';
import {
  FaThermometerHalf,
  FaCloudRain,
  FaVirus,
  FaWater,
  FaChartLine,
  FaTint,
} from 'react-icons/fa';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';

interface Props {
  kpis: ElNinoKpi[];
  loading?: boolean;
}

type TemaKpi = {
  accent: string;
  iconBg: string;
  iconFg: string;
  bar: string;
  ring: string;
};

const TEMA_DEFAULT: TemaKpi = {
  accent: 'text-slate-600',
  iconBg: 'bg-slate-100',
  iconFg: 'text-slate-600',
  bar: 'bg-slate-300',
  ring: 'hover:border-slate-300',
};

const TEMAS: Record<string, TemaKpi> = {
  temp: {
    accent: 'text-orange-700',
    iconBg: 'bg-orange-50',
    iconFg: 'text-orange-600',
    bar: 'bg-gradient-to-b from-orange-400 to-amber-600',
    ring: 'hover:border-orange-200',
  },
  umidade: {
    accent: 'text-teal-700',
    iconBg: 'bg-teal-50',
    iconFg: 'text-teal-600',
    bar: 'bg-gradient-to-b from-teal-400 to-emerald-600',
    ring: 'hover:border-teal-200',
  },
  /** Média histórica — leitura analítica, não alarme. */
  casosMedios: {
    accent: 'text-violet-700',
    iconBg: 'bg-violet-50',
    iconFg: 'text-violet-600',
    bar: 'bg-gradient-to-b from-violet-400 to-indigo-600',
    ring: 'hover:border-violet-200',
  },
  /** Incidência do último mês — único vermelho (ação). */
  casosRecentes: {
    accent: 'text-rose-700',
    iconBg: 'bg-rose-50',
    iconFg: 'text-rose-600',
    bar: 'bg-gradient-to-b from-rose-400 to-red-600',
    ring: 'hover:border-rose-200',
  },
  chuva: {
    accent: 'text-sky-700',
    iconBg: 'bg-sky-50',
    iconFg: 'text-sky-600',
    bar: 'bg-gradient-to-b from-sky-400 to-blue-600',
    ring: 'hover:border-sky-200',
  },
  oni: {
    accent: 'text-amber-800',
    iconBg: 'bg-amber-50',
    iconFg: 'text-amber-600',
    bar: 'bg-gradient-to-b from-amber-400 to-orange-500',
    ring: 'hover:border-amber-200',
  },
  correlacao: {
    accent: 'text-[#006d8a]',
    iconBg: 'bg-[#0087a8]/10',
    iconFg: 'text-[#0087a8]',
    bar: 'bg-gradient-to-b from-[#0087a8] to-teal-700',
    ring: 'hover:border-[#0087a8]/35',
  },
};

function ehCorrelacao(titulo: string): boolean {
  const t = titulo.toLowerCase();
  return t.includes('correla') || t.includes('oni ×') || t.includes('oni x');
}

function chaveTema(titulo: string): keyof typeof TEMAS | 'default' {
  const t = titulo.toLowerCase();
  if (t.includes('temp')) return 'temp';
  if (t.includes('umidade')) return 'umidade';
  if (t.includes('chuva') || t.includes('precip')) return 'chuva';
  if (ehCorrelacao(titulo)) return 'correlacao';
  if (t.includes('medio') || t.includes('médio')) return 'casosMedios';
  if (t.includes('caso')) return 'casosRecentes';
  if (t.includes('oni') || t.includes('el nino') || t.includes('el niño'))
    return 'oni';
  return 'default';
}

function temaPorTitulo(titulo: string): TemaKpi {
  const key = chaveTema(titulo);
  return key === 'default' ? TEMA_DEFAULT : TEMAS[key];
}

function iconePorTitulo(titulo: string, idx: number): React.ReactNode {
  const t = titulo.toLowerCase();
  const cls = 'w-[1.05rem] h-[1.05rem]';
  if (t.includes('temp')) return <FaThermometerHalf className={cls} aria-hidden />;
  if (t.includes('umidade')) return <FaTint className={cls} aria-hidden />;
  if (ehCorrelacao(titulo)) return <FaChartLine className={cls} aria-hidden />;
  if (t.includes('caso')) return <FaVirus className={cls} aria-hidden />;
  if (t.includes('oni') || t.includes('el nino') || t.includes('el niño'))
    return <FaWater className={cls} aria-hidden />;
  if (t.includes('chuva') || t.includes('precip'))
    return <FaCloudRain className={cls} aria-hidden />;
  const fallback = [
    <FaThermometerHalf key="f0" className={cls} aria-hidden />,
    <FaTint key="f1" className={cls} aria-hidden />,
    <FaVirus key="f2" className={cls} aria-hidden />,
    <FaWater key="f3" className={cls} aria-hidden />,
    <FaChartLine key="f4" className={cls} aria-hidden />,
  ];
  return fallback[idx % fallback.length];
}

/** Separa número e unidade para tipografia mais limpa. */
function partirValor(valor: string): { principal: string; unidade?: string } {
  const v = valor.trim();
  const corr = v.match(/^(r\s*=\s*)(.+)$/i);
  if (corr) {
    return { principal: corr[2].trim(), unidade: 'r =' };
  }
  const comUnidade = v.match(/^(.+?)\s+(°C|%|mm|casos?)$/i);
  if (comUnidade) {
    return { principal: comUnidade[1].trim(), unidade: comUnidade[2] };
  }
  return { principal: v };
}

/** Remove lag duplicado do subtítulo quando o pill já mostra lag 0. */
function subtituloExibicao(titulo: string, subtitulo: string): string {
  if (!ehCorrelacao(titulo)) return subtitulo;
  return subtitulo
    .replace(
      /ONI\s*\(mês\s*X\)\s*[×x]\s*casos\s*\(mês\s*X(?:\s*\+\s*\d+)?\)\s*·?\s*lag\s*0\s*·?\s*/gi,
      '',
    )
    .replace(/^·\s*/, '')
    .trim();
}

const LAG_TOOLTIP =
  'Correlação Pearson: ONI (mês X) × casos (mês X), lag 0 — base histórica completa';

function KpiSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 animate-pulse">
      <div className="absolute inset-y-0 left-0 w-1 bg-slate-200" />
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="h-3 bg-slate-200 rounded w-24" />
        <div className="h-8 w-8 rounded-xl bg-slate-100" />
      </div>
      <div className="h-8 bg-slate-200 rounded w-20 mb-3" />
      <div className="h-3 bg-slate-100 rounded w-full" />
    </div>
  );
}

export const ElNinoKpiCards: React.FC<Props> = ({ kpis, loading }) => {
  if (loading) {
    return (
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-3.5"
        aria-busy="true"
        aria-label="Carregando indicadores"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-3.5"
      role="list"
      aria-label="Indicadores El Niño"
    >
      {kpis.map((kpi, idx) => {
        const correlacao = ehCorrelacao(kpi.titulo);
        const tema = temaPorTitulo(kpi.titulo);
        const { principal, unidade } = partirValor(kpi.valor);
        const sub = subtituloExibicao(kpi.titulo, kpi.subtitulo);
        const corrPrefix = correlacao && unidade === 'r =';

        return (
          <article
            key={`${kpi.titulo}-${idx}`}
            role="listitem"
            className={`group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-12px_rgba(15,23,42,0.18)] ${tema.ring} min-h-[9.25rem]`}
          >
            {correlacao && (
              <ElNinoGuiaGrafico
                chave="kpi-correlacao-oni"
                className="absolute top-2.5 right-2.5 z-30"
              />
            )}

            {/* Accent strip */}
            <span
              className={`absolute inset-y-0 left-0 w-[3px] ${tema.bar} rounded-l-2xl`}
              aria-hidden
            />

            {/* Header: label + icon (+ lag pill) */}
            <div
              className={`flex items-start justify-between gap-2 pl-1.5 ${
                correlacao ? 'pr-8' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500 leading-snug line-clamp-2">
                  {kpi.titulo}
                </p>
                {correlacao && (
                  <span
                    className="mt-1.5 inline-flex items-center rounded-md border border-[#0087a8]/20 bg-[#0087a8]/[0.08] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#006d8a]"
                    title={LAG_TOOLTIP}
                  >
                    lag 0 · mesmo mês
                  </span>
                )}
              </div>
              {!correlacao && (
                <div
                  className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-xl ${tema.iconBg} ${tema.iconFg} ring-1 ring-inset ring-black/[0.03] transition-transform duration-200 group-hover:scale-105`}
                >
                  {iconePorTitulo(kpi.titulo, idx)}
                </div>
              )}
            </div>

            {/* Value */}
            <div className="mt-3 pl-1.5 flex items-baseline gap-1.5 flex-wrap">
              {corrPrefix && (
                <span className="text-sm font-semibold text-slate-400 tabular-nums">
                  r =
                </span>
              )}
              <span className="text-[1.65rem] font-bold tracking-tight text-slate-900 tabular-nums leading-none">
                {principal}
              </span>
              {unidade && unidade !== 'r =' && (
                <span className={`text-sm font-semibold ${tema.accent}`}>
                  {unidade}
                </span>
              )}
            </div>

            {/* Meta */}
            {sub ? (
              <p
                className="mt-auto pt-3 pl-1.5 text-[11px] leading-snug text-slate-500 line-clamp-2"
                title={kpi.subtitulo}
              >
                {sub}
              </p>
            ) : (
              <div className="mt-auto" />
            )}
          </article>
        );
      })}
    </div>
  );
};

export default ElNinoKpiCards;
