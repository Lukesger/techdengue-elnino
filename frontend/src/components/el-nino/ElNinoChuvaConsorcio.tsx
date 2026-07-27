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
  ReferenceLine,
  Cell,
} from 'recharts';
import { SerieConsorcioResponse, SerieMensal } from '@/services/el-nino-api';
import { MESES } from '@/utils/el-nino/constants';
import { perfilMensalPrecipitacaoElNino } from '@/utils/el-nino/graficos-filtros';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';

interface Props {
  data: SerieConsorcioResponse | null;
  serieHistorica?: SerieMensal[] | null;
  anoInicio?: number;
  anoFim?: number;
  loading?: boolean;
}

type PontoChuva = {
  idx: number;
  label: string;
  mes: string;
  chuva: number | null;
  chuvaSemElNino: number | null;
  chuvaComElNino: number | null;
  oni: number | null;
  oniProjetado: boolean;
  projetado: boolean;
};

const LARGURA_POR_MES = 56;
const ALTURA_GRAFICO = 480;
const MESES_VISIVEIS_SEM_SCROLL = 12;

function precipitacaoGrafico(v: number | null | undefined): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function oniGrafico(v: number | null | undefined): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Rótulo "Jan/26" → { ano: 2026, mesNum: 1 } */
function parseLabelMesAno(label: string): { ano: number; mesNum: number } | null {
  const parts = label.trim().split('/');
  if (parts.length !== 2) return null;
  const mesStr = parts[0].trim().toLowerCase().slice(0, 3);
  const mesNum = MESES.findIndex((m) => m.toLowerCase().startsWith(mesStr)) + 1;
  const yy = Number(parts[1]);
  if (mesNum < 1 || !Number.isFinite(yy)) return null;
  const ano = yy < 100 ? 2000 + yy : yy;
  return { ano, mesNum };
}

const TooltipChuva = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const ponto = payload[0]?.payload as PontoChuva | undefined;
  if (!ponto) return null;

  const ehProjecao = Boolean(ponto.projetado);

  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl max-w-xs">
      <p className="font-semibold mb-1">{label}</p>
      {ponto.chuva != null && (
        <p className="text-sky-300">
          {ehProjecao ? 'Chuva (climatologia)' : `Chuva ${ponto.label}`}:{' '}
          {ponto.chuva.toFixed(1)} mm
        </p>
      )}
      {ponto.chuvaSemElNino != null && (
        <p className="text-blue-300">
          Média sem El Niño: {ponto.chuvaSemElNino.toFixed(1)} mm
        </p>
      )}
      {ponto.chuvaComElNino != null && (
        <p className="text-orange-300">
          Média com El Niño: {ponto.chuvaComElNino.toFixed(1)} mm
        </p>
      )}
      {ponto.oni != null && (
        <p className="text-amber-300">
          ONI NOAA{ponto.oniProjetado ? ' (proj.)' : ''}: {ponto.oni.toFixed(2)} °C
        </p>
      )}
      {ponto.chuvaSemElNino != null && ponto.chuvaComElNino != null && (
        <p className="text-gray-400 mt-1 border-t border-gray-700 pt-1">
          Δ com vs sem:{' '}
          {(ponto.chuvaComElNino - ponto.chuvaSemElNino >= 0 ? '+' : '')}
          {(ponto.chuvaComElNino - ponto.chuvaSemElNino).toFixed(1)} mm
        </p>
      )}
    </div>
  );
};

