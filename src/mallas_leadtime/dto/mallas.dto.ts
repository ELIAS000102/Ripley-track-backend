import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaisDto } from '../../common/dto/pais.dto.js';
import type { MallaElegida } from '../mallas-leadtime.service.js';

/**
 * Qué versión: la base (por defecto; Valle en Chile, Regular en Perú) o la de
 * un evento por su nombre. Vale para las matrices y para las mallas de despacho.
 *
 * `?tipo=evento&nombre=Cyber`. Sin tipo es la base, como antes de que
 * hubiera eventos: lo que ya llamaba a estas rutas sigue igual.
 */
export class MallaDto extends PaisDto {
  @IsOptional()
  @IsIn(['regular', 'evento'], { message: 'tipo es "regular" (la base: Valle o Regular) o "evento"' })
  tipo?: 'regular' | 'evento' = 'regular';

  @IsOptional()
  @IsString()
  @MaxLength(60)
  nombre?: string;
}

/** De la query a la malla elegida: el nombre solo cuenta en un evento */
export function mallaDe(q: MallaDto): MallaElegida {
  return q.tipo === 'evento' ? { tipo: 'evento', nombre: q.nombre ?? '' } : { tipo: 'regular' };
}

/** La plantilla: vacía, o con la versión vigente dentro */
export class PlantillaDto extends MallaDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  conDatos?: boolean;
}

/** Las fechas de una venta en una tienda o en una OPL */
export class CalcularDto extends MallaDto {
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha debe tener el formato YYYY-MM-DD' })
  fecha: string;
}

/** Un evento por su nombre: su vigencia, o retirarlo */
export class EventoDto extends PaisDto {
  @IsString()
  @IsNotEmpty({ message: 'falta el nombre del evento' })
  @MaxLength(60)
  nombre: string;
}

export class VigenciaDto {
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'desde debe tener el formato YYYY-MM-DD' })
  desde: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'hasta debe tener el formato YYYY-MM-DD' })
  hasta: string;
}

/** PUT /matrices/vigencias y /mallas-despacho/vigencias: la vigencia de los códigos del evento, entera */
export class GuardarVigenciasDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => VigenciaDto)
  vigencias: VigenciaDto[];
}
