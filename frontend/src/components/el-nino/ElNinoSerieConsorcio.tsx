import React, { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { SerieConsorcioResponse } from '@/services/el-nino-api';
import { formatarSemanaEpi, LABEL_PICO_EL_NINO_FALLBACK, MESES } from '@/utils/el-nino/constants';
import { indiceUltimoPicoElNino } from '@/utils/el-nino/pos-pico-oni';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';

interface Props {
  data: SerieConsorcioResponse | null;
  loading?: boolean;
}

type IntensidadeElNino = 'fraco' | 'moderado' | 'forte' | 'muito_forte';

interface PontoGrafico {
  idx: number;
  label: string;
  casosObs: number | null;
  casosProj: number | null;
  /** Limite inferior da faixa de incerteza (projeção). */
  casosInf: number | null;
  /** Amplitude (sup − inf) para Area empilhada. */
  casosFaixa: number | null;
  tempObs: number | null;
  tempProj: number | null;
  oniObs: number | null;
  oniProj: number | null;
  projetado: boolean;
  oniProjetado: boolean;
}

/** Classificação NOAA CPC por magnitude do ONI mensal */
function classificarIntensidadeElNino(oni: number | null): IntensidadeElNino | null {
  if (oni == null || oni < 0.5) return null;
  if (oni >= 2.0) return 'muito_forte';
  if (oni >= 1.5) return 'forte';
  if (oni >= 1.0) return 'moderado';
  return 'fraco';
}

const ESTILO_FAIXA: Record<
  IntensidadeElNino,
  { fill: string; fillOpacity: number; fillOpacityProj: number }
> = {
  fraco: { fill: '#ffedd5', fillOpacity: 0.45, fillOpacityProj: 0.28 },
  moderado: { fill: '#fed7aa', fillOpacity: 0.4, fillOpacityProj: 0.26 },
  forte: { fill: '#fecaca', fillOpacity: 0.42, fillOpacityProj: 0.3 },
  muito_forte: { fill: '#fca5a5', fillOpacity: 0.48, fillOpacityProj: 0.34 },
};

const ROTULO_INTENSIDADE: Record<IntensidadeElNino, string> = {
  fraco: 'El Niño fraco',
  moderado: 'El Niño moderado',
  forte: 'El Niño forte',
  muito_forte: 'El Niño muito forte',
};

function temperaturaGrafico(v: number | null | undefined): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const ponto = payload[0]?.payload as PontoGrafico | undefined;
  if (!ponto) return null;

  // No mês de transição, obs e proj têm o mesmo valor (continuidade da linha).
  // Tooltip mostra só o lado relevante: consolidado OU projeção.
  const ehProjecao = Boolean(ponto.projetado);
  const keysPermitidos = ehProjecao
    ? new Set(['casosProj', 'tempProj', 'oniProj'])
    : new Set(['casosObs', 'tempObs', 'oniObs']);

  const linhas = payload.filter(
    (p: any) =>
      p.value != null &&
      keysPermitidos.has(p.dataKey) &&
      Number.isFinite(Number(p.value)),
  );

  const vistos = new Set<string>();
  const oniVal = ehProjecao ? ponto.oniProj : ponto.oniObs;
  const intensidade = classificarIntensidadeElNino(oniVal ?? null);
  const oniJaNaLista = linhas.some((p: any) => p.dataKey === 'oniObs' || p.dataKey === 'oniProj');

  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl max-w-xs">
      <p className="font-semibold mb-1">{label}</p>
      {linhas.map((p: any, i: number) => {
        if (vistos.has(p.dataKey)) return null;
        vistos.add(p.dataKey);
        const isCasos = p.dataKey === 'casosObs' || p.dataKey === 'casosProj';
        const isTemp = p.dataKey === 'tempObs' || p.dataKey === 'tempProj';
        const isOni = p.dataKey === 'oniObs' || p.dataKey === 'oniProj';
        const rotulo = isCasos
          ? ehProjecao
            ? 'Casos (projeção)'
            : 'Casos média/mun'
          : isTemp
            ? ehProjecao
              ? 'Temp. (projeção)'
              : 'Temp. média'
            : isOni
              ? ehProjecao
                ? 'ONI NOAA (proj.)'
                : 'ONI NOAA'
              : p.name;
        return (
          <p key={i} style={{ color: p.color }}>
            {rotulo}:{' '}
            {typeof p.value === 'number'
              ? isOni
                ? p.value.toFixed(2)
                : p.value.toFixed(1)
              : p.value}
            {isCasos ? ' casos/mun' : ''}
            {isTemp ? ' °C' : ''}
            {!ehProjecao && isCasos ? ' (consolid.)' : ''}
          </p>
        );
      })}
      {intensidade && !oniJaNaLista && (
        <p className="text-orange-300 mt-1">
          ONI NOAA: {(oniVal ?? 0).toFixed(2)}
          {' · '}
          {ROTULO_INTENSIDADE[intensidade]}
          {ehProjecao || ponto.oniProjetado ? ' (proj.)' : ''}
        </p>
      )}
      {intensidade && oniJaNaLista && (
        <p className="text-orange-300 mt-1">
          {ROTULO_INTENSIDADE[intensidade]}
          {ehProjecao || ponto.oniProjetado ? ' (proj.)' : ''}
        </p>
      )}
      {ehProjecao &&
        ponto.casosInf != null &&
        ponto.casosFaixa != null && (
          <p className="text-rose-200/80 mt-1">
            Faixa: {ponto.casosInf.toFixed(1)} –{' '}
            {(ponto.casosInf + ponto.casosFaixa).toFixed(1)} casos/mun
          </p>
        )}
    </div>
  );
};

