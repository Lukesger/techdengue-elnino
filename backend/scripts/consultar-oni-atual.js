/**
 * Busca o ONI mais recente na NOAA CPC (mesmo fonte do dashboard El Niño).
 * Grava snapshot em data/el-nino/oni_atual.json.
 *
 * Uso:
 *   npm run el-nino:oni-atual
 *   node --use-system-ca scripts/consultar-oni-atual.js
 *   node --use-system-ca scripts/consultar-oni-atual.js --ultimos 6
 *   node --use-system-ca scripts/consultar-oni-atual.js --json
 *
 * Agendamento semanal (Windows):
 *   npm run el-nino:oni-atual:instalar-tarefa
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const https = require('https');

const NOAA_ONI_TXT =
  'https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt';

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'el-nino');
const SNAPSHOT = path.join(DIR, 'oni_atual.json');
const LOG = path.join(DIR, 'oni_atual.log');

const MESES = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

/** Trimestre sazonal → mês do meio (igual noaa-oni.service.ts). */
const SEAS_MEIO_MES = {
  DJF: 1,
  JFM: 2,
  FMA: 3,
  MAM: 4,
  AMJ: 5,
  MJJ: 6,
  JJA: 7,
  JAS: 8,
  ASO: 9,
  SON: 10,
  OND: 11,
  NDJ: 12,
};

function parseArgs(argv) {
  const out = { ultimos: 12, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--ultimos' || a === '-n') {
      out.ultimos = Math.max(1, Number(argv[++i]) || 12);
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function classificar(oni) {
  const v = Number(oni ?? 0);
  if (v >= 2.0) return 'El Niño muito forte';
  if (v >= 1.5) return 'El Niño forte';
  if (v >= 0.5) return 'El Niño moderado';
  if (v <= -0.5) return 'La Niña';
  return 'Neutro';
}

function fetchTexto(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'TechDengue-ONI-Script/1.0' },
        timeout: 30000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} ao buscar ${url}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve(Buffer.concat(chunks).toString('utf8')),
        );
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout ao buscar ONI na NOAA'));
    });
  });
}

function parseOniAscii(texto) {
  const map = new Map();
  for (const linha of String(texto).split(/\r?\n/)) {
    const parts = linha.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const seas = parts[0];
    const ano = Number(parts[1]);
    const anom = Number(parts[3]);
    const mes = SEAS_MEIO_MES[seas];
    if (
      !mes ||
      !Number.isFinite(ano) ||
      !Number.isFinite(anom) ||
      anom <= -90
    ) {
      continue;
    }
    const k = `${ano}-${mes}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(anom);
  }

  return Array.from(map.entries())
    .map(([k, vals]) => {
      const [ano, mes] = k.split('-').map(Number);
      const oni =
        Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) /
        100;
      return { ano, mes, oni };
    })
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);
}

function rotuloMes(ano, mes) {
  return `${MESES[mes - 1] ?? String(mes).padStart(2, '0')}/${ano}`;
}

function gravarSnapshot(payload) {
  fs.mkdirSync(DIR, { recursive: true });
  const slim = {
    fonte: payload.fonte,
    url: payload.url,
    consultado_em: payload.consultado_em,
    motivo: 'script',
    atual: payload.atual
      ? {
          ano: payload.atual.ano,
          mes: payload.atual.mes,
          rotulo: payload.atual.rotulo,
          oni: payload.atual.oni,
          classificacao: payload.atual.classificacao,
          subtitulo_kpi: payload.atual.subtitulo_kpi,
        }
      : null,
  };
  const tmp = `${SNAPSHOT}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(slim, null, 2), 'utf-8');
  fs.renameSync(tmp, SNAPSHOT);

  const linha = `${payload.consultado_em}\t${payload.atual?.rotulo ?? '—'}\t${payload.atual?.oni ?? '—'}\t${payload.atual?.classificacao ?? ''}\n`;
  fs.appendFileSync(LOG, linha, 'utf-8');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Uso:
  npm run el-nino:oni-atual
  node --use-system-ca scripts/consultar-oni-atual.js [--ultimos N] [--json]
  npm run el-nino:oni-atual:instalar-tarefa   # Agenda semanal no Windows

Fonte: ${NOAA_ONI_TXT}
Snapshot: ${SNAPSHOT}`);
    process.exit(0);
  }

  const texto = await fetchTexto(NOAA_ONI_TXT);
  const linhas = parseOniAscii(texto);
  if (!linhas.length) {
    throw new Error('Nenhuma linha ONI válida no arquivo NOAA.');
  }

  const ultimo = linhas[linhas.length - 1];
  const recentes = linhas.slice(-args.ultimos).map((r) => ({
    ...r,
    rotulo: rotuloMes(r.ano, r.mes),
    classificacao: classificar(r.oni),
  }));

  const payload = {
    fonte: 'NOAA CPC (oni.ascii.txt)',
    url: NOAA_ONI_TXT,
    consultado_em: new Date().toISOString(),
    atual: {
      ano: ultimo.ano,
      mes: ultimo.mes,
      rotulo: rotuloMes(ultimo.ano, ultimo.mes),
      oni: ultimo.oni,
      classificacao: classificar(ultimo.oni),
      subtitulo_kpi: `Dados de ${rotuloMes(ultimo.ano, ultimo.mes)} · último ONI NOAA disponível`,
    },
    recentes,
  };

  gravarSnapshot(payload);

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('── ONI NOAA (atualização) ─────────────────────────');
  console.log(`Fonte:     ${payload.fonte}`);
  console.log(`URL:       ${payload.url}`);
  console.log(`Consulta:  ${payload.consultado_em}`);
  console.log(`Snapshot:  ${SNAPSHOT}`);
  console.log('');
  console.log(`Mês:       ${payload.atual.rotulo}`);
  console.log(`Valor ONI: ${payload.atual.oni}`);
  console.log(`Classe:    ${payload.atual.classificacao}`);
  console.log(`KPI:       ${payload.atual.subtitulo_kpi}`);
  console.log('');
  console.log(`Últimos ${recentes.length} meses:`);
  for (const r of recentes) {
    const sinal = r.oni >= 0 ? '+' : '';
    console.log(
      `  ${r.rotulo.padEnd(8)}  ${sinal}${r.oni.toFixed(2).padStart(5)}  ${r.classificacao}`,
    );
  }
  console.log('───────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('Falha ao consultar ONI:', err.message || err);
  process.exit(1);
});
