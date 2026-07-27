import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../shared/services/cache.service';
import { CACHE_KEYS, CACHE_TTL, MunicipioFoco, MESES } from './constants';
import {
  validarTemperatura,
  validarPrecipitacao,
  validarCasos,
} from './formatacao';
import { ClimaMensalMunicipio } from './open-meteo.service';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ÔöÇÔöÇÔöÇ Interfaces ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

/** Venv criado no Dockerfile de producao (Koyeb). */
export const CDS_PYTHON_VENV_PADRAO = '/opt/cdsapi-venv/bin/python';

/** Script ERA5/SEAS5 no container Docker. */
export const CDS_SCRIPT_PADRAO_DOCKER = '/app/scripts/cds_clima_elnino.py';

export function resolverPythonBin(
  configBin: string | undefined,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const configured = (configBin ?? '').trim();
  if (configured) {
    if (path.isAbsolute(configured)) {
      if (exists(configured)) return configured;
    } else {
      return configured;
    }
  }

  if (exists(CDS_PYTHON_VENV_PADRAO)) return CDS_PYTHON_VENV_PADRAO;
  return platform === 'win32' ? 'python' : 'python3';
}

const CDS_URL_PADRAO = 'https://cds.climate.copernicus.eu/api';

export interface CredenciaisCds {
  url: string;
  key: string;
}

/** Lê url/key do ~/.cdsapirc (formato `url:` / `key:`). */
export function lerCredenciaisCdsapirc(
  homeDir: string = os.homedir(),
  exists: (p: string) => boolean = fs.existsSync,
  readFile: (p: string) => string = (p) => fs.readFileSync(p, 'utf-8'),
): CredenciaisCds | null {
  const arquivo = path.join(homeDir, '.cdsapirc');
  if (!exists(arquivo)) return null;

  let url = '';
  let key = '';
  for (const line of readFile(arquivo).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(url|key)\s*[:=]\s*(.+)$/i);
    if (!match) continue;
    if (match[1].toLowerCase() === 'url') url = match[2].trim();
    if (match[1].toLowerCase() === 'key') key = match[2].trim();
  }

  if (!key) return null;
  return { url: url || CDS_URL_PADRAO, key };
}

/** Prioriza CDSAPI_KEY/URL do .env; senão usa ~/.cdsapirc. */
export function resolverCredenciaisCds(
  configKey?: string,
  configUrl?: string,
  homeDir?: string,
  exists: (p: string) => boolean = fs.existsSync,
  readFile: (p: string) => string = (p) => fs.readFileSync(p, 'utf-8'),
): CredenciaisCds | null {
  const key = (configKey ?? '').trim();
  const url = (configUrl ?? '').trim();
  if (key) {
    return { key, url: url || CDS_URL_PADRAO };
  }
  return lerCredenciaisCdsapirc(homeDir, exists, readFile);
}

export function resolverSslVerify(
  configValue: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = (configValue ?? '').trim();
  if (configured) return configured;
  if (nodeEnv !== 'production' && platform === 'win32') return '0';
  return '1';
}

export function resolverScriptCopernicus(
  configPath: string | undefined,
  cwd: string = process.cwd(),
  exists: (p: string) => boolean = fs.existsSync,
): string | null {
  const candidatos = [
    (configPath ?? '').trim(),
    CDS_SCRIPT_PADRAO_DOCKER,
    path.join(cwd, 'scripts', 'cds_clima_elnino.py'),
    path.join(cwd, 'src', 'scripts', 'cds_clima_elnino.py'),
  ].filter((p): p is string => !!p);

  for (const candidato of candidatos) {
    try {
      if (exists(candidato)) return candidato;
    } catch {
      /* skip */
    }
  }
  return null;
}
export interface CopernicusClimaRow {
  geocode: number;
  municipio: string;
  Ano: number;
  MesNum: number;
  Mes: string;
  Temperatura: number;
  TempMax: number;
  Precipitacao: number;
  Umidade: number;
  /** "obs" = ERA5 hist├│rico, "proj" = SEAS5 proje├º├úo */
  tipo: 'obs' | 'proj';
  fonte: string;
}

export interface CopernicusStatus {
  disponivel: boolean;
  pythonPath: string | null;
  scriptPath: string | null;
  erro?: string;
}

