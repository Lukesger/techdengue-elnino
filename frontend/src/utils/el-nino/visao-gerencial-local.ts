/**
 * Visão gerencial (visao=todos + usuário global):
 * pré-cache FIXO em disco + memória para o front consultar rápido.
 *
 * Disco runtime (BFF Next — fora do watcher):
 *   .cache/el-nino/visao_gerencial/
 *     overview.json
 *     mapa-projecao.json
 *     meta.json
 *
 * Fonte: agregação dos pipeline_v2_cache_*.json (seed) + malha_mg_ibge.json
 */
import fs from 'fs';
import {
  RUNTIME_DIR_RELATIVO,
  escreverJsonAtomico,
  garantirDirRuntime,
  runtimePath,
} from './cache-paths';
import {
  agregarDadosTodosContratos,
  montarEscopoTodosContratos,
  montarMapaProjecaoTodosContratos,
} from './agregar-visao-gerencial';
import { anexarPoiHectareNoMapaPayload } from './anexar-poi-hectare-mapa';
import { anexarMalhaIbgeGerencial } from './anexar-malha-ibge-gerencial';
import { montarKpis } from './montar-kpis';
import { montarSerieConsorcio } from './montar-serie-consorcio';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const DIR_CACHE = runtimePath('visao_gerencial');
const FILE_OVERVIEW = runtimePath('visao_gerencial', 'overview.json');
const FILE_MAPA = runtimePath('visao_gerencial', 'mapa-projecao.json');
const FILE_META = runtimePath('visao_gerencial', 'meta.json');

type MetaDisco = {
  atualizado_em: string;
  expira_em: string;
  n_municipios?: number;
  n_features_malha?: number;
};

let cacheMapaMemoria: {
  payload: Record<string, unknown>;
  expiraEm: number;
} | null = null;

let cacheOverviewMemoria: {
  payload: Record<string, unknown>;
  expiraEm: number;
} | null = null;

/** Single-flight do warm-up por processo. */
let warmUpEmAndamento: Promise<void> | null = null;

function garantirDir(): void {
  garantirDirRuntime('visao_gerencial');
}

function lerJsonDisco<T>(arquivo: string): T | null {
  try {
    if (!fs.existsSync(arquivo)) return null;
    return JSON.parse(fs.readFileSync(arquivo, 'utf8')) as T;
  } catch {
    return null;
  }
}

function escreverJsonDisco(arquivo: string, data: unknown): void {
  garantirDir();
  if (!escreverJsonAtomico(arquivo, data)) {
    console.warn(
      '[visao-gerencial] falha ao gravar disco:',
      arquivo,
    );
  }
}

function metaValida(meta: MetaDisco | null): boolean {
  if (!meta?.expira_em) return false;
  const exp = Date.parse(meta.expira_em);
  return Number.isFinite(exp) && exp > Date.now();
}

/** Cache em disco já materializado e dentro do TTL — sem necessidade de write. */
function cacheDiscoPronto(): boolean {
  const meta = lerJsonDisco<MetaDisco>(FILE_META);
  if (!metaValida(meta)) return false;
  if (!fs.existsSync(FILE_OVERVIEW)) return false;
  const mapa = lerJsonDisco<Record<string, unknown>>(FILE_MAPA);
  const nFeats =
    (mapa?.geojson as { features?: unknown[] } | undefined)?.features
      ?.length ?? 0;
  return nFeats >= 800;
}

export function caminhoCacheVisaoGerencial(): string {
  return DIR_CACHE;
}

