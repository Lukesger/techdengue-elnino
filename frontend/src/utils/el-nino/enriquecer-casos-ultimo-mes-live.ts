/**
 * Último mês de casos (visão gerencial) via Infodengue AlertCity.
 *
 * Hot path: lê cache disco/memória e devolve na hora.
 * Background: soma ~627 geocodes (janela curta, concorrência limitada).
 * Nunca bloqueia GET /kpis nos 627 HTTP.
 */
import fs from 'node:fs';
import {
  escreverJsonAtomico,
  runtimePath,
} from './cache-paths';
import { buscarCasosMensaisInfodengue } from './infodengue-fallback';

const MESES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

/** TTL alinhado ao overview gerencial (6 h). */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FILE_CACHE = runtimePath('visao_gerencial', 'ultimo_mes_casos.json');
const GEOCODE_PROBE = 3106200;
const JANELA_SEMANAS = 12;
const CONCORRENCIA = 12;

export type MesConsolidadoCasos = {
  ano: number;
  mes: number;
  chave: number;
};

export type CasosUltimoMesLive = {
  ano: number;
  mes: number;
  casos: number;
  n_municipios: number;
  atualizado_em: string;
  preliminar: boolean;
  fonte: string;
};

type LinhaCasosFingerprint = {
  Ano?: number;
  MesNum?: number;
  casos_notificados?: number | null;
  casos_estimados?: number | null;
  CasosDengue?: number | null;
  geocode?: number;
};

type CacheEnvelope = CasosUltimoMesLive & { expira_em: string };

let cacheMemoria: { payload: CasosUltimoMesLive; expiraEm: number } | null =
  null;
let rebuildInFlight: Promise<CasosUltimoMesLive | null> | null = null;

export function mesEhPreliminar(
  ano: number,
  mes: number,
  agora = new Date(),
): boolean {
  return ano === agora.getFullYear() && mes === agora.getMonth() + 1;
}

/**
 * Último mês com volume de casos > 0 (Infodengue consolidado).
 * Mesma regra de fingerprintMesConsolidado do Nest.
 */
export function fingerprintMesConsolidadoCasos(
  casos: LinhaCasosFingerprint[],
): MesConsolidadoCasos | null {
  let melhor: MesConsolidadoCasos | null = null;
  for (const r of casos) {
    const ano = Number(r.Ano);
    const mes = Number(r.MesNum);
    if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
      continue;
    }
    const notif = Number(r.casos_notificados ?? 0);
    const est = Number(r.casos_estimados ?? r.CasosDengue ?? 0);
    if (!Number.isFinite(notif) && !Number.isFinite(est)) continue;
    if (Math.max(notif || 0, est || 0) <= 0) continue;

    const chave = ano * 100 + mes;
    if (!melhor || chave > melhor.chave) {
      melhor = { ano, mes, chave };
    }
  }
  return melhor;
}

export function ultimoMesSnapshotDePacote(dados: {
  df_serie_ponderada?: LinhaCasosFingerprint[];
  df_serie?: LinhaCasosFingerprint[];
}): MesConsolidadoCasos | null {
  const serie =
    dados.df_serie_ponderada?.length
      ? dados.df_serie_ponderada
      : dados.df_serie ?? [];
  return fingerprintMesConsolidadoCasos(serie);
}

export function anexarCasosUltimoMesLive<T extends Record<string, unknown>>(
  dados: T,
  live: CasosUltimoMesLive | null | undefined,
): T {
  if (!dados || !live) return dados;
  return { ...dados, casos_ultimo_mes_live: live };
}

function geocodesDoPacote(dados: {
  municipios?: Array<{ geocode?: number }>;
}): number[] {
  const out: number[] = [];
  const vistos = new Set<number>();
  for (const m of dados.municipios ?? []) {
    const gc = Number(m.geocode);
    if (!Number.isFinite(gc) || gc <= 0 || vistos.has(gc)) continue;
    vistos.add(gc);
    out.push(gc);
  }
  return out;
}

function volumeCasosLinha(r: LinhaCasosFingerprint): number {
  const est = Number(r.CasosDengue ?? r.casos_estimados ?? 0);
  return Number.isFinite(est) ? Math.max(0, est) : 0;
}

function lerCacheDisco(): CasosUltimoMesLive | null {
  try {
    if (!fs.existsSync(FILE_CACHE)) return null;
    const raw = JSON.parse(fs.readFileSync(FILE_CACHE, 'utf8')) as CacheEnvelope;
    const ano = Number(raw.ano);
    const mes = Number(raw.mes);
    const casos = Number(raw.casos);
    if (
      !Number.isFinite(ano) ||
      !Number.isFinite(mes) ||
      mes < 1 ||
      mes > 12 ||
      !Number.isFinite(casos)
    ) {
      return null;
    }
    const payload: CasosUltimoMesLive = {
      ano,
      mes,
      casos: Math.round(casos),
      n_municipios: Number(raw.n_municipios) || 0,
      atualizado_em: String(raw.atualizado_em ?? ''),
      preliminar: Boolean(raw.preliminar),
      fonte: String(raw.fonte || 'Infodengue AlertCity'),
    };
    const exp = raw.expira_em ? Date.parse(raw.expira_em) : 0;
    cacheMemoria = {
      payload,
      expiraEm: Number.isFinite(exp) ? exp : 0,
    };
    return payload;
  } catch {
    return null;
  }
}

