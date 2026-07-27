import { ANO_INICIO_PADRAO, anoFimDados, formatarSemanaEpi } from './constants';
import { mediaTempPrevistaPorMes } from './enriquecer-clima-preditivo';
import { lerPrecipitacao, lerTemperatura } from './graficos-filtros';
import { lerClimaEra5Contrato } from './patch-cache-municipio';

const MESES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

const PROJECAO_FATOR_SUP = 1.35;
const PROJECAO_FATOR_INF = 0.7;
const PROJECAO_TETO_PCT = 0.15;
const ONI_PROJECAO_AMORT = 0.85;
const ONI_PROJECAO_CAP = 2.5;
const F_SAZONAL_PISO = 0.12;
const ANO_ATUAL = new Date().getFullYear();
const MES_ATUAL = new Date().getMonth() + 1;
const ANO_FIM = anoFimDados();
const ANO_INICIO_HIST = ANO_INICIO_PADRAO;
const ANO_INICIO_PROJECAO = ANO_FIM - 4;

function round(v: number, d = 1) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function chaveAnoMes(ano: number, mes: number): number {
  return ano * 100 + mes;
}

function mesSeguinte(ano: number, mes: number): { ano: number; mes: number } {
  if (mes >= 12) return { ano: ano + 1, mes: 1 };
  return { ano, mes: mes + 1 };
}

function compararAnoMes(
  aAno: number,
  aMes: number,
  bAno: number,
  bMes: number,
): number {
  return chaveAnoMes(aAno, aMes) - chaveAnoMes(bAno, bMes);
}

type PontoHistorico = {
  label: string;
  ano: number;
  mesNum: number;
  casosMediaMun: number;
  temp: number | null;
  precip: number | null;
};

/**
 * Lê o recorte Infodengue nas fontes do payload (ex.: "ate Jun/2026").
 */
function parseUltimoMesDasFontes(dados: any): { ano: number; mes: number } | null {
  const inner = dados.mapa_projecao?.payload ?? dados.mapa_projecao;
  const fontes: string[] = [...(inner?.fontes ?? []), ...(dados.fontes ?? [])];
  let melhor: { ano: number; mes: number } | null = null;
  let melhorKey = -1;

  for (const f of fontes) {
    const m = String(f).match(/ate\s+(\w{3,})\/(\d{4})/i);
    if (!m) continue;
    const mesStr = m[1].toLowerCase().slice(0, 3);
    const mesIdx = MESES.findIndex((nome) => nome.toLowerCase().startsWith(mesStr));
    const ano = Number(m[2]);
    if (mesIdx < 0 || !Number.isFinite(ano)) continue;
    const k = chaveAnoMes(ano, mesIdx + 1);
    if (k > melhorKey) {
      melhorKey = k;
      melhor = { ano, mes: mesIdx + 1 };
    }
  }
  return melhor;
}

/**
 * Último mês com casos Infodengue mensais consolidados.
 * Prioriza metadado do pipeline; evita cortar o ano corrente se houver dados.
 */
function resolverUltimoMesConsolidado(dados: any): { ano: number; mes: number } {
  if (dados?.ano_fim_consolidado != null && dados?.mes_fim_consolidado != null) {
    return {
      ano: Number(dados.ano_fim_consolidado),
      mes: Number(dados.mes_fim_consolidado),
    };
  }

  const dasFontes = parseUltimoMesDasFontes(dados);

  const mensal: any[] = dados.df_mensal_mun ?? [];
  const porMes = new Map<string, number>();
  for (const r of mensal) {
    const ano = Number(r.Ano);
    const mes = Number(r.MesNum);
    if (!Number.isFinite(ano) || !Number.isFinite(mes)) continue;
    const key = `${ano}-${mes}`;
    porMes.set(key, (porMes.get(key) ?? 0) + Number(r.casos_notificados ?? 0));
  }

  let doMensal: { ano: number; mes: number } | null = null;
  let doMensalKey = -1;
  for (const [keyStr, total] of porMes) {
    if (total <= 0) continue;
    const [ano, mes] = keyStr.split('-').map(Number);
    const k = chaveAnoMes(ano, mes);
    if (k > doMensalKey) {
      doMensalKey = k;
      doMensal = { ano, mes };
    }
  }

  let limite = dasFontes ?? doMensal;
  if (dasFontes && doMensal) {
    const kFontes = chaveAnoMes(dasFontes.ano, dasFontes.mes);
    limite = doMensalKey < kFontes ? doMensal : dasFontes;
  }

  if (limite) {
    const calendarioAtual = chaveAnoMes(ANO_ATUAL, MES_ATUAL);
    const kLimite = chaveAnoMes(limite.ano, limite.mes);
    if (kLimite > calendarioAtual) {
      return { ano: ANO_ATUAL, mes: MES_ATUAL };
    }
    return limite;
  }

  if (dados?.ano_fim != null && dados?.mes_fim != null) {
    return { ano: Number(dados.ano_fim), mes: Number(dados.mes_fim) };
  }
  return { ano: ANO_FIM, mes: 12 };
}

