import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ElNinoAnalyticsController } from '../controllers/el-nino-analytics.controller';
import { ElNinoPipelineService } from '../../application/services/el-nino-analytics/el-nino-pipeline.service';
import { ElNinoAlertasService } from '../../application/services/el-nino-analytics/el-nino-alertas.service';
import { ElNinoRefreshCronService } from '../../application/services/el-nino-analytics/el-nino-refresh-cron.service';
import { ElNinoScopeService } from '../../application/services/el-nino-analytics/el-nino-scope.service';
import { ElNinoProjecaoService } from '../../application/services/el-nino-analytics/el-nino-projecao.service';
import { NoaaOniService } from '../../application/services/el-nino-analytics/noaa-oni.service';
import { OpenMeteoService } from '../../application/services/el-nino-analytics/open-meteo.service';
import { InfodengueService } from '../../application/services/el-nino-analytics/infodengue.service';
import { IbgeMgService } from '../../application/services/el-nino-analytics/ibge-mg.service';
import { IbgeSidraAreaService } from '../../application/services/el-nino-analytics/ibge-sidra-area.service';
import { CopernicusCdsService } from '../../application/services/el-nino-analytics/copernicus-cds.service';
import { ClimaHistoricoStoreService } from '../../application/services/el-nino-analytics/clima-historico-store.service';
import { InmetWis2Service } from '../../application/services/el-nino-analytics/inmet-wis2.service';
import { ElNinoCasosPorBairroService } from '../../application/services/el-nino-analytics/el-nino-casos-por-bairro.service';
import { UserModule } from './user.module';
import { TerritorialScopeModule } from './territorial-scope.module';
import { DadosGerenciaisModule } from './dados-gerenciais.module';
import { RolePermissionGuard } from '../../shared/guards/role-permission.guard';
import { CacheService } from '../../shared/services/cache.service';
import { Municipio } from '../../domain/entities/municipio.entity';
import { ContratoPostgres } from '../../domain/entities/contrato-postgres.entity';
import { UrsGeografico } from '../../domain/entities/urs-geografico.entity';
import { Estado } from '../../domain/entities/estado.entity';

@Module({
  imports: [
    HttpModule.register({
      timeout: 60000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'TechDengue-Backend/El-Nino-Analytics' },
    }),
    ConfigModule,
    forwardRef(() => UserModule), // USER_REPOSITORY_TOKEN para RolePermissionGuard
    TerritorialScopeModule, // exporta TerritorialScopeService
    DadosGerenciaisModule, // POIs/criadouros por bairro
    TypeOrmModule.forFeature([
      Municipio,
      ContratoPostgres,
      UrsGeografico,
      Estado,
    ]),
  ],
  controllers: [ElNinoAnalyticsController],
  providers: [
    // Serviços de dados externos
    NoaaOniService,
    OpenMeteoService,
    InfodengueService,
    IbgeMgService,
    IbgeSidraAreaService,
    CopernicusCdsService, // ERA5/SEAS5 via Python (novo)
    InmetWis2Service, // Alertas meteorológicos INMET (novo)
    // Serviços de análise
    ElNinoAlertasService,
    ElNinoProjecaoService, // Projeção epidemiológica (novo)
    ElNinoPipelineService,
    ElNinoScopeService,
    ElNinoRefreshCronService,
    ElNinoCasosPorBairroService,
    ClimaHistoricoStoreService,
    // Infra
    CacheService,
    RolePermissionGuard,
  ],
  exports: [ElNinoPipelineService, ElNinoScopeService, ElNinoProjecaoService],
})
export class ElNinoAnalyticsModule {}
