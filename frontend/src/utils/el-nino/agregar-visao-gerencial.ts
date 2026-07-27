/**
 * Agrega dados de todos os contratos (consórcios + verba direta) para a visão gerencial.
 */
import {
  buscarCoordenadasGeocode,
  contratoIdDoGeocode,
  listarConsorcios,
  resolverDadosContrato,
  resolverNomeMunicipio,
} from './contracts';
import { aplicarHistoricoConsolidado } from './historico-casos-consolidado';

export const VISAO_TODOS_CONTRATOS = 'todos';

const CACHE_AGREGADO_TTL_MS = 30 * 60 * 1000;

let cacheAgregado: { dados: any; expiraEm: number; versao: number } | null = null;

export function invalidarCacheVisaoGerencial(): void {
  cacheAgregado = null;
}

/** Bump ao mudar shape do pacote agregado (invalida cache em dev). */
const CACHE_AGREGADO_VERSAO = 5;

export function isVisaoTodosContratos(
  params: Record<string, string | undefined>,
): boolean {
  const raw =
    params.visao ??
    params.contratoId ??
    params.contrato_id ??
    params.idContrato ??
    params.id_contrato;
  return raw === VISAO_TODOS_CONTRATOS || raw === 'all';
}

function carregarPacotesContratos(
  forceRefresh = false,
): Map<number, any> {
  const map = new Map<number, any>();
  for (const c of listarConsorcios()) {
    const dados = resolverDadosContrato(c.id, forceRefresh);
    if (dados) map.set(c.id, dados);
  }
  return map;
}

/** União de municípios de todos os contratos cadastrados. */
export function listarMunicipiosTodosContratos(
  pacotes?: Map<number, any>,
): Array<{
  geocode: number;
  municipioId: number;
  nome: string;
  populacao: number;
  contratoId: number;
}> {
  const porGeocode = new Map<
    number,
    {
      geocode: number;
      municipioId: number;
      nome: string;
      populacao: number;
      contratoId: number;
    }
  >();

  const contratosOrdenados = [...listarConsorcios()].sort((a, b) => {
    const vdA = Number(a.eConsorcio) === 0 ? 0 : 1;
    const vdB = Number(b.eConsorcio) === 0 ? 0 : 1;
    return vdA - vdB;
  });

  for (const c of contratosOrdenados) {
    const dados = pacotes?.get(c.id) ?? resolverDadosContrato(c.id);
    for (const m of c.municipios) {
      const gc = Number(m.geocode);
      if (!Number.isFinite(gc) || gc <= 0) continue;
      const dono = contratoIdDoGeocode(gc) ?? c.id;
      const popRow = dados?.municipios?.find(
        (x: { geocode?: number }) => Number(x.geocode) === gc,
      );
      const row = {
        geocode: gc,
        municipioId: gc,
        nome: resolverNomeMunicipio(gc, m.nome),
        populacao: Number(popRow?.populacao ?? 0),
        contratoId: dono,
      };
      const hit = porGeocode.get(gc);
      if (!hit || dono === c.id) {
        porGeocode.set(gc, row);
      }
    }
  }

  return [...porGeocode.values()].sort((a, b) =>
    a.nome.localeCompare(b.nome, 'pt-BR'),
  );
}

export function montarEscopoTodosContratos() {
  const consorcios = listarConsorcios();
  const pacotes = carregarPacotesContratos();
  const municipios = listarMunicipiosTodosContratos(pacotes).map(
    ({ geocode, municipioId, nome, populacao }) => ({
      geocode,
      municipioId,
      nome,
      populacao,
    }),
  );
  const nConsorcio = consorcios.filter((c) => Number(c.eConsorcio) !== 0).length;
  const nVerba = consorcios.filter((c) => Number(c.eConsorcio) === 0).length;

  return {
    tipo: 'global' as const,
    rotulo: 'Todos os contratos · Minas Gerais',
    descricao: `${consorcios.length} contratos (${nConsorcio} consórcios + ${nVerba} verba direta) · ${municipios.length} municípios`,
    municipios,
    geocodes: municipios.map((m) => m.geocode),
    populacaoTotal: municipios.reduce((s, m) => s + (m.populacao ?? 0), 0),
    podeTrocar: true,
    podeAgregar: true,
    agregacaoDefault: 'ponderada' as const,
    isGlobal: true,
    visao: VISAO_TODOS_CONTRATOS,
    n_contratos: consorcios.length,
  };
}