function recortarHistoricoAteConsolidado(
  historico: PontoHistorico[],
  limite: { ano: number; mes: number },
) {
  while (historico.length) {
    const u = historico[historico.length - 1];
    if (compararAnoMes(u.ano, u.mesNum, limite.ano, limite.mes) > 0) {
      historico.pop();
      continue;
    }
    break;
  }
}

function temperaturaValida(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return round(n, 1);
}

function precipitacaoValida(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return round(n, 1);
}

function temperaturaDeLinha(r: Record<string, unknown>): number | null {
  return temperaturaValida(lerTemperatura(r));
}

function precipitacaoDeLinha(r: Record<string, unknown>): number | null {
  return precipitacaoValida(lerPrecipitacao(r));
}

/** Mapa ano-mês → °C a partir de todas as fontes climáticas do pacote. */
function construirMapaTemperatura(
  dados: any,
  contratoId: number,
  geocodeFiltro?: number,
): Map<string, number> {
  const mapa = new Map<string, number>();

  const registrar = (ano: number, mes: number, temp: unknown, geo?: number) => {
    const t = temperaturaValida(temp);
    if (t == null || !Number.isFinite(ano) || !Number.isFinite(mes)) return;
    mapa.set(`${ano}-${mes}`, t);
    if (geo != null && Number.isFinite(geo)) {
      mapa.set(`${geo}-${ano}-${mes}`, t);
    }
  };

  for (const r of dados.clima_historico ?? []) {
    if (geocodeFiltro != null && Number(r.geocode) !== Number(geocodeFiltro)) {
      continue;
    }
    registrar(Number(r.Ano), Number(r.MesNum), r.Temperatura ?? r.temperatura, Number(r.geocode));
  }

  if (contratoId > 0) {
    for (const r of lerClimaEra5Contrato(contratoId, geocodeFiltro)) {
      registrar(r.Ano, r.MesNum, r.Temperatura, r.geocode);
    }
  }

  const serieTemp: any[] =
    dados.df_serie_ponderada?.length > 0
      ? dados.df_serie_ponderada
      : dados.df_serie ?? [];

  for (const r of serieTemp) {
    registrar(r.Ano, r.MesNum, r.Temperatura ?? r.temperatura);
  }

  for (const r of dados.df_mensal_mun ?? []) {
    if (geocodeFiltro != null && Number(r.geocode) !== Number(geocodeFiltro)) {
      continue;
    }
    registrar(r.Ano, r.MesNum, r.Temperatura ?? r.temperatura, Number(r.geocode));
  }

  return mapa;
}

function resolverTemperaturaMapa(
  mapa: Map<string, number>,
  ano: number,
  mesNum: number,
  geocode?: number,
): number | null {
  if (geocode != null && Number.isFinite(geocode)) {
    const porGeo = mapa.get(`${geocode}-${ano}-${mesNum}`);
    if (porGeo != null) return porGeo;
  }
  return mapa.get(`${ano}-${mesNum}`) ?? null;
}

/** Mapa ano-mês → mm a partir de todas as fontes climáticas do pacote. */
function construirMapaPrecipitacao(
  dados: any,
  contratoId: number,
  geocodeFiltro?: number,
): Map<string, number> {
  const mapa = new Map<string, number>();

  const registrar = (ano: number, mes: number, precip: unknown, geo?: number) => {
    const p = precipitacaoValida(precip);
    if (p == null || !Number.isFinite(ano) || !Number.isFinite(mes)) return;
    mapa.set(`${ano}-${mes}`, p);
    if (geo != null && Number.isFinite(geo)) {
      mapa.set(`${geo}-${ano}-${mes}`, p);
    }
  };

  for (const r of dados.clima_historico ?? []) {
    if (geocodeFiltro != null && Number(r.geocode) !== Number(geocodeFiltro)) {
      continue;
    }
    registrar(
      Number(r.Ano),
      Number(r.MesNum),
      r.Precipitacao ?? r.precipitacao,
      Number(r.geocode),
    );
  }

  if (contratoId > 0) {
    for (const r of lerClimaEra5Contrato(contratoId, geocodeFiltro)) {
      registrar(r.Ano, r.MesNum, r.Precipitacao, r.geocode);
    }
  }

  const serieClima: any[] =
    dados.df_serie_ponderada?.length > 0
      ? dados.df_serie_ponderada
      : dados.df_serie ?? [];

  for (const r of serieClima) {
    registrar(r.Ano, r.MesNum, r.Precipitacao ?? r.precipitacao);
  }

  for (const r of dados.df_mensal_mun ?? []) {
    if (geocodeFiltro != null && Number(r.geocode) !== Number(geocodeFiltro)) {
      continue;
    }
    registrar(
      r.Ano,
      r.MesNum,
      r.Precipitacao ?? r.precipitacao,
      Number(r.geocode),
    );
  }

  return mapa;
}

