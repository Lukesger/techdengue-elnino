import React, { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { motion } from 'framer-motion';
import { MainLayout } from '@/components/layout/MainLayout';
import { BreadcrumbHeader } from '@/components/layout/BreadcrumbHeader';
import { useAuth } from '@/hooks/useAuth';
import { getRedirectRouteByProfile } from '@/utils/getRedirectRouteByProfile';

import elNinoApi, {
  ElNinoEscopo,
  SerieConsorcioResponse,
} from '@/services/el-nino-api';
import { ElNinoHeaderLegenda } from '@/components/el-nino/ElNinoHeaderLegenda';
import { ElNinoGuiaTabs } from '@/components/el-nino/ElNinoGuiaTabs';
import { ElNinoGuiaGraficoMunicipal } from '@/components/el-nino/ElNinoGuiaGraficoMunicipal';
import { ElNinoGuiaBannerOni } from '@/components/el-nino/ElNinoGuiaBannerOni';
import { ElNinoGuiaKpisMunicipal } from '@/components/el-nino/ElNinoGuiaKpisMunicipal';

/**
 * Página /el-nino-analytics/guia — equivalente ao Visu_unico.html do
 * DASH.COMPLETO. Layout em duas colunas: à esquerda, gráfico municipal
 * (casos + temp + ONI + projeção); à direita, painel didático com 4 tabs.
 */
export default function ElNinoGuiaPage() {
  const { user } = useAuth();
  const [escopo, setEscopo] = useState<ElNinoEscopo | null>(null);
  const [serie, setSerie] = useState<SerieConsorcioResponse | null>(null);
  const [nivelAlerta, setNivelAlerta] = useState<number | null>(null);
  const [geocode, setGeocode] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const inicioPagina = getRedirectRouteByProfile(user);

  const municipios = useMemo(() => escopo?.municipios ?? [], [escopo]);
  const municipioAtual = useMemo(
    () => (geocode ? municipios.find((m) => m.geocode === geocode) : null),
    [geocode, municipios],
  );

  // Escopo inicial
  useEffect(() => {
    elNinoApi
      .getEscopo()
      .then((r) => {
        setEscopo(r);
        if (r.municipios.length === 1) setGeocode(r.municipios[0].geocode);
      })
      .catch((err) => setErro(err?.message ?? 'Erro ao carregar escopo'));
  }, []);

  // Série + nível Infodengue quando o município muda
  useEffect(() => {
    if (!escopo) return;
    setLoading(true);
    const params = geocode ? { geocode } : undefined;
    Promise.allSettled([
      elNinoApi.getSerieConsorcio(params),
      elNinoApi.getAlertas(params),
    ])
      .then(([serieResp, alertasResp]) => {
        if (serieResp.status === 'fulfilled') {
          setSerie(serieResp.value);
        } else {
          setErro(
            (serieResp.reason as any)?.message ?? 'Erro ao carregar série',
          );
        }
        if (alertasResp.status === 'fulfilled') {
          // Maior nível de alerta entre dengue/inmet/elnino para esse município
          const todos = alertasResp.value.alertas ?? [];
          const niveis = todos
            .map((a) =>
              a.nivel === 'alto' ? 4 : a.nivel === 'medio' ? 2 : 1,
            )
            .filter((n) => n > 0);
          setNivelAlerta(niveis.length ? Math.max(...niveis) : null);
        } else {
          setNivelAlerta(null);
        }
      })
      .finally(() => setLoading(false));
  }, [escopo, geocode]);

  return (
    <>
      <Head>
        <title>Guia 2026 — El Niño Analytics — TechDengue</title>
      </Head>
      <MainLayout>
        <BreadcrumbHeader
          items={[
            { label: 'Principal', href: inicioPagina },
            { label: 'El Niño Analytics', href: '/el-nino-analytics' },
            { label: 'Guia 2026' },
          ]}
        />

        <div className="p-3 sm:p-5 lg:p-6 pt-20 space-y-4 max-w-7xl mx-auto">
          {erro && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              {erro}
            </div>
          )}

          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <ElNinoHeaderLegenda
              subtitulo="Guia visual e didático das séries, fontes e fórmula da projeção"
            />
          </motion.div>

          {/* Filtro de município (somente esse — o filtro é local da página) */}
          {municipios.length > 1 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.05 }}
              className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3"
            >
              <label
                htmlFor="guia-municipio"
                className="text-xs font-medium text-gray-500"
              >
                Município
              </label>
              <select
                id="guia-municipio"
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-[#0087a8]/25 focus:border-[#0087a8] outline-none flex-1 max-w-xs"
                value={geocode ?? ''}
                onChange={(e) =>
                  setGeocode(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Agregado ({municipios.length})</option>
                {[...municipios]
                  .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
                  .map((m) => (
                    <option key={m.geocode} value={m.geocode}>
                      {m.nome}
                    </option>
                  ))}
              </select>

              {municipioAtual && (
                <span className="text-xs text-gray-400">
                  Pop. estimada:{' '}
                  {municipioAtual.populacao.toLocaleString('pt-BR')} hab.
                </span>
              )}
            </motion.div>
          )}

          {/* Banner ONI atual */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.08 }}
          >
            <ElNinoGuiaBannerOni serie={serie} />
          </motion.div>

          {/* 4 KPIs municipais */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.09 }}
          >
            <ElNinoGuiaKpisMunicipal
              municipio={municipioAtual ?? null}
              serie={serie}
              nivelAlerta={nivelAlerta}
            />
          </motion.div>

          {/* Layout 2 colunas: gráfico à esquerda, painel didático à direita */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 lg:grid-cols-5 gap-4"
          >
            <div className="lg:col-span-3">
              <ElNinoGuiaGraficoMunicipal
                data={serie}
                loading={loading}
                rotuloMunicipio={
                  municipioAtual?.nome ?? serie?.rotulo_conjunto
                }
              />
            </div>
            <aside className="lg:col-span-2">
              <ElNinoGuiaTabs />
            </aside>
          </motion.div>

          {/* Bloco de fórmula em destaque */}
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="bg-gradient-to-br from-[#0087a8]/5 to-orange-50/40 rounded-xl border border-[#0087a8]/20 p-5"
          >
            <h2 className="text-sm font-semibold text-[#0087a8] mb-2 uppercase tracking-wide">
              Fórmula da projeção
            </h2>
            <p className="text-base font-mono text-gray-800 bg-white rounded-lg border border-gray-200 px-4 py-3 mb-3 overflow-x-auto">
              casos_proj = min(base × f_sazonal × f_elnino, população × 15%)
            </p>
            <p className="text-xs text-gray-600 leading-relaxed">
              <span className="font-semibold">base:</span> último mês com casos
              {' > '}0 (fonte Infodengue) ·{' '}
              <span className="font-semibold">f_sazonal:</span> média histórica
              do mês alvo ÷ média geral ·{' '}
              <span className="font-semibold">f_elnino:</span> 1,0 (neutro),
              1,3 (moderado), 1,8 (forte) · <span className="font-semibold">
                teto epidemiológico:
              </span>{' '}
              15% da população municipal · <span className="font-semibold">
                faixa de incerteza:
              </span>{' '}
              −30% / +35%
            </p>
          </motion.section>
        </div>
      </MainLayout>
    </>
  );
}
