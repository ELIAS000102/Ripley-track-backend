import type { AtajoDelContexto } from './interfaces/agente-v3.interface.js';

/**
 * Qué atajo NOMBRA un mensaje, con precisión (pedido del usuario, 2026-11-09:
 * "no debe guiarse por palabras clave"): por su nombre entero o por su apodo,
 * lo que va entre paréntesis en su descripción ("… del Big Ticket Lima (BT
 * LIMA)"). Una palabra suelta ("lima") no nombra ningún atajo.
 */

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Lo que trae cada clase de bloque de un atajo, para que el modelo sepa si sirve para lo que se pide */
export const QUE_TRAE: Record<string, string> = {
  picking: 'capacidad de picking',
  despacho: 'capacidad de despacho',
  recepcion: 'capacidad de recepción',
  transferencia: 'capacidad de transferencia',
  masivo: 'estado de las agendas de un servicio (activas, en checkout)',
  opl: 'servicios de OPL (activo, checkout, corte, holgura)',
  simulacion: 'simulación de entrega',
};

/** Un atajo en una línea del prompt: nombre, qué trae y su descripción */
export function atajoEnLinea(a: AtajoDelContexto, conPais = false): string {
  const trae = [...new Set(a.tipos.map((t) => QUE_TRAE[t] ?? t))].join('; ') || 'sin bloques';
  return `- «${a.nombre}» — trae: ${trae}${conPais ? ` (${a.pais === 'CL' ? 'Chile' : 'Perú'})` : ''}. ${a.descripcion ?? ''}`.trim();
}

/** Los apodos de un atajo: lo que va entre paréntesis en su descripción, si es un nombre (dos palabras o 4+ letras) */
export function apodosDe(a: Pick<AtajoDelContexto, 'descripcion'>): string[] {
  return [...String(a.descripcion ?? '').matchAll(/\(([^()]{2,30})\)/g)]
    .map((m) => plano(m[1]))
    .filter((x) => x && (x.includes(' ') || x.length >= 4));
}

/** Los atajos que nombra el mensaje (por nombre o apodo), del país dado */
export function atajosNombrados(mensaje: string, atajos: AtajoDelContexto[], pais?: string): AtajoDelContexto[] {
  const m = ` ${plano(mensaje)} `;
  return atajos.filter((a) => (!pais || a.pais === pais) && [plano(a.nombre), ...apodosDe(a)].some((n) => n && m.includes(` ${n} `)));
}

/** El atajo que tiene que usar el plan: el que identificó Clasificar o, si no, el único que nombra el mensaje */
export function atajoEsperado(mensaje: string, atajos: AtajoDelContexto[], deClasificar: string | null | undefined, pais: string): string | null {
  if (deClasificar) return deClasificar;
  const nombrados = atajosNombrados(mensaje, atajos, pais);
  return nombrados.length === 1 ? nombrados[0].nombre : null;
}
