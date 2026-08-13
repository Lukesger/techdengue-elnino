import type { MapaProjecaoResponse, ProjecaoMunicipio } from '@/services/el-nino-api';
import { pontoEmGeometry } from '@/utils/el-nino/unir-bairros';

export type HoverInfoMapa = {
  nome: string;
  valor: number;
  casosRegistrados?: number;
  impacto?: number;
  fElnino?: number;
  oni?: number | null;
  hectaresUnicos?: number | null;
  somenteProjecao?: boolean;
  naoMapeado?: boolean;
  x: number;
  y: number;
};

export type InsightMun = {
  nome: string;
  geocode: number;
  delta: number;
  valor: number;
};

export type InsightSalto = {
  nome: string;
  geocode: number;
  deltaMes: number;
  valor: number;
};

export type InsightUnico = {
  nome: string;
  geocode: number;
  projetado: number;
  baseSemElnino: number;
  deltaElnino: number;
  pctElnino: number | null;
  fElnino: number;
  mapeado: boolean;
  totalPois: number | null;
  hectares: number | null;
  hectaresBruto: number | null;
  hectaresFonte: 'unificado' | 'bruto' | 'api';
};

export type InsightsMapa = {
  maiorElevacao: InsightMun | null;
  maiorSalto: InsightSalto | null;
  concentracaoTop3Pct: number | null;
  totalProjetado: number;
  nMapeados: number;
  nMunicipios: number;
  unicoMun: InsightUnico | null;
};

export type HectaresAreaMapeada = {
  totalBruto: number;
  unificadas: number;
  totalPois?: number | null;
} | null;

type PoiHa = {
  totalPois: number | null;
  hectares: number | null;
};

function aneisExteriores(geometry: GeoJSON.Geometry): number[][][] | null {
  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates[0];
    return ring?.length ? [ring as number[][]] : null;
  }
  if (geometry.type !== 'MultiPolygon') return null;
  const aneis: number[][][] = [];
  for (const poly of geometry.coordinates) {
    const ring = poly[0];
    if (ring?.length) aneis.push(ring as number[][]);
  }
  return aneis.length ? aneis : null;
}

function centroideDeAnel(
  ring: number[][],
): { area: number; cx: number; cy: number } | null {
  if (ring.length < 3) return null;
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x0 = ring[i]![0]!;
    const y0 = ring[i]![1]!;
    const x1 = ring[i + 1]![0]!;
    const y1 = ring[i + 1]![1]!;
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  const area = area2 / 2;
  const abs = Math.abs(area);
  if (abs < 1e-18) return null;
  return { area: abs, cx: cx / (6 * area), cy: cy / (6 * area) };
}

function pontoInteriorProximoAoCentro(
  geometry: GeoJSON.Geometry,
  ring: number[][],
  cx: number,
  cy: number,
): [number, number] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const pt of ring) {
    const lng = pt[0];
    const lat = pt[1];
    if (lng == null || lat == null) continue;
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLng)) return null;

  let melhorDentro: [number, number] | null = null;
  let melhorDist = Infinity;
  const passos = 9;
  for (let iy = 0; iy <= passos; iy++) {
    for (let ix = 0; ix <= passos; ix++) {
      const lng = minLng + ((maxLng - minLng) * ix) / passos;
      const lat = minLat + ((maxLat - minLat) * iy) / passos;
      if (!pontoEmGeometry(lng, lat, geometry)) continue;
      const d = (lng - cx) * (lng - cx) + (lat - cy) * (lat - cy);
      if (d < melhorDist) {
        melhorDist = d;
        melhorDentro = [lng, lat];
      }
    }
  }
  return melhorDentro;
}

/** Centro visual do polígono (anel maior + correção se cair fora). */
export function centroideGeometry(
  geometry: GeoJSON.Geometry | null | undefined,
): [number, number] | null {
  if (!geometry) return null;
  const aneis = aneisExteriores(geometry);
  if (!aneis) return null;

  let melhor: {
    ring: number[][];
    area: number;
    cx: number;
    cy: number;
  } | null = null;

  for (const ring of aneis) {
    const c = centroideDeAnel(ring);
    if (!c) continue;
    if (!melhor || c.area > melhor.area) {
      melhor = { ring, area: c.area, cx: c.cx, cy: c.cy };
    }
  }
  if (!melhor) return null;

  const ponto: [number, number] = [melhor.cx, melhor.cy];
  if (pontoEmGeometry(ponto[0], ponto[1], geometry)) return ponto;
  return (
    pontoInteriorProximoAoCentro(
      geometry,
      melhor.ring,
      melhor.cx,
      melhor.cy,
    ) ?? ponto
  );
}

