export interface BairroPeso {
  nome: string;
  peso: number;
}

function nomeBairroValido(nome: string): boolean {
  const n = (nome || '').trim().toUpperCase();
  return n.length > 0 && n !== 'SEM BAIRRO';
}

export function formatarNomeBairro(nome: string): string {
  const t = nome.trim();
  if (!t) return 'Sem bairro';
  return t
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function contarPoisBairro(bairro: {
  totalGeral?: number;
  tiposCriadouros?: Record<string, number>;
}): number {
  if (bairro.tiposCriadouros && typeof bairro.tiposCriadouros === 'object') {
    const soma = Object.values(bairro.tiposCriadouros).reduce(
      (s, v) => s + Math.max(0, Number(v) || 0),
      0,
    );
    if (soma > 0) return soma;
  }
  return Math.max(0, Number(bairro.totalGeral) || 0);
}

export function pesosDeCriadourosPorBairro(
  bairros: Array<{
    nomeBairro: string;
    totalGeral?: number;
    tiposCriadouros?: Record<string, number>;
  }>,
): BairroPeso[] {
  return bairros
    .filter((b) => nomeBairroValido(b.nomeBairro))
    .map((b) => ({
      nome: formatarNomeBairro(b.nomeBairro),
      peso: contarPoisBairro(b),
    }))
    .filter((b) => b.peso > 0);
}

/** Distribui inteiros proporcionalmente ao peso (método do maior resto). */
export function distribuirCasosPorBairro(
  total: number,
  bairros: BairroPeso[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (!bairros.length) return out;

  const soma = bairros.reduce((s, b) => s + Math.max(0, b.peso), 0);
  if (total <= 0 || soma <= 0) {
    for (const b of bairros) out.set(b.nome, 0);
    return out;
  }

  const partes = bairros.map((b) => {
    const exact = (total * Math.max(0, b.peso)) / soma;
    const floor = Math.floor(exact);
    return { nome: b.nome, floor, frac: exact - floor };
  });

  const restante = total - partes.reduce((s, p) => s + p.floor, 0);
  const ordenados = [...partes].sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < restante; i++) {
    ordenados[i % ordenados.length].floor += 1;
  }
  for (const p of partes) out.set(p.nome, p.floor);
  return out;
}

export function casosNotificadosMunicipio(
  geocode: number,
  dfMunicipios: Array<{
    geocode?: number;
    casos_notificados?: number;
    casos_estimados?: number;
  }>,
  dfMensalMun: Array<{
    geocode?: number;
    casos_notificados?: number;
    CasosDengue?: number;
  }>,
): { notificados: number; estimados: number } {
  const gc = Number(geocode);
  const linhaDf = dfMunicipios.find((m) => Number(m.geocode) === gc);
  const notificados = Number(linhaDf?.casos_notificados) || 0;
  const estimados = Number(linhaDf?.casos_estimados) || 0;

  if (notificados > 0 || estimados > 0) {
    return { notificados, estimados };
  }

  const mensal = dfMensalMun.filter((r) => Number(r.geocode) === gc);
  if (!mensal.length) return { notificados: 0, estimados: 0 };

  const somaNotificados = mensal.reduce(
    (s, r) => s + (Number(r.casos_notificados) || 0),
    0,
  );
  const somaEstimados = mensal.reduce(
    (s, r) => s + (Number(r.CasosDengue) || 0),
    0,
  );

  return {
    notificados: somaNotificados > 0 ? somaNotificados : 0,
    estimados: somaEstimados,
  };
}
