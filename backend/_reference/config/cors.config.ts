import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const LOCAL_DEV_ORIGIN_PREFIXES = [
  'http://localhost:',
  'http://127.0.0.1:',
  'http://[::1]:',
];

/** Origens permitidas a partir de CORS_ORIGIN ou CORS_ORIGINS (vírgula). */
export function parseCorsOriginsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.CORS_ORIGINS || env.CORS_ORIGIN || '';
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function isPrivateLanIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isLocalDevOrigin(origin: string): boolean {
  if (LOCAL_DEV_ORIGIN_PREFIXES.some((prefix) => origin.startsWith(prefix))) {
    return true;
  }
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === 'http:' && isPrivateLanIpv4(hostname);
  } catch {
    return false;
  }
}

function isVercelPreviewOrigin(
  origin: string,
  env: NodeJS.ProcessEnv,
): boolean {
  if (env.CORS_ALLOW_VERCEL_PREVIEW === 'false') {
    return false;
  }
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === 'https:' && hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!origin) {
    return env.NODE_ENV !== 'production';
  }

  const allowed = parseCorsOriginsFromEnv(env);
  if (allowed.includes(origin)) {
    return true;
  }

  if (isVercelPreviewOrigin(origin, env)) {
    return true;
  }

  if (env.NODE_ENV !== 'production' && isLocalDevOrigin(origin)) {
    return true;
  }

  return false;
}

/** Valida CORS em produção (fail-fast no bootstrap). */
export function assertCorsConfiguredForProduction(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }
  const allowed = parseCorsOriginsFromEnv(env);
  if (allowed.length === 0) {
    throw new Error(
      'CORS_ORIGIN (ou CORS_ORIGINS) deve estar definido em produção com origens explícitas',
    );
  }
}

export function createCorsOriginValidator(
  env: NodeJS.ProcessEnv = process.env,
): CorsOptions['origin'] {
  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    try {
      callback(null, isCorsOriginAllowed(origin, env));
    } catch (err) {
      callback(err as Error, false);
    }
  };
}

/** Retorna a origem para o header Access-Control-Allow-Origin ou false. */
export function resolveCorsAllowedOriginHeader(
  requestOrigin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | false {
  if (!requestOrigin || !isCorsOriginAllowed(requestOrigin, env)) {
    return false;
  }
  return requestOrigin;
}

export function buildNestCorsOptions(
  env: NodeJS.ProcessEnv = process.env,
): CorsOptions {
  return {
    origin: createCorsOriginValidator(env),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'X-Client-App',
      'X-Support-Token',
      // App do cidadão (módulo `cidadao`): identidade do aparelho e consulta anônima
      // de denúncia por protocolo. Sem estes, o preflight barra as chamadas do app web.
      'X-Device-Token',
      'X-Access-Token',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
    ],
    exposedHeaders: ['Authorization'],
    maxAge: 86400,
  };
}

/** Opções CORS para gateways Socket.IO (mesma allowlist do HTTP). */
export function buildSocketIoCorsOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    origin: createCorsOriginValidator(env),
    credentials: true,
  };
}
