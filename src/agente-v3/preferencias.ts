import { CON_AGENDA } from './agendas.js';
import type { PasoPlan, PreferenciaAgenda } from './interfaces/agente-v3.interface.js';
import { decodificar, TODAS, type PorElegir } from './zonas.js';

/**
 * Las agendas que cada persona eligió "para la próxima vez" (agente_preferencias,
 * la tabla de la v2; decisión del usuario, 2026-11-18).
 *
 * - Se guardan al contestar la pregunta de zona o agenda con la casilla
 *   «Recordar mi elección para la próxima vez». Son de esa persona y nadie más.
 * - Se usan en un CAMBIO, antes de preguntar: si para ese código (y esa clase
 *   de agenda y ese servicio) hay una guardada y sigue estando entre las
 *   opciones, va a esa sin preguntar, y se dice en los avisos. Si ya no existe,
 *   se pregunta y la vieja se borra.
 * - Lo que dice el mensaje ("la Aldea 6", "todas") manda sobre la preferencia.
 * - "Olvida mi preferencia de la 1401" la borra; "¿qué preferencias tengo?" las lista.
 */

/** La clase de agenda (las de la tabla) y el servicio de un paso de cambio, o null si no va a una agenda */
export function clavePreferencia(paso: PasoPlan): { clase: string; servicio: string } | null {
  const cfg = CON_AGENDA[paso.herramienta];
  const tipo = cfg?.tipo(paso.param) ?? null;
  const clase = tipo === 'opl' ? 'servicio_opl' : tipo;
  if (!clase || !['picking', 'despacho', 'recepcion', 'servicio_opl'].includes(clase)) return null;
  const servicio = (
    Array.isArray(paso.param.servicio) ? paso.param.servicio : String(paso.param.servicio ?? '').split(',')
  )
    .map((s) => String(s).trim().toUpperCase())
    .filter((s) => s && s !== 'TODOS')
    .sort()
    .join(',');
  return { clase, servicio };
}

/** Una opción elegida ("a:zona›agenda", una zona o "todas"), como fila de la tabla; null si no es una opción */
export function preferenciaDeEleccion(id: string): { agenda: string | null; zona: string | null } | null {
  if (!id) return null;
  const d = decodificar(id);
  if (d === TODAS) return { agenda: null, zona: TODAS };
  return { agenda: d.agenda ?? null, zona: d.zona ?? null };
}

const mismo = (a: unknown, b: unknown) =>
  String(a ?? '')
    .trim()
    .toLowerCase() ===
  String(b ?? '')
    .trim()
    .toLowerCase();

/** La opción de una duda que corresponde a una preferencia: la única que encaja, o null */
function opcionDe(o: PorElegir, p: PreferenciaAgenda): string | null {
  if (p.zona === TODAS && !p.agenda) return TODAS;
  const encajan = o.opciones.filter((x) => {
    const d = decodificar(x.id);
    if (d === TODAS) return false;
    if (p.agenda) return mismo(d.agenda, p.agenda) && (!p.zona || !d.zona || mismo(d.zona, p.zona));
    return Boolean(p.zona) && mismo(d.zona, p.zona);
  });
  return encajan.length === 1 ? encajan[0].id : null;
}

/**
 * Las preferencias de la persona sobre lo que habría que preguntar: las que
 * encajan se eligen (con su aviso), las que ya no existen se dan por viejas
 * (se borran) y lo demás se pregunta.
 */
export function aplicarPreferencias(
  porElegir: PorElegir[],
  preferencias: PreferenciaAgenda[],
  clave: { clase: string; servicio: string },
  pais: string,
): { elegidas: Record<string, string>; avisos: string[]; viejas: PreferenciaAgenda[]; quedan: PorElegir[] } {
  const elegidas: Record<string, string> = {};
  const avisos: string[] = [];
  const viejas: PreferenciaAgenda[] = [];
  const quedan: PorElegir[] = [];
  for (const o of porElegir) {
    const p = preferencias.find(
      (x) => x.pais === pais && x.clase === clave.clase && x.codigo === o.codigo && x.servicio === clave.servicio,
    );
    const id = p ? opcionDe(o, p) : null;
    if (p && id) {
      elegidas[o.codigo] = id;
      avisos.push(`${o.codigo}: usé tu preferencia (${id === TODAS ? 'todas' : (p.agenda ?? p.zona)}).`);
    } else {
      if (p) viejas.push(p);
      quedan.push(o);
    }
  }
  return { elegidas, avisos, viejas, quedan };
}

/** "Olvida mi preferencia de la 1401", "borra mis preferencias" */
export function pideOlvidarPreferencias(mensaje: string): boolean {
  return /\b(olvid\w*|borr\w*|quit\w*|elimin\w*)\b[^.?!]*\bpreferencias?\b/i.test(mensaje);
}

/** "¿Qué preferencias tengo?", "mis preferencias" */
export function pideVerPreferencias(mensaje: string): boolean {
  return (
    !pideOlvidarPreferencias(mensaje) &&
    // Sin \b tras "qué" y "cuáles": en JavaScript \b no ve las vocales con tilde
    /(?:qu[eé]|cu[aá]les|\bmis|\bver|\blista\w*|\bdame|\bmuestra\w*)[^.?!]*\bpreferencias\b/i.test(mensaje)
  );
}

const NOMBRE_CLASE: Record<string, string> = {
  picking: 'picking',
  despacho: 'despacho',
  recepcion: 'recepción',
  servicio_opl: 'servicios de OPL',
};

/** Una preferencia en palabras: "1401 · despacho (S): Zona 1401 - Suc. Aldea 6" */
export function preferenciaEnPalabras(p: PreferenciaAgenda): string {
  const donde =
    p.zona === TODAS && !p.agenda
      ? 'todas'
      : [p.agenda, p.zona && p.zona !== p.agenda ? `(${p.zona})` : null].filter(Boolean).join(' ');
  return `${p.codigo} · ${NOMBRE_CLASE[p.clase] ?? p.clase}${p.servicio ? ` (${p.servicio})` : ''}: ${donde}`;
}
