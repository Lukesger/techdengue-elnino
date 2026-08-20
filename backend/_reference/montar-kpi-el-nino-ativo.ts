/**
 * Estrutura canônica do KPI "El Nino Ativo" (só backend).
 * O frontend apenas devolve este card já montado.
 */

export type KpiCardElNino = {
  titulo: string;
  valor: string;
  subtitulo: string;
};

export type OniMensalPonto = {
  ano: number;
  mes: number;
  oni: number;
};

const MESES = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
] as const;

function fmtOni(valor: number): string {
  return valor.toFixed(2);
}

function classificarRotulo(oni: number | null | undefined): {
  ativo: boolean;
  rotulo: string;
} {
  const v = Number(oni ?? 0);
  if (!Number.isFinite(v)) return { ativo: false, rotulo: 'Neutro' };
  if (v >= 2.0) return { ativo: true, rotulo: 'El Niño muito forte' };
  if (v >= 1.5) return { ativo: true, rotulo: 'El Niño forte' };
  if (v >= 0.5) return { ativo: true, rotulo: 'El Niño moderado' };
  if (v <= -0.5) return { ativo: false, rotulo: 'La Niña' };
  return { ativo: false, rotulo: 'Neutro' };
}

function ultimoOniMensal(
  oniMensal: OniMensalPonto[] | null | undefined,
): OniMensalPonto | null {
  const lista = oniMensal ?? [];
  if (!lista.length) return null;
  return [...lista].sort((a, b) => a.ano - b.ano || a.mes - b.mes).at(-1) ?? null;
}

export function montarKpiElNinoAtivo(
  oniMensal: OniMensalPonto[] | null | undefined,
): KpiCardElNino {
  const oniUlt = ultimoOniMensal(oniMensal);
  if (!oniUlt) {
    return { titulo: 'El Nino Ativo', valor: '—', subtitulo: '' };
  }

  const { ativo, rotulo } = classificarRotulo(oniUlt.oni);
  const partes = [
    `ONI ${fmtOni(oniUlt.oni)}`,
    `${MESES[oniUlt.mes - 1] ?? String(oniUlt.mes)}/${oniUlt.ano}`,
  ];
  if (rotulo !== 'Neutro') partes.push(rotulo);

  return {
    titulo: 'El Nino Ativo',
    valor: ativo ? 'Sim' : 'Nao',
    subtitulo: partes.join(' · '),
  };
}
