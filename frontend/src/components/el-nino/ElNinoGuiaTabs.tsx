import React, { useState } from 'react';
import {
  FaChartLine,
  FaDatabase,
  FaCalculator,
  FaMapMarkerAlt,
} from 'react-icons/fa';

type TabId = 'series' | 'fontes' | 'projecao' | 'municipios';

interface Item {
  rotulo: string;
  cor: string;
  descricao: string;
}

const ITENS_SERIES: Item[] = [
  {
    rotulo: 'Casos notificados (Infodengue)',
    cor: '#ef4444',
    descricao:
      'Casos mensais agregados por município (soma das semanas epidemiológicas). Linha vermelha contínua até o mês atual; meses sem notificação aparecem como zero.',
  },
  {
    rotulo: 'Temperatura média observada',
    cor: '#3b82f6',
    descricao:
      'Temperatura mensal do município (Copernicus ERA5). Linha azul sólida no eixo esquerdo em °C.',
  },
  {
    rotulo: 'ONI oceano (NOAA)',
    cor: '#f59e0b',
    descricao:
      'Anomalia de temperatura do Pacífico central (°C). Índice ONI mensal — igual para todos os municípios. Eixo direito secundário.',
  },
  {
    rotulo: 'El Niño moderado (ONI ≥ +0,5)',
    cor: '#fb923c',
    descricao:
      'Meses com ONI ≥ +0,5 °C (critério NOAA CPC). Faixa laranja clara no fundo do gráfico.',
  },
  {
    rotulo: 'El Niño forte projetado (ONI ≥ +1,5)',
    cor: '#dc2626',
    descricao:
      'Cenário futuro projetado com fator multiplicador 1,8× sobre a base epidemiológica. Faixa vermelha mais escura.',
  },
  {
    rotulo: 'Projeção de casos',
    cor: '#f87171',
    descricao:
      'Estimativa Jul–Dez a partir do último mês com casos > 0. Linha vermelha tracejada + faixa de incerteza (70% a 135%). Âncora na linha vertical "hoje" e na semana epidemiológica.',
  },
  {
    rotulo: 'Projeção de temperatura (SEAS5)',
    cor: '#7dd3fc',
    descricao:
      'Cenário sazonal mensal do Copernicus SEAS5. Linha azul tracejada para os próximos 6 meses.',
  },
];

const ITENS_FONTES: Item[] = [
  {
    rotulo: 'Infodengue AlertCity',
    cor: '#ef4444',
    descricao:
      'API pública mantida por Fiocruz/UFRJ/MS — fornece casos estimados, nível de alerta (1–4), incidência por 100k hab. e semana epidemiológica por geocode IBGE. Atualizada semanalmente.',
  },
  {
    rotulo: 'Copernicus CDS (ERA5 e SEAS5)',
    cor: '#3b82f6',
    descricao:
      'Reanálise meteorológica global ERA5 (histórico mensal) + projeção sazonal SEAS5. Variáveis: temperatura a 2 m, ponto de orvalho (para UR), precipitação total. Acesso via token CDS.',
  },
  {
    rotulo: 'NOAA CPC ONI',
    cor: '#f59e0b',
    descricao:
      'Índice oceânico mensal Niño 3.4 (anomalia SST). Classificação: Neutro (<+0,5), Moderado (+0,5 a +1,5), Forte (≥+1,5), Muito forte (≥+2,0).',
  },
];

const ITENS_PROJECAO: Item[] = [
  {
    rotulo: 'Fórmula epidemiológica',
    cor: '#0087a8',
    descricao:
      'casos_proj = min(base × f_sazonal × f_elnino, população × 15%). O teto de 15% evita projeções absurdas em municípios pequenos.',
  },
  {
    rotulo: 'Base epidemiológica',
    cor: '#f87171',
    descricao:
      'Último mês com casos > 0 conforme Infodengue AlertCity. Se nenhum mês recente positivo, usa média móvel dos últimos 12 meses.',
  },
  {
    rotulo: 'Fator sazonal (f_sazonal)',
    cor: '#10b981',
    descricao:
      'Razão entre a média histórica do mês alvo e a média geral do município, calculada a partir da janela de 10 anos.',
  },
  {
    rotulo: 'Fator El Niño (f_elnino)',
    cor: '#fb923c',
    descricao:
      'Multiplicador conforme intensidade ONI: 1,0 (neutro), 1,3 (moderado ≥+0,5), 1,8 (forte ≥+1,5 ou muito forte ≥+2,0). 0,9 em La Niña.',
  },
  {
    rotulo: 'Faixa de incerteza',
    cor: '#a3a3a3',
    descricao:
      'Banda superior: projeção × 1,35 (+35%). Banda inferior: projeção × 0,70 (−30%). Cobre a incerteza típica de modelos epidemiológicos.',
  },
];

const ITENS_MUNICIPIOS: Item[] = [
  {
    rotulo: 'Casos notificados',
    cor: '#ef4444',
    descricao:
      'Muda por município. Geocode IBGE próprio no Infodengue determina a série temporal individual.',
  },
  {
    rotulo: 'Temperatura ERA5/SEAS5',
    cor: '#3b82f6',
    descricao:
      'Muda por município. Interpolação nearest-neighbor sobre o grid Copernicus a partir da lat/lon do município.',
  },
  {
    rotulo: 'Projeção epidemiológica',
    cor: '#f87171',
    descricao:
      'Muda por município. Base e sazonalidade são próprias; o fator El Niño é compartilhado.',
  },
  {
    rotulo: 'Nível de alerta e SE',
    cor: '#fb923c',
    descricao:
      'Muda por município. Vem do Infodengue AlertCity por geocode com a semana epidemiológica corrente.',
  },
  {
    rotulo: 'ONI e faixas El Niño',
    cor: '#f59e0b',
    descricao:
      'Não muda por município. É um índice oceânico global do NOAA — igual para todos.',
  },
  {
    rotulo: 'Média mensal histórica',
    cor: '#a78bfa',
    descricao:
      'Muda por município. Calculada sobre a série Infodengue + Copernicus dos últimos 10 anos.',
  },
];

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'series', label: 'Séries', icon: <FaChartLine className="w-3 h-3" /> },
  { id: 'fontes', label: 'Fontes', icon: <FaDatabase className="w-3 h-3" /> },
  {
    id: 'projecao',
    label: 'Projeção',
    icon: <FaCalculator className="w-3 h-3" />,
  },
  {
    id: 'municipios',
    label: 'Municípios',
    icon: <FaMapMarkerAlt className="w-3 h-3" />,
  },
];

const DADOS_TABS: Record<TabId, Item[]> = {
  series: ITENS_SERIES,
  fontes: ITENS_FONTES,
  projecao: ITENS_PROJECAO,
  municipios: ITENS_MUNICIPIOS,
};

export const ElNinoGuiaTabs: React.FC = () => {
  const [ativa, setAtiva] = useState<TabId>('series');
  const itens = DADOS_TABS[ativa];

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex flex-wrap border-b border-gray-100 bg-gray-50/50">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setAtiva(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-2 transition-colors ${
              ativa === tab.id
                ? 'border-[#0087a8] text-[#0087a8] bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-white/60'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-5 space-y-3">
        {itens.map((item) => (
          <div
            key={item.rotulo}
            className="flex gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50/60 transition-colors"
          >
            <div
              className="w-1 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.cor }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 mb-1">
                {item.rotulo}
              </p>
              <p className="text-xs text-gray-600 leading-relaxed">
                {item.descricao}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ElNinoGuiaTabs;
