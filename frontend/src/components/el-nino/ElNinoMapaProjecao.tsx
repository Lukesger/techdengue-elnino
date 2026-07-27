import React, { useEffect, useState, useMemo } from 'react';
import {
  MapaProjecaoResponse,
  ProjecaoMunicipio,
} from '@/services/el-nino-api';
import { deveExibirProjecaoBairros } from '@/utils/el-nino/projecao-bairros';
import { ElNinoGuiaGrafico } from './ElNinoGuiaGrafico';

interface ConsorcioRef {
  id: number;
  nome?: string;
  eConsorcio?: number;
  municipios: Array<{ geocode: number; nome?: string }>;
}

interface Props {
  data: MapaProjecaoResponse | null;
  loading?: boolean;
  geocodeFiltro?: number | null;
  consorcioId?: number | null;
  consorcios?: ConsorcioRef[];
  /** Dados de casos confirmados (ranking) — usado no painel unificado do consórcio. */
  municipioCasos?: {
    nome?: string;
    municipio?: string;
    casos_notificados?: number;
    casos_estimados?: number;
    intensidade?: number;
  } | null;
}

function getClassificacao(valor: number): string {
  if (valor >= 500) return 'Crítico';
  if (valor >= 200) return 'Alto';
  if (valor >= 100) return 'Médio';
  return 'Baixo';
}

function corPorValor(valor: number): string {
  if (valor >= 500) return '#f87171';
  if (valor >= 200) return '#fb923c';
  if (valor >= 100) return '#d97706';
  return '#4ade80';
}

function projecoesMun(mun: ProjecaoMunicipio) {
  return mun.projecoes ?? [];
}

