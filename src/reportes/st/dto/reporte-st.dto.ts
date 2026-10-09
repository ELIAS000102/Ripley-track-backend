import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaisDto } from '../../../common/dto/pais.dto.js';

/**
 * Topes de la configuración.
 *
 * Cada tienda son dos lecturas a la API corporativa por reporte: cien tiendas
 * son doscientas, que ya es más de lo que conviene pedirle de una vez.
 */
export const GRUPOS_MAXIMOS = 20;
export const TIENDAS_MAXIMAS = 100;

/** GET /reportes/st */
export class ReporteStDto extends PaisDto {
  /** Primer día del reporte; por defecto, hoy en el país */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'desde debe tener el formato YYYY-MM-DD' })
  desde?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8, { message: 'semanas puede ser como mucho 8: más es demasiado para leer de una vez' })
  semanas?: number = 4;

  /**
   * Con qué malla: "auto" (por defecto) usa la de un evento los días de su
   * vigencia en cada tienda y la de valle el resto; "valle", siempre la de
   * valle; el nombre de un evento, ese evento todos los días en sus tiendas.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  malla?: string;
}

/** GET /reportes/st/malla */
export class MallaStDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  codigo: string;
}

export class LadoDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code: string | null;

  @IsString()
  @MaxLength(160)
  nombre: string;
}

export class AgendaRecepcionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  scheduleId: string;

  @IsString({ message: 'la agenda no tiene capacidad: elige otra' })
  @IsNotEmpty({ message: 'la agenda no tiene capacidad: elige otra' })
  @MaxLength(60)
  capacityId: string;

  @IsString()
  @MaxLength(160)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  servicio: string | null;
}

export class AgendaTransferenciaDto extends AgendaRecepcionDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LadoDto)
  origen: LadoDto | null;

  @ValidateNested()
  @Type(() => LadoDto)
  destino: LadoDto;

  @IsIn(['origen', 'destino'])
  buscadaPor: 'origen' | 'destino';
}

export class TiendaStDto {
  @IsString()
  @Matches(/^\d{3,6}$/, { message: 'el código de la tienda son de 3 a 6 cifras' })
  codigo: string;

  @IsString()
  @MaxLength(160)
  nombre: string;

  @ValidateNested()
  @Type(() => AgendaRecepcionDto)
  recepcion: AgendaRecepcionDto;

  @ValidateNested()
  @Type(() => AgendaTransferenciaDto)
  transferencia: AgendaTransferenciaDto;
}

export class GrupoStDto {
  @IsString()
  @IsNotEmpty({ message: 'cada grupo necesita un nombre' })
  @MaxLength(80)
  nombre: string;

  @IsArray()
  @ArrayMaxSize(TIENDAS_MAXIMAS)
  @ValidateNested({ each: true })
  @Type(() => TiendaStDto)
  tiendas: TiendaStDto[];
}

/**
 * PUT /reportes/st/configuracion: los grupos enteros.
 *
 * Se reemplaza todo, como los bloques de una preconfiguración: el panel edita
 * la configuración completa y reconciliar altas, bajas y cambios de orden
 * tienda por tienda sería mucho código para nada.
 */
export class GuardarConfiguracionStDto {
  @IsArray()
  @ArrayMaxSize(GRUPOS_MAXIMOS, { message: `Son demasiados grupos: el máximo es ${GRUPOS_MAXIMOS}.` })
  @ValidateNested({ each: true })
  @Type(() => GrupoStDto)
  grupos: GrupoStDto[];
}
