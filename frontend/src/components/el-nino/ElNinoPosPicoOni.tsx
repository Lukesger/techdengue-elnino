import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { OniMensal, SerieMensal } from '@/services/el-nino-api';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';
import {
  filtrarSerieMesAno,
  mesclarOniNaSerie,
  periodoFiltro,
  rotuloEscopoGrafico,
} from '@/utils/el-nino/graficos-filtros';
import { analisarCrescimentoPosPicoOni } from '@/utils/el-nino/pos-pico-oni';

interface Props {
  serie: SerieMensal[] | null | undefined;
  oniMensal?: OniMensal[] | null;
  anoInicio?: number;
  anoFim?: number;
  mesFim?: number;
  nMunicipios?: number;
  nomeMunicipio?: string;
  loading?: boolean;
}

const TooltipCustom = ({ active, payload, modoAbsoluto }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl">
      <p className="font-semibold mb-1">Pico ONI {p.rotulo}</p>
      <p>ONI: {p.oniPico?.toFixed(2)} °C</p>
      <p>Casos no pico: {p.casosPico?.toLocaleString('pt-BR')}</p>
      {p.pctM1 != null && (
        <p className="text-sky-300">
          +1 mês ({p.rotuloM1}):{' '}
          {modoAbsoluto ? `${p.pctM1} casos` : `${p.pctM1 > 0 ? '+' : ''}${p.pctM1}%`}
        </p>
      )}
      {p.pctM2 != null && (
        <p className="text-orange-300">
          +2 meses ({p.rotuloM2}):{' '}
          {modoAbsoluto ? `${p.pctM2} casos` : `${p.pctM2 > 0 ? '+' : ''}${p.pctM2}%`}
        </p>
      )}
    </div>
  );
};

/**
 * Crescimento de casos após pico do ONI (equivalente a `chartPosPicoOni`).
 */
export const ElNinoPosPicoOni: React.FC<Props> = ({
  serie,
  oniMensal,
  anoInicio,
  anoFim,
  mesFim = 12,
  nMunicipios = 0,
  nomeMunicipio,
  loading,
}) => {
  const analise = useMemo(() => {
    if (!serie?.length || !oniMensal?.length || anoInicio == null || anoFim == null) {
      return { eventos: [], mediaPctM1: null, mediaPctM2: null, modoAbsoluto: false, chartData: [] };
    }

    const { anoIni, mesIni, anoFim: af, mesFim: mf } = periodoFiltro(anoInicio, anoFim, mesFim);
    const fatia = mesclarOniNaSerie(
      filtrarSerieMesAno(serie, anoIni, mesIni, af, mf),
      oniMensal,
    );

    const result = analisarCrescimentoPosPicoOni(oniMensal, fatia, anoIni, af);
    const chartData = result.eventos.map((e) => ({
      ...e,
      pctM1Bar: e.pctM1,
      pctM2Bar: e.pctM2,
    }));

    return { ...result, chartData };
  }, [serie, oniMensal, anoInicio, anoFim, mesFim]);

  const escopoRotulo = rotuloEscopoGrafico(nomeMunicipio, nMunicipios);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-2/3 mb-4" />
        <div className="h-72 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!analise.chartData.length) {
    return (
      <article className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-400">
        Nenhum episódio El Niño com casos no mês do pico ou nos 2 meses seguintes.
      </article>
    );
  }

  const { modoAbsoluto } = analise;
  const ai = anoInicio ?? 0;
  const af = anoFim ?? 0;

  return (
    <article className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="pos-pico-oni" />
      <header className="mb-3 pr-8">
        <h3 className="text-sm font-semibold text-gray-800">
          Crescimento de casos após pico do ONI
        </h3>
        <p className="text-xs text-gray-400">
          {modoAbsoluto
            ? `Casos nos meses após pico ONI (sem casos no mês exato do pico)`
            : '% vs mês do pico ONI (máximo do episódio — não o início)'}
          {escopoRotulo ? ` · ${escopoRotulo}` : ''}
          {ai && af ? ` · ${ai}–${af}` : ''}
        </p>
      </header>

      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={analise.chartData} margin={{ top: 8, right: 12, left: 8, bottom: 8 }} barGap={4}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickFormatter={(v) =>
              modoAbsoluto ? Number(v).toLocaleString('pt-BR') : `${v}%`
            }
            label={{
              value: modoAbsoluto ? 'Casos após pico' : 'Variação de casos (%)',
              angle: -90,
              position: 'insideLeft',
              fontSize: 10,
              fill: '#9ca3af',
            }}
          />
          <Tooltip content={<TooltipCustom modoAbsoluto={modoAbsoluto} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
          <Bar
            dataKey="pctM1Bar"
            name={modoAbsoluto ? '+1 mês após pico (casos)' : '+1 mês após pico'}
            fill="#3b82f6"
            radius={[3, 3, 0, 0]}
          />
          <Bar
            dataKey="pctM2Bar"
            name={modoAbsoluto ? '+2 meses após pico (casos)' : '+2 meses após pico'}
            fill="#f97316"
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </article>
  );
};

export default ElNinoPosPicoOni;
