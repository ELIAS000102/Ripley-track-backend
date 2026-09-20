import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaisDto } from '../../common/dto/pais.dto.js';

/**
 * Entradas de las consultas del agente.
 *
 * Todas aceptan lo que una persona diría en voz alta —un código visible, el
 * nombre de una tienda, el de un distrito— y nunca identificadores internos: el
 * agente no los conoce y pedírselos al usuario era el fallo más repetido.
 *
 * Las fechas van en YYYY-MM-DD, que es el formato que un modelo de lenguaje
 * produce bien; la conversión al DD-MM-YYYY de Ripley la hace el backend.
 */
class ConVentanaDto extends PaisDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'desde debe tener el formato YYYY-MM-DD',
  })
  desde?: string;
}

// ───────────────────────── Capacidad ─────────────────────────

export class ConsultarCapacidadDto extends ConVentanaDto {
  @IsString()
  @IsIn(['picking', 'despacho'], {
    message: 'tipo debe ser "picking" o "despacho"',
  })
  tipo: 'picking' | 'despacho';

  /**
   * Código visible de la oficina: el almacén en picking (20026),
   * el operador logístico en despacho (1130).
   */
  @IsString()
  @IsNotEmpty()
  codigo: string;

  /** Filtra por tipo de servicio en picking ("S", "ST"…) */
  @IsOptional()
  @IsString()
  servicio?: string;

  /** Filtra por nombre de zona en despacho; admite coincidencia parcial */
  @IsOptional()
  @IsString()
  zona?: string;

  /** Cuántos días devolver. Se acota para no inundar el contexto del modelo. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  dias?: number = 7;
}

// ───────────────────────── Reporte ─────────────────────────

export class ConsultarReporteDto extends ConVentanaDto {
  /**
   * Tope de 14, más bajo que el del reporte normal.
   *
   * La respuesta crece con cada día multiplicado por cada jornada de cada CD, y
   * por encima de dos semanas agota el contexto del modelo antes de que pueda
   * responder. Un cliente humano sí puede pedir más.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(14)
  dias?: number = 7;
}

// ───────────────────────── Transferencias ─────────────────────────

export class ConsultarTransferenciaDto extends PaisDto {
  /** Código o nombre del almacén de donde SALE el stock (la fuente) */
  @IsString()
  @IsNotEmpty()
  origen: string;

  /**
   * Código o nombre del almacén que RECIBE. Si se omite, se devuelven todos
   * los destinos del origen.
   */
  @IsOptional()
  @IsString()
  destino?: string;
}

// ───────────────────────── Tipos de servicio ─────────────────────────

export class ConsultarTipoServicioDto extends PaisDto {
  /** Código o nombre del operador logístico */
  @IsString()
  @IsNotEmpty()
  opl: string;

  /** Nombre de la zona; admite coincidencia parcial. Si se omite, la primera. */
  @IsOptional()
  @IsString()
  zona?: string;

  /** Nombre de la agenda; admite coincidencia parcial. Si se omite, la primera. */
  @IsOptional()
  @IsString()
  agenda?: string;
}

// ───────────────────────── Simulación ─────────────────────────

export class SimularAgenteDto extends PaisDto {
  /**
   * Tipo de servicio: "SD", "SE", "DT", "ST"…
   *
   * Por sí solo, con "SD" o "SE", dispara la simulación preconfigurada de la
   * operación: sus OPL, sus destinos y el SKU de referencia. Vacío pide todos
   * los tipos aplicables al destino.
   */
  @IsOptional()
  @IsString()
  servicio?: string;

  /**
   * Método de entrega. **Normalmente no hace falta**: lo determina el servicio
   * (RT para ST/SS/SG/SE/RT/RE, DP para DT/SD/S/EX/AT/OP).
   */
  @IsOptional()
  @IsString()
  metodo?: string;

  /**
   * Código del operador, o varios separados por coma ("1111,1110"). Si se
   * omite y se pidió una simulación preconfigurada, se usan los suyos.
   */
  @IsOptional()
  @IsString()
  operador?: string;

  /** Código o nombre del almacén que aporta el stock. Hay uno por defecto. */
  @IsOptional()
  @IsString()
  almacen?: string;

  // ── Punto de entrega. Obligatorio salvo en las preconfiguradas.

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  provincia?: string;

  @IsOptional()
  @IsString()
  distrito?: string;

  // ── Venta simulada

  /** Fecha de la venta, DD/MM/YYYY. Si se omite, hoy. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}\/\d{2}\/\d{4}$/, {
    message: 'fecha debe tener el formato DD/MM/YYYY',
  })
  fecha?: string;

  /** Hora de la venta, HH:MM. Si se omite, la hora actual. */
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'hora debe tener el formato HH:MM',
  })
  hora?: string;

  /** Si se omite se usa un SKU de referencia */
  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad?: number = 1;
}

// ───────────────────────── Búsqueda masiva ─────────────────────────

export class BuscarMasivoDto extends PaisDto {
  /** Código del tipo de servicio ("SE") o su descripción. Lo único obligatorio. */
  @IsString()
  @IsNotEmpty()
  servicio: string;

