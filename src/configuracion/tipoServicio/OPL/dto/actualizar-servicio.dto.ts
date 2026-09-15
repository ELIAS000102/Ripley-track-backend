import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ListarServiciosDto } from './buscar-opl.dto.js';

/** Hora de corte de un día concreto */
export class CorteDto {
  /** 1 = lunes … 7 = domingo */
  @IsInt()
  @Min(1)
  @Max(7)
  id: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'value debe tener el formato HH:MM en 24 horas',
  })
  value: string;
}

/**
 * Todos los campos editables son opcionales:
 * lo que no se envía conserva el valor que tenga hoy en la API.
 */
export class ActualizarServicioDto extends ListarServiciosDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  enabledForCheckout?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxOcurrence?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  slackDays?: number;

  /** Solo los días que cambian; el resto mantiene su hora actual */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => CorteDto)
  cortes?: CorteDto[];
}