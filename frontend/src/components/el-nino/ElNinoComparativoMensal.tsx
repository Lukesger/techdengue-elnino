import React, { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  ReferenceArea,
} from 'recharts';
import { OniMensal, SerieMensal } from '@/services/el-nino-api';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';
import {
  filtrarSerieMesAno,
  mesclarOniNaSerie,
  periodoFiltro,
  rotuloEscopoGrafico,
  rotuloIntervaloMesAno,
  rotuloJanelaAnos,
} from '@/utils/el-nino/graficos-filtros';

interface Props {
  serie: SerieMensal[] | null | undefined;
  oniMensal?: OniMensal[] | null;
  anoInicio?: number;
  anoFim?: number;
  mesFim?: number;
  nMunicipios?: number;
  nomeMunicipio?: string | null;
  loading?: boolean;
}

const LIMIAR_ONI = 0.5;

function corFaixaOni(oni: number | null): string | null {
  if (oni == null) return null;
  if (oni >= 2.0) return 'rgba(248,113,113,0.18)';
  if (oni >= 1.5) return 'rgba(251,146,60,0.16)';
  if (oni >= 0.5) return 'rgba(251,146,60,0.09)';
  return null;
}

const TooltipCustom = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl">
      <p className="font-semibold mb-1">{p.rotulo}</p>
      <p className="text-red-300">Casos: {p.casos?.toLocaleString('pt-BR')}</p>
      <p className="text-amber-300">ONI: {p.oni != null ? `${p.oni >= 0 ? '+' : ''}${p.oni.toFixed(2)} °C` : '—'}</p>
      <p className="text-gray-400 mt-1">{p.regime}</p>
    </div>
  );
};

/**
 * Comparativo mensal — barras de casos + linha ONI NOAA (chartHistoricoV2).
 */