function resolverPrecipitacaoMapa(
  mapa: Map<string, number>,
  ano: number,
  mesNum: number,
  geocode?: number,
): number | null {
  if (geocode != null && Number.isFinite(geocode)) {
    const porGeo = mapa.get(`${geocode}-${ano}-${mesNum}`);
    if (porGeo != null) return porGeo;
  }
  return mapa.get(`${ano}-${mesNum}`) ?? null;
}

function classificarONI(oni: number | null | undefined) {
  const v = Number(oni ?? 0);
  if (v >= 2.0) return { rotulo: 'El Nino muito forte', fator: 1.8, ativo: true };
  if (v >= 1.5) return { rotulo: 'El Nino forte', fator: 1.8, ativo: true };
  if (v >= 0.5) return { rotulo: 'El Nino moderado', fator: 1.3, ativo: true };
  if (v <= -0.5) return { rotulo: 'La Nina', fator: 0.9, ativo: false };
  return { rotulo: 'Neutro', fator: 1, ativo: false };
}

function flagsFaixaElNino(oni: number | null | undefined) {
  const v = Number(oni ?? NaN);
  if (!Number.isFinite(v) || v < 0.5) {
    return { moderado: false, forte: false };
  }
  return {
    moderado: v >= 0.5 && v < 1.5,
    forte: v >= 1.5,
  };
}

function projetarONIFuturo(
  oniLinhas: Array<{ ano: number; mes: number; oni: number }>,
  anoAlvo = ANO_ATUAL,
  mesAtual = MES_ATUAL,
) {
  if (!oniLinhas.length) return [] as Array<{ ano: number; mes: number; oni: number }>;

  const sorted = [...oniLinhas].sort((a, b) => a.ano - b.ano || a.mes - b.mes);
  const recentes = sorted.slice(-3);
  const ultimo = recentes.at(-1)!;
  let delta = 0;
  if (recentes.length >= 2) {
    delta = (ultimo.oni - recentes[0].oni) / (recentes.length - 1);
  }

  const existentes = new Set(sorted.map((r) => `${r.ano}-${r.mes}`));
  const extras: Array<{ ano: number; mes: number; oni: number }> = [];

  for (let mes = 1; mes <= 12; mes++) {
    const chave = `${anoAlvo}-${mes}`;
    if (existentes.has(chave)) continue;
    const mesesAhead = (anoAlvo - ultimo.ano) * 12 + (mes - ultimo.mes);
    if (mesesAhead <= 0 || mesesAhead > 18) continue;
    let oniProj = ultimo.oni + delta * mesesAhead * ONI_PROJECAO_AMORT;
    oniProj = Math.min(oniProj, ONI_PROJECAO_CAP);
    oniProj = Math.max(oniProj, -ONI_PROJECAO_CAP);
    extras.push({ ano: anoAlvo, mes, oni: round(oniProj, 2) });
  }

  if (mesAtual <= 12) {
    for (let mes = mesAtual + 1; mes <= 12; mes++) {
      const chave = `${anoAlvo}-${mes}`;
      if (existentes.has(chave) || extras.some((e) => e.ano === anoAlvo && e.mes === mes)) {
        continue;
      }
      const mesesAhead = (anoAlvo - ultimo.ano) * 12 + (mes - ultimo.mes);
      if (mesesAhead <= 0 || mesesAhead > 18) continue;
      let oniProj = ultimo.oni + delta * mesesAhead * ONI_PROJECAO_AMORT;
      oniProj = Math.min(oniProj, ONI_PROJECAO_CAP);
      oniProj = Math.max(oniProj, -ONI_PROJECAO_CAP);
      extras.push({ ano: anoAlvo, mes, oni: round(oniProj, 2) });
    }
  }

  return extras;
}

