import fs from 'fs';
import path from 'path';
import {
  buscarCoordenadasGeocode,
  buscarNomeMunicipioLista,
  listarConsorcios,
  obterConsorcio,
} from './contracts';
import { buscarCasosMensaisInfodengue } from './infodengue-fallback';
import {
  aplicarClimaNasLinhasMensais,
  coberturaClimaCompleta,
  LinhaClimaMensal,
  mesclarClimaHistorico,
} from './mesclar-clima';
import { buscarHistoricoMensalOpenMeteo } from './open-meteo-clima';
import { ANO_INICIO_PADRAO } from './constants';

const DATA_DIR = path.join(process.cwd(), 'src', 'utils', 'el-nino', 'data');

export function tipoElNino(oni: number | null | undefined): string {
  if (oni == null) return 'Indefinido';
  if (oni >= 0.5) return 'El Nino';
  if (oni <= -0.5) return 'La Nina';
  return 'Neutro';
}

/** ERA5 do cache local `clima_cds_{contratoId}.json` (fallback). */
export function lerClimaEra5Contrato(
  contratoId: number,
  geocode?: number,
): LinhaClimaMensal[] {
  const file = path.join(DATA_DIR, `clima_cds_${contratoId}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const hist: any[] = raw.historico ?? [];
    return hist
      .filter((r) => (geocode == null ? true : Number(r.geocode) === Number(geocode)))
      .map((r) => ({
        geocode: Number(r.geocode),
        municipio: r.municipio,
        Ano: Number(r.Ano),
        MesNum: Number(r.MesNum),
        Mes: r.Mes,
        Temperatura: r.Temperatura,
        TempMax: r.TempMax,
        Precipitacao: r.Precipitacao,
        Umidade: r.Umidade,
        _fonte_clima: 'Copernicus ERA5',
      }));
  } catch {
    return [];
  }
}

function anosJanelaDasLinhas(linhas: any[]): { anoInicio: number; anoFim: number } | null {
  const anos = linhas
    .map((r) => Number(r.Ano))
    .filter((a) => Number.isFinite(a) && a > 2000);
  if (!anos.length) return null;
  const anoCorrente = new Date().getFullYear();
  return {
    anoInicio: Math.max(ANO_INICIO_PADRAO, Math.min(...anos)),
    // end_date do Archive é limitado a "hoje" em buscarHistoricoMensalOpenMeteo.
    anoFim: Math.min(Math.max(...anos), anoCorrente),
  };
}

function climaExistenteNasLinhas(
  linhas: any[],
  geocode: number,
): LinhaClimaMensal[] {
  return linhas
    .filter((r) => Number(r.geocode) === Number(geocode))
    .map((r) => ({
      geocode: Number(r.geocode),
      municipio: r.municipio,
      Ano: Number(r.Ano),
      MesNum: Number(r.MesNum),
      Mes: r.Mes,
      Temperatura: r.Temperatura,
      TempMax: r.TempMax,
      Precipitacao: r.Precipitacao,
      Umidade: r.Umidade,
      _fonte_clima: r._fonte_clima ?? 'cache existente',
    }));
}

async function resolverClimaComFallbackCache(
  geocode: number,
  nome: string,
  contratoId: number,
  linhasMensais: any[],
  coords?: { lat: number; lon: number } | null,
): Promise<LinhaClimaMensal[]> {
  const existente = climaExistenteNasLinhas(linhasMensais, geocode);
  const era5 = lerClimaEra5Contrato(contratoId, geocode);

  let openMeteo: LinhaClimaMensal[] = [];
  const c = coords ?? buscarCoordenadasGeocode(geocode);
  if (c?.lat != null && c?.lon != null) {
    const janela = anosJanelaDasLinhas(linhasMensais);
    try {
      openMeteo = await buscarHistoricoMensalOpenMeteo(
        geocode,
        nome,
        c.lat,
        c.lon,
        janela?.anoInicio,
        janela?.anoFim,
      );
    } catch {
      /* rate limit ou rede */
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  return mesclarClimaHistorico(
    openMeteo,
    mesclarClimaHistorico(era5, existente),
  );
}

/** Clima mensal: Open-Meteo (padrão) + ERA5 + cache existente. */
export async function resolverClimaMensalMunicipio(
  geocode: number,
  nome: string,
  contratoId: number,
  coords?: { lat: number; lon: number } | null,
  linhasCache?: any[],
): Promise<LinhaClimaMensal[]> {
  if (linhasCache?.length) {
    return resolverClimaComFallbackCache(
      geocode,
      nome,
      contratoId,
      linhasCache,
      coords,
    );
  }

  const c = coords ?? buscarCoordenadasGeocode(geocode);
  let openMeteo: LinhaClimaMensal[] = [];
  if (c?.lat != null && c?.lon != null) {
    try {
      openMeteo = await buscarHistoricoMensalOpenMeteo(
        geocode,
        nome,
        c.lat,
        c.lon,
      );
    } catch {
      /* fallback ERA5 */
    }
  }

  const era5 = lerClimaEra5Contrato(contratoId, geocode);
  return mesclarClimaHistorico(openMeteo, era5);
}

export function montarLinhasMensaisInfodengue(
  geocode: number,
  nome: string,
  dadosCache: any,
  casos: any[],
  climaMensal?: LinhaClimaMensal[],
): any[] {
  const oniMap = new Map<string, number>(
    (dadosCache.oni_mensal ?? []).map((o: any) => [
      `${o.ano}-${o.mes}`,
      Number(o.oni),
    ]),
  );

  const climaMap = new Map<string, LinhaClimaMensal>(
    (climaMensal ?? []).map((c) => [`${c.geocode}-${c.Ano}-${c.MesNum}`, c]),
  );

  const linhas = casos.map((c: any) => {
    const oniKey = `${c.Ano}-${c.MesNum}`;
    const oni = oniMap.get(oniKey) ?? null;
    const clima = climaMap.get(`${geocode}-${c.Ano}-${c.MesNum}`);
    const regional = !clima
      ? (dadosCache.df_serie_ponderada?.length > 0
          ? dadosCache.df_serie_ponderada
          : dadosCache.df_serie ?? []
        ).find((r: any) => r.Ano === c.Ano && r.MesNum === c.MesNum)
      : null;

    const fonteClima =
      clima?._fonte_clima ??
      (regional ? 'série regional (proxy)' : null);

    return {
      geocode: Number(geocode),
      municipio: nome,
      Ano: c.Ano,
      MesNum: c.MesNum,
      Mes: c.Mes,
      'Ano Mes': c.AnoMes ?? `${c.Ano}-${String(c.MesNum).padStart(2, '0')}`,
      CasosDengue: c.CasosDengue,
      casos_estimados: c.casos_estimados ?? c.CasosDengue,
      casos_notificados: c.casos_notificados ?? 0,
      Temperatura: clima?.Temperatura ?? regional?.Temperatura ?? null,
      TempMax: clima?.TempMax ?? regional?.TempMax ?? null,
      Precipitacao: clima?.Precipitacao ?? regional?.Precipitacao ?? null,
      Umidade: clima?.Umidade ?? regional?.Umidade ?? null,
      ONI: oni,
      'Tipo El Nino': tipoElNino(oni),
      ElNino: oni != null && oni >= 0.5 ? 1 : 0,
      _fonte_casos: 'Infodengue AlertCity',
      _fonte_clima: fonteClima,
    };
  });

  return linhas;
}

/** Série mensal agregada (1 município / verba direta) para gráficos e ONI. */
export function rebuildDfSerieFromMensal(linhas: any[]): any[] {
  return [...linhas]
    .sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum)
    .map((r) => ({
      MesNum: r.MesNum,
      Mes: r.Mes,
      Ano: r.Ano,
      'Ano Mes': r['Ano Mes'],
      'Tipo El Nino': r['Tipo El Nino'],
      ElNino: r.ElNino,
      ONI: r.ONI,
      Temperatura: r.Temperatura,
      Precipitacao: r.Precipitacao,
      Umidade: r.Umidade,
      CasosDengue: r.casos_notificados ?? r.CasosDengue ?? 0,
    }));
}

export function geocodesFaltantesNoCache(
  dados: any,
  geocodesEscopo: number[],
): number[] {
  const noMensal = new Set(
    (dados.df_mensal_mun ?? []).map((r: any) => Number(r.geocode)),
  );
  return geocodesEscopo.filter((gc) => !noMensal.has(gc));
}

export async function patchMunicipioNoCache(
  dados: any,
  geocode: number,
  nome: string,
  contratoId: number,
): Promise<{ dados: any; linhas: number; skipped: boolean }> {
  const gc = Number(geocode);
  const jaMun = (dados.municipios ?? []).some(
    (m: any) => Number(m.geocode) === gc,
  );
  const jaSerie = (dados.df_mensal_mun ?? []).some(
    (r: any) => Number(r.geocode) === gc,
  );
  if (jaMun && jaSerie) {
    return { dados, linhas: 0, skipped: true };
  }

  const casos = await buscarCasosMensaisInfodengue(gc, nome);
  if (!casos.length) {
    throw new Error(
      `Infodengue não retornou casos para ${nome} (${gc})`,
    );
  }

  const coords = buscarCoordenadasGeocode(gc);
  const climaMensal = await resolverClimaMensalMunicipio(
    gc,
    nome,
    contratoId,
    coords,
  );
  const linhas = montarLinhasMensaisInfodengue(
    gc,
    nome,
    dados,
    casos,
    climaMensal,
  );

  if (!jaMun) {
    const popRef = dados.municipios?.[0]?.populacao ?? 0;
    dados.municipios = [
      ...(dados.municipios ?? []),
      {
        geocode: gc,
        municipio: nome,
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        populacao: popRef > 0 ? popRef : 30000,
        idContrato: contratoId,
      },
    ];
  }

  if (!jaSerie) {
    dados.df_mensal_mun = [...(dados.df_mensal_mun ?? []), ...linhas];
  }

  dados.df_mensal_mun.sort(
    (a: any, b: any) =>
      a.Ano - b.Ano || a.MesNum - b.MesNum || a.geocode - b.geocode,
  );

  return { dados, linhas: linhas.length, skipped: false };
}

export function caminhoCacheContrato(contratoId: number): string {
  return path.join(DATA_DIR, `pipeline_v2_cache_${contratoId}.json`);
}

export function lerCacheContrato(contratoId: number): {
  raw: any;
  dados: any;
} | null {
  const file = caminhoCacheContrato(contratoId);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { raw, dados: raw.dados ?? raw };
}

export function gravarCacheContrato(contratoId: number, raw: any, dados: any) {
  if (raw.dados) {
    raw.dados = dados;
  } else {
    Object.assign(raw, dados);
  }
  fs.writeFileSync(caminhoCacheContrato(contratoId), JSON.stringify(raw));
}

export interface PatchContratoResultado {
  contratoId: number;
  nome: string;
  patched: Array<{ geocode: number; nome: string; linhas: number }>;
  skipped: Array<{ geocode: number; nome: string }>;
  erros: Array<{ geocode: number; nome: string; erro: string }>;
}

export async function patchContratoFaltantes(
  contratoId: number,
): Promise<PatchContratoResultado> {
  const consorcio = obterConsorcio(contratoId);
  if (!consorcio) {
    throw new Error(`Consórcio ${contratoId} não encontrado na lista`);
  }

  const pack = lerCacheContrato(contratoId);
  if (!pack) {
    throw new Error(`Cache pipeline_v2_cache_${contratoId}.json não encontrado`);
  }

  const municipios = consorcio.municipios ?? [];
  const geocodes = municipios.map((m) => Number(m.geocode));
  const faltantes = geocodesFaltantesNoCache(pack.dados, geocodes);

  const resultado: PatchContratoResultado = {
    contratoId,
    nome: consorcio.nome,
    patched: [],
    skipped: [],
    erros: [],
  };

  for (const m of municipios) {
    const gc = Number(m.geocode);
    if (!faltantes.includes(gc)) {
      resultado.skipped.push({ geocode: gc, nome: m.nome });
      continue;
    }
    try {
      const r = await patchMunicipioNoCache(
        pack.dados,
        gc,
        m.nome,
        contratoId,
      );
      if (r.skipped) {
        resultado.skipped.push({ geocode: gc, nome: m.nome });
      } else {
        resultado.patched.push({ geocode: gc, nome: m.nome, linhas: r.linhas });
      }
    } catch (e) {
      resultado.erros.push({
        geocode: gc,
        nome: m.nome,
        erro: (e as Error).message,
      });
    }
  }

  if (resultado.patched.length) {
    gravarCacheContrato(contratoId, pack.raw, pack.dados);
  }

  return resultado;
}

export async function listarContratosParciais(): Promise<number[]> {
  const ids: number[] = [];
  for (const c of listarConsorcios()) {
    const pack = lerCacheContrato(c.id);
    if (!pack) continue;
    const geocodes = (c.municipios ?? []).map((m) => Number(m.geocode));
    if (geocodesFaltantesNoCache(pack.dados, geocodes).length) {
      ids.push(c.id);
    }
  }
  return ids;
}
