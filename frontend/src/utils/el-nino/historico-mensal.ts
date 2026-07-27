/**
 * Mescla série municipal histórica (2020–2022) a partir de JSON leve consolidado.
 *
 * Arquivo esperado em src/utils/el-nino/data/:
 *   - df_mensal_mun_historico.json  (preferencial)
 *   - serie_historica_consolidada.json (alias)
 *   - historico_mensal_{contratoId}.json (opcional, por contrato)
 *
 * Formatos aceitos:
 *   { linhas: [...] } | { df_mensal_mun: [...] } | GeoJSON FeatureCollection
 */
import fs from 'fs';
import path from 'path';
import { ANO_INICIO_PADRAO } from './constants';
import { casosConfirmadosDeLinha, lerAnoMesLinha } from './graficos-filtros';

const DATA_DIR = path.join(process.cwd(), 'src', 'utils', 'el-nino', 'data');
const LISTA_FILE = path.join(DATA_DIR, 'consorcios_lista_MG.json');
const PROJETO_DADOS = path.join(
  'C:',
  'Users',
  'Aero.Process 03',
  'Desktop',
  'Lucas Aero',
  'Eu',
  'Projeto El nino',
  'dados',
);

const MESES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

const ANO_HISTORICO_FIM = 2022;

let cacheHistorico: {
  mtime: number;
  linhas: any[];
  serie: any[];
  fonte: string | null;
} | null = null;

function mtimeArquivo(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function candidatosArquivoHistorico(contratoId?: number): string[] {
  const nomes = [
    'df_mensal_mun_historico.json',
    'serie_historica_consolidada.json',
  ];
  const dirs = [
    process.env.EL_NINO_HISTORICO_DIR,
    DATA_DIR,
    PROJETO_DADOS,
  ].filter(Boolean) as string[];

  const paths: string[] = [];
  for (const dir of dirs) {
    for (const nome of nomes) {
      paths.push(path.join(dir, nome));
    }
    if (contratoId != null) {
      paths.push(path.join(dir, `historico_mensal_${contratoId}.json`));
    }
  }
  if (process.env.EL_NINO_HISTORICO_FILE) {
    paths.unshift(process.env.EL_NINO_HISTORICO_FILE);
  }
  return paths;
}

function normalizarLinhaHistorica(raw: Record<string, unknown>): any | null {
  const par = lerAnoMesLinha(raw);
  if (!par) return null;
  const geocode = Number(raw.geocode ?? raw.GEOCODE ?? 0);
  const casos = casosConfirmadosDeLinha(raw);
  const mesLabel = String(raw.Mes ?? raw.mes ?? MESES[par.mesNum - 1] ?? '');
  return {
    ...raw,
    geocode: geocode > 0 ? geocode : raw.geocode,
    Ano: par.ano,
    MesNum: par.mesNum,
    Mes: mesLabel,
    AnoMes: String(raw.AnoMes ?? `${par.ano}-${String(par.mesNum).padStart(2, '0')}`),
    CasosDengue: casos,
    casos_notificados: Number(raw.casos_notificados ?? casos),
    casos_estimados: Number(raw.casos_estimados ?? 0),
    _fonte_historico: true,
  };
}

function extrairLinhasDoJson(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw?.linhas)) return raw.linhas;
  if (Array.isArray(raw?.df_mensal_mun)) return raw.df_mensal_mun;
  if (Array.isArray(raw?.features)) {
    return raw.features.map((f: any) => ({
      ...(f.properties ?? {}),
      geocode: f.properties?.geocode ?? f.properties?.GEOCODE,
    }));
  }
  if (Array.isArray(raw)) return raw;
  return [];
}

function extrairSerieDoJson(raw: any): any[] {
  if (!raw) return [];
  const candidatos = [
    raw.df_serie_historica,
    raw.df_serie,
    raw.serie,
    raw.serie_consolidada,
  ];
  for (const arr of candidatos) {
    if (Array.isArray(arr) && arr.length) return arr;
  }
  return [];
}

