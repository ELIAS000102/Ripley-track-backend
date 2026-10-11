import type { Dia } from '../../matrices/interfaces/matriz.interface.js';

/**
 * Lo que pasa con lo vendido un día de la semana en una OPL y un flujo, en días
 * desde la venta: cuándo va en tránsito, cuándo se recoge y cuándo se
 * despacha. Es la distancia entre las celdas "Venta", "Transito", "Recojo" y
 * "Despacho" de su fila en la malla.
 */
export interface DiaMalla {
  /** Días desde la venta hasta el tránsito, o `null` si no pasa por tránsito */
  transito: number | null;
  /** Días desde la venta hasta el recojo, o `null` si no hay recojo */
  recojo: number | null;
  /** Días desde la venta hasta el despacho */
  despacho: number;
}

/**
 * Una malla: la de una OPL en un flujo (tipo de servicio: "S", "OP"…), con
 * sus filas, una por día de venta. Una OPL puede tener varias, una por flujo.
 */
export interface OplMalla {
  /** La clave de la malla: OPL y flujo, "4014/S" */
  codigo: string;
  opl: string;
  /** El flujo o tipo de servicio, de la columna "Flujo" o "T. de servicio" */
  servicio: string;
  /** El nombre de la OPL, si el Excel trae la columna; si no, vacío */
  nombre: string;
  /** Siete entradas, de lunes a domingo: `null` si ese día de venta no tiene fila */
  dias: (DiaMalla | null)[];
}

/** Lo que pasa con una venta según el día de la semana en que se hace */
export interface VentaMalla {
  venta: Dia;
  /** El día de venta con fila que se usa: el mismo, o el siguiente que la tenga */
  segun: Dia;
  transita: Dia | null;
  recoge: Dia | null;
  despacha: Dia;
  /** Días que se espera hasta un día de venta con fila; 0 si tiene la suya */
  diasDeEspera: number;
  /** Días naturales desde la venta hasta el tránsito, o `null` sin tránsito */
  diasHastaTransito: number | null;
  /** Días naturales desde la venta hasta el recojo, o `null` sin recojo */
  diasHastaRecojo: number | null;
  /** El lead time: días naturales desde la venta hasta el despacho */
  diasHastaDespacho: number;
}

/** Una malla ya leída, con lo que se deduce de ella */
export interface OplInterpretada extends OplMalla {
  ventas: VentaMalla[];
}

/** La clave de una malla: OPL y flujo */
export const claveMalla = (opl: string, servicio: string) => `${opl}/${servicio}`;
