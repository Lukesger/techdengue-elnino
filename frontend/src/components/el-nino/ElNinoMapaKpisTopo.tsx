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
  const poiStore = mun.poi_hectare;
  const poisDoStore =
    poiStore?.total_registros != null &&
    Number.isFinite(Number(poiStore.total_registros))
      ? Number(poiStore.total_registros)
      : null;
  const haDoStore =
    poiStore?.hectares_mapeados != null &&
    Number.isFinite(Number(poiStore.hectares_mapeados)) &&
    Number(poiStore.hectares_mapeados) > 0
      ? Number(poiStore.hectares_mapeados)
      : null;
  const ratioDoStore =
    poiStore?.poi_por_hectare != null &&
    Number.isFinite(Number(poiStore.poi_por_hectare)) &&
    Number(poiStore.poi_por_hectare) > 0
      ? Number(poiStore.poi_por_hectare)
      : null;

  if (hectaresAreaMapeada) {
    const haUni = Number(hectaresAreaMapeada.unificadas) || 0;
    let haBruto = Number(hectaresAreaMapeada.totalBruto) || 0;
    // Se bruto veio igual/zerado, preferir hectares do pré-cache Nest (view POI/ha).
    if ((haBruto <= 0 || Math.abs(haBruto - haUni) < 1e-6) && haDoStore != null) {
      haBruto = haDoStore;
    }

    let totalPois = hectaresAreaMapeada.totalPois ?? null;
    if (!(totalPois != null && totalPois > 0) && poisDoStore != null && poisDoStore > 0) {
      totalPois = poisDoStore;
    }

    const haDensidade = haBruto > 0 ? haBruto : haUni;
    let porHa =
      totalPois != null &&
      Number.isFinite(totalPois) &&
      totalPois > 0 &&
      haDensidade > 0
        ? totalPois / haDensidade
        : null;
    if (porHa == null && ratioDoStore != null) {
      porHa = ratioDoStore;
    }

    if (porHa != null && Number.isFinite(porHa)) {
      return {
        poiHa: porHa,
        hectares: haBruto > 0 ? haBruto : haDensidade,
        totalPois,
        mensagem: null,
      };
    }
    if (haBruto > 0 || haUni > 0) {
      return {
        poiHa: null,
        hectares: haBruto > 0 ? haBruto : haUni,
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

  if (porHa != null && Number.isFinite(porHa) && Number(porHa) > 0) {
    return {
      poiHa: Number(porHa),
      hectares: ha != null && Number.isFinite(ha) ? Number(ha) : null,
      totalPois,
      mensagem: null,
    };
  }
  if (ha != null && Number.isFinite(ha)) {
    return {
      poiHa: null,
      hectares: Number(ha),
      totalPois,
      mensagem: 'sem POI/ha',
    };
  }
  if (totalPois != null && Number.isFinite(totalPois) && totalPois > 0) {
    return {
      poiHa: null,
      hectares: null,
      totalPois: Number(totalPois),
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
            className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 animate-pulse"
          >
            <div className="absolute inset-y-0 left-0 w-[3px] bg-slate-200" />
            <div className="h-3 bg-slate-200 rounded w-1/2 mb-2" />
            <div className="h-6 bg-slate-200 rounded w-1/3 mb-1" />
            <div className="h-3 bg-slate-100 rounded w-3/4" />
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

  const cardBase =
    'group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-12px_rgba(15,23,42,0.18)]';

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-3 gap-3"
      role="list"
      aria-label="Indicadores do mapa de projeção"
    >
      {/* Cobertura */}
      <article
        role="listitem"
        className={`${cardBase} hover:border-[#0087a8]/35`}
      >
        <span
          className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-[#0087a8] to-teal-700 rounded-l-2xl"
          aria-hidden
        />
        <div className="flex items-start justify-between gap-2 pl-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500 leading-tight">
            Cobertura mapeada
          </p>
          <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-[#0087a8]/10 text-[#0087a8] ring-1 ring-inset ring-black/[0.03]">
            <FaMapMarkedAlt className="w-3.5 h-3.5" aria-hidden />
          </div>
        </div>

        {pctMapeadoMun != null ? (
          <div className="mt-2 pl-1.5 space-y-1">
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold tracking-tight text-slate-900 tabular-nums leading-none">
                {fmtPct(pctMapeadoMun).replace('%', '')}
              </span>
              <span className="text-xs font-semibold text-[#006d8a]">%</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-snug">
              do território
              {munCobertura ? ` · ${munCobertura.nome}` : ''}
              {haMapeadosMun != null && haTotalMun != null
                ? ` · ${fmtHa(haMapeadosMun)} de ${fmtHa(haTotalMun)}`
                : ''}
            </p>
            <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#0087a8] to-teal-500 transition-all"
                style={{ width: `${Math.max(0, Math.min(100, pctMapeadoMun))}%` }}
              />
            </div>
            {(pctMapeadoUrbano != null || pctMapeadoRural != null) && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600 pt-0.5">
                {pctMapeadoUrbano != null && (
                  <span>
                    Urbana{' '}
                    <strong className="font-semibold tabular-nums text-slate-800">
                      {fmtPct(pctMapeadoUrbano)}
                    </strong>
                  </span>
                )}
                {pctMapeadoRural != null && (
                  <span>
                    Rural{' '}
                    <strong className="font-semibold tabular-nums text-slate-800">
                      {fmtPct(pctMapeadoRural)}
                    </strong>
                  </span>
                )}
              </div>
            )}
            {areasSidraLoading && pctMapeadoUrbano == null && (
              <p className="text-[11px] text-slate-400">Carregando áreas IBGE…</p>
            )}
          </div>
        ) : munCobertura ? (
          <div className="mt-2 pl-1.5 space-y-0.5">
            <p className="text-sm font-semibold text-slate-800">{munCobertura.nome}</p>
            <p className="text-[11px] text-slate-500 leading-snug">
              {haMapeadosMun != null
                ? `${fmtHa(haMapeadosMun)} mapeados · área total indisponível`
                : 'Percentual indisponível'}
            </p>
          </div>
        ) : (
          <p className="mt-2 pl-1.5 text-[11px] text-slate-500 leading-snug">
            {municipios.length} município{municipios.length !== 1 ? 's' : ''} · selecione no
            mapa para ver a cobertura.
          </p>
        )}
      </article>

      {/* POIs */}
      <article
        role="listitem"
        className={`${cardBase} hover:border-emerald-200`}
      >
        <span
          className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-emerald-400 to-teal-600 rounded-l-2xl"
          aria-hidden
        />
        <div className="flex items-start justify-between gap-2 pl-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500 leading-tight">
            Densidade de POIs
          </p>
          <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-black/[0.03]">
            <FaSeedling className="w-3.5 h-3.5" aria-hidden />
          </div>
        </div>

        {munFocado && poiMunDetalhes ? (
          <div className="mt-2 pl-1.5 space-y-1 min-w-0">
            {poiMunDetalhes.poiHa != null ? (
              <div className="flex items-baseline gap-1 flex-wrap">
                <span className="text-xl font-bold tracking-tight text-slate-900 tabular-nums leading-none">
                  {fmtPoiHa(poiMunDetalhes.poiHa)}
                </span>
                <span className="text-xs font-semibold text-emerald-700">POIs/ha</span>
              </div>
            ) : (
              <p className="text-sm font-semibold text-slate-700">
                {poiMunDetalhes.mensagem ?? '—'}
              </p>
            )}
            <div className="space-y-0.5 text-[11px] text-slate-500">
              {poiMunDetalhes.totalPois != null &&
                Number(poiMunDetalhes.totalPois) > 0 && (
                  <p className="tabular-nums">
                    <span className="font-semibold text-slate-700">
                      {fmt(poiMunDetalhes.totalPois)}
                    </span>{' '}
                    POIs
                    {hectaresAreaMapeada
                      ? ` · bruto ${fmtHa(poiMunDetalhes.hectares)} · unif. ${fmtHa(hectaresAreaMapeada.unificadas)}`
                      : poiMunDetalhes.hectares != null
                        ? ` · ${fmtHa(poiMunDetalhes.hectares)}`
                        : ''}
                  </p>
                )}
              {!poiMunDetalhes.totalPois &&
                (hectaresAreaMapeada ? (
                  <p className="tabular-nums">
                    Bruto {fmtHa(poiMunDetalhes.hectares)} · unif.{' '}
                    {fmtHa(hectaresAreaMapeada.unificadas)}
                  </p>
                ) : (
                  poiMunDetalhes.hectares != null && (
                    <p className="tabular-nums">{fmtHa(poiMunDetalhes.hectares)}</p>
                  )
                ))}
              <p className="text-slate-600 font-medium truncate">{munFocado.nome}</p>
            </div>
          </div>
        ) : (
          <div className="mt-2 pl-1.5 space-y-0.5">
            <p className="text-xl font-bold tracking-tight text-slate-900 tabular-nums leading-none">
              {fmtPoiHa(poiHaContrato(data.poi_hectare_contrato))}
            </p>
            <p className="text-[11px] text-slate-500">
              {poiHaContrato(data.poi_hectare_contrato) != null
                ? 'POIs/ha no escopo'
                : 'Selecione um município no mapa'}
            </p>
          </div>
        )}
      </article>

      {/* Projeção */}
      <article
        role="listitem"
        className={`${cardBase} hover:border-orange-200`}
      >
        <span
          className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-orange-400 to-rose-500 rounded-l-2xl"
          aria-hidden
        />
        <div className="flex items-start justify-between gap-2 pl-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500 leading-tight">
            Projeção de casos
          </p>
          <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-600 ring-1 ring-inset ring-black/[0.03]">
            <FaChartArea className="w-3.5 h-3.5" aria-hidden />
          </div>
        </div>

        <div className="mt-2 pl-1.5 space-y-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xl font-bold tracking-tight text-slate-900 tabular-nums leading-none">
              {fmt(totalMes)}
            </span>
            {mesesRestantes.length > 0 && (
              <span className="text-sm font-semibold text-slate-500 tabular-nums">
                · ~{fmt(totalRestante)} restante
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 leading-snug">
            {mesLabel ?? data.ano_projecao} · {municipios.length} município
            {municipios.length !== 1 ? 's' : ''}
            {labelMesesRestantes ? ` · demais ${labelMesesRestantes}` : ''}
          </p>
        </div>
      </article>
    </div>
  );
};

export default ElNinoMapaKpisTopo;
