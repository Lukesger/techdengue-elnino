import type { HistoricoAnual, SerieMensal } from '@/services/el-nino-api';
import { ANO_INICIO_PADRAO, anoFimDados } from '@/utils/el-nino/constants';
import {
  filtrarMensalPorAnos,
  filtrarMensalPorGeocode,
  filtrarOniPorAnos,
  filtrarSerieMesAno,
  lerMesCalendario,
  mensalMunParaSerieMensal,
  mesclarClimaHistoricoEmMensal,
  periodoFiltro,
  resolverMesFimSerie,
} from '@/utils/el-nino/graficos-filtros';
import { completarOniComFallback } from '@/utils/el-nino/oni-historico-fallback';
import { remontarHistoricoAnual } from '@/utils/el-nino/historico-anual';

type OniLinha = { ano: number; mes: number; oni: number };

export type DadosGraficosElNino = {
  serie: SerieMensal[];
  serieCompleta: SerieMensal[];
  mensalMun: Array<Record<string, unknown>>;
  /** Sem filtro de anos — perfil mensal / pós-pico usam histórico completo. */
  mensalMunCompleto: Array<Record<string, unknown>>;
  oniMensal: OniLinha[];
  oniCompleto: OniLinha[];
  comparativoMensal: unknown[];
  historicoAnual: HistoricoAnual[];
  mesFim: number;
  nMunicipios: number;
  nomeMunicipio: string | null;
};

type OverviewLike = {
  df_mensal_mun?: Array<Record<string, unknown>>;
  clima_historico?: Array<Record<string, unknown>>;
  df_serie_ponderada?: SerieMensal[];
  df_serie?: SerieMensal[];
  oni_mensal?: OniLinha[];
  mes_fim?: number | string | null;
  mes_fim_consolidado?: number | string | null;
  municipios?: unknown[];
  df_historico_ponderado?: HistoricoAnual[];
  df_historico?: HistoricoAnual[];
  elnino?: { comparativo_mensal?: unknown[] };
};

function escolherSerieBruta(
  geocodeGraficos: number | null | undefined,
  mensalMun: Array<Record<string, unknown>>,
  serieAgregada: SerieMensal[],
): { serieBruta: SerieMensal[]; mensalMun: Array<Record<string, unknown>> } {
  if (geocodeGraficos == null) {
    return { serieBruta: serieAgregada, mensalMun };
  }
  if (mensalMun.length) {
    return { serieBruta: mensalMunParaSerieMensal(mensalMun), mensalMun };
  }
  if (!serieAgregada.length) {
    return { serieBruta: [], mensalMun };
  }
  return {
    serieBruta: serieAgregada,
    mensalMun: serieAgregada.map((r) => ({
      ...r,
      geocode: Number(geocodeGraficos),
    })) as Array<Record<string, unknown>>,
  };
}

function escolherSerieCompleta(
  geocodeGraficos: number | null | undefined,
  mensalMunCompleto: Array<Record<string, unknown>>,
  serieAgregada: SerieMensal[],
): SerieMensal[] {
  if (geocodeGraficos == null) return serieAgregada;
  if (mensalMunCompleto.length) {
    return mensalMunParaSerieMensal(mensalMunCompleto);
  }
  return serieAgregada.length ? serieAgregada : [];
}

function oniDaSerie(serie: SerieMensal[]): OniLinha[] {
  return serie
    .filter((r) => r.ONI != null && Number.isFinite(Number(r.ONI)))
    .map((r) => ({
      ano: Number(r.Ano),
      mes: Number(r.MesNum),
      oni: Number(r.ONI),
    }));
}

function montarOniFiltrado(
  oniFonte: OniLinha[] | undefined,
  serieFallback: SerieMensal[],
  anoInicio: number,
  anoFim: number,
): OniLinha[] {
  let oniMensal = filtrarOniPorAnos(oniFonte ?? [], anoInicio, anoFim);
  if (!oniMensal.length && serieFallback.length) {
    oniMensal = oniDaSerie(serieFallback);
  }
  return filtrarOniPorAnos(
    completarOniComFallback(oniMensal),
    anoInicio,
    anoFim,
  );
}

