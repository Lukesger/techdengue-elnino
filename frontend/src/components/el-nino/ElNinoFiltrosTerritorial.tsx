import React, { useState, useEffect, useMemo, useId } from 'react';
import Link from 'next/link';
import { ElNinoEscopo } from '@/services/el-nino-api';
import { ANO_INICIO_PADRAO, anoFimDados } from '@/utils/el-nino/constants';
import {
  buildMapaProjecaoHref,
  MapaProjecaoQuery,
} from '@/utils/el-nino/mapa-projecao-href';
import { FaFilter, FaMap, FaCalendarAlt } from 'react-icons/fa';

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
  /**
   * Quando true, une legenda de casos projetados + botão do mapa
   * no mesmo card dos filtros (dashboard analytics).
   */
  mesclarHeader?: boolean;
  /** Subtítulo dinâmico (ex.: "2020–2026 (7 anos) · Contagem"). */
  subtitulo?: string | null;
  /** Destino do botão "Mapa projeção". */
  mapaQuery?: MapaProjecaoQuery;
}

/**
 * Barra de filtros El Niño — escopo territorial + período + (opcional) legenda/mapa.
 * Mudanças locais só entram em vigor ao clicar "Aplicar".
 */
export const ElNinoFiltrosTerritorial: React.FC<Props> = ({
  escopo,
  consorcios = [],
  urs = [],
  valor,
  onAplicar,
  loading: _loading,
  cobertura,
  mesclarHeader = false,
  subtitulo: _subtitulo,
  mapaQuery,
}) => {
  const formId = useId();
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
  const isEscopoMunicipioUnico =
    tipoEscopo === 'municipio' || geocodesEscopo.length === 1;
  const podeEscolherConsorcio =
    !isEscopoMunicipioUnico && consorcios.length > 0;
  const podeEscolherUrs = isGlobal && urs.length > 0;
  const podeEscolherMunicipio = !isEscopoMunicipioUnico;
  const consorcioUnicoId =
    !isGlobal && consorcios.length === 1 ? consorcios[0].id : null;

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

  const nomeMunicipioSelecionado = useMemo(() => {
    if (valor.geocode == null) return null;
    const gc = Number(valor.geocode);
    const noEscopo = escopo?.municipios?.find((m) => Number(m.geocode) === gc);
    if (noEscopo?.nome) return noEscopo.nome;
    for (const c of consorcios) {
      const hit = c.municipios?.find((m) => Number(m.geocode) === gc);
      if (hit?.nome) return hit.nome;
    }
    return null;
  }, [valor.geocode, escopo?.municipios, consorcios]);

  const hrefMapa = buildMapaProjecaoHref(mapaQuery);
  const periodoAplicado = `${valor.anoInicio}–${valor.anoFim}`;

  if (!escopo) {
    return (
      <div
        className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm animate-pulse"
        aria-busy="true"
        aria-label="Carregando filtros"
      >
        <div className="flex flex-wrap gap-3">
          <div className="h-10 bg-slate-100 rounded-lg w-40" />
          <div className="h-10 bg-slate-100 rounded-lg w-40" />
          <div className="h-10 bg-slate-100 rounded-lg w-28" />
          <div className="h-10 bg-slate-100 rounded-lg w-28" />
          <div className="h-10 bg-slate-100 rounded-lg w-32 ml-auto" />
        </div>
      </div>
    );
  }

  const aplicar = () => {
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
    <section
      aria-labelledby={`${formId}-titulo`}
      className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden"
    >
      {/* Cabeçalho enxuto */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0087a8]/10 text-[#0087a8]"
          aria-hidden
        >
          <FaFilter className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <h2
            id={`${formId}-titulo`}
            className="text-sm font-semibold text-slate-800 leading-tight"
          >
            Recorte dos dados
          </h2>
          <p className="text-xs text-slate-500 truncate">
            Ajuste o escopo e o período — os gráficos abaixo acompanham o recorte aplicado
          </p>
        </div>
      </div>

      {/* Controles + chips do recorte ativo */}
      <div className="p-4 space-y-3">
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          {/* Linha 1: recorte aplicado */}
          <div
            className="flex flex-wrap items-center gap-2"
            aria-label="Recorte atualmente aplicado"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mr-1">
              Aplicado
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#0087a8]/10 border border-[#0087a8]/15 px-2.5 py-1 text-xs font-semibold text-[#006d8a]">
              {rotuloBadge || 'Escopo'}
            </span>
            {nomeMunicipioSelecionado &&
              nomeMunicipioSelecionado.toLowerCase() !==
                (rotuloBadge || '').toLowerCase() && (
                <span className="inline-flex items-center rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {nomeMunicipioSelecionado}
                </span>
              )}
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 tabular-nums">
              <FaCalendarAlt className="w-3 h-3 text-[#0087a8]" aria-hidden />
              {periodoAplicado}
            </span>
            {dirty && (
              <span
                className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1"
                role="status"
              >
                Alterações pendentes
              </span>
            )}
          </div>

          {/* Linha 2: editores + CTA */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-end gap-3 flex-1 min-w-0">
              {podeEscolherConsorcio && (
                <Campo label="Consórcio" htmlFor={`${formId}-consorcio`}>
                  <select
                    id={`${formId}-consorcio`}
                    className={`${selectCls}${
                      !isGlobal && consorcios.length === 1
                        ? ' opacity-80 cursor-not-allowed'
                        : ''
                    }`}
                    value={
                      local.consorcioId ??
                      consorcioUnicoId ??
                      (isGlobal ? '' : consorcios[0]?.id ?? '')
                    }
                    disabled={!isGlobal && consorcios.length === 1}
                    onChange={(e) =>
                      setLocal((s) => ({
                        ...s,
                        consorcioId: e.target.value
                          ? Number(e.target.value)
                          : null,
                        ursId: null,
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
                <Campo label="URS" htmlFor={`${formId}-urs`}>
                  <select
                    id={`${formId}-urs`}
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
                <Campo label="Município" htmlFor={`${formId}-municipio`}>
                  <select
                    id={`${formId}-municipio`}
                    className={selectCls}
                    value={local.geocode ?? ''}
                    onChange={(e) =>
                      setLocal((s) => ({
                        ...s,
                        geocode: e.target.value
                          ? Number(e.target.value)
                          : null,
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

              <fieldset className="min-w-0">
                <legend className="text-xs font-medium text-slate-500 mb-1">
                  Período
                </legend>
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
                  <label className="sr-only" htmlFor={`${formId}-ano-ini`}>
                    Ano início
                  </label>
                  <select
                    id={`${formId}-ano-ini`}
                    className={selectInlineCls}
                    value={local.anoInicio}
                    onChange={(e) =>
                      setLocal((s) => ({
                        ...s,
                        anoInicio: Number(e.target.value),
                      }))
                    }
                  >
                    {anosDisponiveis.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <span
                    className="text-xs text-slate-400 font-medium"
                    aria-hidden
                  >
                    até
                  </span>
                  <label className="sr-only" htmlFor={`${formId}-ano-fim`}>
                    Ano fim
                  </label>
                  <select
                    id={`${formId}-ano-fim`}
                    className={selectInlineCls}
                    value={local.anoFim}
                    onChange={(e) =>
                      setLocal((s) => ({
                        ...s,
                        anoFim: Number(e.target.value),
                      }))
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
                </div>
              </fieldset>
            </div>

            <button
              type="button"
              onClick={aplicar}
              disabled={!dirty}
              aria-disabled={!dirty}
              className={`inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0087a8]/40 focus-visible:ring-offset-2 shrink-0 ${
                dirty
                  ? 'bg-[#0087a8] text-white hover:bg-[#006d8a] shadow-sm'
                  : 'bg-slate-200/80 text-slate-400 cursor-not-allowed'
              }`}
            >
              Aplicar filtros
            </button>
          </div>
        </div>

        {cobertura && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            {cobertura}
          </p>
        )}
      </div>

      {/* Legenda de projeção + CTA mapa */}
      {mesclarHeader && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-3 bg-slate-50/90 border-t border-slate-100">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-1.5">
              Legenda — casos projetados
            </p>
            <div className="flex flex-col gap-2 max-w-xl">
              <div
                className="h-2.5 w-full rounded-full bg-gradient-to-r from-cyan-300 via-orange-500 to-red-800"
                role="img"
                aria-label="Escala de menos a mais casos projetados, até crítico acima de 500"
              />
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-slate-600">
                <span>Menos casos</span>
                <span>Mais casos (mês)</span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-800" />
                  Crítico ≥500
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
                  El Niño (ONI ≥ +0,5)
                </span>
              </div>
            </div>
          </div>

          <Link
            href={hrefMapa}
            className="inline-flex items-center justify-center gap-2 self-start sm:self-center px-3.5 py-2 rounded-xl text-sm font-semibold text-[#0087a8] bg-white border border-[#0087a8]/25 hover:bg-[#0087a8]/5 hover:border-[#0087a8]/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0087a8]/40 focus-visible:ring-offset-2"
          >
            <FaMap className="w-3.5 h-3.5" aria-hidden />
            Abrir mapa de projeção
          </Link>
        </div>
      )}
    </section>
  );
};

const selectCls =
  'text-sm border border-slate-200 rounded-xl px-3 py-2.5 bg-white text-slate-800 focus:ring-2 focus:ring-[#0087a8]/25 focus:border-[#0087a8] outline-none min-w-[148px] max-w-full';

const selectInlineCls =
  'text-sm border-0 bg-transparent text-slate-800 font-medium tabular-nums focus:ring-0 outline-none py-1 pr-1 cursor-pointer';

const Campo: React.FC<{
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, children }) => (
  <div className="flex flex-col gap-1 min-w-0">
    <label htmlFor={htmlFor} className="text-xs font-medium text-slate-500">
      {label}
    </label>
    {children}
  </div>
);

export default ElNinoFiltrosTerritorial;
