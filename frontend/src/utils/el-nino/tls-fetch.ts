import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import http from 'http';
import https from 'https';
import { URL } from 'url';

let httpsAgentSecure: https.Agent | undefined | null;
let httpsAgentInsecure: https.Agent | undefined;
let warnedInsecureAuth = false;

function certifiCa(): Buffer | undefined {
  try {
    const caPath = execSync('python -c "import certifi; print(certifi.where())"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return caPath ? readFileSync(caPath) : undefined;
  } catch {
    return undefined;
  }
}

function agentSecure(): https.Agent | undefined {
  if (httpsAgentSecure !== undefined) return httpsAgentSecure ?? undefined;
  const ca = certifiCa();
  if (!ca) {
    httpsAgentSecure = null;
    return undefined;
  }
  httpsAgentSecure = new https.Agent({ ca });
  return httpsAgentSecure;
}

function agentInsecure(): https.Agent {
  if (!httpsAgentInsecure) {
    httpsAgentInsecure = new https.Agent({ rejectUnauthorized: false });
  }
  return httpsAgentInsecure;
}

function requestComAgent(
  url: string,
  init: RequestInit | undefined,
  agent: https.Agent | undefined,
): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;

    const req = lib.request(
      u,
      {
        agent: u.protocol === 'https:' ? agent : undefined,
        method: init?.method ?? 'GET',
        headers: (init?.headers as Record<string, string>) ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v != null) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
          }
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    req.on('error', reject);

    if (init?.signal) {
      if (init.signal.aborted) {
        req.destroy();
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      init.signal.addEventListener('abort', () => req.destroy(), { once: true });
    }

    req.end();
  });
}

function toResponse(result: {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Buffer;
}): Response {
  return new Response(new Uint8Array(result.body), {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
}

function tlsCorporate(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code ?? '';
  const msg = String((e as Error)?.message ?? e);
  return (
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'CERT_HAS_EXPIRED' ||
    msg.includes('unable to verify the first certificate')
  );
}

/** fetch com CA certifi; em development, DEV_INSECURE_TLS=1 desliga verificação. */
export async function fetchComTls(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== 'https:') return fetch(url, init);

  const forceInsecure =
    process.env.NODE_ENV === 'development' &&
    (process.env.DEV_INSECURE_TLS === '1' ||
      process.env.DEV_INSECURE_TLS === 'true');

  /**
   * Opt-in explícito em desenvolvimento para inspeção TLS corporativa / CA do Windows
   * que o Node não confia. Necessário para proxies Next → API de trabalho com JWT.
   * Nunca habilitar em produção.
   */
  if (forceInsecure) {
    if (!warnedInsecureAuth) {
      warnedInsecureAuth = true;
      console.warn(
        '[tls-fetch] DEV_INSECURE_TLS=1 ativo: TLS sem verificação de certificado (somente development).',
      );
    }
    return toResponse(await requestComAgent(url, init, agentInsecure()));
  }

  try {
    const secure = agentSecure();
    if (secure) {
      return toResponse(await requestComAgent(url, init, secure));
    }
    return fetch(url, init);
  } catch (e) {
    if (tlsCorporate(e)) {
      throw new Error(
        'Falha de certificado TLS. Em development, use DEV_INSECURE_TLS=1 (ou HTTPS_PROXY / CA corporativa).',
      );
    }
    throw e;
  }
}
