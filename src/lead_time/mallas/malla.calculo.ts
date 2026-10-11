import { DIAS } from '../matrices/interfaces/matriz.interface.js';
import type { OplInterpretada, OplMalla, VentaMalla } from './interfaces/malla.interface.js';

/**
 * Cómo se lee una malla, en reglas.
 *
 * 1. Cada OPL y flujo tiene una fila por **día de venta**, con una celda
 *    "Venta", una "Despacho" y, si las hay, una "Transito" y una "Recojo",
 *    cada una en la columna de su día.
 * 2. Lo que cuenta es la distancia entre ellas: venta el lunes, tránsito el
 *    miércoles y despacho el jueves son 2 y 3 días.
 * 3. Un día de venta sin fila va con el siguiente que la tenga, hacia delante.
 *
 * Ejemplo (OPL 4014, flujo S): venta el viernes, tránsito el lunes, despacho
 * el martes → 4 días. Flujo OP: venta el domingo, recojo el lunes, despacho el
 * martes → 2 días.
 */

/**
 * El lead time de cada día de venta: cuándo va en tránsito, cuándo se recoge
 * y cuándo se despacha lo vendido ese día de la semana. Sin filas, nada.
 */
export function ventasDeOpl(o: OplMalla): VentaMalla[] {
  if (!o.dias.some(Boolean)) return [];
  return DIAS.map((venta, v) => {
    let espera = 0;
    while (!o.dias[(v + espera) % 7]) espera++;
    const segun = (v + espera) % 7;
    const { transito, recojo, despacho } = o.dias[segun]!;
    const dia = (n: number | null) => (n === null ? null : DIAS[(segun + n) % 7]);
    const hasta = (n: number | null) => (n === null ? null : espera + n);
    return {
      venta,
      segun: DIAS[segun],
      transita: dia(transito),
      recoge: dia(recojo),
      despacha: DIAS[(segun + despacho) % 7],
      diasDeEspera: espera,
      diasHastaTransito: hasta(transito),
      diasHastaRecojo: hasta(recojo),
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

/** Las fechas de una venta concreta (YYYY-MM-DD) en una malla, o `null` si no tiene filas */
export function fechasDeVentaOpl(o: OplMalla, fechaVenta: string) {
  const dia = (new Date(`${fechaVenta}T12:00:00Z`).getUTCDay() + 6) % 7;
  const venta = ventasDeOpl(o)[dia];
  if (!venta) return null;
  const fecha = (n: number | null) => (n === null ? null : sumarDias(fechaVenta, n));
  return {
    venta: fechaVenta,
    transito: fecha(venta.diasHastaTransito),
    recojo: fecha(venta.diasHastaRecojo),
    despacho: sumarDias(fechaVenta, venta.diasHastaDespacho),
    diasHastaDespacho: venta.diasHastaDespacho,
  };
}