function preferirHectaresUnico(
  haUnif: number,
  haBruto: number,
  haPoi: number | null,
): number | null {
  if (Number.isFinite(haUnif) && haUnif > 0) return haUnif;
  if (Number.isFinite(haBruto) && haBruto > 0) return haBruto;
  if (haPoi != null) return Number(haPoi);
  return null;
}

function fonteHectaresUnico(
  haUnif: number,
  haBruto: number,
): 'unificado' | 'bruto' | 'api' {
  if (Number.isFinite(haUnif) && haUnif > 0) return 'unificado';
  if (Number.isFinite(haBruto) && haBruto > 0) return 'bruto';
  return 'api';
}

function concentracaoTop3(
  nMunicipios: number,
  totalProjetado: number,
  valoresMes: Array<{ valor: number }>,
): number | null {
  if (!(nMunicipios >= 4 && totalProjetado > 0)) return null;
  const somaTop3 = [...valoresMes]
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 3)
    .reduce((s, m) => s + m.valor, 0);
  return Math.round((somaTop3 / totalProjetado) * 1000) / 10;
}

function montarInsightUnico(params: {
  mun: ProjecaoMunicipio;
  gc: number;
  projetado: number;
  fElnino: number;
  deltaElnino: number;
  mapeado: boolean;
  poi: PoiHa;
  hectaresAreaMapeada: HectaresAreaMapeada;
}): InsightUnico {
  const {
    mun,
    gc,
    projetado,
    fElnino,
    deltaElnino,
    mapeado,
    poi,
    hectaresAreaMapeada,
  } = params;
  const haUnif = Number(hectaresAreaMapeada?.unificadas);
  const haBruto = Number(hectaresAreaMapeada?.totalBruto);
  const hectaresPreferidos = preferirHectaresUnico(haUnif, haBruto, poi.hectares);
  const totalPoisPreferidos =
    hectaresAreaMapeada?.totalPois != null &&
    Number(hectaresAreaMapeada.totalPois) > 0
      ? Number(hectaresAreaMapeada.totalPois)
      : poi.totalPois;

  return {
    nome: mun.nome,
    geocode: gc,
    projetado,
    baseSemElnino: Math.max(0, projetado - deltaElnino),
    deltaElnino,
    pctElnino:
      projetado > 0 && deltaElnino !== 0
        ? Math.round((deltaElnino / projetado) * 1000) / 10
        : null,
    fElnino,
    mapeado: mapeado || (hectaresPreferidos != null && hectaresPreferidos > 0),
    totalPois: totalPoisPreferidos,
    hectares: hectaresPreferidos,
    hectaresBruto: Number.isFinite(haBruto) && haBruto > 0 ? haBruto : null,
    hectaresFonte: fonteHectaresUnico(haUnif, haBruto),
  };
}

