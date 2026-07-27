import { normalizePublicApiBaseUrl } from '../../config/api';
import { buscarNomeMunicipioLista, obterConsorcio } from './contracts';
import { ANO_INICIO_PADRAO, anoFimDados } from './constants';

const ALERTCITY = 'https://info.dengue.mat.br/api/alertcity';
const MESES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

const ANO_INICIO = ANO_INICIO_PADRAO;
const ANO_FIM = anoFimDados();
const CACHE_TTL_MS = 30 * 60 * 1000;

const memoriaCasos = new Map<string, { exp: number; rows: any[] }>();

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

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function paraLinhasMensais(geocode: number, municipio: string, semanas: RegistroSemanal[]) {
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

export async function buscarCasosMensaisInfodengue(
  geocode: number,
  municipio?: string,
): Promise<any[]> {
  const gc = Number(geocode);
  const nome = municipio || buscarNomeMunicipioLista(gc) || `Município ${gc}`;
  const cacheKey = `${gc}:${ANO_INICIO}-${ANO_FIM}`;
  const hit = memoriaCasos.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.rows;

  try {
    const semanas = await buscarSemanasInfodengue(gc, ANO_INICIO, ANO_FIM);
    const rows = paraLinhasMensais(gc, nome, semanas);
    if (rows.length) {
      memoriaCasos.set(cacheKey, { rows, exp: Date.now() + CACHE_TTL_MS });
    }
    return rows;
  } catch {
    return [];
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