export const ElNinoComparativoMensal: React.FC<Props> = ({
  serie,
  oniMensal,
  anoInicio,
  anoFim,
  mesFim = 12,
  nMunicipios = 0,
  nomeMunicipio,
  loading,
}) => {
  const { pontos, ticksAnuais, rotuloParaAno, dominios } = useMemo(() => {
    if (!serie?.length || anoInicio == null || anoFim == null) {
      return { pontos: [], ticksAnuais: [], rotuloParaAno: new Map(), dominios: { casos: [0, 100], oni: [-1.5, 2.5] } };
    }

    const { anoIni, mesIni, anoFim: af, mesFim: mf } = periodoFiltro(anoInicio, anoFim, mesFim);
    const fatia = mesclarOniNaSerie(
      filtrarSerieMesAno(serie, anoIni, mesIni, af, mf),
      oniMensal ?? [],
    );

    const pts = fatia.map((r) => ({
      rotulo: `${r.Mes}/${r.Ano}`,
      ano: r.Ano,
      mesNum: r.MesNum,
      casos: r.CasosDengue,
      oni: r.ONI,
      regime: (r.ONI ?? 0) >= LIMIAR_ONI ? 'Com El Niño' : 'Sem El Niño',
      elNino: (r.ONI ?? 0) >= LIMIAR_ONI,
    }));

    const vistos = new Set<number>();
    const ticks = pts
      .filter((p) => {
        if (vistos.has(p.ano)) return false;
        vistos.add(p.ano);
        return true;
      })
      .map((p) => p.rotulo);

    const mapaAno = new Map(pts.map((p) => [p.rotulo, p.ano]));
    const oniVals = pts.map((p) => p.oni).filter((v): v is number => v != null);
    const maxCasos = pts.length ? Math.max(...pts.map((p) => p.casos)) : 100;

    return {
      pontos: pts,
      ticksAnuais: ticks.length ? ticks : pts.filter((p, i) => i === 0 || p.ano !== pts[i - 1].ano).map((p) => p.rotulo),
      rotuloParaAno: mapaAno,
      dominios: {
        casos: [0, Math.ceil(maxCasos * 1.1)] as [number, number],
        oni: [
          oniVals.length ? Math.floor(Math.min(...oniVals, -0.5) * 2) / 2 : -1.5,
          oniVals.length ? Math.ceil(Math.max(...oniVals, 1.5) * 2) / 2 : 2.5,
        ] as [number, number],
      },
    };
  }, [serie, oniMensal, anoInicio, anoFim, mesFim]);

  const faixasElNino = useMemo(() => {
    const faixas: Array<{ x1: string; x2: string }> = [];
    let inicio: number | null = null;
    for (let i = 0; i < pontos.length; i++) {
      const ativo = corFaixaOni(pontos[i].oni) != null;
      if (ativo && inicio === null) inicio = i;
      if (!ativo && inicio !== null) {
        faixas.push({ x1: pontos[inicio].rotulo, x2: pontos[i - 1].rotulo });
        inicio = null;
      }
    }
    if (inicio !== null) {
      faixas.push({ x1: pontos[inicio].rotulo, x2: pontos[pontos.length - 1].rotulo });
    }
    return faixas;
  }, [pontos]);

  const subtituloPeriodo =
    anoInicio != null && anoFim != null
      ? rotuloIntervaloMesAno(anoInicio, 1, anoFim, periodoFiltro(anoInicio, anoFim, mesFim).mesFim)
      : '';

  const escopoRotulo = rotuloEscopoGrafico(nomeMunicipio, nMunicipios);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse h-[440px]">
        <div className="h-5 bg-gray-200 rounded w-2/3 mb-4" />
        <div className="h-80 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!pontos.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-400">
        Sem dados para comparativo mensal.
      </div>
    );
  }

  const ai = anoInicio ?? pontos[0].ano;
  const af = anoFim ?? pontos[pontos.length - 1].ano;

  return (
    <article className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="historico" />
      <header className="mb-3 pr-8">
        <h3 className="text-sm font-semibold text-gray-800">
          Comparativo mensal — {rotuloJanelaAnos(ai, af)}
        </h3>
        <p className="text-xs text-gray-400">
          {subtituloPeriodo}
          {escopoRotulo ? ` · ${escopoRotulo}` : ''}
        </p>
      </header>

      <ResponsiveContainer width="100%" height={480}>
        <ComposedChart data={pontos} margin={{ top: 8, right: 48, left: 8, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          {faixasElNino.map((f, i) => (
            <ReferenceArea
              key={i}
              x1={f.x1}
              x2={f.x2}
              yAxisId="casos"
              fill="rgba(251,146,60,0.1)"
              stroke="none"
            />
          ))}
          <XAxis
            dataKey="rotulo"
            ticks={ticksAnuais}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickFormatter={(v) => String(rotuloParaAno.get(v) ?? '')}
          />
          <YAxis
            yAxisId="casos"
            tick={{ fontSize: 10, fill: '#64748b' }}
            domain={dominios.casos}
            tickFormatter={(v) => Number(v).toLocaleString('pt-BR')}
            label={{ value: 'Casos mensais', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#64748b' }}
          />
          <YAxis
            yAxisId="oni"
            orientation="right"
            domain={dominios.oni}
            tick={{ fontSize: 10, fill: '#16a34a' }}
            label={{ value: 'ONI NOAA', angle: 90, position: 'insideRight', fontSize: 10, fill: '#16a34a' }}
          />
          <Tooltip content={<TooltipCustom />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="casos" dataKey="casos" name="Casos mensais" radius={[2, 2, 0, 0]}>
            {pontos.map((p, i) => (
              <Cell key={i} fill={p.elNino ? '#f97316' : '#3b82f6'} />
            ))}
          </Bar>
          <Line
            yAxisId="oni"
            type="monotone"
            dataKey="oni"
            stroke="#22c55e"
            strokeWidth={2}
            dot={{ r: 3, fill: '#22c55e' }}
            name="ONI NOAA"
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-blue-500" /> Sem El Niño
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-orange-500" /> Com El Niño
        </span>
      </div>
    </article>
  );
};

export default ElNinoComparativoMensal;
