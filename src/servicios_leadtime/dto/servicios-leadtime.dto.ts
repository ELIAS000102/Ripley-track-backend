import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaisDto } from '../../common/dto/pais.dto.js';

/** Cuántos códigos puede tener un servicio como mucho */
export const CODIGOS_MAXIMOS = 500;

/**
 * Un servicio de lead time: un tipo de servicio del país que calcula con
 * matrices (tiendas o sucursales) o con mallas de despacho (OPLs), nunca con
 * las dos.
 */
export class ServicioLeadtimeDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'falta el nombre del servicio' })
  @MaxLength(80)
  nombre: string;

  @IsIn(['matriz', 'malla'], { message: 'modo es "matriz" (tiendas o sucursales) o "malla" (OPLs)' })
  modo: 'matriz' | 'malla';

  @IsArray()
  @ArrayMaxSize(CODIGOS_MAXIMOS)
  @IsString({ each: true })
  @Matches(/^\s*[A-Za-z0-9._-]{1,20}\s*$/, { each: true, message: 'cada código son letras, números, punto, guion o guion bajo, hasta 20' })
  codigos: string[];
}

/** GET /servicios-leadtime/calcular */
export class CalcularServicioDto extends PaisDto {
  @IsString()
  @IsNotEmpty({ message: 'falta el id del servicio' })
  id: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha debe tener el formato YYYY-MM-DD' })
  fecha: string;
}
