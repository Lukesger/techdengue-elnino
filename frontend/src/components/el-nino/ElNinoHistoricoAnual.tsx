import React, { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { HistoricoAnual, OniMensal, SerieMensal } from '@/services/el-nino-api';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';
import { rotuloEscopoGrafico } from '@/utils/el-nino/graficos-filtros';

interface Props {
  historico: HistoricoAnual[] | null | undefined;
  /** ONI mensal NOAA — necessário para mostrar ocupação parcial do ano. */
  oniMensal?: OniMensal[] | null;
  /** Fallback de ONI quando oniMensal vier vazio. */
  serie?: SerieMensal[] | null;
  anoInicio?: number;
  anoFim?: number;
  mesFim?: number;
  nMunicipios?: number;
  nomeMunicipio?: string | null;
  loading?: boolean;
}

const MESES_CURTO = [
  'J',
  'F',
  'M',
  'A',
  'M',
  'J',
  'J',
  'A',
  'S',
  'O',
  'N',
  'D',
];
const MESES_NOME = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

const LIMIAR_ONI = 0.5;
const COR_EL_NINO = '#ea580c';
const COR_NEUTRO = '#64748b';
const COR_SEM_DADO = '#e2e8f0';

type MesOni = {
  mes: number;
  oni: number | null;
  elNino: boolean;
};

type PontoAno = HistoricoAnual & {
  meses: MesOni[];
  mesesElNino: number;
  mesesComDado: number;
  fracaoElNino: number;
  oniMax: number | null;
  /** Cor da barra de casos: proporção do ano sob El Niño. */
  corCasos: string;
};

function misturarHex(a: string, b: string, t: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const u = Math.min(1, Math.max(0, t));
  const hex = (n: number) =>
    Math.round(n)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(ar + (br - ar) * u)}${hex(ag + (bg - ag) * u)}${hex(ab + (bb - ab) * u)}`;
}

function montarOniPorAnoMes(
  oniMensal: OniMensal[] | null | undefined,
  serie: SerieMensal[] | null | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const o of oniMensal ?? []) {
    if (o?.oni == null || !Number.isFinite(Number(o.oni))) continue;
    map.set(`${o.ano}-${o.mes}`, Number(o.oni));
  }
  if (map.size) return map;
  for (const r of serie ?? []) {
    if (r.ONI == null || !Number.isFinite(Number(r.ONI))) continue;
    map.set(`${r.Ano}-${r.MesNum}`, Number(r.ONI));
  }
  return map;
}

function mesesDoAno(
  ano: number,
  oniMap: Map<string, number>,
  mesFimAno: number,
): MesOni[] {
  const out: MesOni[] = [];
  for (let mes = 1; mes <= 12; mes++) {
    if (mes > mesFimAno) {
      out.push({ mes, oni: null, elNino: false });
      continue;
    }
    const oni = oniMap.has(`${ano}-${mes}`)
      ? (oniMap.get(`${ano}-${mes}`) as number)
      : null;
    out.push({
      mes,
      oni,
      elNino: oni != null && oni >= LIMIAR_ONI,
    });
  }
  return out;
}

function fmtCasos(v: number): string {
  return Math.round(v).toLocaleString('pt-BR');
}

function fmtOni(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)} °C`;
}

const TooltipCasosOni = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as PontoAno | undefined;
  if (!p) return null;

  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl min-w-[180px]">
      <p className="font-semibold mb-1.5">{p.Ano}</p>
      <p className="text-orange-300">Casos: {fmtCasos(p.CasosDengueTotal)}</p>
      <p className="text-amber-300">ONI médio: {fmtOni(p.ONIMedio)}</p>
      <p className="text-amber-200">ONI máximo: {fmtOni(p.oniMax)}</p>
      <p className="mt-1.5 pt-1.5 border-t border-gray-700 text-orange-200">
        El Niño em {p.mesesElNino}/{p.mesesComDado || 12} meses
        {p.mesesComDado
          ? ` (${Math.round(p.fracaoElNino * 100)}% do ano com dado)`
          : ''}
      </p>
    </div>
  );
};

/**
 * Histórico anual com amostragem mensal do ONI:
 * barras de casos refletem a fração do ano sob El Niño; faixa 12 meses
 * mostra em quais meses o limiar foi cruzado (ex.: só 1º semestre de 2024).
 */
