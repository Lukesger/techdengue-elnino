import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: {
    responseLimit: false,
  },
};

import { contratoIdDoGeocode, montarPayloadMapaComMalha } from '../../../utils/el-nino/contracts';
import { isVisaoTodosContratos } from '../../../utils/el-nino/agregar-visao-gerencial';
import { anexarPoiHectareNoMapaPayload } from '../../../utils/el-nino/anexar-poi-hectare-mapa';
import {
  anexarMalhaIbgeFoco,
  anexarMalhaIbgeGerencial,
} from '../../../utils/el-nino/anexar-malha-ibge-gerencial';
import {
  aquecerCacheVisaoGerencial,
  tentarResponderVisaoGerencialLocal,
} from '../../../utils/el-nino/visao-gerencial-local';
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
  'municipio-painel',
  'casos-por-bairro',
  'geojson-bairros',
  'area-urbana-rural',
  'cache-status',
]);

async function proxyElNinoUpstream(
  req: NextApiRequest,
  res: NextApiResponse,
  auth: string,
  upstreamPath: string,
  queryParams: Record<string, string | number | undefined>,
  opts?: { visaoTodos?: boolean },
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

    // Overview: histórico 2020–2022 + ONI NOAA completo (evita buraco no gráfico).
    if (upstreamPath === 'overview' && data && typeof data === 'object') {
      try {
        const { aplicarHistoricoConsolidado } = await import(
          '../../../utils/el-nino/historico-casos-consolidado'
        );
        const { enriquecerPacoteComOniNoaa } = await import(
          '../../../utils/el-nino/enriquecer-oni-live'
        );
        const { aplicarHistoricoAnualNoPacote } = await import(
          '../../../utils/el-nino/historico-anual'
        );
        let enriquecido = aplicarHistoricoConsolidado(data);
        enriquecido = await enriquecerPacoteComOniNoaa(enriquecido);
        // Garante ONI em cada mês da série (comparativo mensal).
        const oniMap = new Map(
          (enriquecido.oni_mensal ?? []).map(
            (o: { ano: number; mes: number; oni: number }) => [
              `${o.ano}-${o.mes}`,
              o.oni,
            ],
          ),
        );
        if (oniMap.size && Array.isArray(enriquecido.df_serie)) {
          enriquecido = {
            ...enriquecido,
            df_serie: enriquecido.df_serie.map(
              (r: Record<string, unknown>) => {
                const k = `${Number(r.Ano)}-${Number(r.MesNum)}`;
                const oni = oniMap.get(k);
                return oni != null ? { ...r, ONI: oni } : r;
              },
            ),
            df_serie_ponderada: Array.isArray(enriquecido.df_serie_ponderada)
              ? enriquecido.df_serie_ponderada.map(
                  (r: Record<string, unknown>) => {
                    const k = `${Number(r.Ano)}-${Number(r.MesNum)}`;
                    const oni = oniMap.get(k);
                    return oni != null ? { ...r, ONI: oni } : r;
                  },
                )
              : enriquecido.df_serie_ponderada,
          };
        }
        enriquecido = aplicarHistoricoAnualNoPacote(enriquecido);
        const nSerie = Array.isArray(enriquecido?.df_serie)
          ? enriquecido.df_serie.length
          : 0;
        const nOni = Array.isArray(enriquecido?.oni_mensal)
          ? enriquecido.oni_mensal.length
          : 0;
        console.info(
          `[el-nino-analytics proxy] overview +histórico +ONI df_serie=${nSerie} oni=${nOni}`,
        );
        res.status(200).json(enriquecido);
        return;
      } catch (err) {
        console.warn(
          '[el-nino-analytics proxy] overview enrich falhou:',
          (err as Error)?.message ?? err,
        );
      }
    }

    // Mapa: se Nest/produção não trouxe geojson, anexa malha estática legado
    // (mapa_geojson_{contrato}.json ou match por geocode — como nas versões
    // que plotavam polígonos contra a API de produção).
    if (upstreamPath === 'mapa-projecao' && data && typeof data === 'object') {
      let payload = data as Record<string, unknown>;
      const geo = payload.geojson as { features?: unknown[] } | null | undefined;
      if (!geo?.features?.length) {
        const contratoId =
          Number(
            queryParams.contratoId ??
              (payload as { _contrato_id?: number })._contrato_id,
          ) || 0;
        payload = montarPayloadMapaComMalha(payload, contratoId || 0) as Record<
          string,
          unknown
        >;
      }
      // Pré-cache POI/ha enquanto produção Nest não materializa o store.
      payload = anexarPoiHectareNoMapaPayload(payload);
      // Gerencial: SEMPRE tenta MG completa (cache local/CDN) × TechDengue.
      if (opts?.visaoTodos) {
        try {
          payload = await anexarMalhaIbgeGerencial(payload);
        } catch (err) {
          console.error(
            '[el-nino-analytics proxy] falha ao anexar malha MG completa:',
            (err as Error)?.message ?? err,
          );
        }
      } else if (
        !((payload.geojson as { features?: unknown[] } | null)?.features?.length)
      ) {
        const geocodeFoco = Number(
          queryParams.geocode ??
            (payload.municipios as Array<{ geocode?: number }> | undefined)?.[0]
              ?.geocode,
        );
        try {
          payload = await anexarMalhaIbgeFoco(payload, geocodeFoco);
        } catch (err) {
          console.warn(
            '[el-nino-analytics proxy] falha ao anexar malha IBGE do município:',
            (err as Error)?.message ?? err,
          );
        }
      }
      const nGeo =
        (payload.geojson as { features?: unknown[] } | null)?.features
          ?.length ?? 0;
      console.info(
        `[el-nino-analytics proxy] mapa-projecao visaoTodos=${Boolean(opts?.visaoTodos)} features=${nGeo} fonte=${String(payload.malha_fonte ?? '')}`,
      );
      res.status(200).json(payload);
      return;
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
  if (!authGate.ok) {
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

  // Warm-up só no caminho gerencial — evita gravar .cache em toda request municipal.
  if (visaoTodos && authScope.escopo.isGlobal) {
    aquecerCacheVisaoGerencial();
  }

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
        try {
          const { invalidarCacheVisaoGerencial } = await import(
            '../../../utils/el-nino/agregar-visao-gerencial'
          );
          const { invalidarCacheMapaGerencial } = await import(
            '../../../utils/el-nino/visao-gerencial-local'
          );
          invalidarCacheVisaoGerencial();
          invalidarCacheMapaGerencial();
        } catch {
          /* ignore */
        }
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

    // Status do pré-cache gerencial em disco (debug / ops).
    if (endpoint === 'cache-status') {
      try {
        const status = await tentarResponderVisaoGerencialLocal('cache-status');
        return res.status(200).json(status ?? { ok: false });
      } catch (err) {
        return res.status(500).json({
          error: (err as Error)?.message ?? 'Falha ao ler status do cache',
        });
      }
    }

    // Usuário gerencial (global + visao=todos): pré-cache local fixo — sem Nest.
    if (visaoTodos && authScope.escopo.isGlobal) {
      try {
        const local = await tentarResponderVisaoGerencialLocal(endpoint);
        if (local != null) {
          console.info(
            `[el-nino-analytics proxy] gerencial LOCAL endpoint=${endpoint}`,
          );
          return res.status(200).json(local);
        }
      } catch (err) {
        console.warn(
          `[el-nino-analytics proxy] gerencial local falhou (${endpoint}), fallback Nest:`,
          (err as Error)?.message ?? err,
        );
      }
    }

    // Gerencial: malha MG completa do cache local/CDN (Nest/produção ainda filtra o foco).
    if (endpoint === 'malha-mg' && visaoTodos) {
      try {
        const { resolverMalhaMgCompleta } = await import(
          '../../../utils/el-nino/anexar-malha-ibge-gerencial'
        );
        const malha = await resolverMalhaMgCompleta();
        if (malha?.features?.length) {
          return res.status(200).json(malha);
        }
      } catch (err) {
        console.error(
          '[el-nino-analytics proxy] malha-mg completa falhou:',
          (err as Error)?.message ?? err,
        );
      }
    }

    if (
      endpoint === 'casos-por-bairro' ||
      endpoint === 'geojson-bairros' ||
      endpoint === 'area-urbana-rural' ||
      endpoint === 'municipio-id' ||
      endpoint === 'municipio-painel'
    ) {
      if (!nestQuery.geocode) {
        return res.status(400).json({ error: 'geocode obrigatório' });
      }
    }

    // Mun. não mapeado: Nest primeiro; se falhar, seed local (Censo + Infodengue).
    if (endpoint === 'municipio-painel') {
      const gc = Number(nestQuery.geocode);
      try {
        const url = buildServerApiUrl(
          `/el-nino-analytics/municipio-painel?geocode=${gc}`,
        );
        const upstream = await serverFetch(url, {
          method: 'GET',
          headers: {
            Authorization: authScope.auth,
            Accept: 'application/json',
          },
          timeoutMs: 45_000,
        });
        if (upstream.ok) {
          const data = await upstream.json();
          if (
            data &&
            typeof data === 'object' &&
            ((Number((data as { populacao?: number }).populacao) > 0) ||
              (Number((data as { base?: number }).base) > 0) ||
              ((data as { projecoes?: Array<{ valor?: number }> }).projecoes ??
                []).some((p) => Number(p?.valor) > 0))
          ) {
            return res.status(200).json(data);
          }
        } else {
          console.warn(
            `[el-nino-analytics proxy] municipio-painel Nest ${upstream.status}, fallback local`,
          );
        }
      } catch (err) {
        console.warn(
          '[el-nino-analytics proxy] municipio-painel Nest falhou, fallback local:',
          (err as Error)?.message ?? err,
        );
      }
      try {
        const { obterMunicipioPainelResumo } = await import(
          '../../../utils/el-nino/municipio-painel-resumo'
        );
        const local = await obterMunicipioPainelResumo(gc);
        if (local) {
          return res.status(200).json(local);
        }
      } catch (err) {
        console.error(
          '[el-nino-analytics proxy] municipio-painel local falhou:',
          (err as Error)?.message ?? err,
        );
      }
      return res.status(404).json({
        error: `Resumo epidemiológico indisponível para geocode ${gc}`,
      });
    }

    return proxyElNinoUpstream(req, res, authScope.auth, endpoint, nestQuery, {
      visaoTodos,
    });
  } catch (err) {
    console.error('[el-nino-analytics proxy] Internal error:', err);
    const mapped = mapServerFetchErrorToHttp(err);
    return res.status(mapped.status || 500).json({
      error: mapped.message || 'Internal error',
      category: mapped.category,
    });
  }
}