function filtrarHistoricoMunicipio(mensal: any[], geocode: number, ateAnoCorrente = false) {
  return mensal
    .filter((r) => {
      if (r.geocode !== geocode || r.Ano < ANO_INICIO_PROJECAO) return false;
      if (r.Ano > ANO_FIM) {
        if (!ateAnoCorrente || r.Ano !== ANO_ATUAL || r.MesNum > MES_ATUAL) return false;
      }
      return true;
    })
    .sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum);
}

function calcularFatoresSazonais(mensal: any[], geocode: number) {
  const janela = filtrarHistoricoMunicipio(mensal, geocode).filter((r) => r.Ano <= ANO_FIM);
  if (!janela.length) return {} as Record<number, number>;

  const mediaGeral =
    janela.reduce((s, r) => s + (r.casos_notificados ?? 0), 0) / janela.length;
  if (!mediaGeral) return {};

  const porMes: Record<number, number[]> = {};
  for (const r of janela) {
    if (!porMes[r.MesNum]) porMes[r.MesNum] = [];
    porMes[r.MesNum].push(r.casos_notificados ?? 0);
  }

  const fatores: Record<number, number> = {};
  for (let mes = 1; mes <= 12; mes++) {
    const vals = porMes[mes];
    if (!vals?.length) {
      fatores[mes] = 1;
      continue;
    }
    const mediaMes = vals.reduce((s, v) => s + v, 0) / vals.length;
    const fator = mediaMes / mediaGeral;
    fatores[mes] = round(Math.max(fator, F_SAZONAL_PISO), 4);
  }
  return fatores;
}

function calcularBaseNotificados(mensal: any[], geocode: number) {
  const historico = filtrarHistoricoMunicipio(mensal, geocode, true);
  const janela5 = historico.filter((r) => r.Ano <= ANO_FIM);

  const comCasos = [...historico].reverse().find((r) => (r.casos_notificados ?? 0) > 0);
  const ultimos6 = historico.slice(-6);
  const media6 = ultimos6.length
    ? ultimos6.reduce((s, r) => s + (r.casos_notificados ?? 0), 0) / ultimos6.length
    : 0;
  const mediaGeral = janela5.length
    ? janela5.reduce((s, r) => s + (r.casos_notificados ?? 0), 0) / janela5.length
    : 0;
  const pico = janela5.reduce((m, r) => Math.max(m, r.casos_notificados ?? 0), 0);

  return Math.max(
    comCasos?.casos_notificados ?? 0,
    Math.round(media6),
    Math.round(mediaGeral),
    Math.round(pico * 0.2),
    1,
  );
}

function mesNoHistorico(
  ano: number,
  mesNum: number,
  limite: { ano: number; mes: number },
): boolean {
  if (ano < ANO_INICIO_HIST) return false;
  if (compararAnoMes(ano, mesNum, limite.ano, limite.mes) > 0) return false;
  if (compararAnoMes(ano, mesNum, ANO_ATUAL, MES_ATUAL) > 0) return false;
  return true;
}

function chavesMesesHistorico(
  dados: any,
  limite: { ano: number; mes: number },
): Set<string> {
  const mensal: any[] = dados.df_mensal_mun ?? [];
  const serieTemp: any[] =
    dados.df_serie_ponderada?.length > 0
      ? dados.df_serie_ponderada
      : dados.df_serie ?? [];

  const chaves = new Set<string>();

  for (const r of mensal) {
    if (mesNoHistorico(r.Ano, r.MesNum, limite)) {
      chaves.add(`${r.Ano}-${r.MesNum}`);
    }
  }

  if (!dados._gerado_verba_direta) {
    for (const r of serieTemp) {
      if (mesNoHistorico(r.Ano, r.MesNum, limite)) {
        chaves.add(`${r.Ano}-${r.MesNum}`);
      }
    }
  }

  if (!chaves.size) {
    for (const r of serieTemp) {
      if (mesNoHistorico(r.Ano, r.MesNum, limite)) {
        chaves.add(`${r.Ano}-${r.MesNum}`);
      }
    }
  }

  return chaves;
}

type EntradaMesAgregado = {
  ano: number;
  mesNum: number;
  mes: string;
  notif: number;
  temp: number | null;
  precip: number | null;
  tempPorGeo: Map<number, number>;
  precipPorGeo: Map<number, number>;
};

function criarEntradaMesAgregado(r: {
  Ano: number;
  MesNum: number;
  Mes?: string;
}): EntradaMesAgregado {
  return {
    ano: r.Ano,
    mesNum: r.MesNum,
    mes: r.Mes ?? MESES[r.MesNum - 1],
    notif: 0,
    temp: null,
    precip: null,
    tempPorGeo: new Map(),
    precipPorGeo: new Map(),
  };
}

