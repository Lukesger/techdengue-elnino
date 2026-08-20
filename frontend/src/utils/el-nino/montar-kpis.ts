import { buscarMensalMunGeocode, buscarNomeMunicipioLista } from './contracts';
import { casosConfirmadosDeLinha } from './graficos-filtros';

const MESES_LABEL = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

function filtrarSeriePorPeriodo(
  serie: any[],
  anoInicio?: number,
  anoFim?: number,
): any[] {
  let out = serie;
  if (anoInicio != null) out = out.filter((r) => r.Ano >= anoInicio);
  if (anoFim != null) out = out.filter((r) => r.Ano <= anoFim);
  return out;
}

function nomeMunicipio(dados: any, geocode: number): string | null {
  const gc = Number(geocode);
  const mun = dados.municipios?.find((m: any) => Number(m.geocode) === gc);
  if (mun?.municipio) return mun.municipio;
  if (mun?.nome) return mun.nome;
  const linha = dados.df_mensal_mun?.find((r: any) => Number(r.geocode) === gc);
  if (linha?.municipio) return linha.municipio;
  if (linha?.nome) return linha.nome;
  return buscarNomeMunicipioLista(gc);
}

function filtrarMensalPorGeocode(dados: any, geocode: number): any[] {
  const gc = Number(geocode);
  const local = (dados.df_mensal_mun ?? []).filter(
    (r: any) => Number(r.geocode) === gc,
  );
  return local.length ? local : buscarMensalMunGeocode(gc);
}

function climaMunicipio(dados: any, geocode: number): any | null {
  const gc = Number(geocode);
  const mapa = dados.clima_municipios;
  if (!mapa) return dados.clima ?? null;
  return mapa[gc] ?? mapa[String(gc)] ?? dados.clima ?? null;
}

function temperaturaValida(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10) / 10;
}

function obterProximoMesCalendario() {
  const hoje = new Date();
  const ref = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
  const mesNum = ref.getMonth() + 1;
  return {
    mesNum,
    ano: ref.getFullYear(),
    label: `${MESES_LABEL[mesNum - 1]}/${ref.getFullYear()}`,
  };
}

function mediaChuvaHistoricaMes(serie: any[], mesNum: number): number | null {
  const fatia = serie.filter(
    (r) => r.MesNum === mesNum && r.Precipitacao != null,
  );
  if (!fatia.length) return null;
  const media =
    fatia.reduce((s, r) => s + Number(r.Precipitacao), 0) / fatia.length;
  return Math.round(media * 10) / 10;
}

function projetarPrecipitacaoProximoMes(dados: any, geocode?: number) {
  const prox = obterProximoMesCalendario();
  const serieHist = geocode
    ? filtrarMensalPorGeocode(dados, geocode)
    : dados.df_serie_ponderada?.length > 0
      ? dados.df_serie_ponderada
      : dados.df_serie ?? [];

  let mm = mediaChuvaHistoricaMes(serieHist, prox.mesNum);
  let regional = false;

  if (mm == null && geocode) {
    const serieRegional =
      dados.df_serie_ponderada?.length > 0
        ? dados.df_serie_ponderada
        : dados.df_serie ?? [];
    mm = mediaChuvaHistoricaMes(serieRegional, prox.mesNum);
    regional = mm != null;
  }

  const resumo = dados.elnino?.resumo;
  if (
    mm != null &&
    resumo?.chuva_media_sem > 0 &&
    resumo?.chuva_media_com > 0
  ) {
    const oniProx =
      dados.oni_mensal?.find(
        (o: any) => o.ano === prox.ano && o.mes === prox.mesNum,
      ) ?? dados.oni_mensal?.at(-1);
    if (oniProx && oniProx.oni >= 0.5) {
      const fator = resumo.chuva_media_com / resumo.chuva_media_sem;
      mm = Math.round(mm * fator * 10) / 10;
    }
  }

  return {
    valor: mm != null ? `${mm} mm` : 'N/A',
    subtitulo: regional
      ? `Proj. ${prox.label} · média regional`
      : `Proj. ${prox.label}`,
  };
}

function mediaTemperaturaClimaMunicipios(
  dados: any,
): { valor: number; n: number } | null {
  const mapa = dados.clima_municipios;
  if (!mapa || typeof mapa !== 'object') return null;
  const temps: number[] = [];
  for (const v of Object.values(mapa) as Array<{ atual?: { temperatura_c?: unknown } }>) {
    const t = temperaturaValida(v?.atual?.temperatura_c);
    if (t != null) temps.push(t);
  }
  if (!temps.length) return null;
  const media =
    Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10;
  return { valor: media, n: temps.length };
}

