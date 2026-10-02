/**
 * Los tipos de bloque, y la tabla donde están sus tareas.
 *
 * El reporte de CDs no está: no hay nada que preconfigurarle —se pide con un
 * país y unos días— y no admite edición.
 */
export const TABLA_POR_TIPO = {
  picking: 'tarea_picking',
  recepcion: 'tarea_recepcion',
  despacho: 'tarea_despacho',
  opl: 'tarea_opl',
  masivo: 'tarea_masivo',
  transferencia: 'tarea_transferencia',
  simulacion: 'tarea_simulacion',
} as const;

export const TIPOS = Object.keys(TABLA_POR_TIPO) as Tipo[];

export type Tipo = keyof typeof TABLA_POR_TIPO;

/**
 * Qué hacen las tareas de un bloque. **Solo consultar.**
 *
 * Una preconfiguración no es una macro de cambios: es el vocabulario de la
 * operación. "BT LIMA" son cinco OPL con sus zonas, y el backend solo entiende
 * códigos, así que sin esto el agente pedía la capacidad de "BT LIMA" y recibía
 * un "no encontrado". Guardado, el agente sabe a qué se refiere el usuario sin
 * que nadie escriba esos cinco códigos en el prompt ni en el código.
 *
 * Eso es una ayuda para **leer**. Un cambio en Ripley se pide por su
 * herramienta, con su confirmación y viendo lo que se va a tocar; esconderlo
 * detrás de un nombre guardado es exactamente lo contrario.
 */
export type Accion = 'consultar';

/**
 * Una tarea, tal como sale de su tabla.
 *
 * Las columnas van en `snake_case` y los campos del endpoint en `camelCase`.
 * La conversión se hace en un sitio, al armar el DTO: mantener a mano un mapa
 * de cuarenta nombres es garantizar que uno se quede sin traducir.
 */
export interface Tarea {
  id: number;
  orden: number;
  nota: string | null;
  [columna: string]: unknown;
}

export interface Bloque {
  id: string;
  orden: number;
  tipo: Tipo;
  accion: Accion;
  nota: string | null;
  /** Se rellenan al leer la preconfiguración entera */
  tareas?: Tarea[];
}

export interface Preconfiguracion {
  id: string;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
  bloques?: Bloque[];
  /**
   * Los tipos que tocan sus bloques, para poder agrupar la lista.
   *
   * Se calcula al leer y no se guarda: una columna con esto discreparía del
   * contenido en cuanto alguien añadiera un bloque de otra clase.
   */
  tipos?: Tipo[];
}

/** Una tarea ya ejecutada */
export interface TareaEjecutada {
  orden: number;
  nota: string | null;
  /** La respuesta del apartado, tal como la devolvería su propio endpoint */
  resultado?: unknown;
  /**
   * El motivo, si falló.
   *
   * Una tarea que falla **no detiene a las siguientes**: un bloque de once
   * simulaciones no puede quedarse sin responder porque la tercera tienda ya no
   * exista.
   */
  error?: string;
}

export interface BloqueEjecutado {
  orden: number;
  tipo: Tipo;
  accion: Accion;
  nota: string | null;
  tareas: TareaEjecutada[];
}

export interface Ejecucion {
  preconfiguracion: string;
  bloques: BloqueEjecutado[];
  /** Cuántas tareas salieron bien y cuántas no, en toda la preconfiguración */
  resumen: { tareas: number; correctas: number; fallidas: number };
}
