import React, { useState, useEffect, useMemo } from 'react';
import { ElNinoEscopo } from '@/services/el-nino-api';
import { ANO_INICIO_PADRAO, anoFimDados } from '@/utils/el-nino/constants';
import { FaFilter } from 'react-icons/fa';

interface ConsorcioOpcao {
  id: number;
  nome: string;
  n_municipios: number;
  eConsorcio?: number;
  tipo_financiamento?: string;
  municipios: Array<{ geocode: number; nome: string }>;
}

interface UrsOpcao {
  id: number;
  nome: string;
  n_municipios: number;
  municipios: Array<{ geocode: number; nome: string }>;
}

export interface FiltrosElNino {
  consorcioId: number | null;
  ursId: number | null;
  geocode: number | null;
  geocodes: number[] | null;
  anoInicio: number;
  anoFim: number;
}

interface Props {
  escopo: ElNinoEscopo | null;
  consorcios?: ConsorcioOpcao[];
  urs?: UrsOpcao[];
  /** Filtros iniciais e atuais — controlado externamente pela página. */
  valor: FiltrosElNino;
  onAplicar: (filtros: FiltrosElNino) => void;
  loading?: boolean;
  /** Aviso opcional de cobertura. Ex: "16/22 municípios com série disponível". */
  cobertura?: string | null;
}

/**
 * Componente de filtros para El Niño Analytics — equivalente ao
 * `<section class="filtro-global">` do `index.html` do DASH.COMPLETO.
 *
 * Comportamento:
 *   - **Usuário global** (Aero/SES/admin): Consórcio (com "Todos — visão gerencial") + URS + Município + Período
 *   - **Usuário URS / Consórcio (vários municípios):** Consórcio do escopo + Município + Período
 *   - **Usuário com 1 município (IBGE):** apenas Período (consórcio/município fixos no escopo)
 *
 * Mudanças locais só são aplicadas ao clicar "Aplicar filtros".
 */