export function invalidarCacheMapaGerencial(): void {
  cacheMapaMemoria = null;
  cacheOverviewMemoria = null;
  warmUpEmAndamento = null;
  try {
    for (const f of [FILE_OVERVIEW, FILE_MAPA, FILE_META]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  } catch {
    /* ignore */
  }
}

function carregarOverviewFixo(): Record<string, unknown> | null {
  if (
    cacheOverviewMemoria &&
    cacheOverviewMemoria.expiraEm > Date.now()
  ) {
    return cacheOverviewMemoria.payload;
  }

  const meta = lerJsonDisco<MetaDisco>(FILE_META);
  if (metaValida(meta)) {
    const disco = lerJsonDisco<Record<string, unknown>>(FILE_OVERVIEW);
    if (disco?.municipios) {
      const expiraEm = Date.parse(meta!.expira_em);
      cacheOverviewMemoria = { payload: disco, expiraEm };
      return disco;
    }
  }

  const dados = agregarDadosTodosContratos() as Record<string, unknown> | null;
  if (!dados) return null;

  const expiraEm = Date.now() + CACHE_TTL_MS;
  cacheOverviewMemoria = { payload: dados, expiraEm };
  escreverJsonDisco(FILE_OVERVIEW, dados);
  escreverJsonDisco(FILE_META, {
    atualizado_em: new Date().toISOString(),
    expira_em: new Date(expiraEm).toISOString(),
    n_municipios: Array.isArray(dados.municipios)
      ? dados.municipios.length
      : 0,
  } satisfies MetaDisco);

  return dados;
}

async function montarMapaGerencialComMalha(): Promise<Record<string, unknown> | null> {
  if (
    cacheMapaMemoria &&
    cacheMapaMemoria.expiraEm > Date.now() &&
    (cacheMapaMemoria.payload.geojson as { features?: unknown[] } | undefined)
      ?.features?.length
  ) {
    return cacheMapaMemoria.payload;
  }

  const meta = lerJsonDisco<MetaDisco>(FILE_META);
  if (metaValida(meta)) {
    const disco = lerJsonDisco<Record<string, unknown>>(FILE_MAPA);
    const nFeats =
      (disco?.geojson as { features?: unknown[] } | undefined)?.features
        ?.length ?? 0;
    if (nFeats >= 800) {
      const expiraEm = Date.parse(meta!.expira_em);
      cacheMapaMemoria = { payload: disco!, expiraEm };
      return disco;
    }
  }

  let payload = montarMapaProjecaoTodosContratos() as Record<
    string,
    unknown
  > | null;
  if (!payload) return null;

  payload = anexarPoiHectareNoMapaPayload(payload);
  try {
    payload = await anexarMalhaIbgeGerencial(payload);
  } catch (err) {
    console.warn(
      '[visao-gerencial] malha IBGE:',
      (err as Error)?.message ?? err,
    );
  }

  const expiraEm = Date.now() + CACHE_TTL_MS;
  cacheMapaMemoria = { payload, expiraEm };
  escreverJsonDisco(FILE_MAPA, payload);

  const nFeatures =
    (payload.geojson as { features?: unknown[] } | undefined)?.features
      ?.length ?? 0;
  const metaAtual = lerJsonDisco<MetaDisco>(FILE_META) ?? {
    atualizado_em: new Date().toISOString(),
    expira_em: new Date(expiraEm).toISOString(),
  };
  escreverJsonDisco(FILE_META, {
    ...metaAtual,
    atualizado_em: new Date().toISOString(),
    expira_em: new Date(expiraEm).toISOString(),
    n_features_malha: nFeatures,
  } satisfies MetaDisco);

  console.info(
    `[visao-gerencial] mapa gravado em disco (${nFeatures} features) → ${FILE_MAPA}`,
  );

  return payload;
}

/**
 * Tenta responder endpoint gerencial só com pré-cache (disco/memória).
 * Retorna o JSON a enviar, ou null para cair no Nest.
 */
export async function tentarResponderVisaoGerencialLocal(
  endpoint: string,
): Promise<unknown | null> {
  const dados = carregarOverviewFixo();
  if (!dados) return null;

  switch (endpoint) {
    case 'escopo':
      return montarEscopoTodosContratos();

    case 'overview': {
      try {
        const { aplicarHistoricoConsolidado } = await import(
          './historico-casos-consolidado'
        );
        const { enriquecerPacoteComOniNoaa } = await import(
          './enriquecer-oni-live'
        );
        let out = aplicarHistoricoConsolidado(dados);
        out = await enriquecerPacoteComOniNoaa(out);
        const oniMap = new Map(
          (out.oni_mensal ?? []).map(
            (o: { ano: number; mes: number; oni: number }) => [
              `${o.ano}-${o.mes}`,
              o.oni,
            ],
          ),
        );
        if (oniMap.size && Array.isArray(out.df_serie)) {
          out = {
            ...out,
            df_serie: out.df_serie.map((r: Record<string, unknown>) => {
              const k = `${Number(r.Ano)}-${Number(r.MesNum)}`;
              const oni = oniMap.get(k);
              return oni != null ? { ...r, ONI: oni } : r;
            }),
            df_serie_ponderada: Array.isArray(out.df_serie_ponderada)
              ? out.df_serie_ponderada.map((r: Record<string, unknown>) => {
                  const k = `${Number(r.Ano)}-${Number(r.MesNum)}`;
                  const oni = oniMap.get(k);
                  return oni != null ? { ...r, ONI: oni } : r;
                })
              : out.df_serie_ponderada,
          };
        }
        const { aplicarHistoricoAnualNoPacote } = await import(
          './historico-anual'
        );
        return aplicarHistoricoAnualNoPacote(out);
      } catch {
        return dados;
      }
    }

    case 'kpis':
      return { kpis: montarKpis(dados) };

    case 'serie-consorcio': {
      let base = dados;
      try {
        const { aplicarHistoricoConsolidado } = await import(
          './historico-casos-consolidado'
        );
        const { enriquecerPacoteComOniNoaa } = await import(
          './enriquecer-oni-live'
        );
        const { aplicarHistoricoAnualNoPacote } = await import(
          './historico-anual'
        );
        base = aplicarHistoricoAnualNoPacote(
          await enriquecerPacoteComOniNoaa(aplicarHistoricoConsolidado(dados)),
        );
      } catch {
        base = dados;
      }
      return montarSerieConsorcio(
        base,
        'Todos os contratos · Minas Gerais',
        Array.isArray(base.municipios) ? base.municipios.length : 0,
      );
    }

    case 'serie':
      return {
        serie: dados.df_serie_ponderada ?? dados.df_serie ?? [],
        modo: 'ponderada',
      };

    case 'municipios': {
      const ranking = dados.mapa_df ?? dados.df_municipios ?? [];
      return {
        municipios: dados.municipios_ibge ?? dados.municipios ?? [],
        ranking,
        escopo: {
          tipo: 'global',
          rotulo: 'Todos os contratos · Minas Gerais',
          podeTrocar: true,
          podeAgregar: true,
          isGlobal: true,
        },
      };
    }

    case 'alertas':
      return {
        geocode: 'todos',
        alertas:
          (dados.alertas_por_geocode as { todos?: unknown[] } | undefined)
            ?.todos ??
          dados.alertas ??
          [],
      };

    case 'comparativo':
      return (
        dados.elnino ?? {
          mensal:
            (dados.elnino as { comparativo_mensal?: unknown[] } | undefined)
              ?.comparativo_mensal ?? [],
        }
      );

    case 'correlacoes':
      return { correlacoes: dados.correlacoes ?? [] };

    case 'mapa-projecao':
      return montarMapaGerencialComMalha();

    case 'malha-mg': {
      const mapa = await montarMapaGerencialComMalha();
      return (mapa?.geojson as object | undefined) ?? null;
    }

    case 'cache-status': {
      const meta = lerJsonDisco<MetaDisco>(FILE_META);
      return {
        runtimeDirRelativo: `${RUNTIME_DIR_RELATIVO}/visao_gerencial`,
        meta,
        overview_em_disco: fs.existsSync(FILE_OVERVIEW),
        mapa_em_disco: fs.existsSync(FILE_MAPA),
        overview_memoria: Boolean(cacheOverviewMemoria),
        mapa_memoria: Boolean(cacheMapaMemoria),
      };
    }

    default:
      return null;
  }
}

/**
 * Warm-up: materializa overview + mapa em disco (1ª request / boot).
 * Single-flight + no-op se meta/disco já válidos (evita write → Fast Refresh).
 */
export function aquecerCacheVisaoGerencial(): void {
  if (typeof process === 'undefined') return;

  if (cacheDiscoPronto()) {
    if (
      !cacheOverviewMemoria ||
      cacheOverviewMemoria.expiraEm <= Date.now()
    ) {
      // hidrata memória sem regravar disco
      carregarOverviewFixo();
    }
    return;
  }

  if (warmUpEmAndamento != null) return;

  warmUpEmAndamento = Promise.resolve()
    .then(async () => {
      if (cacheDiscoPronto()) return;
      carregarOverviewFixo();
      await montarMapaGerencialComMalha();
      console.info(
        `[visao-gerencial] pré-cache pronto → ${RUNTIME_DIR_RELATIVO}/visao_gerencial`,
      );
    })
    .catch((err) => {
      console.warn(
        '[visao-gerencial] warm-up falhou:',
        (err as Error)?.message ?? err,
      );
    })
    .finally(() => {
      warmUpEmAndamento = null;
    });
}
