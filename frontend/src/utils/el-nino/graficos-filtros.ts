import { ComparativoMensal, OniMensal, SerieMensal } from '@/services/el-nino-api';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function indiceMesAno(ano: number, mes: number): number {
  return ano * 12 + mes;
}

export function rotuloMesAno(ano: number, mes: number): string {
  return `${MESES[mes - 1]}/${ano}`;
}

export function rotuloIntervaloMesAno(
  anoIni: number,
  mesIni: number,
  anoFim: number,
  mesFim: number,
): string {
  if (anoIni === anoFim && mesIni === mesFim) return rotuloMesAno(anoIni, mesIni);
  return `${rotuloMesAno(anoIni, mesIni)}–${rotuloMesAno(anoFim, mesFim)}`;
}

export function rotuloJanelaAnos(anoInicio: number, anoFim: number): string {
  const n = anoFim - anoInicio + 1;
  return `${n} anos`;
}

/** Lê ano/mês de linhas com PascalCase ou camelCase (cache local / API). */
export function lerAnoMesLinha(
  r: Record<string, unknown>,
): { ano: number; mesNum: number } | null {
  const ano = Number(r.Ano ?? r.ano);
  if (!Number.isFinite(ano)) return null;

  const mesRaw = r.MesNum ?? r.mes_num ?? r.mes;
  let mesNum = Number(mesRaw);
  if (!Number.isFinite(mesNum) || mesNum < 1 || mesNum > 12) {
    const mesStr = String(r.Mes ?? r.mes_label ?? '').trim();
    const idx = MESES.findIndex(
      (m) => m.toLowerCase() === mesStr.toLowerCase().slice(0, 3),
    );
    if (idx < 0) return null;
    mesNum = idx + 1;
  }

  return { ano, mesNum };
}

export function filtrarMensalPorAnos(
  rows: Array<Record<string, unknown>> | null | undefined,
  anoInicio: number,
  anoFim: number,
): Array<Record<string, unknown>> {
  if (!rows?.length) return [];
  return rows.filter((r) => {
    const par = lerAnoMesLinha(r);
    return par != null && par.ano >= anoInicio && par.ano <= anoFim;
  });
}

export function filtrarOniPorAnos(
  oniMensal: OniMensal[] | null | undefined,
  anoInicio: number,
  anoFim: number,
): OniMensal[] {
  if (!oniMensal?.length) return [];
  return oniMensal.filter((o) => o.ano >= anoInicio && o.ano <= anoFim);
}

export function resolverMesFimSerie(
  serie: SerieMensal[] | Array<Record<string, unknown>>,
  anoFim: number,
  fallback = 12,
): number {
  let max = 0;
  for (const row of serie) {
    const par = lerAnoMesLinha(row as Record<string, unknown>);
    if (!par || par.ano !== anoFim) continue;
    max = Math.max(max, par.mesNum);
  }
  return max > 0 ? max : fallback;
}

export function filtrarSerieMesAno(
  serie: SerieMensal[],
  anoIni: number,
  mesIni: number,
  anoFim: number,
  mesFim: number,
): SerieMensal[] {
  let ini = indiceMesAno(anoIni, mesIni);
  let fim = indiceMesAno(anoFim, mesFim);
  if (ini > fim) [ini, fim] = [fim, ini];
  return (serie || [])
    .filter((r) => {
      const par = lerAnoMesLinha(r as unknown as Record<string, unknown>);
      if (!par) return false;
      const i = indiceMesAno(par.ano, par.mesNum);
      return i >= ini && i <= fim;
    })
    .map((r) => {
      const par = lerAnoMesLinha(r as unknown as Record<string, unknown>);
      if (!par) return r;
      return {
        ...r,
        Ano: par.ano,
        MesNum: par.mesNum,
        Mes: r.Mes || MESES[par.mesNum - 1],
      };
    })
    .sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum);
}

function mediaClimaPositiva(vals: number[]): number {
  const fatia = vals.filter((v) => v != null && Number.isFinite(v) && v > 0);
  if (!fatia.length) return 0;
  return fatia.reduce((a, b) => a + b, 0) / fatia.length;
}

