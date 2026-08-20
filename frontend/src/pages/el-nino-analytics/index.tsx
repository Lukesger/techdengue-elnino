import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { MainLayout } from '@/components/layout/MainLayout';
import { BreadcrumbHeader } from '@/components/layout/BreadcrumbHeader';
import { useAuth } from '@/hooks/useAuth';
import { getRedirectRouteByProfile } from '@/utils/getRedirectRouteByProfile';

import elNinoApi, {
  ElNinoEscopo,
  ElNinoKpisResponse,
  AlertaPreditivo,
  ClimaForecast,
  MapaProjecaoResponse,
  SerieConsorcioResponse,
  HistoricoAnual,
} from '@/services/el-nino-api';

import { ElNinoKpiCards } from '@/components/el-nino/ElNinoKpiCards';
import { ElNinoCarrosselMunicipios } from '@/components/el-nino/ElNinoCarrosselMunicipios';
import { ElNinoCausaDengue } from '@/components/el-nino/ElNinoCausaDengue';
import { ElNinoAlertas } from '@/components/el-nino/ElNinoAlertas';
import { ElNinoSerieConsorcio } from '@/components/el-nino/ElNinoSerieConsorcio';
import { ElNinoChuvaConsorcio } from '@/components/el-nino/ElNinoChuvaConsorcio';
import { ElNinoComparativoMensal } from '@/components/el-nino/ElNinoComparativoMensal';
import { ElNinoPerfilMensal } from '@/components/el-nino/ElNinoPerfilMensal';
import { ElNinoMapaProjecao } from '@/components/el-nino/ElNinoMapaProjecao';
import { ElNinoRankingMunicipios } from '@/components/el-nino/ElNinoRankingMunicipios';
import { ElNinoPrevisaoClima } from '@/components/el-nino/ElNinoPrevisaoClima';
import { ElNinoSerieSazonal } from '@/components/el-nino/ElNinoSerieSazonal';
import { ElNinoPosPicoOni } from '@/components/el-nino/ElNinoPosPicoOni';
import { ElNinoHistoricoAnual } from '@/components/el-nino/ElNinoHistoricoAnual';
import { ElNinoGuiaGrafico } from '@/components/el-nino/ElNinoGuiaGrafico';
import {
  ElNinoFiltrosTerritorial,
  FiltrosElNino,
} from '@/components/el-nino/ElNinoFiltrosTerritorial';
import {
  contratoVerbaDiretaDoGeocode,
  contratoVerbaDiretaId,
  deveExibirProjecaoBairros,
} from '@/utils/el-nino/projecao-bairros';
import { ANO_INICIO_PADRAO, anoFimDados } from '@/utils/el-nino/constants';
import { parseMapaProjecaoQuery } from '@/utils/el-nino/mapa-projecao-href';
import {
  acumularCasosConfirmados,
  filtrarMensalPorGeocode,
} from '@/utils/el-nino/graficos-filtros';
import { montarDadosGraficosElNino } from '@/utils/el-nino/montar-dados-graficos';
import { preferirSerieConsorcioRemontada } from '@/utils/el-nino/montar-serie-consorcio';
import {
  agruparContratosParaTemp,
  aplicarTempGrupoNoKpi,
  escolherAmostrasUrs,
  geocodesDasAmostrasUrs,
  mediasTempTodasUrs,
} from '@/utils/el-nino/temperatura-urs';

/** Resolve contrato do filtro: consórcio explícito ou dono do geocode (VD/consórcio). */
function resolverContratoEfetivo(
  consorcioId: number | null,
  geocode: number | null,
  consorcios: Array<{
    id: number;
    eConsorcio?: number;
    municipios: Array<{ geocode: number }>;
  }>,
): number | null {
  if (consorcioId != null && consorcioId > 0) return consorcioId;
  if (geocode == null || !consorcios.length) return null;
  const vd = contratoVerbaDiretaDoGeocode(geocode, consorcios);
  if (vd) return vd.id;
  const cons = consorcios.find((c) =>
    c.municipios.some((m) => Number(m.geocode) === Number(geocode)),
  );
  return cons?.id ?? null;
}

/**
 * Carteiras grandes (gestor) não cabem na querystring e, com contratoId fixo
 * errado, geram 403 (mun fora do contrato) + timeout no overview Nest.
 * Acima deste limite não enviamos geocodes[] — o Nest filtra por contrato/JWT.
 */
const MAX_GEOCODES_NA_QUERY = 40;

/** Consórcio com mais municípios do escopo do usuário (carrega rápido na 1ª pintura). */
function maiorConsorcioDoEscopo(
  escopoGeocodes: number[] | null | undefined,
  consorcios: Array<{
    id: number;
    municipios?: Array<{ geocode: number }>;
  }>,
): number | null {
  const permitidos = new Set(
    (escopoGeocodes ?? []).map(Number).filter((g) => Number.isFinite(g)),
  );
  if (!permitidos.size || !consorcios.length) {
    return consorcios[0] ? Number(consorcios[0].id) : null;
  }
  let bestId: number | null = null;
  let bestN = -1;
  for (const c of consorcios) {
    const n = (c.municipios ?? []).filter((m) =>
      permitidos.has(Number(m.geocode)),
    ).length;
    if (n > bestN) {
      bestN = n;
      bestId = Number(c.id);
    }
  }
  return bestId ?? Number(consorcios[0].id);
}

interface PageState {
  escopo: ElNinoEscopo | null;
  consorcios: any[];
  urs: any[];
  overview: any | null;
  /** KPIs agregados (sem filtro de município). */
  kpis: ElNinoKpisResponse | null;
  /** KPIs específicos por município, pré-carregados. Chave = geocode. */
  kpisPorMunicipio: Record<number, ElNinoKpisResponse>;
  /** Clima atual/previsão por município (carrossel). */
  climaPorMunicipio: Record<number, ClimaForecast>;
  alertas: AlertaPreditivo[];
  serieConsorcio: SerieConsorcioResponse | null;
  comparativo: any | null;
  municipios: any | null;
  mapaProjecao: MapaProjecaoResponse | null;
  historico: HistoricoAnual[];
  causaDengue: { titulo: string; pontos: string[] } | null;
}

const INITIAL_STATE: PageState = {
  escopo: null,
  consorcios: [],
  urs: [],
  overview: null,
  kpis: null,
  kpisPorMunicipio: {},
  climaPorMunicipio: {},
  alertas: [],
  serieConsorcio: null,
  comparativo: null,
  municipios: null,
  mapaProjecao: null,
  historico: [],
  causaDengue: null,
};

const anoAtual = new Date().getFullYear();
const FILTROS_INICIAIS: FiltrosElNino = {
  consorcioId: null,
  ursId: null,
  geocode: null,
  geocodes: null,
  anoInicio: ANO_INICIO_PADRAO,
  anoFim: anoFimDados(),
};

/** Persistência do filtro entre navegações (ex.: ida/volta do mapa). */
const FILTROS_STORAGE_KEY = 'el-nino-filtros-territorial';

function chaveFiltrosStorage(userId?: string | null): string {
  const id = userId != null && String(userId).trim() ? String(userId).trim() : '';
  return id ? `${FILTROS_STORAGE_KEY}:${id}` : FILTROS_STORAGE_KEY;
}

