import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, Min } from 'class-validator';

function toNumberArray(value: unknown): number[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const arr = Array.isArray(value) ? value : String(value).split(',');
  const nums = arr
    .map((v) => Number(String(v).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? nums : undefined;
}

/** DTO base para todos os endpoints El Nino. */
export class ElNinoGeocodeQueryDto {
  @ApiPropertyOptional({
    description:
      'Geocode IBGE do municipio (deixe vazio para visao agregada do escopo).',
    example: 3106200,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  geocode?: number;

  @ApiPropertyOptional({
    description:
      'Lista de geocodes IBGE (CSV ou repetido). Quando ausente, usa todo o escopo do usuario.',
    example: '3106200,3118601',
    type: [Number],
  })
  @IsOptional()
  @Transform(({ value }) => toNumberArray(value))
  @IsArray()
  geocodes?: number[];

  @ApiPropertyOptional({
    description:
      'Estrategia de agregacao para visoes grupais (consorcio/URS/estado).',
    enum: ['soma', 'ponderada'],
    example: 'ponderada',
  })
  @IsOptional()
  @IsIn(['soma', 'ponderada'])
  agregacao?: 'soma' | 'ponderada';

  @ApiPropertyOptional({
    description:
      'Quando "1", forca refresh do cache (apenas roles administrativas).',
    example: '0',
    enum: ['0', '1'],
  })
  @IsOptional()
  @IsIn(['0', '1'])
  refresh?: '0' | '1';

  @ApiPropertyOptional({
    description:
      'ID do contrato/consorcio (opcional; aceito para compatibilidade com o frontend).',
    example: 19,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  contratoId?: number;

  @ApiPropertyOptional({
    description:
      'Ano inicial do recorte de serie/historico (default: ANO_INICIO do pipeline).',
    example: 2021,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(2000)
  ano_inicio?: number;

  @ApiPropertyOptional({
    description:
      'Ano final do recorte de serie/historico (default: ANO_FIM do pipeline).',
    example: 2025,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(2000)
  ano_fim?: number;

  @ApiPropertyOptional({
    description:
      'Visão gerencial agregada (todos os contratos do escopo global). Aceito para compatibilidade com o frontend; o escopo efetiva-se via usuário autenticado.',
    enum: ['todos'],
    example: 'todos',
  })
  @IsOptional()
  @IsIn(['todos'])
  visao?: 'todos';
}

/**
 * @deprecated Mantido por compatibilidade ? `ano_inicio` e `ano_fim` agora
 * estao na classe base `ElNinoGeocodeQueryDto`.
 */
export class ElNinoSerieQueryDto extends ElNinoGeocodeQueryDto {}

export class ElNinoClimaQueryDto extends ElNinoGeocodeQueryDto {
  @ApiPropertyOptional({
    description:
      'Use "previsao" (padrão). Anos históricos: GET /clima-historico.',
    example: 'previsao',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? 'previsao' : String(value),
  )
  ano?: string;
}

export class ElNinoOverviewQueryDto extends ElNinoGeocodeQueryDto {}

export class ElNinoAlertasQueryDto extends ElNinoGeocodeQueryDto {}

export class ElNinoCasosPorBairroQueryDto extends ElNinoGeocodeQueryDto {
  @ApiPropertyOptional({
    description:
      'ID interno do municipio na TechDengue (opcional ? resolvido pelo geocode quando omitido)',
    example: 649,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  idMunicipio?: number;

  @ApiPropertyOptional({
    description: 'ID do contrato (verba direta) para filtrar POIs',
    example: 70,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  idContrato?: number;

  @ApiPropertyOptional({
    description: 'Limite de bairros no ranking (default 12, max. 100)',
    example: 12,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  limit?: number;
}
