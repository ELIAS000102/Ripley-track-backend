import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ListarRelacionesDto } from './buscar-transf.dto.js';

/** Los siete días; los que no se envían conservan su valor actual */
export class DiasDto {
  @IsOptional() @IsBoolean() monday?: boolean;
  @IsOptional() @IsBoolean() tuesday?: boolean;
  @IsOptional() @IsBoolean() wednesday?: boolean;
  @IsOptional() @IsBoolean() thursday?: boolean;
  @IsOptional() @IsBoolean() friday?: boolean;
  @IsOptional() @IsBoolean() saturday?: boolean;
  @IsOptional() @IsBoolean() sunday?: boolean;
}

/**
 * Todos los campos editables son opcionales:
 * lo que no se envía conserva el valor que tenga hoy en la API.
 */
export class ActualizarRelacionDto extends ListarRelacionesDto {
  /** El _id de la relación dentro del documento del almacén */
  @IsString()
  @IsNotEmpty()
  relacionId: string;

  @IsOptional()
  @IsBoolean()
  canTransfer?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  transferPeriod?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  preTransferPeriod?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => DiasDto)
  availableDays?: DiasDto;

  /** No viene en la lectura; la API lo espera en el payload */
  @IsOptional()
  @IsString()
  relationshipType?: string = 'Directa';
}
