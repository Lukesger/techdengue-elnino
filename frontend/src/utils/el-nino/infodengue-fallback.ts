import { normalizePublicApiBaseUrl } from '../../config/api';
import { buscarNomeMunicipioLista, obterConsorcio } from './contracts';
import { ANO_INICIO_PADRAO, anoFimDados } from './constants';
import { fetchComTls } from './tls-fetch';
import fs from 'fs';
import {
  escreverJsonAtomico,
  garantirDirRuntime,
  runtimePath,
  seedPath,
} from './cache-paths';

const ALERTCITY = 'https://info.dengue.mat.br/api/alertcity';
const MESES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

const ANO_INICIO = ANO_INICIO_PADRAO;
const ANO_FIM = anoFimDados();
/** Disco: 12h — evita Infodengue no hot path do painel. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CONSOLIDADO_FILE = seedPath('casos_historico_consolidado.gjson');

const memoriaCasos = new Map<string, { exp: number; rows: any[] }>();
let consolidadoIndex: Map<number, any[]> | null = null;

interface RegistroSemanal {
  SE?: string | number;
  data_iniSE?: string | number;
  casos_est?: number;
  casos?: number;
}

function validarCasos(v: unknown): number {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, n);
}

function garantirDirMensal(): void {
  garantirDirRuntime('infodengue_mensal');
}

function arquivoMensal(geocode: number): string {
  return runtimePath('infodengue_mensal', `${Number(geocode)}.json`);
}

function lerDiscoMensal(geocode: number): any[] | null {
  try {
    const f = arquivoMensal(geocode);
    if (!fs.existsSync(f)) return null;
    const env = JSON.parse(fs.readFileSync(f, 'utf8')) as {
      expira_em?: string;
      rows?: any[];
    };
    const exp = env.expira_em ? Date.parse(env.expira_em) : 0;
    if (!Number.isFinite(exp) || exp <= Date.now() || !env.rows?.length) {
      return null;
    }
    return env.rows;
  } catch {
    return null;
  }
}

function gravarDiscoMensal(geocode: number, rows: any[]): void {
  if (!rows.length) return;
  try {
    garantirDirMensal();
    const env = {
      atualizado_em: new Date().toISOString(),
      expira_em: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      geocode: Number(geocode),
      ano_inicio: ANO_INICIO,
      ano_fim: ANO_FIM,
      rows,
    };
    const f = arquivoMensal(geocode);
    escreverJsonAtomico(f, env);
  } catch {
    /* ignore */
  }
}

/** Série histórica compacta — zero HTTP. */
function carregarConsolidadoPorGeocode(geocode: number): any[] {
  if (!consolidadoIndex) {
    consolidadoIndex = new Map();
    try {
      if (!fs.existsSync(CONSOLIDADO_FILE)) return [];
      const raw = JSON.parse(fs.readFileSync(CONSOLIDADO_FILE, 'utf8')) as {
        linhas?: Array<{
          g: number;
          a: number;
          m: number;
          cn: number;
          ce: number;
        }>;
      };
      for (const l of raw.linhas ?? []) {
        const gc = Number(l.g);
        if (!consolidadoIndex.has(gc)) consolidadoIndex.set(gc, []);
        consolidadoIndex.get(gc)!.push({
          geocode: gc,
          Ano: Number(l.a),
          MesNum: Number(l.m),
          Mes: MESES[Number(l.m) - 1],
          AnoMes: `${l.a}-${String(l.m).padStart(2, '0')}`,
          CasosDengue: Number(l.ce) || 0,
          casos_estimados: Number(l.ce) || 0,
          casos_notificados: Number(l.cn) || 0,
          _fonte: 'casos_historico_consolidado.gjson',
        });
      }
    } catch {
      consolidadoIndex = new Map();
    }
  }
  return consolidadoIndex.get(Number(geocode)) ?? [];
}

function mesclarLinhas(a: any[], b: any[]): any[] {
  const map = new Map<string, any>();
  for (const r of [...a, ...b]) {
    map.set(`${r.Ano}-${r.MesNum}`, r);
  }
  return Array.from(map.values()).sort(
    (x, y) => x.Ano - y.Ano || x.MesNum - y.MesNum,
  );
}

