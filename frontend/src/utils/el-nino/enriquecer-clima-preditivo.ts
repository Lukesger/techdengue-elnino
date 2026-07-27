import { buscarClimaOpenMeteo, resolverCoordenadasMunicipio } from './clima-atual';
import type { ClimaForecast } from '@/services/el-nino-api';
import { obterConsorcio } from './contracts';

const STALE_MS = 45 * 60 * 1000; // renova se o snapshot do cache tiver >45 min

function forecastStale(cf: ClimaForecast | null | undefined): boolean {
  if (!cf?.atualizado_em) return true;
  const t = Date.parse(cf.atualizado_em);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > STALE_MS;
}

function climaPositivo(cf: ClimaForecast | null | undefined): boolean {
  return Boolean(cf?.dias?.length || Number(cf?.atual?.temperatura_c) > 0);
}

/**
 * Atualiza clima_municipios / clima com Open-Meteo Forecast ao vivo (TTL interno 15 min).
 * Garante que painéis e temp_proj do mês corrente não fiquem presos no pipeline estático.
 */
export async function enriquecerClimaPreditivoEscopo(
  dados: any,
  contratoId: number,
  opts: { geocodePreferido?: number } = {},
): Promise<any> {
  const consorcio = obterConsorcio(contratoId);
  const listaBase: Array<{ geocode: number; nome?: string }> =
    (consorcio?.municipios?.length ?? 0) > 0
      ? consorcio!.municipios.map((m) => ({
          geocode: Number(m.geocode),
          nome: m.nome,
        }))
      : (dados?.municipios ?? []).map((m: any) => ({
          geocode: Number(m.geocode),
          nome: m.municipio ?? m.nome,
        }));

  if (!listaBase.length) return dados;

  // Prioriza o município filtrado; evita N chamadas em consórcios grandes.
  const preferido = opts.geocodePreferido
    ? Number(opts.geocodePreferido)
    : null;
  const alvos =
    preferido && listaBase.some((m) => m.geocode === preferido)
      ? listaBase.filter((m) => m.geocode === preferido)
      : listaBase.length === 1
        ? listaBase
        : listaBase.slice(0, 3);

  const climaMunicipios: Record<number, ClimaForecast> = {
    ...(dados.clima_municipios ?? {}),
  };
  let alterou = false;

  for (const m of alvos) {
    const gc = m.geocode;
    const atual = climaMunicipios[gc] ?? climaMunicipios[String(gc) as any];
    if (climaPositivo(atual) && !forecastStale(atual)) continue;

    const coords = resolverCoordenadasMunicipio(dados, gc);
    if (!coords) continue;

    try {
      const live = await buscarClimaOpenMeteo({
        ...coords,
        cidade: coords.cidade || m.nome || `Município ${gc}`,
      });
      if (!climaPositivo(live)) continue;
      climaMunicipios[gc] = live;
      alterou = true;
    } catch {
      /* mantém snapshot anterior */
    }
  }

  if (!alterou) return dados;

  const primeiro =
    (preferido && climaMunicipios[preferido]) ||
    Object.values(climaMunicipios)[0] ||
    dados.clima;

  const fontes = Array.isArray(dados.fontes) ? [...dados.fontes] : [];
  const rotulo = 'Open-Meteo Forecast — clima preditivo (atualização automática)';
  if (!fontes.some((f: string) => String(f).includes('atualização automática'))) {
    fontes.push(rotulo);
  }

  return {
    ...dados,
    clima: primeiro ?? dados.clima,
    clima_municipios: climaMunicipios,
    fontes,
  };
}

/**
 * Média de temperatura prevista por mês civil a partir dos dias do forecast 14d.
 * Usado em temp_proj dos meses próximos (além da climatologia histórica).
 */
export function mediaTempPrevistaPorMes(
  dados: any,
  geocode?: number | null,
): Map<string, number> {
  const out = new Map<string, number>();
  const mapa = dados?.clima_municipios ?? {};
  const gc = geocode != null ? Number(geocode) : null;

  const forecasts: ClimaForecast[] = [];
  if (gc != null && (mapa[gc] || mapa[String(gc)])) {
    forecasts.push(mapa[gc] ?? mapa[String(gc)]);
  } else if (dados?.clima?.dias?.length) {
    forecasts.push(dados.clima);
  } else {
    for (const v of Object.values(mapa)) {
      if (v && typeof v === 'object') forecasts.push(v as ClimaForecast);
    }
  }

  const buckets = new Map<string, number[]>();
  for (const cf of forecasts) {
    for (const d of cf.dias ?? []) {
      const iso = String(d.data ?? '');
      if (iso.length < 7) continue;
      const [anoStr, mesStr] = iso.split('-');
      const ano = Number(anoStr);
      const mes = Number(mesStr);
      if (!ano || !mes) continue;
      const max = Number(d.max_c);
      const min = Number(d.min_c);
      let media: number | null = null;
      if (Number.isFinite(max) && max > 0 && Number.isFinite(min) && min > 0) {
        media = (max + min) / 2;
      } else if (Number.isFinite(Number(d.temp_media)) && Number(d.temp_media) > 0) {
        media = Number(d.temp_media);
      } else if (Number.isFinite(max) && max > 0) {
        media = max;
      }
      if (media == null) continue;
      const k = `${ano}-${mes}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(media);
    }
  }

  for (const [k, vals] of buckets) {
    if (!vals.length) continue;
    out.set(
      k,
      Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
    );
  }
  return out;
}
