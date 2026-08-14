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
  type BairroMapaFeature,
} from '@/utils/el-nino/projecao-bairros';
import {
  type AreaIdentificavel,
  hectaresDeGeometria,
  unirGeometriasBairro,
} from '@/utils/el-nino/unir-bairros';
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
  const [escopo, setEscopo] = useState<{
    isGlobal: boolean;
    geocodes: number[];
  } | null>(null);
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

  const { contratoId, geocode, visao } = useMemo(
    () => parseMapaProjecaoQuery(router.query),
    [router.query],
  );

  /**
   * Visão gerencial só com escopo global.
   * /mapa sem query (sidebar): município usa geocode/contrato do JWT (evita 403).
   */
  const modoGerencialTodos =
    Boolean(escopo?.isGlobal) &&
    (visao === 'todos' || (contratoId == null && geocode == null));

  const geocodeEfetivo = useMemo(() => {
    if (geocode != null) return geocode;
    if (modoGerencialTodos) return null;
    if (escopo?.geocodes?.length === 1) return escopo.geocodes[0]!;
    return null;
  }, [geocode, modoGerencialTodos, escopo]);

  const contratoIdEfetivo = useMemo(() => {
    if (contratoId != null) return contratoId;
    if (modoGerencialTodos) return null;
    if (consorcios.length === 1) return consorcios[0]!.id;
    return null;
  }, [contratoId, modoGerencialTodos, consorcios]);

  const inicioPagina = getRedirectRouteByProfile(user);

  useEffect(() => {
    let cancelado = false;
    Promise.all([
      elNinoApi.getEscopo().catch(() => null),
      elNinoApi.getConsorcios().catch(() => null),
    ]).then(([esc, cons]) => {
      if (cancelado) return;
      if (esc) {
        setEscopo({
          isGlobal: Boolean(esc.isGlobal),
          geocodes: Array.isArray(esc.geocodes)
            ? esc.geocodes
                .map(Number)
                .filter((n) => Number.isFinite(n) && n > 0)
            : [],
        });
      } else {
        setEscopo({ isGlobal: false, geocodes: [] });
      }
      setConsorcios(cons?.consorcios ?? []);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  /**
   * Carrega polígonos de area_mapeadas (GIS) com município em foco.
   * Inclui verba direta e municípios de consórcio (ex.: São Francisco de Paula).
   */
  const deveCarregarAreasMapeadas = useMemo(() => {
    if (
      deveExibirProjecaoBairros(
        geocodeEfetivo ?? null,
        contratoIdEfetivo ?? null,
        consorcios,
      )
    ) {
      return true;
    }
    // Contrato de verba direta na URL, mesmo sem geocode ainda.
    if (isContratoVerbaDireta(contratoIdEfetivo ?? null, consorcios)) return true;
    // Um único município no payload / escopo municipal.
    if (data?.municipios?.length === 1) {
      const gc = Number(data.municipios[0].geocode);
      if (Number.isFinite(gc) && gc > 0) return true;
    }
    if (
      consorcios.length === 1 &&
      (data == null || data.municipios.length <= 1) &&
      (Number(consorcios[0]?.eConsorcio) === 0 ||
        consorcios[0]?.municipios?.length === 1 ||
        escopo?.geocodes?.length === 1)
    ) {
      return true;
    }
    return false;
  }, [
    geocodeEfetivo,
    contratoIdEfetivo,
    consorcios,
    data,
    escopo?.geocodes?.length,
  ]);

  /** Alias legado: UI/KML usam o mesmo gate das áreas mapeadas. */
  const ehVerbaDireta = deveCarregarAreasMapeadas;

  /** Geocode do município em foco para plotar area_mapeadas. */
  const geocodeBairro = useMemo(() => {
    if (!deveCarregarAreasMapeadas) return null;
    if (geocodeEfetivo != null) return geocodeEfetivo;
    if (data?.municipios?.length === 1) return Number(data.municipios[0].geocode);
    if (contratoIdEfetivo != null) {
      const c = consorcios.find((x) => x.id === contratoIdEfetivo);
      if (c?.municipios?.length === 1) return Number(c.municipios[0].geocode);
    }
    if (consorcios.length === 1 && consorcios[0]?.municipios?.length === 1) {
      return Number(consorcios[0].municipios[0].geocode);
    }
    if (escopo?.geocodes?.length === 1) return escopo.geocodes[0]!;
    return null;
  }, [
    deveCarregarAreasMapeadas,
    geocodeEfetivo,
    data,
    contratoIdEfetivo,
    consorcios,
    escopo?.geocodes,
  ]);

  useEffect(() => {
    if (!router.isReady || escopo == null) return;

    // Munícipio sem filtro na URL: espera geocode/contrato do JWT antes de chamar a API.
    if (
      !modoGerencialTodos &&
      contratoIdEfetivo == null &&
      geocodeEfetivo == null
    ) {
      return;
    }

    if (geocodeEfetivo != null) {
      setGeocodeFocado(geocodeEfetivo);
    }

    let cancelado = false;
    setLoading(true);
    setErro(null);

    elNinoApi
      .getMapaProjecao(
        modoGerencialTodos
          ? { visao: 'todos' }
          : {
              contratoId: contratoIdEfetivo ?? undefined,
              geocode: geocodeEfetivo ?? undefined,
            },
      )
      .then((resp) => {
        if (cancelado) return;
        setData(resp);
        const primeiro = resp.meses[0]?.mesNum ?? null;
        if (primeiro != null) setMesNum(primeiro);
      })
      .catch((err) => {
        if (cancelado) return;
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        const msg =
          (err as { response?: { data?: { error?: string; message?: string } } })
            ?.response?.data?.error ??
          (err as { response?: { data?: { message?: string } } })?.response
            ?.data?.message ??
          (err as Error)?.message ??
          'Erro ao carregar mapa de projeção';
        setErro(
          status === 403
            ? 'Sem permissão para este escopo territorial. Abra o mapa pelo seu município/contrato.'
            : msg,
        );
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [
    router.isReady,
    escopo,
    escopo?.isGlobal,
    escopo?.geocodes?.length,
    contratoIdEfetivo,
    geocodeEfetivo,
    modoGerencialTodos,
  ]);

  useEffect(() => {
    if (!deveCarregarAreasMapeadas || geocodeBairro == null || !data) {
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
      contratoId: contratoIdEfetivo,
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
            : msg.includes('analytics:elnino:read')
              ? 'Sem permissão para o mapa El Niño (analytics:elnino:read).'
              : msg,
        );
      })
      .finally(() => {
        if (!cancelado) setBairrosLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [deveCarregarAreasMapeadas, geocodeBairro, data, contratoIdEfetivo]);

  const subtitulo = useMemo(() => {
    if (!data) return null;
    return `${data.municipios.length} municípios · projeção ${data.meses[0]?.label} – ${data.meses[data.meses.length - 1]?.label}`;
  }, [data]);

  const exportarKmlUnificados = () => {
    if (!bairros?.length) return;
    const prefixo = geocodeBairro != null ? String(geocodeBairro) : 'areas';
    const nBrutos = contagemPoligonos?.brutos ?? bairros.length;

    // Força 1 placemark: une todas as áreas (ex.: Uberlândia 93 → 1 MultiPolygon/Polygon).
    const geometriaUnida = unirGeometriasBairro(bairros.map((b) => b.geometry));
    const featuresKml = geometriaUnida
      ? [
          {
            nome: 'Área mapeada unificada',
            hectaresUnicos:
              hectaresDeGeometria(geometriaUnida) ||
              bairros.reduce(
                (sum, b) =>
                  sum +
                  (hectaresDeGeometria(b.geometry) ||
                    Number(b.hectaresUnicos) ||
                    0),
                0,
              ),
            geometry: geometriaUnida,
            descricaoExtra: `${nBrutos} áreas brutas unificadas em 1 geometria`,
          },
        ]
      : bairros.map((b) => ({
          nome: b.nome,
          hectaresUnicos: b.hectaresUnicos,
          geometry: b.geometry,
          descricaoExtra: b.criterioAtribuicao,
        }));

    const nExport = featuresKml.length;
    const kml = bairrosParaKml(
      featuresKml,
      `${prefixo}-${nExport}-area-unificada`,
    );
    baixarArquivo(
      kml,
      `${prefixo}-${nExport}-unificado.kml`,
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

  /** Mesma fonte para KPI Densidade e insight "Neste mês" (PostGIS > API). */
  const hectaresAreaMapeada = useMemo(() => {
    if (!resumoBairros || !ehVerbaDireta) return null;
    const munFoco =
      data?.municipios?.find(
        (m) => Number(m.geocode) === Number(geocodeFocado),
      ) ??
      (data?.municipios?.length === 1 ? data.municipios[0] : null);
    const poisStore = Number(munFoco?.poi_hectare?.total_registros);
    const haStore = Number(munFoco?.poi_hectare?.hectares_mapeados);
    const totalPoisApi = Number(resumoBairros.totalPois);
    const totalHa = Number(resumoBairros.totalHa) || 0;
    const brutoApi = Number(resumoBairros.totalHaBruto);
    // Não usar hectares_mapeados da API se estiver inflado vs unificado
    // (sobreposição de polígonos — ex.: 27.600 vs ~3.660 unificados).
    const haStoreConfiavel =
      Number.isFinite(haStore) &&
      haStore > 0 &&
      (totalHa <= 0 || haStore <= totalHa * 1.5);
    let totalBruto =
      (Number.isFinite(brutoApi) && brutoApi > 0 ? brutoApi : 0) ||
      (haStoreConfiavel ? haStore : 0) ||
      totalHa;
    if (
      totalHa > 0 &&
      Math.abs(totalBruto - totalHa) < 1e-6 &&
      haStoreConfiavel &&
      Math.abs(haStore - totalHa) >= 1e-2
    ) {
      totalBruto = haStore;
    }
    return {
      totalBruto,
      unificadas: totalHa,
      totalPois:
        totalPoisApi > 0
          ? totalPoisApi
          : Number.isFinite(poisStore) && poisStore > 0
            ? poisStore
            : resumoBairros.totalPois ?? null,
    };
  }, [resumoBairros, ehVerbaDireta, data?.municipios, geocodeFocado]);

  return (
    <>
      <Head>
        <title>Mapa de Projeção — El Niño Analytics — TechDengue</title>
      </Head>
      <MainLayout>
        <BreadcrumbHeader
          items={[
            { label: 'Principal', href: inicioPagina },
            {
              label: 'El Niño Analytics',
              href:
                contratoIdEfetivo != null || geocodeEfetivo != null
                  ? `/el-nino-analytics?${new URLSearchParams({
                      ...(contratoIdEfetivo != null
                        ? { contratoId: String(contratoIdEfetivo) }
                        : {}),
                      ...(geocodeEfetivo != null
                        ? { geocode: String(geocodeEfetivo) }
                        : {}),
                    }).toString()}`
                  : '/el-nino-analytics',
            },
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
              mapaQuery={{
                contratoId: contratoIdEfetivo,
                geocode: geocodeEfetivo,
                ...(modoGerencialTodos ? { visao: 'todos' as const } : {}),
              }}
              voltarGerencial
              esconderLegendaCores
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
              hectaresAreaMapeada={hectaresAreaMapeada}
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

          <div>
            <ElNinoMapaChoropleth
              data={data}
              loading={loading}
              bairrosLoading={bairrosLoading}
              mesNumSelecionado={mesNum}
              onMesMudou={setMesNum}
              onMunicipioFocado={setGeocodeFocado}
              geocodeFocado={geocodeFocado}
              contratoId={contratoIdEfetivo ?? data?._contrato_id ?? null}
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
                bairros?.length ? 1 : undefined
              }
              visaoGerencial={modoGerencialTodos}
              hectaresAreaMapeada={hectaresAreaMapeada}
            />
          </div>

        </div>
      </MainLayout>
    </>
  );
}