function anoMesDeSemana(reg: RegistroSemanal): [number, number] | null {
  const ts = reg.data_iniSE;
  if (ts) {
    try {
      const dt = new Date(Number(ts));
      if (Number.isFinite(dt.getTime())) {
        return [dt.getUTCFullYear(), dt.getUTCMonth() + 1];
      }
    } catch {
      /* skip */
    }
  }
  const se = String(reg.SE ?? '');
  if (se.length >= 6) {
    const ano = Number(se.slice(0, 4));
    const semana = Number(se.slice(4));
    const jan4 = new Date(Date.UTC(ano, 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (semana - 1) * 7);
    return [monday.getUTCFullYear(), monday.getUTCMonth() + 1];
  }
  return null;
}

function agregarSemanasMensal(
  semanas: RegistroSemanal[],
): Map<string, { casos_est: number; casos: number }> {
  const map = new Map<string, { casos_est: number; casos: number }>();
  for (const reg of semanas) {
    const chave = anoMesDeSemana(reg);
    if (!chave) continue;
    const k = chave.join('-');
    if (!map.has(k)) map.set(k, { casos_est: 0, casos: 0 });
    const g = map.get(k)!;
    g.casos_est += validarCasos(reg.casos_est);
    g.casos += validarCasos(reg.casos);
  }
  return map;
}

async function buscarSemanasInfodengue(
  geocode: number,
  eyStart: number,
  eyEnd: number,
): Promise<RegistroSemanal[]> {
  const url = new URL(ALERTCITY);
  url.searchParams.set('geocode', String(geocode));
  url.searchParams.set('disease', 'dengue');
  url.searchParams.set('format', 'json');
  url.searchParams.set('ew_start', '1');
  url.searchParams.set('ew_end', '53');
  url.searchParams.set('ey_start', String(eyStart));
  url.searchParams.set('ey_end', String(eyEnd));

  // Janela curta no hot path: só anos recentes (evita 5+ anos de semanas).
  const res = await fetchComTls(url.toString(), {
    signal: AbortSignal.timeout(18_000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function paraLinhasMensais(
  geocode: number,
  municipio: string,
  semanas: RegistroSemanal[],
) {
  const mensal = agregarSemanasMensal(semanas);
  const linhas: any[] = [];
  for (const [k, vals] of mensal.entries()) {
    const [ano, mes] = k.split('-').map(Number);
    if (ano < ANO_INICIO || ano > ANO_FIM) continue;
    linhas.push({
      geocode,
      municipio,
      Ano: ano,
      MesNum: mes,
      Mes: MESES[mes - 1],
      AnoMes: `${ano}-${String(mes).padStart(2, '0')}`,
      CasosDengue: vals.casos_est,
      casos_estimados: vals.casos_est,
      casos_notificados: vals.casos,
      _fonte: 'Infodengue AlertCity',
    });
  }
  linhas.sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum);
  return linhas;
}

/**
 * Série mensal Infodengue.
 * Ordem: memória → disco → consolidado local → HTTP (grava disco).
 */
export async function buscarCasosMensaisInfodengue(
  geocode: number,
  municipio?: string,
  opts?: { allowLive?: boolean },
): Promise<any[]> {
  const gc = Number(geocode);
  const nome = municipio || buscarNomeMunicipioLista(gc) || `Município ${gc}`;
  const allowLive = opts?.allowLive !== false;
  const cacheKey = `${gc}:${ANO_INICIO}-${ANO_FIM}`;
  const hit = memoriaCasos.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.rows;

  const doDisco = lerDiscoMensal(gc);
  if (doDisco?.length) {
    memoriaCasos.set(cacheKey, {
      rows: doDisco,
      exp: Date.now() + CACHE_TTL_MS,
    });
    return doDisco;
  }

  const consolidado = carregarConsolidadoPorGeocode(gc).map((r) => ({
    ...r,
    municipio: nome,
  }));

  if (!allowLive) {
    if (consolidado.length) {
      memoriaCasos.set(cacheKey, {
        rows: consolidado,
        exp: Date.now() + CACHE_TTL_MS,
      });
    }
    return consolidado;
  }

  try {
    // 2 anos recentes + consolidado histórico — bem mais rápido que 2020→hoje.
    const anoLiveInicio = Math.max(ANO_INICIO, ANO_FIM - 1);
    const semanas = await buscarSemanasInfodengue(gc, anoLiveInicio, ANO_FIM);
    const live = paraLinhasMensais(gc, nome, semanas);
    const rows = mesclarLinhas(consolidado, live);
    if (rows.length) {
      gravarDiscoMensal(gc, rows);
      memoriaCasos.set(cacheKey, { rows, exp: Date.now() + CACHE_TTL_MS });
    }
    return rows;
  } catch {
    return consolidado;
  }
}

async function buscarSerieBackend(
  auth: string,
  geocode: number,
  contratoId?: number,
  anoInicio?: number,
  anoFim?: number,
): Promise<any[]> {
  const base = normalizePublicApiBaseUrl(process.env.NEXT_PUBLIC_API_URL || '');
  if (!base) return [];

  const q = new URLSearchParams({ geocode: String(geocode) });
  if (contratoId != null && contratoId > 0) q.set('contratoId', String(contratoId));
  if (anoInicio != null) q.set('ano_inicio', String(anoInicio));
  if (anoFim != null) q.set('ano_fim', String(anoFim));

  const res = await fetch(`${base}/el-nino-analytics/serie?${q.toString()}`, {
    headers: { Authorization: auth, Accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { serie?: any[] };
  return Array.isArray(data.serie) ? data.serie : [];
}

/** Completa df_mensal_mun e municipios quando o cache local não tem o município. */
export async function enriquecerDadosParaKpis(
  dados: any,
  geocode: number,
  opts: {
    auth?: string;
    contratoId?: number;
    anoInicio?: number;
    anoFim?: number;
  } = {},
): Promise<any> {
  const gc = Number(geocode);
  if (!gc) return dados;

  const nome = buscarNomeMunicipioLista(gc);
  const municipios = [...(dados.municipios ?? [])];
  if (nome && !municipios.some((m: any) => Number(m.geocode) === gc)) {
    municipios.push({ geocode: gc, municipio: nome, nome });
  }

  const existentes = (dados.df_mensal_mun ?? []).filter(
    (r: any) => Number(r.geocode) === gc,
  );
  if (existentes.length) {
    return { ...dados, municipios };
  }

  let extra: any[] = [];
  if (opts.auth) {
    try {
      extra = await buscarSerieBackend(
        opts.auth,
        gc,
        opts.contratoId,
        opts.anoInicio,
        opts.anoFim,
      );
    } catch {
      /* upstream indisponível */
    }
  }
  if (!extra.length) {
    extra = await buscarCasosMensaisInfodengue(gc, nome ?? undefined);
  }
  if (!extra.length) {
    return { ...dados, municipios };
  }

  return {
    ...dados,
    municipios,
    df_mensal_mun: [...(dados.df_mensal_mun ?? []), ...extra],
  };
}

/** Enriquece todos os geocodes do escopo sem linhas em df_mensal_mun. */
export async function enriquecerDadosEscopo(
  dados: any,
  contratoId: number,
  opts: {
    auth?: string;
    anoInicio?: number;
    anoFim?: number;
  } = {},
): Promise<any> {
  const consorcio = obterConsorcio(contratoId);
  if (!consorcio?.municipios?.length) return dados;

  let out = dados;
  for (const m of consorcio.municipios) {
    const gc = Number(m.geocode);
    const existentes = (out.df_mensal_mun ?? []).filter(
      (r: any) => Number(r.geocode) === gc,
    );
    if (existentes.length) continue;
    out = await enriquecerDadosParaKpis(out, gc, {
      auth: opts.auth,
      contratoId,
      anoInicio: opts.anoInicio,
      anoFim: opts.anoFim,
    });
  }
  return out;
}
