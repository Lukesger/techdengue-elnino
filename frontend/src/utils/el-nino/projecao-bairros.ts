import { ProjecaoMes, ProjecaoMunicipio } from '@/services/el-nino-api';
import { dissolverSobreposicoesEspaciais } from './unir-bairros';

export interface BairroPeso {
  nome: string;
  peso: number;
}

export interface ProjecaoBairro {
  nome: string;
  peso: number;
  projecoes: Array<{ mesNum: number; label: string; valor: number }>;
}

/** Bairro pronto para o choropleth: geometria + POIs + projeção mês a mês. */
export interface BairroMapaFeature {
  nome: string;
  pois: number;
  hectaresUnicos?: number;
  metodoAtribuicao?: string;
  fonteGeom?: string;
  criterioAtribuicao?: string;
  geometry: GeoJSON.Geometry;
  projecoes: Array<{ mesNum: number; label: string; valor: number }>;
}

interface BairroGeojsonProperties {
  area_id?: number;
  nome: string;
  pois: number;
  hectaresUnicos?: number;
  hectares_unicos?: number;
  metodoAtribuicao?: string;
  metodo_atribuicao?: string;
  fonteGeom?: string;
  fonte_geom?: string;
  criterioAtribuicao?: string;
  criterio_atribuicao?: string;
  id_sistema?: number | null;
  id_atividade?: string | null;
}

/**
 * Converte FeatureCollection de /area-mapeada/export/geojson para o formato do mapa.
 * Geometria idêntica ao PostGIS (ST_AsGeoJSON) — sem dissolve nem envoltória.
 */
export function featuresDeExportAreaMapeada(
  collection: {
    features?: Array<{
      geometry?: GeoJSON.Geometry | null;
      properties?: Record<string, unknown>;
    }>;
  },
): BairroGeojsonFeature[] {
  return (collection.features ?? [])
    .filter((f) => f.geometry)
    .map((f) => {
      const p = f.properties ?? {};
      const id = Number(p.id);
      const areaHa = Number(p.areaHa ?? p.area_ha);
      const hectares = Number.isFinite(areaHa) && areaHa > 0 ? areaHa : 0;
      const pois = Math.max(0, Number(p.pois ?? 0) || 0);
      return {
        type: 'Feature' as const,
        properties: {
          area_id: Number.isFinite(id) ? id : undefined,
          nome: String(p.name || (Number.isFinite(id) ? `Área ${id}` : 'Área mapeada')),
          pois,
          hectares_unicos: hectares,
          hectaresUnicos: hectares,
          metodo_atribuicao: 'area_mapeada_direta',
          metodoAtribuicao: 'area_mapeada_direta',
          fonte_geom: 'area_mapeadas',
          fonteGeom: 'area_mapeadas',
          criterio_atribuicao: 'sem_transformacao',
          criterioAtribuicao: 'sem_transformacao',
          id_sistema: (() => {
            const n = Number(p.idSistema ?? p.id_sistema);
            return Number.isFinite(n) ? n : null;
          })(),
        },
        geometry: f.geometry as GeoJSON.Geometry,
      };
    });
}

/** Unifica sobreposições entre polígonos de area_mapeadas (export PostGIS). */
export function unificarAreasMapeadasSobrepostas(
  features: BairroGeojsonFeature[],
): BairroGeojsonFeature[] {
  if (features.length <= 1) return features;

  const areas = features.map((f) => ({
    properties: {
      nome: f.properties.nome,
      pois: f.properties.pois,
      hectaresUnicos:
        f.properties.hectaresUnicos ?? f.properties.hectares_unicos ?? 0,
      metodoAtribuicao:
        f.properties.metodoAtribuicao ?? f.properties.metodo_atribuicao,
      fonteGeom: f.properties.fonteGeom ?? f.properties.fonte_geom,
      criterioAtribuicao:
        f.properties.criterioAtribuicao ?? f.properties.criterio_atribuicao,
    },
    geometry: f.geometry,
  }));

  const dissolvidas = dissolverSobreposicoesEspaciais(areas);

  return dissolvidas.map((f) => ({
    type: 'Feature' as const,
    properties: {
      nome: f.properties.nome,
      pois: f.properties.pois,
      hectares_unicos: f.properties.hectaresUnicos,
      hectaresUnicos: f.properties.hectaresUnicos,
      metodo_atribuicao: 'area_mapeada_sem_overlap',
      metodoAtribuicao: 'area_mapeada_sem_overlap',
      fonte_geom: f.properties.fonteGeom ?? 'area_mapeadas',
      fonteGeom: f.properties.fonteGeom ?? 'area_mapeadas',
      criterio_atribuicao: 'uniao_sobreposicao',
      criterioAtribuicao: 'uniao_sobreposicao',
    },
    geometry: f.geometry,
  }));
}

