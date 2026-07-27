import {
  carregarOniMensalNoaa,
  invalidarCacheOniNoaa,
  type OniMensalLive,
  type OniPayloadLive,
} from './noaa-oni-live';

export interface ElninoStatusBloco {
  ativo: boolean;
  oni_atual: number | null;
  periodo_atual: string | null;
  intensidade: string;
  fator_atual: number;
  fonte: string;
  oni_fonte_live?: boolean;
}

function classificarONIStatus(oni: number | null | undefined): ElninoStatusBloco {
  const v = Number(oni ?? 0);
  if (v >= 2.0) {
    return {
      ativo: true,
      oni_atual: v,
      periodo_atual: null,
      intensidade: 'El Niño muito forte',
      fator_atual: 1.8,
      fonte: 'NOAA CPC ONI',
      oni_fonte_live: true,
    };
  }
  if (v >= 1.5) {
    return {
      ativo: true,
      oni_atual: v,
      periodo_atual: null,
      intensidade: 'El Niño forte',
      fator_atual: 1.8,
      fonte: 'NOAA CPC ONI',
      oni_fonte_live: true,
    };
  }
  if (v >= 0.5) {
    return {
      ativo: true,
      oni_atual: v,
      periodo_atual: null,
      intensidade: 'El Niño moderado',
      fator_atual: 1.3,
      fonte: 'NOAA CPC ONI',
      oni_fonte_live: true,
    };
  }
  if (v <= -0.5) {
    return {
      ativo: false,
      oni_atual: v,
      periodo_atual: null,
      intensidade: 'La Niña',
      fator_atual: 0.9,
      fonte: 'NOAA CPC ONI',
      oni_fonte_live: true,
    };
  }
  return {
    ativo: false,
    oni_atual: v,
    periodo_atual: null,
    intensidade: 'Neutro',
    fator_atual: 1,
    fonte: 'NOAA CPC ONI',
    oni_fonte_live: true,
  };
}

function mergeOniMensal(
  cache: OniMensalLive[],
  live: OniMensalLive[],
): OniMensalLive[] {
  const map = new Map<string, OniMensalLive>();
  for (const r of cache) {
    map.set(`${r.ano}-${r.mes}`, { ...r });
  }
  for (const r of live) {
    map.set(`${r.ano}-${r.mes}`, { ano: r.ano, mes: r.mes, oni: r.oni });
  }
  return Array.from(map.values()).sort(
    (a, b) => a.ano - b.ano || a.mes - b.mes,
  );
}

function blocoElninoFromUltimo(
  ultimo: OniMensalLive | undefined,
  fonte: string,
): ElninoStatusBloco {
  const base = classificarONIStatus(ultimo?.oni);
  return {
    ...base,
    oni_atual: ultimo?.oni ?? null,
    periodo_atual: ultimo
      ? `${ultimo.ano}/${String(ultimo.mes).padStart(2, '0')}`
      : null,
    fonte,
  };
}

function aplicarBlocoElninoEmMapa(dados: any, bloco: ElninoStatusBloco): any {
  if (!dados?.mapa_projecao) return dados;

  if (dados.mapa_projecao.payload) {
    return {
      ...dados,
      mapa_projecao: {
        ...dados.mapa_projecao,
        payload: {
          ...dados.mapa_projecao.payload,
          elnino: { ...dados.mapa_projecao.payload.elnino, ...bloco },
        },
      },
    };
  }

  if (dados.mapa_projecao.elnino) {
    return {
      ...dados,
      mapa_projecao: {
        ...dados.mapa_projecao,
        elnino: { ...dados.mapa_projecao.elnino, ...bloco },
      },
    };
  }

  return dados;
}

/**
 * Mescla ONI NOAA ao pacote do contrato e recalcula bloco `elnino` (status ativo).
 */
export async function enriquecerPacoteComOniNoaa(
  dados: any,
  opts?: { forceRefresh?: boolean },
): Promise<any> {
  if (!dados) return dados;

  const live = await carregarOniMensalNoaa(opts?.forceRefresh);
  if (!live.linhas.length) return dados;

  const merged = mergeOniMensal(dados.oni_mensal ?? [], live.linhas);
  const ultimo = merged.at(-1);
  const bloco = blocoElninoFromUltimo(ultimo, live.fonte);

  let out = {
    ...dados,
    oni_mensal: merged,
    oni_fonte: live.fonte,
    oni_atualizado_em: live.atualizado_em,
    elnino: {
      ...(dados.elnino && typeof dados.elnino === 'object' ? dados.elnino : {}),
      ...bloco,
    },
  };

  return aplicarBlocoElninoEmMapa(out, bloco);
}

/**
 * Atualiza `elnino` em payload de mapa-projecao (arquivo estático ou fallback).
 */
export async function aplicarElninoLiveEmPayloadMapa(
  inner: any,
  opts?: { forceRefresh?: boolean },
): Promise<any> {
  if (!inner) return inner;

  const live = await carregarOniMensalNoaa(opts?.forceRefresh);
  if (!live.linhas.length) return inner;

  const ultimo = live.linhas.at(-1);
  const bloco = blocoElninoFromUltimo(ultimo, live.fonte);

  return {
    ...inner,
    elnino: { ...inner.elnino, ...bloco },
    oni_fonte: live.fonte,
    oni_atualizado_em: live.atualizado_em,
  };
}

export { invalidarCacheOniNoaa };
