import { DIAS, type Dia } from '../mallas_leadtime/interfaces/malla.interface.js';
import type { DiaDespacho, OplInterpretada, OplMalla, VentaDespacho } from './interfaces/malla-despacho.interface.js';

/**
 * Cómo se lee una malla de despacho, en reglas.
 *
 * 1. Cada fila es una OPL y un **día de venta**, con el día en **tránsito**
 *    (opcional) y el de **despacho**.
 * 2. El tránsito es el primer día con ese nombre **desde** la venta; el
 *    despacho, el primero **desde** el tránsito (o desde la venta, sin
 *    tránsito). El mismo día de la semana es el mismo día: para la semana
 *    siguiente se escribe "+7" ("Lunes+7").
 * 3. "+N" suma N días a ese paso.
 * 4. Un día de venta sin fila va con el siguiente que la tenga, hacia delante.
 *
 * Ejemplo (OPL 4014): venta el lunes, tránsito el miércoles, despacho el
 * jueves → 3 días de lead time.
 */

/** Cómo se puede escribir cada día: completo, abreviado o con su letra */
const NOMBRES: Record<string, Dia> = {
  lunes: 'L', lun: 'L', lu: 'L', l: 'L',
  martes: 'M', mar: 'M', ma: 'M', m: 'M',
  miercoles: 'W', mie: 'W', mi: 'W', w: 'W', x: 'W',
  jueves: 'J', jue: 'J', ju: 'J', j: 'J',
  viernes: 'V', vie: 'V', vi: 'V', v: 'V',
  sabado: 'S', sab: 'S', sa: 'S', s: 'S',
  domingo: 'D', dom: 'D', do: 'D', d: 'D',
};

/** Lo más que puede sumar un "+N" */
export const SUMA_MAXIMA = 30;

const sinAcentos = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/**
 * "Miércoles" → { dia: 'W', suma: 0 }; "jue+7" → { dia: 'J', suma: 7 }.
 * Vacío → `null`; algo que no es un día → `undefined`.
 */
export function leerDia(texto: string | null | undefined): { dia: Dia; suma: number } | null | undefined {
  if (!texto?.trim()) return null;
  const m = /^([a-z]+)\.?\s*(?:\+\s*(\d+))?$/.exec(sinAcentos(texto));
  if (!m || !NOMBRES[m[1]]) return undefined;
  const suma = m[2] ? Number(m[2]) : 0;
  if (suma > SUMA_MAXIMA) return undefined;
  return { dia: NOMBRES[m[1]], suma };
}

/** Un día como se guarda: "W" o "J+7" */
export const escribirDia = (d: { dia: Dia; suma: number }) => (d.suma ? `${d.dia}+${d.suma}` : d.dia);

const indice = (d: Dia) => DIAS.indexOf(d);

/** Los pasos de una fila contados desde su día de venta */
function pasos(fila: DiaDespacho, venta: number) {
  const transito = leerDia(fila.transito);
  const despacho = leerDia(fila.despacho)!;
  const hastaTransito = transito ? ((indice(transito.dia) - venta + 7) % 7) + transito.suma : null;
  const desde = venta + (hastaTransito ?? 0);
  const hastaDespacho = (hastaTransito ?? 0) + ((indice(despacho.dia) - (desde % 7) + 7) % 7) + despacho.suma;
  return { hastaTransito, hastaDespacho };
}

/**
 * El lead time de cada día de venta: cuándo va en tránsito y cuándo se
 * despacha lo vendido ese día de la semana.
 *
 * Sin ninguna fila no hay ventas que calcular.
 */
export function ventasDeOpl(o: OplMalla): VentaDespacho[] {
  if (!o.dias.some(Boolean)) return [];
  return DIAS.map((venta, v) => {
    let espera = 0;
    while (!o.dias[(v + espera) % 7]) espera++;
    const segun = (v + espera) % 7;
    const { hastaTransito, hastaDespacho } = pasos(o.dias[segun]!, segun);
    return {
      venta,
      segun: DIAS[segun],
      transita: hastaTransito === null ? null : DIAS[(segun + hastaTransito) % 7],
      despacha: DIAS[(segun + hastaDespacho) % 7],
      diasDeEspera: espera,
      diasHastaTransito: hastaTransito === null ? null : espera + hastaTransito,
      diasHastaDespacho: espera + hastaDespacho,
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