/** Visão compacta: projeção Jul–Dez de um único município (verba direta). */
function ProjecaoMunicipalSucinta({
  mun,
  data,
}: {
  mun: ProjecaoMunicipio;
  data: MapaProjecaoResponse;
}) {
  const projecoes = mun.projecoes ?? [];
  const mesRef = data.meses?.[0];
  const populacao = Number(mun.populacao) || 0;

  const totalSemestre = projecoes.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const pico =
    projecoes.length > 0
      ? projecoes.reduce((best, p) =>
          (Number(p.valor) || 0) > (Number(best.valor) || 0) ? p : best,
        )
      : null;

  if (!projecoes.length) {
    return (
      <p className="text-xs text-amber-600 py-4 text-center">
        Projeção mensal indisponível para este município.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {mesRef && (
          <>
            <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
              El Niño: {mesRef.descricao ?? '—'}
            </span>
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              Fator ×{mesRef.fElnino ?? '—'}
            </span>
            {mesRef.oni != null && Number.isFinite(Number(mesRef.oni)) && (
              <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                ONI {Number(mesRef.oni).toFixed(2)}
                {mesRef.oniProjetado ? ' (proj.)' : ''}
              </span>
            )}
          </>
        )}
        <span className="text-gray-500">
          {populacao > 0 ? `Pop. ${populacao.toLocaleString('pt-BR')}` : null}
          {mun.nivel_alerta != null ? ` · Alerta nível ${mun.nivel_alerta}` : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {projecoes.map((p) => {
          const valor = Number(p.valor) || 0;
          const cor = corPorValor(valor);
          const mesLabel = p.label?.split('/')[0] ?? `Mês ${p.mesNum}`;
          return (
            <div
              key={p.mesNum}
              className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2"
            >
              <p className="text-[10px] uppercase tracking-wide text-gray-400">
                {mesLabel}
              </p>
              <p className="text-lg font-semibold text-gray-800 tabular-nums">
                {valor.toLocaleString('pt-BR')}
              </p>
              <p className="text-[10px] text-gray-500 flex items-center gap-1">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: cor }}
                />
                {getClassificacao(valor)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-gray-600 border-t border-gray-100 pt-2">
        <span>
          <strong className="text-gray-800">Total Jul–Dez:</strong>{' '}
          {totalSemestre.toLocaleString('pt-BR')} casos
        </span>
        {pico && (
          <span>
            <strong className="text-gray-800">Pico:</strong>{' '}
            {pico.label ?? ''} ({(Number(pico.valor) || 0).toLocaleString('pt-BR')})
          </span>
        )}
        {mun.clima &&
          mun.clima.temperatura_c != null &&
          mun.clima.umidade_pct != null && (
          <span className="text-gray-500">
            Clima: {mun.clima.temperatura_c}°C · {mun.clima.umidade_pct}% UR
          </span>
        )}
      </div>
    </div>
  );
}

interface PainelMunConsorcioProps {
  mun: ProjecaoMunicipio;
  data: MapaProjecaoResponse;
  casosConfirmados: number;
  rotuloConsorcio?: string | null;
}

/** Visão unificada: casos confirmados + projeção Jul–Dez (município filtrado). */
function PainelMunicipioUnificado({
  mun,
  data,
  casosConfirmados,
  rotuloConsorcio,
}: PainelMunConsorcioProps) {
  return (
    <div className="relative bg-white rounded-xl border border-gray-100 p-4 sm:p-5">
      <ElNinoGuiaGrafico chave="mapa-projecao" contexto={rotuloConsorcio} />
      <header className="mb-4 pr-10">
        <p className="text-xs font-medium uppercase tracking-wide text-[#0087a8]">
          Visão municipal
        </p>
        <h3 className="text-base sm:text-lg font-semibold text-gray-800 mt-0.5 leading-snug">
          {mun.nome}
        </h3>
        <p className="text-xs text-gray-400 mt-1">
          Casos confirmados e projeção epidemiológica Jul–Dez/{data.ano_projecao}
          {rotuloConsorcio ? ` · ${rotuloConsorcio}` : ''}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className="rounded-xl bg-gradient-to-br from-red-50 to-orange-50 border border-red-100/80 px-4 py-3.5">
            <p className="text-xs text-red-700/80 font-medium mb-1">Casos confirmados</p>
            <p className="text-3xl sm:text-4xl font-bold text-red-700 tabular-nums tracking-tight">
              {casosConfirmados.toLocaleString('pt-BR')}
            </p>
            <p className="text-xs text-red-600/70 mt-1.5">
              Acumulado histórico · notificados (Infodengue)
            </p>
          </div>
        </div>

        <div className="lg:col-span-3 border-t lg:border-t-0 lg:border-l border-gray-100 pt-4 lg:pt-0 lg:pl-4">
          <p className="text-xs font-medium text-gray-500 mb-2">
            Projeção epidemiológica · El Niño + sazonalidade
          </p>
          <ProjecaoMunicipalSucinta mun={mun} data={data} />
        </div>
      </div>
    </div>
  );
}

export const ElNinoMapaProjecao: React.FC<Props> = ({
  data,
  loading,
  geocodeFiltro = null,
  consorcioId = null,
  consorcios = [],
  municipioCasos = null,
}) => {
  const [mesSelecionado, setMesSelecionado] = useState<number | null>(null);
  const [munSelecionado, setMunSelecionado] = useState<ProjecaoMunicipio | null>(null);

  useEffect(() => {
    if (data?.meses?.length && mesSelecionado === null) {
      setMesSelecionado(data.meses[0].mesNum);
    }
  }, [data, mesSelecionado]);

  const modoVerbaDireta = useMemo(
    () => deveExibirProjecaoBairros(geocodeFiltro, consorcioId, consorcios),
    [geocodeFiltro, consorcioId, consorcios],
  );

  const modoMunicipioConsorcio = Boolean(
    geocodeFiltro != null && !modoVerbaDireta,
  );

  const rotuloConsorcio = useMemo(() => {
    if (consorcioId != null) {
      return consorcios.find((c) => c.id === consorcioId)?.nome ?? data?.rotulo_conjunto ?? null;
    }
    return data?.rotulo_conjunto ?? null;
  }, [consorcioId, consorcios, data?.rotulo_conjunto]);

  const munFiltro = useMemo(() => {
    if (!data || geocodeFiltro == null) return null;
    const mun =
      data.municipios.find((m) => Number(m.geocode) === Number(geocodeFiltro)) ??
      null;
    if (mun) return mun;
    if (modoVerbaDireta && data.municipios.length === 1) return data.municipios[0];
    return null;
  }, [data, geocodeFiltro, modoVerbaDireta]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        <div className="h-48 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!data && modoVerbaDireta) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-amber-600 text-sm">
        Carregando projeção do município…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-gray-400 text-sm">
        Dados de projeção do mapa não disponíveis.
      </div>
    );
  }

  if (modoVerbaDireta && !munFiltro) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-amber-600 text-sm">
        Selecione o município de verba direta no filtro e clique em Aplicar filtros.
      </div>
    );
  }

  if ((modoVerbaDireta || modoMunicipioConsorcio) && munFiltro) {
    const rotulo =
      rotuloConsorcio ?? data.rotulo_conjunto ?? munFiltro.nome;
    return (
      <PainelMunicipioUnificado
        mun={munFiltro}
        data={data}
        casosConfirmados={municipioCasos?.casos_notificados ?? 0}
        rotuloConsorcio={rotulo}
      />
    );
  }

  /** Um único município no escopo: painel com projeção mês a mês (não ranking tabular). */
  if (data.municipios.length === 1) {
    const munUnico = data.municipios[0];
    return (
      <PainelMunicipioUnificado
        mun={munUnico}
        data={data}
        casosConfirmados={
          municipioCasos?.casos_notificados ?? 0
        }
        rotuloConsorcio={rotuloConsorcio ?? data.rotulo_conjunto ?? munUnico.nome}
      />
    );
  }

  if (modoMunicipioConsorcio && !munFiltro) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-amber-600 text-sm">
        Projeção indisponível para o município selecionado.
      </div>
    );
  }

  const mesAtual = data.meses.find((m) => m.mesNum === mesSelecionado) ?? data.meses[0];

  const getCorMunicipio = (mun: ProjecaoMunicipio): string => {
    const proj = projecoesMun(mun).find((p) => p.mesNum === mesSelecionado);
    return corPorValor(proj?.valor ?? 0);
  };

  const municipiosOrdenados = [...data.municipios].sort((a, b) => {
    const projA =
      projecoesMun(a).find((p) => p.mesNum === mesSelecionado)?.valor ?? 0;
    const projB =
      projecoesMun(b).find((p) => p.mesNum === mesSelecionado)?.valor ?? 0;
    return projB - projA;
  });

  return (
    <div className="relative bg-white rounded-xl border border-gray-100 p-4">
      <ElNinoGuiaGrafico chave="mapa-projecao" contexto={data.rotulo_conjunto} />
      <div className="flex items-center justify-between mb-3 pr-12">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            Mapa de Projeção Epidemiológica {data.ano_projecao}
          </h3>
          <p className="text-xs text-gray-400">{data.rotulo_conjunto}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Mês:</label>
          <select
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:ring-1 focus:ring-[#0087a8]"
            value={mesSelecionado ?? ''}
            onChange={(e) => setMesSelecionado(Number(e.target.value))}
          >
            {data.meses.map((m) => (
              <option key={m.mesNum} value={m.mesNum}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {mesAtual && (
        <div className="mb-3 flex items-center gap-2 text-xs flex-wrap">
          <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
            El Niño: {mesAtual.descricao}
          </span>
          <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
            Fator: ×{mesAtual.fElnino}
          </span>
          {mesAtual.oni != null && (
            <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              ONI: {mesAtual.oni.toFixed(2)}
              {mesAtual.oniProjetado ? ' (proj.)' : ''}
            </span>
          )}
        </div>
      )}

      <div className="flex gap-4">
        <div className="flex-1 overflow-auto max-h-72">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="text-left px-2 py-1.5 text-gray-500 font-medium">Município</th>
                <th className="text-right px-2 py-1.5 text-gray-500 font-medium">Casos proj.</th>
                <th className="text-right px-2 py-1.5 text-gray-500 font-medium">Faixa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {municipiosOrdenados.map((mun) => {
                const proj = projecoesMun(mun).find(
                  (p) => p.mesNum === mesSelecionado,
                );
                const valor = proj?.valor ?? 0;
                const cor = getCorMunicipio(mun);
                return (
                  <tr
                    key={mun.geocode}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => setMunSelecionado(mun === munSelecionado ? null : mun)}
                  >
                    <td className="px-2 py-1.5 text-gray-700 font-medium">{mun.nome}</td>
                    <td className="px-2 py-1.5 text-right text-gray-600">
                      {valor.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-1"
                        style={{ backgroundColor: cor }}
                      />
                      {getClassificacao(valor)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {munSelecionado && (
          <div className="w-48 flex-shrink-0 bg-gray-50 rounded-lg p-3 text-xs">
            <p className="font-semibold text-gray-800 mb-2">{munSelecionado.nome}</p>
            <p className="text-gray-500">
              Pop.: {(Number(munSelecionado.populacao) || 0).toLocaleString('pt-BR')}
            </p>
            <p className="text-gray-500 mt-1">Alerta: nível {munSelecionado.nivel_alerta}</p>
            {munSelecionado.clima && (
              <p className="text-gray-500 mt-1">
                {munSelecionado.clima.temperatura_c}°C · {munSelecionado.clima.umidade_pct}% UR
              </p>
            )}
            <div className="mt-2 space-y-1">
              {projecoesMun(munSelecionado).map((p) => (
                <div
                  key={p.mesNum}
                  className={`flex justify-between ${
                    p.mesNum === mesSelecionado
                      ? 'font-semibold text-orange-600'
                      : 'text-gray-400'
                  }`}
                >
                  <span>{p.label.split('/')[0]}</span>
                  <span>{p.valor.toLocaleString('pt-BR')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
        {[
          { cor: '#4ade80', label: '< 100' },
          { cor: '#d97706', label: '100–199' },
          { cor: '#fb923c', label: '200–499' },
          { cor: '#f87171', label: '≥ 500' },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-3 rounded"
              style={{ backgroundColor: item.cor }}
            />
            {item.label} casos
          </span>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-1">Fórmula: {data.formula?.expressao}</p>
    </div>
  );
};

export default ElNinoMapaProjecao;
