/**
 * Suite KPI El Niño (último mês casos + temperatura por consórcio/URS).
 *
 * Rodar: node scripts/test-el-nino-kpis.js
 */
const path = require('node:path');
const { registrarLoaderTs, criarSuite } = require('./el-nino-kpi-test-harness');

registrarLoaderTs();
const { assert, teste, finalizar } = criarSuite();

const {
  montarKpis,
  rotuloCasosUltimoMesLive,
} = require(path.join(__dirname, '../src/utils/el-nino/montar-kpis.ts'));
const {
  fingerprintMesConsolidadoCasos,
  anexarCasosUltimoMesLive,
  mesEhPreliminar,
  ultimoMesSnapshotDePacote,
} = require(path.join(
  __dirname,
  '../src/utils/el-nino/enriquecer-casos-ultimo-mes-live.ts',
));
const {
  ID_GRUPO_VERBA_DIRETA,
  agruparContratosParaTemp,
  aplicarTempGrupoNoKpi,
  escolherAmostrasUrs,
  formatarKpiTempGrupo,
  mediaTempUrs,
} = require(path.join(__dirname, '../src/utils/el-nino/temperatura-urs.ts'));

const snapshot = {
  municipios: [{ geocode: 3106200 }, { geocode: 3140001 }],
  df_serie: [
    { Ano: 2026, MesNum: 5, Mes: 'Mai', CasosDengue: 8000 },
    { Ano: 2026, MesNum: 6, Mes: 'Jun', CasosDengue: 6115 },
  ],
};

function kpiUltimo(kpis) {
  return kpis.find((k) => k.titulo === 'Ultimo Mes Casos');
}

function kpiMedios(kpis) {
  return kpis.find((k) => k.titulo === 'Casos Medios/Mes');
}

function kpiTemp(kpis) {
  return kpis.find((k) => /temperatura/i.test(k.titulo));
}

console.log('Último Mês Casos — Infodengue live vs snapshot');

teste('sem live: card usa jun/2026 do snapshot', () => {
  const kpis = montarKpis(snapshot);
  const card = kpiUltimo(kpis);
  assert(card, 'card Último Mês Casos ausente');
  assert(card.valor === '6115', `valor esperado 6115, veio ${card.valor}`);
  assert(
    card.subtitulo === 'Jun/2026',
    `subtítulo esperado Jun/2026, veio ${card.subtitulo}`,
  );
});

teste('live substitui valor e mês do snapshot', () => {
  const dados = anexarCasosUltimoMesLive(snapshot, {
    ano: 2026,
    mes: 7,
    casos: 7200,
    n_municipios: 627,
    atualizado_em: '2026-08-18T00:00:00.000Z',
    preliminar: false,
    fonte: 'Infodengue AlertCity',
  });
  const kpis = montarKpis(dados);
  const card = kpiUltimo(kpis);
  assert(card.valor === '7200', `valor live esperado 7200, veio ${card.valor}`);
  assert(
    card.subtitulo === 'Jul/2026',
    `subtítulo live esperado Jul/2026, veio ${card.subtitulo}`,
  );
});

teste('live preliminar aparece no subtítulo', () => {
  const rotulo = rotuloCasosUltimoMesLive({
    ano: 2026,
    mes: 8,
    casos: 100,
    preliminar: true,
  });
  assert(
    rotulo === 'Ago/2026 · preliminar',
    `rótulo esperado preliminar, veio ${rotulo}`,
  );
});

teste('Casos Medios/Mes não muda com live', () => {
  const sem = kpiMedios(montarKpis(snapshot)).valor;
  const com = kpiMedios(
    montarKpis(
      anexarCasosUltimoMesLive(snapshot, {
        ano: 2026,
        mes: 7,
        casos: 99999,
        n_municipios: 627,
        atualizado_em: '',
        preliminar: false,
        fonte: 'test',
      }),
    ),
  ).valor;
  assert(sem === com, `média mudou: ${sem} → ${com}`);
});

teste('live inválido cai no snapshot', () => {
  const kpis = montarKpis({
    ...snapshot,
    casos_ultimo_mes_live: { ano: 2026, mes: 99, casos: 1 },
  });
  const card = kpiUltimo(kpis);
  assert(card.valor === '6115', `deveria cair no snapshot, veio ${card.valor}`);
});

teste('geocode municipal ignora live gerencial', () => {
  const dados = {
    ...snapshot,
    municipios: [{ geocode: 3106200, municipio: 'Belo Horizonte' }],
    df_mensal_mun: [
      {
        geocode: 3106200,
        Ano: 2026,
        MesNum: 6,
        Mes: 'Jun',
        CasosDengue: 400,
        casos_notificados: 400,
      },
    ],
    casos_ultimo_mes_live: {
      ano: 2026,
      mes: 7,
      casos: 7200,
      preliminar: false,
    },
  };
  const kpis = montarKpis(dados, 3106200);
  const card = kpiUltimo(kpis);
  assert(
    card.valor === '400',
    `municipal deveria usar série local, veio ${card.valor}`,
  );
});

teste('fingerprint pega o último mês com volume > 0', () => {
  const fp = fingerprintMesConsolidadoCasos([
    { Ano: 2026, MesNum: 6, CasosDengue: 10 },
    { Ano: 2026, MesNum: 7, CasosDengue: 0, casos_notificados: 0 },
    { Ano: 2026, MesNum: 7, CasosDengue: 3 },
  ]);
  assert(fp?.ano === 2026 && fp?.mes === 7, `fp=${JSON.stringify(fp)}`);
});