// ÔöÇÔöÇÔöÇ Servi├ºo ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

/**
 * CopernicusCdsService ÔÇö integra ERA5 (hist├│rico) e SEAS5 (proje├º├úo) via
 * Copernicus Climate Data Store (CDS). Executa um script Python externo
 * (`scripts/cds_clima_elnino.py`) usando `child_process.spawn`.
 *
 * Padr├úo do pipeline: Open-Meteo Archive primeiro; ERA5 complementa lacunas.
 * CDS s├│ ├® consultado quando Open-Meteo falha ou retorna dados incompletos.
 *
 * Pr├®-requisitos no servidor:
 *   - Python 3.x com `cdsapi` instalado (`pip install cdsapi`)
 *   - Vari├ível de ambiente `CDSAPI_KEY` ou `CDSAPI_URL` configuradas
 *   - Ou arquivo `~/.cdsapirc` com as credenciais
 */
@Injectable()
export class CopernicusCdsService {
  private readonly logger = new Logger(CopernicusCdsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  // ÔöÇÔöÇÔöÇ Verifica├º├úo de disponibilidade ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  async verificarDisponibilidade(): Promise<CopernicusStatus> {
    const pythonPath = await this.encontrarPython();
    const scriptPath = this.resolverScriptPath();

    if (!pythonPath) {
      return {
        disponivel: false,
        pythonPath: null,
        scriptPath,
        erro: 'Python 3 não encontrado no servidor. Instale python3 e cdsapi.',
      };
    }

    if (!scriptPath || !fs.existsSync(scriptPath)) {
      return {
        disponivel: false,
        pythonPath,
        scriptPath,
        erro: `Script Python não encontrado em: ${scriptPath}`,
      };
    }

    const credenciais = resolverCredenciaisCds(
      this.config.get<string>('CDSAPI_KEY'),
      this.config.get<string>('CDSAPI_URL'),
    );

    if (!credenciais) {
      return {
        disponivel: false,
        pythonPath,
        scriptPath,
        erro: 'Credenciais Copernicus CDS ausentes. Configure CDSAPI_KEY ou ~/.cdsapirc.',
      };
    }

    return { disponivel: true, pythonPath, scriptPath };
  }

  // ÔöÇÔöÇÔöÇ Carregamento principal ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  /**
   * Carrega dados clim├íticos ERA5 via CDS para os munic├¡pios fornecidos.
   * Retorna array vazio se CDS indispon├¡vel (pipeline usa Open-Meteo como fallback).
   */
  async carregarClimaMunicipios(
    municipios: MunicipioFoco[],
    anoInicio: number,
    anoFim: number,
    forceRefresh = false,
  ): Promise<CopernicusClimaRow[]> {
    if (!municipios.length) return [];

    const cacheKey = this.cache.generateKey(
      CACHE_KEYS.CLIMA_COPERNICUS,
      municipios
        .map((m) => m.geocode)
        .sort((a, b) => a - b)
        .join('-'),
      anoInicio,
      anoFim,
    );

    if (!forceRefresh) {
      const cached = await this.cache.getAsync<CopernicusClimaRow[]>(cacheKey);
      if (cached?.length) return cached;
    }

    const status = await this.verificarDisponibilidade();
    if (!status.disponivel) {
      this.logger.warn(
        `Copernicus CDS indisponível: ${status.erro}. Usando Open-Meteo como fallback.`,
      );
      return [];
    }

    try {
      const linhas = await this.executarScriptPython(
        status.pythonPath!,
        status.scriptPath!,
        municipios,
        anoInicio,
        anoFim,
      );
      if (linhas.length) {
        await this.cache.setAsync(
          cacheKey,
          linhas,
          CACHE_TTL.CLIMA_COPERNICUS_MS,
        );
      }
      return linhas;
    } catch (err) {
      this.logger.warn(
        `Copernicus CDS falhou: ${(err as Error).message}. Usando Open-Meteo como fallback.`,
      );
      return [];
    }
  }

