/**
 * ONI NOAA embutido (browser-safe) — preenche buracos 2020–2025 e meses recentes
 * quando a API/live não trouxe a série completa.
 * Fonte: NOAA CPC oni.ascii.txt (estação → mês central).
 */

export interface OniPonto {
  ano: number;
  mes: number;
  oni: number;
}

/** 2020–2024 — CPC (inclui El Niño 2023–24, pico NDJ/Dez). */
export const ONI_FALLBACK_HISTORICO: OniPonto[] = [
  { ano: 2020, mes: 1, oni: 0.64 },
  { ano: 2020, mes: 2, oni: 0.63 },
  { ano: 2020, mes: 3, oni: 0.53 },
  { ano: 2020, mes: 4, oni: 0.3 },
  { ano: 2020, mes: 5, oni: 0.01 },
  { ano: 2020, mes: 6, oni: -0.23 },
  { ano: 2020, mes: 7, oni: -0.36 },
  { ano: 2020, mes: 8, oni: -0.53 },
  { ano: 2020, mes: 9, oni: -0.85 },
  { ano: 2020, mes: 10, oni: -1.12 },
  { ano: 2020, mes: 11, oni: -1.2 },
  { ano: 2020, mes: 12, oni: -1.08 },
  { ano: 2021, mes: 1, oni: -0.91 },
  { ano: 2021, mes: 2, oni: -0.79 },
  { ano: 2021, mes: 3, oni: -0.71 },
  { ano: 2021, mes: 4, oni: -0.55 },
  { ano: 2021, mes: 5, oni: -0.39 },
  { ano: 2021, mes: 6, oni: -0.3 },
  { ano: 2021, mes: 7, oni: -0.35 },
  { ano: 2021, mes: 8, oni: -0.45 },
  { ano: 2021, mes: 9, oni: -0.63 },
  { ano: 2021, mes: 10, oni: -0.76 },
  { ano: 2021, mes: 11, oni: -0.91 },
  { ano: 2021, mes: 12, oni: -0.87 },
  { ano: 2022, mes: 1, oni: -0.82 },
  { ano: 2022, mes: 2, oni: -0.79 },
  { ano: 2022, mes: 3, oni: -0.86 },
  { ano: 2022, mes: 4, oni: -0.95 },
  { ano: 2022, mes: 5, oni: -0.9 },
  { ano: 2022, mes: 6, oni: -0.78 },
  { ano: 2022, mes: 7, oni: -0.7 },
  { ano: 2022, mes: 8, oni: -0.8 },
  { ano: 2022, mes: 9, oni: -0.99 },
  { ano: 2022, mes: 10, oni: -0.99 },
  { ano: 2022, mes: 11, oni: -0.91 },
  { ano: 2022, mes: 12, oni: -0.83 },
  { ano: 2023, mes: 1, oni: -0.7 },
  { ano: 2023, mes: 2, oni: -0.4 },
  { ano: 2023, mes: 3, oni: -0.1 },
  { ano: 2023, mes: 4, oni: 0.2 },
  { ano: 2023, mes: 5, oni: 0.5 },
  { ano: 2023, mes: 6, oni: 0.8 },
  { ano: 2023, mes: 7, oni: 1.1 },
  { ano: 2023, mes: 8, oni: 1.3 },
  { ano: 2023, mes: 9, oni: 1.6 },
  { ano: 2023, mes: 10, oni: 1.8 },
  { ano: 2023, mes: 11, oni: 1.9 },
  { ano: 2023, mes: 12, oni: 2.0 },
  { ano: 2024, mes: 1, oni: 1.8 },
  { ano: 2024, mes: 2, oni: 1.5 },
  { ano: 2024, mes: 3, oni: 1.1 },
  { ano: 2024, mes: 4, oni: 0.7 },
  { ano: 2024, mes: 5, oni: 0.4 },
  { ano: 2024, mes: 6, oni: 0.2 },
  { ano: 2024, mes: 7, oni: 0.0 },
  { ano: 2024, mes: 8, oni: -0.1 },
  { ano: 2024, mes: 9, oni: -0.2 },
  { ano: 2024, mes: 10, oni: -0.3 },
  { ano: 2024, mes: 11, oni: -0.4 },
  { ano: 2024, mes: 12, oni: -0.5 },
];

export const ONI_FALLBACK_RECENTE: OniPonto[] = [
  ...ONI_FALLBACK_HISTORICO,
  { ano: 2025, mes: 1, oni: -0.6 },
  { ano: 2025, mes: 2, oni: -0.3 },
  { ano: 2025, mes: 3, oni: -0.1 },
  { ano: 2025, mes: 4, oni: 0.0 },
  { ano: 2025, mes: 5, oni: -0.1 },
  { ano: 2025, mes: 6, oni: -0.2 },
  { ano: 2025, mes: 7, oni: -0.3 },
  { ano: 2025, mes: 8, oni: -0.4 },
  { ano: 2025, mes: 9, oni: -0.5 },
  { ano: 2025, mes: 10, oni: -0.51 },
  { ano: 2025, mes: 11, oni: -0.55 },
  { ano: 2025, mes: 12, oni: -0.54 },
  { ano: 2026, mes: 1, oni: -0.37 },
  { ano: 2026, mes: 2, oni: -0.14 },
  { ano: 2026, mes: 3, oni: 0.11 },
  { ano: 2026, mes: 4, oni: 0.46 },
  { ano: 2026, mes: 5, oni: 0.95 },
  { ano: 2026, mes: 6, oni: 1.39 },
];

/** Aceita ano/mes/oni em camelCase ou PascalCase (Nest / cache). */
export function normalizarOniPonto(
  raw: unknown,
): OniPonto | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const ano = Number(o.ano ?? o.Ano);
  const mes = Number(o.mes ?? o.Mes ?? o.MesNum ?? o.mes_num);
  const oni = Number(o.oni ?? o.ONI);
  if (
    !Number.isFinite(ano) ||
    !Number.isFinite(mes) ||
    mes < 1 ||
    mes > 12 ||
    !Number.isFinite(oni)
  ) {
    return null;
  }
  return { ano, mes, oni };
}

export function normalizarListaOni(lista: unknown): OniPonto[] {
  if (!Array.isArray(lista) || !lista.length) return [];
  const map = new Map<string, OniPonto>();
  for (const raw of lista) {
    const p = normalizarOniPonto(raw);
    if (!p) continue;
    map.set(`${p.ano}-${p.mes}`, p);
  }
  return [...map.values()].sort((a, b) => a.ano - b.ano || a.mes - b.mes);
}

/**
 * Preenche meses ausentes com fallback embutido (não sobrescreve valores vivos).
 */
export function completarOniComFallback(
  lista: unknown,
  fallback: OniPonto[] = ONI_FALLBACK_RECENTE,
): OniPonto[] {
  const map = new Map<string, OniPonto>();
  for (const p of fallback) {
    map.set(`${p.ano}-${p.mes}`, { ...p });
  }
  for (const p of normalizarListaOni(lista)) {
    map.set(`${p.ano}-${p.mes}`, p);
  }
  return [...map.values()].sort((a, b) => a.ano - b.ano || a.mes - b.mes);
}