/** Carrega pacote histórico leve (cache por mtime). */
export function carregarHistoricoMensal(contratoId?: number): {
  linhas: any[];
  serie: any[];
  fonte: string | null;
} {
  let fileUsado: string | null = null;
  let raw: any = null;

  for (const file of candidatosArquivoHistorico(contratoId)) {
    if (!file || !fs.existsSync(file)) continue;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      fileUsado = file;
      break;
    } catch {
      /* tenta próximo */
    }
  }

  const mtime = fileUsado ? mtimeArquivo(fileUsado) : 0;
  if (
    cacheHistorico &&
    cacheHistorico.mtime === mtime &&
    cacheHistorico.fonte === fileUsado
  ) {
    return cacheHistorico;
  }

  const linhas = extrairLinhasDoJson(raw)
    .map((r) => normalizarLinhaHistorica(r))
    .filter(Boolean) as any[];

  const serie = extrairSerieDoJson(raw)
    .map((r) => normalizarLinhaHistorica({ ...r, geocode: 0 }))
    .filter(Boolean) as any[];

  cacheHistorico = {
    mtime,
    linhas,
    serie,
    fonte: fileUsado,
  };
  return cacheHistorico;
}

function chaveMensal(r: { geocode?: number; Ano?: number; MesNum?: number }) {
  return `${Number(r.geocode)}|${Number(r.Ano)}|${Number(r.MesNum)}`;
}

function chaveAnoMes(r: { Ano?: number; MesNum?: number }) {
  return `${Number(r.Ano)}|${Number(r.MesNum)}`;
}

