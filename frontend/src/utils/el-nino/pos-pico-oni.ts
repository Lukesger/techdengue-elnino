import { OniMensal, SerieMensal } from '@/services/el-nino-api';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const LIMIAR_ONI_EL_NINO = 0.5;

function mesOffset(ano: number, mes: number, offset: number) {
  let m = mes + offset;
  let a = ano;
  while (m > 12) {
    m -= 12;
    a += 1;
  }
  while (m < 1) {
    m += 12;
    a -= 1;
  }
  return { ano: a, mes: m };
}

function casosNoMes(serie: SerieMensal[], ano: number, mes: number): number | null {
  const row = serie.find((r) => r.Ano === ano && r.MesNum === mes);
  return row?.CasosDengue ?? null;
}

function pctVariacao(atual: number | null, base: number | null): number | null {
  if (base == null || atual == null || base <= 0) return null;
  return Math.round(((atual - base) / base) * 1000) / 10;
}

function detectarEpisodiosOni(oniMensal: OniMensal[], anoInicio: number, anoFim: number) {
  const pontos: OniMensal[] = [];
  for (let ano = anoInicio; ano <= anoFim; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      const rec = oniMensal.find((o) => o.ano === ano && o.mes === mes);
      if (rec?.oni == null || !Number.isFinite(rec.oni)) continue;
      pontos.push(rec);
    }
  }

  const episodios: Array<{ meses: OniMensal[]; encerrado: boolean }> = [];
  let atual: OniMensal[] | null = null;
  for (const p of pontos) {
    if (p.oni >= LIMIAR_ONI_EL_NINO) {
      if (!atual) atual = [];
      atual.push(p);
    } else if (atual) {
      episodios.push({ meses: atual, encerrado: true });
      atual = null;
    }
  }
  // Episódio ainda aberto (ex.: Abr–Mai/2026 em curso) — sem pós-pico confiável.
  if (atual) episodios.push({ meses: atual, encerrado: false });

  return episodios.map(({ meses, encerrado }) => ({
    meses,
    encerrado,
    pico: meses.reduce((a, b) => (b.oni > a.oni ? b : a)),
  }));
}

function normalizarLabelMes(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Índice do último pico ONI em série mensal (labels + valores observados).
 * Usado para recortar gráficos a partir do pico do último episódio El Niño.
 */
export function indiceUltimoPicoElNino(
  labels: string[],
  oni: Array<number | null | undefined>,
  idxUltimoReal: number,
  labelFallback = 'Dez/23',
): number {
  const episodios: Array<Array<{ i: number; oni: number }>> = [];
  let atual: Array<{ i: number; oni: number }> | null = null;
  const limite = Math.min(idxUltimoReal, oni.length - 1, labels.length - 1);

  for (let i = 0; i <= limite; i++) {
    const v = oni[i];
    if (v != null && Number.isFinite(v) && v >= LIMIAR_ONI_EL_NINO) {
      if (!atual) atual = [];
      atual.push({ i, oni: v });
    } else if (atual) {
      episodios.push(atual);
      atual = null;
    }
  }
  if (atual) episodios.push(atual);

  if (episodios.length) {
    const pico = episodios[episodios.length - 1].reduce((a, b) =>
      b.oni > a.oni ? b : a,
    );
    return pico.i;
  }

  const alvo = normalizarLabelMes(labelFallback);
  const idxFallback = labels.findIndex(
    (l) => normalizarLabelMes(l) === alvo,
  );
  return idxFallback >= 0 ? idxFallback : 0;
}

export interface EventoPosPicoOni {
  rotulo: string;
  oniPico: number;
  casosPico: number;
  casosM1: number | null;
  casosM2: number | null;
  pctM1: number | null;
  pctM2: number | null;
  modoAbsoluto: boolean;
  rotuloM1: string;
  rotuloM2: string;
}

export interface AnalisePosPicoOni {
  eventos: EventoPosPicoOni[];
  mediaPctM1: number | null;
  mediaPctM2: number | null;
  modoAbsoluto: boolean;
}

/** Port de `analisarCrescimentoPosPicoOni` do Dash_Completo. */
export function analisarCrescimentoPosPicoOni(
  oniMensal: OniMensal[],
  serie: SerieMensal[],
  anoInicio: number,
  anoFim: number,
): AnalisePosPicoOni {
  const episodios = detectarEpisodiosOni(oniMensal, anoInicio, anoFim);

  interface EventoBruto {
    rotulo: string;
    oniPico: number;
    casosPico: number | null;
    casosM1: number | null;
    casosM2: number | null;
    temBase: boolean;
    rotuloM1: string;
    rotuloM2: string;
  }

  const brutos: EventoBruto[] = [];
  for (const { pico, encerrado } of episodios) {
    // Só episódios já encerrados (ONI voltou < 0,5). Evita barras como Mai/2026
    // enquanto o El Niño ainda está em curso — Mar/2026 era neutro e o pico
    // parcial ainda não tem janela pós-pico completa.
    if (!encerrado) continue;

    const casosPico = casosNoMes(serie, pico.ano, pico.mes);
    const m1 = mesOffset(pico.ano, pico.mes, 1);
    const m2 = mesOffset(pico.ano, pico.mes, 2);
    const casosM1 = casosNoMes(serie, m1.ano, m1.mes);
    const casosM2 = casosNoMes(serie, m2.ano, m2.mes);

    if (m1.ano < anoInicio || m1.ano > anoFim) continue;

    const temBase = casosPico != null && casosPico > 0;
    const temCasosPosPico =
      (casosM1 != null && casosM1 > 0) || (casosM2 != null && casosM2 > 0);
    if (!temBase && !temCasosPosPico) continue;

    brutos.push({
      rotulo: `${MESES[pico.mes - 1]}/${pico.ano}`,
      oniPico: Math.round(pico.oni * 100) / 100,
      casosPico,
      casosM1,
      casosM2,
      temBase,
      rotuloM1: `${MESES[m1.mes - 1]}/${m1.ano}`,
      rotuloM2: `${MESES[m2.mes - 1]}/${m2.ano}`,
    });
  }

  // Modo único e consistente para todo o gráfico: percentual quando há ao menos
  // um episódio com base válida (casos no pico); caso contrário, absoluto.
  // Evita misturar % e contagem num mesmo eixo/legenda/média (P4).
  const modoAbsoluto = brutos.length > 0 && !brutos.some((e) => e.temBase);

  const selecionados = modoAbsoluto ? brutos : brutos.filter((e) => e.temBase);

  const eventos: EventoPosPicoOni[] = selecionados.map((e) => ({
    rotulo: e.rotulo,
    oniPico: e.oniPico,
    casosPico: e.casosPico ?? 0,
    casosM1: e.casosM1,
    casosM2: e.casosM2,
    pctM1: modoAbsoluto
      ? e.casosM1 != null && e.casosM1 > 0
        ? e.casosM1
        : null
      : pctVariacao(e.casosM1, e.casosPico),
    pctM2: modoAbsoluto
      ? e.casosM2 != null && e.casosM2 > 0
        ? e.casosM2
        : null
      : pctVariacao(e.casosM2, e.casosPico),
    modoAbsoluto,
    rotuloM1: e.rotuloM1,
    rotuloM2: e.rotuloM2,
  }));

  const media = (vals: number[]) =>
    vals.length
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
      : null;

  return {
    eventos,
    mediaPctM1: media(eventos.map((e) => e.pctM1).filter((v): v is number => v != null)),
    mediaPctM2: media(eventos.map((e) => e.pctM2).filter((v): v is number => v != null)),
    modoAbsoluto,
  };
}
