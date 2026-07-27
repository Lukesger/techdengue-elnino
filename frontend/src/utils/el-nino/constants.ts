export const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

/** Início fixo dos filtros e séries históricas (não janela móvel de N anos). */
export const ANO_INICIO_PADRAO = 2020;

/** Rótulo fallback do último pico El Niño (ONI NOAA) quando a detecção automática falhar. */
export const LABEL_PICO_EL_NINO_FALLBACK = 'Dez/23';

export const ONI_EL_NINO = 0.5;

export const MUNICIPIOS_ICISMEP_BH = [
  { geocode: 3106408, municipio: 'Belo Vale', lat: -20.4078, lon: -44.0244 },
  { geocode: 3108107, municipio: 'Bonfim', lat: -20.7339, lon: -44.1742 },
  { geocode: 3110004, municipio: 'Caeté', lat: -19.88, lon: -43.6697 },
  { geocode: 3117876, municipio: 'Confins', lat: -19.6325, lon: -43.9828 },
  { geocode: 3120607, municipio: 'Crucilândia', lat: -20.3839, lon: -44.3369 },
  { geocode: 3126000, municipio: 'Florestal', lat: -19.8894, lon: -44.4325 },
  { geocode: 3131901, municipio: 'Itabirito', lat: -20.2533, lon: -43.8014 },
  { geocode: 3134608, municipio: 'Jaboticatubas', lat: -19.5136, lon: -43.745 },
  { geocode: 3140001, municipio: 'Mariana', lat: -20.3771, lon: -43.4161 },
  { geocode: 3140159, municipio: 'Mário Campos', lat: -20.0564, lon: -44.1883 },
  { geocode: 3140704, municipio: 'Mateus Leme', lat: -19.9864, lon: -44.4278 },
  { geocode: 3142304, municipio: 'Moeda', lat: -20.3331, lon: -44.0528 },
  { geocode: 3136603, municipio: 'Nova União', lat: -19.6879, lon: -43.5834 },
  { geocode: 3146107, municipio: 'Ouro Preto', lat: -20.3948, lon: -43.5052 },
  { geocode: 3150406, municipio: 'Piedade dos Gerais', lat: -20.4711, lon: -44.2272 },
  { geocode: 3153905, municipio: 'Raposos', lat: -19.9672, lon: -43.8042 },
  { geocode: 3154804, municipio: 'Rio Acima', lat: -20.0875, lon: -43.7894 },
  { geocode: 3155306, municipio: 'Rio Manso', lat: -20.2653, lon: -44.3078 },
  { geocode: 3159001, municipio: 'Santana do Riacho', lat: -19.169, lon: -43.7139 },
  { geocode: 3162955, municipio: 'São José da Lapa', lat: -19.7003, lon: -43.9602 },
  { geocode: 3165537, municipio: 'Sarzedo', lat: -20.0353, lon: -44.1447 },
  { geocode: 3168309, municipio: 'Taquaraçu de Minas', lat: -19.6701, lon: -43.6886 },
];

export const ROTULO_CONJUNTO = 'ICISMEP — ZURS BHTE';
/** @deprecated Não usar como default global — cada escopo usa o próprio contrato. */
export const CONTRATO_FOCO_ID = 19;

/**
 * Último ano disponível nos filtros e janelas de série.
 * Inclui o ano corrente (dados parciais de dengue/clima já entram nos gráficos).
 */
export function anoFimDados(): number {
  return new Date().getFullYear();
}

export function referenciaTemporal() {
  const agora = new Date();
  const anoFim = agora.getFullYear();
  const mesFim = agora.getMonth() + 1;
  return { anoInicio: ANO_INICIO_PADRAO, anoFim, mesInicio: 1, mesFim };
}

export function dentroJanela(ano: number, mes: number, ref: ReturnType<typeof referenciaTemporal>) {
  if (ano < ref.anoInicio || ano > ref.anoFim) return false;
  if (ano === ref.anoInicio && mes < ref.mesInicio) return false;
  if (ano === ref.anoFim && mes > ref.mesFim) return false;
  return true;
}

export function tipoElNinoMensal(oni: number | null | undefined): string {
  if (oni == null) return 'Neutro';
  if (oni >= 2.0) return 'Muito Forte';
  if (oni >= 1.5) return 'Forte';
  if (oni >= 1.0) return 'Moderado';
  if (oni >= 0.5) return 'Fraco';
  if (oni <= -1.5) return 'La Nina Forte';
  if (oni <= -1.0) return 'La Nina Moderado';
  if (oni <= -0.5) return 'La Nina Fraco';
  return 'Neutro';
}

export function tipoElNinoAnual(oniMedio: number): string {
  if (oniMedio >= 0.5) return 'Com El Nino';
  if (oniMedio <= -0.5) return 'Sem El Nino';
  return 'Neutro';
}

export function fmtInteiro(v: number): string {
  return Math.round(v).toLocaleString('pt-BR');
}

export function fmtDecimal(v: number, casas = 1): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function fmtTemp(v: number): string {
  return `${fmtDecimal(v)} °C`;
}

export function fmtUmidade(v: number): string {
  return `${Math.round(v)} %`;
}

export function validarTemperatura(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > -50 && n < 60 ? Math.round(n * 10) / 10 : null;
}

export function validarPrecipitacao(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null;
}

export function validarCasos(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** Ex.: "202623" → "2026/23" (semana epidemiológica Infodengue). */
export function formatarSemanaEpi(semana: string | number | undefined | null): string {
  const s = String(semana ?? '').trim();
  if (!s) return '';
  if (s.includes('/')) return s;
  const m = s.match(/^(\d{4})(\d{1,2})$/);
  if (m) return `${m[1]}/${m[2].padStart(2, '0')}`;
  return s;
}
