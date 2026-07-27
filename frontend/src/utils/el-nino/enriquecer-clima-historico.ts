import {
  buscarCoordenadasGeocode,
  buscarNomeMunicipioLista,
  obterConsorcio,
} from './contracts';
import {
  aplicarClimaNasLinhasMensais,
  linhaClimaValida,
  type LinhaClimaMensal,
} from './mesclar-clima';
import {
  lerClimaEra5Contrato,
  rebuildDfSerieFromMensal,
  resolverClimaMensalMunicipio,
} from './patch-cache-municipio';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_MESES_COM_TEMP = 12;

/** Memória: evita reconsultar Open-Meteo Archive a cada overview/série. */
const memoriaClima = new Map<
  string,
  { exp: number; clima: LinhaClimaMensal[] }
>();

function chaveCache(contratoId: number, geocode: number): string {
  return `${contratoId}:${geocode}`;
}

/** True se o município tem casos no cache, mas temperatura histórica insuficiente. */
export function municipioPrecisaClimaHistorico(
  dados: any,
  geocode: number,
): boolean {
  const gc = Number(geocode);
  const rows = (dados?.df_mensal_mun ?? []).filter(
    (r: any) => Number(r.geocode) === gc,
  );
  if (!rows.length) return false;
  const comTemp = rows.filter((r: any) => Number(r.Temperatura) > 0).length;
  return comTemp < Math.min(MIN_MESES_COM_TEMP, rows.length);
}

