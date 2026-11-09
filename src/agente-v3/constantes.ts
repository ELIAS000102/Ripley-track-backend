/**
 * Lo fijo de la v3: los modelos que puede usar cada rol y el vocabulario de la
 * operación que decidió el usuario (agente-v3/PLAN.md, 2026-11-07).
 */

/**
 * Los nodos Gemini del flujo, en el orden en que se prueban. Todos son
 * Flash-Lite: con la cuota gratuita, el Flash da 20 llamadas al día por cuenta
 * y el Flash-Lite 500 (agente-v3/PLAN.md, "Límite: la cuota gratuita").
 * El nombre del nodo es el que tiene en n8n: el Switch del flujo va por él.
 */
export const MODELOS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'] as const;
/**
 * Aprender usa primero el 3.5 Flash (decisión del usuario, 2026-11-08): entiende
 * mejor y deja limpio lo que se guarda para todos. Su cuota es de 20 al día por
 * cuenta, pero aprender es raro; si se agota, siguen los Flash-Lite.
 */
export const MODELOS_DE_APRENDER = ['gemini-3.5-flash', ...MODELOS] as const;
/** Todos los modelos que puede usar algún rol (y que tienen su nodo en n8n) */
export const TODOS_LOS_MODELOS = MODELOS_DE_APRENDER;
export const CUENTAS = [1, 2, 3] as const;
export const nombreDelNodo = (modelo: string, cuenta: number) =>
  `${modelo.replace('gemini-', 'Gemini ').replace('-flash-lite', ' Flash-Lite').replace('-flash', ' Flash')} · cuenta ${cuenta}`;

/** Cuántas veces se prueba un modelo distinto en cada rol antes de seguir sin IA */
export const INTENTOS_POR_ROL = { clasificar: 4, armar: 4, calcular: 3, aprender: 4, presentar: 2, redactar: 3 } as const;

/** Lo que decidió el usuario sobre las palabras de la operación */
export const VOCABULARIO = [
  '"OPLs", "sucursales" o "tiendas" de un servicio de retiro (SE, ST, RT…) son las tiendas que lo tienen.',
  '"el 90 min" (su estado, si está activo, cómo está) es el atajo «Consultar 90 min (EX)».',
  '"simula la SE" / "simula la SD" es el atajo de esa simulación, aunque venga justo después de otra consulta.',
  'Las "agendas de recepción" son las del atajo «Recepción SE de Perú».',
  '"los anillos de la SD / del Same Day" son el atajo «OPLs de la SD por Anillos - Por servicios».',
  '"PQT LIMA" es «Paqueteria Lima»; "BT LIMA" es «Big Ticket Lima».',
  'Un "flujo" es una jornada. "Desface" es el desfase.',
  'Cerrar, abrir, activar, desactivar, cortar, reabrir, reasignar, cambiar el asignado o el desfase es un CAMBIO.',
];

/** El texto con el que se dice "no hay atajo" en la respuesta del clasificador */
export const SIN_ATAJO = '(ninguno)';

/** Lo más largo que se acepta de un mensaje o de lo que devuelve un modelo */
export const LIMITES = { mensaje: 2000, salidaModelo: 20000 } as const;
