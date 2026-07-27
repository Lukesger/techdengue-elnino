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
  SerieMensal,
} from '@/services/el-nino-api';

import { ElNinoHeaderLegenda } from '@/components/el-nino/ElNinoHeaderLegenda';
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
import {
  filtrarMensalPorAnos,
  filtrarMensalPorGeocode,
  filtrarOniPorAnos,
  filtrarSerieMesAno,
  mensalMunParaSerieMensal,
  mesclarClimaHistoricoEmMensal,
  periodoFiltro,
  resolverMesFimSerie,
} from '@/utils/el-nino/graficos-filtros';

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

function carregarFiltrosSalvos(): FiltrosElNino {
  if (typeof window === 'undefined') return FILTROS_INICIAIS;
  try {
    const raw = window.sessionStorage.getItem(FILTROS_STORAGE_KEY);
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
    return { ...merged, anoInicio, anoFim };
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
   * Parâmetros de API — sempre envia contratoId do escopo selecionado.
   * Sem contrato resolvido, não carrega overview/série (evita default ICISMEP).
   */
  const paramsApi = useMemo(
    () => ({
      ...(modoVisaoGerencialTodos
        ? { visao: 'todos' as const }
        : { contratoId: contratoEfetivo ?? undefined }),
      ...(modoVisaoGerencialTodos ? {} : { geocodes: filtros.geocodes ?? undefined }),
      ano_inicio: filtros.anoInicio,
      ano_fim: filtros.anoFim,
      ...(geocodeFiltroMapa != null ? { geocode: geocodeFiltroMapa } : {}),
    }),
    [
      modoVisaoGerencialTodos,
      contratoEfetivo,
      filtros.geocodes,
      filtros.anoInicio,
      filtros.anoFim,
      geocodeFiltroMapa,
    ],
  );

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

  /** KPIs efetivos exibidos: específicos do município ativo ou agregado. */
  const kpisExibidos = useMemo<ElNinoKpisResponse | null>(() => {
    const base =
      filtros.geocode != null
        ? state.kpisPorMunicipio[filtros.geocode] ?? null
        : state.kpis;
    if (!base) return null;

    const clima =
      filtros.geocode != null
        ? state.climaPorMunicipio[filtros.geocode]
        : null;
    const temp = clima?.atual?.temperatura_c;
    if (temp == null || temp <= 0) return base;

    const kpis = base.kpis.map((k) => ({ ...k }));
    const idx = kpis.findIndex((k) => /temperatura/i.test(k.titulo));
    if (idx < 0) return base;

    const valor = `${String(temp).replace('.', ',')} °C`;
    const nomeMun = municipiosCarrossel.find(
      (m) => m.geocode === filtros.geocode,
    )?.nome;
    const subtitulo = clima?.cidade
      ? `${clima.cidade} · clima atual`
      : nomeMun
        ? `${nomeMun} · clima atual`
        : 'Clima atual (Open-Meteo)';

    kpis[idx] = {
      ...kpis[idx],
      titulo: 'Temperatura Atual',
      valor,
      subtitulo,
    };
    return { kpis };
  }, [
    filtros.geocode,
    state.kpisPorMunicipio,
    state.kpis,
    state.climaPorMunicipio,
    municipiosCarrossel,
  ]);

  const climaExibido = useMemo<ClimaForecast | null>(() => {
    if (filtros.geocode == null) return null;
    return state.climaPorMunicipio[filtros.geocode] ?? null;
  }, [filtros.geocode, state.climaPorMunicipio]);

  const loadingKpisMunicipio =
    filtros.geocode != null && !state.kpisPorMunicipio[filtros.geocode];

  const loadingClimaMunicipio =
    filtros.geocode != null &&
    !state.climaPorMunicipio[filtros.geocode] &&
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

  const dadosGraficos = useMemo(() => {
    const ov = state.overview;
    if (!ov) return null;

    const geocodeGraficos = geocodeFiltroMapa ?? filtros.geocode;
    const anoInicio = filtros.anoInicio;
    const anoFim = filtros.anoFim;

    const mensalFiltrado = filtrarMensalPorGeocode(
      ov.df_mensal_mun ?? [],
      geocodeGraficos,
    );
    let mensalMun = filtrarMensalPorAnos(
      mesclarClimaHistoricoEmMensal(
        mensalFiltrado,
        (ov.clima_historico ?? []) as Array<Record<string, unknown>>,
        geocodeGraficos,
      ),
      anoInicio,
      anoFim,
    );

    const serieAgregada: SerieMensal[] =
      ov.df_serie_ponderada?.length > 0
        ? ov.df_serie_ponderada
        : ov.df_serie ?? [];

    /**
     * Com geocode: preferir linhas municipais. Se o overview trouxe histórico
     * mas df_mensal_mun veio vazio/descasado, reaproveita df_serie (1 município
     * no escopo) em vez de zerar comparativo/sazonal/pós-pico.
     */
    let serieBruta: SerieMensal[];
    if (geocodeGraficos != null) {
      if (mensalMun.length) {
        serieBruta = mensalMunParaSerieMensal(mensalMun);
      } else if (serieAgregada.length) {
        serieBruta = serieAgregada;
        mensalMun = filtrarMensalPorAnos(
          serieAgregada.map((r) => ({
            ...r,
            geocode: Number(geocodeGraficos),
          })) as Array<Record<string, unknown>>,
          anoInicio,
          anoFim,
        );
      } else {
        serieBruta = [];
      }
    } else {
      serieBruta = serieAgregada;
    }

    const mesFimDados =
      ov.mes_fim ??
      ov.mes_fim_consolidado ??
      resolverMesFimSerie(serieBruta, anoFim, 12);
    const { anoIni, mesIni, anoFim: af, mesFim: mf } = periodoFiltro(
      anoInicio,
      anoFim,
      mesFimDados,
    );
    const serie = filtrarSerieMesAno(serieBruta, anoIni, mesIni, af, mf);
    let oniMensal = filtrarOniPorAnos(ov.oni_mensal ?? [], anoInicio, anoFim);

    // Fallback: monta ONI a partir da própria série mensal (quando oni_mensal falha).
    if (!oniMensal.length && serie.length) {
      oniMensal = serie
        .filter((r) => r.ONI != null && Number.isFinite(Number(r.ONI)))
        .map((r) => ({
          ano: Number(r.Ano),
          mes: Number(r.MesNum),
          oni: Number(r.ONI),
        }));
    }

    const nMunicipios =
      geocodeGraficos != null
        ? 1
        : ov.municipios?.length ?? state.escopo?.municipios?.length ?? 0;

    const historicoBruto: HistoricoAnual[] =
      (ov.df_historico_ponderado?.length
        ? ov.df_historico_ponderado
        : ov.df_historico) ??
      state.historico ??
      [];
    const historicoAnual = historicoBruto.filter(
      (h) => h.Ano >= anoInicio && h.Ano <= anoFim,
    );

    return {
      serie,
      mensalMun,
      oniMensal,
      comparativoMensal:
        ov.elnino?.comparativo_mensal ?? state.comparativo?.mensal ?? [],
      historicoAnual,
      mesFim: mesFimDados,
      nMunicipios,
      nomeMunicipio: nomeMunicipioFiltro,
    };
  }, [
    state.overview,
    state.comparativo,
    state.historico,
    state.escopo,
    geocodeFiltroMapa,
    filtros.geocode,
    filtros.anoInicio,
    filtros.anoFim,
    nomeMunicipioFiltro,
  ]);

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
    if (geocodeFiltroMapa == null) return null;
    const gc = Number(geocodeFiltroMapa);
    const lista =
      state.municipios?.ranking ?? state.municipios?.municipios ?? [];
    const hit = lista.find((m: { geocode?: number }) => Number(m.geocode) === gc);
    if (hit?.casos_notificados != null) return hit;

    const dfMun = state.overview?.df_municipios ?? [];
    const ov = dfMun.find((m: { geocode?: number }) => Number(m.geocode) === gc);
    if (ov) {
      return {
        geocode: gc,
        nome: ov.municipio ?? ov.nome,
        municipio: ov.municipio,
        casos_notificados: ov.casos_notificados ?? 0,
        casos_estimados: ov.casos_estimados,
      };
    }

    return hit ?? null;
  }, [geocodeFiltroMapa, state.municipios, state.overview]);

  /** Exige sessão válida antes de qualquer chamada ao proxy (JWT obrigatório). */
  useEffect(() => {
    if (!isHydrated) return;
    if (!isAuthenticated) {
      router.replace('/auth/login');
    }
  }, [isHydrated, isAuthenticated, router]);

  /** Restaura filtros do sessionStorage após hidratação (evita mismatch SSR/client). */
  useEffect(() => {
    const salvos = carregarFiltrosSalvos();
    setFiltros(salvos);
    setGeocodeFiltroMapa(salvos.geocode);
  }, []);

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
    filtros.consorcioId,
  ]);

  // ─── Carregamento de listas auxiliares (escopo JWT + consórcios + URS) ────
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;

    elNinoApi
      .getEscopo()
      .then((escopo) => {
        setState((s) => ({ ...s, escopo }));
        if (!escopo.isGlobal && escopo.geocodes?.length) {
          const g = escopo.geocodes[0];
          setGeocodeFiltroMapa((atual) => atual ?? g);
          setFiltros((f) => ({
            ...f,
            geocode: f.geocode ?? g,
            geocodes: f.geocodes?.length ? f.geocodes : escopo.geocodes,
          }));
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
  }, [isHydrated, isAuthenticated]);

  /**
   * Não-global: fixa o consórcio/contrato do escopo do usuário.
   * Evita cair em "Todos — visão gerencial" com consorcioId null.
   */
  useEffect(() => {
    const escopo = state.escopo;
    const consorcios = state.consorcios;
    if (!escopo || escopo.isGlobal || !consorcios.length) return;

    setFiltros((f) => {
      const geocodeAtual = f.geocode ?? escopo.geocodes?.[0] ?? null;
      const consorcioValido =
        f.consorcioId != null &&
        consorcios.some((c) => Number(c.id) === Number(f.consorcioId));

      let consorcioId = consorcioValido ? f.consorcioId : null;
      if (consorcioId == null) {
        if (consorcios.length === 1) {
          consorcioId = Number(consorcios[0].id);
        } else if (geocodeAtual != null) {
          consorcioId =
            resolverContratoEfetivo(null, geocodeAtual, consorcios) ??
            Number(consorcios[0].id);
        } else {
          consorcioId = Number(consorcios[0].id);
        }
      }

      const contrato = consorcios.find((c) => Number(c.id) === Number(consorcioId));
      const geocode =
        geocodeAtual ??
        (escopo.tipo === 'municipio'
          ? escopo.geocodes?.[0] ?? null
          : contrato?.municipios?.length === 1
            ? Number(contrato.municipios[0].geocode)
            : null);

      const geocodes =
        f.geocodes?.length
          ? f.geocodes
          : escopo.tipo === 'municipio'
            ? escopo.geocodes
            : contrato?.municipios?.map((m) => Number(m.geocode)) ??
              escopo.geocodes ??
              null;

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
      if (atual != null) return atual;
      return escopo.geocodes?.[0] ?? null;
    });
  }, [state.escopo, state.consorcios]);

  // ─── Carregamento principal ───────────────────────────────────────────────
  const carregarDados = useCallback(async () => {
    const seq = ++cargaSeqRef.current;
    const params = paramsApi;
    const gerencial = 'visao' in params && params.visao === 'todos';
    const aindaValido = () => cargaSeqRef.current === seq;

    setErro(null);
    setLoading(true);

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

    try {
      if (gerencial) {
        // Visão gerencial: overview primeiro (payload pesado agregado), KPIs em paralelo.
        const [escopoRes, overviewRes] = await Promise.allSettled([
          elNinoApi.getEscopo(params),
          elNinoApi.getOverview(params),
        ]);

        if (!aindaValido()) return;

        if (
          escopoRes.status === 'rejected' &&
          overviewRes.status === 'rejected'
        ) {
          throw overviewRes.reason || escopoRes.reason;
        }

        const escopo =
          escopoRes.status === 'fulfilled' ? escopoRes.value : null;
        const overview =
          overviewRes.status === 'fulfilled' ? overviewRes.value : null;

        setState((s) => ({
          ...s,
          escopo,
          overview,
          causaDengue: overview?.causa_dengue ?? null,
        }));
        setLoading(false);
        setLoadingSecundario(true);

        elNinoApi
          .getKpis(params)
          .then((kpis) => {
            if (!aindaValido()) return;
            setState((s) => ({ ...s, kpis }));
          })
          .catch(() => {
            /* KPIs opcionais na 1ª pintura */
          });

        const [alertasResp, comparativoResp, munResp] =
          await Promise.allSettled([
            elNinoApi.getAlertas(params),
            elNinoApi.getComparativo(params),
            elNinoApi.getMunicipios(params),
          ]);

        if (!aindaValido()) return;

        aplicarSecundario({
          alertas:
            alertasResp.status === 'fulfilled'
              ? (alertasResp.value.alertas ?? [])
              : [],
          comparativo:
            comparativoResp.status === 'fulfilled'
              ? comparativoResp.value
              : null,
          municipios: munResp.status === 'fulfilled' ? munResp.value : null,
          historico:
            overview?.df_historico_ponderado?.length
              ? overview.df_historico_ponderado
              : overview?.df_historico ?? [],
        });

        const [serieResp, mapaResp] = await Promise.allSettled([
          elNinoApi.getSerieConsorcio(params),
          elNinoApi.getMapaProjecao(params),
        ]);

        if (!aindaValido()) return;

        aplicarSecundario({
          serieConsorcio:
            serieResp.status === 'fulfilled' ? serieResp.value : null,
          mapaProjecao:
            mapaResp.status === 'fulfilled' ? mapaResp.value : null,
        });
        return;
      }

      const [escopoRes, kpisRes, overviewRes] = await Promise.allSettled([
        elNinoApi.getEscopo(params),
        elNinoApi.getKpis(params),
        elNinoApi.getOverview(params),
      ]);

      if (!aindaValido()) return;

      if (
        escopoRes.status === 'rejected' &&
        overviewRes.status === 'rejected'
      ) {
        const err = overviewRes.reason || escopoRes.reason;
        throw err;
      }

      const escopo =
        escopoRes.status === 'fulfilled' ? escopoRes.value : null;
      const kpis = kpisRes.status === 'fulfilled' ? kpisRes.value : null;
      const overview =
        overviewRes.status === 'fulfilled' ? overviewRes.value : null;

      setState((s) => ({
        ...s,
        escopo,
        kpis,
        overview,
        causaDengue: overview?.causa_dengue ?? null,
      }));
      setLoading(false);

      setLoadingSecundario(true);
      const [
        alertasResp,
        serieResp,
        comparativoResp,
        munResp,
        mapaResp,
      ] = await Promise.allSettled([
        elNinoApi.getAlertas(params),
        elNinoApi.getSerieConsorcio(params),
        elNinoApi.getComparativo(params),
        elNinoApi.getMunicipios(params),
        elNinoApi.getMapaProjecao(params),
      ]);

      if (!aindaValido()) return;

      aplicarSecundario({
        alertas:
          alertasResp.status === 'fulfilled'
            ? (alertasResp.value.alertas ?? [])
            : [],
        serieConsorcio:
          serieResp.status === 'fulfilled' ? serieResp.value : null,
        comparativo:
          comparativoResp.status === 'fulfilled'
            ? comparativoResp.value
            : null,
        municipios: munResp.status === 'fulfilled' ? munResp.value : null,
        mapaProjecao:
          mapaResp.status === 'fulfilled' ? mapaResp.value : null,
        historico:
          overview?.df_historico_ponderado?.length
            ? overview.df_historico_ponderado
            : overview?.df_historico ?? [],
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
      if (aindaValido()) setLoadingSecundario(false);
    }
  }, [paramsApi]);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    carregarDados();
  }, [carregarDados, isHydrated, isAuthenticated]);

  /**
   * Pré-carrega KPIs por município em paralelo após o escopo carregar.
   * Permite que o carrossel rotacione localmente sem disparar requests.
   */
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    if (!state.escopo || modoVisaoGerencialTodos || geocodeFiltroMapa == null) return;
    const municipiosAlvo = municipiosCarrossel;
    if (municipiosAlvo.length <= 1) return;

    let cancelado = false;
    setState((s) => ({ ...s, kpisPorMunicipio: {} }));
    (async () => {
      const resultados = await Promise.allSettled(
        municipiosAlvo.map((m) =>
          elNinoApi.getKpis({
            contratoId: contratoEfetivo ?? undefined,
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
  }, [state.escopo, cargaKey]);

  /** Pré-carrega clima atual (Open-Meteo) para os municípios do carrossel. */
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    if (!state.escopo || modoVisaoGerencialTodos || geocodeFiltroMapa == null) return;
    const alvo = municipiosCarrossel;
    if (!alvo.length) return;

    let cancelado = false;
    setState((s) => ({ ...s, climaPorMunicipio: {} }));
    setLoadingClima(true);

    (async () => {
      const resultados = await Promise.allSettled(
        alvo.map((m) =>
          elNinoApi.getClima({
            contratoId: contratoEfetivo ?? undefined,
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
  }, [state.escopo, cargaKey]);

  /** Clima sob demanda quando o carrossel aponta para município ainda não em cache. */
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    const geocode = filtros.geocode;
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
    filtros.geocode,
    filtros.consorcioId,
    cargaKey,
    state.climaPorMunicipio,
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

          {/* Header com legenda + links */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <ElNinoHeaderLegenda
              subtitulo={subtitulo}
              mapaQuery={{
                contratoId: contratoEfetivo,
                geocode: geocodeFiltroMapa,
              }}
            />
          </motion.div>

          {/* Filtros globais */}
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <ElNinoFiltrosTerritorial
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
                if (typeof window !== 'undefined') {
                  try {
                    window.sessionStorage.setItem(
                      FILTROS_STORAGE_KEY,
                      JSON.stringify(next),
                    );
                  } catch {
                    /* sessionStorage indisponível — ignora */
                  }
                }
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

          {/* Carrossel — apenas na visão municipal (município específico aplicado) */}
          {state.escopo &&
            geocodeFiltroMapa != null &&
            municipiosCarrossel.length > 1 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.08 }}
            >
              <ElNinoCarrosselMunicipios
                municipios={municipiosCarrossel}
                geocodeSelecionado={filtros.geocode}
                onGeocodeMudou={(gc) =>
                  setFiltros((s) => ({ ...s, geocode: gc }))
                }
              />
            </motion.div>
          )}

          {/* Navegação rápida entre blocos */}
          <NavSecoesPagina incluirRanking={exibirRankingMunicipios} />

          {/* 1 — Resumo executivo */}
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
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.12 }}
              >
                <ElNinoCausaDengue causa={state.causaDengue} loading={loading} />
              </motion.div>
            </div>
          </SecaoAnalytics>

          {/* 2 — Território: mapa em destaque + alertas */}
          <SecaoAnalytics
            id="secao-territorio"
            titulo="Território e alertas"
            descricao="Mapa de risco projetado e alertas que pedem ação no escopo selecionado."
          >
            <motion.div
              className="grid grid-cols-1 xl:grid-cols-5 gap-4 xl:items-start"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
            >
              <div className="w-full xl:col-span-3 min-w-0">
                <ElNinoMapaProjecao
                  data={mapaExibido}
                  loading={
                    (loadingSecundario && !state.mapaProjecao) || loadingMapaVerba
                  }
                  geocodeFiltro={geocodeFiltroMapa}
                  consorcioId={filtros.consorcioId}
                  consorcios={state.consorcios}
                  municipioCasos={municipioCasosFiltro}
                />
              </div>
              <div className="relative w-full xl:col-span-2 min-w-0 bg-white rounded-xl border border-gray-100 p-4 xl:sticky xl:top-28 xl:max-h-[min(36rem,calc(100vh-8rem))] overflow-y-auto overscroll-contain">
                <ElNinoGuiaGrafico chave="alertas" />
                <header className="mb-3 pr-8">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Alertas preditivos
                  </h3>
                  <p className="text-xs text-gray-400">
                    INMET · Chuva · Previsão · Infodengue · Controle vetorial
                  </p>
                </header>
                <ElNinoAlertas
                  alertas={state.alertas}
                  loading={loadingSecundario && !state.alertas.length}
                />
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
                data={state.serieConsorcio}
                loading={loadingSecundario && !state.serieConsorcio}
              />

              <div className="space-y-4">
                <ElNinoChuvaConsorcio
                  data={state.serieConsorcio}
                  serieHistorica={dadosGraficos?.serie}
                  anoInicio={filtros.anoInicio}
                  anoFim={filtros.anoFim}
                  loading={loadingSecundario && !state.serieConsorcio}
                />
                {(filtros.geocode != null ||
                  loadingClimaMunicipio ||
                  climaExibido) && (
                  <ElNinoPrevisaoClima
                    key={filtros.geocode ?? 'sem-geocode'}
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
                  historico={dadosGraficos?.historicoAnual}
                  oniMensal={dadosGraficos?.oniMensal}
                  serie={dadosGraficos?.serie}
                  {...graficosProps}
                />
              ) : null}

              <div className="space-y-4">
                <ElNinoComparativoMensal
                  serie={dadosGraficos?.serie}
                  oniMensal={dadosGraficos?.oniMensal}
                  {...graficosProps}
                />
                <ElNinoSerieSazonal
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
                mensalMun={dadosGraficos?.mensalMun}
                comparativoMensal={dadosGraficos?.comparativoMensal}
                {...graficosProps}
              />
              <ElNinoPosPicoOni
                serie={dadosGraficos?.serie}
                oniMensal={dadosGraficos?.oniMensal}
                {...graficosProps}
              />
            </motion.div>
          </SecaoAnalytics>

        </div>
      </MainLayout>
    </>
  );
}
