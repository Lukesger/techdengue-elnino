import { union as turfUnion } from '@turf/union';
import { ProjecaoMunicipio } from '@/services/el-nino-api';
import {
  BairroMapaFeature,
  montarProjecoesBairro,
} from './projecao-bairros';

type PolygonSimples = GeoJSON.Polygon;
type PolygonalGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
type ClipGeom = GeoJSON.Polygon['coordinates'] | GeoJSON.MultiPolygon['coordinates'];

type FeatureArea = {
  properties: {
    nome: string;
    pois: number;
    hectaresUnicos?: number;
    metodoAtribuicao?: string;
    fonteGeom?: string;
    criterioAtribuicao?: string;
  };
  geometry: GeoJSON.Geometry;
};

type Parte = {
  poly: PolygonSimples;
  nome: string;
  pois: number;
  hectaresUnicos: number;
  metodoAtribuicao?: string;
  fonteGeom?: string;
  criterioAtribuicao?: string;
};

type PolygonClippingApi = {
  union: (
    a: GeoJSON.Polygon['coordinates'] | GeoJSON.MultiPolygon['coordinates'],
    b: GeoJSON.Polygon['coordinates'] | GeoJSON.MultiPolygon['coordinates'],
  ) => GeoJSON.MultiPolygon['coordinates'] | null;
  intersection: (
    a: GeoJSON.Polygon['coordinates'] | GeoJSON.MultiPolygon['coordinates'],
    b: GeoJSON.Polygon['coordinates'] | GeoJSON.MultiPolygon['coordinates'],
  ) => GeoJSON.MultiPolygon['coordinates'] | null;
};

function carregarPolygonClipping(): PolygonClippingApi | null {
  try {
    const mod = require('polygon-clipping') as PolygonClippingApi | { default: PolygonClippingApi };
    return ('default' in mod && mod.default ? mod.default : mod) as PolygonClippingApi;
  } catch {
    return null;
  }
}

const polygonClippingCache: { current: PolygonClippingApi | null | undefined } = {
  current: undefined,
};

function getPolygonClipping(): PolygonClippingApi | null {
  if (polygonClippingCache.current === undefined) {
    polygonClippingCache.current = carregarPolygonClipping();
  }
  return polygonClippingCache.current;
}

/** Limite de polígonos para dissolve espacial O(n²) — acima disso usa caminho rápido. */
const MAX_PARTES_DISSOLVE = 45;
/** Áreas mapeadas brutas (export PostGIS) — limite maior. */
const MAX_PARTES_DISSOLVE_AREAS = 150;
const MAX_LOTE_DISSOLVE = 30;

function geoFeature(
  geometry: PolygonalGeometry,
  properties: Record<string, unknown> = {},
): GeoJSON.Feature<PolygonalGeometry> {
  return { type: 'Feature', properties, geometry };
}

function geoFeatureCollection(
  geometries: PolygonalGeometry[],
): GeoJSON.FeatureCollection<PolygonalGeometry> {
  return {
    type: 'FeatureCollection',
    features: geometries.map((g) => geoFeature(g)),
  };
}