/** Média das temperaturas do último mês presente em df_mensal_mun (não um município). */
export function mediaTemperaturaUltimoMesMensal(
  mensal: any[] | null | undefined,
): { valor: number; n: number; mes: string; ano: number } | null {
  const linhas = (mensal ?? []).filter(
    (r) => temperaturaValida(r?.Temperatura) != null,
  );
  if (!linhas.length) return null;
  const last = [...linhas]
    .sort((a, b) => Number(a.Ano) - Number(b.Ano) || Number(a.MesNum) - Number(b.MesNum))
    .at(-1);
  const ano = Number(last.Ano);
  const mesNum = Number(last.MesNum);
  const fatia = linhas.filter(
    (r) => Number(r.Ano) === ano && Number(r.MesNum) === mesNum,
  );
  const temps = fatia
    .map((r) => temperaturaValida(r.Temperatura))
    .filter((t): t is number => t != null);
  if (!temps.length) return null;
  const media =
    Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10;
  const mes =
    (typeof last.Mes === 'string' && last.Mes.trim()) ||
    MESES_LABEL[mesNum - 1] ||
    String(mesNum);
  return { valor: media, n: temps.length, mes, ano };
}

function kpiCard(
  titulo: string,
  valor: string,
  subtitulo: string,
): { titulo: string; valor: string; subtitulo: string } {
  return { titulo, valor, subtitulo };
}

function resolverTemperaturaKpi(
  dados: any,
  geocode: number | undefined,
  serieHist: any[],
): { titulo: string; valor: string; subtitulo: string } {
  const munNome = geocode ? nomeMunicipio(dados, geocode) : null;

  if (geocode) {
    const clima = climaMunicipio(dados, geocode);
    const tAtual = temperaturaValida(clima?.atual?.temperatura_c);
    if (tAtual != null) {
      return kpiCard(
        'Temperatura atual',
        `${tAtual} °C`,
        munNome ? `${munNome} · clima atual` : 'Clima atual',
      );
    }

    const ultimoDia = clima?.dias?.at(-1);
    const tDia = temperaturaValida(
      ultimoDia?.temp_media ?? ultimoDia?.max_c,
    );
    if (tDia != null) {
      const ref = ultimoDia?.periodo || ultimoDia?.data || '';
      const sub = ref
        ? `${ref}${munNome ? ` · ${munNome}` : ''}`
        : munNome ?? 'Último registro climático';
      return kpiCard('Temperatura atual', `${tDia} °C`, sub);
    }
  } else {
    const mediaClima = mediaTemperaturaClimaMunicipios(dados);
    if (mediaClima) {
      return kpiCard(
        'Temperatura atual',
        `${mediaClima.valor} °C`,
        `Média de ${mediaClima.n} municípios · clima atual`,
      );
    }
    const mediaMes = mediaTemperaturaUltimoMesMensal(
      dados.df_mensal_mun?.length ? dados.df_mensal_mun : serieHist,
    );
    if (mediaMes) {
      return kpiCard(
        'Temperatura média',
        `${mediaMes.valor} °C`,
        `Média MG · ${mediaMes.mes}/${mediaMes.ano}`,
      );
    }
    return kpiCard('Temperatura média', 'N/A', 'Último mês registrado');
  }

  const ultimoComTemp = [...serieHist]
    .sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum)
    .reverse()
    .find((r) => temperaturaValida(r.Temperatura) != null);

  if (ultimoComTemp) {
    const t = temperaturaValida(ultimoComTemp.Temperatura)!;
    const temPeriodo =
      typeof ultimoComTemp.Mes === 'string' &&
      ultimoComTemp.Mes.trim() !== '' &&
      ultimoComTemp.Ano != null;
    const periodo = temPeriodo
      ? `${ultimoComTemp.Mes}/${ultimoComTemp.Ano}`
      : '';
    const sub = periodo
      ? `${periodo}${munNome ? ` · ${munNome}` : ''}`
      : munNome ?? 'Último mês registrado';
    return kpiCard('Temperatura média', `${t} °C`, sub);
  }

  return kpiCard(
    'Temperatura média',
    'N/A',
    munNome ?? 'Último mês registrado',
  );
}

/**
 * Front não monta a estrutura do KPI El Niño — só devolve o card
 * já estruturado pelo backend (`dados.kpis`) ou os campos prontos em `elnino`.
 */
function kpiElNinoDoBackend(dados: any): {
  titulo: string;
  valor: string;
  subtitulo: string;
} {
  const lista = Array.isArray(dados?.kpis) ? dados.kpis : null;
  const pronto = lista?.find(
    (k: { titulo?: string }) =>
      typeof k?.titulo === 'string' && /el\s*nino\s*ativo/i.test(k.titulo),
  );
  if (pronto) {
    return {
      titulo: String(pronto.titulo),
      valor: String(pronto.valor ?? '—'),
      subtitulo: String(pronto.subtitulo ?? ''),
    };
  }

  const el = dados?.elnino;
  if (el && typeof el === 'object') {
    const partes: string[] = [];
    if (el.oni_atual != null && Number.isFinite(Number(el.oni_atual))) {
      partes.push(`ONI ${Number(el.oni_atual).toFixed(2)}`);
    }
    if (el.periodo_atual) partes.push(String(el.periodo_atual));
    if (el.intensidade && el.intensidade !== 'Neutro') {
      partes.push(String(el.intensidade));
    }
    return {
      titulo: 'El Nino Ativo',
      valor: el.ativo ? 'Sim' : 'Nao',
      subtitulo: partes.join(' · '),
    };
  }

  return { titulo: 'El Nino Ativo', valor: '—', subtitulo: '' };
}

