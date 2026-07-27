import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ElNinoPipelineService } from './el-nino-pipeline.service';

@Injectable()
export class ElNinoRefreshCronService {
  private readonly logger = new Logger(ElNinoRefreshCronService.name);

  constructor(private readonly pipeline: ElNinoPipelineService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, {
    name: 'el-nino-analytics-refresh',
    timeZone: 'America/Sao_Paulo',
  })
  async refreshDiario(): Promise<void> {
    const enabled =
      String(
        process.env.ELNINO_ANALYTICS_CRON_ENABLED ?? 'true',
      ).toLowerCase() === 'true';
    if (!enabled) {
      this.logger.debug(
        'Refresh El Niño desabilitado (ELNINO_ANALYTICS_CRON_ENABLED=false).',
      );
      return;
    }
    const inicio = Date.now();
    try {
      const pacote = await this.pipeline.refresh();
      const elapsed = ((Date.now() - inicio) / 1000).toFixed(1);
      this.logger.log(
        `Pipeline El Niño atualizado em ${elapsed}s — ${pacote.df_serie.length} meses, ${pacote.df_municipios.length} municípios, ${pacote.alertas.length} alertas regionais.`,
      );
      if (pacote.avisos.length) {
        this.logger.warn(`Avisos: ${pacote.avisos.join(' | ')}`);
      }
    } catch (err) {
      this.logger.error(
        `Falha no refresh El Niño: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