interface BairroGeojsonFeature {
  properties: BairroGeojsonProperties;
  geometry: GeoJSON.Geometry;
}

function lerNumero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function lerTexto(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

interface ConsorcioRef {
  id: number;
  nome?: string;
  eConsorcio?: number;
  municipios: Array<{ geocode: number; nome?: string }>;
}

/** Contrato de verba direta que contém o geocode. */
export function contratoVerbaDiretaDoGeocode(
  geocode: number,
  consorcios: ConsorcioRef[],
): ConsorcioRef | undefined {
  return consorcios.find(
    (c) =>
      Number(c.eConsorcio) === 0 &&
      c.municipios.some((m) => Number(m.geocode) === Number(geocode)),
  );
}

/** ID do contrato de verba direta ativo no filtro. */
export function contratoVerbaDiretaId(
  geocodeFiltro: number | null,
  consorcioId: number | null,
  consorcios: ConsorcioRef[],
): number | null {
  if (geocodeFiltro != null) {
    const porGeocode = contratoVerbaDiretaDoGeocode(geocodeFiltro, consorcios);
    if (porGeocode) return porGeocode.id;
  }
  if (consorcioId != null && consorcioId > 0) {
    const c = consorcios.find((x) => x.id === consorcioId);
    if (Number(c?.eConsorcio) === 0) return consorcioId;
    if (!c && geocodeFiltro != null) return consorcioId;
  }
  return null;
}

/** Verifica se o geocode pertence a um contrato de verba direta (eConsorcio = 0). */
export function isGeocodeVerbaDireta(
  geocode: number,
  consorcios: ConsorcioRef[],
): boolean {
  return Boolean(contratoVerbaDiretaDoGeocode(geocode, consorcios));
}

/** Contrato selecionado no filtro é verba direta. */
export function isContratoVerbaDireta(
  consorcioId: number | null,
  consorcios: ConsorcioRef[],
): boolean {
  if (consorcioId == null) return false;
  const c = consorcios.find((x) => x.id === consorcioId);
  return Number(c?.eConsorcio) === 0;
}

export function deveExibirProjecaoBairros(
  geocodeFiltro: number | null,
  consorcioId: number | null,
  consorcios: ConsorcioRef[],
): boolean {
  if (geocodeFiltro == null) return false;
  if (isContratoVerbaDireta(consorcioId, consorcios)) return true;
  return isGeocodeVerbaDireta(geocodeFiltro, consorcios);
}

export function municipioIdDeProjecao(mun: ProjecaoMunicipio): number | null {
  const id =
    mun.poi_hectare?.municipio_id ??
    mun.hectares?.municipio_id ??
    mun.pois?.municipio_id;
  return id != null && Number(id) > 0 ? Number(id) : null;
}

/** Distribui casos inteiros proporcionalmente ao peso (método do maior resto). */
export function distribuirCasosPorBairro(
  total: number,
  bairros: BairroPeso[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (!bairros.length) return out;

  const soma = bairros.reduce((s, b) => s + Math.max(0, b.peso), 0);
  if (total <= 0 || soma <= 0) {
    for (const b of bairros) out.set(b.nome, 0);
    return out;
  }

  const partes = bairros.map((b) => {
    const exact = (total * Math.max(0, b.peso)) / soma;
    const floor = Math.floor(exact);
    return { nome: b.nome, floor, frac: exact - floor };
  });

  let restante = total - partes.reduce((s, p) => s + p.floor, 0);
  const ordenados = [...partes].sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < restante; i++) {
    ordenados[i % ordenados.length].floor += 1;
  }
  for (const p of partes) out.set(p.nome, p.floor);
  return out;
}

export function montarProjecoesBairro(
  mun: ProjecaoMunicipio,
  pesos: BairroPeso[],
): ProjecaoBairro[] {
  const comPoi = pesos.filter((p) => p.peso > 0);
  if (!comPoi.length) return [];

  const nomes = comPoi.map((p) => p.nome);
  const porMes = new Map<number, Map<string, number>>();

  for (const proj of mun.projecoes) {
    const mapa = distribuirCasosPorBairro(proj.valor, comPoi);
    porMes.set(proj.mesNum, mapa);
  }

  return nomes.map((nome) => {
    const peso = comPoi.find((p) => p.nome === nome)?.peso ?? 0;
    const projecoes = mun.projecoes.map((p: ProjecaoMes) => ({
      mesNum: p.mesNum,
      label: p.label,
      valor: porMes.get(p.mesNum)?.get(nome) ?? 0,
    }));
    return { nome, peso, projecoes };
  });
}

/**
 * Áreas mapeadas brutas (1 polígono por registro em area_mapeadas).
 * Projeção municipal repartida pela área em hectares de cada polígono.
 */
export function montarAreasMapeadasDoGeojson(
  features: BairroGeojsonFeature[],
  mun: ProjecaoMunicipio,
): BairroMapaFeature[] {
  const validas = features.filter((f) => f.geometry);
  if (!validas.length) return [];

  const usaPois = validas.some((f) => Number(f.properties.pois) > 0);

  const pesos: BairroPeso[] = validas.map((f) => {
    const areaId = lerNumero(f.properties.area_id);
    const ha = lerNumero(
      f.properties.hectaresUnicos ?? f.properties.hectares_unicos,
    );
    const pois = Math.max(0, lerNumero(f.properties.pois));
    const peso = usaPois ? (pois > 0 ? pois : 0) : ha > 0 ? ha : 1;
    return {
      nome: `__area_${areaId || f.properties.nome}__`,
      peso,
    };
  });

  const proj = montarProjecoesBairro(mun, pesos);
  const projPorChave = new Map(proj.map((item) => [item.nome, item.projecoes]));

  return validas.map((f) => {
    const areaId = lerNumero(f.properties.area_id);
    const chave = `__area_${areaId || f.properties.nome}__`;
    const nome = formatarNomeBairro(String(f.properties.nome || `Área ${areaId}`));
    const hectaresUnicos = lerNumero(
      f.properties.hectaresUnicos ?? f.properties.hectares_unicos,
    );
    return {
      nome,
      pois: Math.max(0, lerNumero(f.properties.pois)),
      hectaresUnicos,
      metodoAtribuicao: lerTexto(
        f.properties.metodoAtribuicao ?? f.properties.metodo_atribuicao,
      ),
      fonteGeom: lerTexto(f.properties.fonteGeom ?? f.properties.fonte_geom),
      criterioAtribuicao: lerTexto(
        f.properties.criterioAtribuicao ?? f.properties.criterio_atribuicao,
      ),
      geometry: f.geometry,
      projecoes: projPorChave.get(chave) ?? [],
    };
  });
}

/**
 * Usa diretamente o GeoJSON final do backend, preservando a geometria já
 * resolvida sem overlap. Apenas cruza as projeções mensais pela proporção
 * de POIs de cada bairro.
 */
export function montarBairrosDiretoDoGeojson(
  features: BairroGeojsonFeature[],
  mun: ProjecaoMunicipio,
): BairroMapaFeature[] {
  const validas = features.filter((f) => f.geometry);
  if (!validas.length) return [];

  const pesos = new Map<string, BairroPeso>();
  for (const f of validas) {
    const nome = formatarNomeBairro(String(f.properties.nome || ''));
    const chave = chaveNormalizadaBairro(nome);
    const pesoAtual = pesos.get(chave)?.peso ?? 0;
    const peso = Math.max(0, Number(f.properties.pois) || 0);
    pesos.set(chave, { nome, peso: pesoAtual + peso });
  }

  const proj = montarProjecoesBairro(mun, Array.from(pesos.values()));
  const projPorNome = new Map(
    proj.map((item) => [chaveNormalizadaBairro(item.nome), item.projecoes]),
  );

  return validas.map((f) => {
    const nome = formatarNomeBairro(String(f.properties.nome || ''));
    const hectaresUnicos = lerNumero(
      f.properties.hectaresUnicos ?? f.properties.hectares_unicos,
    );
    return {
      nome,
      pois: Math.max(0, lerNumero(f.properties.pois)),
      hectaresUnicos,
      metodoAtribuicao: lerTexto(
        f.properties.metodoAtribuicao ?? f.properties.metodo_atribuicao,
      ),
      fonteGeom: lerTexto(f.properties.fonteGeom ?? f.properties.fonte_geom),
      criterioAtribuicao: lerTexto(
        f.properties.criterioAtribuicao ?? f.properties.criterio_atribuicao,
      ),
      geometry: f.geometry,
      projecoes: projPorNome.get(chaveNormalizadaBairro(nome)) ?? [],
    };
  });
}

function nomeBairroValido(nome: string): boolean {
  const n = (nome || '').trim().toUpperCase();
  return (
    n.length > 0 &&
    n !== 'SEM BAIRRO' &&
    n !== 'SEM_PONTOS_NA_PLANILHA'
  );
}

/** Chave para cruzar POIs × hectares (ignora acentos e caixa). */
export function chaveNormalizadaBairro(nome: string): string {
  return (nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Soma POIs/criadouros do bairro a partir do payload da API. */
export function contarPoisBairro(bairro: {
  totalGeral?: number;
  tiposCriadouros?: Record<string, number>;
}): number {
  if (bairro.tiposCriadouros && typeof bairro.tiposCriadouros === 'object') {
    const soma = Object.values(bairro.tiposCriadouros).reduce(
      (s, v) => s + Math.max(0, Number(v) || 0),
      0,
    );
    if (soma > 0) return soma;
  }
  return Math.max(0, Number(bairro.totalGeral) || 0);
}

export function pesosDeCriadourosPorBairro(
  bairros: Array<{
    nomeBairro?: string;
    nome?: string;
    totalGeral?: number;
    tiposCriadouros?: Record<string, number>;
    tipos_criadouros?: Record<string, number>;
  }>,
): BairroPeso[] {
  return bairros
    .map((b) => {
      const nomeRaw = String(b.nomeBairro ?? b.nome ?? '').trim();
      if (!nomeBairroValido(nomeRaw)) return null;
      const tipos = b.tiposCriadouros ?? b.tipos_criadouros;
      const peso = contarPoisBairro({
        totalGeral: b.totalGeral,
        tiposCriadouros: tipos,
      });
      if (peso <= 0) return null;
      return { nome: formatarNomeBairro(nomeRaw), peso };
    })
    .filter((b): b is BairroPeso => b != null);
}

export function pesosDeDistribuicaoCriadouro(
  itens: Array<{ nome: string; quantidade: number }>,
): BairroPeso[] {
  return itens
    .filter((i) => nomeBairroValido(i.nome))
    .map((i) => ({
      nome: formatarNomeBairro(i.nome),
      peso: Math.max(0, Number(i.quantidade) || 0),
    }))
    .filter((b) => b.peso > 0);
}

export function pesosDeHectaresPorBairro(
  bairros: Array<
    | { nomeBairro?: string; hectaresMapeados?: number }
    | Record<string, unknown>
  >,
): BairroPeso[] {
  return bairros
    .map((linha) => {
      const b = linha as Record<string, unknown>;
      const nomeRaw = String(
        b.nomeBairro ?? b.nome_bairro ?? b.nome ?? b.bairro ?? '',
      ).trim();
      const ha = Number(
        b.hectaresMapeados ?? b.hectares_mapeados ?? b.hectares ?? 0,
      );
      if (!nomeBairroValido(nomeRaw) || ha <= 0) return null;
      return {
        nome: formatarNomeBairro(nomeRaw),
        peso: ha,
      };
    })
    .filter((b): b is BairroPeso => b != null);
}

/** Reparte hectares municipais na proporção dos POIs por bairro. */
export function alocarHectaresProporcionalPois(
  totalHa: number,
  pois: BairroPeso[],
): BairroPeso[] {
  const comPoi = pois.filter((p) => p.peso > 0);
  const somaPois = comPoi.reduce((s, p) => s + p.peso, 0);
  if (totalHa <= 0 || somaPois <= 0) return [];

  let acumulado = 0;
  return comPoi
    .map((p, idx) => {
      let ha: number;
      if (idx === comPoi.length - 1) {
        ha = Math.round((totalHa - acumulado) * 10000) / 10000;
      } else {
        ha = Math.round(((totalHa * p.peso) / somaPois) * 10000) / 10000;
        acumulado += ha;
      }
      return { nome: p.nome, peso: ha };
    })
    .filter((h) => h.peso > 0);
}

export interface BairroPoiHectare {
  nome: string;
  pois: number;
  hectares: number;
  poiPorHectare: number | null;
}

/** Cruza POIs e hectares por bairro (normalização pelo nome formatado). */
export function montarRankingPoisHectarePorBairro(
  pois: BairroPeso[],
  hectares: BairroPeso[],
): BairroPoiHectare[] {
  const haMap = new Map<string, number>();
  for (const h of hectares) {
    const chave = chaveNormalizadaBairro(h.nome);
    haMap.set(chave, (haMap.get(chave) ?? 0) + h.peso);
  }

  return pois
    .filter((p) => p.peso > 0)
    .map((p) => {
      const ha = haMap.get(chaveNormalizadaBairro(p.nome)) ?? 0;
      return {
        nome: p.nome,
        pois: p.peso,
        hectares: ha,
        poiPorHectare:
          ha > 0 ? Math.round((p.peso / ha) * 100) / 100 : null,
      };
    })
    .sort(
      (a, b) =>
        b.pois - a.pois ||
        (b.poiPorHectare ?? 0) - (a.poiPorHectare ?? 0) ||
        a.nome.localeCompare(b.nome, 'pt-BR'),
    );
}

export function montarRankingCasosPorBairro(
  totalCasosNotificados: number,
  pesos: BairroPeso[],
): Array<{ nome: string; casos: number; pois: number }> {
  const comPoi = pesos.filter((p) => p.peso > 0);
  if (!comPoi.length) return [];

  const mapa =
    totalCasosNotificados > 0
      ? distribuirCasosPorBairro(totalCasosNotificados, comPoi)
      : null;

  return comPoi
    .map((p) => ({
      nome: p.nome,
      casos: mapa ? (mapa.get(p.nome) ?? 0) : p.peso,
      pois: p.peso,
    }))
    .filter((b) => b.pois > 0 && (mapa ? b.casos > 0 : b.casos > 0))
    .sort((a, b) => b.casos - a.casos || b.pois - a.pois);
}

export function casosNotificadosMunicipio(
  geocode: number,
  ranking: Array<{ geocode?: number; casos_notificados?: number }>,
  overview?: {
    df_municipios?: Array<{ geocode?: number; casos_notificados?: number }>;
    df_mensal_mun?: Array<{
      geocode?: number;
      casos_notificados?: number;
      CasosDengue?: number;
    }>;
  } | null,
): number {
  const gc = Number(geocode);
  const linhaRanking = ranking.find((m) => Number(m.geocode) === gc);
  if (linhaRanking?.casos_notificados != null && linhaRanking.casos_notificados > 0) {
    return linhaRanking.casos_notificados;
  }

  const linhaDf = overview?.df_municipios?.find((m) => Number(m.geocode) === gc);
  if (linhaDf?.casos_notificados != null && linhaDf.casos_notificados > 0) {
    return linhaDf.casos_notificados;
  }

  const mensal = (overview?.df_mensal_mun ?? []).filter((r) => Number(r.geocode) === gc);
  if (!mensal.length) return 0;

  const somaNotificados = mensal.reduce(
    (s, r) => s + (Number(r.casos_notificados) || 0),
    0,
  );
  if (somaNotificados > 0) return somaNotificados;

  return mensal.reduce((s, r) => s + (Number(r.CasosDengue) || 0), 0);
}

function formatarNomeBairro(nome: string): string {
  const t = nome.trim();
  if (!t) return 'Sem bairro';
  return t
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
