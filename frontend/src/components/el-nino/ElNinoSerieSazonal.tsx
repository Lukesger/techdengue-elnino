import React, { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { SerieMensal } from '@/services/el-nino-api';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';
import {
  mediaSazonalSerie,
  rotuloEscopoGrafico,
} from '@/utils/el-nino/graficos-filtros';
import { MESES } from '@/utils/el-nino/constants';

interface Props {
  mensalMun?: Array<Record<string, unknown>> | null;
  serieFallback?: SerieMensal[] | null;
  anoInicio?: number;
  anoFim?: number;
  nMunicipios?: number;
  nomeMunicipio?: string | null;
  loading?: boolean;
}

const TooltipCustom = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map(
        (p: any, i: number) =>
          p.value != null && (
            <p key={i} style={{ color: p.color }}>
              {p.name}:{' '}
              {typeof p.value === 'number'
                ? p.name === 'ONI oceano'
                  ? `${p.value >= 0 ? '+' : ''}${p.value.toFixed(2)} °C`
                  : p.name === 'Temp. ERA5'
                    ? `${p.value.toFixed(1)} °C`
                    : p.value.toLocaleString('pt-BR')
                : p.value}
            </p>
          ),
      )}
    </div>
  );
};

/**
 * Série temporal sazonal — média Jan–Dez (equivalente a `chartSerie` do Dash).
 */
export const ElNinoSerieSazonal: React.FC<Props> = ({
  mensalMun,
  serieFallback,
  anoInicio,
  anoFim,
  nMunicipios = 0,
  nomeMunicipio,
  loading,
}) => {
  const { pontos, dominios } = useMemo(() => {
    const rows = mensalMun?.length ? mensalMun : [];
    let serie: SerieMensal[] = [];

    if (rows.length && anoInicio != null && anoFim != null) {
      const filtrado = rows.filter((r) => {
        const a = Number(r.Ano);
        return a >= anoInicio && a <= anoFim;
      });
      if (filtrado.length) {
        serie = mediaSazonalSerie(filtrado);
      }
    }

    if (!serie.length && serieFallback?.length) {
      const fatia =
        anoInicio != null && anoFim != null
          ? serieFallback.filter(
              (r) => Number(r.Ano) >= anoInicio && Number(r.Ano) <= anoFim,
            )
          : serieFallback;
      if (fatia.length) {
        serie = mediaSazonalSerie(fatia as unknown as Record<string, unknown>[]);
      }
    }

    if (!serie.length) {
      return {
        pontos: [],
        dominios: { casos: [0, 100] as [number, number], temp: [14, 26] as [number, number], oni: [-0.1, 0.1] as [number, number] },
      };
    }

    const pontos = serie.map((r) => {
      const tempRaw = r.Temperatura > 0 ? r.Temperatura : null;
      return {
        mes: r.Mes,
        casos: r.CasosDengue,
        temp: tempRaw,
        oni: r.ONI,
      };
    });

    // Fallback: média sazonal da série agregada (df_serie) quando mensal não tem ERA5.
    if (serieFallback?.length && pontos.every((p) => p.temp == null)) {
      const sazonalFb = mediaSazonalSerie(
        serieFallback as unknown as Record<string, unknown>[],
      );
      const tempPorMes = new Map(
        sazonalFb
          .filter((r) => r.Temperatura > 0)
          .map((r) => [r.MesNum, r.Temperatura]),
      );
      for (const p of pontos) {
        const mesNum = MESES.indexOf(p.mes) + 1;
        const t = tempPorMes.get(mesNum);
        if (t != null && t > 0) p.temp = t;
      }
    }

    const casosVals = pontos.map((p) => p.casos);
    const tempVals = pontos
      .map((p) => p.temp)
      .filter((t): t is number => t != null && Number.isFinite(t) && t > 0);
    const oniVals = pontos.map((p) => p.oni).filter((v): v is number => v != null);

    const tempMin = tempVals.length ? Math.min(...tempVals) : 14;
    const tempMax = tempVals.length ? Math.max(...tempVals) : 26;

    return {
      pontos,
      dominios: {
        casos: [0, Math.ceil(Math.max(...casosVals, 10) * 1.1)] as [number, number],
        temp: tempVals.length
          ? ([Math.floor(tempMin - 1), Math.ceil(tempMax + 1)] as [number, number])
          : ([14, 26] as [number, number]),
        oni: oniVals.length
          ? [Math.floor(Math.min(...oniVals) * 20) / 20, Math.ceil(Math.max(...oniVals) * 20) / 20]
          : ([-0.05, 0.1] as [number, number]),
      },
    };
  }, [mensalMun, serieFallback, anoInicio, anoFim]);

  const rotuloSazonal =
    anoInicio != null && anoFim != null
      ? anoInicio === anoFim
        ? `média sazonal ${anoInicio}`
        : `média sazonal ${anoInicio}–${anoFim}`
      : 'média sazonal';

  const escopoRotulo = rotuloEscopoGrafico(nomeMunicipio, nMunicipios);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-80 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!pontos.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-400">
        Sem dados de série temporal sazonal.
      </div>
    );
  }

  return (
    <article className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="serie" />
      <header className="mb-3 pr-8">
        <h3 className="text-sm font-semibold text-gray-800">Série temporal</h3>
        <p className="text-xs text-gray-400">
          {escopoRotulo ? `${escopoRotulo} · ` : ''}
          {rotuloSazonal} · temp. Copernicus ERA5
        </p>
      </header>

      <ResponsiveContainer width="100%" height={480}>
        <ComposedChart data={pontos} margin={{ top: 8, right: 72, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <YAxis
            yAxisId="casos"
            tick={{ fontSize: 10, fill: '#f97316' }}
            domain={dominios.casos}
            tickFormatter={(v) => Number(v).toLocaleString('pt-BR')}
            label={{ value: 'Casos', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#f97316' }}
          />
          <YAxis
            yAxisId="temp"
            orientation="right"
            domain={dominios.temp}
            tick={{ fontSize: 10, fill: '#38bdf8' }}
            axisLine={false}
            tickLine={false}
            width={32}
            label={{ value: '°C', angle: 90, position: 'insideRight', offset: 12, fontSize: 10, fill: '#38bdf8' }}
          />
          <YAxis
            yAxisId="oni"
            orientation="right"
            domain={dominios.oni}
            tick={{ fontSize: 10, fill: '#eab308' }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={(v) => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}`}
            label={{ value: 'ONI', angle: 90, position: 'insideRight', offset: -4, fontSize: 10, fill: '#eab308' }}
          />
          <Tooltip content={<TooltipCustom />} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Line
            yAxisId="casos"
            type="monotone"
            dataKey="casos"
            stroke="#f97316"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#f97316' }}
            name="Casos dengue"
            connectNulls
          />
          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="temp"
            stroke="#38bdf8"
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={false}
            name="Temp. ERA5"
            connectNulls
          />
          <Line
            yAxisId="oni"
            type="monotone"
            dataKey="oni"
            stroke="#eab308"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={{ r: 3, fill: '#eab308' }}
            name="ONI oceano"
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </article>
  );
};

export default ElNinoSerieSazonal;
