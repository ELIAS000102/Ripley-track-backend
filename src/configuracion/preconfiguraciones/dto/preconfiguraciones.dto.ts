import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TIPOS } from '../interfaces/preconfiguraciones.interface.js';

/**
 * Topes por preconfiguración.
 *
 * No son límites de la base de datos sino del tiempo que nadie espera: cada
 * tarea son varias llamadas a la API corporativa, y cien tareas de despacho son
 * más de trescientas. Quien necesite más, dos preconfiguraciones.
 */
const BLOQUES_MAXIMOS = 10;
const TAREAS_MAXIMAS = 40;

/** Una tarea dentro de un bloque */
export class TareaDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nota?: string;

  /**
   * Los campos de la operación, sin validar aquí.
   *
   * Se validan **al ejecutar**, contra el mismo DTO que usa el endpoint de
   * verdad. Comprobarlos también al guardar sería tener dos definiciones de lo
   * mismo, y la de aquí se quedaría vieja en cuanto una operación ganara un
   * campo. A cambio, guardar una tarea incompleta es posible —y es lo que se
   * quiere: se deja a medias y se termina luego—.
   *
   * Lo que sí rechaza la base de datos son las columnas obligatorias: una tarea
   * de simulación sin su tabla no entra, y una de picking sin código tampoco.
   */
  @IsObject({ message: 'campos debe ser un objeto con los datos de la tarea' })
  campos: Record<string, unknown>;
}

/** Un bloque: un tipo de operación, una acción y sus tareas */
export class BloqueDto {
  @IsString()
  @IsIn(TIPOS, { message: `tipo debe ser uno de: ${TIPOS.join(', ')}` })
  tipo: string;

  @IsString()
  @IsIn(['consultar', 'editar'], {
    message: 'accion debe ser "consultar" o "editar"',
  })
  accion: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nota?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'un bloque necesita al menos una tarea' })
  @ArrayMaxSize(TAREAS_MAXIMAS, {
    message:
      `Son demasiadas tareas en un bloque: el máximo es ${TAREAS_MAXIMAS}. ` +
      `Cada una son varias llamadas a la API corporativa, y nadie espera ` +
      `delante de una pantalla lo que tardarían más.`,
  })
  @ValidateNested({ each: true })
  @Type(() => TareaDto)
  tareas: TareaDto[];
}

export class CrearPreconfiguracionDto {
  @IsString()
  @MinLength(3, { message: 'nombre necesita al menos 3 caracteres' })
  @MaxLength(80)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descripcion?: string;

  @IsArray()
  @ArrayMinSize(1, {
    message: 'una preconfiguración necesita al menos un bloque',
  })
  @ArrayMaxSize(BLOQUES_MAXIMOS)
  @ValidateNested({ each: true })
  @Type(() => BloqueDto)
  bloques: BloqueDto[];
}

/**
 * Editar una preconfiguración.
 *
 * Todo opcional: renombrar no debería obligar a reenviar los bloques, y
 * apagarla tampoco. Si vienen bloques, **se reemplazan todos**: el panel edita
 * la preconfiguración entera, y reconciliar altas, bajas y reordenaciones tarea
 * por tarea sería mucho código para nada que se aproveche.
 */
export class EditarPreconfiguracionDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'nombre necesita al menos 3 caracteres' })
  @MaxLength(80)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descripcion?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, {
    message: 'una preconfiguración necesita al menos un bloque',
  })
  @ArrayMaxSize(BLOQUES_MAXIMOS)
  @ValidateNested({ each: true })
  @Type(() => BloqueDto)
  bloques?: BloqueDto[];

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

/** Filtros del listado */
export class ListarPreconfiguracionesDto {
  /** Por defecto solo las activas: una retirada no estorba en la lista */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  incluirInactivas?: boolean;
}

/**
 * Ejecutar por nombre.
 *
 * Es como se la pide el agente: en el chat se dice "ejecuta la simulación SE",
 * no un identificador que nadie conoce.
 */
export class EjecutarPreconfiguracionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nombre: string;

  /**
   * Cuántas tareas ejecutar por bloque, como máximo.
   *
   * Para probar una preconfiguración larga sin esperarla entera: "ejecuta la
   * Simulación SE pero solo las dos primeras tiendas".
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAREAS_MAXIMAS)
  soloPrimeras?: number;
}
