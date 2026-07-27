import type { ClimaForecast } from '@/services/el-nino-api';

function temperaturaPositiva(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function umidadeValida(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
}

function precipitacaoExibicao(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export type ClimaPainelMapa = {
  temp: number | null;
  umid: number | null;
  chuva: number | null;
  fonte: string;
  periodo: string;
};

/** Preenche temperatura atual a partir da previsão diária quando o snapshot está vazio. */
export function normalizarClimaForecast(cf: ClimaForecast): ClimaForecast {
  const atual = { ...cf.atual };
  let temp = temperaturaPositiva(atual.temperatura_c);
  if (temp == null && cf.dias?.length) {
    const d = cf.dias[0];
    const max = temperaturaPositiva(d.max_c);
    const min = temperaturaPositiva(d.min_c);
    if (max != null && min != null) {
      temp = Math.round(((max + min) / 2) * 10) / 10;
    } else if (max != null) {
      temp = max;
    }
  }
  if (temp != null) {
    atual.temperatura_c = temp;
  }
  return { ...cf, atual };
}

/**
 * Monta leitura do painel do mapa: prioriza fetch ao vivo e completa com cache municipal.
 * Ignora snapshots Open-Meteo zerados (0 °C / 0 mm) gerados por pipeline antigo.
 */
export function extrairClimaPainel(
  aoVivo: ClimaForecast | null | undefined,
  cacheMun?: {
    temperatura_c?: number;
    umidade_pct?: number;
    precipitacao_mm?: number;
    fonte?: string;
    periodo?: string;
  } | null,
): ClimaPainelMapa | null {
  const live = aoVivo ? normalizarClimaForecast(aoVivo) : null;

  let temp = live ? temperaturaPositiva(live.atual?.temperatura_c) : null;
  let umid = live ? umidadeValida(live.atual?.umidade_pct) : null;
  let chuva = live ? precipitacaoExibicao(live.atual?.precipitacao_mm) : null;
  let fonte = live?.fonte ?? '';
  let periodo = live?.atualizado_em
    ? new Date(live.atualizado_em).toLocaleString('pt-BR')
    : '';

  const c = cacheMun;
  if (c) {
    const cacheTempInvalido =
      String(c.fonte ?? '').includes('Open-Meteo') &&
      temperaturaPositiva(c.temperatura_c) == null;
    if (temp == null && !cacheTempInvalido) {
      temp = temperaturaPositiva(c.temperatura_c);
    }
    if (umid == null) umid = umidadeValida(c.umidade_pct);
    if (chuva == null) chuva = precipitacaoExibicao(c.precipitacao_mm);
    if (!fonte && c.fonte) fonte = c.fonte;
    if (!periodo && c.periodo) periodo = String(c.periodo);
  }

  if (temp == null && umid == null && chuva == null) return null;
  return { temp, umid, chuva, fonte, periodo };
}