function textoProp(
  props: Record<string, unknown> | null | undefined,
  keys: string[],
  fallback: string,
): string {
  for (const k of keys) {
    const v = props?.[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  }
  return fallback;
}

export function hoverInfoDeProps(
  props: Record<string, unknown> | null | undefined,
  x: number,
  y: number,
  nomeFallback = 'Município',
): HoverInfoMapa {
  const oniRaw = props?.oni;
  const oniNum = Number(oniRaw);
  return {
    nome: textoProp(props, ['nome', 'name'], nomeFallback),
    valor: Number(props?.valor_proj ?? 0),
    casosRegistrados: Number(props?.casos_registrados ?? 0),
    impacto: Number(props?.impacto_elnino ?? 0),
    fElnino: Number(props?.f_elnino ?? 0) || undefined,
    oni: oniRaw != null && Number.isFinite(oniNum) ? oniNum : null,
    naoMapeado: Number(props?.mapeado) === 0,
    x,
    y,
  };
}

export function montarInsightsMapa(params: {
  data: MapaProjecaoResponse | null | undefined;
  mesNumSelecionado: number | null;
  projecoesMap: Map<number, { valor: number; fElnino: number; oni: number | null }>;
  hectaresAreaMapeada: HectaresAreaMapeada;
  deltaImpactoElnino: (valor: number, fElnino: number) => number;
  dadosPoiHa: (mun: ProjecaoMunicipio) => PoiHa;
  municipioFoiMapeado: (mun: ProjecaoMunicipio | undefined) => boolean;
}): InsightsMapa {
  const {
    data,
    mesNumSelecionado,
    projecoesMap,
    hectaresAreaMapeada,
    deltaImpactoElnino,
    dadosPoiHa,
    municipioFoiMapeado,
  } = params;

  const vazio: InsightsMapa = {
    maiorElevacao: null,
    maiorSalto: null,
    concentracaoTop3Pct: null,
    totalProjetado: 0,
    nMapeados: 0,
    nMunicipios: 0,
    unicoMun: null,
  };

  if (!data?.municipios?.length || mesNumSelecionado == null) {
    return vazio;
  }

  const nMunicipios = data.municipios.length;
  const mesesOrdenados = [...(data.meses ?? [])].sort(
    (a, b) => a.mesNum - b.mesNum,
  );
  const idxMes = mesesOrdenados.findIndex((m) => m.mesNum === mesNumSelecionado);
  const mesAnterior = idxMes > 0 ? mesesOrdenados[idxMes - 1]!.mesNum : null;

  let maiorElevacao: InsightMun | null = null;
  let maiorSalto: InsightSalto | null = null;
  let totalProjetado = 0;
  let nMapeados = 0;
  const valoresMes: Array<{ geocode: number; nome: string; valor: number }> = [];

  for (const mun of data.municipios) {
    const gc = Number(mun.geocode);
    const hit = projecoesMap.get(gc);
    const valor = Math.max(0, Math.round(Number(hit?.valor) || 0));
    const fElnino = Number(hit?.fElnino) || 1;
    const delta = deltaImpactoElnino(valor, fElnino);
    totalProjetado += valor;
    if (municipioFoiMapeado(mun)) nMapeados += 1;
    valoresMes.push({ geocode: gc, nome: mun.nome, valor });

    if (!maiorElevacao || delta > maiorElevacao.delta) {
      maiorElevacao = { nome: mun.nome, geocode: gc, delta, valor };
    }

    if (mesAnterior == null) continue;
    const ant = mun.projecoes.find((p) => p.mesNum === mesAnterior);
    const vAnt = Math.max(0, Math.round(Number(ant?.valor) || 0));
    const deltaMes = valor - vAnt;
    if (!maiorSalto || deltaMes > maiorSalto.deltaMes) {
      maiorSalto = { nome: mun.nome, geocode: gc, deltaMes, valor };
    }
  }

  let unicoMun: InsightUnico | null = null;
  if (nMunicipios === 1) {
    const mun = data.municipios[0]!;
    const gc = Number(mun.geocode);
    const hit = projecoesMap.get(gc);
    const projetado = Math.max(0, Math.round(Number(hit?.valor) || 0));
    const fElnino = Number(hit?.fElnino) || 1;
    const deltaElnino = deltaImpactoElnino(projetado, fElnino);
    unicoMun = montarInsightUnico({
      mun,
      gc,
      projetado,
      fElnino,
      deltaElnino,
      mapeado: municipioFoiMapeado(mun),
      poi: dadosPoiHa(mun),
      hectaresAreaMapeada,
    });
  }

  const saltoValido =
    maiorSalto != null &&
    (nMunicipios === 1 ? maiorSalto.deltaMes !== 0 : maiorSalto.deltaMes > 0);

  return {
    maiorElevacao:
      maiorElevacao && maiorElevacao.delta > 0 ? maiorElevacao : null,
    maiorSalto: saltoValido ? maiorSalto : null,
    concentracaoTop3Pct: concentracaoTop3(
      nMunicipios,
      totalProjetado,
      valoresMes,
    ),
    totalProjetado,
    nMapeados,
    nMunicipios,
    unicoMun,
  };
}
