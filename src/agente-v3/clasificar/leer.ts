import { LIMITES, SIN_ATAJO } from '../constantes.js';
import { TIPOS_PETICION, type Clasificacion, type TipoPeticion } from '../interfaces/agente-v3.interface.js';

/**
 * Lee lo que devolvió Clasificar. Lo que dice el modelo es un dato, no una
 * orden: si no es un JSON con la forma pedida, o nombra un atajo que no está
 * en la lista, **no se arregla**: se dice por qué y el turno prueba otro
 * modelo (o sigue sin IA).
 */

export type Lectura<T> = { ok: true; valor: T } | { ok: false; motivo: string };

/** El primer objeto JSON del texto (el modelo a veces lo envuelve en ``` o en una frase) */
export function primerJson(texto: string): Record<string, unknown> | null {
  const s = String(texto ?? '').slice(0, LIMITES.salidaModelo).replace(/```(?:json)?/gi, '');
  const desde = s.indexOf('{');
  const hasta = s.lastIndexOf('}');
  if (desde < 0 || hasta <= desde) return null;
  try {
    const v: unknown = JSON.parse(s.slice(desde, hasta + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export function leerClasificacion(texto: string, atajos: string[]): Lectura<Clasificacion> {
  const j = primerJson(texto);
  if (!j) return { ok: false, motivo: 'no devolvió un JSON' };

  const tipo = typeof j.tipo === 'string' ? (plano(j.tipo).replace('cálculo', 'calculo') as TipoPeticion) : null;
  if (!tipo || !TIPOS_PETICION.includes(tipo)) return { ok: false, motivo: `tipo desconocido: ${JSON.stringify(j.tipo)}` };

  const dep = j.depende_del_anterior;
  if (typeof dep !== 'boolean') return { ok: false, motivo: 'depende_del_anterior no es true ni false' };

  // El atajo tiene que ser uno de la lista: por su nombre, sin mirar mayúsculas, tildes ni espacios
  let atajo: string | null = null;
  const dicho = typeof j.atajo === 'string' ? j.atajo.trim() : '';
  if (dicho && plano(dicho) !== plano(SIN_ATAJO) && !/^(ninguno|null|none|-)$/i.test(dicho)) {
    const encontrado = atajos.find((a) => plano(a) === plano(dicho.replace(/^«|»$/g, '')));
    if (!encontrado) return { ok: false, motivo: `nombró un atajo que no está en la lista: «${dicho.slice(0, 80)}»` };
    atajo = encontrado;
  }
  if (tipo === 'atajo' && !atajo) return { ok: false, motivo: 'dijo "atajo" sin decir cuál' };

  const motivo = typeof j.motivo === 'string' ? j.motivo.slice(0, 300) : '';
  // La respuesta de una charla se revisa al usarla (respuestaDeCharla): aquí solo se lee
  const respuesta = tipo === 'charla' && typeof j.respuesta === 'string' && j.respuesta.trim() ? j.respuesta.trim().slice(0, 600) : null;
  return { ok: true, valor: { tipo, dep, atajo, motivo, ...(tipo === 'charla' ? { respuesta } : {}) } };
}
