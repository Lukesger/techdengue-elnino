import React, { useEffect, useState } from 'react';
import elNinoApi, {
  MapaProjecaoResponse,
  ProjecaoMunicipio,
  type IbgeAreaUrbanaRuralResponse,
} from '@/services/el-nino-api';import { FaChartArea, FaSeedling, FaMapMarkedAlt } from 'react-icons/fa';
import { hectaresDeGeometria } from '@/utils/el-nino/unir-bairros';

interface Props {
  data: MapaProjecaoResponse | null;
  /** Município com foco no mapa (para o card central). Opcional. */
  geocodeSelecionado?: number | null;
  /** Mês alvo selecionado no seletor. */
  mesNumSelecionado: number | null;
  /** Hectares reais do export PostGIS (verba direta) — alinha com o card de cobertura. */
  hectaresAreaMapeada?: {
    totalBruto: number;
    unificadas: number;
    totalPois?: number | null;
  } | null;
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('pt-BR').format(Math.round(n));
}

function fmtPoiHa(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtHa(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)} ha`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function geocodeDeFeatureGeojson(f: GeoJSON.Feature): number {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const raw =
    p.codarea ??
    p.geocode ??
    p.id ??
    p.CD_MUN ??
    p.cd_mun ??
    (typeof f.id === 'string' || typeof f.id === 'number' ? f.id : null);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function areaTotalMunicipioHa(
  geojson: GeoJSON.FeatureCollection | null | undefined,
  geocode: number,
): number | null {
  if (!geojson?.features?.length || !geocode) return null;
  const feature = geojson.features.find(
    (f) => geocodeDeFeatureGeojson(f) === geocode,
  );
  if (!feature?.geometry) return null;
  const ha = hectaresDeGeometria(feature.geometry);
  return ha > 0 ? ha : null;
}

function resolverMunicipioCobertura(
  municipios: ProjecaoMunicipio[],
  geocodeSelecionado?: number | null,
): ProjecaoMunicipio | null {
  if (geocodeSelecionado != null) {
    return municipios.find((m) => m.geocode === geocodeSelecionado) ?? null;
  }
  return municipios.length === 1 ? municipios[0] : null;
}

function hectaresMapeadosMunicipio(
  mun: ProjecaoMunicipio | null,
  hectaresAreaMapeada?: {
    totalBruto: number;
    unificadas: number;
    totalPois?: number | null;
  } | null,
): number | null {
  if (hectaresAreaMapeada?.unificadas != null) {
    return hectaresAreaMapeada.unificadas;
  }
  const ha =
    mun?.poi_hectare?.hectares_mapeados ??
    mun?.hectares?.hectares_mapeados ??
    mun?.pois?.hectares_mapeados ??
    null;
  return ha != null && Number.isFinite(ha) && ha > 0 ? ha : null;
}

function calcularPercentualMapeado(
  haMapeados: number | null,
  haReferencia: number | null,
): number | null {
  if (
    haMapeados == null ||
    haReferencia == null ||
    !Number.isFinite(haMapeados) ||
    !Number.isFinite(haReferencia) ||
    haReferencia <= 0
  ) {
    return null;
  }
  return Math.min(100, (haMapeados / haReferencia) * 100);
}

type DetalhesPoiMunicipio = {
  poiHa: number | null;
  hectares: number | null;
  totalPois: number | null;
  mensagem: string | null;
};

function detalhesPoiMunicipio(
  mun: ProjecaoMunicipio,
  hectaresAreaMapeada?: {
    totalBruto: number;
    unificadas: number;
    totalPois?: number | null;
  } | null,
): DetalhesPoiMunicipio {
  if (hectaresAreaMapeada) {
    const haBruto = hectaresAreaMapeada.totalBruto;
    const totalPois = hectaresAreaMapeada.totalPois ?? null;
    const porHa =
      totalPois != null &&
      Number.isFinite(totalPois) &&
      totalPois > 0 &&
      haBruto > 0
        ? totalPois / haBruto
        : null;

    if (porHa != null && Number.isFinite(porHa)) {
      return {
        poiHa: porHa,
        hectares: haBruto,
        totalPois,
        mensagem: null,
      };
    }
    if (haBruto > 0) {
      return {
        poiHa: null,
        hectares: haBruto,
        totalPois,
        mensagem: 'sem POI/ha',
      };
    }
  }

  const poi = mun.poi_hectare;
  const totalPois = poi?.total_registros ?? null;
  const porHa = poi?.poi_por_hectare ?? null;
  const ha =
    poi?.hectares_mapeados ??
    mun.hectares?.hectares_mapeados ??
    mun.pois?.hectares_mapeados ??
    null;

  if (porHa != null && Number.isFinite(porHa)) {
    return {
      poiHa: porHa,
      hectares: ha != null && Number.isFinite(ha) ? ha : null,
      totalPois,
      mensagem: null,
    };
  }
  if (ha != null && Number.isFinite(ha)) {
    return {
      poiHa: null,
      hectares: ha,
      totalPois,
      mensagem: 'sem POI/ha',
    };
  }
  if (totalPois != null && Number.isFinite(totalPois) && totalPois > 0) {
    return {
      poiHa: null,
      hectares: null,
      totalPois,
      mensagem: 'sem hectares PostGIS',
    };
  }
  return {
    poiHa: null,
    hectares: null,
    totalPois: null,
    mensagem: 'Sem dados de POI/ha',
  };
}

function poiHaContrato(
  poi: MapaProjecaoResponse['poi_hectare_contrato'],
): number | null {
  const n = poi?.poi_por_hectare;
  return n != null && Number.isFinite(n) ? n : null;
}

/**
 * 3 KPIs no topo da página /mapa, equivalentes ao `.mapa-kpis` do
 * `mapa.html`: consórcio + mês atual, POI/hectare do município focado,
 * projeção total geral.
 */
export const ElNinoMapaKpisTopo: React.FC<Props> = ({
  data,
  geocodeSelecionado,
  mesNumSelecionado,
  hectaresAreaMapeada = null,
}) => {
  const municipios = data?.municipios ?? [];
  const munCobertura = resolverMunicipioCobertura(
    municipios,
    geocodeSelecionado,
  );
  const haMapeadosMun = hectaresMapeadosMunicipio(
    munCobertura,
    hectaresAreaMapeada,
  );

  const [areasSidra, setAreasSidra] = useState<IbgeAreaUrbanaRuralResponse | null>(
    null,
  );
  const [areasSidraLoading, setAreasSidraLoading] = useState(false);

  useEffect(() => {
    if (!munCobertura?.geocode) {
      setAreasSidra(null);
      setAreasSidraLoading(false);
      return;
    }
    let cancelado = false;
    setAreasSidraLoading(true);
    elNinoApi
      .getAreaUrbanaRural({ geocode: munCobertura.geocode })
      .then((dados) => {
        if (!cancelado) setAreasSidra(dados);
      })
      .catch(() => {
        if (!cancelado) setAreasSidra(null);
      })
      .finally(() => {
        if (!cancelado) setAreasSidraLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [munCobertura?.geocode]);

  if (!data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse"
          >
            <div className="h-3 bg-gray-200 rounded w-1/2 mb-2" />
            <div className="h-7 bg-gray-200 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  const totalMes =
    mesNumSelecionado != null
      ? municipios.reduce(
          (s, m) =>
            s +
            (m.projecoes.find((p) => p.mesNum === mesNumSelecionado)?.valor ??
              0),
          0,
        )
      : 0;

  const munFocado =
    geocodeSelecionado != null
      ? municipios.find((m) => m.geocode === geocodeSelecionado)
      : null;

  const mesLabel = data.meses.find(
    (m) => m.mesNum === mesNumSelecionado,
  )?.label;

  const mesesRestantes = data.meses.filter(
    (m) => m.mesNum !== mesNumSelecionado,
  );
  const totalRestante =
    mesNumSelecionado != null
      ? mesesRestantes.reduce(
          (s, mes) =>
            s +
            municipios.reduce(
              (acc, m) =>
                acc +
                (m.projecoes.find((p) => p.mesNum === mes.mesNum)?.valor ?? 0),
              0,
            ),
          0,
        )
      : 0;
  const labelMesesRestantes =
    mesesRestantes.length >= 2
      ? `${mesesRestantes[0].label.split('/')[0]}–${mesesRestantes[mesesRestantes.length - 1].label.split('/')[0]}/${data.ano_projecao}`
      : mesesRestantes.length === 1
        ? mesesRestantes[0].label
        : null;

  const poiMunDetalhes = munFocado
    ? detalhesPoiMunicipio(munFocado, hectaresAreaMapeada)
    : null;

  const haTotalGeometria =
    munCobertura != null
      ? areaTotalMunicipioHa(data.geojson, munCobertura.geocode)
      : null;
  const haTotalMun = areasSidra?.areaTotalHa ?? haTotalGeometria;
  const pctMapeadoMun =
    haMapeadosMun != null && haTotalMun != null && haTotalMun > 0
      ? Math.min(100, (haMapeadosMun / haTotalMun) * 100)
      : null;

  const pctMapeadoUrbano = calcularPercentualMapeado(
    haMapeadosMun,
    areasSidra?.areaUrbanaHa ?? null,
  );
  const pctMapeadoRural = calcularPercentualMapeado(
    haMapeadosMun,
    areasSidra?.areaRuralHa ?? null,
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* Card 1 — Cobertura mapeada (% do município) */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">
          <FaMapMarkedAlt className="w-3 h-3 text-[#0087a8]" />
          Cobertura mapeada
        </div>
        {pctMapeadoMun != null ? (
          <div className="space-y-0.5">
            <p className="text-2xl font-bold text-gray-800 tabular-nums leading-tight">
              {fmtPct(pctMapeadoMun)}
            </p>
            <p className="text-xs text-gray-500 leading-snug">
              do território municipal já mapeado
              {munCobertura ? ` · ${munCobertura.nome}` : ''}
            </p>
            {haMapeadosMun != null && haTotalMun != null && (
              <p className="text-xs text-gray-500 tabular-nums leading-snug">
                {fmtHa(haMapeadosMun)} de {fmtHa(haTotalMun)}
              </p>
            )}
            {(pctMapeadoUrbano != null || pctMapeadoRural != null) && (
              <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5">
                {pctMapeadoUrbano != null && (
                  <p className="text-xs text-gray-600 tabular-nums leading-snug">
                    <span className="font-medium">{fmtPct(pctMapeadoUrbano)}</span>{' '}
                    da área urbana mapeada
                    {areasSidra?.areaUrbanaHa != null && (
                      <span className="text-gray-500">
                        {' '}
                        · ref. {fmtHa(areasSidra.areaUrbanaHa)}
                      </span>
                    )}
                  </p>
                )}
                {pctMapeadoRural != null && (
                  <p className="text-xs text-gray-600 tabular-nums leading-snug">
                    <span className="font-medium">{fmtPct(pctMapeadoRural)}</span>{' '}
                    da área rural mapeada
                    {areasSidra?.areaRuralHa != null && (
                      <span className="text-gray-500">
                        {' '}
                        · ref. {fmtHa(areasSidra.areaRuralHa)}
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}
            {areasSidraLoading && pctMapeadoUrbano == null && (
              <p className="text-xs text-gray-400 mt-1">Carregando áreas IBGE…</p>
            )}
          </div>
        ) : munCobertura ? (
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-gray-700">{munCobertura.nome}</p>
            <p className="text-xs text-gray-500 leading-snug">
              {haMapeadosMun != null
                ? `${fmtHa(haMapeadosMun)} mapeados · área total do município indisponível`
                : 'Percentual indisponível — aguardando geometrias ou malha IBGE'}
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500 leading-snug">
            {municipios.length} município{municipios.length !== 1 ? 's' : ''} ·{' '}
            {data.rotulo_conjunto.length > 32
              ? `${data.rotulo_conjunto.slice(0, 32)}…`
              : data.rotulo_conjunto}
            <span className="block mt-1 text-xs">
              Selecione um município no mapa para ver o percentual mapeado.
            </span>
          </p>
        )}
      </div>

      {/* Card 2 — POI's por H */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">
          <FaSeedling className="w-3 h-3 text-emerald-500" />
          POIs por H
        </div>
        {munFocado && poiMunDetalhes ? (
          <div className="space-y-1 min-w-0">
            {poiMunDetalhes.poiHa != null ? (
              <p className="text-xl sm:text-2xl font-bold text-gray-800 leading-tight">
                <span className="tabular-nums">
                  {fmtPoiHa(poiMunDetalhes.poiHa)}
                </span>
                <span className="text-sm font-semibold text-gray-600 ml-1">
                  POIs/ha
                </span>
              </p>
            ) : poiMunDetalhes.mensagem ? (
              <p className="text-sm font-semibold text-gray-700 leading-snug">
                {poiMunDetalhes.mensagem}
              </p>
            ) : null}
            {poiMunDetalhes.hectares != null && (
              <p className="text-sm font-medium text-gray-700 tabular-nums leading-tight">
                {hectaresAreaMapeada ? (
                  <>
                    <span className="text-gray-600">Total bruto:</span>{' '}
                    {fmtHa(poiMunDetalhes.hectares)}
                  </>
                ) : (
                  fmtHa(poiMunDetalhes.hectares)
                )}
              </p>
            )}
            {hectaresAreaMapeada && (
              <p className="text-sm font-medium text-gray-700 tabular-nums leading-tight">
                <span className="text-gray-600">Áreas unificadas:</span>{' '}
                {fmtHa(hectaresAreaMapeada.unificadas)}
              </p>
            )}
            {poiMunDetalhes.totalPois != null &&
              poiMunDetalhes.poiHa == null && (
                <p className="text-sm font-medium text-gray-700 tabular-nums leading-tight">
                  {fmt(poiMunDetalhes.totalPois)} POIs
                </p>
              )}
            <p className="text-xs text-gray-500 leading-tight break-words">
              {munFocado.nome}
            </p>
          </div>
        ) : (
          <>
            <p className="text-2xl font-bold text-gray-800">
              {fmtPoiHa(poiHaContrato(data.poi_hectare_contrato))}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {poiHaContrato(data.poi_hectare_contrato) != null
                ? `POIs/ha no ${data.rotulo_conjunto.length > 28 ? data.rotulo_conjunto.slice(0, 28) + '…' : data.rotulo_conjunto}`
                : 'Selecione um município no mapa'}
            </p>
          </>
        )}
      </div>

      {/* Card 3 — Casos do mês atual + restante do período */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">
          <FaChartArea className="w-3 h-3 text-orange-500" />
          Projeção de casos
        </div>
        <p className="text-2xl font-bold text-gray-800">{fmt(totalMes)}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Casos projetados {mesLabel ?? data.ano_projecao} · {municipios.length}{' '}
          município{municipios.length !== 1 ? 's' : ''}
        </p>
        {mesesRestantes.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <p className="text-xl font-bold text-gray-800">~{fmt(totalRestante)}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {labelMesesRestantes
                ? `Restante ${labelMesesRestantes} (exc. mês atual)`
                : 'Demais meses do período (exc. mês atual)'}
              {' · '}atualiza diariamente
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ElNinoMapaKpisTopo;
