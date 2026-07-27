export interface MapaProjecaoQuery {
  contratoId?: number | null;
  geocode?: number | null;
}

function parseNum(v: unknown): number | null {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Monta URL do mapa choropleth com contrato/município do filtro territorial. */
export function buildMapaProjecaoHref(query?: MapaProjecaoQuery): string {
  const params = new URLSearchParams();
  if (query?.contratoId != null && Number.isFinite(query.contratoId)) {
    params.set('contratoId', String(query.contratoId));
  }
  if (query?.geocode != null && Number.isFinite(query.geocode)) {
    params.set('geocode', String(query.geocode));
  }
  const qs = params.toString();
  return `/el-nino-analytics/mapa${qs ? `?${qs}` : ''}`;
}

/** Lê contratoId/geocode da query string do Next.js. */
export function parseMapaProjecaoQuery(
  query: Record<string, string | string[] | undefined>,
): MapaProjecaoQuery {
  return {
    contratoId: parseNum(query.contratoId ?? query.contrato_id),
    geocode: parseNum(query.geocode),
  };
}
