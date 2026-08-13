import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ComparativoMensal } from '@/services/el-nino-api';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';
import { perfilMensalElNino, rotuloEscopoGrafico } from '@/utils/el-nino/graficos-filtros';
import { ANO_INICIO_PADRAO, anoFimDados } from '@/utils/el-nino/constants';

const MESES_ORDEM = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

interface Props {
  /** Preferir série completa (sem filtro de período da página). */
  mensalMun?: Array<Record<string, unknown>> | null;
  comparativoMensal?: ComparativoMensal[] | null;
  nMunicipios?: number;
  nomeMunicipio?: string | null;
  loading?: boolean;
}

type ChartPonto = { mes: string; sem: number | null; com: number | null };

function faixaAnos(anos: number[]): string | null {
  if (!anos.length) return null;
  const min = Math.min(...anos);
  const max = Math.max(...anos);
  return min === max ? String(min) : `${min}–${max}`;
}

function rotuloSerie(base: string, faixa: string | null): string {
  return faixa ? `${base} (${faixa})` : base;
}

function filtrarMensalNoHistoricoFixo(
  mensalMun: Array<Record<string, unknown>>,
  anoInicioFixo: number,
  anoFimFixo: number,
): Array<Record<string, unknown>> {
  return mensalMun.filter((r) => {
    const a = Number(r.Ano);
    return Number.isFinite(a) && a >= anoInicioFixo && a <= anoFimFixo;
  });
}

function flagElNinoDeLinha(r: Record<string, unknown>): boolean {
  if (r.ElNino != null && r.ElNino !== '') {
    return Number(r.ElNino) !== 0;
  }
  const oni = r.ONI != null && r.ONI !== '' ? Number(r.ONI) : null;
  return oni != null && Number.isFinite(oni) && oni >= 0.5;
}

function coletarAnosSemCom(
  filtrado: Array<Record<string, unknown>>,
): { anosSem: Set<number>; anosCom: Set<number> } {
  const anosSem = new Set<number>();
  const anosCom = new Set<number>();
  for (const r of filtrado) {
    const a = Number(r.Ano);
    if (!Number.isFinite(a)) continue;
    if (flagElNinoDeLinha(r)) anosCom.add(a);
    else anosSem.add(a);
  }
  return { anosSem, anosCom };
}

function seriesSemCom(dados: ComparativoMensal[]): {
  sem: ComparativoMensal[];
  com: ComparativoMensal[];
} {
  const sem = dados
    .filter((c) => c.Periodo === 'Sem El Nino' || c.ElNino === 0)
    .sort((a, b) => a.MesNum - b.MesNum);
  const com = dados
    .filter((c) => c.Periodo === 'Com El Nino' || c.ElNino === 1)
    .sort((a, b) => a.MesNum - b.MesNum);
  return { sem, com };
}

function montarChartData(
  sem: ComparativoMensal[],
  com: ComparativoMensal[],
): ChartPonto[] {
  return MESES_ORDEM.map((mes, i) => {
    const mesNum = i + 1;
    const s = sem.find((r) => r.MesNum === mesNum);
    const c = com.find((r) => r.MesNum === mesNum);
    return {
      mes,
      sem: s?.CasosDengue ?? null,
      com: c?.CasosDengue ?? null,
    };
  });
}

function carregarDadosComparativo(
  mensalMun: Array<Record<string, unknown>> | null | undefined,
  comparativoMensal: ComparativoMensal[] | null | undefined,
  anoInicioFixo: number,
  anoFimFixo: number,
): {
  dados: ComparativoMensal[];
  anosSem: Set<number>;
  anosCom: Set<number>;
} {
  if (mensalMun?.length) {
    const filtrado = filtrarMensalNoHistoricoFixo(
      mensalMun,
      anoInicioFixo,
      anoFimFixo,
    );
    const anos = coletarAnosSemCom(filtrado);
    return {
      dados: perfilMensalElNino(filtrado).dados,
      anosSem: anos.anosSem,
      anosCom: anos.anosCom,
    };
  }
  return {
    dados: comparativoMensal?.length ? comparativoMensal : [],
    anosSem: new Set<number>(),
    anosCom: new Set<number>(),
  };
}

