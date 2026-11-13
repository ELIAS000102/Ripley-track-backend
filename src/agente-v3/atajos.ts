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
  reporte: 'ocupación de los CDs',
};

/** Lo que puede pedir una persona (Clasificar lo dice en "pide"): las mismas clases que trae un atajo */
export const PIDE = Object.keys(QUE_TRAE);

/** Lo que se contesta igual con una clase u otra: el estado de las agendas y los servicios de OPL; la ocupación de un CD y su picking */
const AFINES: Record<string, string[]> = { masivo: ['opl'], opl: ['masivo'], reporte: ['picking'], picking: ['reporte'] };

/** Lo que trae un paso del plan */
export function traePaso(paso: { herramienta: string; param: Record<string, unknown> }, atajos: AtajoDelContexto[]): string[] {
  switch (paso.herramienta) {
    case 'consultar_capacidad': return typeof paso.param.tipo === 'string' ? [paso.param.tipo] : [];
    case 'consultar_reporte_cds': return ['reporte'];
    case 'busqueda_masiva': return ['masivo'];
    case 'consultar_servicios_opl': return ['opl'];
    case 'consultar_transferencia': return ['transferencia'];
    case 'simular_entrega': return ['simulacion'];
    case 'ejecutar_atajo': return atajos.find((a) => a.nombre === paso.param.nombre)?.tipos ?? [];
    default: return [];
  }
}

/** De lo que se pide, lo que no trae nada de lo que hay ("se pide despacho" y solo hay "masivo") */
export function sinTraer(pide: string[] | undefined, trae: string[]): string[] {
  const hay = new Set(trae.flatMap((t) => [t, ...(AFINES[t] ?? [])]));
  return (pide ?? []).filter((p) => !hay.has(p));
}

/** Por qué no vale: "se pide capacidad de despacho y …" (el principio es fijo: con él se sabe que ya se avisó) */
export const NO_TRAE = 'se pide ';
export const motivoNoTrae = (faltan: string[], quien: string) => `${NO_TRAE}${faltan.map((p) => QUE_TRAE[p] ?? p).join(' y ')} y ${quien} no lo trae`;

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