/** Lê temperatura ERA5/Open-Meteo de linhas com PascalCase ou camelCase. */
export function lerTemperatura(r: Record<string, unknown>): number {
  const raw =
    r.Temperatura ??
    r.temperatura ??
    r.temp ??
    r.temp_media ??
    r.tempMedia;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Lê precipitação ERA5/Open-Meteo de linhas com PascalCase ou camelCase. */
export function lerPrecipitacao(r: Record<string, unknown>): number {
  const raw =
    r.Precipitacao ??
    r.precipitacao ??
    r.chuva_mm ??
    r.chuva;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Injeta Temperatura do pacote clima_historico nas linhas mensais (quando o pipeline veio com 0). */
export function mesclarClimaHistoricoEmMensal(
  mensal: Array<Record<string, unknown>>,
  climaHistorico: Array<Record<string, unknown>> | null | undefined,
  geocode?: number | null,
): Array<Record<string, unknown>> {
  if (!climaHistorico?.length || !mensal.length) return mensal;

  const mapa = new Map<string, number>();
  for (const r of climaHistorico) {
    const gc = Number(r.geocode);
    if (geocode != null && gc !== Number(geocode)) continue;
    const t = lerTemperatura(r);
    if (t <= 0) continue;
    mapa.set(`${gc}-${r.Ano}-${r.MesNum}`, t);
  }

  if (!mapa.size) return mensal;

  return mensal.map((linha) => {
    const gc = Number(linha.geocode);
    const t = mapa.get(`${gc}-${linha.Ano}-${linha.MesNum}`);
    if (t == null || lerTemperatura(linha) > 0) return linha;
    return { ...linha, Temperatura: t };
  });
}

/** Média sazonal Jan–Dez (equivalente a filtrarSerieTemporal(..., "media")). */
export function mediaSazonalSerie(rows: Array<Record<string, unknown>>): SerieMensal[] {
  const porAnoMes = new Map<
    string,
    { MesNum: number; Mes: string; casos: number; temps: number[]; oni: number | null }
  >();

  for (const r of rows) {
    const ano = Number(r.Ano);
    const mesNum = Number(r.MesNum);
    const k = `${ano}-${mesNum}`;
    if (!porAnoMes.has(k)) {
      porAnoMes.set(k, {
        MesNum: mesNum,
        Mes: String(r.Mes ?? MESES[mesNum - 1]),
        casos: 0,
        temps: [],
        oni: (r.ONI as number | null) ?? null,
      });
    }
    const g = porAnoMes.get(k)!;
    g.casos += casosConfirmadosDeLinha(r);
    g.temps.push(lerTemperatura(r));
    if (g.oni == null && r.ONI != null) g.oni = Number(r.ONI);
  }

  const porMes = new Map<
    number,
    { Mes: string; casos: number[]; temps: number[]; onis: number[] }
  >();

  for (const g of porAnoMes.values()) {
    if (!porMes.has(g.MesNum)) {
      porMes.set(g.MesNum, { Mes: g.Mes, casos: [], temps: [], onis: [] });
    }
    const m = porMes.get(g.MesNum)!;
    m.casos.push(g.casos);
    m.temps.push(mediaClimaPositiva(g.temps));
    if (g.oni != null) m.onis.push(g.oni);
  }

  return [...porMes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([mesNum, g]) => ({
      Ano: 0,
      MesNum: mesNum,
      Mes: g.Mes,
      AnoMes: g.Mes,
      Temperatura: Math.round(mediaClimaPositiva(g.temps) * 10) / 10,
      Precipitacao: 0,
      Umidade: 0,
      ONI: g.onis.length
        ? Math.round((g.onis.reduce((a, b) => a + b, 0) / g.onis.length) * 100) / 100
        : null,
      TipoElNino: '',
      ElNino: 0,
      CasosDengue: Math.round(g.casos.reduce((a, b) => a + b, 0) / g.casos.length),
    }));
}

export interface PerfilMensalPayload {
  modo: 'media_anual';
  dados: ComparativoMensal[];
}

/** Perfil Sem x Com El Niño por mês calendário (média anual). */
export function perfilMensalElNino(rows: Array<Record<string, unknown>>): PerfilMensalPayload {
  const map = new Map<
    string,
    { MesNum: number; Mes: string; ElNino: number; casos: number[] }
  >();

  for (const r of rows) {
    const elNino = Number(r.ElNino ?? ((r.ONI as number) >= 0.5 ? 1 : 0));
    const k = `${r.MesNum}|${elNino}`;
    if (!map.has(k)) {
      map.set(k, {
        MesNum: Number(r.MesNum),
        Mes: String(r.Mes ?? MESES[Number(r.MesNum) - 1]),
        ElNino: elNino,
        casos: [],
      });
    }
    map.get(k)!.casos.push(casosConfirmadosDeLinha(r));
  }

  const dados: ComparativoMensal[] = [...map.values()].map((g) => ({
    MesNum: g.MesNum,
    Mes: g.Mes,
    ElNino: g.ElNino,
    CasosDengue: Math.round(g.casos.reduce((a, b) => a + b, 0) / g.casos.length),
    Periodo: g.ElNino ? 'Com El Nino' : 'Sem El Nino',
    Temperatura: 0,
  }));

  return { modo: 'media_anual', dados };
}

export interface ComparativoChuvaMensal {
  MesNum: number;
  Mes: string;
  ElNino: number;
  Precipitacao: number;
  Periodo: 'Com El Nino' | 'Sem El Nino';
}

/** Média de precipitação (mm) por mês calendário, separando anos com e sem El Niño. */
export function perfilMensalPrecipitacaoElNino(
  rows: Array<Record<string, unknown>>,
): ComparativoChuvaMensal[] {
  const map = new Map<
    string,
    { MesNum: number; Mes: string; ElNino: number; precips: number[] }
  >();

  for (const r of rows) {
    const precip = lerPrecipitacao(r);
    if (precip <= 0) continue;
    const oniRaw = r.ONI;
    const oni =
      oniRaw != null && oniRaw !== '' && Number.isFinite(Number(oniRaw))
        ? Number(oniRaw)
        : null;
    const elNino = Number(r.ElNino ?? (oni != null && oni >= 0.5 ? 1 : 0));
    const mesNum = Number(r.MesNum);
    if (!Number.isFinite(mesNum) || mesNum < 1 || mesNum > 12) continue;
    const k = `${mesNum}|${elNino}`;
    if (!map.has(k)) {
      map.set(k, {
        MesNum: mesNum,
        Mes: String(r.Mes ?? MESES[mesNum - 1]),
        ElNino: elNino,
        precips: [],
      });
    }
    map.get(k)!.precips.push(precip);
  }

  return [...map.values()].map((g) => ({
    MesNum: g.MesNum,
    Mes: g.Mes,
    ElNino: g.ElNino,
    Precipitacao:
      Math.round((g.precips.reduce((a, b) => a + b, 0) / g.precips.length) * 10) /
      10,
    Periodo: g.ElNino ? 'Com El Nino' : 'Sem El Nino',
  }));
}

export function rotuloMunicipiosMedia(n: number): string {
  return `${n} municipios (media)`;
}

/** Casos confirmados (notificados) — prioriza `casos_notificados` sobre estimativas. */
export function casosConfirmadosDeLinha(
  r: Record<string, unknown>,
): number {
  const notif = r.casos_notificados;
  if (notif != null && notif !== '') {
    return Math.max(0, Number(notif) || 0);
  }
  return Math.max(0, Number(r.CasosDengue ?? 0));
}

export function filtrarMensalPorGeocode(
  rows: Array<Record<string, unknown>> | null | undefined,
  geocode?: number | null,
): Array<Record<string, unknown>> {
  if (!rows?.length) return [];
  if (geocode == null) return rows;
  const gc = Number(geocode);
  return rows.filter((r) => {
    const rowGc = Number(r.geocode ?? r.Geocode ?? r.codigo_ibge ?? r.codigoIbge);
    return Number.isFinite(rowGc) && rowGc === gc;
  });
}

/** Converte linhas municipais em série mensal para gráficos comparativos. */
export function mensalMunParaSerieMensal(
  rows: Array<Record<string, unknown>>,
): SerieMensal[] {
  return [...rows]
    .map((r) => ({
      Ano: Number(r.Ano),
      MesNum: Number(r.MesNum),
      Mes: String(r.Mes ?? MESES[Number(r.MesNum) - 1] ?? ''),
      AnoMes: String(r.AnoMes ?? `${r.Ano}-${String(r.MesNum).padStart(2, '0')}`),
      Temperatura: lerTemperatura(r),
      Precipitacao: Number(r.Precipitacao ?? 0),
      Umidade: Number(r.Umidade ?? 0),
      ONI: r.ONI != null && r.ONI !== '' ? Number(r.ONI) : null,
      TipoElNino: String(r.TipoElNino ?? ''),
      ElNino: Number(r.ElNino ?? (Number(r.ONI) >= 0.5 ? 1 : 0)),
      CasosDengue: casosConfirmadosDeLinha(r),
    }))
    .sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum);
}

export function rotuloEscopoGrafico(
  nomeMunicipio?: string | null,
  nMunicipios?: number,
): string {
  if (nomeMunicipio?.trim()) return nomeMunicipio.trim();
  if (nMunicipios != null && nMunicipios > 0) return rotuloMunicipiosMedia(nMunicipios);
  return '';
}

export function periodoFiltro(
  anoInicio: number,
  anoFim: number,
  mesFimDados: number,
): { anoIni: number; mesIni: number; anoFim: number; mesFim: number } {
  const mesFim = anoFim === new Date().getFullYear() ? mesFimDados : 12;
  return { anoIni: anoInicio, mesIni: 1, anoFim, mesFim };
}

export function mesclarOniNaSerie(
  serie: SerieMensal[],
  oniMensal: OniMensal[],
): SerieMensal[] {
  const oniMap = new Map(oniMensal.map((o) => [`${o.ano}-${o.mes}`, o.oni]));
  return serie.map((r) => ({
    ...r,
    ONI: r.ONI ?? oniMap.get(`${r.Ano}-${r.MesNum}`) ?? null,
  }));
}