/** Descarta geocode/lista fora do escopo JWT (evita 403 ao trocar de usuário). */
function sanitizarFiltrosNoEscopo(
  filtros: FiltrosElNino,
  escopo: { isGlobal?: boolean; geocodes?: number[] | null },
): FiltrosElNino {
  if (escopo.isGlobal) return filtros;
  const permitidos = new Set(
    (escopo.geocodes ?? [])
      .map(Number)
      .filter((g) => Number.isFinite(g) && g > 0),
  );
  if (!permitidos.size) {
    return { ...filtros, geocode: null, geocodes: null };
  }

  const geocodeOk =
    filtros.geocode != null && permitidos.has(Number(filtros.geocode))
      ? Number(filtros.geocode)
      : null;
  const geocodesFiltrados = (filtros.geocodes ?? [])
    .map(Number)
    .filter((g) => permitidos.has(g));
  const carteiraGrande = permitidos.size > MAX_GEOCODES_NA_QUERY;
  const fallback = carteiraGrande ? null : ([...permitidos][0] ?? null);

  let geocodes: number[] | null = null;
  if (!carteiraGrande) {
    geocodes = geocodesFiltrados.length
      ? geocodesFiltrados
      : [...permitidos];
  }

  return {
    ...filtros,
    geocode: geocodeOk ?? fallback,
    geocodes,
  };
}

function persistirFiltros(filtros: FiltrosElNino, userId?: string | null) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      chaveFiltrosStorage(userId),
      JSON.stringify(filtros),
    );
  } catch {
    /* ignore */
  }
}