/** Chave normalizada para agrupar/detectar bairros. */
export function chaveBairro(nome: string): string {
  return (nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export type AreaIdentificavel = {
  nome: string;
  pois: number;
  hectaresUnicos?: number;
  metodoAtribuicao?: string;
  fonteGeom?: string;
  criterioAtribuicao?: string;
  geometry: GeoJSON.Geometry;
};

/** Identifica a área original sob o cursor (polígono menor = mais específico). */
export function identificarAreaNoPonto(
  areas: AreaIdentificavel[],
  lng: number,
  lat: number,
): AreaIdentificavel | null {
  const p: GeoJSON.Position = [lng, lat];
  let best: (AreaIdentificavel & { _area: number }) | null = null;

  for (const a of areas) {
    for (const poly of flattenParaPoligonos(a.geometry)) {
      if (!pontoEmPoligono(p, poly)) continue;
      const ar = poligonoArea(poly);
      if (!best || ar < best._area) {
        best = { ...a, _area: ar };
      }
    }
  }

  if (!best) return null;
  const { _area: _, ...rest } = best;
  return rest;
}

function mesmosBairrosParaDissolve(nomeA: string, nomeB: string): boolean {
  if (chaveBairro(nomeA) === chaveBairro(nomeB)) return true;
  return isNomeAreaGenerica(nomeA) && isNomeAreaGenerica(nomeB);
}

function agruparParaDissolve(features: FeatureArea[]): FeatureArea[][] {
  const porBairro = new Map<string, FeatureArea[]>();
  const genericas: FeatureArea[] = [];

  for (const f of features) {
    if (isNomeAreaGenerica(f.properties.nome)) {
      genericas.push(f);
      continue;
    }
    const k = chaveBairro(f.properties.nome);
    const g = porBairro.get(k) ?? [];
    g.push(f);
    porBairro.set(k, g);
  }

  const batches = [...porBairro.values()];
  if (genericas.length) batches.push(genericas);
  return batches;
}

/** Nomes genéricos de área mapeada (sem bairro real atribuído). */
function isNomeAreaGenerica(nome: string): boolean {
  const n = (nome || '').trim().toUpperCase();
  return (
    /^ÁREA MAPEADA\s*\d*$/.test(n) ||
    /^AREA MAPEADA\s*\d*$/.test(n) ||
    n === 'SEM BAIRRO' ||
    n === '[1:POLYGON]' ||
    /^\[?\d+:POLYGON\]?$/.test(n)
  );
}

/**
 * Extrai o nome de bairro a partir do `name` de area_mapeadas (atividade/camada).
 * Ex.: "CONTAGEM_PETROLÂNDIA_(JUL.26) APROVADO" → "Petrolândia"
 *      "PETROLÂNDIA (2ª CAMPANHA)" → "Petrolândia"
 *      "CONTAGEM - INDUSTRIAL VILA DA PAZ (APROVADO)" → "Industrial Vila Da Paz"
 */
export function extrairNomeBairroDeAreaMapeada(nomeBruto: string): string {
  let s = String(nomeBruto || '').trim();
  if (!s) return 'Área mapeada';

  s = s
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\bMEDIDA\s+AREA\s+SOBREVOO\b/gi, ' ')
    .replace(/\bAREA\s+SOBREVOO\b/gi, ' ')
    .replace(/\bACAO\s*\d*\b/gi, ' ')
    .replace(
      /\b(APROVAD[OA]|P\.?\s*A\.?|AJUSTADO|AJUSTADA)\b/gi,
      ' ',
    )
    .replace(
      /\(\s*\d{1,2}[ªa]?\s*CAMPANHA\s*\)/gi,
      ' ',
    )
    .replace(/\(\s*[\d.,]+\s*ha\s*\)/gi, ' ')
    .replace(
      /\(\s*(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\.?\s*\d{2,4}\s*\)/gi,
      ' ',
    )
    .replace(/[_/]+/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' - ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove prefixo do município quando houver trecho após ("Contagem - X" / "Contagem X")
  const partesTraco = s.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (partesTraco.length >= 2) {
    s = partesTraco.slice(1).join(' - ');
  } else {
    const tokens = s.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2 && /^(CONTAGEM|BETIM|IBIRITE|IBIRITÉ)$/i.test(tokens[0]!)) {
      s = tokens.slice(1).join(' ');
    }
  }

  s = s.replace(/\s+/g, ' ').trim();
  if (!s || isNomeAreaGenerica(s)) return 'Área mapeada';

  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      if (!w) return w;
      // Mantém abreviações curtas em maiúsculas (ex.: "a2")
      if (/^[a-z]\d+$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/** Cobertura espacial da parte (ha da propriedade ou área geométrica). */
function coberturaParte(p: Parte): number {
  if (Number.isFinite(p.hectaresUnicos) && p.hectaresUnicos > 0) {
    return p.hectaresUnicos;
  }
  return poligonoArea(p.poly);
}

function bboxPoligono(poly: PolygonSimples): GeoJSON.BBox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const ring of poly.coordinates) {
    for (const p of ring) {
      const lng = p[0]!;
      const lat = p[1]!;
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }

  if (!Number.isFinite(minLng)) return [0, 0, 0, 0];
  return [minLng, minLat, maxLng, maxLat];
}

function bboxOverlap(a: GeoJSON.BBox, b: GeoJSON.BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function bboxArea(b: GeoJSON.BBox): number {
  return Math.max(0, (b[2] - b[0]) * (b[3] - b[1]));
}

function bboxIntersectionArea(a: GeoJSON.BBox, b: GeoJSON.BBox): number {
  const minX = Math.max(a[0], b[0]);
  const minY = Math.max(a[1], b[1]);
  const maxX = Math.min(a[2], b[2]);
  const maxY = Math.min(a[3], b[3]);
  if (maxX <= minX || maxY <= minY) return 0;
  return (maxX - minX) * (maxY - minY);
}

function flattenParaPoligonos(geometry: GeoJSON.Geometry): PolygonSimples[] {
  if (geometry.type === 'Polygon') return [geometry];
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((coords) => ({
      type: 'Polygon',
      coordinates: coords,
    }));
  }
  return [];
}

function ringArea(ring: GeoJSON.Position[]): number {
  let sum = 0;
  const n = ring.length;
  if (n < 3) return 0;
  for (let i = 0; i < n - 1; i++) {
    sum += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return Math.abs(sum) / 2;
}

function poligonoArea(geom: PolygonSimples): number {
  let total = ringArea(geom.coordinates[0] ?? []);
  for (let h = 1; h < geom.coordinates.length; h++) {
    total -= ringArea(geom.coordinates[h] ?? []);
  }
  return Math.max(0, total);
}

function clipTemArea(geom: ClipGeom | null | undefined): boolean {
  if (!geom || !Array.isArray(geom) || geom.length === 0) return false;
  const polys =
    typeof geom[0]?.[0]?.[0] === 'number'
      ? [geom as GeoJSON.Polygon['coordinates']]
      : (geom as GeoJSON.MultiPolygon['coordinates']);
  return polys.some((coords) => poligonoArea({ type: 'Polygon', coordinates: coords }) > 0);
}

function clipParaGeometry(result: ClipGeom | null | undefined): PolygonalGeometry | null {
  if (!result || !clipTemArea(result)) return null;
  if (typeof result[0]?.[0]?.[0] === 'number') {
    return { type: 'Polygon', coordinates: result as GeoJSON.Polygon['coordinates'] };
  }
  return { type: 'MultiPolygon', coordinates: result as GeoJSON.MultiPolygon['coordinates'] };
}

function unionTurf(polys: PolygonSimples[]): PolygonalGeometry | null {
  if (!polys.length) return null;
  if (polys.length === 1) return polys[0]!;

  try {
    const fc = geoFeatureCollection(polys);
    const unido = turfUnion(fc);
    return unido?.geometry ?? null;
  } catch {
    let acc: PolygonalGeometry | null = polys[0] ?? null;
    for (let i = 1; i < polys.length; i++) {
      try {
        const u = turfUnion(
          geoFeatureCollection(
            [acc, polys[i]!].filter(Boolean) as PolygonalGeometry[],
          ),
        );
        if (u?.geometry) acc = u.geometry as PolygonalGeometry;
      } catch {
        /* mantém acc */
      }
    }
    return acc;
  }
}

function unionClip(polys: PolygonSimples[]): PolygonalGeometry | null {
  if (!polys.length) return null;
  if (polys.length === 1) return polys[0]!;

  const clip = getPolygonClipping();
  if (clip) {
    try {
      let acc: ClipGeom = polys[0]!.coordinates;
      for (let i = 1; i < polys.length; i++) {
        const next = clip.union(acc, polys[i]!.coordinates);
        if (next && clipTemArea(next)) acc = next;
      }
      const geom = clipParaGeometry(acc);
      if (geom) return geom;
    } catch {
      /* fallback turf */
    }
  }

  return unionTurf(polys);
}

function pontoEmAnel(p: GeoJSON.Position, ring: GeoJSON.Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const intersect =
      yi > p[1]! !== yj > p[1]! &&
      p[0]! < ((xj - xi) * (p[1]! - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pontoEmPoligono(p: GeoJSON.Position, poly: PolygonSimples): boolean {
  const outer = poly.coordinates[0];
  if (!outer || !pontoEmAnel(p, outer)) return false;
  for (let h = 1; h < poly.coordinates.length; h++) {
    if (pontoEmAnel(p, poly.coordinates[h]!)) return false;
  }
  return true;
}

/** Testa se um ponto (lng, lat) está dentro de uma geometria polygonal. */
export function pontoEmGeometry(
  lng: number,
  lat: number,
  geometry: GeoJSON.Geometry,
): boolean {
  const p: GeoJSON.Position = [lng, lat];
  for (const poly of flattenParaPoligonos(geometry)) {
    if (pontoEmPoligono(p, poly)) return true;
  }
  return false;
}

function centroide(poly: PolygonSimples): GeoJSON.Position {
  const ring = poly.coordinates[0] ?? [];
  if (ring.length < 3) return ring[0] ?? [0, 0];
  let x = 0;
  let y = 0;
  let n = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    x += ring[i]![0]!;
    y += ring[i]![1]!;
    n += 1;
  }
  return n > 0 ? [x / n, y / n] : [0, 0];
}

/** Área em hectares a partir da geometria (WGS84), sem contar sobreposição. */
export function hectaresDeGeometria(geometry: GeoJSON.Geometry): number {
  const polys = flattenParaPoligonos(geometry);
  let m2 = 0;
  for (const p of polys) {
    const areaDeg = poligonoArea(p);
    const lat = centroide(p)[1]!;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
    m2 += areaDeg * mPerDegLat * mPerDegLng;
  }
  return m2 / 10000;
}

function poligonosSobrepoemGeom(a: PolygonSimples, b: PolygonSimples): boolean {
  const ba = bboxPoligono(a);
  const bb = bboxPoligono(b);
  if (!bboxOverlap(ba, bb)) return false;

  const clip = getPolygonClipping();
  if (clip) {
    try {
      const inter = clip.intersection(a.coordinates, b.coordinates);
      if (clipTemArea(inter)) return true;
    } catch {
      /* segue */
    }
  }

  const ca = centroide(a);
  const cb = centroide(b);
  if (pontoEmPoligono(ca, b) || pontoEmPoligono(cb, a)) return true;

  try {
    const unido = turfUnion(geoFeatureCollection([a, b]));
    if (unido?.geometry?.type === 'Polygon') {
      const areaU = poligonoArea(unido.geometry);
      const areaS = poligonoArea(a) + poligonoArea(b);
      if (areaS > 0 && areaU < areaS * 0.999) return true;
    }
  } catch {
    /* segue */
  }

  return false;
}

function poligonosSobrepoem(
  a: PolygonSimples,
  b: PolygonSimples,
  nomeA: string,
  nomeB: string,
): boolean {
  if (!mesmosBairrosParaDissolve(nomeA, nomeB)) return false;
  return poligonosSobrepoemGeom(a, b);
}

class UnionFind {
  private parent: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  unite(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function dissolveGuloso(partes: PolygonSimples[]): PolygonSimples[] {
  let list = [...partes];
  if (list.length <= 1) return list;

  let changed = true;
  let iter = 0;
  const MAX_ITER = Math.min(list.length * 4, 800);

  while (changed && list.length > 1 && iter < MAX_ITER) {
    changed = false;
    iter += 1;
    let merged = false;
    for (let i = 0; i < list.length && !merged; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!poligonosSobrepoemGeom(list[i]!, list[j]!)) continue;

        const unido = unionClip([list[i]!, list[j]!]);
        if (!unido) continue;

        const flat = flattenParaPoligonos(unido);
        if (!flat.length) continue;

        list = [
          ...list.slice(0, i),
          ...flat,
          ...list.slice(i + 1, j),
          ...list.slice(j + 1),
        ];
        changed = true;
        merged = true;
        break;
      }
    }
  }

  return list;
}

function unionCluster(partes: PolygonSimples[]): GeoJSON.Geometry | null {
  if (!partes.length) return null;
  if (partes.length === 1) return partes[0]!;

  const clipResult = unionClip(partes);
  if (clipResult) return clipResult;

  const dissolvidos = dissolveGuloso(partes);
  if (dissolvidos.length === 1) return dissolvidos[0]!;

  const retry = unionClip(dissolvidos);
  if (retry) return retry;

  if (dissolvidos.length === 1) return dissolvidos[0]!;
  return {
    type: 'MultiPolygon',
    coordinates: dissolvidos.map((p) => p.coordinates),
  };
}

function contarPartes(features: FeatureArea[]): number {
  let n = 0;
  for (const f of features) {
    for (const poly of flattenParaPoligonos(f.geometry)) {
      if (poligonoArea(poly) > 0) n += 1;
    }
  }
  return n;
}

function juntarGeometriasSimples(geoms: GeoJSON.Geometry[]): GeoJSON.Geometry | null {
  const polys = geoms
    .flatMap(flattenParaPoligonos)
    .filter((p) => poligonoArea(p) > 0);
  if (!polys.length) return null;
  if (polys.length === 1) return polys[0]!;
  return {
    type: 'MultiPolygon',
    coordinates: polys.map((p) => p.coordinates),
  };
}

export function dissolverSobreposicoes(features: FeatureArea[]): FeatureArea[] {
  const partes: Parte[] = [];
  for (const f of features) {
    for (const poly of flattenParaPoligonos(f.geometry)) {
      if (poligonoArea(poly) <= 0) continue;
      partes.push({
        poly,
        nome: f.properties.nome,
        pois: Number(f.properties.pois) || 0,
        hectaresUnicos: Number(f.properties.hectaresUnicos) || 0,
        metodoAtribuicao: f.properties.metodoAtribuicao,
        fonteGeom: f.properties.fonteGeom,
        criterioAtribuicao: f.properties.criterioAtribuicao,
      });
    }
  }

  if (partes.length <= 1) return features;
  if (partes.length > MAX_PARTES_DISSOLVE) return features;

  const uf = new UnionFind(partes.length);
  for (let i = 0; i < partes.length; i++) {
    for (let j = i + 1; j < partes.length; j++) {
      if (poligonosSobrepoem(partes[i]!.poly, partes[j]!.poly, partes[i]!.nome, partes[j]!.nome)) {
        uf.unite(i, j);
      }
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < partes.length; i++) {
    const root = uf.find(i);
    const list = clusters.get(root) ?? [];
    list.push(i);
    clusters.set(root, list);
  }

  const out: FeatureArea[] = [];
  for (const indices of clusters.values()) {
    const polys = indices.map((i) => partes[i]!.poly);
    const geometry = unionCluster(polys);
    if (!geometry) continue;

    let pois = 0;
    let hectaresUnicos = 0;
    let nomeDominante = partes[indices[0]!]!.nome;
    let maxPois = -1;
    let metodoAtribuicao = partes[indices[0]!]?.metodoAtribuicao;
    let fonteGeom = partes[indices[0]!]?.fonteGeom;
    let criterioAtribuicao = partes[indices[0]!]?.criterioAtribuicao;

    for (const idx of indices) {
      const p = partes[idx]!;
      pois += p.pois;
      hectaresUnicos += p.hectaresUnicos;
      if (!isNomeAreaGenerica(p.nome) && p.pois >= maxPois) {
        maxPois = p.pois;
        nomeDominante = p.nome;
        metodoAtribuicao = p.metodoAtribuicao;
        fonteGeom = p.fonteGeom;
        criterioAtribuicao = p.criterioAtribuicao;
      }
    }

    if (maxPois < 0 && isNomeAreaGenerica(nomeDominante)) {
      nomeDominante = indices.length > 1 ? 'Áreas mapeadas' : nomeDominante;
    }

    out.push({
      properties: {
        nome: nomeDominante,
        pois,
        hectaresUnicos,
        metodoAtribuicao,
        fonteGeom,
        criterioAtribuicao,
      },
      geometry,
    });
  }

  return out.length ? out : features;
}

/**
 * Unifica polígonos que se sobrepõem (qualquer nome), preservando os demais.
 * Usado após export direto de area_mapeadas.
 */
export function dissolverSobreposicoesEspaciais(
  features: FeatureArea[],
): FeatureArea[] {
  const partes: Parte[] = [];
  for (const f of features) {
    for (const poly of flattenParaPoligonos(f.geometry)) {
      if (poligonoArea(poly) <= 0) continue;
      partes.push({
        poly,
        nome: f.properties.nome,
        pois: Number(f.properties.pois) || 0,
        hectaresUnicos: Number(f.properties.hectaresUnicos) || 0,
        metodoAtribuicao: f.properties.metodoAtribuicao,
        fonteGeom: f.properties.fonteGeom,
        criterioAtribuicao: f.properties.criterioAtribuicao,
      });
    }
  }

  if (partes.length <= 1) return features;
  if (partes.length > MAX_PARTES_DISSOLVE_AREAS) return features;

  const uf = new UnionFind(partes.length);
  for (let i = 0; i < partes.length; i++) {
    for (let j = i + 1; j < partes.length; j++) {
      if (poligonosSobrepoemGeom(partes[i]!.poly, partes[j]!.poly)) {
        uf.unite(i, j);
      }
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < partes.length; i++) {
    const root = uf.find(i);
    const list = clusters.get(root) ?? [];
    list.push(i);
    clusters.set(root, list);
  }

  const out: FeatureArea[] = [];
  for (const indices of clusters.values()) {
    const polys = indices.map((i) => partes[i]!.poly);
    const geometry = unionCluster(polys);
    if (!geometry) continue;

    let pois = 0;
    let nomeDominante = partes[indices[0]!]!.nome;
    let maxCobertura = -1;
    let metodoAtribuicao = 'area_mapeada_sem_overlap';
    let fonteGeom = partes[indices[0]!]?.fonteGeom ?? 'area_mapeadas';
    let criterioAtribuicao =
      partes[indices[0]!]?.criterioAtribuicao ?? 'uniao_sobreposicao';

    // Bairro com maior cobertura no cluster unificado (ha / área geométrica).
    const coberturaPorBairro = new Map<string, { nome: string; cobertura: number }>();

    for (const idx of indices) {
      const p = partes[idx]!;
      pois += p.pois;
      const cob = coberturaParte(p);
      if (cob >= maxCobertura) {
        maxCobertura = cob;
        nomeDominante = p.nome;
      }
      const bairro = extrairNomeBairroDeAreaMapeada(p.nome);
      const chave = chaveBairro(bairro);
      const prev = coberturaPorBairro.get(chave);
      coberturaPorBairro.set(chave, {
        nome: bairro,
        cobertura: (prev?.cobertura ?? 0) + cob,
      });
    }

    let melhorBairro = extrairNomeBairroDeAreaMapeada(nomeDominante);
    let melhorCob = -1;
    for (const item of coberturaPorBairro.values()) {
      if (item.cobertura > melhorCob) {
        melhorCob = item.cobertura;
        melhorBairro = item.nome;
      }
    }

    const hectaresUnicos = hectaresDeGeometria(geometry);
    const nomeExibicao =
      melhorBairro && melhorBairro !== 'Área mapeada'
        ? melhorBairro
        : indices.length > 1
          ? `Áreas unificadas (${indices.length})`
          : extrairNomeBairroDeAreaMapeada(nomeDominante);

    out.push({
      properties: {
        nome: nomeExibicao,
        pois,
        hectaresUnicos,
        metodoAtribuicao,
        fonteGeom,
        criterioAtribuicao:
          indices.length > 1
            ? `uniao_sobreposicao>bairro_maior_cobertura:${melhorBairro}`
            : criterioAtribuicao,
      },
      geometry,
    });
  }

  return out.length ? out : features;
}

export function unirGeometriasBairro(
  geometrias: GeoJSON.Geometry[],
): GeoJSON.Geometry | null {
  const partes = geometrias.flatMap(flattenParaPoligonos).filter((p) => poligonoArea(p) > 0);
  if (!partes.length) return null;
  if (partes.length === 1) return partes[0]!;
  return unionCluster(partes);
}

/** Monta bairros com dissolve por bairro; se falhar, retorna features sem dissolver. */
export function montarBairrosComGeometria(
  features: FeatureArea[],
  mun: ProjecaoMunicipio,
  opts?: { modo?: 'areas_mapeadas' | 'envoltoria_pois'; rapido?: boolean },
): BairroMapaFeature[] {
  const rapido = opts?.rapido === true;

  let base: FeatureArea[] = [];
  if (rapido) {
    base = features;
  } else {
    try {
      for (const batch of agruparParaDissolve(features)) {
        const np = contarPartes(batch);
        if (batch.length >= 2 && np <= MAX_LOTE_DISSOLVE) {
          base.push(...dissolverSobreposicoes(batch));
        } else {
          base.push(...batch);
        }
      }
    } catch {
      base = features;
    }
  }

  if (!base.length) base = features;

  const grupos = new Map<
    string,
    {
      nomeExib: string;
      pois: number;
      hectaresUnicos: number;
      maxPois: number;
      geoms: GeoJSON.Geometry[];
      metodoAtribuicao?: string;
      fonteGeom?: string;
      criterioAtribuicao?: string;
    }
  >();
  for (const f of base) {
    if (!f.geometry) continue;
    const nome = f.properties.nome;
    const chave = isNomeAreaGenerica(nome)
      ? `__gen__${nome.trim().toUpperCase()}`
      : chaveBairro(nome);
    const fp = Number(f.properties.pois) || 0;
    const g = grupos.get(chave) ?? {
      nomeExib: nome,
      pois: 0,
      hectaresUnicos: 0,
      maxPois: -1,
      geoms: [],
    };
    g.pois += fp;
    g.hectaresUnicos += Number(f.properties.hectaresUnicos) || 0;
    g.geoms.push(f.geometry);
    if (fp >= g.maxPois) {
      g.maxPois = fp;
      g.nomeExib = nome;
      g.metodoAtribuicao = f.properties.metodoAtribuicao;
      g.fonteGeom = f.properties.fonteGeom;
      g.criterioAtribuicao = f.properties.criterioAtribuicao;
    }
    grupos.set(chave, g);
  }

  const pesos = Array.from(grupos.values()).map((g) => ({
    nome: g.nomeExib,
    peso: g.pois > 0 ? g.pois : 1,
  }));
  const proj = montarProjecoesBairro(mun, pesos);
  const projPorNome = new Map(proj.map((p) => [p.nome, p.projecoes]));

  const out: BairroMapaFeature[] = [];
  for (const [, g] of grupos.entries()) {
    let geometry: GeoJSON.Geometry | null = null;
    try {
      geometry = rapido
        ? juntarGeometriasSimples(g.geoms)
        : unirGeometriasBairro(g.geoms);
    } catch {
      geometry = g.geoms[0] ?? null;
    }
    if (!geometry) continue;
    out.push({
      nome: g.nomeExib,
      pois: g.pois,
      hectaresUnicos: g.hectaresUnicos,
      metodoAtribuicao: g.metodoAtribuicao,
      fonteGeom: g.fonteGeom,
      criterioAtribuicao: g.criterioAtribuicao,
      geometry,
      projecoes: projPorNome.get(g.nomeExib) ?? [],
    });
  }

  return out;
}