/**
 * Agrega overview + filtros em props dos gráficos El Niño.
 * Extraído do useMemo da página para reduzir complexidade cognitiva.
 */
export function montarDadosGraficosElNino(params: {
  overview: OverviewLike | null | undefined;
  historicoFallback?: HistoricoAnual[] | null;
  comparativoMensalFallback?: unknown[] | null;
  escopoNMunicipios?: number;
  geocodeGraficos: number | null | undefined;
  anoInicio: number;
  anoFim: number;
  nomeMunicipio: string | null;
}): DadosGraficosElNino | null {
  const {
    overview: ov,
    historicoFallback,
    comparativoMensalFallback,
    escopoNMunicipios = 0,
    geocodeGraficos,
    anoInicio,
    anoFim,
    nomeMunicipio,
  } = params;

  if (!ov) return null;

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
    ov.df_serie_ponderada?.length
      ? ov.df_serie_ponderada
      : ov.df_serie ?? [];

  /**
   * Com geocode: preferir linhas municipais. Se o overview trouxe histórico
   * mas df_mensal_mun veio vazio/descasado, reaproveita df_serie (1 município
   * no escopo) em vez de zerar comparativo/sazonal/pós-pico.
   */
  const escolhida = escolherSerieBruta(
    geocodeGraficos,
    mensalMun,
    serieAgregada,
  );
  const serieBruta = escolhida.serieBruta;
  if (geocodeGraficos != null && !mensalMun.length && serieAgregada.length) {
    mensalMun = filtrarMensalPorAnos(escolhida.mensalMun, anoInicio, anoFim);
  }

  const mesFimDados = lerMesCalendario(
    ov.mes_fim ?? ov.mes_fim_consolidado,
    resolverMesFimSerie(serieBruta, anoFim, 12),
  );
  const { anoIni, mesIni, anoFim: af, mesFim: mf } = periodoFiltro(
    anoInicio,
    anoFim,
    mesFimDados,
  );
  const serie = filtrarSerieMesAno(serieBruta, anoIni, mesIni, af, mf);
  const oniMensal = montarOniFiltrado(
    ov.oni_mensal,
    serie,
    anoInicio,
    anoFim,
  );

  const nMunicipios =
    geocodeGraficos != null
      ? 1
      : ov.municipios?.length ?? escopoNMunicipios ?? 0;

  const historicoBruto: HistoricoAnual[] =
    (ov.df_historico_ponderado?.length
      ? ov.df_historico_ponderado
      : ov.df_historico) ??
    historicoFallback ??
    [];
  const historicoRemontado = remontarHistoricoAnual(serie, oniMensal);
  const historicoAnual = (
    historicoRemontado.length ? historicoRemontado : historicoBruto
  ).filter((h) => h.Ano >= anoInicio && h.Ano <= anoFim);

  /**
   * Série/ONI sem filtro de período — pós-pico ONI usa janela histórica completa
   * (ANO_INICIO_PADRAO → anoFimDados), independente do filtro global da página.
   */
  const mensalMunCompleto = mesclarClimaHistoricoEmMensal(
    filtrarMensalPorGeocode(ov.df_mensal_mun ?? [], geocodeGraficos),
    (ov.clima_historico ?? []) as Array<Record<string, unknown>>,
    geocodeGraficos,
  );
  const serieCompletaBruta = escolherSerieCompleta(
    geocodeGraficos,
    mensalMunCompleto,
    serieAgregada,
  );
  const oniFonteCompleto =
    ov.oni_mensal?.length ? ov.oni_mensal : oniDaSerie(serieCompletaBruta);
  const oniCompletoBruto = filtrarOniPorAnos(
    completarOniComFallback(oniFonteCompleto ?? []),
    ANO_INICIO_PADRAO,
    anoFimDados(),
  );

  return {
    serie,
    serieCompleta: serieCompletaBruta,
    mensalMun,
    mensalMunCompleto,
    oniMensal,
    oniCompleto: oniCompletoBruto,
    comparativoMensal:
      ov.elnino?.comparativo_mensal ?? comparativoMensalFallback ?? [],
    historicoAnual,
    mesFim: mesFimDados,
    nMunicipios,
    nomeMunicipio,
  };
}
