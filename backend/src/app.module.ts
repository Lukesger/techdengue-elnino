import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { ElNinoSlimController } from './interfaces/controllers/el-nino-slim.controller';
import { ElNinoPipelineService } from './application/services/el-nino-analytics/el-nino-pipeline.service';
import { ElNinoAlertasService } from './application/services/el-nino-analytics/el-nino-alertas.service';
import { NoaaOniService } from './application/services/el-nino-analytics/noaa-oni.service';
import { OpenMeteoService } from './application/services/el-nino-analytics/open-meteo.service';
import { InfodengueService } from './application/services/el-nino-analytics/infodengue.service';
import { IbgeMgService } from './application/services/el-nino-analytics/ibge-mg.service';
import { CopernicusCdsService } from './application/services/el-nino-analytics/copernicus-cds.service';
import { ClimaHistoricoStoreService } from './application/services/el-nino-analytics/clima-historico-store.service';
import { InmetWis2Service } from './application/services/el-nino-analytics/inmet-wis2.service';
import { CacheService } from './shared/services/cache.service';
import { DemoAuthGuard } from './shared/guards/demo-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HttpModule.register({
      timeout: 60_000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'TechDengue-ElNino-Monorepo/1.0' },
    }),
  ],
  controllers: [ElNinoSlimController],
  providers: [
    CacheService,
    DemoAuthGuard,
    NoaaOniService,
    OpenMeteoService,
    InfodengueService,
    IbgeMgService,
    CopernicusCdsService,
    InmetWis2Service,
    ElNinoAlertasService,
    ElNinoPipelineService,
    ClimaHistoricoStoreService,
  ],
})
export class AppModule {}