/** Soma linhas municipais em série mensal agregada (consórcio / visão gerencial). */
export function somarSeriePorMes(linhas: any[]): any[] {
  const map = new Map<string, any>();
  for (const r of linhas) {
    const ano = Number(r.Ano);
    const mes = Number(r.MesNum);
    if (!Number.isFinite(ano) || !Number.isFinite(mes)) continue;
    const k = `${ano}|${mes}`;
    if (!map.has(k)) {
      map.set(k, {
        ...r,
        Ano: ano,
        MesNum: mes,
        Mes: r.Mes ?? MESES[mes - 1],
        CasosDengue: 0,
        casos_notificados: 0,
        casos_estimados: 0,
      });
    }
    const acc = map.get(k)!;
    const casos = casosConfirmadosDeLinha(r);
    acc.CasosDengue += casos;
    acc.casos_notificados += Number(r.casos_notificados ?? casos);
    acc.casos_estimados += Number(r.casos_estimados ?? 0);
    if (r.Temperatura != null && acc.Temperatura == null) {
      acc.Temperatura = r.Temperatura;
    }
    if (r.Precipitacao != null && acc.Precipitacao == null) {
      acc.Precipitacao = r.Precipitacao;
    }
    if (r.ONI != null && acc.ONI == null) acc.ONI = r.ONI;
    if (r.TipoElNino && !acc.TipoElNino) acc.TipoElNino = r.TipoElNino;
    if (r.ElNino != null && acc.ElNino == null) acc.ElNino = r.ElNino;
  }
  return [...map.values()].sort(
    (a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum,
  );
}

function mesclarSerieHistorica(serieAtual: any[], serieHist: any[]): any[] {
  if (!serieHist.length) return serieAtual;
  const map = new Map<string, any>();
  for (const r of serieHist) {
    const k = chaveAnoMes(r);
    if (k !== 'NaN|NaN') map.set(k, r);
  }
  for (const r of serieAtual) {
    const k = chaveAnoMes(r);
    if (k !== 'NaN|NaN') map.set(k, r);
  }
  return [...map.values()].sort(
    (a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum,
  );
}

function anoMinimoSerie(rows: any[]): number | null {
  let min: number | null = null;
  for (const r of rows) {
    const par = lerAnoMesLinha(r);
    if (!par) continue;
    min = min == null ? par.ano : Math.min(min, par.ano);
  }
  return min;
}

function geocodesContrato(contratoId: number): Set<number> {
  const out = new Set<number>();
  try {
    const raw = JSON.parse(fs.readFileSync(LISTA_FILE, 'utf8'));
    const c = (raw.consorcios ?? []).find(
      (x: { id?: number }) => Number(x.id) === contratoId,
    );
    if (!c) return out;
    const muns = Array.isArray(c.municipios)
      ? c.municipios
      : c.municipios
        ? [c.municipios]
        : [];
    for (const m of muns) {
      const gc = Number(m.geocode);
      if (gc > 0) out.add(gc);
    }
  } catch {
    /* lista opcional */
  }
  return out;
}

/**
 * Completa df_mensal_mun / df_serie com anos 2020–2022 do JSON histórico leve.
 */
export function enriquecerComHistoricoMensal(
  dados: any,
  contratoId?: number,
): any {
  if (!dados) return dados;

  const { linhas: histLinhas, serie: histSerie, fonte } =
    carregarHistoricoMensal(contratoId);
  if (!histLinhas.length && !histSerie.length) return dados;

  const geocodesDoContratoSet =
    contratoId != null ? geocodesContrato(contratoId) : new Set<number>();

  const dfAtual: any[] = [...(dados.df_mensal_mun ?? [])];
  const presentes = new Set(dfAtual.map((r) => chaveMensal(r)));
  let inseridos = 0;

  for (const row of histLinhas) {
    const par = lerAnoMesLinha(row);
    if (!par || par.ano < ANO_INICIO_PADRAO || par.ano > ANO_HISTORICO_FIM) {
      continue;
    }
    const gc = Number(row.geocode);
    if (
      geocodesDoContratoSet.size > 0 &&
      (!Number.isFinite(gc) || gc <= 0 || !geocodesDoContratoSet.has(gc))
    ) {
      continue;
    }
    const k = chaveMensal(row);
    if (presentes.has(k)) continue;
    presentes.add(k);
    dfAtual.push(row);
    inseridos += 1;
  }

  const dfFiltrado =
    geocodesDoContratoSet.size > 0
      ? dfAtual.filter((r) => geocodesDoContratoSet.has(Number(r.geocode)))
      : dfAtual;

  let dfSerie = dados.df_serie ?? [];
  let dfSeriePond = dados.df_serie_ponderada ?? [];

  const precisaRebuild =
    inseridos > 0 ||
    (histSerie.length > 0 &&
      anoMinimoSerie(dfSerie) != null &&
      (anoMinimoSerie(dfSerie) as number) > ANO_INICIO_PADRAO);

  if (precisaRebuild && dfFiltrado.length) {
    const reconstruida = somarSeriePorMes(dfFiltrado);
    dfSerie = mesclarSerieHistorica(reconstruida, histSerie);
    dfSeriePond = dfSerie;
  } else if (histSerie.length) {
    dfSerie = mesclarSerieHistorica(dfSerie, histSerie);
    dfSeriePond = mesclarSerieHistorica(dfSeriePond, histSerie);
  }

  const anoInicio = Math.min(
    ANO_INICIO_PADRAO,
    anoMinimoSerie(dfSerie) ?? ANO_INICIO_PADRAO,
    Number(dados.ano_inicio ?? ANO_INICIO_PADRAO),
  );

  const avisos = [...(dados.avisos ?? [])];
  if (inseridos > 0 || histSerie.length) {
    const rotulo = fonte ? path.basename(fonte) : 'histórico';
    avisos.push(
      `Série 2020–2022: +${inseridos} linhas municipais via ${rotulo}.`,
    );
  }

  return {
    ...dados,
    df_mensal_mun: dfAtual,
    df_serie: dfSerie,
    df_serie_ponderada: dfSeriePond.length ? dfSeriePond : dfSerie,
    ano_inicio: anoInicio,
    avisos,
  };
}

export function invalidarCacheHistoricoMensal(): void {
  cacheHistorico = null;
}
