import { DIAS } from '../matrices/interfaces/matriz.interface.js';
import type { OplInterpretada, OplMalla, VentaMalla } from './interfaces/malla.interface.js';

/**
 * Cómo se lee una malla, en reglas.
 *
 * 1. Cada OPL tiene una fila por **día de venta**, con una celda "Venta", una
 *    "Transito" (opcional) y una "Despacho", cada una en la columna de su día.
 * 2. Lo que cuenta es la distancia entre ellas: venta el lunes, tránsito el
 *    miércoles y despacho el jueves son 2 y 3 días.
 * 3. Un día de venta sin fila va con el siguiente que la tenga, hacia delante.
 *
 * Ejemplo (OPL 4014): venta el viernes, tránsito el lunes, despacho el martes
 * → 4 días de lead time.
 */

/**
 * El lead time de cada día de venta: cuándo va en tránsito y cuándo se
 * despacha lo vendido ese día de la semana. Sin ninguna fila, nada.
 */
export function ventasDeOpl(o: OplMalla): VentaMalla[] {
  if (!o.dias.some(Boolean)) return [];
  return DIAS.map((venta, v) => {
    let espera = 0;
    while (!o.dias[(v + espera) % 7]) espera++;
    const segun = (v + espera) % 7;
    const { transito, despacho } = o.dias[segun]!;
    return {
      venta,
      segun: DIAS[segun],
      transita: transito === null ? null : DIAS[(segun + transito) % 7],
      despacha: DIAS[(segun + despacho) % 7],
      diasDeEspera: espera,
      diasHastaTransito: transito === null ? null : espera + transito,
      diasHastaDespacho: espera + despacho,
    };
  });
}

export function interpretarOpl(o: OplMalla): OplInterpretada {
  return { ...o, ventas: ventasDeOpl(o) };
}

/** YYYY-MM-DD más n días; a mediodía UTC para que ninguna zona horaria lo corra */
export function sumarDias(fecha: string, n: number) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Las fechas de una venta concreta (YYYY-MM-DD) en una OPL, o `null` si no tiene filas */
export function fechasDeVentaOpl(o: OplMalla, fechaVenta: string) {
  const dia = (new Date(`${fechaVenta}T12:00:00Z`).getUTCDay() + 6) % 7;
  const venta = ventasDeOpl(o)[dia];
  if (!venta) return null;
  return {
    venta: fechaVenta,
    transito: venta.diasHastaTransito === null ? null : sumarDias(fechaVenta, venta.diasHastaTransito),
    despacho: sumarDias(fechaVenta, venta.diasHastaDespacho),
    diasHastaDespacho: venta.diasHastaDespacho,
  };
}
