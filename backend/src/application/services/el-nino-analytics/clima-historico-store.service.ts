import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { ANO_FIM, ANO_INICIO } from './constants';
import { ClimaMensalMunicipio } from './open-meteo.service';

export interface ClimaHistoricoPayload {
  atualizado_em: string;
  ano_inicio: number;
  ano_fim: number;
  fonte: string;
  linhas: ClimaMensalMunicipio[];
}

/**
 * Persistência em JSON do clima histórico (ERA5/Open-Meteo).
 * Consultas normais leem do disco — APIs externas só no refresh/admin.
 */
@Injectable()
export class ClimaHistoricoStoreService {
  private readonly logger = new Logger(ClimaHistoricoStoreService.name);

  constructor(private readonly config: ConfigService) {}

  private resolveDir(): string {
    const configured = (
      this.config.get<string>('EL_NINO_DATA_DIR') ?? ''
    ).trim();
    if (configured) return path.resolve(configured);
    return path.join(process.cwd(), 'data', 'el-nino');
  }

  private resolvePath(): string {
    const file =
      (this.config.get<string>('EL_NINO_CLIMA_HISTORICO_JSON') ?? '').trim() ||
      'clima_historico.json';
    return path.isAbsolute(file) ? file : path.join(this.resolveDir(), file);
  }

  private garantirDir(arquivo: string): void {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  }

  private lerPayload(): ClimaHistoricoPayload | null {
    const arquivo = this.resolvePath();
    try {
      if (!fs.existsSync(arquivo)) return null;
      const raw = JSON.parse(
        fs.readFileSync(arquivo, 'utf-8'),
      ) as ClimaHistoricoPayload;
      if (!raw || !Array.isArray(raw.linhas)) return null;
      return raw;
    } catch (err) {
      this.logger.warn(`Falha ao ler ${arquivo}: ${(err as Error).message}`);
      return null;
    }
  }

  metaAtualizadoEm(): string | null {
    return this.lerPayload()?.atualizado_em ?? null;
  }

  lerTodas(): ClimaMensalMunicipio[] {
    return this.lerPayload()?.linhas ?? [];
  }

  filtrar(
    linhas: ClimaMensalMunicipio[],
    opts: {
      geocodes?: number[];
      anoInicio?: number;
      anoFim?: number;
    },
  ): ClimaMensalMunicipio[] {
    const geoSet = opts.geocodes?.length
      ? new Set(opts.geocodes.map((g) => Number(g)))
      : null;
    const ai = opts.anoInicio ?? ANO_INICIO;
    const af = opts.anoFim ?? ANO_FIM;

    return linhas
      .filter((r) => {
        if (geoSet && !geoSet.has(Number(r.geocode))) return false;
        return r.Ano >= ai && r.Ano <= af;
      })
      .sort((a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum);
  }

  carregarPorMunicipios(
    geocodes: number[],
    anoInicio = ANO_INICIO,
    anoFim = ANO_FIM,
  ): ClimaMensalMunicipio[] {
    return this.filtrar(this.lerTodas(), {
      geocodes,
      anoInicio,
      anoFim,
    });
  }

  salvarMesclado(
    novasLinhas: ClimaMensalMunicipio[],
    meta?: { fonte?: string },
  ): void {
    if (!novasLinhas.length) return;

    const arquivo = this.resolvePath();
    const atual = this.lerPayload();
    const map = new Map<string, ClimaMensalMunicipio>();

    for (const r of atual?.linhas ?? []) {
      map.set(`${r.geocode}-${r.Ano}-${r.MesNum}`, r);
    }

    for (const r of novasLinhas) {
      const temp = Number(r.Temperatura);
      const chuva = Number(r.Precipitacao);
      const umid = Number(r.Umidade);
      const valida =
        (Number.isFinite(temp) && temp > 0) ||
        (Number.isFinite(chuva) && chuva > 0) ||
        (Number.isFinite(umid) && umid > 0);
      if (valida) {
        map.set(`${r.geocode}-${r.Ano}-${r.MesNum}`, r);
      }
    }

    const linhas = Array.from(map.values()).sort(
      (a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum || a.geocode - b.geocode,
    );

    const payload: ClimaHistoricoPayload = {
      atualizado_em: new Date().toISOString(),
      ano_inicio: atual?.ano_inicio ?? ANO_INICIO,
      ano_fim: Math.max(atual?.ano_fim ?? ANO_FIM, ANO_FIM),
      fonte:
        meta?.fonte ?? atual?.fonte ?? 'Open-Meteo Archive / Copernicus ERA5',
      linhas,
    };

    try {
      this.garantirDir(arquivo);
      const tmp = `${arquivo}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
      fs.renameSync(tmp, arquivo);
      this.logger.log(
        `Clima histórico salvo (${linhas.length} linhas) em ${arquivo}`,
      );
    } catch (err) {
      this.logger.warn(
        `Falha ao salvar clima histórico: ${(err as Error).message}`,
      );
    }
  }
}
