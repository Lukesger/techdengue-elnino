/**
 * Gate de autenticação/escopo para o proxy Next.js /api/el-nino-analytics.
 * Fail-closed: sem JWT, Nest indisponível ou lista de contratos vazia
 * para usuário não-global → não serve dados.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  buildServerApiUrl,
  mapServerFetchErrorToHttp,
  serverFetch,
} from '../server/serverFetch';
import { contratoIdDoGeocode } from './contracts';

export type EscopoNestProxy = {
  tipo?: string;
  rotulo?: string;
  geocodes: number[];
  isGlobal: boolean;
  municipios?: Array<{
    geocode: number;
    municipioId?: number;
    nome?: string;
    populacao?: number;
  }>;
};

export type ConsorcioNestProxy = {
  id: number;
  nome: string;
  n_municipios?: number;
  municipios?: Array<{ geocode: number; nome: string }>;
};

export type AuthScopeOk = {
  ok: true;
  auth: string;
  escopo: EscopoNestProxy;
  contratoIdsPermitidos: Set<number>;
};

export type AuthScopeFail = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};

export type AuthScopeResult = AuthScopeOk | AuthScopeFail;

function bearerFromReq(req: NextApiRequest): string | null {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string') return null;
  const trimmed = auth.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ') || trimmed.length < 16) {
    return null;
  }
  return trimmed;
}

async function fetchJsonAutenticado<T>(
  auth: string,
  path: string,
): Promise<{ status: number; data: T | null; errorBody: Record<string, unknown> }> {
  const url = buildServerApiUrl(path);
  try {
    const upstream = await serverFetch(url, {
      headers: { Authorization: auth, Accept: 'application/json' },
      timeoutMs: 30_000,
      retries: 1,
    });
    const text = await upstream.text().catch(() => '');
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text || upstream.statusText };
    }
    if (!upstream.ok) {
      const err =
        parsed && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>)
          : { message: text || upstream.statusText };
      return { status: upstream.status, data: null, errorBody: err };
    }
    return { status: upstream.status, data: parsed as T, errorBody: {} };
  } catch (err) {
    const mapped = mapServerFetchErrorToHttp(err);
    return {
      status: mapped.status,
      data: null,
      errorBody: { error: mapped.message, category: mapped.category },
    };
  }
}

/**
 * Consolida contratos permitidos a partir da resposta Nest + geocodes.
 * Fail-closed para não-global quando a listagem de consórcios falha
 * ou quando não há geocodes nem contratos resolvíveis.
 */
export function consolidarContratosDoEscopo(opts: {
  escopo: EscopoNestProxy;
  consorciosOk: boolean;
  consorciosStatus: number;
  consorcios?: ConsorcioNestProxy[] | null;
  consorciosError?: Record<string, unknown>;
  contratoIdDoGeocodeFn?: (geocode: number) => number | null | undefined;
}): AuthScopeFail | { ok: true; contratoIdsPermitidos: Set<number> } {
  const {
    escopo,
    consorciosOk,
    consorciosStatus,
    consorcios,
    consorciosError = {},
    contratoIdDoGeocodeFn = contratoIdDoGeocode,
  } = opts;

  if (!escopo.isGlobal && !consorciosOk) {
    return {
      ok: false,
      status: consorciosStatus >= 400 ? consorciosStatus : 503,
      body: {
        error:
          (consorciosError.message as string) ||
          (consorciosError.error as string) ||
          'Não foi possível validar contratos do escopo territorial',
      },
    };
  }

  const contratoIdsPermitidos = new Set<number>();
  if (consorcios) {
    for (const c of consorcios) {
      const id = Number(c.id);
      if (Number.isFinite(id) && id > 0) contratoIdsPermitidos.add(id);
    }
  }

  if (escopo.geocodes.length) {
    for (const g of escopo.geocodes) {
      const cid = contratoIdDoGeocodeFn(g);
      if (cid != null && cid > 0) contratoIdsPermitidos.add(cid);
    }
  }

  if (!escopo.isGlobal && !escopo.geocodes.length && !contratoIdsPermitidos.size) {
    return {
      ok: false,
      status: 403,
      body: { error: 'Usuário sem escopo territorial configurado' },
    };
  }

  return { ok: true, contratoIdsPermitidos };
}

/**
 * Valida JWT no Nest e carrega escopo + contratos acessíveis.
 * Fail-closed para não-globais: precisa de geocodes e/ou contratos resolvidos.
 */
export async function carregarAuthEEscopo(
  req: NextApiRequest,
): Promise<AuthScopeResult> {
  const auth = bearerFromReq(req);
  if (!auth) {
    return {
      ok: false,
      status: 401,
      body: { error: 'Token não fornecido' },
    };
  }

  const escopoRes = await fetchJsonAutenticado<EscopoNestProxy>(
    auth,
    '/el-nino-analytics/escopo',
  );
  if (!escopoRes.data) {
    return {
      ok: false,
      status: escopoRes.status || 401,
      body: {
        error:
          (escopoRes.errorBody.message as string) ||
          (escopoRes.errorBody.error as string) ||
          'Não autorizado',
      },
    };
  }

  const escopo: EscopoNestProxy = {
    ...escopoRes.data,
    geocodes: Array.isArray(escopoRes.data.geocodes)
      ? escopoRes.data.geocodes.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [],
    isGlobal: Boolean(escopoRes.data.isGlobal),
  };

  const consorciosRes = await fetchJsonAutenticado<{
    consorcios?: ConsorcioNestProxy[];
  }>(auth, '/el-nino-analytics/consorcios');

  const consolidado = consolidarContratosDoEscopo({
    escopo,
    consorciosOk: Boolean(consorciosRes.data),
    consorciosStatus: consorciosRes.status,
    consorcios: consorciosRes.data?.consorcios ?? null,
    consorciosError: consorciosRes.errorBody,
  });
  if (!consolidado.ok) return consolidado;

  return {
    ok: true,
    auth,
    escopo,
    contratoIdsPermitidos: consolidado.contratoIdsPermitidos,
  };
}

