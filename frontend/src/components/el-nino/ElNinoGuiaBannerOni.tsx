import React from 'react';
import { SerieConsorcioResponse } from '@/services/el-nino-api';
import { FaWind } from 'react-icons/fa6';

interface Props {
  serie: SerieConsorcioResponse | null;
}

/**
 * Banner ONI no topo da página /guia — equivalente ao `.oni-banner` do
 * `Visu_unico.html`. Mostra o cenário ONI atual + 3 KPIs inline
 * (ONI, fator multiplicador, percentual de incerteza máximo).
 */
export const ElNinoGuiaBannerOni: React.FC<Props> = ({ serie }) => {
  if (!serie?.elnino) return null;
  const e = serie.elnino;
  const periodo = serie.semana_epi
    ? `SE ${serie.semana_epi}`
    : `${serie.mes_fim}/${serie.ano_fim}`;

  const fatorPct = Math.round((e.fator_atual - 1) * 100);
  const incertezaMaxPct = 35; // +35% — banda superior PROJ_BANDA_SUP

  const ativo = e.ativo;
  const palette = ativo
    ? {
        bg: 'bg-gradient-to-br from-orange-50 to-amber-50',
        border: 'border-orange-200',
        text: 'text-orange-900',
        accent: 'text-orange-700',
      }
    : {
        bg: 'bg-gradient-to-br from-sky-50 to-blue-50',
        border: 'border-sky-200',
        text: 'text-sky-900',
        accent: 'text-sky-700',
      };

  return (
    <section
      className={`rounded-xl border p-5 ${palette.bg} ${palette.border}`}
    >
      <div className="flex items-start gap-3 mb-3">
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-white shadow-sm ${palette.text}`}
        >
          <FaWind className="w-3 h-3" />
          {ativo ? `El Niño · ${e.intensidade}` : 'Cenário neutro'}
          <span className="opacity-60 ml-1">· {periodo}</span>
        </span>
      </div>

      <p className={`text-sm leading-relaxed mb-4 ${palette.text}`}>
        {ativo ? (
          <>
            Desde {periodo} o Pacífico central tropical apresenta anomalia
            quente sustentada. ONI atual em{' '}
            <strong>
              {e.oni_atual != null
                ? `${e.oni_atual >= 0 ? '+' : ''}${e.oni_atual.toFixed(2)} °C`
                : '—'}
            </strong>{' '}
            (NOAA CPC) corresponde a um cenário <strong>{e.intensidade}</strong>{' '}
            — historicamente associado a invernos mais quentes e chuvas
            irregulares no Sudeste, e a surtos epidêmicos de arboviroses no
            verão subsequente.
          </>
        ) : (
          <>
            O Pacífico central tropical está em <strong>fase neutra</strong>{' '}
            (ONI {e.oni_atual != null ? e.oni_atual.toFixed(2) : '—'} °C).
            Projeção epidemiológica segue a sazonalidade média do consórcio,
            sem multiplicador adicional de El Niño.
          </>
        )}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi
          label="ONI mensal"
          valor={
            e.oni_atual != null
              ? `${e.oni_atual >= 0 ? '+' : ''}${e.oni_atual.toFixed(2)} °C`
              : '—'
          }
          sub="NOAA CPC · Niño 3.4"
          accent={palette.accent}
        />
        <Kpi
          label="Fator de projeção"
          valor={`×${e.fator_atual.toFixed(2)}`}
          sub={
            fatorPct === 0
              ? 'sem ajuste sobre baseline'
              : `${fatorPct > 0 ? '+' : ''}${fatorPct}% sobre baseline`
          }
          accent={palette.accent}
        />
        <Kpi
          label="Incerteza superior"
          valor={`+${incertezaMaxPct}%`}
          sub="banda superior da projeção"
          accent={palette.accent}
        />
      </div>
    </section>
  );
};

const Kpi: React.FC<{
  label: string;
  valor: string;
  sub: string;
  accent: string;
}> = ({ label, valor, sub, accent }) => (
  <div className="bg-white/80 backdrop-blur-sm rounded-lg p-3 border border-white">
    <p className="text-[10px] uppercase tracking-wide font-medium text-gray-500">
      {label}
    </p>
    <p className={`text-xl font-bold mt-0.5 ${accent}`}>{valor}</p>
    <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>
  </div>
);

export default ElNinoGuiaBannerOni;
