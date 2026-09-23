import { Transform } from 'class-transformer';
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
 * Entradas de lo que el agente puede cambiar.
 *
 * Mismo criterio que en las consultas: todo entra por nombre o código visible,
 * nunca por identificador interno. Y uno propio de escribir — **lo que no se
 * indica no se toca**: un campo ausente conserva su valor, no se pone a cero.
 */

/**
 * Un vacío es "no lo estoy indicando", no un false.
 *
 * n8n manda todos los campos de una herramienta, rellenos o no, así que sin
 * esto "solo cambia la hora de corte" apagaría el servicio de paso.
 */
function aBooleano(value: unknown): boolean | undefined {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return undefined;
}

/**
 * Lo mismo con los números, y **sin `@Type(() => Number)`**: ese decorador
 * corre antes y convierte el vacío en `Number('') === 0`, que ya borró una
 * capacidad asignada que nadie pidió cambiar.
 */
function aNumero(value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return undefined;

  const numero = Number(value);
  return Number.isNaN(numero) ? value : numero;
}

/**
 * Y lo mismo con el texto: `''` es "no lo estoy indicando".
 *
 * Es el que faltaba, y se notó. `@IsOptional()` de class-validator solo se
 * salta la validación cuando el valor es `undefined` o `null` — **el vacío sí
 * la pasa**, así que el `corte: ''` que manda n8n al desactivar un servicio
 * chocaba contra el formato HH:MM y tumbaba la petición entera por un campo
 * que nadie había rellenado.
 */
function aTexto(value: unknown): string | undefined {
  if (typeof value !== 'string') return value as undefined;

  const limpio = value.trim();
  return limpio === '' ? undefined : limpio;
}

/** Tope de días de preparación o tránsito: más es un dedazo */
const DIAS_MAXIMOS = 60;

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
  @Transform(({ value }) => aTexto(value))
  @IsString()
  servicio?: string;

  /** Despacho: nombre de la zona; admite coincidencia parcial */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
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
  @Transform(({ value }) => aTexto(value))
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
  @Transform(({ value }) => aTexto(value))
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
  @Transform(({ value }) => aNumero(value))
  @IsInt()
  @Min(0)
  @Max(ASIGNADO_MAXIMO, {
    message: `asignado no puede pasar de ${ASIGNADO_MAXIMO}: revisa el número`,
  })
  asignado?: number;

  /** Si el día acepta pedidos. Si se omite, se deja como estaba. */
  @IsOptional()
  @Transform(({ value }) => aBooleano(value))
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

// ───────────────────────── Tipo de servicio de un OPL ─────────────────────────

/**
 * Cambiar un servicio dentro de la agenda de un operador logístico.
 *
 * La agenda se identifica igual que al consultarla —operador, zona, agenda— y
 * el servicio por su código visible. Los identificadores internos que exige la
 * API corporativa los resuelve el backend releyendo el estado actual.
 */
export class EditarTipoServicioDto extends PaisDto {
  /** Código o nombre del operador logístico */
  @IsString()
  @IsNotEmpty()
  opl: string;

  /** Código del servicio dentro de la agenda: "SD", "ST", "RC"… */
  @IsString()
  @IsNotEmpty()
  servicio: string;

  /** Nombre de la zona; admite coincidencia parcial */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  zona?: string;

  /** Nombre de la agenda; admite coincidencia parcial */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  agenda?: string;

  /** Si el servicio está activo. Omítelo para dejarlo como está. */
  @IsOptional()
  @Transform(({ value }) => aBooleano(value))
  @IsBoolean()
  activo?: boolean;

  /** Si aparece en el checkout. Omítelo para dejarlo como está. */
  @IsOptional()
  @Transform(({ value }) => aBooleano(value))
  @IsBoolean()
  enCheckout?: boolean;

  /**
   * Día de la semana cuya hora de corte se cambia, en español.
   *
   * Un día por llamada a propósito: cambiar los siete de golpe es la clase de
   * cosa que nadie revisa entera. Los días que no se nombran conservan su hora.
   */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  dia?: string;