export type CasosUltimoMesLiveKpi = {
  ano: number;
  mes: number;
  casos: number;
  preliminar?: boolean;
};

export function rotuloCasosUltimoMesLive(live: CasosUltimoMesLiveKpi): string {
  const mes = MESES_LABEL[live.mes - 1] ?? String(live.mes);
  const base = `${mes}/${live.ano}`;
  return live.preliminar ? `${base} · preliminar` : base;
}

function liveUltimoMesValido(
  live: unknown,
): live is CasosUltimoMesLiveKpi {
  if (!live || typeof live !== 'object') return false;
  const o = live as CasosUltimoMesLiveKpi;
  const mes = Number(o.mes);
  return (
    Number.isFinite(Number(o.ano)) &&
    Number.isFinite(mes) &&
    mes >= 1 &&
    mes <= 12 &&
    Number.isFinite(Number(o.casos))
  );
}

function subtituloUltimoMesCasos(
  liveUltimoMes: CasosUltimoMesLiveKpi | undefined,
  ultimoSerie: any | undefined,
): string {
  if (liveUltimoMes) return rotuloCasosUltimoMesLive(liveUltimoMes);
  if (ultimoSerie) return `${ultimoSerie.Mes}/${ultimoSerie.Ano}`;
  return '';
}

function valorUltimoMesCasos(
  liveUltimoMes: CasosUltimoMesLiveKpi | undefined,
  ultimoSerie: any | undefined,
  geocode?: number,
): string {
  if (liveUltimoMes) return String(liveUltimoMes.casos);
  if (!ultimoSerie) return 'N/A';
  return String(
    geocode
      ? casosConfirmadosDeLinha(ultimoSerie)
      : ultimoSerie.CasosDengue,
  );
}

export function montarKpis(
  dados: any,
  geocode?: number,
  anoInicio?: number,
  anoFim?: number,
) {
  const liveRaw = !geocode ? dados?.casos_ultimo_mes_live : undefined;
  const liveUltimoMes = liveUltimoMesValido(liveRaw) ? liveRaw : undefined;
  const serieAgregada =
    dados.df_serie_ponderada?.length > 0
      ? dados.df_serie_ponderada
      : dados.df_serie || [];

  const mensalMun = geocode ? filtrarMensalPorGeocode(dados, geocode) : [];
  const serieBruta = geocode ? mensalMun : serieAgregada;
  const serie = filtrarSeriePorPeriodo(serieBruta, anoInicio, anoFim);
  const ultimoSerie = [...serie]
    .sort((a: any, b: any) => a.Ano - b.Ano || a.MesNum - b.MesNum)
    .at(-1);
  const mediaCasos = serie.length
    ? Math.round(
        serie.reduce(
          (s: number, r: any) =>
            s +
            (geocode ? casosConfirmadosDeLinha(r) : Number(r.CasosDengue || 0)),
          0,
        ) / serie.length,
      )
    : 0;

  const munNome = geocode ? nomeMunicipio(dados, geocode) : null;
  const subtituloCasosMedios = geocode
    ? munNome ?? `Município ${geocode}`
    : `${dados.municipios?.length || 0} municípios`;
  const chuvaProj = projetarPrecipitacaoProximoMes(dados, geocode);
  const serieParaTemp = mensalMun.length
    ? mensalMun
    : dados.df_mensal_mun?.length
      ? dados.df_mensal_mun
      : serieAgregada;
  const tempKpi = resolverTemperaturaKpi(dados, geocode, serieParaTemp);

  return [
    {
      titulo: 'Casos Medios/Mes',
      valor: String(mediaCasos),
      subtitulo: subtituloCasosMedios,
    },
    {
      titulo: tempKpi.titulo,
      valor: tempKpi.valor,
      subtitulo: tempKpi.subtitulo,
    },
    {
      titulo: 'Ultimo Mes Casos',
      valor: valorUltimoMesCasos(liveUltimoMes, ultimoSerie, geocode),
      subtitulo: subtituloUltimoMesCasos(liveUltimoMes, ultimoSerie),
    },
    kpiElNinoDoBackend(dados),
    {
      titulo: 'Precipitacao de Chuva',
      valor: chuvaProj.valor,
      subtitulo: chuvaProj.subtitulo,
    },
  ];
}
