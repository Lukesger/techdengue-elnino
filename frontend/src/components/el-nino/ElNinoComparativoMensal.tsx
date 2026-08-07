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
  ReferenceLine,
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
      <p className="text-amber-300">
        ONI:{' '}
        {p.oni != null
          ? `${p.oni >= 0 ? '+' : ''}${Number(p.oni).toFixed(2)}`
          : '—'}
      </p>
      <p className="text-gray-400 mt-1">{p.regime}</p>
    </div>
  );
};

function LegendaComparativo() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1 text-[11px] text-gray-600">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm bg-blue-500" />
        Casos · sem El Niño
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm bg-orange-500" />
        Casos · com El Niño (ONI ≥ +0,5)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-0.5 bg-green-500 relative">
          <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-green-500" />
        </span>
        ONI NOAA
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block w-5 border-t border-dashed border-slate-300"
          aria-hidden
        />
        Marco ONI +0,5 (marca d&apos;água)
      </span>
    </div>
  );
}

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
      return {
        pontos: [],
        ticksAnuais: [],
        rotuloParaAno: new Map(),
        dominios: { casos: [0, 100], oni: [-1.5, 2.5] },
      };
    }

    const { anoIni, mesIni, anoFim: af, mesFim: mf } = periodoFiltro(
      anoInicio,
      anoFim,
      mesFim,
    );
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
      ticksAnuais: ticks.length
        ? ticks
        : pts
            .filter((p, i) => i === 0 || p.ano !== pts[i - 1].ano)
            .map((p) => p.rotulo),
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
      faixas.push({
        x1: pontos[inicio].rotulo,
        x2: pontos[pontos.length - 1].rotulo,
      });
    }
    return faixas;
  }, [pontos]);

  const subtituloPeriodo =
    anoInicio != null && anoFim != null
      ? rotuloIntervaloMesAno(
          anoInicio,
          1,
          anoFim,
          periodoFiltro(anoInicio, anoFim, mesFim).mesFim,
        )
      : '';

  const escopoRotulo = rotuloEscopoGrafico(nomeMunicipio, nMunicipios);
  const nOniOk = pontos.filter((p) => p.oni != null).length;
  const maxCasos = pontos.length ? Math.max(...pontos.map((p) => p.casos)) : 0;
  const casosAntes2023 = pontos
    .filter((p) => p.ano < 2023)
    .reduce((s, p) => s + p.casos, 0);

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
          {nOniOk > 0 ? ` · ONI em ${nOniOk}/${pontos.length} meses` : ''}
        </p>
      </header>

      <ResponsiveContainer width="100%" height={500}>
        <ComposedChart
          data={pontos}
          margin={{ top: 8, right: 48, left: 8, bottom: 8 }}
        >
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
          {/* Marco horizontal: limiar ONI +0,5 (marca d'água) */}
          <ReferenceLine
            yAxisId="oni"
            y={LIMIAR_ONI}
            stroke="#94a3b8"
            strokeWidth={1}
            strokeDasharray="4 6"
            strokeOpacity={0.35}
            ifOverflow="extendDomain"
            label={{
              value: 'ONI +0,5',
              position: 'insideTopRight',
              fill: '#94a3b8',
              fontSize: 9,
              opacity: 0.55,
            }}
          />
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
            label={{
              value: 'Casos mensais',
              angle: -90,
              position: 'insideLeft',
              fontSize: 10,
              fill: '#64748b',
            }}
          />
          <YAxis
            yAxisId="oni"
            orientation="right"
            domain={dominios.oni}
            tick={{ fontSize: 10, fill: '#16a34a' }}
            label={{
              value: 'ONI NOAA',
              angle: 90,
              position: 'insideRight',
              fontSize: 10,
              fill: '#16a34a',
            }}
          />
          <Tooltip content={<TooltipCustom />} />
          <Legend content={<LegendaComparativo />} />
          <Bar
            yAxisId="casos"
            dataKey="casos"
            name="Casos mensais"
            radius={[2, 2, 0, 0]}
            legendType="none"
          >
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
            dot={{ r: 2.5, fill: '#22c55e' }}
            name="ONI NOAA"
            connectNulls
            legendType="none"
          />
        </ComposedChart>
      </ResponsiveContainer>

      {maxCasos > 50_000 && casosAntes2023 > 0 && (
          <p className="text-[10px] text-amber-700/90 mt-2 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
            Em 2020–2022 o consolidado Infodengue cobre só parte dos meses
            (jan/mar/jun/jul/nov) e o volume é muito menor que o pico de 2024 —
            use o tooltip para ler os valores. A linha verde (ONI NOAA) cobre
            toda a janela.
          </p>
        )}
    </article>
  );
};

export default ElNinoComparativoMensal;