export const ElNinoChuvaConsorcio: React.FC<Props> = ({
  data,
  serieHistorica,
  anoInicio,
  anoFim,
  loading,
}) => {
  const anoExibicao = data?.ano_calendario_atual ?? new Date().getFullYear();

  const { visiveis, dominioChuva, dominioOni, idxUltimoConsolidado, larguraGrafico, temComparativo } =
    useMemo(() => {
      const precipArr = data?.precip ?? [];
      const precipProjArr = data?.precip_proj ?? [];
      const labels = data?.labels ?? [];
      if (!data || !labels.length) {
        return {
          visiveis: [] as PontoChuva[],
          dominioChuva: [0, 100] as [number, number],
          dominioOni: [-1.5, 2.5] as [number, number],
          idxUltimoConsolidado: -1,
          larguraGrafico: '100%',
          temComparativo: false,
        };
      }

      const anoAlvo = data.ano_calendario_atual ?? new Date().getFullYear();

      const historicoFiltrado = (serieHistorica ?? []).filter((r) => {
        if (r.Ano === anoAlvo) return false;
        if (anoInicio != null && r.Ano < anoInicio) return false;
        if (anoFim != null && r.Ano > anoFim) return false;
        return precipitacaoGrafico(r.Precipitacao) != null;
      });

      const comparativo = perfilMensalPrecipitacaoElNino(
        historicoFiltrado as unknown as Record<string, unknown>[],
      );
      const semPorMes = new Map(
        comparativo
          .filter((c) => c.Periodo === 'Sem El Nino' || c.ElNino === 0)
          .map((c) => [c.MesNum, c.Precipitacao]),
      );
      const comPorMes = new Map(
        comparativo
          .filter((c) => c.Periodo === 'Com El Nino' || c.ElNino === 1)
          .map((c) => [c.MesNum, c.Precipitacao]),
      );
      const temComp = semPorMes.size > 0 || comPorMes.size > 0;

      const pontos: PontoChuva[] = labels
        .map((label, i) => {
          const parsed = parseLabelMesAno(label);
          if (!parsed || parsed.ano !== anoAlvo) return null;

          const projetado = Boolean(data.projetado?.[i]);
          const obs = projetado
            ? null
            : precipitacaoGrafico(precipArr[i]);
          const proj = projetado
            ? precipitacaoGrafico(precipProjArr[i])
            : null;

          return {
            idx: parsed.mesNum,
            label,
            mes: MESES[parsed.mesNum - 1],
            chuva: obs ?? proj,
            chuvaSemElNino: semPorMes.get(parsed.mesNum) ?? null,
            chuvaComElNino: comPorMes.get(parsed.mesNum) ?? null,
            oni: oniGrafico(data.oni?.[i]),
            oniProjetado: data.oni_projetado?.[i] ?? projetado,
            projetado,
          };
        })
        .filter((p): p is PontoChuva => p != null)
        .sort((a, b) => a.idx - b.idx);

      // Mantém o gráfico mesmo se alguns meses ainda não tiverem chuva.
      const comChuva = pontos.filter((p) => p.chuva != null);
      const pontosExibir = comChuva.length ? pontos : [];

      const idxConsolidado = pontosExibir.reduce(
        (acc, p, i) => (!p.projetado ? i : acc),
        -1,
      );

      const chuvaVals = pontosExibir
        .flatMap((p) => [p.chuva, p.chuvaSemElNino, p.chuvaComElNino])
        .filter((v): v is number => v != null && v >= 0);
      const oniVals = pontosExibir
        .map((p) => p.oni)
        .filter((v): v is number => v != null);

      const maxChuva = chuvaVals.length ? Math.max(...chuvaVals) : 100;
      const minOni = oniVals.length ? Math.floor(Math.min(...oniVals, -0.5) * 2) / 2 : -1.5;
      const maxOni = oniVals.length ? Math.ceil(Math.max(...oniVals, 1.5) * 2) / 2 : 2.5;

      const largura =
        pontosExibir.length > MESES_VISIVEIS_SEM_SCROLL
          ? pontosExibir.length * LARGURA_POR_MES
          : '100%';

      return {
        visiveis: pontosExibir,
        dominioChuva: [0, Math.max(20, Math.ceil(maxChuva * 1.15))] as [number, number],
        dominioOni: [minOni, maxOni] as [number, number],
        idxUltimoConsolidado: idxConsolidado,
        larguraGrafico: largura,
        temComparativo: temComp,
      };
    }, [data, serieHistorica, anoInicio, anoFim]);

  const rotuloConsolidado = data?.label_se_hoje ?? null;
  const rotuloComparativo =
    anoInicio != null && anoFim != null
      ? `média histórica ${anoInicio}–${anoFim}`
      : 'média histórica';

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-72 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!data || !visiveis.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-gray-400 text-sm">
        Dados de precipitação não disponíveis para {anoExibicao}.
      </div>
    );
  }

  const precisaScroll = visiveis.length > MESES_VISIVEIS_SEM_SCROLL;

  return (
    <div className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="chuva-consorcio" contexto={data.rotulo_conjunto} />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3 pr-12">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-800 leading-snug">
            Precipitação de chuva — {data.rotulo_conjunto}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.n_municipios === 1
              ? 'Volume mensal ERA5 (mm)'
              : `Média mensal dos ${data.n_municipios} municípios · ERA5 (mm)`}
            {' · '}
            {anoExibicao}
            {temComparativo && (
              <>
                {' · '}
                comparativo sem × com El Niño ({rotuloComparativo})
              </>
            )}
            {rotuloConsolidado && (
              <>
                {' · '}
                consolidado até {rotuloConsolidado}
              </>
            )}
            {precisaScroll && <> · role horizontalmente para ver todos os meses</>}
          </p>
        </div>
        {rotuloConsolidado && (
          <span className="text-xs bg-emerald-50 text-emerald-800 px-2 py-1 rounded-full font-medium whitespace-nowrap shrink-0">
            Consolidado: {rotuloConsolidado}
          </span>
        )}
      </div>

      <div
        className="overflow-x-auto overflow-y-hidden pr-1 -mr-1 overscroll-x-contain"
        style={{ maxWidth: '100%' }}
      >
        <div style={{ width: larguraGrafico, minWidth: '100%' }}>
          <ResponsiveContainer width="100%" height={ALTURA_GRAFICO}>
            <ComposedChart
              data={visiveis}
              margin={{ top: 8, right: 48, left: 8, bottom: 8 }}
              barCategoryGap="20%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis
                yAxisId="chuva"
                tick={{ fontSize: 10, fill: '#64748b' }}
                domain={dominioChuva}
                label={{
                  value: 'mm',
                  angle: -90,
                  position: 'insideLeft',
                  fontSize: 10,
                  fill: '#64748b',
                }}
              />
              <YAxis
                yAxisId="oni"
                orientation="right"
                tick={{ fontSize: 10, fill: '#d97706' }}
                domain={dominioOni}
                axisLine={false}
                tickLine={false}
                width={36}
                label={{
                  value: 'ONI',
                  angle: 90,
                  position: 'insideRight',
                  fontSize: 10,
                  fill: '#d97706',
                }}
              />
              <Tooltip content={<TooltipChuva />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />

              {temComparativo && (
                <Line
                  yAxisId="chuva"
                  type="monotone"
                  dataKey="chuvaSemElNino"
                  name="Sem El Niño (média)"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={{ r: 3, fill: '#3b82f6' }}
                  connectNulls
                />
              )}
              {temComparativo && (
                <Line
                  yAxisId="chuva"
                  type="monotone"
                  dataKey="chuvaComElNino"
                  name="Com El Niño (média)"
                  stroke="#f97316"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={{ r: 3, fill: '#f97316' }}
                  connectNulls
                />
              )}

              <Bar
                yAxisId="chuva"
                dataKey="chuva"
                name={`Chuva ${anoExibicao}`}
                radius={[3, 3, 0, 0]}
              >
                {visiveis.map((p, i) => (
                  <Cell
                    key={`bar-${i}`}
                    fill={p.projetado ? '#93c5fd' : '#38bdf8'}
                    fillOpacity={p.projetado ? 0.7 : 1}
                  />
                ))}
              </Bar>

              <Line
                yAxisId="oni"
                type="monotone"
                dataKey="oni"
                name="ONI NOAA"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3, fill: '#f59e0b' }}
                connectNulls
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
                  yAxisId="chuva"
                  x={visiveis[idxUltimoConsolidado]?.mes}
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
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-2">
        Barras = {anoExibicao} (ERA5)
        {temComparativo
          ? ` · linhas tracejadas = média de chuva no mesmo mês calendário (${rotuloComparativo}), separando anos sem e com El Niño`
          : ''}
        {' · '}
        linha laranja = ONI NOAA
      </p>
    </div>
  );
};

export default ElNinoChuvaConsorcio;