  /** La hora de corte nueva para ese día, en HH:MM de 24 horas */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'corte debe tener el formato HH:MM en 24 horas',
  })
  corte?: string;
}

// ───────────────────────── Activación masiva ─────────────────────────

/**
 * Tope de agendas que el agente puede cambiar de una vez.
 *
 * Una búsqueda amplia devuelve cientos. Cambiar cientos desde un chat, con una
 * sola confirmación y sin ver la lista, no es una operación que nadie pueda
 * revisar: por encima de esto se hace desde el panel, que las enseña todas.
 */
const AGENDAS_MAXIMAS = 25;

/**
 * Activar o desactivar en bloque las agendas que tienen un tipo de servicio.
 *
 * Es la operación más peligrosa que el agente puede hacer, porque toca muchas
 * filas de una vez. Por eso `opls` no es opcional por comodidad: sin él se
 * cambian **todas** las agendas del servicio, y eso exige que el usuario lo
 * haya pedido así de explícito.
 */
export class EditarMasivoDto extends PaisDto {
  /** Código del tipo de servicio ("SE") o su descripción */
  @IsString()
  @IsNotEmpty()
  servicio: string;

  /**
   * Código del método de entrega. No hace falta: lo determina el servicio.
   */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  metodo?: string;

  /**
   * Operadores a los que se limita el cambio, separados por coma.
   *
   * Omitirlo significa "todas las agendas de ese servicio", que es lo que
   * hace falta declarar a conciencia.
   */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  opls?: string;

  /** Orígenes de stock separados por coma. Si se omite, todos. */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  origenes?: string;

  /** Deja fuera las que ya están desactivadas */
  @IsOptional()
  @Transform(({ value }) => aBooleano(value))
  @IsBoolean()
  soloActivas?: boolean;

  /** El estado nuevo. Omítelo para dejarlo como está. */
  @IsOptional()
  @Transform(({ value }) => aBooleano(value))
  @IsBoolean()
  activo?: boolean;

  /** Si aparecen en el checkout. Omítelo para dejarlo como está. */
  @IsOptional()
  @Transform(({ value }) => aBooleano(value))
  @IsBoolean()
  enCheckout?: boolean;

  /**
   * Cuántas agendas como mucho. El backend se niega si la búsqueda trae más:
   * es la diferencia entre un cambio acotado y uno que nadie revisó.
   */
  @IsOptional()
  @Transform(({ value }) => aNumero(value))
  @IsInt()
  @Min(1)
  @Max(AGENDAS_MAXIMAS)
  maximo?: number = AGENDAS_MAXIMAS;
}

// ───────────────────────── Transferencia entre sucursales ─────────────────────────

/**
 * Cambiar la relación de transferencia entre dos almacenes.
 *
 * `origen` es de donde SALE el stock y `destino` quien lo recibe; la relación
 * cuelga del origen. Es la confusión más repetida del agente, así que los dos
 * son obligatorios: sin destino no hay una relación concreta que cambiar.
 */
export class EditarTransferenciaDto extends PaisDto {
  /** Código o nombre del almacén de donde SALE el stock */
  @IsString()
  @IsNotEmpty()
  origen: string;

  /**
   * Código o nombre del almacén que RECIBE. Admite varios por coma.
   *
   * "Sube el desfase de la 20021 y la 20022 a 4 días" es una decisión, no dos:
   * pedir una confirmación por destino convierte una frase en una conversación
   * y el usuario abandona a mitad. El backend los resuelve todos antes de
   * escribir ninguno.
   */
  @IsString()
  @IsNotEmpty()
  destino: string;

  /** Si se puede transferir. Omítelo para dejarlo como está. */
  @IsOptional()
  @Transform(({ value }) => aBooleano(value))
  @IsBoolean()
  habilitada?: boolean;

  /** Días de preparación antes de que salga */
  @IsOptional()
  @Transform(({ value }) => aNumero(value))
  @IsInt()
  @Min(0)
  @Max(DIAS_MAXIMOS, {
    message: `preparacion no puede pasar de ${DIAS_MAXIMOS} días: revisa el número`,
  })
  preparacion?: number;