export const ElNinoHistoricoAnual: React.FC<Props> = ({
  historico,
  oniMensal,
  serie,
  anoInicio,
  anoFim,
  mesFim = 12,
  nMunicipios = 0,
  nomeMunicipio,
  loading,
}) => {
  const { pontos, dominios, destaques, temOniMensal } = useMemo(() => {
    let rows = historico ?? [];
    if (anoInicio != null) rows = rows.filter((r) => r.Ano >= anoInicio);
    if (anoFim != null) rows = rows.filter((r) => r.Ano <= anoFim);
    rows = [...rows].sort((a, b) => a.Ano - b.Ano);

    const oniMap = montarOniPorAnoMes(oniMensal, serie);
    const anoCorrente = new Date().getFullYear();

    const enriquecidos: PontoAno[] = rows.map((r) => {
      const limiteMes =
        r.Ano === anoCorrente
          ? Math.min(12, mesFim)
          : r.Ano === (anoFim ?? r.Ano)
            ? Math.min(12, mesFim)
            : 12;
      const meses = mesesDoAno(r.Ano, oniMap, limiteMes);
      const comDado = meses.filter((m) => m.oni != null);
      const elNino = comDado.filter((m) => m.elNino);
      const fracao = comDado.length ? elNino.length / comDado.length : 0;
      const oniVals = comDado
        .map((m) => m.oni)
        .filter((v): v is number => v != null);
      const oniMax = oniVals.length ? Math.max(...oniVals) : r.ONIMedio;

      return {
        ...r,
        meses,
        mesesElNino: elNino.length,
        mesesComDado: comDado.length,
        fracaoElNino: fracao,
        oniMax,
        corCasos: misturarHex(COR_NEUTRO, COR_EL_NINO, fracao),
      };
    });

    const casos = enriquecidos.map((r) => r.CasosDengueTotal);
    const oni = enriquecidos
      .map((r) => r.ONIMedio)
      .filter((v): v is number => v != null && Number.isFinite(v));

    const picoCasos = enriquecidos.reduce<PontoAno | null>(
      (acc, r) =>
        !acc || r.CasosDengueTotal > acc.CasosDengueTotal ? r : acc,
      null,
    );
    const picoOni = enriquecidos.reduce<PontoAno | null>((acc, r) => {
      if (r.oniMax == null) return acc;
      if (!acc || acc.oniMax == null) return r;
      return r.oniMax > acc.oniMax ? r : acc;
    }, null);
    const maisMesesElNino = enriquecidos.reduce<PontoAno | null>((acc, r) => {
      if (!acc || r.mesesElNino > acc.mesesElNino) return r;
      return acc;
    }, null);

    return {
      pontos: enriquecidos,
      temOniMensal: oniMap.size > 0,
      dominios: {
        casos: [
          0,
          Math.max(10, Math.ceil(Math.max(...casos, 0) * 1.15)),
        ] as [number, number],
        oni: [
          oni.length ? Math.floor(Math.min(...oni, -0.5) * 2) / 2 : -1.5,
          oni.length ? Math.ceil(Math.max(...oni, 1.5) * 2) / 2 : 2.5,
        ] as [number, number],
      },
      destaques: { picoCasos, picoOni, maisMesesElNino },
    };
  }, [historico, oniMensal, serie, anoInicio, anoFim, mesFim]);

  const escopoRotulo = rotuloEscopoGrafico(nomeMunicipio, nMunicipios);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="h-72 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!pontos.length) {
    return null;
  }

  return (
    <article className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="historico-anual" />

      <header className="mb-3 pr-8">
        <h3 className="text-sm font-semibold text-gray-800">Histórico anual</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Casos no ano e presença mensal do El Niño (ONI ≥ +0,5)
          {escopoRotulo ? ` · ${escopoRotulo}` : ''}
          {anoInicio != null && anoFim != null ? ` · ${anoInicio}–${anoFim}` : ''}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-[11px] text-gray-600">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-8 shrink-0 rounded-sm"
            style={{
              background: `linear-gradient(90deg, ${COR_NEUTRO}, ${COR_EL_NINO})`,
            }}
            aria-hidden
          />
          Barra de casos (mais laranja = mais meses sob El Niño)
        </span>
        <span className="inline-flex items-center gap-1.5 text-amber-800">
          <span
            className="inline-block h-0.5 w-4 shrink-0 rounded-full bg-amber-500"
            aria-hidden
          />
          ONI médio anual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-sm"
            style={{ background: COR_EL_NINO }}
            aria-hidden
          />
          Mês com El Niño
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-sm"
            style={{ background: COR_NEUTRO }}
            aria-hidden
          />
          Mês neutro / La Niña
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {destaques.picoCasos && (
          <div className="rounded-lg bg-orange-50 border border-orange-100 px-2.5 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-orange-700/70 font-medium">
              Pico de casos
            </p>
            <p className="text-sm font-semibold text-orange-800 tabular-nums">
              {destaques.picoCasos.Ano}
              <span className="font-normal text-orange-700/80 text-xs ml-1">
                {fmtCasos(destaques.picoCasos.CasosDengueTotal)}
              </span>
            </p>
          </div>
        )}
        {destaques.picoOni?.oniMax != null && (
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-amber-700/70 font-medium">
              ONI mais alto
            </p>
            <p className="text-sm font-semibold text-amber-900 tabular-nums">
              {destaques.picoOni.Ano}
              <span className="font-normal text-amber-800/80 text-xs ml-1">
                {fmtOni(destaques.picoOni.oniMax)}
              </span>
            </p>
          </div>
        )}
        {destaques.maisMesesElNino && destaques.maisMesesElNino.mesesElNino > 0 && (
          <div className="rounded-lg bg-stone-50 border border-stone-200 px-2.5 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-stone-600/80 font-medium">
              Mais meses El Niño
            </p>
            <p className="text-sm font-semibold text-stone-800 tabular-nums">
              {destaques.maisMesesElNino.Ano}
              <span className="font-normal text-stone-600 text-xs ml-1">
                {destaques.maisMesesElNino.mesesElNino}/
                {destaques.maisMesesElNino.mesesComDado} meses
              </span>
            </p>
          </div>
        )}
      </div>

      <div className="mb-1">
        <p className="text-[11px] font-medium text-gray-500 mb-1">
          Casos no ano{' '}
          <span className="text-gray-400 font-normal">(cor = fração do ano sob El Niño)</span>
          {' · '}
          ONI médio <span className="text-gray-400 font-normal">(linha)</span>
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart
            data={pontos}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis
              dataKey="Ano"
              tick={{ fontSize: 11, fill: '#64748b' }}
              axisLine={{ stroke: '#e2e8f0' }}
              tickLine={false}
            />
            <YAxis
              yAxisId="casos"
              tick={{ fontSize: 10, fill: '#9a3412' }}
              domain={dominios.casos}
              width={44}
              tickFormatter={(v) =>
                Number(v) >= 1000
                  ? `${(Number(v) / 1000).toFixed(Number(v) >= 10000 ? 0 : 1)}k`
                  : String(v)
              }
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="oni"
              orientation="right"
              tick={{ fontSize: 10, fill: '#b45309' }}
              domain={dominios.oni}
              width={36}
              tickFormatter={(v) => Number(v).toFixed(1)}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine
              yAxisId="oni"
              y={LIMIAR_ONI}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              strokeOpacity={0.7}
            />
            <ReferenceLine yAxisId="oni" y={0} stroke="#cbd5e1" strokeWidth={1} />
            <Tooltip content={<TooltipCasosOni />} />
            <Bar
              yAxisId="casos"
              dataKey="CasosDengueTotal"
              name="Casos"
              barSize={26}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            >
              {pontos.map((p) => (
                <Cell key={p.Ano} fill={p.corCasos} />
              ))}
            </Bar>
            <Line
              yAxisId="oni"
              type="monotone"
              dataKey="ONIMedio"
              name="ONI médio"
              stroke="#f59e0b"
              strokeWidth={2.25}
              dot={{ r: 3.5, fill: '#f59e0b', stroke: '#fff', strokeWidth: 1.5 }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Amostragem mensal — mostra El Niño parcial (ex.: 2024 só no 1º semestre) */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-[11px] font-medium text-gray-500 mb-2">
          Presença mensal do El Niño{' '}
          <span className="text-gray-400 font-normal">
            (cada célula = 1 mês; laranja = ONI ≥ +0,5)
          </span>
        </p>

        {!temOniMensal ? (
          <p className="text-xs text-gray-400 py-2">
            ONI mensal indisponível — não foi possível detalhar a ocupação dentro do ano.
          </p>
        ) : (
          <div className="space-y-1.5">
            <div
              className="grid gap-1.5 items-center text-[9px] text-gray-400 mb-0.5"
              style={{ gridTemplateColumns: '3rem 1fr 4.5rem' }}
            >
              <span />
              <div className="grid grid-cols-12 gap-0.5 px-0.5">
                {MESES_CURTO.map((m, i) => (
                  <span key={`${m}-${i}`} className="text-center tabular-nums">
                    {m}
                  </span>
                ))}
              </div>
              <span className="text-right">meses</span>
            </div>

            {pontos.map((p) => (
              <div
                key={p.Ano}
                className="grid gap-1.5 items-center"
                style={{ gridTemplateColumns: '3rem 1fr 4.5rem' }}
              >
                <span className="text-xs font-medium text-gray-700 tabular-nums">
                  {p.Ano}
                </span>
                <div
                  className="grid grid-cols-12 gap-0.5"
                  role="img"
                  aria-label={`${p.Ano}: El Niño em ${p.mesesElNino} de ${p.mesesComDado} meses`}
                >
                  {p.meses.map((m) => {
                    const title =
                      m.oni == null
                        ? `${MESES_NOME[m.mes - 1]}/${p.Ano}: sem dado`
                        : `${MESES_NOME[m.mes - 1]}/${p.Ano}: ONI ${fmtOni(m.oni)}${
                            m.elNino ? ' (El Niño)' : ''
                          }`;
                    return (
                      <span
                        key={m.mes}
                        title={title}
                        className="h-4 rounded-[2px] border border-black/5"
                        style={{
                          background:
                            m.oni == null
                              ? COR_SEM_DADO
                              : m.elNino
                                ? COR_EL_NINO
                                : COR_NEUTRO,
                          opacity: m.oni == null ? 0.7 : 1,
                        }}
                      />
                    );
                  })}
                </div>
                <span className="text-[11px] text-gray-600 text-right tabular-nums">
                  {p.mesesElNino}/{p.mesesComDado || '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
};

export default ElNinoHistoricoAnual;
