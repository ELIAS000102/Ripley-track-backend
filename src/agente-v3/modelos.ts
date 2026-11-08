import { CUENTAS, INTENTOS_POR_ROL, MODELOS, MODELOS_DE_APRENDER, nombreDelNodo } from './constantes.js';
import type { IntentoModelo, ModeloElegido, RolModelo } from './interfaces/agente-v3.interface.js';

/**
 * Qué nodo Gemini usa cada llamada. Lo decide el backend (no un Code node de
 * n8n): n8n solo va al nodo que se le dice.
 *
 * Cada turno empieza por una cuenta (se turnan por turno, para repartir la
 * cuota) y prueba los modelos en orden. Si uno falla, el motivo dice qué se
 * descarta:
 * - **saturado** (503): es el modelo el que está lleno, para todas las cuentas → otro modelo;
 * - **cuota** (429): es esa cuenta con ese modelo → el mismo modelo en otra cuenta;
 * - **otro** (una credencial sin elegir, un 400): ese par, en todos los roles;
 * - **respuesta** (contestó algo que no vale): ese par, solo en ese rol (en otro rol puede ir bien).
 *
 * Lo que falló en un rol lo saben los que vienen detrás en el mismo turno.
 */

/** La cuenta con la que empieza un turno: siempre la misma para el mismo turno */
export function cuentaDelTurno(turnoId: string): number {
  let h = 0;
  for (const c of turnoId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CUENTAS[h % CUENTAS.length];
}

/** Por qué falló un modelo, leído del error que mandó n8n */
export function claseDeFallo(motivo: string): 'saturado' | 'cuota' | 'otro' {
  if (/\b503\b|overloaded|high demand|unavailable/i.test(motivo)) return 'saturado';
  if (/\b429\b|quota|resource.?exhausted|rate.?limit/i.test(motivo)) return 'cuota';
  return 'otro';
}

/**
 * El siguiente modelo para un rol, o null si ya no queda ninguno (o se
 * agotaron los intentos de ese rol): entonces se sigue sin IA.
 */
export function elegirModelo(rol: RolModelo, turnoId: string, intentos: IntentoModelo[]): ModeloElegido | null {
  const delRol = intentos.filter((i) => i.rol === rol);
  if (delRol.length >= INTENTOS_POR_ROL[rol]) return null;

  const fallidos = intentos.filter((i) => !i.ok);
  const saturados = new Set(fallidos.filter((i) => i.clase === 'saturado').map((i) => i.nombre));
  const descartado = (nombre: string, cuenta: number) =>
    saturados.has(nombre) || fallidos.some((i) => i.nombre === nombre && i.cuenta === cuenta && (i.clase !== 'respuesta' || i.rol === rol));

  const primera = cuentaDelTurno(turnoId);
  const cuentas = CUENTAS.map((_, k) => CUENTAS[(CUENTAS.indexOf(primera as (typeof CUENTAS)[number]) + k) % CUENTAS.length]);

  // Aprender empieza por el 3.5 Flash; los demás roles, por los Flash-Lite
  for (const nombre of rol === 'aprender' ? MODELOS_DE_APRENDER : MODELOS) {
    for (const cuenta of cuentas) {
      if (!descartado(nombre, cuenta)) return { rol, cuenta, nombre, nodo: nombreDelNodo(nombre, cuenta) };
    }
  }
  return null;
}
