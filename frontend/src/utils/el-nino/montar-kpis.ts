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

function resolverTemperaturaKpi(
  dados: any,
  geocode: number | undefined,
  mensalMun: any[],
): { valor: string; subtitulo: string } {
  const munNome = geocode ? nomeMunicipio(dados, geocode) : null;

  if (geocode) {
    const clima = climaMunicipio(dados, geocode);
    const tAtual = temperaturaValida(clima?.atual?.temperatura_c);
    if (tAtual != null) {
      return {
        valor: `${tAtual} °C`,
        subtitulo: munNome ? `${munNome} · clima atual` : 'Clima atual',
      };
    }

    const ultimoDia = clima?.dias?.at(-1);
    const tDia = temperaturaValida(
      ultimoDia?.temp_media ?? ultimoDia?.max_c,
    );
    if (tDia != null) {
      const ref = ultimoDia?.periodo || ultimoDia?.data || '';
      return {
        valor: `${tDia} °C`,
        subtitulo: ref
          ? `${ref}${munNome ? ` · ${munNome}` : ''}`
          : munNome ?? 'Último registro climático',
      };
    }
  }

  const ultimoComTemp = [...mensalMun]
    .sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum)
    .reverse()
    .find((r) => temperaturaValida(r.Temperatura) != null);

  if (ultimoComTemp) {
    const t = temperaturaValida(ultimoComTemp.Temperatura)!;
    const periodo =
      ultimoComTemp.Mes && ultimoComTemp.Ano
        ? `${ultimoComTemp.Mes}/${ultimoComTemp.Ano}`
        : '';
    return {
      valor: `${t} °C`,
      subtitulo: periodo
        ? `${periodo}${munNome ? ` · ${munNome}` : ''}`
        : munNome ?? 'Último mês registrado',
    };
  }

  return {
    valor: 'N/A',
    subtitulo: munNome ?? 'Último mês registrado',
  };
}

function montarKpiElNino(dados: any) {
  const el = dados.elnino;
  const oni = dados.oni_mensal || [];
  const ultimoOni = oni.length
    ? [...oni].sort((a: any, b: any) => a.ano - b.ano || a.mes - b.mes).at(-1)
    : null;

  const oniValor =
    el?.oni_atual != null && Number.isFinite(Number(el.oni_atual))
      ? Number(el.oni_atual)
      : ultimoOni?.oni != null
        ? Number(ultimoOni.oni)
        : null;

  const ativo =
    typeof el?.ativo === 'boolean'
      ? el.ativo
      : oniValor != null && oniValor >= 0.5;

  const mesRef =
    ultimoOni != null
      ? `${MESES_LABEL[ultimoOni.mes - 1]}/${ultimoOni.ano}`
      : el?.periodo_atual
        ? (() => {
            const [anoStr, mesStr] = String(el.periodo_atual).split('/');
            const mesNum = Number(mesStr);
            const anoNum = Number(anoStr);
            if (Number.isFinite(mesNum) && mesNum >= 1 && mesNum <= 12) {
              return `${MESES_LABEL[mesNum - 1]}/${anoNum || anoStr}`;
            }
            return String(el.periodo_atual);
          })()
        : '';

  const subtituloParts: string[] = [];
  if (oniValor != null) subtituloParts.push(`ONI ${oniValor.toFixed(2)}`);
  if (mesRef) subtituloParts.push(mesRef);
  if (el?.intensidade && el.intensidade !== 'Neutro') {
    subtituloParts.push(el.intensidade);
  }

  return {
    titulo: 'El Nino Ativo',
    valor: ativo ? 'Sim' : 'Nao',
    subtitulo: subtituloParts.join(' · '),
  };
}

export function montarKpis(
  dados: any,
  geocode?: number,
  anoInicio?: number,
  anoFim?: number,
) {
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
  const tempKpi = resolverTemperaturaKpi(dados, geocode, mensalMun);

  return [
    {
      titulo: 'Casos Medios/Mes',
      valor: String(mediaCasos),
      subtitulo: subtituloCasosMedios,
    },
    {
      titulo: 'Temperatura Media',
      valor: tempKpi.valor,
      subtitulo: tempKpi.subtitulo,
    },
    {
      titulo: 'Ultimo Mes Casos',
      valor: ultimoSerie
        ? String(
            geocode
              ? casosConfirmadosDeLinha(ultimoSerie)
              : ultimoSerie.CasosDengue,
          )
        : 'N/A',
      subtitulo: ultimoSerie ? `${ultimoSerie.Mes}/${ultimoSerie.Ano}` : '',
    },
    montarKpiElNino(dados),
    {
      titulo: 'Precipitacao de Chuva',
      valor: chuvaProj.valor,
      subtitulo: chuvaProj.subtitulo,
    },
  ];
}
