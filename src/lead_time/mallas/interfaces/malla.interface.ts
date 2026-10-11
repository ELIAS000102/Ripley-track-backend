import type { Dia } from '../../matrices/interfaces/matriz.interface.js';

/**
 * Lo que pasa con lo vendido un día de la semana en una OPL, en días desde la
 * venta: cuándo va en tránsito y cuándo se despacha. Es la distancia entre las
 * celdas "Venta", "Transito" y "Despacho" de su fila en la malla.
 */
export interface DiaMalla {
  /** Días desde la venta hasta el tránsito, o `null` si no pasa por tránsito */
  transito: number | null;
  /** Días desde la venta hasta el despacho */
  despacho: number;
}

/** Una OPL de la malla: sus siete filas, una por día de venta */
export interface OplMalla {
  codigo: string;
  /** El nombre de la OPL, si el Excel trae la columna; si no, vacío */
  nombre: string;
  /** El tipo de servicio de la columna "T. de servicio" ("S"…) */
  servicio: string;
  /** Siete entradas, de lunes a domingo: `null` si ese día de venta no tiene fila */
  dias: (DiaMalla | null)[];
}

/** Lo que pasa con una venta según el día de la semana en que se hace */
export interface VentaMalla {
  venta: Dia;
  /** El día de venta con fila que se usa: el mismo, o el siguiente que la tenga */
  segun: Dia;
  transita: Dia | null;
  despacha: Dia;
  /** Días que se espera hasta un día de venta con fila; 0 si tiene la suya */
  diasDeEspera: number;
  /** Días naturales desde la venta hasta el tránsito, o `null` sin tránsito */
  diasHastaTransito: number | null;
  /** El lead time: días naturales desde la venta hasta el despacho */
  diasHastaDespacho: number;
}

/** Una OPL ya leída, con lo que se deduce de ella */
export interface OplInterpretada extends OplMalla {
  ventas: VentaMalla[];
}
