import https from 'node:https';
import { ANO_INICIO_PADRAO } from './constants';

const NOAA_ONI_URL =
  'https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt';

/** TTL alinhado ao backend NestJS (24 h). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SEAS_MEIO_MES: Record<string, number> = {
  DJF: 1,
  JFM: 2,
  FMA: 3,
  MAM: 4,
  AMJ: 5,
  MJJ: 6,
  JJA: 7,
  JAS: 8,
  ASO: 9,
  SON: 10,
  OND: 11,
  NDJ: 12,
};

/**
 * Fallback quando a NOAA estiver indisponível no servidor.
 * Atualizar quando o CPC publicar novos meses (oni.ascii.txt).
 */
const ONI_FALLBACK_RECENTE: OniMensalLive[] = [
  { ano: 2025, mes: 10, oni: -0.51 },
  { ano: 2025, mes: 11, oni: -0.55 },
  { ano: 2025, mes: 12, oni: -0.54 },
  { ano: 2026, mes: 1, oni: -0.37 },
  { ano: 2026, mes: 2, oni: -0.14 },
  { ano: 2026, mes: 3, oni: 0.13 },
  { ano: 2026, mes: 4, oni: 0.51 },
  { ano: 2026, mes: 5, oni: 0.98 },
];

export interface OniMensalLive {
  ano: number;
  mes: number;
  oni: number;
}

export interface OniPayloadLive {
  fonte: string;
  atualizado_em: string;
  linhas: OniMensalLive[];
  fallback?: boolean;
}

let cache: OniPayloadLive | null = null;
let cacheExpiraEm = 0;
let fetchEmAndamento: Promise<OniPayloadLive> | null = null;

export function parseOniAscii(texto: string): OniMensalLive[] {
  const map = new Map<string, number[]>();
  const anoAtual = new Date().getFullYear();

  for (const linha of texto.split(/\r?\n/)) {
    const parts = linha.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const seas = parts[0];
    const ano = Number(parts[1]);
    const anom = Number(parts[3]);
    const mes = SEAS_MEIO_MES[seas];
    if (
      !mes ||
      !Number.isFinite(ano) ||
      !Number.isFinite(anom) ||
      anom <= -90 ||
      ano < ANO_INICIO_PADRAO ||
      ano > anoAtual
    ) {
      continue;
    }
    const k = `${ano}-${mes}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(anom);
  }

  return Array.from(map.entries())
    .map(([k, vals]) => {
      const [ano, mes] = k.split('-').map(Number);
      const oni =
        Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) /
        100;
      return { ano, mes, oni };
    })
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);
}

function resolveNoaaRejectUnauthorized(): boolean {
  const v = String(process.env.NOAA_SSL_VERIFY ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'yes') return true;
  return true;
}

function isErroCertificadoSsl(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /unable to verify the first certificate|self signed certificate|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(
    msg,
  );
}

function fetchOniHttps(
  timeoutMs = 45_000,
  rejectUnauthorized = resolveNoaaRejectUnauthorized(),
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      NOAA_ONI_URL,
      {
        headers: {
          Accept: 'text/plain,*/*',
          'User-Agent': 'TechDengue-ElNino/1.0 (+https://techdengue.com.br)',
        },
        timeout: timeoutMs,
        rejectUnauthorized,
      },
      (res) => {
        if ((res.statusCode ?? 0) >= 400) {
          res.resume();
          reject(new Error(`NOAA ONI HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve(body));
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('NOAA ONI timeout'));
    });
    req.on('error', reject);
  });
}

async function buscarOniNoaa(): Promise<OniPayloadLive> {
  let texto = '';
  let ultimoErro: unknown;
  let tentouSslRelaxado = false;

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const relaxado = tentativa > 0 && tentouSslRelaxado;
      texto = await fetchOniHttps(
        45_000,
        relaxado ? false : resolveNoaaRejectUnauthorized(),
      );
      break;
    } catch (err) {
      ultimoErro = err;
      if (!tentouSslRelaxado && isErroCertificadoSsl(err)) {
        tentouSslRelaxado = true;
        console.warn(
          '[el-nino] NOAA ONI: falha SSL, tentando novamente com NOAA_SSL_VERIFY=0',
        );
      }
    }
  }

  if (!texto) {
    console.warn(
      '[el-nino] NOAA ONI indisponível, usando fallback embutido:',
      ultimoErro instanceof Error ? ultimoErro.message : ultimoErro,
    );
    return {
      fonte: 'NOAA CPC ONI (fallback)',
      atualizado_em: new Date().toISOString(),
      linhas: [...ONI_FALLBACK_RECENTE],
      fallback: true,
    };
  }

  const linhas = parseOniAscii(texto);
  if (!linhas.length) {
    return {
      fonte: 'NOAA CPC ONI (fallback)',
      atualizado_em: new Date().toISOString(),
      linhas: [...ONI_FALLBACK_RECENTE],
      fallback: true,
    };
  }

  return {
    fonte: 'NOAA CPC ONI',
    atualizado_em: new Date().toISOString(),
    linhas,
    fallback: false,
  };
}

export function invalidarCacheOniNoaa(): void {
  cache = null;
  cacheExpiraEm = 0;
  fetchEmAndamento = null;
}

/**
 * Busca ONI mensal da NOAA CPC com cache em memória (TTL 24 h).
 */
export async function carregarOniMensalNoaa(
  forceRefresh = false,
): Promise<OniPayloadLive> {
  const agora = Date.now();

  if (!forceRefresh && cache?.linhas?.length && agora < cacheExpiraEm) {
    return cache;
  }

  if (!forceRefresh && fetchEmAndamento) {
    return fetchEmAndamento;
  }

  const promessa = (async () => {
    try {
      const payload = await buscarOniNoaa();
      if (payload.linhas.length) {
        cache = payload;
        cacheExpiraEm = Date.now() + CACHE_TTL_MS;
      } else if (cache?.linhas?.length) {
        return cache;
      }
      return payload;
    } catch (err) {
      console.warn('[el-nino] erro ao carregar ONI:', err);
      if (cache?.linhas?.length) return cache;
      return {
        fonte: 'NOAA CPC ONI (fallback)',
        atualizado_em: new Date().toISOString(),
        linhas: [...ONI_FALLBACK_RECENTE],
        fallback: true,
      };
    } finally {
      fetchEmAndamento = null;
    }
  })();

  fetchEmAndamento = promessa;
  return promessa;
}
