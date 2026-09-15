import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

/** Query params del PUT: qué agenda y de qué país */
export class UpdatePickingQueryDto {
  @IsString()
  @IsNotEmpty()
  scheduleId: string;

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

/** Configuración de la agenda — varía según oficina/servicio */
export class ScheduleConfigDto {
  @IsString()
  @IsIn(['PE', 'CL'])
  country: string;

  @IsString()
  @IsNotEmpty()
  idOffice: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  typeOfService: string;

  @IsString()
  @IsNotEmpty()
  unitMeasure: string;
}

/**
 * Body del PUT. El cliente solo puede cambiar "assigned" y "active";
 * "occupied" lo resuelve el backend leyendo el estado actual.
 */
export class UpdatePickingBodyDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, {
    message: 'day debe tener formato ISO (ej. 2026-09-14T05:00:00.000Z)',
  })
  day: string;

  @IsInt()
  @Min(0)
  assigned: number;

  @IsBoolean()
  active: boolean;

  @ValidateNested()
  @Type(() => ScheduleConfigDto)
  schedule: ScheduleConfigDto;
}