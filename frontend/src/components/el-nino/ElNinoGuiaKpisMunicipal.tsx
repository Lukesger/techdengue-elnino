import React from 'react';
import {
  FaMapMarkerAlt,
  FaChartBar,
  FaCalendarAlt,
  FaExclamationTriangle,
} from 'react-icons/fa';
import { SerieConsorcioResponse } from '@/services/el-nino-api';

interface MunicipioInfo {
  geocode: number;
  nome: string;
  populacao: number;
}

interface Props {
  municipio: MunicipioInfo | null;
  serie: SerieConsorcioResponse | null;
  /** Nível de alerta Infodengue (1-4) do município, se disponível. */
  nivelAlerta?: number | null;
}

const NIVEIS_INFODENGUE: Record<
  number,
  { label: string; bg: string; text: string }
> = {
  1: { label: 'Verde', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  2: { label: 'Amarelo', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  3: { label: 'Laranja', bg: 'bg-orange-100', text: 'text-orange-700' },
  4: { label: 'Vermelho', bg: 'bg-red-100', text: 'text-red-700' },
};

/**
 * 4 KPIs municipais na página /guia — equivalente ao `.kpis` do
 * `Visu_unico.html`: Município, Média mensal observada, SE, Nível de alerta.
 */
export const ElNinoGuiaKpisMunicipal: React.FC<Props> = ({
  municipio,
  serie,
  nivelAlerta,
}) => {
  const nivelCfg = nivelAlerta ? NIVEIS_INFODENGUE[nivelAlerta] : null;
  const mediaMensal = serie?.media_historica ?? 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Card
        label="Município"
        icon={<FaMapMarkerAlt className="w-3.5 h-3.5" />}
        valor={municipio?.nome ?? '—'}
        sub={
          municipio
            ? `Pop. ${municipio.populacao.toLocaleString('pt-BR')} hab.`
            : 'Selecione no filtro'
        }
        accent="text-[#0087a8]"
      />
      <Card
        label="Média mensal observada"
        icon={<FaChartBar className="w-3.5 h-3.5" />}
        valor={mediaMensal.toLocaleString('pt-BR')}
        sub={
          serie?.anos_janela
            ? `casos/mês · últimos ${serie.anos_janela.toFixed(1)} ano(s)`
            : 'casos/mês'
        }
        accent="text-rose-600"
      />
      <Card
        label="Semana epidemiológica"
        icon={<FaCalendarAlt className="w-3.5 h-3.5" />}
        valor={serie?.semana_epi ? `SE ${serie.semana_epi}` : '—'}
        sub="Infodengue · referência atual"
        accent="text-sky-600"
      />
      <Card
        label="Nível de alerta"
        icon={<FaExclamationTriangle className="w-3.5 h-3.5" />}
        valor={
          nivelCfg ? (
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${nivelCfg.bg} ${nivelCfg.text}`}
            >
              {nivelCfg.label}
            </span>
          ) : (
            '—'
          )
        }
        sub={nivelAlerta ? `Nível ${nivelAlerta}/4` : 'Sem dado recente'}
        accent="text-orange-600"
      />
    </div>
  );
};

const Card: React.FC<{
  label: string;
  icon: React.ReactNode;
  valor: React.ReactNode;
  sub: string;
  accent: string;
}> = ({ label, icon, valor, sub, accent }) => (
  <div className="bg-white rounded-xl border border-gray-100 p-3.5">
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-medium text-gray-500 mb-1">
      <span className={accent}>{icon}</span>
      {label}
    </div>
    <div className="text-base font-bold text-gray-800 truncate">{valor}</div>
    <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>
  </div>
);

export default ElNinoGuiaKpisMunicipal;
