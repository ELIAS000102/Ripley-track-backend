import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaisDto } from '../../../common/dto/pais.dto.js';
import { CLAVES_COMPONENTES, LIMITES_G12, TIPOS_BLOQUE_G12 } from '../g12.componentes.js';

/**
 * La forma de lo que llega. El sentido —que la fila exista, que el tipo de
 * bloque sea de los del cuadro, que no falten campos— lo comprueba
 * `normalizarConfiguracion`, que junta todos los errores en un mensaje.
 */

export class ReporteG12Dto extends PaisDto {
  /** true: no usar el último generado, pedirlo otra vez a Ripley */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  refrescar?: boolean;

  /** true: no pedir nada a Ripley, armar el reporte con lo generado hoy (el resumen del final) */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  soloGuardado?: boolean;
}

/** GET /reportes/g12/cuadro — un cuadro suelto, para actualizar tabla por tabla */
export class CuadroG12Dto extends ReporteG12Dto {
  @IsIn(CLAVES_COMPONENTES, { message: `clave debe ser uno de: ${CLAVES_COMPONENTES.join(', ')}` })
  clave: string;

  /** La actualización en curso del historial: sus peticiones se guardan ahí */
  @IsOptional()
  @IsUUID('all', { message: 'actualizacion es el id de una actualización del historial' })
  actualizacion?: string;
}

/** POST /reportes/g12/actualizaciones — empieza una actualización del historial */
export class CrearActualizacionG12Dto {
  @IsIn(['completa', 'refrescar', 'tabla', 'reintento'], { message: 'tipo debe ser completa, refrescar, tabla o reintento' })
  tipo: 'completa' | 'refrescar' | 'tabla' | 'reintento';
}

/** GET /reportes/g12/actualizaciones — el historial, de un día si se dice */
export class ListarActualizacionesG12Dto extends PaisDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dia debe tener el formato YYYY-MM-DD' })
  dia?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}

export class ItemG12Dto {
  @IsString()
  @MaxLength(LIMITES_G12.texto)
  fila: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIMITES_G12.texto)
  nota?: string;

  @IsObject({ message: 'campos debe ser un objeto con los datos del ítem' })
  campos: Record<string, unknown>;
}

export class BloqueG12Dto {
  @IsIn(TIPOS_BLOQUE_G12, { message: `tipo debe ser uno de: ${TIPOS_BLOQUE_G12.join(', ')}` })
  tipo: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIMITES_G12.texto)
  nota?: string;

  @IsOptional()
  @IsBoolean()
  muestra?: boolean;

  @IsArray()
  @ArrayMaxSize(LIMITES_G12.itemsPorBloque + 1)
  @ValidateNested({ each: true })
  @Type(() => ItemG12Dto)
  items: ItemG12Dto[];
}

export class FilaG12Dto {
  @IsString()
  @MaxLength(LIMITES_G12.texto)
  nombre: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  suma?: string[];
}

export class ComponenteG12Dto {
  @IsIn(CLAVES_COMPONENTES)
  clave: string;

  @IsArray()
  @ArrayMaxSize(LIMITES_G12.filasPorComponente + 1)
  @ValidateNested({ each: true })
  @Type(() => FilaG12Dto)
  filas: FilaG12Dto[];

  @IsArray()
  @ArrayMaxSize(LIMITES_G12.bloquesPorComponente + 1)
  @ValidateNested({ each: true })
  @Type(() => BloqueG12Dto)
  bloques: BloqueG12Dto[];
}

export class ParteResumenG12Dto {
  @IsIn(CLAVES_COMPONENTES)
  componente: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIMITES_G12.texto)
  fila?: string;
}

export class LineaResumenG12Dto {
  @IsString()
  @MaxLength(LIMITES_G12.texto)
  nombre: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ParteResumenG12Dto)
  partes: ParteResumenG12Dto[];
}

export class GuardarConfiguracionG12Dto {
  @IsArray()
  @ArrayMaxSize(CLAVES_COMPONENTES.length)
  @ValidateNested({ each: true })
  @Type(() => ComponenteG12Dto)
  componentes: ComponenteG12Dto[];

  @IsArray()
  @ArrayMaxSize(LIMITES_G12.lineasResumen + 1)
  @ValidateNested({ each: true })
  @Type(() => LineaResumenG12Dto)
  resumen: LineaResumenG12Dto[];
}

/** POST /reportes/g12/probar — un bloque suelto, tal como está en el editor */
export class ProbarG12Dto {
  @IsIn(CLAVES_COMPONENTES)
  componente: string;

  @ValidateNested()
  @Type(() => BloqueG12Dto)
  bloque: BloqueG12Dto;
}