export const ElNinoFiltrosTerritorial: React.FC<Props> = ({
  escopo,
  consorcios = [],
  urs = [],
  valor,
  onAplicar,
  loading: _loading,
  cobertura,
}) => {
  const [local, setLocal] = useState<FiltrosElNino>(valor);

  useEffect(() => {
    setLocal(valor);
  }, [valor]);

  const isGlobal = escopo?.isGlobal ?? false;
  const tipoEscopo = escopo?.tipo ?? '';
  const geocodesEscopo = useMemo(
    () =>
      (escopo?.geocodes ?? [])
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0),
    [escopo?.geocodes],
  );
  /** Um único IBGE no escopo → só filtros temporais. */
  const isEscopoMunicipioUnico =
    tipoEscopo === 'municipio' || geocodesEscopo.length === 1;
  /** Só global pode abrir visão agregada de todos os contratos. */
  const podeEscolherConsorcio =
    !isEscopoMunicipioUnico && consorcios.length > 0;
  const podeEscolherUrs = isGlobal && urs.length > 0;
  const podeEscolherMunicipio = !isEscopoMunicipioUnico;
  const consorcioUnicoId =
    !isGlobal && consorcios.length === 1 ? consorcios[0].id : null;

  /** Não-global: nunca fica em "Todos"; assume o contrato do escopo. */
  useEffect(() => {
    if (isGlobal || !consorcios.length) return;
    if (local.consorcioId != null) {
      const aindaValido = consorcios.some((c) => c.id === local.consorcioId);
      if (aindaValido) return;
    }
    const preferido =
      consorcioUnicoId ??
      (local.geocode != null
        ? consorcios.find((c) =>
            c.municipios?.some((m) => Number(m.geocode) === Number(local.geocode)),
          )?.id
        : null) ??
      consorcios[0]?.id ??
      null;
    if (preferido == null) return;
    setLocal((s) => ({
      ...s,
      consorcioId: preferido,
      ursId: null,
      geocode:
        isEscopoMunicipioUnico
          ? geocodesEscopo[0] ?? s.geocode
          : s.geocode,
    }));
  }, [
    isGlobal,
    consorcios,
    consorcioUnicoId,
    local.consorcioId,
    local.geocode,
    isEscopoMunicipioUnico,
    geocodesEscopo,
  ]);

  // Lista de municípios disponíveis — depende do consórcio/URS escolhido
  const municipiosDisponiveis = useMemo(() => {
    if (isEscopoMunicipioUnico) {
      return (escopo?.municipios ?? []).map((m) => ({
        geocode: m.geocode,
        nome: m.nome,
      }));
    }
    if (local.consorcioId != null) {
      const c = consorcios.find((x) => x.id === local.consorcioId);
      return c?.municipios ?? [];
    }
    if (local.ursId != null) {
      const u = urs.find((x) => x.id === local.ursId);
      return u?.municipios ?? [];
    }
    const mapa = new Map<number, { geocode: number; nome: string }>();
    for (const c of consorcios) {
      for (const m of c.municipios ?? []) {
        const gc = Number(m.geocode);
        if (!mapa.has(gc)) mapa.set(gc, { geocode: gc, nome: m.nome });
      }
    }
    if (mapa.size) {
      return [...mapa.values()].sort((a, b) =>
        a.nome.localeCompare(b.nome, 'pt-BR'),
      );
    }
    return (escopo?.municipios ?? []).map((m) => ({
      geocode: m.geocode,
      nome: m.nome,
    }));
  }, [
    isEscopoMunicipioUnico,
    local.consorcioId,
    local.ursId,
    consorcios,
    urs,
    escopo,
  ]);

  const anoAtual = new Date().getFullYear();
  const anosDisponiveis = useMemo(() => {
    const fim = anoFimDados();
    const limite = Math.min(anoAtual, fim);
    return Array.from(
      { length: limite - ANO_INICIO_PADRAO + 1 },
      (_, i) => ANO_INICIO_PADRAO + i,
    );
  }, [anoAtual]);

  const dirty = useMemo(() => {
    return (
      local.consorcioId !== valor.consorcioId ||
      local.ursId !== valor.ursId ||
      local.geocode !== valor.geocode ||
      local.anoInicio !== valor.anoInicio ||
      local.anoFim !== valor.anoFim
    );
  }, [local, valor]);

  const rotuloBadge = useMemo(() => {
    if (valor.consorcioId != null) {
      const c = consorcios.find((x) => x.id === valor.consorcioId);
      if (c?.nome) return c.nome;
    }
    if (valor.ursId != null) {
      const u = urs.find((x) => x.id === valor.ursId);
      if (u?.nome) return u.nome;
    }
    if (
      isGlobal &&
      valor.consorcioId == null &&
      valor.ursId == null &&
      valor.geocode == null
    ) {
      return 'Todos os contratos';
    }
    return escopo?.rotulo ?? '';
  }, [
    isGlobal,
    valor.consorcioId,
    valor.ursId,
    valor.geocode,
    consorcios,
    urs,
    escopo?.rotulo,
  ]);

  if (!escopo) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="flex gap-3">
          <div className="h-9 bg-gray-200 rounded w-44" />
          <div className="h-9 bg-gray-200 rounded w-44" />
          <div className="h-9 bg-gray-200 rounded w-32" />
          <div className="h-9 bg-gray-200 rounded w-32" />
        </div>
      </div>
    );
  }

  const aplicar = () => {
    // Resolve geocodes para o subset filtrado
    let geocodes: number[] | null = null;
    if (local.consorcioId != null) {
      geocodes =
        consorcios
          .find((c) => c.id === local.consorcioId)
          ?.municipios.map((m) => m.geocode) ?? null;
    } else if (local.ursId != null) {
      geocodes =
        urs
          .find((u) => u.id === local.ursId)
          ?.municipios.map((m) => m.geocode) ?? null;
    } else if (isGlobal && local.geocode == null && consorcios.length > 0) {
      // Visão gerencial: união de municípios de todos os contratos
      const mapa = new Map<number, number>();
      for (const c of consorcios) {
        for (const m of c.municipios ?? []) {
          mapa.set(Number(m.geocode), Number(m.geocode));
        }
      }
      geocodes = [...mapa.keys()];
    } else if (isEscopoMunicipioUnico && geocodesEscopo.length) {
      geocodes = [...geocodesEscopo];
    }
    onAplicar({
      ...local,
      geocode: isEscopoMunicipioUnico
        ? geocodesEscopo[0] ?? local.geocode
        : local.geocode,
      geocodes,
    });
  };

  return (
    <section className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-center gap-2 mb-3">
        <FaFilter className="w-3 h-3 text-[#0087a8]" />
        <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">
          Filtros globais
        </span>
        <span className="text-xs bg-[#0087a8]/10 text-[#0087a8] px-2.5 py-0.5 rounded-full font-medium ml-2">
          {rotuloBadge}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {podeEscolherConsorcio && (
          <Campo label="Consórcio">
            <select
              className={`${selectCls}${
                !isGlobal && consorcios.length === 1
                  ? ' opacity-80 cursor-not-allowed'
                  : ''
              }`}
              value={
                local.consorcioId ??
                consorcioUnicoId ??
                // Global em visão gerencial: manter "" (= "Todos"), nunca forçar o 1º contrato
                (isGlobal ? '' : consorcios[0]?.id ?? '')
              }
              disabled={!isGlobal && consorcios.length === 1}
              onChange={(e) =>
                setLocal((s) => ({
                  ...s,
                  consorcioId: e.target.value ? Number(e.target.value) : null,
                  ursId: null, // consórcio e URS são mutuamente exclusivos
                  geocode: null,
                }))
              }
            >
              {isGlobal && (
                <option value="">
                  Todos ({consorcios.length}) — visão gerencial
                </option>
              )}
              {consorcios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} ({c.n_municipios})
                  {Number(c.eConsorcio) === 0 ? ' · Verba direta' : ''}
                </option>
              ))}
            </select>
          </Campo>
        )}

        {podeEscolherUrs && (
          <Campo label="URS">
            <select
              className={selectCls}
              value={local.ursId ?? ''}
              onChange={(e) =>
                setLocal((s) => ({
                  ...s,
                  ursId: e.target.value ? Number(e.target.value) : null,
                  consorcioId: null,
                  geocode: null,
                }))
              }
            >
              <option value="">Todas ({urs.length})</option>
              {urs.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome} ({u.n_municipios})
                </option>
              ))}
            </select>
          </Campo>
        )}

        {podeEscolherMunicipio && (
          <Campo label="Município">
            <select
              className={selectCls}
              value={local.geocode ?? ''}
              onChange={(e) =>
                setLocal((s) => ({
                  ...s,
                  geocode: e.target.value ? Number(e.target.value) : null,
                }))
              }
              disabled={!municipiosDisponiveis.length}
            >
              <option value="">
                {municipiosDisponiveis.length
                  ? `Todos (${municipiosDisponiveis.length})`
                  : 'Selecione um escopo'}
              </option>
              {[...municipiosDisponiveis]
                .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
                .map((m) => (
                  <option key={m.geocode} value={m.geocode}>
                    {m.nome}
                  </option>
                ))}
            </select>
          </Campo>
        )}

        <Campo label="Período de">
          <select
            className={selectCls}
            value={local.anoInicio}
            onChange={(e) =>
              setLocal((s) => ({ ...s, anoInicio: Number(e.target.value) }))
            }
          >
            {anosDisponiveis.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Campo>

        <Campo label="até">
          <select
            className={selectCls}
            value={local.anoFim}
            onChange={(e) =>
              setLocal((s) => ({ ...s, anoFim: Number(e.target.value) }))
            }
          >
            {anosDisponiveis
              .filter((a) => a >= local.anoInicio)
              .map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
          </select>
        </Campo>

        <button
          type="button"
          onClick={aplicar}
          disabled={!dirty}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            dirty
              ? 'bg-[#0087a8] text-white hover:bg-[#006d8a]'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          Aplicar filtros
        </button>
      </div>

      <p className="text-xs text-gray-400 mt-2">
        {isEscopoMunicipioUnico
          ? 'O período aplica-se a todos os gráficos abaixo.'
          : 'Consórcio, município e período aplicam-se a todos os gráficos abaixo.'}
      </p>

      {cobertura && (
        <p className="text-xs text-amber-600 mt-1">⚠ {cobertura}</p>
      )}
    </section>
  );
};

const selectCls =
  'text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-[#0087a8]/25 focus:border-[#0087a8] outline-none min-w-[140px]';

const Campo: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs text-gray-500 font-medium">{label}</label>
    {children}
  </div>
);

export default ElNinoFiltrosTerritorial;
