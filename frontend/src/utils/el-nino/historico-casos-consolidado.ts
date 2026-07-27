/**
 * Histórico consolidado de casos (2020–2022) em arquivo leve (.gjson / .json).
 *
 * Arquivo esperado em src/utils/el-nino/data/:
 *   - casos_historico_consolidado.gjson  (preferido)
 *   - casos_historico_consolidado.json
 *
 * Formato compacto (recomendado):
 * {
 *   "meta": { "ano_inicio": 2020, "ano_fim": 2022, "fonte": "Infodengue" },
 *   "linhas": [
 *     { "g": 3106408, "a": 2020, "m": 1, "cn": 12, "ce": 15 }
 *   ]
 * }
 *
 * Também aceita linhas completas (geocode, Ano, MesNum, casos_notificados, ...).
 */
import fs from 'fs';
import path from 'path';
import { ANO_INICIO_PADRAO } from './constants';
import { casosConfirmadosDeLinha } from './graficos-filtros';
import { resolverNomeMunicipio } from './contracts';

const DATA_DIR = path.join(process.cwd(), 'src', 'utils', 'el-nino', 'data');
const MESES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

const NOMES_ARQUIVO = [
  'casos_historico_consolidado.gjson',
  'casos_historico_consolidado.json',
  'historico_casos_consolidado.gjson',
  'historico_casos_consolidado.json',
];

/** Até este ano inclusivo, linhas do histórico preenchem lacunas do pipeline. */
export const ANO_FIM_HISTORICO_CONSOLIDADO = 2022;

let cacheHistorico: {
  mtimeMs: number;
  linhas: any[];
  meta: Record<string, unknown>;
} | null = null;

function chaveMensal(r: { geocode?: number; Ano?: number; MesNum?: number }) {
  return `${Number(r.geocode)}|${Number(r.Ano)}|${Number(r.MesNum)}`;
}

function normalizarLinhaHistorico(raw: Record<string, unknown>): any | null {
  const geocode = Number(raw.geocode ?? raw.g ?? raw.gc);
  const ano = Number(raw.Ano ?? raw.ano ?? raw.a);
  let mesNum = Number(raw.MesNum ?? raw.mes_num ?? raw.m ?? raw.mes);
  if (!Number.isFinite(geocode) || geocode <= 0) return null;
  if (!Number.isFinite(ano) || ano < ANO_INICIO_PADRAO) return null;
  if (!Number.isFinite(mesNum) || mesNum < 1 || mesNum > 12) {
    const mesStr = String(raw.Mes ?? raw.mes_label ?? '').trim();
    const idx = MESES.findIndex(
      (m) => m.toLowerCase() === mesStr.toLowerCase().slice(0, 3),
    );
    if (idx < 0) return null;
    mesNum = idx + 1;
  }

  const cn = Number(
    raw.casos_notificados ?? raw.cn ?? raw.n ?? raw.casos ?? 0,
  );
  const ce = Number(
    raw.casos_estimados ?? raw.ce ?? raw.c ?? raw.CasosDengue ?? cn,
  );
  const municipio = String(
    raw.municipio ?? raw.nome ?? resolverNomeMunicipio(geocode),
  );

  return {
    geocode,
    municipio,
    nome: municipio,
    Ano: ano,
    MesNum: mesNum,
    Mes: String(raw.Mes ?? MESES[mesNum - 1]),
    'Ano Mes': String(raw['Ano Mes'] ?? `${ano}-${String(mesNum).padStart(2, '0')}`),
    AnoMes: String(raw.AnoMes ?? `${ano}-${String(mesNum).padStart(2, '0')}`),
    CasosDengue: Number.isFinite(ce) ? ce : cn,
    casos_notificados: Number.isFinite(cn) ? cn : ce,
    casos_estimados: Number.isFinite(ce) ? ce : cn,
    _fonte_historico: true,
  };
}

function extrairLinhasPayload(raw: unknown): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((r) => normalizarLinhaHistorico(r as Record<string, unknown>))
      .filter(Boolean);
  }
  const obj = raw as Record<string, unknown>;
  const lista =
    (obj.linhas as unknown[]) ??
    (obj.registros as unknown[]) ??
    (obj.rows as unknown[]) ??
    (obj.data as unknown[]) ??
    [];
  if (!Array.isArray(lista)) return [];
  return lista
    .map((r) => normalizarLinhaHistorico(r as Record<string, unknown>))
    .filter(Boolean);
}

