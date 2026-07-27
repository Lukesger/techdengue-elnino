const PREPOSICOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/** Detecta nomes em CAIXA ALTA (ex.: BETIM, NOVA LIMA). */
export function estaTodoMaiusculo(nome: string): boolean {
  const letters = nome.replace(/[^a-zA-ZÀ-ÿ]/g, '');
  return (
    letters.length > 2 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase()
  );
}

/** Converte CAIXA ALTA para forma própria (Bom Despacho, Nova Lima). */
export function formatarNomeProprio(nome: string): string {
  const s = nome.trim();
  if (!s || !estaTodoMaiusculo(s)) return s;

  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part, i) => {
      if (/^\s+$/.test(part) || part === '-') return part;
      const lower = part.toLowerCase();
      if (i > 0 && PREPOSICOES.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}
