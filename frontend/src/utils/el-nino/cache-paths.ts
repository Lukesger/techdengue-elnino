/**
 * Paths de dados El Niño — SOMENTE server (API routes / Node).
 * Nunca importar este módulo em componentes cliente.
 *
 * - Seed (versionado, read-only no hot path): src/utils/el-nino/data
 * - Runtime (gravável, fora do watcher do Next): .cache/el-nino
 */
import fs from 'fs';
import path from 'path';

export const RUNTIME_DIR_RELATIVO = '.cache/el-nino';

export const DATA_SEED_DIR = path.join(
  process.cwd(),
  'src',
  'utils',
  'el-nino',
  'data',
);

export const DATA_RUNTIME_DIR = path.join(process.cwd(), '.cache', 'el-nino');

/** Path absoluto sob o seed versionado. */
export function seedPath(...parts: string[]): string {
  return path.join(DATA_SEED_DIR, ...parts);
}

/** Path absoluto sob o cache runtime (.cache/el-nino). */
export function runtimePath(...parts: string[]): string {
  return path.join(DATA_RUNTIME_DIR, ...parts);
}

export function garantirDirRuntime(...parts: string[]): string {
  const dir = parts.length ? runtimePath(...parts) : DATA_RUNTIME_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Escrita atômica: tmp + rename.
 * Best-effort — falhas de disco não derrubam o request.
 */
export function escreverJsonAtomico(arquivo: string, data: unknown): boolean {
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const payload =
      typeof data === 'string' ? data : JSON.stringify(data);
    const tmp = `${arquivo}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, arquivo);
    return true;
  } catch {
    return false;
  }
}
