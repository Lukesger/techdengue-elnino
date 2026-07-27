import { ApiProperty } from '@nestjs/swagger';

export class KpiDto {
  @ApiProperty() titulo!: string;
  @ApiProperty() valor!: string;
  @ApiProperty({ required: false }) subtitulo?: string;
}

export class KpiRespostaDto {
  @ApiProperty({ type: [KpiDto] }) kpis!: KpiDto[];
}
