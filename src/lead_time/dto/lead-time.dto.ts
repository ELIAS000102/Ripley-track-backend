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
import type { MallaElegida } from '../versionado.service.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Qué hay en un grupo: matrices (por tienda) o mallas (por OPL) */
export type TipoGrupo = 'matriz' | 'malla';

/** GET /grupos-leadtime */
export class ListarGruposDto extends PaisDto {}

/** POST /grupos-leadtime: un grupo nuevo */
export class GrupoDto {
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'falta el nombre del grupo' })
  @MaxLength(80)
  nombre: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(300)
  descripcion?: string;

  @IsIn(['matriz', 'malla'], { message: 'tipo es "matriz" (por tienda) o "malla" (por OPL)' })
  tipo: TipoGrupo;
}

/** PUT /grupos-leadtime/:id: el tipo solo cambia mientras el grupo está vacío */
export class EditarGrupoDto extends GrupoDto {}

/**
 * Qué versión dentro del grupo: la base (por defecto; Valle en Chile, Regular
 * en Perú) o la de un evento por su nombre: `?tipo=evento&nombre=Cyber`.
 */
export class VersionDto {
  @IsOptional()
  @IsIn(['regular', 'evento'], { message: 'tipo es "regular" (la base: Valle o Regular) o "evento"' })
  tipo?: 'regular' | 'evento' = 'regular';

  @IsOptional()
  @IsString()
  @MaxLength(60)
  nombre?: string;
}

/** De la query a la versión elegida: el nombre solo cuenta en un evento */
export function mallaDe(q: VersionDto): MallaElegida {
  return q.tipo === 'evento' ? { tipo: 'evento', nombre: q.nombre ?? '' } : { tipo: 'regular' };
}

/** La plantilla: vacía, o con la versión vigente dentro */
export class PlantillaDto extends VersionDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  conDatos?: boolean;
}

/**
 * Cargar una versión. En un evento, `desde` y `hasta` (opcionales, los dos o
 * ninguno) le dan esa vigencia a todos los códigos del archivo de una vez.
 */
export class CargarDto extends VersionDto {
  @IsOptional()
  @Matches(FECHA, { message: 'desde debe tener el formato YYYY-MM-DD' })
  desde?: string;

  @IsOptional()
  @Matches(FECHA, { message: 'hasta debe tener el formato YYYY-MM-DD' })
  hasta?: string;
}

/** Las fechas de una venta en una tienda o en una OPL */
export class CalcularDto extends VersionDto {
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @IsString()
  @Matches(FECHA, { message: 'fecha debe tener el formato YYYY-MM-DD' })
  fecha: string;
}

/** El lead time de todo el grupo para una fecha de venta */
export class FechaDto {
  @IsString()
  @Matches(FECHA, { message: 'fecha debe tener el formato YYYY-MM-DD' })
  fecha: string;
}

/** Un evento por su nombre: su vigencia, o retirarlo */
export class EventoDto {
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
  @Matches(FECHA, { message: 'desde debe tener el formato YYYY-MM-DD' })
  desde: string;

  @IsString()
  @Matches(FECHA, { message: 'hasta debe tener el formato YYYY-MM-DD' })
  hasta: string;
}

/** PUT /grupos-leadtime/:id/vigencias: la vigencia de los códigos del evento, entera */
export class GuardarVigenciasDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => VigenciaDto)
  vigencias: VigenciaDto[];
}
