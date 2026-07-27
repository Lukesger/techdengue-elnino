export function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function validarTemperatura(v: unknown): number {
  const n = toNumber(v);
  return Math.min(45, Math.max(0, n));
}

export function validarPrecipitacao(v: unknown): number {
  const n = toNumber(v);
  return Math.max(0, n);
}

/** Umidade relativa: clamp em [0,100]. Ausente/invalida -> 0 (sentinela "sem dado"). */
export function validarUmidade(v: unknown): number {
  const n = toNumber(v);
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Convencao do modulo: clima ausente e representado por 0 (sentinela) em
 * Temperatura/Umidade; um mes so tem clima real quando qualquer variavel > 0.
 * Usado para nao diluir medias/correlacoes com meses sem ERA5/Open-Meteo.
 */
export function climaPresente(row: {
  Temperatura?: number | null;
  Umidade?: number | null;
  Precipitacao?: number | null;
}): boolean {
  const t = Number(row?.Temperatura);
  const u = Number(row?.Umidade);
  const p = Number(row?.Precipitacao);
  return (
    (Number.isFinite(t) && t > 0) ||
    (Number.isFinite(u) && u > 0) ||
    (Number.isFinite(p) && p > 0)
  );
}

/** Converte sentinela (<=0) em null para nao poluir Pearson (temperatura/umidade). */
export function valorClimaOuNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function validarCasos(v: unknown): number {
  const n = Math.round(toNumber(v));
  return Math.max(0, n);
}

export function validarPercentual(v: unknown): number {
  const n = toNumber(v);
  if (n > 0 && n <= 1) return Math.round(n * 1000) / 10;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

export function round(v: number, casas = 1): number {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

export function pearson(
  xs: Array<number | null | undefined>,
  ys: Array<number | null | undefined>,
): number | null {
  const pares: Array<[number, number]> = [];
  for (let i = 0; i < xs.length; i += 1) {
    // null/undefined = ausente (Number(null) seria 0 e poluiria a correlacao).
    if (xs[i] == null || ys[i] == null) continue;
    const x = Number(xs[i]);
    const y = Number(ys[i]);
    if (Number.isFinite(x) && Number.isFinite(y)) pares.push([x, y]);
  }
  if (pares.length < 4) return null;
  const xv = pares.map((p) => p[0]);
  const yv = pares.map((p) => p[1]);
  const mx = xv.reduce((a, b) => a + b, 0) / xv.length;
  const my = yv.reduce((a, b) => a + b, 0) / yv.length;
  const sx = Math.sqrt(xv.reduce((s, v) => s + (v - mx) ** 2, 0) / xv.length);
  const sy = Math.sqrt(yv.reduce((s, v) => s + (v - my) ** 2, 0) / yv.length);
  if (sx === 0 || sy === 0) return null;
  const cov =
    pares.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / pares.length;
  return Math.round(Math.max(-1, Math.min(1, cov / (sx * sy))) * 1000) / 1000;
}

/** Conta pares (x,y) ambos finitos — usado para expor o n real da correlacao. */
export function contarParesFinitos(
  xs: Array<number | null | undefined>,
  ys: Array<number | null | undefined>,
): number {
  let n = 0;
  for (let i = 0; i < xs.length; i += 1) {
    if (xs[i] == null || ys[i] == null) continue;
    if (Number.isFinite(Number(xs[i])) && Number.isFinite(Number(ys[i])))
      n += 1;
  }
  return n;
}

export function interpretarR(r: number): string {
  const a = Math.abs(r);
  if (a >= 0.5) return 'Correlação forte';
  if (a >= 0.3) return 'Correlação moderada';
  return 'Correlação fraca';
}