function mediaTemperaturaMunicipios(tempPorGeo: Map<number, number>): number | null {
  if (!tempPorGeo.size) return null;
  const vals = [...tempPorGeo.values()];
  return round(vals.reduce((s, v) => s + v, 0) / vals.length, 1);
}

function mediaPrecipitacaoMunicipios(precipPorGeo: Map<number, number>): number | null {
  if (!precipPorGeo.size) return null;
  const vals = [...precipPorGeo.values()];
  return round(vals.reduce((s, v) => s + v, 0) / vals.length, 1);
}

function mapaTemperaturaSerie(serieTemp: any[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const r of serieTemp) {
    const t = temperaturaDeLinha(r);
    if (t != null) mapa.set(`${r.Ano}-${r.MesNum}`, t);
  }
  return mapa;
}

function mapaPrecipitacaoSerie(serieTemp: any[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const r of serieTemp) {
    const p = precipitacaoDeLinha(r);
    if (p != null) mapa.set(`${r.Ano}-${r.MesNum}`, p);
  }
  return mapa;
}

/** Preenche meses com casos mas sem ERA5 municipal, usando série agregada e média sazonal. */
function preencherTemperaturaHistorico(
  pontos: PontoHistorico[],
  serieTemp: any[],
) {
  const serieMap = mapaTemperaturaSerie(serieTemp);
  const mediaPorMesNum = new Map<number, number>();

  for (let mesNum = 1; mesNum <= 12; mesNum++) {
    const vals = pontos
      .filter((p) => p.mesNum === mesNum && temperaturaValida(p.temp) != null)
      .map((p) => temperaturaValida(p.temp)!);
    if (vals.length) {
      mediaPorMesNum.set(
        mesNum,
        round(vals.reduce((s, v) => s + v, 0) / vals.length, 1),
      );
    }
  }

  for (const p of pontos) {
    if (temperaturaValida(p.temp) != null) continue;
    const daSerie = serieMap.get(`${p.ano}-${p.mesNum}`);
    if (daSerie != null) {
      p.temp = daSerie;
      continue;
    }
    const sazonal = mediaPorMesNum.get(p.mesNum);
    if (sazonal != null) p.temp = sazonal;
  }
}

/** Preenche meses sem precipitação municipal com série agregada e climatologia. */
function preencherPrecipitacaoHistorico(
  pontos: PontoHistorico[],
  serieTemp: any[],
) {
  const serieMap = mapaPrecipitacaoSerie(serieTemp);
  const mediaPorMesNum = new Map<number, number>();

  for (let mesNum = 1; mesNum <= 12; mesNum++) {
    const vals = pontos
      .filter((p) => p.mesNum === mesNum && precipitacaoValida(p.precip) != null)
      .map((p) => precipitacaoValida(p.precip)!);
    if (vals.length) {
      mediaPorMesNum.set(
        mesNum,
        round(vals.reduce((s, v) => s + v, 0) / vals.length, 1),
      );
    }
  }

  for (const p of pontos) {
    if (precipitacaoValida(p.precip) != null) continue;
    const daSerie = serieMap.get(`${p.ano}-${p.mesNum}`);
    if (daSerie != null) {
      p.precip = daSerie;
      continue;
    }
    const sazonal = mediaPorMesNum.get(p.mesNum);
    if (sazonal != null) p.precip = sazonal;
  }
}