export function caminhoHistoricoConsolidado(): string | null {
  for (const nome of NOMES_ARQUIVO) {
    const p = path.join(DATA_DIR, nome);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Carrega histórico consolidado (cache por mtime). */
export function carregarHistoricoConsolidado(): {
  linhas: any[];
  meta: Record<string, unknown>;
  arquivo: string | null;
} {
  const arquivo = caminhoHistoricoConsolidado();
  if (!arquivo) {
    return { linhas: [], meta: {}, arquivo: null };
  }

  try {
    const stat = fs.statSync(arquivo);
    if (
      cacheHistorico &&
      cacheHistorico.mtimeMs === stat.mtimeMs &&
      cacheHistorico.linhas.length
    ) {
      return { linhas: cacheHistorico.linhas, meta: cacheHistorico.meta, arquivo };
    }

    const raw = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    const linhas = extrairLinhasPayload(raw).filter(
      (r) => r.Ano <= ANO_FIM_HISTORICO_CONSOLIDADO,
    );
    const meta =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? ((raw as Record<string, unknown>).meta as Record<string, unknown>) ?? {}
        : {};

    cacheHistorico = { mtimeMs: stat.mtimeMs, linhas, meta };
    return { linhas, meta, arquivo };
  } catch {
    return { linhas: [], meta: {}, arquivo };
  }
}

export function invalidarCacheHistoricoConsolidado(): void {
  cacheHistorico = null;
}

/** Soma casos por mês (regional) a partir de df_mensal_mun. */
export function agregarSeriePorMes(dfMensal: any[]): any[] {
  const map = new Map<string, any>();
  for (const r of dfMensal) {
    const ano = Number(r.Ano);
    const mes = Number(r.MesNum);
    if (!Number.isFinite(ano) || !Number.isFinite(mes)) continue;
    const k = `${ano}|${mes}`;
    if (!map.has(k)) {
      map.set(k, {
        Ano: ano,
        MesNum: mes,
        Mes: r.Mes ?? MESES[mes - 1],
        'Ano Mes': r['Ano Mes'] ?? `${ano}-${String(mes).padStart(2, '0')}`,
        CasosDengue: 0,
        casos_notificados: 0,
        casos_estimados: 0,
        Temperatura: r.Temperatura ?? null,
        Precipitacao: r.Precipitacao ?? null,
        Umidade: r.Umidade ?? null,
        ONI: r.ONI ?? null,
        TipoElNino: r.TipoElNino ?? '',
        ElNino: r.ElNino ?? 0,
      });
    }
    const acc = map.get(k)!;
    const casos = casosConfirmadosDeLinha(r);
    acc.CasosDengue += casos;
    acc.casos_notificados += Number(r.casos_notificados ?? casos);
    acc.casos_estimados += Number(r.casos_estimados ?? casos);
    if (r.Temperatura != null && acc.Temperatura == null) {
      acc.Temperatura = r.Temperatura;
    }
    if (r.ONI != null && acc.ONI == null) acc.ONI = r.ONI;
  }
  return [...map.values()].sort(
    (a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum,
  );
}

export interface MesclarHistoricoOpts {
  /** Limita geocodes (escopo do contrato / filtro). */
  geocodes?: Set<number> | number[];
  /** Reconstrói df_serie e df_serie_ponderada após merge. */
  reconstruirSerie?: boolean;
}

/**
 * Preenche df_mensal_mun com anos 2020–2022 (ou meta do arquivo) quando
 * o pipeline local não tem a linha geocode|ano|mês.
 */
export function mesclarHistoricoConsolidado(
  dados: any,
  opts: MesclarHistoricoOpts = {},
): any {
  if (!dados) return dados;

  const { linhas: historico, arquivo, meta } = carregarHistoricoConsolidado();
  if (!historico.length) return dados;

  const geocodeSet =
    opts.geocodes != null
      ? new Set(
          (Array.isArray(opts.geocodes)
            ? opts.geocodes
            : [...opts.geocodes]
          ).map(Number).filter((g) => g > 0),
        )
      : null;

  const existentes = new Set<string>();
  for (const r of dados.df_mensal_mun ?? []) {
    existentes.add(chaveMensal(r));
  }

  const anoFimHist = Number(meta.ano_fim ?? ANO_FIM_HISTORICO_CONSOLIDADO);
  const anoIniHist = Number(meta.ano_inicio ?? ANO_INICIO_PADRAO);
  const extras: any[] = [];

  for (const row of historico) {
    if (row.Ano < anoIniHist || row.Ano > anoFimHist) continue;
    if (geocodeSet && !geocodeSet.has(Number(row.geocode))) continue;
    const k = chaveMensal(row);
    if (existentes.has(k)) continue;
    extras.push(row);
    existentes.add(k);
  }

  if (!extras.length) return dados;

  const df_mensal_mun = [...(dados.df_mensal_mun ?? []), ...extras].sort(
    (a, b) =>
      Number(a.geocode) - Number(b.geocode) ||
      a.Ano - b.Ano ||
      a.MesNum - b.MesNum,
  );

  const fontes = [...new Set([...(dados.fontes ?? []), meta.fonte ?? arquivo])];
  const avisos = [
    ...(dados.avisos ?? []),
    `Histórico consolidado: +${extras.length} linhas (${anoIniHist}–${anoFimHist}) de ${path.basename(arquivo ?? 'casos_historico_consolidado.gjson')}.`,
  ];

  let out = { ...dados, df_mensal_mun, fontes, avisos };

  if (opts.reconstruirSerie !== false) {
    const dfSerie = agregarSeriePorMes(df_mensal_mun);
    out = {
      ...out,
      df_serie: dfSerie,
      df_serie_ponderada: dfSerie,
    };
  }

  return out;
}

/** Geocodes do escopo do pacote (municipios + df_mensal_mun). */
export function geocodesEscopoPacote(dados: any): number[] {
  const set = new Set<number>();
  for (const m of dados?.municipios ?? []) {
    const gc = Number(m.geocode);
    if (gc > 0) set.add(gc);
  }
  for (const r of dados?.df_mensal_mun ?? []) {
    const gc = Number(r.geocode);
    if (gc > 0) set.add(gc);
  }
  return [...set];
}

export function aplicarHistoricoConsolidado(dados: any): any {
  const geocodes = geocodesEscopoPacote(dados);
  return mesclarHistoricoConsolidado(dados, {
    geocodes: geocodes.length ? geocodes : undefined,
    reconstruirSerie: true,
  });
}
