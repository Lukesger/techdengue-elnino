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
  temp: number | null;
  /** Valor da média usada no tooltip (com ou sem EN conforme o mês). */
  mediaChuva: number | null;
  /** Linha completa: média histórica mensal sem El Niño. */
  mediaChuvaSem: number | null;
  /** Linha completa: média histórica mensal com El Niño. */
  mediaChuvaCom: number | null;
  oni: number | null;
  oniProjetado: boolean;
  projetado: boolean;
  /** ONI do próprio mês ≥ 0,5 — El Niño ativo naquele mês (não no ano inteiro). */
  elNinoAtivoNoMes: boolean;
};

const LARGURA_POR_MES = 56;
const ALTURA_GRAFICO = 480;
const MESES_VISIVEIS_SEM_SCROLL = 12;
const LIMIAR_ONI_EL_NINO = 0.5;

/** Cores alinhadas à legenda consolidada (ElNinoSerieConsorcio). */
const COR_CHUVA_SEM_EN = '#3b82f6';
const COR_CHUVA_COM_EN = '#f97316';
const COR_CHUVA_PROJ = '#93c5fd';
const COR_TEMP = '#38bdf8'; // clima / temperatura
const COR_ONI = '#f59e0b'; // ONI NOAA

function precipitacaoGrafico(v: number | null | undefined): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function temperaturaGrafico(v: number | null | undefined): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
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
      <p
        className={
          ponto.elNinoAtivoNoMes ? 'text-orange-300 mb-1' : 'text-sky-300 mb-1'
        }
      >
        {ponto.elNinoAtivoNoMes
          ? 'El Niño ativo neste mês (ONI ≥ +0,5)'
          : 'Sem El Niño neste mês (ONI < +0,5)'}
        {ponto.oniProjetado ? ' · ONI projetado' : ''}
      </p>
      {ponto.chuva != null && (
        <p className="text-sky-200">
          {ehProjecao ? 'Chuva (climatologia)' : `Chuva ${ponto.label}`}:{' '}
          {ponto.chuva.toFixed(1)} mm
        </p>
      )}
      {ponto.temp != null && (
        <p className="text-sky-300">Temperatura: {ponto.temp.toFixed(1)} °C</p>
      )}
      {ponto.mediaChuvaSem != null && (
        <p className="text-blue-300">
          Média hist. (sem EN): {ponto.mediaChuvaSem.toFixed(1)} mm
        </p>
      )}
      {ponto.mediaChuvaCom != null && (
        <p className="text-orange-200">
          Média hist. (com EN): {ponto.mediaChuvaCom.toFixed(1)} mm
        </p>
      )}
      {ponto.oni != null && (
        <p className="text-amber-300">
          ONI NOAA{ponto.oniProjetado ? ' (proj.)' : ''}: {ponto.oni.toFixed(2)} °C
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

  const {
    visiveis,
    dominioChuva,
    dominioTemp,
    dominioOni,
    idxUltimoConsolidado,
    larguraGrafico,
    temComparativo,
    nMesesComEn,
    nMesesSemEn,
  } = useMemo(() => {
    const precipArr = data?.precip ?? [];
    const precipProjArr = data?.precip_proj ?? [];
    const tempArr = data?.temp ?? [];
    const tempProjArr = data?.temp_proj ?? [];
    const labels = data?.labels ?? [];
    if (!data || !labels.length) {
      return {
        visiveis: [] as PontoChuva[],
        dominioChuva: [0, 100] as [number, number],
        dominioTemp: [15, 30] as [number, number],
        dominioOni: [-1.5, 2.5] as [number, number],
        idxUltimoConsolidado: -1,
        larguraGrafico: '100%' as const,
        temComparativo: false,
        nMesesComEn: 0,
        nMesesSemEn: 0,
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
        const obsChuva = projetado ? null : precipitacaoGrafico(precipArr[i]);
        const projChuva = projetado
          ? precipitacaoGrafico(precipProjArr[i])
          : null;
        const obsTemp = projetado ? null : temperaturaGrafico(tempArr[i]);
        const projTemp = projetado
          ? temperaturaGrafico(tempProjArr[i])
          : null;
        const oni = oniGrafico(data.oni?.[i]);
        const elNinoAtivoNoMes = oni != null && oni >= LIMIAR_ONI_EL_NINO;
        const semVal = semPorMes.get(parsed.mesNum) ?? null;
        const comVal = comPorMes.get(parsed.mesNum) ?? null;
        const mediaChuva = elNinoAtivoNoMes ? comVal : semVal;

        return {
          idx: parsed.mesNum,
          label,
          mes: MESES[parsed.mesNum - 1],
          chuva: obsChuva ?? projChuva,
          temp: obsTemp ?? projTemp,
          mediaChuva,
          // Linhas completas em todos os meses (comparativo com × sem El Niño).
          mediaChuvaSem: semVal,
          mediaChuvaCom: comVal,
          oni,
          oniProjetado: data.oni_projetado?.[i] ?? projetado,
          projetado,
          elNinoAtivoNoMes,
        };
      })
      .filter((p): p is PontoChuva => p != null)
      .sort((a, b) => a.idx - b.idx);

    const comChuvaOuTemp = pontos.filter(
      (p) => p.chuva != null || p.temp != null || p.oni != null,
    );
    const pontosExibir = comChuvaOuTemp.length ? pontos : [];

    const idxConsolidadoByFlag = pontosExibir.reduce(
      (acc, p, i) => (!p.projetado ? i : acc),
      -1,
    );
    let idxConsolidado = idxConsolidadoByFlag;
    if (data.label_se_hoje) {
      const byLabel = pontosExibir.findIndex(
        (p) =>
          p.label.trim().toLowerCase() ===
          String(data.label_se_hoje).trim().toLowerCase(),
      );
      if (byLabel >= 0) idxConsolidado = byLabel;
    }

    const chuvaVals = pontosExibir
      .flatMap((p) => [p.chuva, p.mediaChuvaSem, p.mediaChuvaCom])
      .filter((v): v is number => v != null && v >= 0);
    const tempVals = pontosExibir
      .map((p) => p.temp)
      .filter((v): v is number => v != null);
    const oniVals = pontosExibir
      .map((p) => p.oni)
      .filter((v): v is number => v != null);

    const maxChuva = chuvaVals.length ? Math.max(...chuvaVals) : 100;
    const minTemp = tempVals.length ? Math.min(...tempVals) : 15;
    const maxTemp = tempVals.length ? Math.max(...tempVals) : 30;
    const minOni = oniVals.length
      ? Math.floor(Math.min(...oniVals, -0.5) * 2) / 2
      : -1.5;
    const maxOni = oniVals.length
      ? Math.ceil(Math.max(...oniVals, 1.5) * 2) / 2
      : 2.5;

    const largura =
      pontosExibir.length > MESES_VISIVEIS_SEM_SCROLL
        ? pontosExibir.length * LARGURA_POR_MES
        : ('100%' as const);

    const nCom = pontosExibir.filter(
      (p) => !p.projetado && p.elNinoAtivoNoMes,
    ).length;
    const nSem = pontosExibir.filter(
      (p) => !p.projetado && p.oni != null && !p.elNinoAtivoNoMes,
    ).length;

    return {
      visiveis: pontosExibir,
      dominioChuva: [0, Math.max(20, Math.ceil(maxChuva * 1.15))] as [
        number,
        number,
      ],
      dominioTemp: [
        Math.floor(minTemp - 1),
        Math.ceil(maxTemp + 1),
      ] as [number, number],
      dominioOni: [minOni, maxOni] as [number, number],
      idxUltimoConsolidado: idxConsolidado,
      larguraGrafico: largura,
      temComparativo: temComp,
      nMesesComEn: nCom,
      nMesesSemEn: nSem,
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
        Dados de precipitação/clima não disponíveis para {anoExibicao}.
      </div>
    );
  }

  const precisaScroll = visiveis.length > MESES_VISIVEIS_SEM_SCROLL;
  const temTemp = visiveis.some((p) => p.temp != null);

  return (
    <div className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="chuva-consorcio" contexto={data.rotulo_conjunto} />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3 pr-12">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-800 leading-snug">
            Chuva × temperatura × ONI — {data.rotulo_conjunto}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.n_municipios === 1
              ? 'Volume mensal ERA5 (mm) e temperatura (°C)'
              : `Média mensal dos ${data.n_municipios} municípios · ERA5`}
            {' · '}
            {anoExibicao}
            {' · '}
            El Niño só nos meses com ONI ≥ +0,5
            {nMesesSemEn + nMesesComEn > 0 && (
              <>
                {' '}
                ({nMesesSemEn} sem · {nMesesComEn} com até o consolidado)
              </>
            )}
            {temComparativo && (
              <>
                {' · '}
                linhas completas: média hist. sem El Niño (azul) e com El Niño
                (laranja) · {rotuloComparativo}
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
              margin={{
                top: 20,
                right: 52,
                left: temTemp ? 16 : 8,
                bottom: 8,
              }}
              barCategoryGap="20%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis
                yAxisId="chuva"
                orientation="left"
                tick={{ fontSize: 10, fill: '#64748b' }}
                domain={dominioChuva}
                width={44}
                tickCount={6}
                label={{
                  value: 'mm',
                  position: 'top',
                  offset: 6,
                  fontSize: 10,
                  fill: '#64748b',
                }}
              />
              {temTemp && (
                <YAxis
                  yAxisId="temp"
                  orientation="left"
                  tick={{ fontSize: 10, fill: COR_TEMP }}
                  domain={dominioTemp}
                  width={44}
                  axisLine={{ stroke: COR_TEMP, strokeWidth: 1 }}
                  tickLine={false}
                  tickCount={6}
                  label={{
                    value: '°C',
                    position: 'top',
                    offset: 6,
                    fontSize: 10,
                    fill: COR_TEMP,
                  }}
                />
              )}
              <YAxis
                yAxisId="oni"
                orientation="right"
                tick={{ fontSize: 10, fill: COR_ONI }}
                domain={dominioOni}
                width={44}
                axisLine={{ stroke: COR_ONI, strokeWidth: 1 }}
                tickLine={false}
                tickCount={6}
                label={{
                  value: 'ONI',
                  position: 'top',
                  offset: 6,
                  fontSize: 10,
                  fill: COR_ONI,
                }}
              />
              <Tooltip content={<TooltipChuva />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />

              {temComparativo && (
                <Line
                  yAxisId="chuva"
                  type="monotone"
                  dataKey="mediaChuvaSem"
                  name="Média hist. (sem El Niño)"
                  stroke={COR_CHUVA_SEM_EN}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  connectNulls
                  legendType="line"
                />
              )}
              {temComparativo && (
                <Line
                  yAxisId="chuva"
                  type="monotone"
                  dataKey="mediaChuvaCom"
                  name="Média hist. (com El Niño)"
                  stroke={COR_CHUVA_COM_EN}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  connectNulls
                  legendType="line"
                />
              )}

              <Bar
                yAxisId="chuva"
                dataKey="chuva"
                name={`Chuva ${anoExibicao}`}
                radius={[3, 3, 0, 0]}
              >
                {visiveis.map((p, i) => {
                  if (p.projetado) {
                    return (
                      <Cell
                        key={`bar-${i}`}
                        fill={COR_CHUVA_PROJ}
                        fillOpacity={0.7}
                      />
                    );
                  }
                  return (
                    <Cell
                      key={`bar-${i}`}
                      fill={
                        p.elNinoAtivoNoMes ? COR_CHUVA_COM_EN : COR_CHUVA_SEM_EN
                      }
                    />
                  );
                })}
              </Bar>

              {temTemp && (
                <Line
                  yAxisId="temp"
                  type="monotone"
                  dataKey="temp"
                  name={`Temperatura ${anoExibicao}`}
                  stroke={COR_TEMP}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: COR_TEMP }}
                  connectNulls
                />
              )}

              <Line
                yAxisId="oni"
                type="monotone"
                dataKey="oni"
                name="ONI NOAA"
                stroke={COR_ONI}
                strokeWidth={2}
                dot={{ r: 3, fill: COR_ONI }}
                connectNulls
              />

              <ReferenceLine
                yAxisId="oni"
                y={LIMIAR_ONI_EL_NINO}
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="4 6"
                strokeOpacity={0.35}
                ifOverflow="extendDomain"
                label={{
                  value: 'ONI +0,5',
                  position: 'insideTopRight',
                  fontSize: 9,
                  fill: '#94a3b8',
                  opacity: 0.55,
                }}
              />

              {idxUltimoConsolidado >= 0 &&
                visiveis[idxUltimoConsolidado]?.mes != null && (
                <ReferenceLine
                  yAxisId="chuva"
                  x={visiveis[idxUltimoConsolidado].mes}
                  stroke="#64748b"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
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

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ background: COR_CHUVA_SEM_EN }}
          />
          Barra azul = chuva do mês sem El Niño
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ background: COR_CHUVA_COM_EN }}
          />
          Barra laranja = chuva do mês com El Niño
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3 border-t-2 border-dashed"
            style={{ borderColor: COR_CHUVA_SEM_EN }}
          />
          Linha completa: média hist. sem El Niño
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3 border-t-2 border-dashed"
            style={{ borderColor: COR_CHUVA_COM_EN }}
          />
          Linha completa: média hist. com El Niño
        </span>
        {temTemp && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-0.5"
              style={{ background: COR_TEMP }}
            />
            Clima / temperatura (azul)
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-0.5"
            style={{ background: COR_ONI }}
          />
          ONI NOAA (âmbar)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-5 border-t border-dashed border-slate-300"
            aria-hidden
          />
          Marco ONI +0,5 (marca d&apos;água)
        </span>
      </div>
      <p className="text-[10px] text-gray-400 mt-1">
        A linha tracejada clara (marca d&apos;água) indica o limiar ONI +0,5:
        acima = El Niño no mês; abaixo = sem El Niño. As duas linhas
        pontilhadas de chuva percorrem todos os meses: azul = climatologia sem
        El Niño e laranja = climatologia com El Niño ({rotuloComparativo}). As
        barras seguem o ONI do mês (≥ +0,5 = El Niño ativo).
      </p>
    </div>
  );
};

export default ElNinoChuvaConsorcio;