function agregarSerieMensal(
  dados: any,
  nMunicipios: number,
  limite: { ano: number; mes: number },
  contratoId = 0,
  geocodeFiltro?: number,
) {
  const mensal: any[] = dados.df_mensal_mun ?? [];
  const serieTemp: any[] =
    dados.df_serie_ponderada?.length > 0
      ? dados.df_serie_ponderada
      : dados.df_serie ?? [];

  const chavesClima = chavesMesesHistorico(dados, limite);
  const serieMap = mapaTemperaturaSerie(serieTemp);
  const seriePrecipMap = mapaPrecipitacaoSerie(serieTemp);
  const mapaClima = construirMapaTemperatura(dados, contratoId, geocodeFiltro);
  const mapaPrecip = construirMapaPrecipitacao(dados, contratoId, geocodeFiltro);
  for (const [k, v] of mapaClima) {
    if (!serieMap.has(k)) serieMap.set(k, v);
  }
  for (const [k, v] of mapaPrecip) {
    if (!seriePrecipMap.has(k)) seriePrecipMap.set(k, v);
  }

  const porMes = new Map<string, EntradaMesAgregado>();

  for (const r of mensal) {
    if (compararAnoMes(r.Ano, r.MesNum, limite.ano, limite.mes) > 0) continue;
    if (r.Ano > ANO_ATUAL) continue;
    if (r.Ano === ANO_ATUAL && r.MesNum > MES_ATUAL) continue;
    const key = `${r.Ano}-${r.MesNum}`;
    if (!chavesClima.has(key)) continue;
    const atual = porMes.get(key) ?? criarEntradaMesAgregado(r);
    atual.notif += r.casos_notificados ?? 0;
    const geo = Number(r.geocode);
    const tMun =
      temperaturaDeLinha(r) ??
      resolverTemperaturaMapa(mapaClima, r.Ano, r.MesNum, geo);
    if (tMun != null && Number.isFinite(geo)) {
      atual.tempPorGeo.set(geo, tMun);
    }
    const pMun =
      precipitacaoDeLinha(r) ??
      resolverPrecipitacaoMapa(mapaPrecip, r.Ano, r.MesNum, geo);
    if (pMun != null && Number.isFinite(geo)) {
      atual.precipPorGeo.set(geo, pMun);
    }
    porMes.set(key, atual);
  }

  for (const r of serieTemp) {
    if (compararAnoMes(r.Ano, r.MesNum, limite.ano, limite.mes) > 0) continue;
    if (r.Ano > ANO_ATUAL) continue;
    if (r.Ano === ANO_ATUAL && r.MesNum > MES_ATUAL) continue;
    const key = `${r.Ano}-${r.MesNum}`;
    if (!chavesClima.has(key)) continue;
    if (!porMes.has(key)) {
      porMes.set(key, criarEntradaMesAgregado(r));
    }
  }

  for (const atual of porMes.values()) {
    const tMun = mediaTemperaturaMunicipios(atual.tempPorGeo);
    const tSerie = serieMap.get(`${atual.ano}-${atual.mesNum}`) ?? null;
    atual.temp = tMun ?? tSerie;
    const pMun = mediaPrecipitacaoMunicipios(atual.precipPorGeo);
    const pSerie = seriePrecipMap.get(`${atual.ano}-${atual.mesNum}`) ?? null;
    atual.precip = pMun ?? pSerie;
  }

  const ordenado = [...porMes.values()].sort(
    (a, b) => a.ano - b.ano || a.mesNum - b.mesNum,
  );

  const historico = ordenado.map((r) => ({
    label: `${r.mes}/${String(r.ano).slice(-2)}`,
    ano: r.ano,
    mesNum: r.mesNum,
    casosMediaMun: nMunicipios > 0 ? round(r.notif / nMunicipios, 1) : r.notif,
    temp: r.temp,
    precip: r.precip,
  }));

  preencherTemperaturaHistorico(historico, serieTemp);
  preencherPrecipitacaoHistorico(historico, serieTemp);
  return historico;
}

function calcularProjecaoMediaMunIntervalo(
  dados: any,
  municipios: any[],
  oniMap: Map<string, { oni: number; projetado: boolean }>,
  inicio: { ano: number; mes: number },
  fim: { ano: number; mes: number },
) {
  const mensal: any[] = dados.df_mensal_mun ?? [];
  const projPorMes = new Map<string, { valor: number; sup: number; inf: number }>();

  let { ano, mes } = inicio;
  while (compararAnoMes(ano, mes, fim.ano, fim.mes) <= 0) {
    let valorTotal = 0;
    let supTotal = 0;
    let infTotal = 0;
    let peso = 0;

    const oniEntry = oniMap.get(`${ano}-${mes}`);
    const intens = classificarONI(oniEntry?.oni);
    const fElnino = intens.fator;

    for (const mun of municipios) {
      const geocode = Number(mun.geocode);
      const pop = mun.populacao ?? mun.pop ?? 0;
      const base = calcularBaseNotificados(mensal, geocode);
      const fatores = calcularFatoresSazonais(mensal, geocode);
      const fSaz = fatores[mes] ?? 1;
      const teto = pop > 0 ? Math.round(pop * PROJECAO_TETO_PCT) : Number.MAX_SAFE_INTEGER;
      const valor = Math.max(1, Math.min(Math.round(base * fSaz * fElnino), teto));
      const sup = Math.min(Math.round(valor * PROJECAO_FATOR_SUP), teto);
      const inf = Math.round(valor * PROJECAO_FATOR_INF);
      const p = pop > 0 ? pop : 1;

      valorTotal += valor * p;
      supTotal += sup * p;
      infTotal += inf * p;
      peso += p;
    }

    if (peso) {
      projPorMes.set(`${ano}-${mes}`, {
        valor: Math.round(valorTotal / peso),
        sup: Math.round(supTotal / peso),
        inf: Math.round(infTotal / peso),
      });
    }

    ({ ano, mes } = mesSeguinte(ano, mes));
  }

  return projPorMes;
}

