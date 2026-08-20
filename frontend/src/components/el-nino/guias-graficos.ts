export type GuiaMarcador =
  | 'laranja-forte'
  | 'laranja-claro'
  | 'laranja'
  | 'azul'
  | 'verde'
  | 'vermelho'
  | 'vermelho-claro'
  | 'amarelo'
  | 'neutro';

export interface GuiaItem {
  marcador: GuiaMarcador;
  rotulo: string;
  texto: string;
}

export interface GuiaGrafico {
  titulo: string;
  itens: GuiaItem[];
}

export type GuiaChave =
  | 'mapa-projecao'
  | 'mapa-projecao-bairro'
  | 'ranking'
  | 'ranking-bairro'
  | 'alertas'
  | 'consorcio'
  | 'chuva-consorcio'
  | 'serie'
  | 'historico'
  | 'historico-anual'
  | 'elnino-mes'
  | 'previsao'
  | 'pos-pico-oni'
  | 'correlacoes'
  | 'heatmap-casos'
  | 'scatter-chuva'
  | 'resumo-elnino'
  | 'correlacao-lag'
  | 'kpi-correlacao-oni';

/** Textos em linguagem simples — portados do Dash_Completo (guias_graficos.js). */
export const GUIAS_GRAFICOS: Record<GuiaChave, GuiaGrafico> = {
  'mapa-projecao-bairro': {
    titulo: 'Como ler a projeção por bairro',
    itens: [
      {
        marcador: 'azul',
        rotulo: 'Verba direta',
        texto:
          'Disponível apenas quando um município de verba direta é selecionado no filtro global. A tabela mostra como os casos projetados se distribuem entre os bairros.',
      },
      {
        marcador: 'neutro',
        rotulo: 'Proporção por POIs',
        texto:
          'Somente bairros com pelo menos um POI/criadouro mapeado na TechDengue entram na lista e na distribuição da projeção.',
      },
      {
        marcador: 'laranja',
        rotulo: 'Total do município',
        texto:
          'A soma dos casos por bairro no mês equivale ao total projetado para o município (badge no topo do card).',
      },
    ],
  },
  'mapa-projecao': {
    titulo: 'Como ler o mapa de projeção',
    itens: [
      {
        marcador: 'verde',
        rotulo: 'Verde — risco baixo',
        texto: 'Municípios com menos casos projetados no mês selecionado.',
      },
      {
        marcador: 'laranja',
        rotulo: 'Laranja e vermelho — risco maior',
        texto: 'Quanto mais intenso o tom, maior a estimativa de casos de dengue naquele mês.',
      },
      {
        marcador: 'neutro',
        rotulo: 'Seletor de mês',
        texto: 'Troque o mês para ver como a projeção muda ao longo do ano, considerando sazonalidade e El Niño.',
      },
      {
        marcador: 'amarelo',
        rotulo: 'ONI e fator El Niño',
        texto: 'Mostram o clima oceânico usado no cálculo. El Niño ativo tende a elevar o risco em alguns meses.',
      },
    ],
  },
  ranking: {
    titulo: 'Como ler o ranking de municípios',
    itens: [
      {
        marcador: 'laranja-forte',
        rotulo: 'Barras mais longas',
        texto: 'Municípios com mais casos notificados no período analisado.',
      },
      {
        marcador: 'laranja-claro',
        rotulo: 'Barras mais curtas',
        texto: 'Menos casos acumulados — útil para comparar cidades do consórcio.',
      },
      {
        marcador: 'neutro',
        rotulo: 'Ordem do gráfico',
        texto: 'O município com mais casos aparece no topo. Passe o mouse para ver o valor exato.',
      },
    ],
  },
  'ranking-bairro': {
    titulo: 'Como ler POIs por bairro',
    itens: [
      {
        marcador: 'azul',
        rotulo: 'Verba direta',
        texto:
          'Com município de verba direta no filtro, o gráfico lista bairros com POIs/criadouros mapeados na TechDengue.',
      },
      {
        marcador: 'laranja-forte',
        rotulo: 'Barras — quantidade de POIs',
        texto: 'Bairros com mais criadouros identificados aparecem no topo do ranking.',
      },
      {
        marcador: 'neutro',
        rotulo: 'POI/ha',
        texto:
          'Na tabela e no tooltip: cruzamento com hectares mapeados por bairro (POIs ÷ hectares). Bairros sem hectare alocado exibem “—”.',
      },
    ],
  },
  alertas: {
    titulo: 'Como ler os alertas preditivos',
    itens: [
      {
        marcador: 'vermelho',
        rotulo: 'Nível alto',
        texto: 'Situação que exige atenção imediata — dengue, clima extremo ou El Niño intenso.',
      },
      {
        marcador: 'laranja',
        rotulo: 'Nível médio',
        texto: 'Risco moderado; reforçar vigilância e ações de prevenção.',
      },
      {
        marcador: 'azul',
        rotulo: 'Nível baixo',
        texto: 'Informativo ou sem alerta elevado no momento.',
      },
      {
        marcador: 'neutro',
        rotulo: 'Categorias',
        texto: 'INMET (tempo), chuva, previsão, Infodengue e controle vetorial — cada alerta explica causa e ação sugerida.',
      },
    ],
  },
  consorcio: {
    titulo: 'Como ler o gráfico do consórcio',
    itens: [
      {
        marcador: 'vermelho',
        rotulo: 'Casos (média por município)',
        texto: 'Média de casos de dengue por cidade em cada mês. Linha contínua = histórico; tracejada = estimativa futura.',
      },
      {
        marcador: 'azul',
        rotulo: 'Temperatura média',
        texto:
          'Média mensal dos municípios do consórcio (cache do pipeline). A linha tracejada usa climatologia histórica do mesmo mês — não é previsão ao vivo (Open-Meteo).',
      },
      {
        marcador: 'amarelo',
        rotulo: 'ONI (El Niño)',
        texto: 'Aquecimento do oceano Pacífico. Acima de +0,5 °C costuma caracterizar período de El Niño.',
      },
      {
        marcador: 'laranja-claro',
        rotulo: 'Faixa laranja no fundo',
        texto: 'Meses com El Niño moderado ou fraco — o clima oceânico pode influenciar chuvas e temperatura.',
      },
      {
        marcador: 'vermelho-claro',
        rotulo: 'Faixa vermelha no fundo',
        texto: 'Meses com El Niño forte ou muito forte — maior influência climática esperada.',
      },
    ],
  },
  'chuva-consorcio': {
    titulo: 'Como ler chuva × temperatura × ONI',
    itens: [
      {
        marcador: 'azul',
        rotulo: 'Barra azul',
        texto:
          'Chuva do mês com ONI < +0,5 °C (sem El Niño). Em 2026, o início do ano costuma ficar assim.',
      },
      {
        marcador: 'laranja',
        rotulo: 'Barra laranja',
        texto:
          'Chuva do mês com El Niño ativo (ONI ≥ +0,5 °C). O status muda mês a mês — não vale para o ano inteiro.',
      },
      {
        marcador: 'azul',
        rotulo: 'Média hist. (azul)',
        texto:
          'Linha tracejada azul: climatologia do mês enquanto o El Niño não está ativo (média histórica sem EN).',
      },
      {
        marcador: 'laranja',
        rotulo: 'Média hist. (laranja)',
        texto:
          'A partir do mês em que o ONI ≥ +0,5, a mesma linha passa a laranja e usa a média histórica com El Niño.',
      },
      {
        marcador: 'azul',
        rotulo: 'Clima / temperatura',
        texto:
          'Linha azul-céu (°C): temperatura média mensal ERA5 — mesma cor da legenda consolidada de clima.',
      },
      {
        marcador: 'amarelo',
        rotulo: 'ONI NOAA',
        texto:
          'Linha laranja/âmbar: anomalia do Pacífico — mesma cor da legenda consolidada de ONI. Limiar em +0,5.',
      },
      {
        marcador: 'neutro',
        rotulo: 'Por que importa',
        texto:
          'Chuva + calor fora do padrão favorecem criadouros — use o ONI do mês para ler o contexto, não o rótulo do ano.',
      },
    ],
  },
  serie: {
    titulo: 'Como ler a série temporal',
    itens: [
      {
        marcador: 'laranja',
        rotulo: 'Casos de dengue',
        texto: 'Média de casos em cada mês do ano (Jan a Dez), considerando o período do filtro.',
      },
      {
        marcador: 'azul',
        rotulo: 'Temperatura',
        texto: 'Linha pontilhada com o calor médio mensal. Ajuda a ver se meses mais quentes coincidem com mais casos.',
      },
      {
        marcador: 'amarelo',
        rotulo: 'ONI oceano',
        texto: 'Comportamento do El Niño mês a mês na mesma escala de tempo.',
      },
    ],
  },
  historico: {
    titulo: 'Como ler o comparativo mensal',
    itens: [
      {
        marcador: 'laranja',
        rotulo: 'Barras de casos',
        texto: 'Casos em cada mês. Laranja = mês com El Niño; azul = sem El Niño.',
      },
      {
        marcador: 'verde',
        rotulo: 'Linha ONI',
        texto: 'Índice do oceano no mesmo período, para comparar clima e dengue lado a lado.',
      },
      {
        marcador: 'laranja-claro',
        rotulo: 'Fundo colorido',
        texto: 'Marca os meses em que o El Niño influenciou o clima global.',
      },
    ],
  },
  'elnino-mes': {
    titulo: 'Como ler o perfil mensal',
    itens: [
      {
        marcador: 'azul',
        rotulo: 'Sem El Niño',
        texto: 'Média de casos em cada mês dos anos em que o oceano estava neutro ou frio.',
      },
      {
        marcador: 'laranja',
        rotulo: 'Com El Niño',
        texto: 'Média de casos nos mesmos meses, mas nos anos em que o El Niño estava ativo.',
      },
      {
        marcador: 'neutro',
        rotulo: 'Comparando as linhas',
        texto: 'Quando a linha laranja fica acima da azul, os casos tendem a ser maiores naquele mês com El Niño.',
      },
      {
        marcador: 'amarelo',
        rotulo: 'Período fixo',
        texto:
          'Usa o histórico completo (ex.: 2020–2026). Não muda quando você altera o filtro de anos na tela.',
      },
    ],
  },
  previsao: {
    titulo: 'Como ler clima e previsão',
    itens: [
      {
        marcador: 'vermelho',
        rotulo: 'Temperatura máxima',
        texto: 'Dias mais quentes previstos. Calor extremo pode aumentar a atividade do mosquito.',
      },
      {
        marcador: 'azul',
        rotulo: 'Temperatura mínima',
        texto: 'Noites e madrugadas mais frias no período previsto.',
      },
      {
        marcador: 'verde',
        rotulo: 'Chuva',
        texto: 'Volume de precipitação esperado. Chuvas podem deixar água parada, onde o mosquito se reproduz.',
      },
      {
        marcador: 'laranja',
        rotulo: 'Umidade',
        texto: 'Ar mais úmido favorece a sobrevivência do vetor da dengue.',
      },
    ],
  },
  'pos-pico-oni': {
    titulo: 'Como ler o crescimento após o pico',
    itens: [
      {
        marcador: 'neutro',
        rotulo: 'Eixo X = mês do pico ONI',
        texto:
          'Cada barra é o mês em que o ONI do episódio El Niño foi máximo (NOAA), não o início do episódio nem o clima local. Ex.: mar/2026 podia estar neutro e o pico aparecer só em mai/2026.',
      },
      {
        marcador: 'azul',
        rotulo: '+1 mês após o pico',
        texto: 'Quanto os casos mudaram no mês seguinte ao maior aquecimento do oceano (pico do ONI).',
      },
      {
        marcador: 'laranja',
        rotulo: '+2 meses após o pico',
        texto: 'Mesma comparação, dois meses depois do pico. Útil para ver se o efeito se mantém.',
      },
      {
        marcador: 'neutro',
        rotulo: 'Porcentagem (+ ou −)',
        texto: 'Valor positivo: casos subiram em relação ao mês do pico. Negativo: casos caíram.',
      },
    ],
  },
  correlacoes: {
    titulo: 'Como ler as correlações',
    itens: [
      {
        marcador: 'verde',
        rotulo: 'r positivo',
        texto: 'Quando a variável sobe, os casos de dengue tendem a subir no mesmo período.',
      },
      {
        marcador: 'vermelho',
        rotulo: 'r negativo',
        texto: 'Quando a variável sobe, os casos tendem a cair (relação inversa).',
      },
      {
        marcador: 'neutro',
        rotulo: 'Escala de −1 a +1',
        texto: 'Valores perto de zero indicam pouca associação linear. Correlação não implica causalidade.',
      },
      {
        marcador: 'amarelo',
        rotulo: 'Clima × dengue e El Niño',
        texto: 'Barras de clima (temp, chuva, umidade, ONI) e barras específicas do regime El Niño.',
      },
    ],
  },
  'historico-anual': {
    titulo: 'Como ler o histórico anual',
    itens: [
      {
        marcador: 'laranja',
        rotulo: 'Barras de casos',
        texto:
          'Total de casos no ano. Quanto mais laranja, maior a fração de meses com El Niño (não é tudo-ou-nada).',
      },
      {
        marcador: 'amarelo',
        rotulo: 'Linha ONI médio',
        texto:
          'Média anual do índice NOAA. A média pode ficar abaixo de +0,5 mesmo com El Niño em parte do ano (ex.: 2024).',
      },
      {
        marcador: 'laranja',
        rotulo: 'Faixa mensal',
        texto:
          '12 células por ano: laranja = mês com ONI ≥ +0,5. Assim dá para ver El Niño só no 1º semestre, por exemplo.',
      },
    ],
  },
  'heatmap-casos': {
    titulo: 'Como ler o heatmap mês × ano',
    itens: [
      {
        marcador: 'laranja-forte',
        rotulo: 'Células escuras',
        texto: 'Meses com mais casos de dengue no período filtrado.',
      },
      {
        marcador: 'laranja-claro',
        rotulo: 'Células claras',
        texto: 'Meses com poucos casos — útil para ver a sazonalidade típica.',
      },
      {
        marcador: 'neutro',
        rotulo: 'Linhas = anos',
        texto: 'Cada linha é um ano; cada coluna um mês (Jan–Dez). Compare padrões entre anos.',
      },
    ],
  },
  'scatter-chuva': {
    titulo: 'Como ler chuva × casos',
    itens: [
      {
        marcador: 'laranja',
        rotulo: 'Pontos laranja',
        texto: 'Meses em que o El Niño estava ativo (ONI ≥ +0,5 °C).',
      },
      {
        marcador: 'azul',
        rotulo: 'Pontos azuis',
        texto: 'Meses sem El Niño (neutro ou La Niña).',
      },
      {
        marcador: 'neutro',
        rotulo: 'Dispersão',
        texto: 'Cada ponto é um mês. Ajuda a ver se mais chuva acompanha mais casos e a achar outliers.',
      },
    ],
  },
  'resumo-elnino': {
    titulo: 'Como ler o resumo El Niño',
    itens: [
      {
        marcador: 'laranja',
        rotulo: 'Variação de casos',
        texto: 'Diferença percentual da média mensal de casos em anos com El Niño versus sem El Niño.',
      },
      {
        marcador: 'azul',
        rotulo: 'Médias de clima',
        texto: 'Temperatura e chuva médias nos dois regimes — contexto para o efeito nos casos.',
      },
      {
        marcador: 'neutro',
        rotulo: 'Anos cobertos',
        texto: 'Intervalos de anos usados em cada grupo (com e sem El Niño) no filtro atual.',
      },
    ],
  },
  'correlacao-lag': {
    titulo: 'Como ler a correlação com defasagem',
    itens: [
      {
        marcador: 'laranja',
        rotulo: 'Lag (meses)',
        texto: 'Quantos meses a variável climática antecede os casos. Lag 2 = clima de há 2 meses × casos atuais.',
      },
      {
        marcador: 'verde',
        rotulo: 'r mais alto',
        texto: 'Células mais intensas mostram a defasagem em que a associação linear é mais forte.',
      },
      {
        marcador: 'neutro',
        rotulo: 'Uso epidemiológico',
        texto: 'Em dengue, chuva e temperatura costumam antecipar os casos em algumas semanas a meses.',
      },
    ],
  },
  'kpi-correlacao-oni': {
    titulo: 'O que este número significa?',
    itens: [
      {
        marcador: 'azul',
        rotulo: 'Em poucas palavras',
        texto:
          'Mostra se, ao longo dos anos, meses com El Niño mais “quente” no oceano costumaram ter mais casos de dengue na região.',
      },
      {
        marcador: 'verde',
        rotulo: 'Como ler o valor',
        texto:
          'Perto de zero: quase não há ligação clara. Mais perto de 1: os dois costumam subir juntos. Valor negativo: um sobe e o outro cai.',
      },
      {
        marcador: 'amarelo',
        rotulo: 'Não é chance por pessoa',
        texto:
          'Não indica a chance de alguém adoecer nem o total de casos do mês. Mostra só se o clima oceânico e os casos caminham juntos.',
      },
      {
        marcador: 'laranja',
        rotulo: 'Mesmo mês (lag 0)',
        texto:
          'Compara o clima oceânico de um mês com os casos daquele mesmo mês (sem atraso).',
      },
      {
        marcador: 'neutro',
        rotulo: 'Base histórica',
        texto:
          'Usa vários anos de dados (ex.: 2020–2026), e não muda só porque você alterou o filtro de período na tela.',
      },
    ],
  },
};

/** Personaliza título e textos com o rótulo do consórcio (ex.: SIMSAUDE - ZURS UBÁ). */
export function guiaComContexto(chave: GuiaChave, contexto?: string | null): GuiaGrafico | null {
  const base = GUIAS_GRAFICOS[chave];
  if (!base) return null;
  const rotulo = String(contexto ?? '').trim();
  if (!rotulo) return base;

  const substituir = (texto: string) =>
    texto
      .replace(/\bdo consórcio\b/gi, `de ${rotulo}`)
      .replace(/\bno consórcio\b/gi, `em ${rotulo}`)
      .replace(/\bcidades do consórcio\b/gi, `municípios de ${rotulo}`);

  return {
    titulo: `${base.titulo} — ${rotulo}`,
    itens: base.itens.map((item) => ({
      ...item,
      texto: substituir(item.texto),
    })),
  };
};