  /** Días de tránsito */
  @IsOptional()
  @Transform(({ value }) => aNumero(value))
  @IsInt()
  @Min(0)
  @Max(DIAS_MAXIMOS, {
    message: `transito no puede pasar de ${DIAS_MAXIMOS} días: revisa el número`,
  })
  transito?: number;

  /**
   * Días de la semana en los que se puede transferir, en español y por coma.
   *
   * "lunes, martes" deja habilitados esos dos y apaga el resto. "todos" o
   * "ninguno" valen. Omitirlo deja los días como están.
   */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  dias?: string;
}

// ───────────────────────── Cortar un CD ─────────────────────────

/**
 * Cortar (o reabrir) el picking de un centro de distribución entero.
 *
 * Existe porque "desactiva todas las jornadas del CD de hoy" se resolvía con
 * una llamada por jornada y **una confirmación cada vez**: siete preguntas
 * seguidas para una sola decisión.
 */
export class EditarCdDto extends PaisDto {
  /**
   * Código o nombre del CD. Omitirlo, o nombrar al país, son **todos** los
   * del país: "el CD de Perú" son los dos.
   */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  cd?: string;

  /** El primer día, o el único si no hay `hasta`. Por defecto, hoy. */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fecha debe tener el formato YYYY-MM-DD',
  })
  fecha?: string;

  /** Último día del rango, incluido */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'hasta debe tener el formato YYYY-MM-DD',
  })
  hasta?: string;

  /**
   * Jornadas concretas por coma. Omitirlo son **todas** las del CD, que es lo
   * que se pide al cortar: se deja por si hace falta acotar.
   */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  jornadas?: string;

  /** `false` corta, `true` reabre. Obligatorio: no hay valor por defecto. */
  @Transform(({ value }) => aBooleano(value))
  @IsBoolean({ message: 'activa tiene que ser "true" o "false"' })
  activa: boolean;
}

// ───────────────────────── Reasignar capacidad ─────────────────────────

/** Tope de unidades por reasignación: red contra un cero de más */
const UNIDADES_MAXIMAS = 100_000;

/**
 * Mover capacidad de una jornada a otra dentro del mismo CD.
 *
 * Son dos escrituras que solo valen juntas, así que el backend comprueba todo
 * antes de tocar nada: las jornadas, las unidades libres, la autorización y
 * las fechas.
 */
export class ReasignarCapacidadDto extends PaisDto {
  /** Código o nombre del CD */
  @IsString()
  @IsNotEmpty()
  cd: string;

  /** Jornada de la que SALE la capacidad */
  @IsString()
  @IsNotEmpty()
  origen: string;

  /** Jornada que la RECIBE */
  @IsString()
  @IsNotEmpty()
  destino: string;

  /** Cuántas unidades se mueven */
  @Transform(({ value }) => aNumero(value))
  @IsInt({ message: 'unidades tiene que ser un número entero' })
  @Min(1, { message: 'unidades tiene que ser al menos 1' })
  @Max(UNIDADES_MAXIMAS, {
    message: `unidades no puede pasar de ${UNIDADES_MAXIMAS}: revisa el número`,
  })
  unidades: number;

  /** La fecha de la reasignación. Por defecto, hoy. */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fecha debe tener el formato YYYY-MM-DD',
  })
  fecha?: string;

  /**
   * Fecha del destino, **solo si es distinta de la del origen**.
   *
   * Una reasignación ocurre dentro del mismo día; cruzar fechas está cerrado
   * salvo para ND y DX en Chile, que es la excepción acordada.
   */
  @IsOptional()
  @Transform(({ value }) => aTexto(value))
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fechaDestino debe tener el formato YYYY-MM-DD',
  })
  fechaDestino?: string;

  /**
   * Que quien lo pide declara tener permiso para esta pareja de jornadas.
   *
   * No lo decide el agente: lo dice la persona en el chat y el agente lo
   * traslada. Las parejas libres de cada CD no lo necesitan.
   */
  @IsOptional()
  @Transform(({ value }) => aBooleano(value))
  @IsBoolean()
  autorizado?: boolean;
}
