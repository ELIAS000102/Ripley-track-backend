import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ConsultarOplDto } from './consultar-opl.dto.js';

/**
 * Un cambio sobre una agenda. Ambos campos son opcionales:
 * el que no se envía conserva el valor que tenga hoy en la API.
 */
export class CambioAgendaDto {
  @IsString()
  @IsNotEmpty()
  mainRouteId: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  enabledForCheckout?: boolean;
}

export class ActualizarOplDto extends ConsultarOplDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CambioAgendaDto)
  cambios: CambioAgendaDto[];
}