teste('snapshot do pacote aponta Jun/2026', () => {
  const fp = ultimoMesSnapshotDePacote(snapshot);
  assert(fp?.ano === 2026 && fp?.mes === 6, `fp=${JSON.stringify(fp)}`);
});

teste('mês preliminar só no calendário atual', () => {
  const agora = new Date(2026, 7, 18);
  assert(mesEhPreliminar(2026, 8, agora) === true, 'agosto/2026 deveria ser preliminar');
  assert(mesEhPreliminar(2026, 7, agora) === false, 'julho/2026 não é preliminar em ago');
});

console.log('\nTemperatura KPI — consórcios vs snapshot');

teste('agrupa VD num bucket e mantém consórcios separados', () => {
  const grupos = agruparContratosParaTemp([
    {
      id: 19,
      nome: 'CISMEP',
      eConsorcio: 1,
      municipios: [{ geocode: 3106200, nome: 'BH' }],
    },
    {
      id: 42,
      nome: 'Cachoeira Dourada',
      eConsorcio: 0,
      municipios: [{ geocode: 3111804, nome: 'Cachoeira Dourada' }],
    },
    {
      id: 43,
      nome: 'Outro VD',
      eConsorcio: 0,
      municipios: [{ geocode: 3100104, nome: 'Abadia' }],
    },
  ]);
  const ids = new Set(grupos.map((g) => g.id));
  assert(ids.has(19), 'CISMEP deveria aparecer');
  assert(ids.has(ID_GRUPO_VERBA_DIRETA), 'bucket VD ausente');
  assert(!ids.has(42) && !ids.has(43), 'VD não deve aparecer como contrato');
  const vd = grupos.find((g) => g.id === ID_GRUPO_VERBA_DIRETA);
  assert(vd.nome === 'Verba direta', `nome VD=${vd.nome}`);
  assert(vd.municipios.length === 2, `VD deveria ter 2 mun., veio ${vd.municipios.length}`);
});

teste('filtro contratoId não agrupa VD', () => {
  const grupos = agruparContratosParaTemp(
    [
      { id: 42, nome: 'Cachoeira Dourada', eConsorcio: 0, municipios: [{ geocode: 1 }] },
      { id: 19, nome: 'CISMEP', eConsorcio: 1, municipios: [{ geocode: 2 }] },
    ],
    { contratoId: 42 },
  );
  assert(grupos.length === 1, `esperado 1 grupo, veio ${grupos.length}`);
  assert(grupos[0].id === 42, `id=${grupos[0].id}`);
  assert(grupos[0].nome === 'Cachoeira Dourada', grupos[0].nome);
});

teste('amostra no máximo 3 geocodes por grupo', () => {
  const grupos = agruparContratosParaTemp([
    {
      id: 19,
      nome: 'CISMEP',
      eConsorcio: 1,
      municipios: [1, 2, 3, 4, 5].map((g) => ({ geocode: g, lat: -19, lon: -43 })),
    },
  ]);
  const amostras = escolherAmostrasUrs(grupos, { maxPorUrs: 3 });
  assert(amostras.length === 1, `n amostras=${amostras.length}`);
  assert(amostras[0].geocodes.length === 3, `n geos=${amostras[0].geocodes.length}`);
});

teste('sem geocode o KPI não usa nome de município do clima isolado', () => {
  const kpis = montarKpis({
    municipios: [{ geocode: 3111804, municipio: 'Cachoeira Dourada' }],
    clima: {
      cidade: 'Cachoeira Dourada',
      atual: { temperatura_c: 22.2 },
    },
    df_mensal_mun: [
      { Ano: 2026, MesNum: 6, Mes: 'Jun', Temperatura: 21, geocode: 1 },
      { Ano: 2026, MesNum: 6, Mes: 'Jun', Temperatura: 23, geocode: 2 },
    ],
    df_serie: [{ Ano: 2026, MesNum: 6, Mes: 'Jun', CasosDengue: 10, Temperatura: 22.2 }],
  });
  const card = kpiTemp(kpis);
  assert(card, 'card temperatura ausente');
  assert(
    !/cachoeira/i.test(card.subtitulo),
    `não deveria citar município: ${card.subtitulo}`,
  );
});

teste('live do consórcio substitui a média 472', () => {
  const base = [
    {
      titulo: 'Temperatura atual',
      valor: '20 °C',
      subtitulo: 'Média de 472 municípios · clima atual',
    },
  ];
  const live = mediaTempUrs(
    { id: 19, nome: 'CISMEP', geocodes: [3106200, 3118601] },
    {
      3106200: { atual: { temperatura_c: 24 } },
      3118601: { atual: { temperatura_c: 22 } },
    },
  );
  assert(live?.temperatura_c === 23, `média=${live?.temperatura_c}`);
  const kpis = aplicarTempGrupoNoKpi(base, live);
  assert(kpis[0].valor === '23 °C', `valor=${kpis[0].valor}`);
  assert(
    kpis[0].subtitulo === 'CISMEP · clima atual',
    `sub=${kpis[0].subtitulo}`,
  );
});

teste('rótulo Verba direta no KPI', () => {
  const fmt = formatarKpiTempGrupo({
    id: ID_GRUPO_VERBA_DIRETA,
    nome: 'Verba direta',
    temperatura_c: 21.5,
    n: 3,
  });
  assert(fmt.valor === '21,5 °C', fmt.valor);
  assert(fmt.subtitulo === 'Verba direta · clima atual', fmt.subtitulo);
});

finalizar();
