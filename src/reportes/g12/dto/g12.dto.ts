import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaisDto } from '../../../common/dto/pais.dto.js';
import { CLAVES_COMPONENTES, LIMITES_G12, TIPOS_BLOQUE_G12 } from '../g12.componentes.js';
import { MAXIMO_AGENDAS_SOLICITUD } from '../solicitudes-g12.js';

/**
 * La forma de lo que llega. El sentido —que la fila exista, que el tipo de
 * bloque sea de los del cuadro, que no falten campos— lo comprueba
 * `normalizarConfiguracion`, que junta todos los errores en un mensaje.
 */

/**
 * POST /reportes/g12/actualizaciones — lanza una actualización del G12 del país.
 *
 * - completa: las tablas que no son de hoy o tienen más de 15 minutos.
 * - refrescar: todas.
 * - tabla / reintento: las de `claves` (una tabla con ↻, o las que tienen errores).
 */
export class CrearActualizacionG12Dto {
  @IsIn(['completa', 'refrescar', 'tabla', 'reintento', 'solicitudes'], { message: 'tipo debe ser completa, refrescar, tabla, reintento o solicitudes' })
  tipo: 'completa' | 'refrescar' | 'tabla' | 'reintento' | 'solicitudes';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CLAVES_COMPONENTES.length)
  @IsIn(CLAVES_COMPONENTES, { each: true, message: `cada clave debe ser una de: ${CLAVES_COMPONENTES.join(', ')}` })
  claves?: string[];

  /** Completa o refrescar: false para actualizar solo el G12, sin las Solicitudes (por defecto van al final) */
  @IsOptional()
  @IsBoolean({ message: 'solicitudes debe ser true o false' })
  solicitudes?: boolean;
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

  /** Solo Despacho domicilio: los SUB_FLUJO del Oracle que suma ("SD_RM*" = por prefijo) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(LIMITES_G12.texto, { each: true })
  oracle?: string[];
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

/** Una agenda de Solicitudes: el sentido (tipos, clúster, campos) lo comprueba `normalizarSolicitudes` */
export class AgendaSolicitudG12Dto {
  @IsString()
  @MaxLength(20)
  tipo: string;

  @IsString()
  @MaxLength(20)
  cluster: string;

  @IsString()
  @MaxLength(LIMITES_G12.texto)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  ventana?: string;

  @IsObject()
  campos: Record<string, string | number>;
}

export class SolicitudesG12Dto {
  @IsOptional()
  @IsObject()
  umbrales?: Record<string, number>;

  @IsOptional()
  @IsObject()
  ventanas?: Record<string, { desde: number; dias: number }>;

  @IsArray()
  @ArrayMaxSize(MAXIMO_AGENDAS_SOLICITUD + 1)
  @ValidateNested({ each: true })
  @Type(() => AgendaSolicitudG12Dto)
  agendas: AgendaSolicitudG12Dto[];
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

  /** Solicitudes: sin ella, se conservan las guardadas */
  @IsOptional()
  @ValidateNested()
  @Type(() => SolicitudesG12Dto)
  solicitudes?: SolicitudesG12Dto;
}

/** POST /reportes/g12/ids/olvidar — volver a consultar los ids: los de esos cuadros, o sin claves los de todo el país */
export class OlvidarIdsG12Dto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CLAVES_COMPONENTES.length)
  @IsIn(CLAVES_COMPONENTES, { each: true, message: `cada clave debe ser una de: ${CLAVES_COMPONENTES.join(', ')}` })
  claves?: string[];
}

/** POST /reportes/g12/probar — un bloque suelto, tal como está en el editor */
export class ProbarG12Dto {
  @IsIn(CLAVES_COMPONENTES)
  componente: string;

  @ValidateNested()
  @Type(() => BloqueG12Dto)
  bloque: BloqueG12Dto;
}
