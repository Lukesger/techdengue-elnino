#!/usr/bin/env node
/**
 * bootstrap-env.mjs
 * Lê ../read_acessos/credenciais.env (ou READ_ACESSOS_PATH) e gera:
 *   - frontend/.env.local
 *   - backend/.env
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const githubRoot = path.resolve(root, '..');

const candidates = [
  process.env.READ_ACESSOS_PATH,
  path.join(githubRoot, 'read_acessos', 'credenciais.env'),
  path.join(root, 'read_acessos', 'credenciais.env'),
].filter(Boolean);

const source = candidates.find((p) => fs.existsSync(p));
if (!source) {
  console.error(
    [
      'ERROR: credenciais.env não encontrado.',
      'Clone o repo privado read_acessos ao lado deste monorepo:',
      '  Documents/GitHub/read_acessos/credenciais.env',
      'Ou defina READ_ACESSOS_PATH apontando para o arquivo.',
      'Veja read_acessos/credenciais.env.example',
    ].join('\n'),
  );
  process.exit(1);
}

const raw = fs.readFileSync(source, 'utf8');
const lines = raw.split(/\r?\n/);
const vars = {};
for (const line of lines) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 0) continue;
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  vars[k] = v;
}

function pick(keys) {
  return keys
    .filter((k) => vars[k] != null && vars[k] !== '')
    .map((k) => `${k}=${vars[k]}`)
    .join('\n');
}

const frontKeys = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_MAPBOX_TOKEN',
  'NEXT_PUBLIC_API_TIMEOUT',
  'INTERNAL_API_URL',
];
const backKeys = [
  'NODE_ENV',
  'PORT',
  'API_PREFIX',
  'CORS_ORIGIN',
  'ELNINO_DEMO_AUTH',
  'EL_NINO_DATA_DIR',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_NAME',
  'DB_SSL',
  'DADOS_GEO_DB_HOST',
  'DADOS_GEO_DB_PORT',
  'DADOS_GEO_DB_USERNAME',
  'DADOS_GEO_DB_PASSWORD',
  'DADOS_GEO_DB_NAME',
  'DADOS_GEO_DB_SCHEMA',
  'GIS_DB_HOST',
  'GIS_DB_PORT',
  'GIS_DB_USERNAME',
  'GIS_DB_PASSWORD',
  'GIS_DB_NAME',
  'CDSAPI_KEY',
  'CDSAPI_URL',
  'ELNINO_ANALYTICS_CRON_ENABLED',
];

const frontDefaults = {
  NEXT_PUBLIC_API_URL: 'http://localhost:8000/api/v1',
};
const backDefaults = {
  NODE_ENV: 'development',
  PORT: '8000',
  API_PREFIX: 'api/v1',
  CORS_ORIGIN: 'http://localhost:3001',
  ELNINO_DEMO_AUTH: 'true',
  ELNINO_ANALYTICS_CRON_ENABLED: 'false',
  EL_NINO_DATA_DIR: path.join(root, 'backend', 'data', 'el-nino'),
};

function mergeEnv(keys, defaults) {
  const out = { ...defaults };
  for (const k of keys) {
    if (vars[k] != null && vars[k] !== '') out[k] = vars[k];
  }
  return Object.entries(out)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

const frontPath = path.join(root, 'frontend', '.env.local');
const backPath = path.join(root, 'backend', '.env');
fs.writeFileSync(frontPath, mergeEnv(frontKeys, frontDefaults) + '\n', 'utf8');
fs.writeFileSync(backPath, mergeEnv(backKeys, backDefaults) + '\n', 'utf8');

console.log(`OK: leu ${source}`);
console.log(`OK: escreveu ${frontPath}`);
console.log(`OK: escreveu ${backPath}`);