export function responderAuthFalhou(
  res: NextApiResponse,
  fail: AuthScopeFail,
): void {
  res.status(fail.status).json(fail.body);
}

/**
 * Enforce territorial no proxy após auth Nest.
 * Fail-closed: contrato/geocode fora do escopo ou lista de contratos
 * indisponível para não-global → bloqueia.
 */
export function validarPedidoContraEscopo(opts: {
  visaoTodos: boolean;
  contratoId: number | null;
  geocode?: number;
  escopo: EscopoNestProxy;
  contratoIdsPermitidos: Set<number>;
}): string | null {
  const { visaoTodos, contratoId, geocode, escopo, contratoIdsPermitidos } = opts;

  if (visaoTodos && !escopo.isGlobal) {
    return 'Visão gerencial (todos os contratos) exige escopo global';
  }

  if (escopo.isGlobal) return null;

  if (geocode != null && Number.isFinite(geocode) && geocode > 0) {
    if (!escopo.geocodes.includes(geocode)) {
      return 'Geocode fora do escopo territorial do usuário';
    }
  }

  if (contratoId != null && contratoId > 0) {
    if (!contratoIdsPermitidos.size) {
      return 'Não foi possível validar contratos do escopo territorial';
    }
    if (!contratoIdsPermitidos.has(contratoId)) {
      return 'Contrato fora do escopo territorial do usuário';
    }
  }

  return null;
}

function geocodeDeLinha(row: any): number | null {
  const g = Number(
    row?.geocode ?? row?.Geocode ?? row?.codigo_ibge ?? row?.codigoIbge,
  );
  return Number.isFinite(g) && g > 0 ? g : null;
}

function keepGeocode(row: any, set: Set<number>): boolean {
  const g = geocodeDeLinha(row);
  if (g == null) {
    /** Sem geocode explícito: remove para evitar vazamento em estruturas mistas. */
    return false;
  }
  return set.has(g);
}

/** Filtra pacote local por geocodes autorizados (todas as estruturas aninhadas relevantes). */
export function filtrarPacotePorGeocodes(
  dados: any,
  geocodesPermitidos: number[],
): any {
  if (!dados || !geocodesPermitidos.length) return dados;
  const set = new Set(geocodesPermitidos.map(Number));

  const next = { ...dados };
  for (const key of [
    'df_mensal_mun',
    'df_municipios',
    'df_serie',
    'df_serie_ponderada',
    'df_historico',
    'df_historico_ponderado',
    'df_alertas',
    'municipios',
    'alertas',
    'mapa_df',
    'clima_historico',
    'municipios_ibge',
  ] as const) {
    if (Array.isArray(next[key])) {
      next[key] = next[key].filter((row: any) => keepGeocode(row, set));
    }
  }

  if (next.alertas_por_geocode && typeof next.alertas_por_geocode === 'object') {
    const filtrado: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next.alertas_por_geocode)) {
      const g = Number(k);
      if (Number.isFinite(g) && set.has(g)) filtrado[k] = v;
    }
    next.alertas_por_geocode = filtrado;
  }

  if (next.clima_municipios && typeof next.clima_municipios === 'object') {
    const filtrado: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next.clima_municipios)) {
      const g = Number(k);
      if (Number.isFinite(g) && set.has(g)) filtrado[k] = v;
    }
    next.clima_municipios = filtrado;
  }

  if (next.mapa_projecao?.payload?.municipios) {
    next.mapa_projecao = {
      ...next.mapa_projecao,
      payload: {
        ...next.mapa_projecao.payload,
        municipios: next.mapa_projecao.payload.municipios.filter((row: any) =>
          keepGeocode(row, set),
        ),
      },
    };
  } else if (next.mapa_projecao?.municipios) {
    next.mapa_projecao = {
      ...next.mapa_projecao,
      municipios: next.mapa_projecao.municipios.filter((row: any) =>
        keepGeocode(row, set),
      ),
    };
  }

  if (next.elnino?.comparativo_municipio) {
    next.elnino = {
      ...next.elnino,
      comparativo_municipio: next.elnino.comparativo_municipio.filter(
        (row: any) => keepGeocode(row, set),
      ),
    };
  }

  if (Array.isArray(next.resumo_escopo?.populacoes)) {
    next.resumo_escopo = {
      ...next.resumo_escopo,
      populacoes: next.resumo_escopo.populacoes.filter((row: any) =>
        keepGeocode(row, set),
      ),
    };
  }

  return next;
}