  /**
   * Código del método de entrega ("RT") o su descripción.
   *
   * **No hace falta mandarlo**: el tipo de servicio ya determina el método
   * (RT para ST/SS/SG/SE/RT/RE, DP para DT/SD/S/EX/AT/OP) y el backend lo
   * resuelve. Solo se acepta para acotar cuando un mismo nombre de servicio
   * existiera en los dos métodos.
   */
  @IsOptional()
  @IsString()
  metodo?: string;

  /**
   * Orígenes de stock separados por coma. Si se omite, se buscan todos: el
   * agente no tiene por qué conocer el catálogo.
   */
  @IsOptional()
  @IsString()
  origenes?: string;

  /** Deja fuera las agendas desactivadas, que suelen ser la mayoría */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  soloActivas?: boolean = false;
}

// ───────────────────────── Edición (modo editor) ─────────────────────────

/**
 * Tope de lo que el agente puede asignar en un día.
 *
 * No es un límite de la operación: las agendas reales rondan los miles. Es una
 * red contra un cero de más o un número inventado, que en una escritura no se
 * nota hasta que alguien mira el panel.
 */
const ASIGNADO_MAXIMO = 100_000;

/**
 * Cambiar uno o varios días de una agenda. **Solo funciona en modo editor.**
 *
 * Todo entra por nombre o código visible, igual que en las consultas, y hay un
 * campo por cada cosa que hace falta para identificar UNA agenda. Si con lo que
 * llega quedan varias, el backend no elige: responde con las opciones.
 */
export class EditarCapacidadDto extends PaisDto {
  @IsString()
  @IsIn(['picking', 'despacho'], {
    message: 'tipo debe ser "picking" o "despacho"',
  })
  tipo: 'picking' | 'despacho';

  /** Almacén en picking (20026), operador logístico en despacho (1130) */
  @IsString()
  @IsNotEmpty()
  codigo: string;

  /** Picking: tipo de servicio de la agenda ("S", "ST", "RC") */
  @IsOptional()
  @IsString()
  servicio?: string;

  /** Despacho: nombre de la zona; admite coincidencia parcial */
  @IsOptional()
  @IsString()
  zona?: string;

  /**
   * Nombre de la agenda; admite coincidencia parcial.
   *
   * En despacho identifica cuál dentro de la zona. En picking **también
   * filtra**, y ahí hace falta más de lo que parece: un almacén puede tener
   * cinco agendas con el mismo tipo de servicio —la buena y varias marcadas
   * "NO FUNCIONAL"—, y sin este campo no había forma de desempatarlas.
   */
  @IsOptional()
  @IsString()
  agenda?: string;

  /** El primer día que se cambia, o el único si no hay `hasta` */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fecha debe tener el formato YYYY-MM-DD',
  })
  fecha: string;

  /**
   * Último día del rango, incluido. Si se omite, se cambia solo `fecha`.
   *
   * El rango se confirma una vez y se aplica en una sola llamada. Antes era un
   * día por llamada, con su confirmación cada uno: "cierra del 29 al 2" se
   * convertía en cuatro idas y venidas y el usuario abandonaba a mitad.
   */
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null ? undefined : value,
  )
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'hasta debe tener el formato YYYY-MM-DD',
  })
  hasta?: string;

  /**
   * Capacidad asignada. Si se omite, se deja la que ya tenía.
   *
   * El `''` cuenta como ausente: esto llega en el cuerpo, y el pipe que limpia
   * los vacíos solo mira los query params. n8n manda igualmente los campos que
   * el modelo no rellenó, así que sin esto "solo desactiva el día" no haría lo
   * que se pidió.
   *
   * La conversión a número va **dentro** de este `@Transform` y no en un
   * `@Type(() => Number)` aparte. Con los dos decoradores, el tipado corre
   * primero: convertía el `''` en `Number('') === 0` y aquí ya llegaba un cero
   * indistinguible de uno pedido a propósito. El resultado era que desactivar
   * un día **borraba su capacidad asignada** sin que nadie lo hubiera pedido.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return undefined;

    const numero = Number(value);
    // Lo que no sea un número se deja pasar para que @IsInt lo rechace
    // diciendo qué llegó, en vez de convertirlo en NaN
    return Number.isNaN(numero) ? value : numero;
  })
  @IsInt()
  @Min(0)
  @Max(ASIGNADO_MAXIMO, {
    message: `asignado no puede pasar de ${ASIGNADO_MAXIMO}: revisa el número`,
  })
  asignado?: number;

  /** Si el día acepta pedidos. Si se omite, se deja como estaba. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    // Igual que arriba: vacío es "no lo estoy indicando"
    if (value === '' || value === null) return undefined;
    return value;
  })
  @IsBoolean()
  activa?: boolean;
}

/**
 * El interruptor del chat.
 *
 * Solo dos valores, y ninguno por defecto: cambiar de modo es una decisión
 * explícita, no algo que pase por omitir un campo.
 */
export class CambiarModoDto {
  @IsString()
  @IsIn(['consultor', 'editor'], {
    message: 'modo debe ser "consultor" o "editor"',
  })
  modo: 'consultor' | 'editor';
}
