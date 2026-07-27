import { LinhaClimaMensal } from './mesclar-clima';
import { ANO_INICIO_PADRAO } from './constants';
import { fetchComTls } from './tls-fetch';

const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const MESES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

export const ANO_INICIO = ANO_INICIO_PADRAO;
/** Ano fim do archive: inclui ano corrente (meses já ocorridos). */
export const ANO_FIM = new Date().getFullYear();

function round(v: number, d = 1) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function validarTemp(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(45, Math.max(0, n)) : 0;
}

function validarChuva(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function validarUmid(v: unknown): number {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, n);
}

/** Open-Meteo Archive rejeita end_date no futuro (ex.: 2026-12-31 → 400). */
export function dataFimArchiveIso(anoFim: number): string {
  const agora = new Date();
  const y = Math.min(Math.max(Number(anoFim) || ANO_FIM, ANO_INICIO), agora.getFullYear());
  if (y < agora.getFullYear()) {
    return `${y}-12-31`;
  }
  const mm = String(agora.getMonth() + 1).padStart(2, '0');
  const dd = String(agora.getDate()).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function agregarDiarioParaMensal(
  geocode: number,
  municipio: string,
  daily: {
    time?: string[];
    temperature_2m_mean?: number[];
    temperature_2m_max?: number[];
    precipitation_sum?: number[];
    relative_humidity_2m_mean?: number[];
  },
): LinhaClimaMensal[] {
  const times: string[] = daily.time ?? [];
  const porMes = new Map<
    string,
    { temps: number[]; maxs: number[]; chuvas: number[]; umids: number[] }
  >();

  for (let i = 0; i < times.length; i += 1) {
    const [anoStr, mesStr] = times[i].split('-');
    const ano = Number(anoStr);
    const mes = Number(mesStr);
    const k = `${ano}-${mes}`;
    if (!porMes.has(k)) {
      porMes.set(k, { temps: [], maxs: [], chuvas: [], umids: [] });
    }
    const g = porMes.get(k)!;
    g.temps.push(validarTemp(daily.temperature_2m_mean?.[i]));
    g.maxs.push(validarTemp(daily.temperature_2m_max?.[i]));
    g.chuvas.push(validarChuva(daily.precipitation_sum?.[i]));
    g.umids.push(validarUmid(daily.relative_humidity_2m_mean?.[i]));
  }

  const linhas: LinhaClimaMensal[] = [];
  for (const [k, g] of porMes.entries()) {
    const [ano, mes] = k.split('-').map(Number);
    if (!g.temps.length) continue;
    const tempsPos = g.temps.filter((t) => t > 0);
    if (!tempsPos.length) continue;
    linhas.push({
      geocode,
      municipio,
      Ano: ano,
      MesNum: mes,
      Mes: MESES[mes - 1],
      Temperatura: round(tempsPos.reduce((a, b) => a + b, 0) / tempsPos.length),
      TempMax: round(
        (g.maxs.filter((t) => t > 0).reduce((a, b) => a + b, 0) ||
          tempsPos.reduce((a, b) => a + b, 0)) /
          (g.maxs.filter((t) => t > 0).length || tempsPos.length),
      ),
      Precipitacao: round(g.chuvas.reduce((a, b) => a + b, 0), 1),
      Umidade: Math.round(g.umids.reduce((a, b) => a + b, 0) / g.umids.length),
      _fonte_clima: 'Open-Meteo Archive',
    });
  }

  return linhas.sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum);
}

export async function buscarHistoricoMensalOpenMeteo(
  geocode: number,
  municipio: string,
  lat: number,
  lon: number,
  anoInicio = ANO_INICIO,
  anoFim = ANO_FIM,
): Promise<LinhaClimaMensal[]> {
  const start = `${Math.max(ANO_INICIO, Number(anoInicio) || ANO_INICIO)}-01-01`;
  const end = dataFimArchiveIso(anoFim);

  const montarUrl = (endDate: string) => {
    const url = new URL(OPEN_METEO_ARCHIVE);
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('start_date', start);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set(
      'daily',
      'temperature_2m_mean,temperature_2m_max,precipitation_sum,relative_humidity_2m_mean',
    );
    url.searchParams.set('timezone', 'America/Sao_Paulo');
    return url;
  };

  let lastStatus = 0;
  let endDate = end;
  for (let tentativa = 0; tentativa < 4; tentativa += 1) {
    if (tentativa > 0) {
      await new Promise((r) => setTimeout(r, 1500 * tentativa));
    }
    const res = await fetchComTls(montarUrl(endDate).toString(), {
      signal: AbortSignal.timeout(45000),
    });
    lastStatus = res.status;
    if (res.status === 429) continue;

    // end_date no futuro → 400; recorta para hoje e tenta de novo.
    if (res.status === 400 && endDate !== dataFimArchiveIso(ANO_FIM)) {
      endDate = dataFimArchiveIso(ANO_FIM);
      continue;
    }
    if (res.status === 400) {
      endDate = dataFimArchiveIso(new Date().getFullYear());
      if (tentativa < 3) continue;
      return [];
    }
    if (!res.ok) return [];

    const dados = (await res.json()) as any;
    return agregarDiarioParaMensal(geocode, municipio, dados.daily ?? {});
  }

  if (lastStatus === 429) {
    throw new Error('Open-Meteo rate limit (429)');
  }
  return [];
}
