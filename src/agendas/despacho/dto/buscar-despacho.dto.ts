import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaisDto } from '../../../common/dto/pais.dto.js';

const FECHA = /^\d{2}-\d{2}-\d{4}$/;

// El catálogo de operadores solo necesita el país: el controller usa PaisDto

export class ListarZonasDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  officeCode: string;
}

export class ListarAgendasDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  zoneId: string;
}

export class BuscarCapacidadesDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  mainScheduleId: string;

  @IsOptional()
  @IsString()
  @Matches(FECHA, { message: 'date debe tener el formato DD-MM-YYYY' })
  date?: string;

  /** Cuántos días devolver como máximo. Sin esto llega la agenda completa. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  dias?: number;
}
