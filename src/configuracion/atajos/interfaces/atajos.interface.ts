/**
 * Los tipos de bloque, y la tabla donde están sus ítems.
 *
 * El reporte de CDs no está: no hay nada que guardarle como atajo —se pide con un
 * país y unos días— y no admite edición.
 */
export const TABLA_POR_TIPO = {
  picking: 'item_picking',
  recepcion: 'item_recepcion',
  despacho: 'item_despacho',
  opl: 'item_opl',
  masivo: 'item_masivo',
  transferencia: 'item_transferencia',
  simulacion: 'item_simulacion',
} as const;

export const TIPOS = Object.keys(TABLA_POR_TIPO) as Tipo[];

export type Tipo = keyof typeof TABLA_POR_TIPO;

/**
 * Qué hacen los ítems de un bloque. **Solo consultar.**
 *
 * Un atajo no es una macro de cambios: es el vocabulario de la
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
 * Un ítem, tal como sale de su tabla.
 *
 * Las columnas van en `snake_case` y los campos del endpoint en `camelCase`.
 * La conversión se hace en un sitio, al armar el DTO: mantener a mano un mapa
 * de cuarenta nombres es garantizar que uno se quede sin traducir.
 */
export interface Item {
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
  /** Se rellenan al leer el atajo entero */
  items?: Item[];
}

export interface Atajo {
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

/** Un ítem ya ejecutado */
export interface ItemEjecutada {
  orden: number;
  nota: string | null;
  /** La respuesta del apartado, tal como la devolvería su propio endpoint */
  resultado?: unknown;
  /**
   * El motivo, si falló.
   *
   * Un ítem que falla **no detiene a los siguientes**: un bloque de once
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
  items: ItemEjecutada[];
}

export interface Ejecucion {
  atajo: string;
  bloques: BloqueEjecutado[];
  /** Cuántos ítems salieron bien y cuántos no, en todo el atajo */
  resumen: { items: number; correctas: number; fallidas: number };
}
