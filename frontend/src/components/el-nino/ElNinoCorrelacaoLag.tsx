import React, { useMemo } from 'react';
import { CorrelacaoLagResponse } from '@/services/el-nino-api';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';

interface Props {
  data: CorrelacaoLagResponse | null;
  loading?: boolean;
}

function corCelula(r: number | null): string {
  if (r == null) return '#f1f5f9';
  const a = Math.abs(r);
  if (r >= 0) {
    if (a >= 0.5) return '#059669';
    if (a >= 0.3) return '#34d399';
    if (a >= 0.15) return '#a7f3d0';
    return '#ecfdf5';
  }
  if (a >= 0.5) return '#dc2626';
  if (a >= 0.3) return '#f87171';
  if (a >= 0.15) return '#fecaca';
  return '#fff1f2';
}

function textoCelula(r: number | null): string {
  if (r == null) return '—';
  return r.toFixed(2);
}

/**
 * Heatmap variável climática × lag (0–6 meses) × casos.
 */
export const ElNinoCorrelacaoLag: React.FC<Props> = ({ data, loading }) => {
  const { variaveis, lags, mapa } = useMemo(() => {
    const items = data?.items ?? [];
    const vars = [...new Set(items.map((i) => i.variavel))];
    const maxLag = data?.max_lag ?? 6;
    const lagsArr = Array.from({ length: maxLag + 1 }, (_, i) => i);
    const mapaLocal = new Map<string, { r: number | null; n: number }>();
    for (const it of items) {
      mapaLocal.set(`${it.variavel}|${it.lag}`, { r: it.r, n: it.n });
    }
    return { variaveis: vars, lags: lagsArr, mapa: mapaLocal };
  }, [data]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="h-56 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!variaveis.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-gray-400 text-sm">
        Correlação com defasagem indisponível (série curta ou sem dados).
      </div>
    );
  }

  const periodo =
    data?.periodo != null
      ? `${data.periodo.ano_inicio}–${data.periodo.ano_fim}`
      : null;

  return (
    <article className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="correlacao-lag" />
      <header className="mb-3 pr-8">
        <h3 className="text-sm font-semibold text-gray-800">
          Correlação com defasagem (lag)
        </h3>
        <p className="text-xs text-gray-400">
          Clima em t−lag × casos em t
          {periodo ? ` · ${periodo}` : ''}
          {' · '}
          correlação ≠ causalidade
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs min-w-[420px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white z-10 p-1.5 text-left text-gray-400 font-medium">
                Variável
              </th>
              {lags.map((lag) => (
                <th
                  key={lag}
                  className="p-1.5 text-center text-gray-400 font-medium w-14"
                >
                  L{lag}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {variaveis.map((v) => (
              <tr key={v}>
                <td className="sticky left-0 bg-white z-10 p-1.5 font-medium text-gray-600 whitespace-nowrap">
                  {v}
                </td>
                {lags.map((lag) => {
                  const cell = mapa.get(`${v}|${lag}`);
                  const r = cell?.r ?? null;
                  const bg = corCelula(r);
                  const escuro = r != null && Math.abs(r) >= 0.3;
                  return (
                    <td key={lag} className="p-0.5">
                      <div
                        className="h-9 rounded-md flex items-center justify-center font-medium"
                        style={{
                          backgroundColor: bg,
                          color: escuro ? '#fff' : '#334155',
                        }}
                        title={
                          cell
                            ? `${v} lag ${lag}: r=${textoCelula(r)} (n=${cell.n})`
                            : undefined
                        }
                      >
                        {textoCelula(r)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-gray-400 mt-2">
        L0 = mesmo mês · L2 = clima de há 2 meses × casos atuais
      </p>
    </article>
  );
};

export default ElNinoCorrelacaoLag;