export const ElNinoSerieConsorcio: React.FC<Props> = ({ data, loading }) => {
  const { visiveis, dominios, rotuloInicio, idxUltimoConsolidado } = useMemo(() => {
    if (!data) {
      return {
        visiveis: [] as PontoGrafico[],
        dominios: { temp: [14, 26] as [number, number], casos: [0, 100] as [number, number], oni: [-1.5, 2.5] as [number, number],
        },
        rotuloInicio: LABEL_PICO_EL_NINO_FALLBACK,
        idxUltimoConsolidado: -1,
      };
    }

    const pontos: PontoGrafico[] = data.labels.map((label, i) => ({
      idx: i,
      label,
      casosObs: data.projetado[i] ? null : data.casos[i],
      casosProj: null as number | null,
      casosInf: null as number | null,
      casosFaixa: null as number | null,
      tempObs: null as number | null,
      tempProj: null as number | null,
      oniObs: null as number | null,
      oniProj: null as number | null,
      projetado: data.projetado[i],
      oniProjetado: data.oni_projetado?.[i] ?? data.projetado[i],
    }));

    const idxUltimoReal = data.idx_ultimo_real;
    for (let i = 0; i < pontos.length; i++) {
      const oniVal = data.oni[i];
      if (oniVal == null) continue;
      if (i <= idxUltimoReal) {
        pontos[i].oniObs = oniVal;
      }
      if (i >= idxUltimoReal) {
        pontos[i].oniProj = oniVal;
      }
    }

    for (let i = 0; i < pontos.length; i++) {
      const tConsolidado = temperaturaGrafico(data.temp[i]);
      const tProjetado = temperaturaGrafico(data.temp_proj[i]);
      if (i <= idxUltimoReal) {
        pontos[i].tempObs = tConsolidado;
      }
      if (i >= idxUltimoReal) {
        pontos[i].tempProj = data.projetado[i] ? tProjetado : tConsolidado;
      }
    }

    if (idxUltimoReal >= 0 && idxUltimoReal < pontos.length) {
      pontos[idxUltimoReal].casosProj = pontos[idxUltimoReal].casosObs;
      if (pontos[idxUltimoReal].tempProj == null) {
        pontos[idxUltimoReal].tempProj =
          pontos[idxUltimoReal].tempObs ??
          temperaturaGrafico(data.temp_proj[idxUltimoReal + 1]);
      }
    }

    for (let i = 0; i < pontos.length; i++) {
      if (data.projetado[i]) {
        pontos[i].casosProj = data.proj[i];
        const inf = data.inf?.[i];
        const sup = data.sup?.[i];
        if (
          inf != null &&
          sup != null &&
          Number.isFinite(inf) &&
          Number.isFinite(sup) &&
          sup >= inf
        ) {
          pontos[i].casosInf = inf;
          pontos[i].casosFaixa = Math.max(0, sup - inf);
        }
        if (pontos[i].tempProj == null) {
          pontos[i].tempProj = temperaturaGrafico(data.temp_proj[i]);
        }
      }
    }

    // Continuidade da faixa no mês de transição (último consolidado).
    if (idxUltimoReal >= 0 && idxUltimoReal < pontos.length) {
      const inf = data.inf?.[idxUltimoReal];
      const sup = data.sup?.[idxUltimoReal];
      const projVal = pontos[idxUltimoReal].casosProj;
      if (
        projVal != null &&
        inf != null &&
        sup != null &&
        Number.isFinite(inf) &&
        Number.isFinite(sup)
      ) {
        pontos[idxUltimoReal].casosInf = inf;
        pontos[idxUltimoReal].casosFaixa = Math.max(0, sup - inf);
      } else if (projVal != null) {
        // Fallback: se não houver inf/sup no consolidado, herda do próximo projetado.
        const next = pontos[idxUltimoReal + 1];
        if (next?.casosInf != null && next.casosFaixa != null) {
          pontos[idxUltimoReal].casosInf = next.casosInf;
          pontos[idxUltimoReal].casosFaixa = next.casosFaixa;
        }
      }
    }

    const idxPico = indiceUltimoPicoElNino(
      data.labels,
      data.oni,
      data.idx_ultimo_real,
      LABEL_PICO_EL_NINO_FALLBACK,
    );
    const idxDez23 = data.labels.findIndex(
      (l) => l.trim().toLowerCase() === LABEL_PICO_EL_NINO_FALLBACK.toLowerCase(),
    );
    const idxInicio = idxDez23 >= 0 ? idxDez23 : idxPico;
    const slice = pontos.slice(idxInicio).map((p, i) => ({ ...p, idx: i }));
    const inicio = data.labels[idxInicio] ?? LABEL_PICO_EL_NINO_FALLBACK;
    const idxConsolidado = slice.reduce(
      (acc, p, i) => (!p.projetado ? i : acc),
      -1,
    );

    const casosVals = slice
      .flatMap((p) => [
        p.casosObs,
        p.casosProj,
        p.casosInf,
        p.casosInf != null && p.casosFaixa != null
          ? p.casosInf + p.casosFaixa
          : null,
      ])
      .filter((v): v is number => v != null && v >= 0);
    const tempVals = slice.flatMap((p) => [p.tempObs, p.tempProj]).filter((v): v is number => v != null);
    const oniVals = slice
      .flatMap((p) => [p.oniObs, p.oniProj])
      .filter((v): v is number => v != null);

    const maxCasos = casosVals.length ? Math.max(...casosVals) : 100;
    const minTemp = tempVals.length ? Math.floor(Math.min(...tempVals) - 1) : 14;
    const maxTemp = tempVals.length ? Math.ceil(Math.max(...tempVals) + 1) : 26;
    const minOni = oniVals.length ? Math.floor(Math.min(...oniVals, -0.5) * 2) / 2 : -1.5;
    const maxOni = oniVals.length ? Math.ceil(Math.max(...oniVals, 1.5) * 2) / 2 : 2.5;

    return {
      visiveis: slice,
      dominios: {
        temp: [minTemp, maxTemp] as [number, number],
        casos: [0, Math.max(10, Math.ceil(maxCasos * 1.1))] as [number, number],
        oni: [minOni, maxOni] as [number, number],
      },
      rotuloInicio: inicio,
      idxUltimoConsolidado: idxConsolidado,
    };
  }, [data]);

  const rotuloConsolidado = data?.label_se_hoje ?? null;
  const rotuloCalendario = useMemo(() => {
    if (!data?.mes_calendario_atual || !data?.ano_calendario_atual) return null;
    const m = MESES[data.mes_calendario_atual - 1];
    return `${m}/${String(data.ano_calendario_atual).slice(-2)}`;
  }, [data]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-80 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!data || !visiveis.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-gray-400 text-sm">
        Dados de série temporal não disponíveis.
      </div>
    );
  }

  return (
    <div className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="consorcio" contexto={data.rotulo_conjunto} />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3 pr-12">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-800 leading-snug">
            {data.rotulo_conjunto}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.n_municipios === 1
              ? 'Casos notificados · ONI NOAA · Projeção'
              : `${data.n_municipios} municípios · Casos notificados (média/mun) · ONI NOAA · Projeção`}
            {' · '}
            desde pico El Niño ({rotuloInicio})
            {rotuloConsolidado && (
              <>
                {' · '}
                consolidado até {rotuloConsolidado}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {rotuloConsolidado && (
            <span className="text-xs bg-emerald-50 text-emerald-800 px-2 py-1 rounded-full font-medium whitespace-nowrap">
              Dado consolidado: {rotuloConsolidado}
            </span>
          )}
          {rotuloCalendario && (
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-medium whitespace-nowrap">
              Calendário: {rotuloCalendario}
            </span>
          )}
          {data.semana_epi && (
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-medium whitespace-nowrap">
              SE {formatarSemanaEpi(data.semana_epi)}
            </span>
          )}
          {data.elnino.ativo && (
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full font-medium">
              {data.elnino.intensidade} (ONI {data.elnino.oni_atual?.toFixed(2)})
            </span>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart data={visiveis} margin={{ top: 8, right: 56, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />

          <XAxis
            dataKey="idx"
            type="number"
            domain={[-0.5, Math.max(0, visiveis.length - 0.5)]}
            ticks={visiveis.map((p) => p.idx).filter((_, i) => i % 3 === 0)}
            tickFormatter={(idx) => visiveis[Number(idx)]?.label ?? ''}
            tick={{ fontSize: 10, fill: '#94a3b8' }}
          />

          <YAxis
            yAxisId="temp"
            orientation="left"
            tick={{ fontSize: 10, fill: '#64748b' }}
            domain={dominios.temp}
            label={{
              value: '°C',
              angle: -90,
              position: 'insideLeft',
              fontSize: 10,
              fill: '#64748b',
            }}
          />

          <YAxis
            yAxisId="casos"
            orientation="right"
            tick={{ fontSize: 10, fill: '#dc2626' }}
            domain={dominios.casos}
            label={{
              value: 'Casos/mun',
              angle: 90,
              position: 'insideRight',
              offset: 12,
              fontSize: 10,
              fill: '#dc2626',
            }}
          />

          <YAxis
            yAxisId="oni"
            orientation="right"
            tick={{ fontSize: 10, fill: '#d97706' }}
            domain={dominios.oni}
            axisLine={false}
            tickLine={false}
            width={36}
            label={{
              value: 'ONI',
              angle: 90,
              position: 'insideRight',
              offset: -8,
              fontSize: 10,
              fill: '#d97706',
            }}
          />

          {visiveis.map((p, i) => {
            const intensidade = classificarIntensidadeElNino(p.oniObs ?? p.oniProj);
            if (!intensidade) return null;
            const estilo = ESTILO_FAIXA[intensidade];
            const ehProj = p.oniProjetado || p.projetado;
            return (
              <ReferenceArea
                key={`elnino-${i}`}
                x1={p.idx - 0.5}
                x2={p.idx + 0.5}
                yAxisId="temp"
                fill={estilo.fill}
                fillOpacity={ehProj ? estilo.fillOpacityProj : estilo.fillOpacity}
                strokeOpacity={0}
                ifOverflow="visible"
              />
            );
          })}

          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value) => (
              <span className="text-gray-600">{value}</span>
            )}
          />

          {/* Faixa de incerteza (inf–sup): Area empilhada transparente + amplitude. */}
          <Area
            yAxisId="casos"
            type="monotone"
            dataKey="casosInf"
            stackId="faixa"
            stroke="none"
            fill="transparent"
            fillOpacity={0}
            legendType="none"
            connectNulls
            isAnimationActive={false}
          />
          <Area
            yAxisId="casos"
            type="monotone"
            dataKey="casosFaixa"
            stackId="faixa"
            stroke="none"
            fill="#fca5a5"
            fillOpacity={0.35}
            name="Faixa projeção (inf–sup)"
            connectNulls
            isAnimationActive={false}
          />

          <Line
            yAxisId="casos"
            type="monotone"
            dataKey="casosObs"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 2, fill: '#ef4444' }}
            name="Casos média/mun"
            connectNulls={false}
          />
          <Line
            yAxisId="casos"
            type="monotone"
            dataKey="casosProj"
            stroke="#ef4444"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            name="Projeção casos"
            connectNulls
          />

          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="tempObs"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={{ r: 2, fill: '#38bdf8' }}
            name="Temp. média"
            connectNulls
          />
          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="tempProj"
            stroke="#38bdf8"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            dot={false}
            name="Projeção temp."
            connectNulls
          />

          <Line
            yAxisId="oni"
            type="monotone"
            dataKey="oniObs"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={{ r: 2, fill: '#f59e0b' }}
            name="ONI NOAA"
            connectNulls
          />
          <Line
            yAxisId="oni"
            type="monotone"
            dataKey="oniProj"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            name="ONI NOAA (proj.)"
            connectNulls
            legendType="none"
          />

          <ReferenceLine
            yAxisId="oni"
            y={0.5}
            stroke="#f97316"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />

          {idxUltimoConsolidado >= 0 && (
            <ReferenceLine
              x={idxUltimoConsolidado}
              stroke="#64748b"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: `Consolidado ${rotuloConsolidado ?? ''}`.trim(),
                position: 'insideTopLeft',
                fontSize: 9,
                fill: '#64748b',
              }}
            />
          )}

        </ComposedChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-500 mt-3 pt-2 border-t border-gray-50">
        <span className="w-full text-[10px] uppercase tracking-wide text-gray-400 font-medium mb-0.5">
          Faixas El Niño (fundo) · {data.rotulo_conjunto}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: ESTILO_FAIXA.fraco.fill }} /> El Niño fraco (ONI 0,5–0,9)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: ESTILO_FAIXA.moderado.fill }} /> El Niño mod. (1,0–1,4)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: ESTILO_FAIXA.forte.fill }} /> El Niño forte (≥ 1,5)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: ESTILO_FAIXA.muito_forte.fill }} /> Muito forte (≥ 2,0)
        </span>
      </div>
    </div>
  );
};

export default ElNinoSerieConsorcio;
