import type { Dia } from '../../mallas_leadtime/interfaces/malla.interface.js';

/**
 * Lo que pasa con lo vendido un día de la semana en una OPL: qué día va en
 * tránsito y qué día se despacha.
 *
 * Se guarda como se escribió, ya normalizado: la letra del día ("W") y, si la
 * lleva, la suma ("J+7"). La interpretación —cuántos días son— se calcula al
 * leerla.
 */
export interface DiaDespacho {
  /** El día en tránsito, o `null` si no pasa por tránsito */
  transito: string | null;
  despacho: string;
}

/** Una fila de la malla: una OPL con lo que pasa según el día de venta */
export interface OplMalla {
  codigo: string;
  nombre: string;
  /** Siete entradas, de lunes a domingo: `null` si ese día de venta no tiene fila */
  dias: (DiaDespacho | null)[];
}

/** Lo que pasa con una venta según el día de la semana en que se hace */
export interface VentaDespacho {
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
  ventas: VentaDespacho[];
}
