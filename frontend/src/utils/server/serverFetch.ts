/**
 * Fetch server-side resiliente para rotas Next.js API → NestJS.
 * Reutiliza fetchComTls (CA certifi + fallback TLS corporativo) com retry e timeout.
 */
import { API_CONFIG } from '@/config/api';
import { fetchComTls } from '@/utils/el-nino/tls-fetch';

export type ServerFetchErrorCategory =
  | 'network'
  | 'tls'
  | 'timeout'
  | 'http'
  | 'unknown';

export class ServerFetchError extends Error {
  readonly category: ServerFetchErrorCategory;
  readonly statusCode?: number;
  readonly upstreamUrl?: string;
  readonly causeError?: unknown;

  constructor(
    message: string,
    category: ServerFetchErrorCategory,
    options?: { statusCode?: number; upstreamUrl?: string; cause?: unknown },
  ) {
    super(message);
    this.name = 'ServerFetchError';
    this.category = category;
    this.statusCode = options?.statusCode;
    this.upstreamUrl = options?.upstreamUrl;
    this.causeError = options?.cause;
  }
}

export interface ServerFetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1_000;

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
]);


function categorizeFetchError(err: unknown, upstreamUrl?: string): ServerFetchError {
  const e = err as Error & { code?: string; cause?: { code?: string } };
  const message = e?.message ?? String(err);
  const code = e?.code ?? e?.cause?.code ?? '';

  if (e?.name === 'AbortError' || message.toLowerCase().includes('aborted')) {
    return new ServerFetchError(
      'Tempo limite excedido ao conectar com a API',
      'timeout',
      { upstreamUrl, cause: err },
    );
  }

  if (
    message.toLowerCase().includes('certificate') ||
    message.toLowerCase().includes('ssl') ||
    message.toLowerCase().includes('tls') ||
    message.toLowerCase().includes('unable to verify') ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
  ) {
    return new ServerFetchError(
      'Falha de certificado TLS ao conectar com a API. Em dev, configure DEV_INSECURE_TLS=1 ou HTTPS_PROXY.',
      'tls',
      { upstreamUrl, cause: err },
    );
  }

  if (
    TRANSIENT_CODES.has(code) ||
    message.toLowerCase().includes('fetch failed') ||
    message.toLowerCase().includes('network')
  ) {
    return new ServerFetchError(
      'Não foi possível conectar com a API (falha de rede)',
      'network',
      { upstreamUrl, cause: err },
    );
  }

  return new ServerFetchError(
    message || 'Erro desconhecido ao chamar a API',
    'unknown',
    { upstreamUrl, cause: err },
  );
}

function isTransientError(err: unknown): boolean {
  if (!(err instanceof ServerFetchError)) {
    const categorized = categorizeFetchError(err);
    return categorized.category === 'network' || categorized.category === 'tls';
  }
  return err.category === 'network' || err.category === 'tls';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Monta URL absoluta para o backend NestJS a partir de path relativo (/auth/me). */
export function buildServerApiUrl(path: string): string {
  const base = API_CONFIG.getServerBaseURL().replace(/\/$/, '');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

async function fetchWithTlsPolicy(
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetchComTls(url, init);
}

/**
 * Fetch server-side com TLS resiliente, timeout e retry.
 */
export async function serverFetch(
  input: string | URL,
  options: ServerFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    ...init
  } = options;

  const url = typeof input === 'string' ? input : input.toString();
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchWithTlsPolicy(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429 && attempt < retries) {
        const retryAfter = response.headers.get('retry-after');
        const delay = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000, 30_000)
          : retryDelayMs * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;

      if (attempt < retries && isTransientError(err)) {
        await sleep(retryDelayMs * Math.pow(2, attempt));
        continue;
      }

      throw categorizeFetchError(err, url);
    }
  }

  throw categorizeFetchError(lastError, url);
}

/** Mapeia ServerFetchError para status HTTP e mensagem amigável em rotas API. */
export function mapServerFetchErrorToHttp(err: unknown): {
  status: number;
  message: string;
  category?: ServerFetchErrorCategory;
  debug?: string;
} {
  if (err instanceof ServerFetchError) {
    const status =
      err.category === 'timeout'
        ? 504
        : err.category === 'network' || err.category === 'tls'
          ? 503
          : 502;

    return {
      status,
      message: err.message,
      category: err.category,
      debug:
        process.env.NODE_ENV === 'development' ? err.message : undefined,
    };
  }

  const message =
    err instanceof Error ? err.message : 'Erro interno do servidor';

  return {
    status: message.toLowerCase().includes('fetch') ? 503 : 500,
    message:
      message.toLowerCase().includes('fetch')
        ? 'Não foi possível conectar com a API'
        : message,
    debug: process.env.NODE_ENV === 'development' ? message : undefined,
  };
}