function cacheFresh(agora = Date.now()): CasosUltimoMesLive | null {
  if (cacheMemoria && cacheMemoria.expiraEm > agora) {
    return cacheMemoria.payload;
  }
  const disco = lerCacheDisco();
  if (disco && cacheMemoria && cacheMemoria.expiraEm > agora) {
    return disco;
  }
  return null;
}

/** Cache mesmo expirado (stale-while-revalidate). */
function cacheStale(): CasosUltimoMesLive | null {
  if (cacheMemoria?.payload) return cacheMemoria.payload;
  return lerCacheDisco();
}

function gravarCache(live: CasosUltimoMesLive): void {
  const expiraEm = Date.now() + CACHE_TTL_MS;
  cacheMemoria = { payload: live, expiraEm };
  const envelope: CacheEnvelope = {
    ...live,
    expira_em: new Date(expiraEm).toISOString(),
  };
  escreverJsonAtomico(FILE_CACHE, envelope);
}

export function invalidarCacheUltimoMesCasos(): void {
  cacheMemoria = null;
  try {
    if (fs.existsSync(FILE_CACHE)) fs.unlinkSync(FILE_CACHE);
  } catch {
    /* ignore */
  }
}

async function mapComConcorrencia<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concorrencia = CONCORRENCIA,
): Promise<R[]> {
  if (!items.length) return [];
  const resultados: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concorrencia, items.length) },
    async () => {
      while (cursor < items.length) {
        const i = cursor;
        cursor += 1;
        resultados[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
  return resultados;
}

function agregarUltimoMes(
  linhas: LinhaCasosFingerprint[],
  fp: MesConsolidadoCasos,
): { casos: number; n_municipios: number } {
  let casos = 0;
  const geos = new Set<number>();
  for (const r of linhas) {
    if (Number(r.Ano) !== fp.ano || Number(r.MesNum) !== fp.mes) continue;
    casos += volumeCasosLinha(r);
    const gc = Number(r.geocode);
    if (Number.isFinite(gc) && gc > 0) geos.add(gc);
  }
  return { casos: Math.round(casos), n_municipios: geos.size };
}

async function rebuildUltimoMesCasos(
  geocodes: number[],
): Promise<CasosUltimoMesLive | null> {
  const geolist = geocodes.filter((g) => Number.isFinite(g) && g > 0);
  if (!geolist.length) return null;

  const opts = { janelaSemanas: JANELA_SEMANAS as number };

  let probeFp: MesConsolidadoCasos | null = null;
  try {
    const probe = await buscarCasosMensaisInfodengue(
      GEOCODE_PROBE,
      'Belo Horizonte',
      opts,
    );
    probeFp = fingerprintMesConsolidadoCasos(probe);
  } catch {
    probeFp = null;
  }

  const blocos = await mapComConcorrencia(
    geolist,
    async (gc) => {
      try {
        return await buscarCasosMensaisInfodengue(gc, undefined, opts);
      } catch {
        return [] as LinhaCasosFingerprint[];
      }
    },
    CONCORRENCIA,
  );

  const todas = blocos.flat();
  const fp = fingerprintMesConsolidadoCasos(todas) ?? probeFp;
  if (!fp) return null;

  const agg = agregarUltimoMes(todas, fp);
  const live: CasosUltimoMesLive = {
    ano: fp.ano,
    mes: fp.mes,
    casos: agg.casos,
    n_municipios: agg.n_municipios || geolist.length,
    atualizado_em: new Date().toISOString(),
    preliminar: mesEhPreliminar(fp.ano, fp.mes),
    fonte: 'Infodengue AlertCity',
  };
  gravarCache(live);
  console.info(
    `[visao-gerencial] último mês casos live ${MESES[fp.mes - 1]}/${fp.ano} · ${live.casos} (${live.n_municipios} mun.)`,
  );
  return live;
}

/**
 * Dispara rebuild em background (singleflight). Não espera os 627.
 */
export function agendarRebuildUltimoMesCasos(geocodes: number[]): void {
  if (rebuildInFlight != null) return;
  if (cacheFresh()) return;
  rebuildInFlight = rebuildUltimoMesCasos(geocodes)
    .catch((err) => {
      console.warn(
        '[visao-gerencial] rebuild último mês casos falhou:',
        (err as Error)?.message ?? err,
      );
      return null;
    })
    .finally(() => {
      rebuildInFlight = null;
    });
}

/**
 * Anexa `casos_ultimo_mes_live` se o cache existir.
 * Cache miss/stale: devolve o pacote e agenda rebuild.
 */
export async function enriquecerPacoteComCasosUltimoMes<
  T extends Record<string, unknown>,
>(dados: T): Promise<T> {
  if (!dados) return dados;

  const fresh = cacheFresh();
  if (fresh) return anexarCasosUltimoMesLive(dados, fresh);

  const stale = cacheStale();
  const geocodes = geocodesDoPacote(
    dados as { municipios?: Array<{ geocode?: number }> },
  );
  agendarRebuildUltimoMesCasos(geocodes);

  if (stale) return anexarCasosUltimoMesLive(dados, stale);
  return dados;
}
