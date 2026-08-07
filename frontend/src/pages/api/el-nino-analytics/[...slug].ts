import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: {
    responseLimit: false,
  },
};

import { contratoIdDoGeocode, montarPayloadMapaComMalha } from '../../../utils/el-nino/contracts';
import { isVisaoTodosContratos } from '../../../utils/el-nino/agregar-visao-gerencial';
import { invalidarCacheOniNoaa } from '../../../utils/el-nino/enriquecer-oni-live';
import {
  buildServerApiUrl,
  mapServerFetchErrorToHttp,
  serverFetch,
} from '../../../utils/server/serverFetch';
import {
  carregarAuthEEscopo,
  responderAuthFalhou,
  validarPedidoContraEscopo,
} from '../../../utils/el-nino/proxy-auth-scope';

function qp(req: NextApiRequest, ...keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = req.query[k];
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v) && v.length) out[k] = v[0];
  }
  return out;
}

/**
 * Resolve contrato a partir de query: contratoId explícito > geocode dono.
 * Sem fallback para contrato 19.
 */
function resolverContratoId(p: Record<string, string>): number | null {
  if (isVisaoTodosContratos(p)) return null;
  const raw = p.contratoId || p.contrato_id || p.idContrato || p.id_contrato;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const geocode = p.geocode ? Number(p.geocode) : NaN;
  if (Number.isFinite(geocode) && geocode > 0) {
    const porGeocode = contratoIdDoGeocode(geocode);
    if (porGeocode != null) return porGeocode;
  }
  return null;
}

function semCacheHttp(res: NextApiResponse): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function resolverIdContratoUpstream(p: Record<string, string>): number | undefined {
  const raw = p.idContrato || p.id_contrato || p.contratoId || p.contrato_id;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Endpoints que o NestJS já resolve com JWT + escopo territorial. */
const ENDPOINTS_NEST = new Set([
  'escopo',
  'overview',
  'kpis',
  'serie',
  'serie-consorcio',
  'correlacoes',
  'correlacao-lag',
  'comparativo',
  'alertas',
  'clima',
  'clima-historico',
  'municipios',
  'malha-mg',
  'mapa-projecao',
  'consorcios',
  'urs',
  'inmet-alertas',
  'municipio-id',
  'casos-por-bairro',
  'geojson-bairros',
  'area-urbana-rural',
]);

async function proxyElNinoUpstream(
  req: NextApiRequest,
  res: NextApiResponse,
  auth: string,
  upstreamPath: string,
  queryParams: Record<string, string | number | undefined>,
): Promise<void> {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(queryParams)) {
    if (value != null && value !== '') {
      q.set(key, String(value));
    }
  }

  const url = buildServerApiUrl(
    `/el-nino-analytics/${upstreamPath}${q.toString() ? `?${q.toString()}` : ''}`,
  );

  try {
    const upstream = await serverFetch(url, {
      method: req.method === 'POST' ? 'POST' : 'GET',
      headers: { Authorization: auth, Accept: 'application/json' },
      timeoutMs: 120_000,
    });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        parsed = { message: body || upstream.statusText };
      }
      res.status(upstream.status).json({
        error:
          (parsed.message as string) ||
          (parsed.error as string) ||
          `Upstream retornou ${upstream.status}`,
      });
      return;
    }

    const data = await upstream.json();

    // Mapa: se Nest/produção não trouxe geojson, anexa malha estática legado
    // (mapa_geojson_{contrato}.json ou match por geocode — como nas versões
    // que plotavam polígonos contra a API de produção).
    if (upstreamPath === 'mapa-projecao' && data && typeof data === 'object') {
      const payload = data as Record<string, unknown>;
      const geo = payload.geojson as { features?: unknown[] } | null | undefined;
      if (!geo?.features?.length) {
        const contratoId =
          Number(
            queryParams.contratoId ??
              (payload as { _contrato_id?: number })._contrato_id,
          ) || 0;
        const enriquecido = montarPayloadMapaComMalha(payload, contratoId || 0);
        res.status(200).json(enriquecido);
        return;
      }
    }

    res.status(200).json(data);
  } catch (err) {
    const mapped = mapServerFetchErrorToHttp(err);
    res.status(mapped.status).json({
      error: mapped.message,
      category: mapped.category,
    });
  }
}

