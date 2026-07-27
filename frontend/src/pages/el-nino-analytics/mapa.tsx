import React, { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { MainLayout } from '@/components/layout/MainLayout';
import { BreadcrumbHeader } from '@/components/layout/BreadcrumbHeader';
import { useAuth } from '@/hooks/useAuth';
import { getRedirectRouteByProfile } from '@/utils/getRedirectRouteByProfile';

import elNinoApi, { MapaProjecaoResponse } from '@/services/el-nino-api';
import { ElNinoHeaderLegenda } from '@/components/el-nino/ElNinoHeaderLegenda';
import { ElNinoMapaBannerElNino } from '@/components/el-nino/ElNinoMapaBannerElNino';
import { ElNinoMapaKpisTopo } from '@/components/el-nino/ElNinoMapaKpisTopo';
import { parseMapaProjecaoQuery } from '@/utils/el-nino/mapa-projecao-href';
import { carregarGeometriasVerbaDireta } from '@/utils/el-nino/carregar-geometrias-verba-direta';
import {
  deveExibirProjecaoBairros,
  isContratoVerbaDireta,
  isGeocodeVerbaDireta,
  type BairroMapaFeature,
} from '@/utils/el-nino/projecao-bairros';
import { type AreaIdentificavel, hectaresDeGeometria } from '@/utils/el-nino/unir-bairros';
import { baixarArquivo, bairrosParaKml } from '@/utils/el-nino/geojson-to-kml';

interface ConsorcioRef {
  id: number;
  eConsorcio?: number;
  municipios: Array<{ geocode: number; nome: string }>;
}

/** Mapbox GL não roda no SSR — carrega só no cliente. */
const ElNinoMapaChoropleth = dynamic(
  () =>
    import('@/components/el-nino/ElNinoMapaChoropleth').then(
      (m) => m.ElNinoMapaChoropleth,
    ),
  { ssr: false, loading: () => (
    <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-1/3 mb-4" />
      <div className="h-96 bg-gray-100 rounded" />
    </div>
  ) },
);

/**
 * Página /el-nino-analytics/mapa — mapa choropleth Mapbox GL (único motor de mapa).
 * Painel lateral, KPIs topo e banner El Niño.
 */
export default function ElNinoMapaPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<MapaProjecaoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mesNum, setMesNum] = useState<number | null>(null);
  const [geocodeFocado, setGeocodeFocado] = useState<number | null>(null);
  const [consorcios, setConsorcios] = useState<ConsorcioRef[]>([]);
  const [bairros, setBairros] = useState<BairroMapaFeature[] | null>(null);
  const [bairrosModo, setBairrosModo] = useState<
    'areas_mapeadas' | 'envoltoria_pois' | 'indisponivel' | null
  >(null);
  const [bairrosLoading, setBairrosLoading] = useState(false);
  const [bairrosErro, setBairrosErro] = useState<string | null>(null);
  const [bairrosAviso, setBairrosAviso] = useState<string | null>(null);
  const [areasIdentificacao, setAreasIdentificacao] = useState<
    AreaIdentificavel[] | null
  >(null);
  const [resumoBairrosApi, setResumoBairrosApi] = useState<{
    totalHa: number;
    totalHaBruto?: number;
    totalPois?: number;
    metodo?: string;
    fonte?: string;
  } | null>(null);
  const [contagemPoligonos, setContagemPoligonos] = useState<{
    brutos: number;
    unificados: number;
  } | null>(null);

  const { contratoId, geocode } = useMemo(
    () => parseMapaProjecaoQuery(router.query),
    [router.query],
  );

  const inicioPagina = getRedirectRouteByProfile(user);

  useEffect(() => {
    let cancelado = false;
    elNinoApi
      .getConsorcios()
      .then((resp) => {
        if (!cancelado) setConsorcios(resp?.consorcios ?? []);
      })
      .catch(() => {
        if (!cancelado) setConsorcios([]);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const ehVerbaDireta = useMemo(() => {
    if (
      deveExibirProjecaoBairros(
        geocode ?? null,
        contratoId ?? null,
        consorcios,
      )
    ) {
      return true;
    }
    // Contrato de verba direta na URL, mesmo sem geocode ainda.
    if (isContratoVerbaDireta(contratoId ?? null, consorcios)) return true;
    // Sidebar /mapa sem query: 1 município de verba direta no payload.
    if (data?.municipios?.length === 1) {
      const gc = Number(data.municipios[0].geocode);
      if (isGeocodeVerbaDireta(gc, consorcios)) return true;
    }
    // Escopo municipal: único contrato acessível é verba direta (ex.: Contagem).
    if (
      consorcios.length === 1 &&
      Number(consorcios[0]?.eConsorcio) === 0 &&
      (data == null || data.municipios.length <= 1)
    ) {
      return true;
    }
    return false;
  }, [geocode, contratoId, consorcios, data]);

  /** Geocode do município de verba direta (filtro, único mun do payload ou do contrato). */
  const geocodeBairro = useMemo(() => {
    if (!ehVerbaDireta) return null;
    if (geocode != null) return geocode;
    if (data?.municipios?.length === 1) return Number(data.municipios[0].geocode);
    if (contratoId != null) {
      const c = consorcios.find((x) => x.id === contratoId);
      if (c?.municipios?.length === 1) return Number(c.municipios[0].geocode);
    }
    if (consorcios.length === 1 && consorcios[0]?.municipios?.length === 1) {
      return Number(consorcios[0].municipios[0].geocode);
    }
    return null;
  }, [ehVerbaDireta, geocode, data, contratoId, consorcios]);

  useEffect(() => {
    if (!router.isReady) return;

    if (geocode != null) {
      setGeocodeFocado(geocode);
    }

    let cancelado = false;
    setLoading(true);
    setErro(null);

    elNinoApi
      .getMapaProjecao({
        contratoId: contratoId ?? undefined,
        geocode: geocode ?? undefined,
      })
      .then((resp) => {
        if (cancelado) return;
        setData(resp);
        const primeiro = resp.meses[0]?.mesNum ?? null;
        if (primeiro != null) setMesNum(primeiro);
      })
      .catch((err) => {
        if (cancelado) return;
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ??
          (err as Error)?.message ??
          'Erro ao carregar mapa de projeção';
        setErro(msg);
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [router.isReady, contratoId, geocode]);

  useEffect(() => {
    if (!ehVerbaDireta || geocodeBairro == null || !data) {
      setBairros(null);
      setBairrosModo(null);
      setBairrosErro(null);
      setBairrosAviso(null);
      setAreasIdentificacao(null);
      setResumoBairrosApi(null);
      setContagemPoligonos(null);
      return;
    }

    const mun =
      data.municipios.find((m) => Number(m.geocode) === geocodeBairro) ??
      (data.municipios.length === 1 ? data.municipios[0] : null);
    if (!mun) {
      setBairros(null);
      setBairrosModo(null);
      setBairrosErro('Município não encontrado nos dados de projeção do mapa.');
      setBairrosAviso(null);
      setResumoBairrosApi(null);
      setContagemPoligonos(null);
      return;
    }

    let cancelado = false;
    setBairrosLoading(true);
    setBairrosErro(null);
    setBairrosAviso(null);

    carregarGeometriasVerbaDireta({
      geocode: geocodeBairro,
      contratoId,
      mun,
      onBairrosProntos: (parcial) => {
        if (cancelado) return;
        setBairros(parcial.bairros);
        setBairrosModo(parcial.modo);
        setAreasIdentificacao(parcial.areasIdentificacao);
        setContagemPoligonos(parcial.contagemPoligonos);
        setBairrosLoading(false);
      },
    })
      .then((resultado) => {
        if (cancelado) return;
        setBairros(resultado.bairros);
        setBairrosModo(resultado.modo);
        setAreasIdentificacao(resultado.areasIdentificacao);
        setResumoBairrosApi(resultado.resumoBairrosApi);
        setContagemPoligonos(resultado.contagemPoligonos);
        setBairrosAviso(resultado.avisoFallback ?? null);
        setBairrosErro(null);
      })
      .catch((err) => {
        if (cancelado) return;
        setBairros(null);
        setBairrosModo(null);
        setAreasIdentificacao(null);
        setResumoBairrosApi(null);
        setContagemPoligonos(null);
        setBairrosAviso(null);
        const msg =
          (err as { response?: { data?: { message?: string; error?: string } } })
            ?.response?.data?.message ??
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ??
          (err as Error)?.message ??
          'Erro ao carregar geometrias das áreas mapeadas.';
        setBairrosErro(
          msg === 'fetch failed'
            ? 'Não foi possível conectar ao servidor de geometrias. Verifique se o backend está acessível e tente novamente.'
            : msg.includes('403') || msg.toLowerCase().includes('permiss')
              ? 'Sem permissão area-mapeada:read para exportar geometrias. Solicite acesso ou use um perfil com essa permissão.'
              : msg,
        );
      })
      .finally(() => {
        if (!cancelado) setBairrosLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [ehVerbaDireta, geocodeBairro, data, contratoId]);

  const subtitulo = useMemo(() => {
    if (!data) return null;
    return `${data.municipios.length} municípios · projeção ${data.meses[0]?.label} – ${data.meses[data.meses.length - 1]?.label}`;
  }, [data]);

  const exportarKmlUnificados = () => {
    if (!bairros?.length) return;
    const n = contagemPoligonos?.unificados ?? bairros.length;
    const prefixo = geocodeBairro != null ? String(geocodeBairro) : 'areas';
    const kml = bairrosParaKml(
      bairros.map((b) => ({
        nome: b.nome,
        hectaresUnicos: b.hectaresUnicos,
        geometry: b.geometry,
        descricaoExtra: b.criterioAtribuicao,
      })),
      `${prefixo}-${n}-areas-unificadas`,
    );
    baixarArquivo(
      kml,
      `${prefixo}-${n}-unificados.kml`,
      'application/vnd.google-earth.kml+xml',
    );
  };

  const resumoBairros = useMemo(() => {
    if (resumoBairrosApi) return resumoBairrosApi;
    if (!bairros?.length) return null;
    const totalHa = bairros.reduce(
      (sum, bairro) =>
        sum + (hectaresDeGeometria(bairro.geometry) || Number(bairro.hectaresUnicos) || 0),
      0,
    );
    const metodo = bairros.find((bairro) => bairro.metodoAtribuicao)?.metodoAtribuicao;
    const fonte = bairros.find((bairro) => bairro.fonteGeom)?.fonteGeom;
    return { totalHa, metodo, fonte };
  }, [resumoBairrosApi, bairros]);

  return (
    <>
      <Head>
        <title>Mapa de Projeção — El Niño Analytics — TechDengue</title>
      </Head>
      <MainLayout>
        <BreadcrumbHeader
          items={[
            { label: 'Principal', href: inicioPagina },
            { label: 'El Niño Analytics', href: '/el-nino-analytics' },
            { label: 'Mapa de Projeção' },
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
              subtitulo={subtitulo}
              mapaQuery={{ contratoId, geocode }}
              voltarGerencial
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.05 }}
          >
            <ElNinoMapaBannerElNino data={data} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <ElNinoMapaKpisTopo
              data={data}
              geocodeSelecionado={geocodeFocado}
              mesNumSelecionado={mesNum}
              hectaresAreaMapeada={
                resumoBairros && ehVerbaDireta
                  ? {
                      totalBruto:
                        resumoBairros.totalHaBruto ?? resumoBairros.totalHa,
                      unificadas: resumoBairros.totalHa,
                      totalPois: resumoBairros.totalPois ?? null,
                    }
                  : null
              }
            />
          </motion.div>

          {bairrosAviso && ehVerbaDireta && !bairrosErro && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 text-sm text-sky-900">
              <p className="font-semibold mb-1">Modo alternativo de geometrias</p>
              <p>{bairrosAviso}</p>
            </div>
          )}

          {bairrosErro && ehVerbaDireta && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <p className="font-semibold mb-1">Áreas mapeadas indisponíveis</p>
              <p>{bairrosErro}</p>
              <p className="text-xs text-amber-700 mt-2">
                O mapa abaixo exibe apenas o limite municipal até as geometrias
                por bairro serem carregadas.
              </p>
            </div>
          )}

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
          >
            <ElNinoMapaChoropleth
              data={data}
              loading={loading}
              bairrosLoading={bairrosLoading}
              mesNumSelecionado={mesNum}
              onMesMudou={setMesNum}
              onMunicipioFocado={setGeocodeFocado}
              geocodeFocado={geocodeFocado}
              contratoId={contratoId ?? data?._contrato_id ?? null}
              bairros={bairros}
              bairrosModo={bairrosModo}
              ehVerbaDireta={ehVerbaDireta}
              bairrosFallbackAtivo={ehVerbaDireta && !bairros?.length && !bairrosLoading}
              areasIdentificacao={areasIdentificacao}
              onBaixarKml={
                ehVerbaDireta && bairros?.length && !bairrosErro
                  ? exportarKmlUnificados
                  : undefined
              }
              poligonosUnificadosKml={
                contagemPoligonos?.unificados ?? bairros?.length ?? undefined
              }
            />
          </motion.div>

        </div>
      </MainLayout>
    </>
  );
}