/** Monta séries do gráfico Sem x Com El Niño (histórico fixo). */
function montarPerfilMensalChart(
  mensalMun: Array<Record<string, unknown>> | null | undefined,
  comparativoMensal: ComparativoMensal[] | null | undefined,
  anoInicioFixo: number,
  anoFimFixo: number,
): { chartData: ChartPonto[]; rotuloSem: string; rotuloCom: string } {
  const { dados, anosSem, anosCom } = carregarDadosComparativo(
    mensalMun,
    comparativoMensal,
    anoInicioFixo,
    anoFimFixo,
  );
  const { sem, com } = seriesSemCom(dados);

  return {
    chartData: montarChartData(sem, com),
    rotuloSem: rotuloSerie('Sem El Niño', faixaAnos([...anosSem])),
    rotuloCom: rotuloSerie('Com El Niño', faixaAnos([...anosCom])),
  };
}

function formatarTooltipCasos(v: number, name: string): [string, string] {
  const texto = v != null ? Math.round(v).toLocaleString('pt-BR') : '—';
  return [texto, name];
}

function PerfilMensalChart(props: {
  chartData: ChartPonto[];
  rotuloSem: string;
  rotuloCom: string;
  escopoRotulo: string | null;
  anoInicioFixo: number;
  anoFimFixo: number;
}) {
  const {
    chartData,
    rotuloSem,
    rotuloCom,
    escopoRotulo,
    anoInicioFixo,
    anoFimFixo,
  } = props;

  return (
    <article className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="elnino-mes" />
      <header className="mb-3 pr-8">
        <h3 className="text-sm font-semibold text-gray-800">Perfil mensal de casos</h3>
        <p className="text-xs text-gray-400">
          Sem x Com El Niño
          {escopoRotulo ? ` · ${escopoRotulo}` : ''}
          {` · média anual · histórico completo ${anoInicioFixo}–${anoFimFixo}`}
        </p>
      </header>

      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickFormatter={(v) => Number(v).toLocaleString('pt-BR')}
            label={{
              value: 'Casos (média mensal)',
              angle: -90,
              position: 'insideLeft',
              fontSize: 10,
              fill: '#9ca3af',
            }}
          />
          <Tooltip
            formatter={formatarTooltipCasos}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            type="monotone"
            dataKey="sem"
            stroke="#3b82f6"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#3b82f6' }}
            name={rotuloSem}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="com"
            stroke="#f97316"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#f97316' }}
            name={rotuloCom}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </article>
  );
}

/**
 * Perfil mensal Sem x Com El Niño (equivalente a `chartElNinoMensal`).
 * Período fixo (histórico completo): não acompanha o filtro global de anos.
 */
export const ElNinoPerfilMensal: React.FC<Props> = ({
  mensalMun,
  comparativoMensal,
  nMunicipios = 0,
  nomeMunicipio,
  loading,
}) => {
  const anoInicioFixo = ANO_INICIO_PADRAO;
  const anoFimFixo = anoFimDados();

  const { chartData, rotuloSem, rotuloCom } = useMemo(
    () =>
      montarPerfilMensalChart(
        mensalMun,
        comparativoMensal,
        anoInicioFixo,
        anoFimFixo,
      ),
    [mensalMun, comparativoMensal, anoInicioFixo, anoFimFixo],
  );

  const temDados = chartData.some((d) => d.sem != null || d.com != null);
  const escopoRotulo = rotuloEscopoGrafico(nomeMunicipio, nMunicipios);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="h-72 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!temDados) return null;

  return (
    <PerfilMensalChart
      chartData={chartData}
      rotuloSem={rotuloSem}
      rotuloCom={rotuloCom}
      escopoRotulo={escopoRotulo}
      anoInicioFixo={anoInicioFixo}
      anoFimFixo={anoFimFixo}
    />
  );
};

export default ElNinoPerfilMensal;
