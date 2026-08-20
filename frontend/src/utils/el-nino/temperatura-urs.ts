/** Amostras de clima por URS — seguro no cliente (sem fs). */

export const AMOSTRAS_POR_URS = 3;

export type UrsComMunicipios = {
  id: number;
  nome: string;
  municipios?: Array<{
    geocode: number;
    nome?: string;
    lat?: number;
    lon?: number;
  }>;
};

export type AmostraUrs = {
  id: number;
  nome: string;
  geocodes: number[];
};

export type TempUrsLive = {
  id: number;
  nome: string;
  temperatura_c: number;
  n: number;
};

function temCoordenadas(m: { lat?: unknown; lon?: unknown }): boolean {
  const lat = Number(m.lat);
  const lon = Number(m.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0;
}

function temperaturaValida(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10) / 10;
}

export function rotuloUrsClima(nome: string): string {
  const n = String(nome || '').trim();
  if (!n) return 'URS';
  return /^urs\b/i.test(n) ? n : `URS ${n}`;
}

/**
 * Até `maxPorUrs` geocodes por URS, priorizando quem tem coordenadas
 * e está no recorte gerencial.
 */
export function escolherAmostrasUrs(
  urs: UrsComMunicipios[],
  opts?: {
    geocodesPermitidos?: number[] | null;
    municipiosComCoords?: Array<{ geocode: number; lat?: number; lon?: number }>;
    maxPorUrs?: number;
    ursId?: number | null;
  },
): AmostraUrs[] {
  const max = opts?.maxPorUrs ?? AMOSTRAS_POR_URS;
  const permitidos = opts?.geocodesPermitidos?.length
    ? new Set(opts.geocodesPermitidos.map(Number))
    : null;
  const coordsSet = new Set(
    (opts?.municipiosComCoords ?? [])
      .filter(temCoordenadas)
      .map((m) => Number(m.geocode)),
  );
  const filtroId =
    opts?.ursId != null && Number.isFinite(Number(opts.ursId))
      ? Number(opts.ursId)
      : null;

  const out: AmostraUrs[] = [];
  for (const u of urs ?? []) {
    const id = Number(u.id);
    if (!Number.isFinite(id)) continue;
    if (filtroId != null && id !== filtroId) continue;
    const muns = [...(u.municipios ?? [])]
      .map((m) => ({ ...m, geocode: Number(m.geocode) }))
      .filter((m) => Number.isFinite(m.geocode) && m.geocode > 0)
      .filter((m) => !permitidos || permitidos.has(m.geocode));
    if (!muns.length) continue;
    muns.sort((a, b) => {
      const ac = coordsSet.has(a.geocode) || temCoordenadas(a) ? 0 : 1;
      const bc = coordsSet.has(b.geocode) || temCoordenadas(b) ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR');
    });
    const geocodes = [...new Set(muns.map((m) => m.geocode))].slice(0, max);
    if (!geocodes.length) continue;
    out.push({
      id,
      nome: String(u.nome || `URS ${id}`),
      geocodes,
    });
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function geocodesDasAmostrasUrs(amostras: AmostraUrs[]): number[] {
  const vistos = new Set<number>();
  const out: number[] = [];
  for (const a of amostras) {
    for (const gc of a.geocodes) {
      if (vistos.has(gc)) continue;
      vistos.add(gc);
      out.push(gc);
    }
  }
  return out;
}

export function mediaTempUrs(
  amostra: AmostraUrs,
  climaPorGeocode: Record<
    number,
    { atual?: { temperatura_c?: unknown } } | undefined
  >,
): TempUrsLive | null {
  const temps: number[] = [];
  for (const gc of amostra.geocodes) {
    const t = temperaturaValida(climaPorGeocode[gc]?.atual?.temperatura_c);
    if (t != null) temps.push(t);
  }
  if (!temps.length) return null;
  const media =
    Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10;
  return {
    id: amostra.id,
    nome: amostra.nome,
    temperatura_c: media,
    n: temps.length,
  };
}

export function mediasTempTodasUrs(
  amostras: AmostraUrs[],
  climaPorGeocode: Record<
    number,
    { atual?: { temperatura_c?: unknown } } | undefined
  >,
): TempUrsLive[] {
  const out: TempUrsLive[] = [];
  for (const a of amostras) {
    const live = mediaTempUrs(a, climaPorGeocode);
    if (live) out.push(live);
  }
  return out;
}

export const ID_GRUPO_VERBA_DIRETA = -1;

export type ContratoParaTemp = {
  id: number;
  nome: string;
  eConsorcio?: number;
  municipios?: Array<{
    geocode: number;
    nome?: string;
    lat?: number;
    lon?: number;
  }>;
};

/**
 * Consórcios individuais + um bucket "Verba direta".
 * Com contratoId, devolve só aquele contrato (sem agrupar VD).
 */
export function agruparContratosParaTemp(
  contratos: ContratoParaTemp[],
  opts?: { contratoId?: number | null },
): UrsComMunicipios[] {
  const filtro =
    opts?.contratoId != null && Number(opts.contratoId) > 0
      ? Number(opts.contratoId)
      : null;

  if (filtro != null) {
    const c = (contratos ?? []).find((x) => Number(x.id) === filtro);
    if (!c) return [];
    return [
      {
        id: Number(c.id),
        nome: String(c.nome || `Contrato ${c.id}`),
        municipios: c.municipios,
      },
    ];
  }

  const grupos: UrsComMunicipios[] = [];
  const vdMuns: NonNullable<ContratoParaTemp['municipios']> = [];
  for (const c of contratos ?? []) {
    const id = Number(c.id);
    if (!Number.isFinite(id)) continue;
    if (Number(c.eConsorcio) === 0) {
      vdMuns.push(...(c.municipios ?? []));
      continue;
    }
    grupos.push({
      id,
      nome: String(c.nome || `Consórcio ${id}`),
      municipios: c.municipios,
    });
  }
  if (vdMuns.length) {
    grupos.push({
      id: ID_GRUPO_VERBA_DIRETA,
      nome: 'Verba direta',
      municipios: vdMuns,
    });
  }
  return grupos;
}

export function formatarKpiTempGrupo(live: TempUrsLive): {
  valor: string;
  subtitulo: string;
} {
  const nome = String(live.nome || '').trim() || 'Consórcio';
  return {
    valor: `${String(live.temperatura_c).replace('.', ',')} °C`,
    subtitulo: `${nome} · clima atual`,
  };
}

export function formatarKpiTempUrs(live: TempUrsLive): {
  valor: string;
  subtitulo: string;
} {
  return {
    valor: `${String(live.temperatura_c).replace('.', ',')} °C`,
    subtitulo: `${rotuloUrsClima(live.nome)} · clima atual`,
  };
}

export function aplicarTempGrupoNoKpi(
  kpis: Array<{ titulo: string; valor: string; subtitulo: string }>,
  live: TempUrsLive,
): Array<{ titulo: string; valor: string; subtitulo: string }> {
  const idx = kpis.findIndex((k) => /temperatura/i.test(k.titulo));
  if (idx < 0) return kpis;
  const fmt = formatarKpiTempGrupo(live);
  const next = kpis.map((k) => ({ ...k }));
  next[idx] = {
    ...next[idx],
    titulo: 'Temperatura atual',
    valor: fmt.valor,
    subtitulo: fmt.subtitulo,
  };
  return next;
}

export function aplicarTempUrsNoKpi(
  kpis: Array<{ titulo: string; valor: string; subtitulo: string }>,
  live: TempUrsLive,
): Array<{ titulo: string; valor: string; subtitulo: string }> {
  const idx = kpis.findIndex((k) => /temperatura/i.test(k.titulo));
  if (idx < 0) return kpis;
  const fmt = formatarKpiTempUrs(live);
  const next = kpis.map((k) => ({ ...k }));
  next[idx] = {
    ...next[idx],
    titulo: 'Temperatura atual',
    valor: fmt.valor,
    subtitulo: fmt.subtitulo,
  };
  return next;
}