function chaveMensal(r: { geocode?: number; Ano?: number; MesNum?: number }) {
  return `${Number(r.geocode)}|${Number(r.Ano)}|${Number(r.MesNum)}`;
}

function somarSeriePorMes(linhas: any[]): any[] {
  const map = new Map<string, any>();
  for (const r of linhas) {
    const ano = Number(r.Ano);
    const mes = Number(r.MesNum);
    if (!Number.isFinite(ano) || !Number.isFinite(mes)) continue;
    const k = `${ano}|${mes}`;
    if (!map.has(k)) {
      map.set(k, {
        ...r,
        Ano: ano,
        MesNum: mes,
        CasosDengue: 0,
        casos_notificados: 0,
        casos_estimados: 0,
      });
    }
    const acc = map.get(k)!;
    acc.CasosDengue += Number(r.CasosDengue ?? r.casos_notificados ?? 0);
    acc.casos_notificados += Number(r.casos_notificados ?? r.CasosDengue ?? 0);
    acc.casos_estimados += Number(r.casos_estimados ?? 0);
    if (r.Temperatura != null && acc.Temperatura == null) {
      acc.Temperatura = r.Temperatura;
    }
    if (r.Precipitacao != null && acc.Precipitacao == null) {
      acc.Precipitacao = r.Precipitacao;
    }
    if (r.ONI != null && acc.ONI == null) acc.ONI = r.ONI;
    if (r.TipoElNino && !acc.TipoElNino) acc.TipoElNino = r.TipoElNino;
    if (r.ElNino != null && acc.ElNino == null) acc.ElNino = r.ElNino;
  }
  return [...map.values()].sort(
    (a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum,
  );
}

function mesclarMapaMunicipios(linhas: any[]): any[] {
  const map = new Map<number, any>();
  for (const m of linhas) {
    const gc = Number(m.geocode);
    if (!Number.isFinite(gc) || gc <= 0) continue;
    const nome = resolverNomeMunicipio(gc, m.municipio ?? m.nome);
    const casos = Number(m.casos_notificados ?? m.CasosDengue ?? 0);
    const est = Number(m.casos_estimados ?? 0);
    const hit = map.get(gc);
    if (!hit || casos > Number(hit.casos_notificados ?? 0)) {
      map.set(gc, {
        geocode: gc,
        municipio: nome,
        nome,
        casos_notificados: casos,
        casos_estimados: est,
        intensidade: m.intensidade ?? 0,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) => (b.casos_notificados ?? 0) - (a.casos_notificados ?? 0),
  );
}

function mesclarMapaProjecaoMunicipios(pacotes: Map<number, any>): any[] {
  const map = new Map<number, any>();
  for (const c of listarConsorcios()) {
    const dados = pacotes.get(c.id);
    if (!dados) continue;
    const inner = dados?.mapa_projecao?.payload ?? dados?.mapa_projecao;
    const muns: any[] = inner?.municipios ?? [];
    for (const mun of muns) {
      const gc = Number(mun.geocode);
      if (!Number.isFinite(gc) || gc <= 0) continue;
      const dono = contratoIdDoGeocode(gc);
      if (dono != null && dono !== c.id) continue;
      if (!map.has(gc)) {
        map.set(gc, {
          ...mun,
          geocode: gc,
          nome: resolverNomeMunicipio(gc, mun.nome ?? mun.municipio),
          _contrato_id: c.id,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) =>
    String(a.nome).localeCompare(String(b.nome), 'pt-BR'),
  );
}

/** Garante todos os municípios do escopo no mapa/ranking (mesmo sem mapa_projecao). */
function unirMunicipiosEscopoMapa(
  municipiosEscopo: Array<{
    geocode: number;
    nome?: string;
    municipio?: string;
    lat?: number | null;
    lon?: number | null;
    populacao?: number;
    contrato_id?: number;
  }>,
  mapaProjecao: any[],
  mapaDf: any[],
): any[] {
  const porGeocode = new Map<number, any>();

  for (const m of municipiosEscopo) {
    const gc = Number(m.geocode);
    if (!Number.isFinite(gc) || gc <= 0) continue;
    const casos = mapaDf.find((r) => Number(r.geocode) === gc);
    porGeocode.set(gc, {
      geocode: gc,
      nome: m.nome ?? m.municipio ?? resolverNomeMunicipio(gc),
      municipio: m.municipio ?? m.nome ?? resolverNomeMunicipio(gc),
      lat: m.lat ?? null,
      lon: m.lon ?? null,
      populacao: Number(m.populacao ?? 0),
      casos_notificados: Number(casos?.casos_notificados ?? 0),
      casos_estimados: Number(casos?.casos_estimados ?? 0),
      intensidade: Number(casos?.intensidade ?? 0),
      projecoes: [],
      _contrato_id: m.contrato_id ?? null,
    });
  }

  for (const mun of mapaProjecao) {
    const gc = Number(mun.geocode);
    if (!Number.isFinite(gc) || gc <= 0) continue;
    const base = porGeocode.get(gc) ?? {
      geocode: gc,
      nome: resolverNomeMunicipio(gc, mun.nome ?? mun.municipio),
    };
    porGeocode.set(gc, {
      ...base,
      ...mun,
      geocode: gc,
      nome: mun.nome ?? mun.municipio ?? base.nome,
      municipio: mun.municipio ?? mun.nome ?? base.municipio,
      projecoes: mun.projecoes ?? base.projecoes ?? [],
    });
  }

  return [...porGeocode.values()].sort((a, b) =>
    String(a.nome ?? a.municipio).localeCompare(
      String(b.nome ?? b.municipio),
      'pt-BR',
    ),
  );
}

/** Completa ranking/mapa com municípios do escopo que não têm linha no cache. */
function completarMapaDf(
  mapaDf: any[],
  municipiosEscopo: Array<{ geocode: number; nome?: string; municipio?: string }>,
): any[] {
  const porGeocode = new Map<number, any>();
  for (const m of mapaDf) {
    const gc = Number(m.geocode);
    if (Number.isFinite(gc) && gc > 0) porGeocode.set(gc, m);
  }
  for (const m of municipiosEscopo) {
    const gc = Number(m.geocode);
    if (!Number.isFinite(gc) || gc <= 0 || porGeocode.has(gc)) continue;
    const nome = resolverNomeMunicipio(gc, m.nome ?? m.municipio);
    porGeocode.set(gc, {
      geocode: gc,
      municipio: nome,
      nome,
      casos_notificados: 0,
      casos_estimados: 0,
      intensidade: 0,
    });
  }
  return [...porGeocode.values()].sort(
    (a, b) => (b.casos_notificados ?? 0) - (a.casos_notificados ?? 0),
  );
}

/**
 * Pacote agregado para overview / KPIs / série / mapa na visão "Todos os contratos".
 */
export function agregarDadosTodosContratos(forceRefresh = false): any | null {
  if (
    !forceRefresh &&
    cacheAgregado &&
    cacheAgregado.versao === CACHE_AGREGADO_VERSAO &&
    cacheAgregado.expiraEm > Date.now()
  ) {
    return cacheAgregado.dados;
  }

  const consorcios = listarConsorcios();
  if (!consorcios.length) return null;

  const pacotesMap = carregarPacotesContratos(forceRefresh);
  const pacotes = [...pacotesMap.values()];
  if (!pacotes.length) return null;

  const donoGeocode = new Map<number, number>();
  for (const c of consorcios) {
    for (const m of c.municipios) {
      const gc = Number(m.geocode);
      if (!donoGeocode.has(gc)) donoGeocode.set(gc, c.id);
      const vd = Number(c.eConsorcio) === 0;
      if (vd) donoGeocode.set(gc, c.id);
    }
  }
  for (const gc of [...donoGeocode.keys()]) {
    const dono = contratoIdDoGeocode(gc);
    if (dono != null) donoGeocode.set(gc, dono);
  }

  const dfMensal: any[] = [];
  const vistosMensal = new Set<string>();
  for (const c of consorcios) {
    const dados = pacotesMap.get(c.id);
    if (!dados?.df_mensal_mun?.length) continue;
    for (const r of dados.df_mensal_mun) {
      const gc = Number(r.geocode);
      if (donoGeocode.get(gc) !== c.id) continue;
      const k = chaveMensal(r);
      if (vistosMensal.has(k)) continue;
      vistosMensal.add(k);
      dfMensal.push(r);
    }
  }

  const municipios = listarMunicipiosTodosContratos(pacotesMap).map((m) => {
    const coords = buscarCoordenadasGeocode(m.geocode);
    return {
      geocode: m.geocode,
      municipio: m.nome,
      nome: m.nome,
      populacao: m.populacao,
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null,
      contrato_id: m.contratoId,
    };
  });

  const mapaDfParts: any[] = [];
  for (const p of pacotes) {
    mapaDfParts.push(...(p.mapa_df ?? []), ...(p.df_municipios ?? []));
  }
  const mapa_df = completarMapaDf(
    mesclarMapaMunicipios(mapaDfParts),
    municipios,
  );

  const oniRef =
    pacotes.find((p) => p.oni_mensal?.length)?.oni_mensal ?? [];
  const elninoRef =
    pacotes.find((p) => p.elnino && Object.keys(p.elnino).length)?.elnino ?? {};
  const dfSerie = somarSeriePorMes(dfMensal);

  const mapaMunsProjecao = mesclarMapaProjecaoMunicipios(pacotesMap);
  const mapaMuns = unirMunicipiosEscopoMapa(municipios, mapaMunsProjecao, mapa_df);
  const templateMapa =
    pacotes.find((p) => p.mapa_projecao?.payload?.meses?.length)?.mapa_projecao
      ?.payload ??
    pacotes.find((p) => p.mapa_projecao?.meses?.length)?.mapa_projecao ??
    null;

  const avisos = [
    `Visão gerencial: ${consorcios.length} contratos agregados (consórcios + verba direta).`,
    ...pacotes.flatMap((p) => p.avisos ?? []).slice(0, 5),
  ];
  const fontes = [...new Set(pacotes.flatMap((p) => p.fontes ?? []))];

  const ref = pacotes[0];

  const resultado = {
    rotulo_consorcio: 'Todos os contratos · Minas Gerais',
    municipios,
    df_mensal_mun: dfMensal,
    df_serie: dfSerie,
    df_serie_ponderada: dfSerie,
    df_municipios: mapa_df,
    mapa_df,
    oni_mensal: oniRef,
    elnino: elninoRef,
    correlacoes: ref.correlacoes ?? [],
    alertas: pacotes.flatMap((p) => p.alertas ?? []),
    alertas_por_geocode: Object.assign(
      {},
      ...pacotes.map((p) => p.alertas_por_geocode ?? {}),
    ),
    clima: ref.clima ?? null,
    clima_municipios: Object.assign(
      {},
      ...pacotes.map((p) => p.clima_municipios ?? {}),
    ),
    /** Omitido na visão gerencial — payload enorme; temperatura já vem em df_mensal_mun. */
    clima_historico: [],
    fontes,
    avisos,
    ano_inicio: ref.ano_inicio,
    ano_fim: ref.ano_fim,
    mes_fim: ref.mes_fim,
    ano_fim_consolidado: ref.ano_fim_consolidado,
    mes_fim_consolidado: ref.mes_fim_consolidado,
    atualizado_em: new Date().toISOString(),
    visao: VISAO_TODOS_CONTRATOS,
    _contrato_id: null,
    mapa_projecao: templateMapa
      ? {
          payload: {
            ...(templateMapa.payload ?? templateMapa),
            municipios: mapaMuns,
            rotulo_conjunto: 'Todos os contratos · Minas Gerais',
            avisos,
            fontes,
          },
        }
      : mapaMuns.length
        ? {
            payload: {
              ano_projecao: new Date().getFullYear(),
              rotulo_conjunto: 'Todos os contratos · Minas Gerais',
              meses: [],
              municipios: mapaMuns,
              fontes,
              avisos,
            },
          }
        : null,
    inmet_alertas: pacotes.flatMap((p) => p.inmet_alertas ?? []),
    causa_dengue: ref.causa_dengue ?? null,
  };

  cacheAgregado = {
    dados: aplicarHistoricoConsolidado(resultado),
    expiraEm: Date.now() + CACHE_AGREGADO_TTL_MS,
    versao: CACHE_AGREGADO_VERSAO,
  };

  return cacheAgregado.dados;
}

/** Payload de mapa-projecao agregado (modo gerencial). */
export function montarMapaProjecaoTodosContratos(forceRefresh = false): any | null {
  const dados = agregarDadosTodosContratos(forceRefresh);
  if (!dados) return null;
  const inner = dados.mapa_projecao?.payload ?? dados.mapa_projecao;
  if (!inner) return null;
  const municipiosCompletos =
    inner.municipios?.length >= (dados.municipios?.length ?? 0)
      ? inner.municipios
      : unirMunicipiosEscopoMapa(
          dados.municipios ?? [],
          inner.municipios ?? [],
          dados.mapa_df ?? dados.df_municipios ?? [],
        );
  return {
    ...inner,
    rotulo_conjunto: 'Todos os contratos · Minas Gerais',
    municipios: municipiosCompletos,
    visao: VISAO_TODOS_CONTRATOS,
    _contrato_id: null,
  };
}
