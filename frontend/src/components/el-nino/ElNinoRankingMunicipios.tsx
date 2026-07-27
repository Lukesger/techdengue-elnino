import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import dashboardApi from '@/services/dashboard-api';
import elNinoApi, {
  MapaProjecaoResponse,
  ProjecaoMunicipio,
} from '@/services/el-nino-api';
import {
  BairroPoiHectare,
  contratoVerbaDiretaId,
  deveExibirProjecaoBairros,
  montarRankingPoisHectarePorBairro,
  pesosDeCriadourosPorBairro,
  pesosDeDistribuicaoCriadouro,
} from '@/utils/el-nino/projecao-bairros';
import { resolverPesosHectaresPorBairro } from '@/utils/el-nino/hectares-bairro-resolver';
import { resolverMunicipioIdTechdengue } from '@/utils/el-nino/resolver-municipio-id';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';

interface ConsorcioRef {
  id: number;
  nome?: string;
  eConsorcio?: number;
  municipios: Array<{ geocode: number; nome: string }>;
}

interface Props {
  municipios: Array<{
    geocode: number;
    municipio?: string;
    nome?: string;
    casos_estimados?: number;
    casos_notificados?: number;
    intensidade?: number;
    populacao?: number;
    incidencia_100k?: number | null;
  }>;
  loading?: boolean;
  geocodeFiltro?: number | null;
  consorcioId?: number | null;
  consorcios?: ConsorcioRef[];
  mapaData?: MapaProjecaoResponse | null;
}

type ModoRanking = 'casos' | 'incidencia';

const ALTURA_POR_ITEM = 36;
const ALTURA_MINIMA = 360;

async function carregarRankingPoisBairro(opts: {
  geocode: number;
  contratoId: number | null;
  munMapa: ProjecaoMunicipio | null;
}): Promise<{ ranking: BairroPoiHectare[]; nomeMunicipio: string }> {
  const contratoId = opts.contratoId;

  // 1) NestJS El Niño: geocode → idMunicipio no banco + POIs por bairro
  if (contratoId) {
    try {
      const casosBairro = await elNinoApi.getCasosPorBairro({
        geocode: opts.geocode,
        idContrato: contratoId,
        limit: 100,
      });
      const comPois = (casosBairro?.bairros ?? []).filter((b) => b.pois > 0);
      if (comPois.length && casosBairro.idMunicipio > 0) {
        const pesosPois = pesosDeCriadourosPorBairro(
          comPois.map((b) => ({
            nome: b.nome,
            totalGeral: b.pois,
            tipos_criadouros: b.tipos_criadouros,
          })),
        );
        const pesosHa = await resolverPesosHectaresPorBairro({
          municipioId: casosBairro.idMunicipio,
          contratoId,
          pesosPois,
        });
        const ranking = montarRankingPoisHectarePorBairro(pesosPois, pesosHa);
        return {
          ranking,
          nomeMunicipio: casosBairro.nomeMunicipio,
        };
      }
      if (casosBairro?.idMunicipio > 0) {
        return {
          ranking: [],
          nomeMunicipio: casosBairro.nomeMunicipio,
        };
      }
    } catch {
      /* fallback para dados-gerenciais */
    }
  }

  let municipioId: number | null = null;
  let porTipos: Awaited<
    ReturnType<typeof dashboardApi.getTotalPorTipoCriadourosPorBairro>
  > = null;

  const munMapaCoerente =
    opts.munMapa != null &&
    Number(opts.munMapa.geocode) === Number(opts.geocode)
      ? opts.munMapa
      : null;

  if (opts.geocode) {
    const resolvido = await resolverMunicipioIdTechdengue({
      geocode: opts.geocode,
      contratoId,
      munMapa: munMapaCoerente,
    });
    if (resolvido) municipioId = resolvido;
  }

  if (!municipioId && contratoId && !opts.geocode) {
    porTipos = await dashboardApi.getTotalPorTipoCriadourosPorBairroPorContrato(
      contratoId,
    );
    if (porTipos?.idMunicipio != null && porTipos.idMunicipio > 0) {
      municipioId = porTipos.idMunicipio;
    } else {
      const idBairro = porTipos?.bairros?.find(
        (b) => b.idMunicipio != null && b.idMunicipio > 0,
      )?.idMunicipio;
      if (idBairro != null && idBairro > 0) municipioId = idBairro;
    }
  }

  if (!municipioId) {
    throw new Error('ID do município indisponível');
  }

  if (!porTipos?.bairros?.length) {
    porTipos = await dashboardApi.getTotalPorTipoCriadourosPorBairro(municipioId);
  }

  let pesosPois = pesosDeCriadourosPorBairro(porTipos?.bairros ?? []);
  if (!pesosPois.length && porTipos?.bairros?.length) {
    const totalGeral = porTipos.totalGeral || 0;
    pesosPois = pesosDeDistribuicaoCriadouro(
      porTipos.bairros.map((b) => ({
        nome: b.nomeBairro ?? '',
        quantidade: b.totalGeral ?? 0,
        percentual:
          totalGeral > 0 ? ((b.totalGeral ?? 0) / totalGeral) * 100 : 0,
      })),
    );
  }

  const pesosHa = await resolverPesosHectaresPorBairro({
    municipioId,
    contratoId,
    pesosPois,
  });
  const ranking = montarRankingPoisHectarePorBairro(pesosPois, pesosHa);

  return {
    ranking,
    nomeMunicipio:
      porTipos?.nomeMunicipio ?? '',
  };
}