  /**
   * Mescla clima hist├│rico: Open-Meteo (padr├úo); ERA5 preenche lacunas ou linhas inv├ílidas.
   */
  mesclarClimaHistorico(
    openMeteo: ClimaMensalMunicipio[],
    era5: CopernicusClimaRow[],
  ): ClimaMensalMunicipio[] {
    const linhaValida = (row: {
      Temperatura?: number;
      Precipitacao?: number;
      Umidade?: number;
    }) => {
      const temp = Number(row.Temperatura);
      const chuva = Number(row.Precipitacao);
      const umid = Number(row.Umidade);
      return (
        (Number.isFinite(temp) && temp > 0) ||
        (Number.isFinite(chuva) && chuva > 0) ||
        (Number.isFinite(umid) && umid > 0)
      );
    };

    const mapa = new Map<string, ClimaMensalMunicipio>();

    for (const row of era5) {
      const k = `${row.geocode}-${row.Ano}-${row.MesNum}`;
      if (!linhaValida(row)) continue;
      mapa.set(k, {
        geocode: row.geocode,
        municipio: row.municipio,
        Ano: row.Ano,
        MesNum: row.MesNum,
        Mes: row.Mes,
        Temperatura: row.Temperatura,
        TempMax: row.TempMax,
        Precipitacao: row.Precipitacao,
        Umidade: row.Umidade,
      });
    }

    for (const row of openMeteo) {
      const k = `${row.geocode}-${row.Ano}-${row.MesNum}`;
      if (linhaValida(row)) {
        mapa.set(k, row);
      } else if (!mapa.has(k)) {
        mapa.set(k, row);
      }
    }

    return Array.from(mapa.values()).sort(
      (a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum,
    );
  }

  /** @deprecated use mesclarClimaHistorico */
  mesclarComOpenMeteo(
    copernicus: CopernicusClimaRow[],
    openMeteo: ClimaMensalMunicipio[],
  ): ClimaMensalMunicipio[] {
    return this.mesclarClimaHistorico(openMeteo, copernicus);
  }

  coberturaClimaCompleta(
    clima: ClimaMensalMunicipio[],
    casos: Array<{ geocode: number; Ano: number; MesNum: number }>,
  ): boolean {
    if (!clima.length || !casos.length) return false;
    const linhaValida = (row?: ClimaMensalMunicipio) => {
      if (!row) return false;
      const temp = Number(row.Temperatura);
      const chuva = Number(row.Precipitacao);
      const umid = Number(row.Umidade);
      return (
        (Number.isFinite(temp) && temp > 0) ||
        (Number.isFinite(chuva) && chuva > 0) ||
        (Number.isFinite(umid) && umid > 0)
      );
    };
    const mapa = new Map(
      clima.map((c) => [`${c.geocode}-${c.Ano}-${c.MesNum}`, c]),
    );
    return casos.every((r) =>
      linhaValida(mapa.get(`${r.geocode}-${r.Ano}-${r.MesNum}`)),
    );
  }

  // ÔöÇÔöÇÔöÇ Execu├º├úo do script Python ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  private executarScriptPython(
    pythonPath: string,
    scriptPath: string,
    municipios: MunicipioFoco[],
    anoInicio: number,
    anoFim: number,
  ): Promise<CopernicusClimaRow[]> {
    return new Promise((resolve, reject) => {
      const janela = Math.max(1, anoFim - anoInicio + 1);
      const env: Record<string, string> = {
        ...process.env,
        ERA5_ANOS_JANELA: String(janela),
        SEAS5_HABILITADO: this.config.get<string>('SEAS5_HABILITADO') ?? '0',
      };

      const credenciais = resolverCredenciaisCds(
        this.config.get<string>('CDSAPI_KEY'),
        this.config.get<string>('CDSAPI_URL'),
      );
      if (credenciais) {
        env.CDSAPI_KEY = credenciais.key;
        env.CDSAPI_URL = credenciais.url;
      }
      env.CDS_SSL_VERIFY = resolverSslVerify(
        this.config.get<string>('CDS_SSL_VERIFY'),
      );

      const input = JSON.stringify({
        municipios: municipios.map((m) => ({
          geocode: m.geocode,
          nome: m.municipio,
          lat: m.lat,
          lon: m.lon,
        })),
      });

      const proc = spawn(pythonPath, [scriptPath], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('timeout (120s) executando script Copernicus'));
      }, 120_000);

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Erro ao executar script Python: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(
            new Error(
              `Script Python saiu com codigo ${code}. stderr: ${stderr.slice(0, 500)}`,
            ),
          );
          return;
        }
        try {
          const linhas = this.parsearSaidaPython(
            stdout.trim(),
            anoInicio,
            anoFim,
          );
          this.logger.log(
            `Copernicus CDS: ${linhas.length} linhas carregadas (municipios: ${municipios.length}, ${anoInicio}-${anoFim})`,
          );
          resolve(linhas);
        } catch (err) {
          reject(
            new Error(
              `Falha ao parsear saida do script Python: ${(err as Error).message}`,
            ),
          );
        }
      });

      proc.stdin.write(input);
      proc.stdin.end();
    });
  }

  /**
   * Parseia a saida JSON do script Python.
   * Formato esperado: { "linhas": [...] } (contrato MERGE_HEAD).
   */
  private parsearSaidaPython(
    stdout: string,
    anoInicio: number,
    anoFim: number,
  ): CopernicusClimaRow[] {
    if (!stdout) return [];

    const inicioJson = stdout.indexOf('{');
    const fimJson = stdout.lastIndexOf('}');
    if (inicioJson === -1 || fimJson === -1) {
      throw new Error('Saida do script nao contem JSON valido.');
    }

    const parsed = JSON.parse(stdout.slice(inicioJson, fimJson + 1)) as {
      linhas?: Array<Record<string, unknown>>;
    };
    const raw = parsed.linhas ?? [];

    return raw
      .map((r) => {
        const ano = Number(r.Ano ?? r.ano);
        const mes = Number(r.MesNum ?? r.mes);
        const fonte = String(r.fonte ?? 'ERA5');
        return {
          geocode: Number(r.geocode),
          municipio: String(r.municipio ?? ''),
          Ano: ano,
          MesNum: mes,
          Mes: String(r.Mes ?? MESES[mes - 1] ?? ''),
          Temperatura: validarTemperatura(
            Number(r.Temperatura ?? r.temperatura ?? 0),
          ),
          TempMax: validarTemperatura(
            Number(r.TempMax ?? r.temp_max ?? Number(r.temperatura ?? 0) + 3),
          ),
          Precipitacao: validarPrecipitacao(
            Number(r.Precipitacao ?? r.precipitacao ?? 0),
          ),
          Umidade: validarCasos(Number(r.Umidade ?? r.umidade ?? 0)),
          tipo: fonte.toUpperCase().includes('SEAS5')
            ? ('proj' as const)
            : ('obs' as const),
          fonte: `Copernicus ${fonte}`,
        };
      })
      .filter((r) => r.Ano >= anoInicio && r.Ano <= anoFim);
  }

  // ÔöÇÔöÇÔöÇ Utilit├írios ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  private async encontrarPython(): Promise<string | null> {
    const bin = resolverPythonBin(this.config.get<string>('PYTHON_BIN'));
    if (path.isAbsolute(bin)) {
      return fs.existsSync(bin) ? bin : null;
    }
    try {
      await this.executarComando(bin, ['--version']);
      return bin;
    } catch {
      /* fall through */
    }

    const candidatos =
      process.platform === 'win32'
        ? ['python', 'python3', 'py']
        : ['python3', 'python'];

    for (const cmd of candidatos) {
      if (cmd === bin) continue;
      try {
        await this.executarComando(cmd, ['--version']);
        return cmd;
      } catch {
        /* continua tentando proximos candidatos */
      }
    }
    return null;
  }

  private executarComando(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { timeout: 5000 });
      let out = '';
      proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
      proc.stderr.on('data', (d: Buffer) => (out += d.toString()));
      proc.on('close', (code) => {
        if (code === 0 || out.toLowerCase().includes('python')) {
          resolve(out.trim());
        } else {
          reject(new Error(`Código ${code}`));
        }
      });
      proc.on('error', reject);
    });
  }

  private resolverScriptPath(): string | null {
    const resolved = resolverScriptCopernicus(
      this.config.get<string>('COPERNICUS_SCRIPT_PATH'),
      process.cwd(),
    );
    if (resolved) return resolved;
    return path.join(process.cwd(), 'scripts', 'cds_clima_elnino.py');
  }
}