function SecaoAnalytics({
  titulo,
  descricao,
  children,
  className = '',
  id,
}: {
  titulo?: string;
  descricao?: string;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`space-y-4 scroll-mt-28 ${className}`.trim()}>
      {titulo ? (
        <header className="flex flex-col gap-0.5 border-b border-slate-200/80 pb-3">
          <h2 className="text-[13px] font-semibold text-slate-800 uppercase tracking-[0.06em]">
            {titulo}
          </h2>
          {descricao ? (
            <p className="text-xs text-slate-500 leading-relaxed max-w-3xl">
              {descricao}
            </p>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

const NAV_SECOES = [
  { id: 'secao-indicadores', rotulo: 'Resumo' },
  { id: 'secao-territorio', rotulo: 'Território' },
  { id: 'secao-tendencia', rotulo: 'Tendência' },
  { id: 'secao-elnino', rotulo: 'El Niño' },
  { id: 'secao-padroes', rotulo: 'Padrões' },
] as const;

function NavSecoesPagina({
  incluirRanking,
}: {
  incluirRanking: boolean;
}) {
  const itens = incluirRanking
    ? [
        NAV_SECOES[0],
        NAV_SECOES[1],
        { id: 'secao-ranking', rotulo: 'Ranking' as const },
        ...NAV_SECOES.slice(2),
      ]
    : [...NAV_SECOES];

  return (
    <nav
      aria-label="Seções da análise"
      className="sticky top-16 z-20 -mx-1 px-1 py-1.5 bg-gray-50/95 backdrop-blur-sm border-b border-slate-200/60"
    >
      <ul className="flex flex-wrap gap-1.5">
        {itens.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-medium text-slate-600 bg-white border border-slate-200/90 hover:border-[#0087a8]/40 hover:text-[#0087a8] transition-colors"
            >
              {item.rotulo}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function carregarFiltrosSalvos(userId?: string | null): FiltrosElNino {
  if (typeof window === 'undefined') return FILTROS_INICIAIS;
  try {
    const key = chaveFiltrosStorage(userId);
    let raw = window.sessionStorage.getItem(key);
    // Migração: chave legada sem userId (só se ainda não houver chave do usuário)
    if (!raw && userId) {
      raw = window.sessionStorage.getItem(FILTROS_STORAGE_KEY);
    }
    if (!raw) return FILTROS_INICIAIS;
    const salvo = JSON.parse(raw) as Partial<FiltrosElNino>;
    const fimMax = anoFimDados();
    const merged: FiltrosElNino = { ...FILTROS_INICIAIS, ...salvo };
    let anoFim = Number(merged.anoFim);
    let anoInicio = Number(merged.anoInicio);
    if (!Number.isFinite(anoFim)) anoFim = fimMax;
    if (!Number.isFinite(anoInicio)) anoInicio = ANO_INICIO_PADRAO;
    // Default antigo era ano corrente − 1; alinha ao ano com dados nos gráficos.
    if (
      anoInicio === ANO_INICIO_PADRAO &&
      anoFim === new Date().getFullYear() - 1
    ) {
      anoFim = fimMax;
    }
    anoFim = Math.min(Math.max(anoFim, ANO_INICIO_PADRAO), fimMax);
    anoInicio = Math.min(Math.max(anoInicio, ANO_INICIO_PADRAO), anoFim);
    // Lista gigante salva (carteira gestora) travava overview — descarta.
    const geocodes =
      Array.isArray(merged.geocodes) &&
      merged.geocodes.length > 0 &&
      merged.geocodes.length <= MAX_GEOCODES_NA_QUERY
        ? merged.geocodes
        : null;
    return { ...merged, anoInicio, anoFim, geocodes };
  } catch {
    return FILTROS_INICIAIS;
  }
}

export default function ElNinoAnalyticsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isHydrated } = useAuth();
  const [filtros, setFiltros] = useState<FiltrosElNino>(FILTROS_INICIAIS);
  /** Geocode do filtro global aplicado — usado no mapa (não muda com o carrossel). */
  const [geocodeFiltroMapa, setGeocodeFiltroMapa] = useState<number | null>(null);
  const [mapaVerbaDireta, setMapaVerbaDireta] = useState<MapaProjecaoResponse | null>(null);
  const [loadingMapaVerba, setLoadingMapaVerba] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingSecundario, setLoadingSecundario] = useState(false);
  const [loadingClima, setLoadingClima] = useState(false);
  const [tempGrupoIndex, setTempGrupoIndex] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [state, setState] = useState<PageState>(INITIAL_STATE);
  /** Invalida respostas de load antigo ao trocar de contrato/município. */
  const cargaSeqRef = useRef(0);

  const inicioPagina = getRedirectRouteByProfile(user);

  /** Visão gerencial só para escopo global e sem filtro territorial. */
  const modoVisaoGerencialTodos = useMemo(
    () =>
      Boolean(state.escopo?.isGlobal) &&
      filtros.consorcioId == null &&
      filtros.ursId == null &&
      geocodeFiltroMapa == null,
    [
      state.escopo?.isGlobal,
      filtros.consorcioId,
      filtros.ursId,
      geocodeFiltroMapa,
    ],
  );

  /** Contrato real do escopo — nunca assume 19. */
  const contratoEfetivo = useMemo(
    () =>
      resolverContratoEfetivo(
        filtros.consorcioId,
        geocodeFiltroMapa ?? filtros.geocode,
        state.consorcios,
      ),
    [
      filtros.consorcioId,
      geocodeFiltroMapa,
      filtros.geocode,
      state.consorcios,
    ],
  );

  /**
   * Parâmetros de API — contratoId do escopo selecionado.
   * Carteira grande: não envia geocodes[] (Nest usa contrato ∩ JWT).
   */
  const paramsApi = useMemo(() => {
    const geocodes = filtros.geocodes ?? undefined;
    const geocodesNaQuery =
      !modoVisaoGerencialTodos &&
      geocodes?.length &&
      geocodes.length <= MAX_GEOCODES_NA_QUERY
        ? geocodes
        : undefined;
    // Com geocode único, trava o contrato dono desse mun (evita 403).
    const contratoParaGeocode =
      geocodeFiltroMapa != null
        ? resolverContratoEfetivo(null, geocodeFiltroMapa, state.consorcios)
        : null;
    const contratoId = modoVisaoGerencialTodos
      ? undefined
      : (contratoParaGeocode ?? contratoEfetivo ?? undefined);

    return {
      ...(modoVisaoGerencialTodos
        ? { visao: 'todos' as const }
        : { contratoId }),
      ...(geocodesNaQuery ? { geocodes: geocodesNaQuery } : {}),
      ano_inicio: filtros.anoInicio,
      ano_fim: filtros.anoFim,
      ...(geocodeFiltroMapa != null ? { geocode: geocodeFiltroMapa } : {}),
    };
  }, [
    modoVisaoGerencialTodos,
    contratoEfetivo,
    filtros.geocodes,
    filtros.anoInicio,
    filtros.anoFim,
    geocodeFiltroMapa,
    state.consorcios,
  ]);

  /** @deprecated use paramsApi — mantido para compatibilidade interna */
  const queryParams = paramsApi;

  /** Chave estável para invalidar pré-carga de KPIs quando consórcio/URS/período muda. */
  const cargaKey = useMemo(
    () =>
      `${modoVisaoGerencialTodos ? 'todos' : (contratoEfetivo ?? '')}|${(filtros.geocodes ?? []).sort().join(',')}|${filtros.anoInicio}|${filtros.anoFim}`,
    [modoVisaoGerencialTodos, contratoEfetivo, filtros.geocodes, filtros.anoInicio, filtros.anoFim],
  );

  const municipiosCarrossel = useMemo(() => {
    if (!state.escopo) return [];
    if (filtros.geocodes?.length) {
      return state.escopo.municipios.filter((m) =>
        filtros.geocodes!.includes(m.geocode),
      );
    }
    return state.escopo.municipios;
  }, [state.escopo, filtros.geocodes]);

  /**
   * Carrossel de KPIs por município: consórcio / gestor / admin com filtro
   * de contrato (não na visão gerencial agregada de todos).
   */
  const carrosselKpisAtivo =
    !modoVisaoGerencialTodos && municipiosCarrossel.length > 1;

  const overlayTempConsorcio =
    geocodeFiltroMapa == null &&
    filtros.geocode == null &&
    (modoVisaoGerencialTodos || filtros.consorcioId != null);

  const amostrasTempConsorcio = useMemo(() => {
    if (!overlayTempConsorcio) return [];
    const grupos = agruparContratosParaTemp(state.consorcios, {
      contratoId: modoVisaoGerencialTodos ? null : filtros.consorcioId,
    });
    const geocodesPermitidos = (
      state.overview?.municipios ??
      state.escopo?.municipios ??
      []
    )
      .map((m: { geocode?: number }) => Number(m.geocode))
      .filter((g: number) => Number.isFinite(g) && g > 0);
    return escolherAmostrasUrs(grupos, {
      geocodesPermitidos: geocodesPermitidos.length ? geocodesPermitidos : null,
      municipiosComCoords: state.overview?.municipios ?? [],
    });
  }, [
    overlayTempConsorcio,
    modoVisaoGerencialTodos,
    filtros.consorcioId,
    state.consorcios,
    state.overview?.municipios,
    state.escopo?.municipios,
  ]);

  const tempsConsorcioLive = useMemo(
    () => mediasTempTodasUrs(amostrasTempConsorcio, state.climaPorMunicipio),
    [amostrasTempConsorcio, state.climaPorMunicipio],
  );

  /** KPIs efetivos exibidos: específicos do município ativo ou agregado. */
  const kpisExibidos = useMemo<ElNinoKpisResponse | null>(() => {
    const base =
      filtros.geocode != null
        ? state.kpisPorMunicipio[filtros.geocode] ?? state.kpis
        : state.kpis;
    if (!base) return null;

    const clima =
      filtros.geocode != null
        ? state.climaPorMunicipio[filtros.geocode]
        : null;
    const nomeMun = municipiosCarrossel.find(
      (m) => m.geocode === filtros.geocode,
    )?.nome;

    const listaBase = Array.isArray(base.kpis)
      ? base.kpis
      : Array.isArray(base)
        ? base
        : [];
    if (
      !listaBase.length &&
      !Array.isArray(base.kpis) &&
      !Array.isArray(base)
    ) {
      return null;
    }
    const kpis = listaBase.map((k) => ({ ...k }));
    let mudou = false;

    const tempGrupo =
      overlayTempConsorcio && tempsConsorcioLive.length
        ? tempsConsorcioLive[
            tempGrupoIndex % tempsConsorcioLive.length
          ]
        : null;
    if (tempGrupo) {
      const next = aplicarTempGrupoNoKpi(kpis, tempGrupo);
      kpis.splice(0, kpis.length, ...next);
      mudou = true;
    }

    const temp = clima?.atual?.temperatura_c;
    if (!tempGrupo && temp != null && temp > 0) {
      const idx = kpis.findIndex((k) => /temperatura/i.test(k.titulo));
      if (idx >= 0) {
        kpis[idx] = {
          ...kpis[idx],
          titulo: 'Temperatura atual',
          valor: `${String(temp).replace('.', ',')} °C`,
          subtitulo: clima?.cidade
            ? clima.cidade
            : nomeMun
              ? nomeMun
              : 'Clima atual (Open-Meteo)',
        };
        mudou = true;
      }
    }

    const umidade = clima?.atual?.umidade_pct;
    if (umidade != null && Number.isFinite(umidade)) {
      const idx = kpis.findIndex((k) => /umidade/i.test(k.titulo));
      if (idx >= 0) {
        kpis[idx] = {
          ...kpis[idx],
          titulo: 'Umidade relativa',
          valor: `${Math.round(umidade)} %`,
          subtitulo: nomeMun
            ? `${nomeMun} · fator de proliferação do vetor`
            : 'fator de proliferação do vetor',
        };
        mudou = true;
      }
    }

    // Casos: reforça subtítulo com o município do carrossel quando houver.
    if (filtros.geocode != null && nomeMun) {
      const idx = kpis.findIndex((k) => /casos/i.test(k.titulo));
      if (idx >= 0) {
        const sub = kpis[idx].subtitulo || '';
        if (!sub.toLowerCase().includes(nomeMun.toLowerCase())) {
          kpis[idx] = {
            ...kpis[idx],
            subtitulo: sub ? `${nomeMun} · ${sub}` : nomeMun,
          };
          mudou = true;
        }
      }
    }

    return mudou || !Array.isArray(base.kpis) ? { kpis } : base;
  }, [
    filtros.geocode,
    state.kpisPorMunicipio,
    state.kpis,
    state.climaPorMunicipio,
    municipiosCarrossel,
    overlayTempConsorcio,
    tempsConsorcioLive,
    tempGrupoIndex,
  ]);

  const geocodeClima = filtros.geocode ?? geocodeFiltroMapa;

  const climaExibido = useMemo<ClimaForecast | null>(() => {
    if (geocodeClima == null) return null;
    return state.climaPorMunicipio[geocodeClima] ?? null;
  }, [geocodeClima, state.climaPorMunicipio]);

  const loadingKpisMunicipio =
    filtros.geocode != null &&
    !state.kpisPorMunicipio[filtros.geocode] &&
    !state.kpis &&
    (loading || loadingSecundario);

  const loadingClimaMunicipio =
    geocodeClima != null &&
    !state.climaPorMunicipio[geocodeClima] &&
    loadingClima;

  const subtitulo = useMemo(() => {
    if (!state.escopo) return null;
    const periodo = `${filtros.anoInicio}–${filtros.anoFim}`;
    return `${periodo} (${filtros.anoFim - filtros.anoInicio + 1} anos) · Dengue × Clima × El Niño (NOAA)`;
  }, [state.escopo, filtros.anoInicio, filtros.anoFim]);

  const nomeMunicipioFiltro = useMemo(() => {
    if (geocodeFiltroMapa == null) return null;
    const gc = geocodeFiltroMapa;
    return (
      municipiosCarrossel.find((m) => m.geocode === gc)?.nome ??
      state.escopo?.municipios.find((m) => m.geocode === gc)?.nome ??
      state.consorcios
        .flatMap((c) => c.municipios ?? [])
        .find((m) => Number(m.geocode) === gc)?.nome ??
      null
    );
  }, [geocodeFiltroMapa, municipiosCarrossel, state.escopo, state.consorcios]);

  const dadosGraficos = useMemo(
    () =>
      montarDadosGraficosElNino({
        overview: state.overview,
        historicoFallback: state.historico,
        comparativoMensalFallback: state.comparativo?.mensal,
        escopoNMunicipios: state.escopo?.municipios?.length ?? 0,
        geocodeGraficos: geocodeFiltroMapa ?? filtros.geocode,
        anoInicio: filtros.anoInicio,
        anoFim: filtros.anoFim,
        nomeMunicipio: nomeMunicipioFiltro,
      }),
    [
      state.overview,
      state.comparativo,
      state.historico,
      state.escopo,
      geocodeFiltroMapa,
      filtros.geocode,
      filtros.anoInicio,
      filtros.anoFim,
      nomeMunicipioFiltro,
    ],
  );

  const graficosLoading =
    loading ||
    ((geocodeFiltroMapa ?? filtros.geocode) != null &&
      !(dadosGraficos?.mensalMun?.length) &&
      (loadingSecundario || !state.overview));
  const graficosProps = {
    anoInicio: filtros.anoInicio,
    anoFim: filtros.anoFim,
    mesFim: dadosGraficos?.mesFim ?? 12,
    nMunicipios: dadosGraficos?.nMunicipios ?? 0,
    nomeMunicipio: dadosGraficos?.nomeMunicipio ?? null,
    loading: graficosLoading,
  };

  const temHistoricoAnual = (dadosGraficos?.historicoAnual?.length ?? 0) > 0;
  const exibirHistoricoAnual = temHistoricoAnual || graficosLoading;

  const remountTick =
    state.overview?.atualizado_em ??
    `${dadosGraficos?.serie?.length ?? 0}-${dadosGraficos?.mesFim ?? ''}`;

  const serieConsorcioExibida = useMemo(
    () =>
      preferirSerieConsorcioRemontada(
        state.overview,
        state.serieConsorcio,
        {
          rotulo:
            dadosGraficos?.nomeMunicipio ||
            state.escopo?.rotulo ||
            state.serieConsorcio?.rotulo_conjunto ||
            'Escopo',
          nMunicipios:
            dadosGraficos?.nMunicipios ??
            ((geocodeFiltroMapa ?? filtros.geocode) != null
              ? 1
              : state.escopo?.municipios?.length ?? 0),
          geocode:
            geocodeFiltroMapa != null
              ? Number(geocodeFiltroMapa)
              : filtros.geocode != null
                ? Number(filtros.geocode)
                : undefined,
          contratoId: contratoEfetivo ?? 0,
        },
      ) as SerieConsorcioResponse | null,
    [
      state.overview,
      state.serieConsorcio,
      state.escopo,
      dadosGraficos?.nomeMunicipio,
      dadosGraficos?.nMunicipios,
      geocodeFiltroMapa,
      filtros.geocode,
      contratoEfetivo,
    ],
  );

  const contratoVerbaAtivo = useMemo(
    () =>
      contratoVerbaDiretaId(
        geocodeFiltroMapa,
        filtros.consorcioId,
        state.consorcios,
      ),
    [geocodeFiltroMapa, filtros.consorcioId, state.consorcios],
  );

  /** Geocode efetivo para POIs por bairro — segue o carrossel quando ativo. */
  const geocodeRankingBairros = filtros.geocode ?? geocodeFiltroMapa;

  const modoMapaBairro = useMemo(
    () =>
      deveExibirProjecaoBairros(
        geocodeFiltroMapa,
        filtros.consorcioId,
        state.consorcios,
      ),
    [geocodeFiltroMapa, filtros.consorcioId, state.consorcios],
  );

  const mapaExibido = useMemo(() => {
    if (modoMapaBairro) return mapaVerbaDireta;
    return state.mapaProjecao;
  }, [modoMapaBairro, mapaVerbaDireta, state.mapaProjecao]);

  /**
   * Ranking de municípios: só em visão multi-município (consórcio / gerencial).
   * Com 1 município ou filtro municipal, o gráfico não faz sentido.
   */
  const exibirRankingMunicipios = useMemo(() => {
    if (geocodeFiltroMapa != null || filtros.geocode != null) return false;
    const lista =
      state.municipios?.ranking ?? state.municipios?.municipios ?? [];
    const nMapa = mapaExibido?.municipios?.length ?? 0;
    return Math.max(lista.length, nMapa) > 1;
  }, [
    geocodeFiltroMapa,
    filtros.geocode,
    state.municipios,
    mapaExibido?.municipios?.length,
  ]);

  const municipioCasosFiltro = useMemo(() => {
    const gc = geocodeFiltroMapa ?? filtros.geocode ?? null;
    const totalMensal = acumularCasosConfirmados(
      filtrarMensalPorGeocode(dadosGraficos?.mensalMun ?? [], gc),
    );

    const lista =
      state.municipios?.ranking ?? state.municipios?.municipios ?? [];
    const hit =
      gc != null
        ? lista.find((m: { geocode?: number }) => Number(m.geocode) === Number(gc))
        : lista.length === 1
          ? lista[0]
          : undefined;

    const dfMun = state.overview?.df_municipios ?? [];
    const ovHit =
      gc != null
        ? dfMun.find((m: { geocode?: number }) => Number(m.geocode) === Number(gc))
        : dfMun.length === 1
          ? dfMun[0]
          : undefined;

    const totalFallback = Number(
      hit?.casos_notificados ?? ovHit?.casos_notificados ?? 0,
    );
    const total = totalMensal > 0 ? totalMensal : totalFallback;

    if (total <= 0 && !hit && !ovHit) return null;

    return {
      geocode: Number(gc ?? hit?.geocode ?? ovHit?.geocode ?? 0),
      nome:
        hit?.nome ??
        ovHit?.municipio ??
        ovHit?.nome ??
        dadosGraficos?.nomeMunicipio,
      municipio: hit?.municipio ?? ovHit?.municipio,
      casos_notificados: total,
      casos_estimados: hit?.casos_estimados ?? ovHit?.casos_estimados,
    };
  }, [
    geocodeFiltroMapa,
    filtros.geocode,
    dadosGraficos?.mensalMun,
    dadosGraficos?.nomeMunicipio,
    state.municipios,
    state.overview,
  ]);

  /** Exige sessão válida antes de qualquer chamada ao proxy (JWT obrigatório). */
  useEffect(() => {
    if (!isHydrated) return;
    if (!isAuthenticated) {
      router.replace('/auth/login');
    }
  }, [isHydrated, isAuthenticated, router]);

  /** Restaura filtros do sessionStorage após hidratação (evita mismatch SSR/client). */
  useEffect(() => {
    if (!isHydrated) return;
    const salvos = carregarFiltrosSalvos(user?.id);
    setFiltros(salvos);
    setGeocodeFiltroMapa(salvos.geocode);
  }, [isHydrated, user?.id]);

  /**
   * URL (?contratoId=42 / ?geocode=…) tem prioridade — ex.: voltar do mapa AMVAP.
   * Persistimos no sessionStorage para o filtro territorial continuar ativo.
   */
  useEffect(() => {
    if (!router.isReady) return;
    const parsed = parseMapaProjecaoQuery(router.query);
    if (parsed.visao === 'todos') {
      setGeocodeFiltroMapa(null);
      setFiltros((f) => ({
        ...f,
        consorcioId: null,
        ursId: null,
        geocode: null,
        geocodes: null,
      }));
      try {
        window.sessionStorage.removeItem(chaveFiltrosStorage(user?.id));
        window.sessionStorage.removeItem(FILTROS_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return;
    }

    if (parsed.contratoId == null && parsed.geocode == null) return;

    setFiltros((f) => {
      const next: FiltrosElNino = {
        ...f,
        consorcioId: parsed.contratoId ?? f.consorcioId,
        geocode: parsed.geocode ?? f.geocode,
        ursId: null,
      };
      persistirFiltros(next, user?.id);
      return next;
    });
    if (parsed.geocode != null) {
      setGeocodeFiltroMapa(parsed.geocode);
    }
    // Query keys explícitas — evita reload a cada mudança irrelevante de router.query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    router.isReady,
    router.query.contratoId,
    router.query.contrato_id,
    router.query.geocode,
    router.query.visao,
    user?.id,
  ]);

  /** Recarrega projeção do município de verba direta ao aplicar o filtro. */
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    if (!modoMapaBairro || geocodeFiltroMapa == null) {
      setMapaVerbaDireta(null);
      return;
    }

    let cancelado = false;
    setLoadingMapaVerba(true);

    elNinoApi
      .getMapaProjecao({
        contratoId: contratoVerbaAtivo ?? contratoEfetivo ?? undefined,
        geocode: geocodeFiltroMapa,
      })
      .then((data) => {
        if (!cancelado) setMapaVerbaDireta(data);
      })
      .catch(() => {
        if (!cancelado) setMapaVerbaDireta(null);
      })
      .finally(() => {
        if (!cancelado) setLoadingMapaVerba(false);
      });

    return () => {
      cancelado = true;
    };
  }, [
    isHydrated,
    isAuthenticated,
    modoMapaBairro,
    geocodeFiltroMapa,
    contratoVerbaAtivo,
    contratoEfetivo,
    filtros.consorcioId,
  ]);

  // ─── Carregamento de listas auxiliares (escopo JWT + consórcios + URS) ────
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;

    elNinoApi
      .getEscopo()
      .then((escopo) => {
        setState((s) => ({ ...s, escopo }));
        // Global: não força gerencial se já houver filtro (URL, sessionStorage ou UI).
        if (escopo.isGlobal) {
          setFiltros((f) => {
            const temFoco =
              f.consorcioId != null ||
              f.ursId != null ||
              f.geocode != null ||
              (f.geocodes?.length ?? 0) > 0;
            if (temFoco) return f;
            return {
              ...f,
              consorcioId: null,
              ursId: null,
              geocode: null,
              geocodes: null,
            };
          });
        } else if (escopo.geocodes?.length) {
          const carteiraGrande =
            escopo.geocodes.length > MAX_GEOCODES_NA_QUERY;
          // Sempre clamp ao JWT — evita 403 com filtro de outro usuário/município.
          setFiltros((f) => {
            const limpo = sanitizarFiltrosNoEscopo(
              carteiraGrande ? { ...f, geocodes: null } : f,
              escopo,
            );
            persistirFiltros(limpo, user?.id);
            return limpo;
          });
          setGeocodeFiltroMapa((atual) => {
            const permitidos = new Set(escopo.geocodes.map(Number));
            if (atual != null && permitidos.has(Number(atual))) return atual;
            return carteiraGrande ? null : Number(escopo.geocodes[0]);
          });
        }
      })
      .catch(() => {
        /* escopo principal tenta novamente em carregarDados */
      });
    elNinoApi
      .getConsorcios()
      .then((r) => setState((s) => ({ ...s, consorcios: r.consorcios ?? [] })))
      .catch(() => {
        /* silencioso — usuário pode não ter acesso */
      });
    elNinoApi
      .getUrs()
      .then((r) => setState((s) => ({ ...s, urs: r.urs ?? [] })))
      .catch(() => {
        /* silencioso */
      });
  }, [isHydrated, isAuthenticated, user?.id]);

  /**
   * Não-global: fixa o consórcio/contrato do escopo do usuário.
   * Carteira multi-contrato: escolhe o consórcio com mais mun no escopo.
   */
  useEffect(() => {
    const escopo = state.escopo;
    const consorcios = state.consorcios;
    if (!escopo || escopo.isGlobal || !consorcios.length) return;

    const carteiraGrande =
      (escopo.geocodes?.length ?? 0) > MAX_GEOCODES_NA_QUERY;

    setFiltros((f) => {
      const limpo = sanitizarFiltrosNoEscopo(f, escopo);
      const geocodeAtual =
        limpo.geocode ??
        (carteiraGrande ? null : escopo.geocodes?.[0] ?? null);
      const consorcioValido =
        f.consorcioId != null &&
        consorcios.some((c) => Number(c.id) === Number(f.consorcioId));

      let consorcioId = consorcioValido ? f.consorcioId : null;
      if (consorcioId == null) {
        if (consorcios.length === 1) {
          consorcioId = Number(consorcios[0].id);
        } else if (geocodeAtual != null) {
          consorcioId = resolverContratoEfetivo(
            null,
            geocodeAtual,
            consorcios,
          );
        } else {
          consorcioId = maiorConsorcioDoEscopo(escopo.geocodes, consorcios);
        }
      }

      const contrato = consorcios.find(
        (c) => Number(c.id) === Number(consorcioId),
      );
      const geocode =
        geocodeAtual ??
        (escopo.tipo === 'municipio' && !carteiraGrande
          ? escopo.geocodes?.[0] ?? null
          : contrato?.municipios?.length === 1
            ? Number(contrato.municipios[0].geocode)
            : null);

      const geocodesDoContrato =
        contrato?.municipios?.map((m: { geocode: number }) =>
          Number(m.geocode),
        ) ?? null;
      const geocodesNoEscopo = geocodesDoContrato?.filter((g) =>
        (escopo.geocodes ?? []).includes(g),
      );
      const geocodesEscopoPequeno =
        (escopo.geocodes?.length ?? 0) > 0 &&
        (escopo.geocodes?.length ?? 0) <= MAX_GEOCODES_NA_QUERY
          ? escopo.geocodes
          : null;
      let geocodes: number[] | null = limpo.geocodes?.length
        ? limpo.geocodes
        : null;
      if (!geocodes) {
        if (escopo.tipo === 'municipio') {
          geocodes = geocodesEscopoPequeno;
        } else if (
          geocodesNoEscopo?.length &&
          geocodesNoEscopo.length <= MAX_GEOCODES_NA_QUERY
        ) {
          geocodes = geocodesNoEscopo;
        } else {
          geocodes = geocodesEscopoPequeno;
        }
      }

      if (
        f.consorcioId === consorcioId &&
        f.geocode === geocode &&
        JSON.stringify(f.geocodes) === JSON.stringify(geocodes)
      ) {
        return f;
      }

      return {
        ...f,
        consorcioId,
        ursId: null,
        geocode,
        geocodes,
      };
    });

    setGeocodeFiltroMapa((atual) => {
      const permitidos = new Set((escopo.geocodes ?? []).map(Number));
      if (atual != null && permitidos.has(Number(atual))) return atual;
      if (carteiraGrande) return null;
      return escopo.geocodes?.[0] ?? null;
    });
  }, [state.escopo, state.consorcios]);

  // ─── Carregamento principal ───────────────────────────────────────────────
  // Escopo JWT já veio no boot. Aqui: overview libera a 1ª pintura; KPIs/mapa/
  // série sobem em paralelo (sem waterfall gerencial de 3 ondas).
  const carregarDados = useCallback(async () => {
    if (!state.escopo) return;

    const seq = ++cargaSeqRef.current;
    const params = paramsApi;
    const aindaValido = () => cargaSeqRef.current === seq;

    setErro(null);
    setLoading(true);
    setLoadingSecundario(true);

    const aplicarSecundario = (
      partial: Partial<PageState> & {
        historico?: any[];
      },
    ) => {
      if (!aindaValido()) return;
      setState((s) => ({
        ...s,
        ...partial,
        historico: partial.historico ?? s.historico,
      }));
    };

    const hidratarDoOverview = (overview: any) => {
      const alertas = Array.isArray(overview?.alertas)
        ? (overview.alertas as AlertaPreditivo[])
        : [];
      const comparativo = overview?.elnino ?? null;
      const historico =
        overview?.df_historico_ponderado?.length
          ? overview.df_historico_ponderado
          : overview?.df_historico ?? [];

      let municipios: PageState['municipios'] = null;
      const mapaDf = overview?.mapa_df;
      if (Array.isArray(mapaDf) && mapaDf.length) {
        const popMap = new Map<number, number>(
          (overview?.resumo_escopo?.populacoes ?? []).map(
            (p: { geocode: number; populacao: number }) => [
              Number(p.geocode),
              Number(p.populacao) || 0,
            ],
          ),
        );
        const ranking = mapaDf.map((m: Record<string, unknown>) => {
          const geocode = Number(m.geocode);
          const populacao = popMap.get(geocode) ?? 0;
          const casos =
            Number(m.casos_notificados) > 0
              ? Number(m.casos_notificados)
              : Number(m.casos_estimados) || 0;
          const incidencia_100k =
            populacao > 0
              ? Math.round((casos / populacao) * 100_000 * 10) / 10
              : null;
          return { ...m, populacao, incidencia_100k };
        });
        municipios = {
          municipios: overview?.municipios_ibge ?? [],
          ranking,
        };
      }

      return { alertas, comparativo, historico, municipios };
    };

    try {
      // Dispara tudo junto — overview só decide a 1ª pintura.
      const overviewP = elNinoApi.getOverview(params);
      const kpisP = elNinoApi.getKpis(params);
      const mapaP = elNinoApi.getMapaProjecao(params);
      const serieP = elNinoApi.getSerieConsorcio(params);

      const overviewRes = await Promise.allSettled([overviewP]);
      if (!aindaValido()) {
        // Outra carga assumiu o controle — não deixa loading preso aqui.
        return;
      }

      if (overviewRes[0]!.status === 'rejected') {
        throw overviewRes[0]!.reason;
      }

      const overview = overviewRes[0]!.value;
      const hidratado = hidratarDoOverview(overview);

      setState((s) => ({
        ...s,
        overview,
        causaDengue: overview?.causa_dengue ?? null,
        alertas: hidratado.alertas.length ? hidratado.alertas : s.alertas,
        comparativo: hidratado.comparativo ?? s.comparativo,
        municipios: hidratado.municipios ?? s.municipios,
        historico: hidratado.historico,
      }));
      setLoading(false);

      // KPIs assim que chegarem (não esperam o mapa pesado).
      kpisP
        .then((kpis) => {
          if (!aindaValido()) return;
          const geocodeKpi =
            params.geocode != null ? Number(params.geocode) : null;
          setState((s) => ({
            ...s,
            kpis,
            ...(geocodeKpi != null && Number.isFinite(geocodeKpi)
              ? {
                  kpisPorMunicipio: {
                    ...s.kpisPorMunicipio,
                    [geocodeKpi]: kpis,
                  },
                }
              : {}),
          }));
        })
        .catch(() => {
          /* KPIs opcionais na 1ª pintura */
        });

      const [mapaRes, serieRes] = await Promise.allSettled([mapaP, serieP]);
      if (!aindaValido()) return;

      aplicarSecundario({
        mapaProjecao:
          mapaRes.status === 'fulfilled' ? mapaRes.value : null,
        serieConsorcio:
          serieRes.status === 'fulfilled' ? serieRes.value : null,
      });
    } catch (err: any) {
      if (!aindaValido()) return;
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        'Erro ao carregar dados El Niño.';
      setErro(msg);
      setLoading(false);
    } finally {
      if (aindaValido()) {
        setLoading(false);
        setLoadingSecundario(false);
      }
    }
    // Escopo entra via early-return; o efeito abaixo dispara quando escopoCarregado muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsApi]);

  /** Escopo JWT já resolvido — dispara overview/mapa (gerencial usa visao=todos). */
  const escopoCarregado = state.escopo != null;

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !escopoCarregado) return;
    carregarDados();
  }, [carregarDados, isHydrated, isAuthenticated, escopoCarregado]);

  /**
   * Pré-carrega KPIs por município em paralelo após o escopo carregar.
   * Permite que o carrossel rotacione localmente sem disparar requests.
   */
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    if (!state.escopo || modoVisaoGerencialTodos) return;
    const municipiosAlvo = municipiosCarrossel;
    if (municipiosAlvo.length <= 1) return;

    let cancelado = false;
    setState((s) => ({ ...s, kpisPorMunicipio: {} }));
    (async () => {
      const resultados = await Promise.allSettled(
        municipiosAlvo.map((m) =>
          elNinoApi.getKpis({
            contratoId:
              resolverContratoEfetivo(null, m.geocode, state.consorcios) ??
              contratoEfetivo ??
              undefined,
            geocode: m.geocode,
            ano_inicio: filtros.anoInicio,
            ano_fim: filtros.anoFim,
          }),
        ),
      );
      if (cancelado) return;
      const mapa: Record<number, ElNinoKpisResponse> = {};
      resultados.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          mapa[municipiosAlvo[i].geocode] = r.value;
        }
      });
      setState((s) => ({ ...s, kpisPorMunicipio: mapa }));
    })();

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.escopo, cargaKey, carrosselKpisAtivo]);

  /** Pré-carrega clima atual (Open-Meteo) para os municípios do carrossel. */
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    if (!state.escopo || modoVisaoGerencialTodos) return;
    const alvo = municipiosCarrossel;
    if (alvo.length <= 1) return;

    let cancelado = false;
    setState((s) => ({ ...s, climaPorMunicipio: {} }));
    setLoadingClima(true);

    (async () => {
      const resultados = await Promise.allSettled(
        alvo.map((m) =>
          elNinoApi.getClima({
            contratoId:
              resolverContratoEfetivo(null, m.geocode, state.consorcios) ??
              contratoEfetivo ??
              undefined,
            geocode: m.geocode,
            ano: 'previsao',
          }),
        ),
      );
      if (cancelado) return;
      const mapa: Record<number, ClimaForecast> = {};
      resultados.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          mapa[alvo[i].geocode] = r.value;
        }
      });
      setState((s) => ({ ...s, climaPorMunicipio: mapa }));
      setLoadingClima(false);
    })();

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.escopo, cargaKey, carrosselKpisAtivo, state.overview?.atualizado_em]);

  /** Clima amostrado por consórcio (visão gerencial / contrato sem município). */
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    if (!overlayTempConsorcio) return;
    const geocodes = geocodesDasAmostrasUrs(amostrasTempConsorcio).filter(
      (gc) => !state.climaPorMunicipio[gc],
    );
    if (!geocodes.length) return;

    let cancelado = false;
    (async () => {
      const resultados = await Promise.allSettled(
        geocodes.map((gc) =>
          elNinoApi.getClima({
            geocode: gc,
            ano: 'previsao',
            ...(modoVisaoGerencialTodos
              ? { visao: 'todos' as const }
              : contratoEfetivo != null
                ? { contratoId: contratoEfetivo }
                : {}),
          }),
        ),
      );
      if (cancelado) return;
      const mapa: Record<number, ClimaForecast> = {};
      resultados.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          mapa[geocodes[i]] = r.value;
        }
      });
      if (!Object.keys(mapa).length) return;
      setState((s) => ({
        ...s,
        climaPorMunicipio: { ...s.climaPorMunicipio, ...mapa },
      }));
    })();

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isHydrated,
    isAuthenticated,
    overlayTempConsorcio,
    amostrasTempConsorcio,
    modoVisaoGerencialTodos,
    contratoEfetivo,
    cargaKey,
  ]);

  useEffect(() => {
    setTempGrupoIndex(0);
  }, [amostrasTempConsorcio]);

  useEffect(() => {
    if (!overlayTempConsorcio || tempsConsorcioLive.length <= 1) return;
    const id = setInterval(() => {
      setTempGrupoIndex((i) => i + 1);
    }, 5000);
    return () => clearInterval(id);
  }, [overlayTempConsorcio, tempsConsorcioLive.length]);

  /** Inicia o carrossel no 1º município do escopo (sem alterar o filtro do mapa). */
  useEffect(() => {
    if (!carrosselKpisAtivo) return;
    if (filtros.geocode != null) return;
    const ordenados = [...municipiosCarrossel].sort((a, b) =>
      a.nome.localeCompare(b.nome, 'pt-BR'),
    );
    const primeiro = ordenados[0]?.geocode;
    if (primeiro == null) return;
    setFiltros((f) =>
      f.geocode == null ? { ...f, geocode: primeiro } : f,
    );
  }, [carrosselKpisAtivo, municipiosCarrossel, filtros.geocode]);

  /** Clima sob demanda quando o carrossel aponta para município ainda não em cache. */
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    const geocode = filtros.geocode ?? geocodeFiltroMapa;
    if (geocode == null || state.climaPorMunicipio[geocode]) return;

    let cancelado = false;
    setLoadingClima(true);
    elNinoApi
      .getClima({
        contratoId: contratoEfetivo ?? undefined,
        geocode,
        ano: 'previsao',
      })
      .then((clima) => {
        if (cancelado) return;
        setState((s) => ({
          ...s,
          climaPorMunicipio: { ...s.climaPorMunicipio, [geocode]: clima },
        }));
      })
      .catch(() => {
        /* silencioso */
      })
      .finally(() => {
        if (!cancelado) setLoadingClima(false);
      });

    return () => {
      cancelado = true;
    };
  }, [
    isHydrated,
    isAuthenticated,
    contratoEfetivo,
    filtros.geocode,
    geocodeFiltroMapa,
    filtros.consorcioId,
    cargaKey,
    state.climaPorMunicipio,
    state.overview?.atualizado_em,
  ]);

  /** Busca sob demanda quando o carrossel aponta para um município ainda não em cache. */
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    const geocode = filtros.geocode;
    if (geocode == null || state.kpisPorMunicipio[geocode]) return;

    let cancelado = false;
    elNinoApi
      .getKpis({
        contratoId: contratoEfetivo ?? undefined,
        geocode,
        ano_inicio: filtros.anoInicio,
        ano_fim: filtros.anoFim,
      })
      .then((kpis) => {
        if (cancelado) return;
        setState((s) => ({
          ...s,
          kpisPorMunicipio: { ...s.kpisPorMunicipio, [geocode]: kpis },
        }));
      })
      .catch(() => {
        /* silencioso — skeleton permanece até nova tentativa */
      });

    return () => {
      cancelado = true;
    };
  }, [
    isHydrated,
    isAuthenticated,
    contratoEfetivo,
    filtros.geocode,
    filtros.consorcioId,
    filtros.anoInicio,
    filtros.anoFim,
    cargaKey,
    state.kpisPorMunicipio,
  ]);

  if (!isHydrated || !isAuthenticated) {
    return null;
  }

  return (
    <>
      <Head>
        <title>El Niño Analytics — TechDengue</title>
      </Head>
      <MainLayout>
        <BreadcrumbHeader
          items={[
            { label: 'Principal', href: inicioPagina },
            { label: 'El Niño Analytics' },
          ]}
        />

        <div className="p-3 sm:p-5 lg:p-6 pt-20 space-y-10 max-w-[88rem] mx-auto">
          {/* Erro */}
          {erro && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              {erro}
            </div>
          )}

          {/* Contexto educativo */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.04 }}
          >
            <ElNinoCausaDengue causa={state.causaDengue} loading={loading} />
          </motion.div>

          {/* Resumo / KPIs */}
          <SecaoAnalytics
            id="secao-indicadores"
            titulo="Resumo"
            descricao="Indicadores do escopo filtrado e relação entre clima, El Niño e dengue."
          >
            <div className="space-y-4">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                key={filtros.geocode ?? 'agregado'}
              >
                <ElNinoKpiCards
                  kpis={kpisExibidos?.kpis ?? []}
                  loading={loading || loadingKpisMunicipio}
                />
              </motion.div>
            </div>
          </SecaoAnalytics>

          {/* Filtros — acima da visão municipal */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <ElNinoFiltrosTerritorial
              mesclarHeader
              subtitulo={subtitulo}
              mapaQuery={
                modoVisaoGerencialTodos
                  ? { visao: 'todos' }
                  : {
                      contratoId: contratoEfetivo,
                      geocode: geocodeFiltroMapa,
                    }
              }
              escopo={state.escopo}
              consorcios={state.consorcios}
              urs={state.urs}
              valor={filtros}
              onAplicar={(f) => {
                let next = { ...f };
                const contrato = state.consorcios.find(
                  (c) => c.id === next.consorcioId,
                );
                if (
                  Number(contrato?.eConsorcio) === 0 &&
                  contrato?.municipios?.length === 1
                ) {
                  next = {
                    ...next,
                    geocode: next.geocode ?? contrato.municipios[0].geocode,
                  };
                }
                if (next.geocode != null && next.consorcioId == null) {
                  const dono = resolverContratoEfetivo(
                    null,
                    next.geocode,
                    state.consorcios,
                  );
                  if (dono != null) next = { ...next, consorcioId: dono };
                }
                setFiltros(next);
                setGeocodeFiltroMapa(next.geocode);
                persistirFiltros(next, user?.id);
              }}
              loading={loading}
            />
          </motion.div>

          {contratoEfetivo == null &&
            !state.escopo?.isGlobal &&
            geocodeFiltroMapa != null && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-900">
              Selecione um <strong>consórcio</strong> nos filtros e clique em Aplicar para
              carregar os dados deste município.
            </div>
          )}

          {/* Carrossel de KPIs — consórcio / gestor / admin com vários municípios */}
          {state.escopo && carrosselKpisAtivo && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.08 }}
            >
              <ElNinoCarrosselMunicipios
                municipios={municipiosCarrossel}
                geocodeSelecionado={filtros.geocode}
                intervaloMs={5000}
                onGeocodeMudou={(gc) =>
                  setFiltros((s) => ({ ...s, geocode: gc }))
                }
              />
            </motion.div>
          )}
          {/* Navegação rápida entre blocos */}
          <NavSecoesPagina incluirRanking={exibirRankingMunicipios} />

          {/* Território: mapa / visão municipal + alertas */}
          <SecaoAnalytics
            id="secao-territorio"
            titulo="Território e alertas"
            descricao="Risco projetado no escopo e alertas que pedem ação — confirmados e projeção ficam separados."
          >
            <motion.div
              className="rounded-2xl border border-slate-200/80 bg-slate-50/40 p-2 sm:p-2.5 shadow-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
            >
              <div className="grid grid-cols-1 xl:grid-cols-5 gap-2.5 xl:items-start">
                <div className="w-full xl:col-span-3 min-w-0">
                  <ElNinoMapaProjecao
                    key={`painel-${remountTick}-${geocodeFiltroMapa ?? 'escopo'}`}
                    data={mapaExibido}
                    loading={
                      (loadingSecundario && !state.mapaProjecao) ||
                      loadingMapaVerba
                    }
                    geocodeFiltro={geocodeFiltroMapa}
                    consorcioId={filtros.consorcioId}
                    consorcios={state.consorcios}
                    municipioCasos={municipioCasosFiltro}
                  />
                </div>

                <aside
                  aria-labelledby="el-nino-alertas-titulo"
                  className="relative w-full xl:col-span-2 min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-sm flex flex-col max-h-[min(28rem,70vh)] xl:sticky xl:top-28 overflow-hidden"
                >
                  <ElNinoGuiaGrafico chave="alertas" />
                  <header className="shrink-0 px-3 py-2.5 border-b border-slate-100 bg-slate-50/80 pr-11">
                    <div className="flex items-center justify-between gap-2">
                      <h3
                        id="el-nino-alertas-titulo"
                        className="text-sm font-semibold text-slate-800"
                      >
                        Alertas preditivos
                      </h3>
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 tabular-nums">
                        {state.alertas.length}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                      INMET · Chuva · Calor · El Niño · Infodengue
                    </p>
                  </header>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5">
                    <ElNinoAlertas
                      alertas={state.alertas}
                      loading={loadingSecundario && !state.alertas.length}
                    />
                  </div>
                </aside>
              </div>
            </motion.div>
          </SecaoAnalytics>

          {/* 3 — Ranking territorial (visão multi-município) */}
          {exibirRankingMunicipios && (
            <SecaoAnalytics
              id="secao-ranking"
              titulo="Ranking de municípios"
              descricao="Comparação entre municípios do escopo — priorize quem concentra mais risco."
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.17 }}
              >
                <ElNinoRankingMunicipios
                  municipios={
                    state.municipios?.ranking ??
                    state.municipios?.municipios ??
                    []
                  }
                  geocodeFiltro={geocodeRankingBairros}
                  consorcioId={filtros.consorcioId}
                  consorcios={state.consorcios}
                  mapaData={mapaExibido}
                  loading={loadingSecundario && !state.municipios}
                />
              </motion.div>
            </SecaoAnalytics>
          )}

          {/* 4 — Tendência temporal + clima */}
          <SecaoAnalytics
            id="secao-tendencia"
            titulo="Tendência e clima"
            descricao="Série de casos com projeção, chuva observada e previsão local quando houver município selecionado."
          >
            <motion.div
              className="space-y-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.19 }}
            >
              <ElNinoSerieConsorcio
                key={`serie-${remountTick}`}
                data={serieConsorcioExibida}
                loading={loadingSecundario && !serieConsorcioExibida}
              />

              <div className="space-y-4">
                <ElNinoChuvaConsorcio
                  key={`chuva-${remountTick}`}
                  data={serieConsorcioExibida}
                  serieHistorica={dadosGraficos?.serie}
                  anoInicio={filtros.anoInicio}
                  anoFim={filtros.anoFim}
                  loading={loadingSecundario && !serieConsorcioExibida}
                />
                {(geocodeClima != null ||
                  loadingClimaMunicipio ||
                  climaExibido) && (
                  <ElNinoPrevisaoClima
                    key={`clima-${geocodeClima ?? 'sem-geocode'}-${remountTick}`}
                    clima={climaExibido}
                    loading={loadingClimaMunicipio}
                  />
                )}
              </div>
            </motion.div>
          </SecaoAnalytics>

          {/* 5 — El Niño: histórico + comparativos */}
          <SecaoAnalytics
            id="secao-elnino"
            titulo="El Niño no tempo"
            descricao="Ocupação mensal do ONI por ano, comparação com/sem El Niño e sazonalidade dos casos."
          >
            <motion.div
              className="space-y-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {exibirHistoricoAnual ? (
                <ElNinoHistoricoAnual
                  key={`hist-${remountTick}`}
                  historico={dadosGraficos?.historicoAnual}
                  oniMensal={dadosGraficos?.oniMensal}
                  serie={dadosGraficos?.serie}
                  {...graficosProps}
                />
              ) : null}

              <div className="space-y-4">
                <ElNinoComparativoMensal
                  key={`comp-${remountTick}`}
                  serie={dadosGraficos?.serie}
                  oniMensal={dadosGraficos?.oniMensal}
                  {...graficosProps}
                />
                <ElNinoSerieSazonal
                  key={`saz-${remountTick}`}
                  mensalMun={dadosGraficos?.mensalMun}
                  serieFallback={dadosGraficos?.serie}
                  {...graficosProps}
                />
              </div>
            </motion.div>
          </SecaoAnalytics>

          {/* 6 — Padrões mensais e resposta pós-pico */}
          <SecaoAnalytics
            id="secao-padroes"
            titulo="Padrões e resposta"
            descricao="Perfil mensal de casos/clima e comportamento da dengue após o pico do ONI."
          >
            <motion.div
              className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.21 }}
            >
              <ElNinoPerfilMensal
                key={`perfil-${remountTick}`}
                mensalMun={
                  dadosGraficos?.mensalMunCompleto ?? dadosGraficos?.mensalMun
                }
                nMunicipios={graficosProps.nMunicipios}
                nomeMunicipio={graficosProps.nomeMunicipio}
                loading={graficosProps.loading}
              />
              <ElNinoPosPicoOni
                key={`pospico-${remountTick}`}
                serie={dadosGraficos?.serieCompleta ?? dadosGraficos?.serie}
                oniMensal={
                  dadosGraficos?.oniCompleto ?? dadosGraficos?.oniMensal
                }
                nMunicipios={graficosProps.nMunicipios}
                nomeMunicipio={graficosProps.nomeMunicipio}
                loading={graficosProps.loading}
                mesFim={12}
              />
            </motion.div>
          </SecaoAnalytics>

        </div>
      </MainLayout>
    </>
  );
}
