import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ElNinoBairroCasosItemDto {
  @ApiProperty({ example: 'Centro' })
  nome: string;

  @ApiProperty({
    description: 'Quantidade de POIs/criadouros mapeados na TechDengue',
    example: 386,
  })
  pois: number;

  @ApiProperty({
    description:
      'Casos notificados estimados para o bairro (repartição proporcional aos POIs)',
    example: 120,
  })
  casos_notificados: number;

  @ApiProperty({
    description:
      'Casos estimados (Infodengue) repartidos proporcionalmente aos POIs',
    example: 95,
  })
  casos_estimados: number;

  @ApiProperty({ example: 29.4 })
  percentual_pois: number;

  @ApiProperty({ example: 29.0 })
  percentual_casos_notificados: number;

  @ApiPropertyOptional({
    description: 'Tipos de criadouros identificados no bairro',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  tipos_criadouros?: Record<string, number>;
}

export class ElNinoCasosPorBairroResponseDto {
  @ApiProperty({ example: 3167202 })
  geocode: number;

  @ApiProperty({ example: 649 })
  idMunicipio: number;

  @ApiProperty({ example: 'Sabará' })
  nomeMunicipio: string;

  @ApiProperty({ example: 1540 })
  casos_notificados_municipio: number;

  @ApiProperty({ example: 1820 })
  casos_estimados_municipio: number;

  @ApiProperty({ example: 1315 })
  total_pois_municipio: number;

  @ApiProperty({
    example: 'distribuicao_proporcional_pois',
    description:
      'Método de alocação: casos municipais (Infodengue) × proporção de POIs por bairro (TechDengue)',
  })
  metodo: string;

  @ApiProperty({ type: [String] })
  fontes: string[];

  @ApiProperty({ type: [String] })
  avisos: string[];

  @ApiProperty({ type: [ElNinoBairroCasosItemDto] })
  bairros: ElNinoBairroCasosItemDto[];

  @ApiProperty()
  atualizado_em: string;
}

export class ElNinoGeojsonBairroPropertiesDto {
  @ApiPropertyOptional({ example: 1234 })
  area_id?: number;

  @ApiProperty({ example: 'CENTRO' })
  nome: string;

  @ApiProperty({ example: 386 })
  pois: number;

  @ApiProperty({
    description: 'Hectares únicos do bairro após remoção de sobreposição.',
    example: 12.3456,
  })
  hectares_unicos: number;

  @ApiPropertyOptional({ example: 7020 })
  id_sistema?: number | null;

  @ApiPropertyOptional({ example: 'ATV.82.1' })
  id_atividade?: string | null;

  @ApiProperty({
    description: 'Método geométrico usado para atribuir/remover overlap.',
    example: 'area_mapeada_direta',
  })
  metodo_atribuicao: string;

  @ApiProperty({
    description: 'Fonte da geometria usada na resposta.',
    example: 'area_mapeadas',
  })
  fonte_geom: string;

  @ApiProperty({
    description:
      'Critério de precedência usado quando havia conflito espacial.',
    example:
      'bairro_explicito>pois>atividade_recente>maior_intersecao>desempate_estavel',
  })
  criterio_atribuicao: string;
}

export class ElNinoAreaMapeadaProblemaDto {
  @ApiProperty()
  id: number;

  @ApiPropertyOptional()
  id_sistema: number | null;

  @ApiPropertyOptional()
  name: string | null;

  @ApiPropertyOptional()
  cd_mun: string | null;

  @ApiProperty({ enum: ['sem_cd_mun', 'sem_geom', 'geom_vazia'] })
  motivo: 'sem_cd_mun' | 'sem_geom' | 'geom_vazia';
}

export class ElNinoAreasMapeadasAuditDto {
  @ApiProperty()
  geocode: number;

  @ApiProperty({ type: [String] })
  cd_mun_variantes: string[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  resumo: {
    total_no_municipio: number;
    com_geom_valida: number;
    sem_geom: number;
    sem_cd_mun: number;
  };

  @ApiProperty({ type: [Number] })
  id_sistemas: number[];

  @ApiProperty({ type: [Number] })
  id_sistemas_problematicos: number[];

  @ApiProperty({ type: [ElNinoAreaMapeadaProblemaDto] })
  areas_problematicas: ElNinoAreaMapeadaProblemaDto[];
}

export class ElNinoGeojsonBairroFeatureDto {
  @ApiProperty({ example: 'Feature' })
  type: 'Feature';

  @ApiProperty({ type: ElNinoGeojsonBairroPropertiesDto })
  properties: ElNinoGeojsonBairroPropertiesDto;

  @ApiProperty({
    description: 'Geometria GeoJSON do bairro.',
    type: 'object',
    additionalProperties: true,
  })
  geometry: Record<string, unknown>;
}

export class ElNinoGeojsonBairrosResponseDto {
  @ApiProperty({ example: 'FeatureCollection' })
  type: 'FeatureCollection';

  @ApiProperty({ example: 3167202 })
  geocode: number;

  @ApiProperty({ example: 649 })
  idMunicipio: number;

  @ApiProperty({ example: 'Sabará' })
  nomeMunicipio: string;

  @ApiProperty({
    example: 'areas_mapeadas',
    description:
      'Origem da geometria final retornada. `indisponivel` = sem áreas mapeadas válidas (sem envoltória de POIs).',
  })
  modo: 'areas_mapeadas' | 'indisponivel';

  @ApiPropertyOptional({
    description:
      'id_sistema distintos em area_mapeadas para o município (quando modo=indisponivel ou features vazias).',
    type: [Number],
  })
  id_sistemas?: number[];

  @ApiPropertyOptional({
    description: 'id_sistema com cd_mun ausente ou geometria inválida.',
    type: [Number],
  })
  id_sistemas_problematicos?: number[];

  @ApiPropertyOptional({
    description: 'id_sistema das atividades do município (cliente_id).',
    type: [Number],
  })
  id_sistemas_municipio?: number[];

  @ApiPropertyOptional({
    description: 'Auditoria PostGIS de area_mapeadas para diagnóstico.',
    type: ElNinoAreasMapeadasAuditDto,
  })
  areas_audit?: ElNinoAreasMapeadasAuditDto | null;

  @ApiProperty({ example: 1315 })
  total_pois: number;

  @ApiProperty({ type: [String] })
  fontes: string[];

  @ApiProperty({ type: [String] })
  avisos: string[];

  @ApiProperty({ type: [ElNinoGeojsonBairroFeatureDto] })
  features: ElNinoGeojsonBairroFeatureDto[];

  @ApiProperty()
  atualizado_em: string;
}
