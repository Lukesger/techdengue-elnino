/**
 * Cache em disco do painel de municípios não mapeados
 * (casos notificados + projeção + pop).
 *
 * Runtime (fora do watcher do Next):
 *   .cache/el-nino/painel_nao_mapeados/
 *     {geocode}.json
 *     meta.json
 *
 * Hot path: lê o arquivo (TTL 6h). Miss → Infodengue uma vez → grava.
 */
import fs from 'fs';
import type { MunicipioPainelResumo } from './municipio-painel-resumo';
import {
  escreverJsonAtomico,
  garantirDirRuntime,
  runtimePath,
} from './cache-paths';

const TTL_MS = 6 * 60 * 60 * 1000;
const DIR = runtimePath('painel_nao_mapeados');

type Envelope = {
  atualizado_em: string;
  expira_em: string;
  payload: MunicipioPainelResumo;
};

const memoria = new Map<number, { expiraEm: number; payload: MunicipioPainelResumo }>();

function garantirDir(): void {
  garantirDirRuntime('painel_nao_mapeados');
}

function arquivo(geocode: number): string {
  return runtimePath('painel_nao_mapeados', `${Number(geocode)}.json`);
}

function aindaValido(expiraEm: string | number): boolean {
  const t = typeof expiraEm === 'number' ? expiraEm : Date.parse(expiraEm);
  return Number.isFinite(t) && t > Date.now();
}

export function lerPainelNaoMapeadoCache(
  geocode: number,
): MunicipioPainelResumo | null {
  const gc = Number(geocode);
  if (!Number.isFinite(gc) || gc <= 0) return null;

  const mem = memoria.get(gc);
  if (mem && mem.expiraEm > Date.now()) return mem.payload;

  try {
    const f = arquivo(gc);
    if (!fs.existsSync(f)) return null;
    const env = JSON.parse(fs.readFileSync(f, 'utf8')) as Envelope;
    if (!env?.payload || !aindaValido(env.expira_em)) return null;
    const expiraEm = Date.parse(env.expira_em);
    memoria.set(gc, { payload: env.payload, expiraEm });
    return env.payload;
  } catch {
    return null;
  }
}

export function gravarPainelNaoMapeadoCache(
  resumo: MunicipioPainelResumo,
): void {
  const gc = Number(resumo?.geocode);
  if (!Number.isFinite(gc) || gc <= 0) return;

  const agora = Date.now();
  const expiraEm = agora + TTL_MS;
  const env: Envelope = {
    atualizado_em: new Date(agora).toISOString(),
    expira_em: new Date(expiraEm).toISOString(),
    payload: resumo,
  };

  try {
    garantirDir();
    const f = arquivo(gc);
    // Idempotente: envelope em disco ainda válido e mesmo fingerprint → skip write
    try {
      if (fs.existsSync(f)) {
        const prev = JSON.parse(fs.readFileSync(f, 'utf8')) as Envelope;
        if (
          prev?.payload &&
          aindaValido(prev.expira_em) &&
          prev.payload.base === resumo.base &&
          prev.payload.populacao === resumo.populacao &&
          Date.parse(prev.expira_em) - agora > TTL_MS / 2
        ) {
          memoria.set(gc, {
            payload: prev.payload,
            expiraEm: Date.parse(prev.expira_em),
          });
          return;
        }
      }
    } catch {
      /* segue para gravar */
    }

    if (!escreverJsonAtomico(f, env)) {
      throw new Error('escrita atômica falhou');
    }
    memoria.set(gc, { payload: resumo, expiraEm });

    const n = fs.readdirSync(DIR).filter((x) => /^\d+\.json$/i.test(x)).length;
    escreverJsonAtomico(runtimePath('painel_nao_mapeados', 'meta.json'), {
      atualizado_em: env.atualizado_em,
      n_arquivos: n,
      ttl_ms: TTL_MS,
      fonte: 'Painel mun. não mapeado — casos/projeção em disco',
    });
  } catch (err) {
    console.warn(
      '[painel-nao-mapeado] falha ao gravar:',
      (err as Error)?.message,
    );
  }
}

export function caminhoPainelNaoMapeadoDir(): string {
  return DIR;
}