function TooltipPoiBairro({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: BairroPoiHectare }>;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <p className="font-semibold text-gray-800 mb-1">{d.nome}</p>
      <p className="text-gray-600">POIs: {d.pois.toLocaleString('pt-BR')}</p>
      <p className="text-gray-600">
        Hectares: {d.hectares > 0 ? d.hectares.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}
      </p>
      <p className="text-[#0087a8] font-medium">
        POI/ha: {d.poiPorHectare != null ? d.poiPorHectare.toLocaleString('pt-BR') : '—'}
      </p>
    </div>
  );
}

function renderTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fill="#4b5563"
      fontSize={11}
      fontWeight={500}
    >
      {payload?.value ?? ''}
    </text>
  );
}

export const ElNinoRankingMunicipios: React.FC<Props> = ({
  municipios,
  loading,
  geocodeFiltro = null,
  consorcioId = null,
  consorcios = [],
  mapaData = null,
}) => {
  const [bairrosRanking, setBairrosRanking] = useState<BairroPoiHectare[]>([]);
  const [loadingBairros, setLoadingBairros] = useState(false);
  const [erroBairros, setErroBairros] = useState<string | null>(null);
  const [nomeMunicipio, setNomeMunicipio] = useState<string>('');
  const [modoRanking, setModoRanking] = useState<ModoRanking>('casos');

  const modoBairro = useMemo(
    () => deveExibirProjecaoBairros(geocodeFiltro, consorcioId, consorcios),
    [geocodeFiltro, consorcioId, consorcios],
  );

  const modoMunicipioUnico = Boolean(
    geocodeFiltro != null && !modoBairro,
  );

  const rotuloConsorcio = useMemo(() => {
    if (consorcioId != null) {
      return (
        consorcios.find((c) => c.id === consorcioId)?.nome ??
        mapaData?.rotulo_conjunto ??
        null
      );
    }
    return mapaData?.rotulo_conjunto ?? null;
  }, [consorcioId, consorcios, mapaData?.rotulo_conjunto]);

  const munMapa = useMemo((): ProjecaoMunicipio | null => {
    if (!mapaData || geocodeFiltro == null) return null;
    return (
      mapaData.municipios.find(
        (m) => Number(m.geocode) === Number(geocodeFiltro),
      ) ?? null
    );
  }, [mapaData, geocodeFiltro]);

  useEffect(() => {
    if (!modoBairro || geocodeFiltro == null) {
      setBairrosRanking([]);
      setErroBairros(null);
      setNomeMunicipio('');
      return;
    }

    const munNomeFallback =
      munMapa?.nome ||
      consorcios
        .flatMap((c) => c.municipios)
        .find((m) => Number(m.geocode) === Number(geocodeFiltro))?.nome ||
      municipios.find((m) => Number(m.geocode) === Number(geocodeFiltro))?.nome ||
      municipios.find((m) => Number(m.geocode) === Number(geocodeFiltro))?.municipio ||
      '';

    const contratoId =
      contratoVerbaDiretaId(geocodeFiltro, consorcioId, consorcios) ??
      (consorcioId != null && consorcioId > 0 ? consorcioId : null);
    let cancelado = false;
    setLoadingBairros(true);
    setErroBairros(null);

    carregarRankingPoisBairro({
      geocode: geocodeFiltro,
      contratoId,
      munMapa,
    })
      .then(({ ranking, nomeMunicipio: nomeApi }) => {
        if (cancelado) return;
        setNomeMunicipio(nomeApi || munNomeFallback);
        if (!ranking.length) {
          setBairrosRanking([]);
          setErroBairros('Nenhum bairro com POIs mapeados na TechDengue.');
          return;
        }
        setBairrosRanking(ranking);
        setErroBairros(null);
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        setBairrosRanking([]);
        setNomeMunicipio(munNomeFallback);
        const msg = err instanceof Error ? err.message : '';
        setErroBairros(
          msg.includes('indisponível')
            ? 'ID do município indisponível. Verifique o contrato de verba direta ou tente novamente.'
            : 'Não foi possível carregar POIs por bairro.',
        );
      })
      .finally(() => {
        if (!cancelado) setLoadingBairros(false);
      });

    return () => {
      cancelado = true;
    };
  }, [modoBairro, geocodeFiltro, munMapa, municipios, consorcios, consorcioId]);

  const temIncidencia = useMemo(
    () =>
      municipios.some(
        (m) =>
          m.incidencia_100k != null &&
          Number.isFinite(m.incidencia_100k) &&
          m.incidencia_100k > 0,
      ),
    [municipios],
  );

  const dadosMunicipios = useMemo(() => {
    const usarIncidencia = modoRanking === 'incidencia' && temIncidencia;
    return [...municipios]
      .map((m) => {
        const casosAbs = m.casos_notificados ?? m.casos_estimados ?? 0;
        const incidencia =
          m.incidencia_100k != null && Number.isFinite(m.incidencia_100k)
            ? m.incidencia_100k
            : m.populacao && m.populacao > 0
              ? Math.round((casosAbs / m.populacao) * 100_000 * 10) / 10
              : null;
        const valor = usarIncidencia ? (incidencia ?? 0) : casosAbs;
        return {
          nome: m.nome || m.municipio || `#${m.geocode}`,
          casos: valor,
          casosAbs,
          incidencia,
          populacao: m.populacao ?? 0,
        };
      })
      .filter((m) => m.casos > 0)
      .sort((a, b) => b.casos - a.casos);
  }, [municipios, modoRanking, temIncidencia]);

  const dadosBairros = useMemo(
    () => bairrosRanking.filter((b) => b.pois > 0),
    [bairrosRanking],
  );

  const dados = modoBairro ? dadosBairros : dadosMunicipios;
  const carregando = loading || (modoBairro && loadingBairros);

  const categoriasY = useMemo(
    () => [...dados].map((d) => d.nome).reverse(),
    [dados],
  );

  const alturaGrafico = Math.max(
    ALTURA_MINIMA,
    dados.length * ALTURA_POR_ITEM + 48,
  );
  const alturaVisivel = ALTURA_MINIMA;
  const itensVisiveisSemScroll = Math.floor((ALTURA_MINIMA - 48) / ALTURA_POR_ITEM);

  const mediaPoiHa = useMemo(() => {
    if (!dadosBairros.length) return null;
    const comHa = dadosBairros.filter((b) => b.poiPorHectare != null);
    if (!comHa.length) return null;
    return (
      Math.round(
        (comHa.reduce((s, b) => s + (b.poiPorHectare ?? 0), 0) / comHa.length) * 100,
      ) / 100
    );
  }, [dadosBairros]);

  if (modoMunicipioUnico) {
    return null;
  }

  if (carregando) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="bg-gray-100 rounded" style={{ height: ALTURA_MINIMA }} />
      </div>
    );
  }

  if (modoBairro && erroBairros) {
    return (
      <div className="relative bg-white rounded-xl border border-gray-100 p-4">
        <ElNinoGuiaGrafico chave="ranking-bairro" />
        <h3 className="text-sm font-semibold text-gray-800 mb-1 pr-8">
          POIs por Bairro{nomeMunicipio ? ` — ${nomeMunicipio}` : ''}
        </h3>
        <p className="text-xs text-amber-600">{erroBairros}</p>
      </div>
    );
  }

  if (!dados.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">
          {modoBairro ? 'POIs por Bairro' : 'Ranking de Municípios'}
        </h3>
        <p className="text-xs text-gray-400">
          {modoBairro
            ? 'Sem bairros com POIs mapeados na TechDengue.'
            : 'Sem casos confirmados disponíveis para o período analisado.'}
        </p>
      </div>
    );
  }

  const maxPois = modoBairro
    ? Math.max(...dadosBairros.map((d) => d.pois), 1)
    : Math.max(...dadosMunicipios.map((d) => d.casos), 1);

  return (
    <div className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico
        chave={modoBairro ? 'ranking-bairro' : 'ranking'}
        contexto={rotuloConsorcio}
      />
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1 pr-12">
        <h3 className="text-sm font-semibold text-gray-800">
          {modoBairro
            ? `POIs por Bairro${nomeMunicipio ? ` — ${nomeMunicipio}` : ''}`
            : 'Ranking de Municípios'}
        </h3>
        {!modoBairro && temIncidencia && (
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[11px]">
            <button
              type="button"
              onClick={() => setModoRanking('casos')}
              className={`px-2.5 py-1 font-medium transition-colors ${
                modoRanking === 'casos'
                  ? 'bg-orange-500 text-white'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              Casos
            </button>
            <button
              type="button"
              onClick={() => setModoRanking('incidencia')}
              className={`px-2.5 py-1 font-medium transition-colors border-l border-gray-200 ${
                modoRanking === 'incidencia'
                  ? 'bg-orange-500 text-white'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              /100 mil hab.
            </button>
          </div>
        )}
      </div>
      {rotuloConsorcio && !modoBairro && (
        <p className="text-xs text-gray-500 mb-1 pr-12">{rotuloConsorcio}</p>
      )}
      <p className="text-xs text-gray-400 mb-3">
        {modoBairro ? (
          <>
            {dadosBairros.length} bairros com POIs mapeados
            {dadosBairros.length > itensVisiveisSemScroll ? (
              <> · role para ver todos</>
            ) : null}
            {mediaPoiHa != null ? (
              <> · média {mediaPoiHa.toLocaleString('pt-BR')} POI/ha</>
            ) : (
              <> · passe o mouse para ver POI/ha por bairro</>
            )}
          </>
        ) : (
          <>
            {dadosMunicipios.length} municípios
            {modoRanking === 'incidencia' && temIncidencia
              ? ' · incidência por 100 mil habitantes'
              : ' com casos confirmados (notificados), acumulado histórico'}
            {dadosMunicipios.length > itensVisiveisSemScroll ? (
              <> · role para ver todos</>
            ) : null}
          </>
        )}
      </p>

      {modoBairro ? (
        <div
          className="overflow-y-auto overflow-x-hidden pr-1 -mr-1"
          style={{ maxHeight: alturaVisivel }}
        >
          <ResponsiveContainer width="100%" height={alturaGrafico}>
            <BarChart
              layout="vertical"
              data={dadosBairros}
              margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
              barCategoryGap="20%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis
                dataKey="nome"
                type="category"
                width={162}
                interval={0}
                domain={categoriasY}
                allowDuplicatedCategory={false}
                tick={renderTick}
              />
              <Tooltip content={<TooltipPoiBairro />} />
              <Bar dataKey="pois" name="POIs" radius={[0, 4, 4, 0]} barSize={22}>
                {dadosBairros.map((d, i) => (
                  <Cell
                    key={i}
                    fill={
                      d.pois >= maxPois * 0.8
                        ? '#0087a8'
                        : d.pois >= maxPois * 0.5
                          ? '#38bdf8'
                          : d.pois >= maxPois * 0.2
                            ? '#7dd3fc'
                            : '#bae6fd'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div
          className="overflow-y-auto overflow-x-hidden pr-1 -mr-1"
          style={{ maxHeight: alturaVisivel }}
        >
          <ResponsiveContainer width="100%" height={alturaGrafico}>
            <BarChart
              layout="vertical"
              data={dadosMunicipios}
              margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
              barCategoryGap="20%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis
                dataKey="nome"
                type="category"
                width={162}
                interval={0}
                domain={categoriasY}
                allowDuplicatedCategory={false}
                tick={renderTick}
              />
              <Tooltip
                formatter={(v: number, _n: string, item: any) => {
                  const p = item?.payload;
                  if (modoRanking === 'incidencia' && temIncidencia) {
                    return [
                      `${Number(v).toLocaleString('pt-BR', {
                        maximumFractionDigits: 1,
                      })} /100 mil`,
                      'Incidência',
                    ];
                  }
                  return [
                    `${Math.round(v).toLocaleString('pt-BR')} casos`,
                    p?.incidencia != null
                      ? `Casos (${p.incidencia.toLocaleString('pt-BR')}/100 mil)`
                      : 'Casos confirmados',
                  ];
                }}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar
                dataKey="casos"
                name={
                  modoRanking === 'incidencia' && temIncidencia
                    ? 'Incidência /100 mil'
                    : 'Casos confirmados'
                }
                radius={[0, 4, 4, 0]}
                barSize={22}
              >
                {dadosMunicipios.map((d, i) => (
                  <Cell
                    key={i}
                    fill={
                      d.casos >= maxPois * 0.8
                        ? '#f87171'
                        : d.casos >= maxPois * 0.5
                          ? '#fb923c'
                          : d.casos >= maxPois * 0.2
                            ? '#d97706'
                            : '#4ade80'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default ElNinoRankingMunicipios;
