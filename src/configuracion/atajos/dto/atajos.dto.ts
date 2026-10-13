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
import { TIPOS } from '../interfaces/atajos.interface.js';

/**
 * Topes por atajo.
 *
 * No son límites de la base de datos sino del tiempo que nadie espera: cada
 * ítem son varias llamadas a la API corporativa, y cien ítems de despacho son
 * más de trescientas. Quien necesite más, dos atajos.
 */
const BLOQUES_MAXIMOS = 10;
const ITEMS_MAXIMOS = 40;

/** Un ítem dentro de un bloque */
export class ItemDto {
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
   * campo. A cambio, guardar un ítem incompleto es posible —y es lo que se
   * quiere: se deja a medias y se termina luego—.
   *
   * Lo que sí rechaza la base de datos son las columnas obligatorias: un ítem
   * de simulación sin su tabla no entra, y una de picking sin código tampoco.
   */
  @IsObject({ message: 'campos debe ser un objeto con los datos del ítem' })
  campos: Record<string, unknown>;
}

/** Un bloque: un tipo de operación, una acción y sus ítems */
export class BloqueDto {
  @IsString()
  @IsIn(TIPOS, { message: `tipo debe ser uno de: ${TIPOS.join(', ')}` })
  tipo: string;

  /**
   * Siempre "consultar".
   *
   * Es un campo y no una constante porque la tabla lo guarda, y porque un
   * bloque que llegue con otra cosa tiene que fallar al validarse en vez de
   * ejecutarse como si nada.
   */
  @IsString()
  @IsIn(['consultar'], {
    message:
      'accion solo puede ser "consultar": un atajo no ejecuta cambios. ' +
      'Para eso están las herramientas de edición, que piden confirmación.',
  })
  accion: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nota?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'un bloque necesita al menos un ítem' })
  @ArrayMaxSize(ITEMS_MAXIMOS, {
    message:
      `Son demasiados ítems en un bloque: el máximo es ${ITEMS_MAXIMOS}. ` +
      `Cada una son varias llamadas a la API corporativa, y nadie espera ` +
      `delante de una pantalla lo que tardarían más.`,
  })
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items: ItemDto[];
}

export class CrearAtajoDto {
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
    message: 'un atajo necesita al menos un bloque',
  })
  @ArrayMaxSize(BLOQUES_MAXIMOS)
  @ValidateNested({ each: true })
  @Type(() => BloqueDto)
  bloques: BloqueDto[];
}

/**
 * Editar un atajo.
 *
 * Todo opcional: renombrar no debería obligar a reenviar los bloques, y
 * apagarla tampoco. Si vienen bloques, **se reemplazan todos**: el panel edita
 * el atajo entero, y reconciliar altas, bajas y reordenaciones ítem
 * por ítem sería mucho código para nada que se aproveche.
 */
export class EditarAtajoDto {
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
    message: 'un atajo necesita al menos un bloque',
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
export class ListarAtajosDto {
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
export class EjecutarAtajoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nombre: string;

  /**
   * Cuántos ítems ejecutar por bloque, como máximo.
   *
   * Para probar un atajo largo sin esperarlo entero: "ejecuta la
   * Simulación SE pero solo las dos primeras tiendas".
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ITEMS_MAXIMOS)
  soloPrimeras?: number;
}