function mesclarClimaHistoricoPacote(
  existente: any[],
  novo: LinhaClimaMensal[],
  geocode: number,
): any[] {
  const gc = Number(geocode);
  const mapa = new Map<string, any>();
  for (const row of existente ?? []) {
    if (Number(row.geocode) !== gc) {
      mapa.set(`${row.geocode}-${row.Ano}-${row.MesNum}`, row);
      continue;
    }
    mapa.set(`${row.geocode}-${row.Ano}-${row.MesNum}`, row);
  }
  for (const row of novo) {
    if (!linhaClimaValida(row)) continue;
    mapa.set(`${row.geocode}-${row.Ano}-${row.MesNum}`, {
      ...row,
      TempMax: row.TempMax ?? null,
      Precipitacao: row.Precipitacao ?? 0,
      Umidade: row.Umidade ?? 0,
    });
  }
  return Array.from(mapa.values()).sort(
    (a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum || a.geocode - b.geocode,
  );
}

function atualizarDfSerieComMensal(dados: any, geocode: number): any {
  const gc = Number(geocode);
  const munLinhas = (dados.df_mensal_mun ?? []).filter(
    (r: any) => Number(r.geocode) === gc,
  );
  if (!munLinhas.length) return dados;

  const geos = new Set(
    (dados.df_mensal_mun ?? []).map((r: any) => Number(r.geocode)),
  );
  // Verba direta / escopo 1 município: reconstrói df_serie a partir do mensal.
  if (geos.size <= 1) {
    return {
      ...dados,
      df_serie: rebuildDfSerieFromMensal(munLinhas),
    };
  }

  // Consórcio: sobrescreve só Temperatura/Precipitação/Umidade no df_serie quando
  // a série agregada estava zerada e agora há temp no mensal do município filtrado.
  const serie = [...(dados.df_serie ?? [])];
  if (!serie.length) return dados;

  const tempPorMes = new Map<string, number>();
  for (const r of munLinhas) {
    const t = Number(r.Temperatura);
    if (t > 0) tempPorMes.set(`${r.Ano}-${r.MesNum}`, t);
  }
  if (!tempPorMes.size) return dados;

  const serieAtualizada = serie.map((r: any) => {
    const t = tempPorMes.get(`${r.Ano}-${r.MesNum}`);
    if (t == null || Number(r.Temperatura) > 0) return r;
    return { ...r, Temperatura: t };
  });
  return { ...dados, df_serie: serieAtualizada };
}

async function buscarClimaComCache(
  contratoId: number,
  geocode: number,
  nome: string,
  linhasMun: any[],
): Promise<LinhaClimaMensal[]> {
  const key = chaveCache(contratoId, geocode);
  const hit = memoriaClima.get(key);
  if (hit && hit.exp > Date.now() && hit.clima.length) {
    return hit.clima;
  }

  const coords = buscarCoordenadasGeocode(geocode);
  const clima = await resolverClimaMensalMunicipio(
    geocode,
    nome,
    contratoId,
    coords,
    linhasMun,
  );

  if (clima.some(linhaClimaValida)) {
    memoriaClima.set(key, {
      clima,
      exp: Date.now() + CACHE_TTL_MS,
    });
  }
  return clima;
}

/**
 * Preenche Temperatura/precipitação/umidade em df_mensal_mun quando o cache
 * pipeline veio com Temperatura=0 (comum em verba direta sem Archive/ERA5).
 * TTL em memória 24h — próxima carga reusa sem novo hit no Open-Meteo.
 */
export async function enriquecerClimaHistoricoEscopo(
  dados: any,
  contratoId: number,
): Promise<any> {
  const consorcio = obterConsorcio(contratoId);
  const municipios =
    (consorcio?.municipios?.length ?? 0) > 0
      ? consorcio!.municipios
      : (dados?.municipios ?? []).map((m: any) => ({
          geocode: Number(m.geocode),
          nome: m.municipio ?? m.nome,
        }));

  if (!municipios?.length) return dados;

  let out = dados;

  // ERA5 local (clima_cds_*.json) — síncrono, sem depender de Open-Meteo.
  const era5 = lerClimaEra5Contrato(contratoId);
  if (era5.some(linhaClimaValida)) {
    const mensalEra5 = aplicarClimaNasLinhasMensais(out.df_mensal_mun ?? [], era5);
    let climaHistorico = out.clima_historico ?? [];
    for (const gc of new Set(era5.map((r) => Number(r.geocode)).filter((g) => g > 0))) {
      climaHistorico = mesclarClimaHistoricoPacote(
        climaHistorico,
        era5.filter((r) => Number(r.geocode) === gc),
        gc,
      );
    }
    out = {
      ...out,
      df_mensal_mun: mensalEra5,
      clima_historico: climaHistorico,
    };
    for (const gc of new Set(era5.map((r) => Number(r.geocode)).filter(Boolean))) {
      out = atualizarDfSerieComMensal(out, gc);
    }
  }

  let alterou = era5.some(linhaClimaValida);

  for (const m of municipios) {
    const gc = Number(m.geocode);
    if (!gc || !municipioPrecisaClimaHistorico(out, gc)) continue;

    const nome =
      m.nome ||
      buscarNomeMunicipioLista(gc) ||
      `Município ${gc}`;
    const linhasMun = (out.df_mensal_mun ?? []).filter(
      (r: any) => Number(r.geocode) === gc,
    );

    try {
      const clima = await buscarClimaComCache(
        contratoId,
        gc,
        nome,
        linhasMun,
      );
      if (!clima.some(linhaClimaValida)) {
        console.warn(
          `[el-nino] clima histórico sem dados válidos para ${nome} (${gc})`,
        );
        continue;
      }

      const mensal = aplicarClimaNasLinhasMensais(
        out.df_mensal_mun ?? [],
        clima,
      );
      out = {
        ...out,
        df_mensal_mun: mensal,
        clima_historico: mesclarClimaHistoricoPacote(
          out.clima_historico ?? [],
          clima,
          gc,
        ),
      };
      out = atualizarDfSerieComMensal(out, gc);

      const fontes = Array.isArray(out.fontes) ? [...out.fontes] : [];
      const rotulo =
        'Open-Meteo Archive — clima histórico (enriquecimento automático)';
      if (!fontes.some((f: string) => String(f).includes('Open-Meteo Archive'))) {
        fontes.push(rotulo);
        out = { ...out, fontes };
      }
      alterou = true;

      // Rate-limit amigável quando houver vários municípios sem clima.
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      console.warn(
        `[el-nino] falha ao enriquecer clima histórico de ${nome} (${gc}):`,
        (err as Error)?.message ?? err,
      );
    }
  }

  if (alterou) {
    const avisos = Array.isArray(out.avisos)
      ? out.avisos.filter(
          (a: string) =>
            !String(a).toLowerCase().includes('clima histórico indispon'),
        )
      : [];
    out = { ...out, avisos };
  }

  return out;
}