function montarMapaOni(dados: any) {
  const oniLinhas = (dados.oni_mensal ?? []).map((r: any) => ({
    ano: r.ano,
    mes: r.mes,
    oni: r.oni,
  }));

  const mapa = new Map<string, { oni: number; projetado: boolean }>();
  for (const r of oniLinhas) {
    mapa.set(`${r.ano}-${r.mes}`, { oni: r.oni, projetado: false });
  }

  const inner = dados.mapa_projecao?.payload ?? dados.mapa_projecao;
  for (const m of inner?.meses ?? []) {
    if (m.oni != null) {
      mapa.set(`${ANO_ATUAL}-${m.mesNum}`, {
        oni: m.oni,
        projetado: m.oniProjetado ?? true,
      });
    }
  }

  for (const r of projetarONIFuturo(oniLinhas)) {
    const k = `${r.ano}-${r.mes}`;
    if (!mapa.has(k)) {
      mapa.set(k, { oni: r.oni, projetado: true });
    }
  }

  return { mapa, oniAtual: [...oniLinhas].sort((a, b) => a.ano - b.ano || a.mes - b.mes).at(-1) };
}

export function filtrarDadosPorGeocode(dados: any, geocode?: number | null): any {
  if (geocode == null || !dados) return dados;
  const gc = Number(geocode);
  return {
    ...dados,
    municipios: (dados.municipios ?? []).filter(
      (m: any) => Number(m.geocode) === gc,
    ),
    df_mensal_mun: (dados.df_mensal_mun ?? []).filter(
      (r: any) => Number(r.geocode) === gc,
    ),
  };
}