function montarQueryNest(
  p: Record<string, string>,
  contratoIdRaw: number | null,
  visaoTodos: boolean,
): Record<string, string | number | undefined> {
  const geocode = p.geocode ? Number(p.geocode) : undefined;
  // Nest DTO aceita só contratoId (forbidNonWhitelisted rejeita idContrato).
  const contratoId =
    resolverIdContratoUpstream(p) ??
    (contratoIdRaw && contratoIdRaw > 0 ? contratoIdRaw : undefined);

  return {
    contratoId,
    geocode: geocode != null && Number.isFinite(geocode) ? geocode : undefined,
    ano: p.ano || undefined,
    uf: p.uf || undefined,
    ano_inicio: p.ano_inicio || undefined,
    ano_fim: p.ano_fim || undefined,
    limit: p.limit || undefined,
    agregacao: p.agregacao || undefined,
    visao: visaoTodos ? 'todos' : undefined,
    semanal: p.semanal || undefined,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  semCacheHttp(res);

  /** P0: nenhum endpoint El Niño responde sem JWT validado no Nest. */
  const authGate = await carregarAuthEEscopo(req);
  if (authGate.ok === false) {
    return responderAuthFalhou(res, authGate);
  }
  const authScope = authGate;

  const slug = (req.query.slug as string[]) || [];
  const endpoint = slug.join('/');
  const p = qp(
    req,
    'contratoId',
    'contrato_id',
    'idContrato',
    'id_contrato',
    'geocode',
    'idMunicipio',
    'refresh',
    'ano',
    'uf',
    'semanal',
    'ano_inicio',
    'ano_fim',
    'limit',
    'visao',
    'agregacao',
  );
  const contratoIdRaw = resolverContratoId(p);
  const visaoTodos = isVisaoTodosContratos(p);

  if (p.refresh === '1') {
    return res.status(403).json({
      error:
        'refresh=1 não é permitido no proxy; use POST /api/el-nino-analytics/refresh (admin)',
    });
  }

  const geocodePedido = p.geocode ? Number(p.geocode) : undefined;
  const escopoErr = validarPedidoContraEscopo({
    visaoTodos,
    contratoId: contratoIdRaw,
    geocode:
      geocodePedido != null && Number.isFinite(geocodePedido)
        ? geocodePedido
        : undefined,
    escopo: authScope.escopo,
    contratoIdsPermitidos: authScope.contratoIdsPermitidos,
  });
  if (escopoErr) {
    return res.status(403).json({ error: escopoErr });
  }

  try {
    if (endpoint === 'refresh') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'POST only' });
      }
      try {
        const upstream = await serverFetch(
          buildServerApiUrl('/el-nino-analytics/refresh'),
          {
            method: 'POST',
            headers: {
              Authorization: authScope.auth,
              Accept: 'application/json',
            },
            timeoutMs: 120_000,
          },
        );
        if (!upstream.ok) {
          const body = await upstream.text().catch(() => '');
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(body) as Record<string, unknown>;
          } catch {
            parsed = { message: body || upstream.statusText };
          }
          return res.status(upstream.status).json({
            error:
              (parsed.message as string) ||
              (parsed.error as string) ||
              `Upstream retornou ${upstream.status}`,
          });
        }
        const data = await upstream.json().catch(() => ({ ok: true }));
        invalidarCacheOniNoaa();
        return res.status(200).json(data);
      } catch (err) {
        const mapped = mapServerFetchErrorToHttp(err);
        return res.status(mapped.status).json({ error: mapped.message });
      }
    }

    if (!ENDPOINTS_NEST.has(endpoint)) {
      return res.status(404).json({
        error: `Endpoint /el-nino-analytics/${endpoint} nao encontrado`,
      });
    }

    /** Endpoints sensíveis: nunca encaminham idMunicipio do cliente (BOLA). */
    const nestQuery = montarQueryNest(p, contratoIdRaw, visaoTodos);

    if (
      endpoint === 'casos-por-bairro' ||
      endpoint === 'geojson-bairros' ||
      endpoint === 'area-urbana-rural' ||
      endpoint === 'municipio-id'
    ) {
      if (!nestQuery.geocode) {
        return res.status(400).json({ error: 'geocode obrigatório' });
      }
    }

    return proxyElNinoUpstream(req, res, authScope.auth, endpoint, nestQuery);
  } catch (err) {
    console.error('[el-nino-analytics proxy] Internal error:', err);
    const mapped = mapServerFetchErrorToHttp(err);
    return res.status(mapped.status || 500).json({
      error: mapped.message || 'Internal error',
      category: mapped.category,
    });
  }
}
