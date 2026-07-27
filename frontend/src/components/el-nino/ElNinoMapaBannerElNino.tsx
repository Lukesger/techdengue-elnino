import React from 'react';
import { MapaProjecaoResponse } from '@/services/el-nino-api';
import { FaInfoCircle } from 'react-icons/fa';

interface Props {
  data: MapaProjecaoResponse | null;
}

const MESES_CURTOS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

function formatarPeriodoReferencia(periodo: string): string {
  const match = periodo.match(/^(\d{4})\/(\d{2})$/);
  if (!match) return periodo;
  const mes = MESES_CURTOS[parseInt(match[2], 10) - 1];
  return mes ? `${mes}/${match[1]}` : periodo;
}

function formatarVariacaoLeiga(fatorMin: number, fatorMax: number): string {
  const pctMin = Math.round((fatorMin - 1) * 100);
  const pctMax = Math.round((fatorMax - 1) * 100);

  if (pctMin === pctMax) {
    if (pctMax <= 0) return 'no mesmo nível do habitual';
    return `até ${pctMax}% acima do habitual`;
  }
  if (pctMin <= 0) {
    return `entre o nível habitual e até ${pctMax}% a mais`;
  }
  return `entre ${pctMin}% e ${pctMax}% acima do habitual`;
}

function explicarIntensidade(intensidade: string): string {
  const explicacoes: Record<string, string> = {
    'El Niño muito forte':
      'oceano bem mais quente que o normal — maior chance de chuvas e calor fora do padrão',
    'El Niño forte':
      'oceano claramente mais quente — o clima tende a ficar mais instável',
    'El Niño moderado':
      'oceano um pouco mais quente — pode influenciar chuvas e temperatura',
    Neutro: 'oceano em temperatura próxima do normal',
    'La Niña': 'oceano mais frio que o normal — outro padrão de chuvas e temperatura',
  };
  return explicacoes[intensidade] ?? 'situação climática em análise';
}

/**
 * Banner topo da página /mapa — resume o cenário El Niño em linguagem acessível.
 */
export const ElNinoMapaBannerElNino: React.FC<Props> = ({ data }) => {
  if (!data?.elnino) return null;
  const e = data.elnino;
  const meses = data.meses ?? [];
  const fatorMin = Math.min(...meses.map((m) => m.fElnino), 1);
  const fatorMax = Math.max(...meses.map((m) => m.fElnino), 1);
  const periodo =
    meses.length >= 2
      ? `${meses[0].label.split('/')[0]}–${meses[meses.length - 1].label.split('/')[0]}/${data.ano_projecao}`
      : `${data.ano_projecao}`;

  const intensidadeBg =
    {
      'El Niño muito forte': 'bg-red-50 border-red-200 text-red-800',
      'El Niño forte': 'bg-orange-50 border-orange-200 text-orange-800',
      'El Niño moderado': 'bg-amber-50 border-amber-200 text-amber-800',
      Neutro: 'bg-sky-50 border-sky-200 text-sky-800',
      'La Niña': 'bg-cyan-50 border-cyan-200 text-cyan-800',
    }[e.intensidade] ?? 'bg-gray-50 border-gray-200 text-gray-700';

  const variacao = formatarVariacaoLeiga(fatorMin, fatorMax);
  const oniFormatado =
    e.oni_atual != null
      ? `${e.oni_atual >= 0 ? '+' : ''}${e.oni_atual.toFixed(2).replace('.', ',')} °C`
      : null;

  return (
    <div
      className={`rounded-xl border p-4 flex items-start gap-3 ${intensidadeBg}`}
    >
      <FaInfoCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <div className="flex-1 text-sm leading-relaxed">
        <p className="mb-1">
          <strong>Clima agora:</strong>{' '}
          {oniFormatado
            ? `o Pacífico está ${e.oni_atual! > 0 ? 'mais quente' : e.oni_atual! < 0 ? 'mais frio' : 'na temperatura usual'} que o normal (${oniFormatado})`
            : 'dados de temperatura do oceano indisponíveis'}
          . Situação: <strong>{e.intensidade}</strong>
          {e.periodo_atual
            ? ` (referência: ${formatarPeriodoReferencia(e.periodo_atual)})`
            : ''}
          — {explicarIntensidade(e.intensidade)}.
        </p>
        <p className="text-xs opacity-90">
          <strong>Projeção no mapa ({periodo}):</strong> com base no histórico de
          dengue de cada município e na época do ano, os casos podem ficar{' '}
          <strong>{variacao}</strong> em relação ao que a cidade costuma registrar.
        </p>
      </div>
    </div>
  );
};

export default ElNinoMapaBannerElNino;