export function montarSerieConsorcio(
  dados: any,
  rotuloConjunto: string,
  nMunicipios: number,
  geocodeFiltro?: number,
  contratoId = 0,
) {
  const base = filtrarDadosPorGeocode(dados, geocodeFiltro);
  const cid = contratoId > 0 ? contratoId : Number(base._contrato_id ?? base.contrato_id ?? 0);
  const nMun = geocodeFiltro ? 1 : nMunicipios;
  let municipios =
    base.mapa_projecao?.payload?.municipios ??
    base.mapa_projecao?.municipios ??
    base.municipios ??
    [];
  if (geocodeFiltro) {
    const gc = Number(geocodeFiltro);
    municipios = municipios.filter((m: any) => Number(m.geocode) === gc);
  }

  const ultimoConsolidado = resolverUltimoMesConsolidado(base);

  const historico = agregarSerieMensal(
    base,
    nMun,
    ultimoConsolidado,
    cid,
    geocodeFiltro,
  ) as PontoHistorico[];
  recortarHistoricoAteConsolidado(historico, ultimoConsolidado);

  const { mapa: oniMap, oniAtual } = montarMapaOni(base);
  const intensidadeAtual = classificarONI(oniAtual?.oni);
  const inicioProj = mesSeguinte(ultimoConsolidado.ano, ultimoConsolidado.mes);
  const fimProj = { ano: ANO_ATUAL, mes: 12 };
  const projPorMes = calcularProjecaoMediaMunIntervalo(
    base,
    municipios,
    oniMap,
    inicioProj,
    fimProj,
  );

  const inner = base.mapa_projecao?.payload ?? base.mapa_projecao;
  const munEpi =
    geocodeFiltro && inner?.municipios?.length
      ? inner.municipios.find(
          (m: any) => Number(m.geocode) === Number(geocodeFiltro),
        )
      : inner?.municipios?.[0];
  const semanaEpi = munEpi?.semana_epi ?? base.semana_epi ?? '';

  const labels: string[] = [];
  const casos: (number | null)[] = [];
  const precip: (number | null)[] = [];
  const precip_proj: (number | null)[] = [];
  const temp: (number | null)[] = [];
  const temp_proj: (number | null)[] = [];
  const oni: (number | null)[] = [];
  const oni_projetado: boolean[] = [];
  const proj: (number | null)[] = [];
  const sup: (number | null)[] = [];
  const inf: (number | null)[] = [];
  const projetado: boolean[] = [];
  const elnino_moderado: boolean[] = [];
  const elnino_forte: boolean[] = [];
  const forecastPorMes = mediaTempPrevistaPorMes(base, geocodeFiltro);

  for (const r of historico) {
    labels.push(r.label);
    casos.push(r.casosMediaMun);
    precip.push(precipitacaoValida(r.precip));
    precip_proj.push(null);
    temp.push(temperaturaValida(r.temp));
    temp_proj.push(null);
    const oniEntry = oniMap.get(`${r.ano}-${r.mesNum}`);
    const oniVal = oniEntry?.oni ?? null;
    oni.push(oniVal);
    oni_projetado.push(oniEntry?.projetado ?? false);
    proj.push(null);
    sup.push(null);
    inf.push(null);
    projetado.push(false);
    elnino_moderado.push(flagsFaixaElNino(oniVal).moderado);
    elnino_forte.push(flagsFaixaElNino(oniVal).forte);
  }

  const labelSeHoje = historico.length ? historico[historico.length - 1].label : null;
  const idxUltimoReal = historico.length - 1;

  let anoProj = inicioProj.ano;
  let mesProj = inicioProj.mes;
  while (compararAnoMes(anoProj, mesProj, fimProj.ano, fimProj.mes) <= 0) {
    labels.push(`${MESES[mesProj - 1]}/${String(anoProj).slice(-2)}`);
    casos.push(null);
    precip.push(null);
    temp.push(null);

    const histPrecip = historico
      .filter((h) => h.mesNum === mesProj && precipitacaoValida(h.precip) != null)
      .map((h) => precipitacaoValida(h.precip)!);
    const chuvaSazonal = histPrecip.length
      ? round(histPrecip.reduce((s, v) => s + v, 0) / histPrecip.length, 1)
      : null;
    precip_proj.push(chuvaSazonal);

    const forecastMes = forecastPorMes.get(`${anoProj}-${mesProj}`);
    const histTemps = historico
      .filter((h) => h.mesNum === mesProj && temperaturaValida(h.temp) != null)
      .map((h) => temperaturaValida(h.temp)!);
    const climaSazonal = histTemps.length
      ? round(histTemps.reduce((s, v) => s + v, 0) / histTemps.length, 1)
      : null;
    // Meses cobertos pela previsão 14d usam média do forecast; demais usam climatologia.
    temp_proj.push(forecastMes ?? climaSazonal);

    const oniEntry = oniMap.get(`${anoProj}-${mesProj}`);
    const oniVal = oniEntry?.oni ?? null;
    oni.push(oniVal);
    oni_projetado.push(oniEntry?.projetado ?? true);

    const p = projPorMes.get(`${anoProj}-${mesProj}`);
    proj.push(p?.valor ?? null);
    sup.push(p?.sup ?? null);
    inf.push(p?.inf ?? null);
    projetado.push(true);
    elnino_moderado.push(flagsFaixaElNino(oniVal).moderado);
    elnino_forte.push(flagsFaixaElNino(oniVal).forte);

    ({ ano: anoProj, mes: mesProj } = mesSeguinte(anoProj, mesProj));
  }

  const idxInicioProjec = projetado.findIndex((v) => v);
  const casosHistoricos = historico.map((r) => r.casosMediaMun);
  const mediaHistorica = casosHistoricos.length
    ? round(casosHistoricos.reduce((s, v) => s + v, 0) / casosHistoricos.length, 1)
    : 0;

  return {
    rotulo_conjunto: rotuloConjunto,
    n_municipios: nMun,
    anos_janela: base.anos_janela ?? ANO_FIM - ANO_INICIO_PADRAO + 1,
    ano_fim: ultimoConsolidado.ano,
    mes_fim: ultimoConsolidado.mes,
    ano_calendario_atual: ANO_ATUAL,
    mes_calendario_atual: MES_ATUAL,
    labels,
    casos,
    precip,
    precip_proj,
    temp,
    temp_proj,
    oni,
    oni_projetado,
    proj,
    sup,
    inf,
    projetado,
    elnino_moderado,
    elnino_forte,
    idx_ultimo_real: idxUltimoReal,
    idx_inicio_proj: idxInicioProjec >= 0 ? idxInicioProjec : labels.length,
    media_historica: mediaHistorica,
    label_se_hoje: labelSeHoje,
    elnino: (() => {
      const live = base.oni_fonte && base.elnino?.oni_fonte_live
        ? base.elnino
        : null;
      if (live) {
        return {
          ativo: Boolean(live.ativo),
          oni_atual: live.oni_atual ?? oniAtual?.oni ?? null,
          intensidade: live.intensidade ?? intensidadeAtual.rotulo,
          fator_atual: live.fator_atual ?? intensidadeAtual.fator,
        };
      }
      return {
        ativo: intensidadeAtual.ativo,
        oni_atual: oniAtual?.oni ?? null,
        intensidade: intensidadeAtual.rotulo,
        fator_atual: intensidadeAtual.fator,
      };
    })(),
    semana_epi: formatarSemanaEpi(semanaEpi) || semanaEpi,
    atualizado_em: new Date().toISOString(),
  };
}
