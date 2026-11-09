import { primerJson, type Lectura } from '../clasificar/leer.js';
import type { PasoEjecutado, Presentacion, Vista } from '../interfaces/agente-v3.interface.js';

/**
 * Presentar (decisión del usuario, 2026-11-09): al final, un modelo decide
 * CÓMO se enseña cada resultado según cómo lo pidió la persona ("en un cuadro
 * solo el total de la RT") y redacta la frase de forma natural. Las tablas
 * las sigue armando el código, y cada cifra o código de la frase tiene que
 * estar en los datos: si no, se usa la frase del código. No inventa nada.
 */

export const SISTEMA_PRESENTAR = `Decides CÓMO se enseña la respuesta del asistente de la operación logística de Ripley a lo que pidió la persona, y escribes su frase. No consultas nada: los resultados ya están, con lo que dicen.

Para cada resultado elige su "vista" (solo de las que tiene permitidas):
- "totales": un cuadro con los totales (cuántas, activas, inactivas…). Si pide "el total", "cuántas", "un resumen" o "un cuadro de totales", es esta (aunque diga "en un cuadro").
- "detalle": la tabla entera, fila a fila ("detállame", "cuáles", "dame las…").
- "uso": los porcentajes de consumo (solo si los pide).
- "frase": sin tabla; basta lo que dice la frase (una comprobación "fíjate que…", un sí o un no, un dato suelto).
- "plegado": la tabla se guarda plegada, para quien la quiera ver (lo intermedio, lo que no pidió ver).
Y el "orden": primero lo que pidió primero.

La "frase": una o dos oraciones naturales, en español claro y cercano, que contesten lo que pidió en su orden. USA SOLO las cifras, códigos y nombres que aparecen en lo que dicen los resultados: no calcules, no redondees, no inventes, no añadas datos. Sin tablas ni listas. No nombres los pasos por dentro («Búsqueda masiva de…», «Cálculo con lo del mensaje anterior»): di de qué es (la RE, la RT, el Big Ticket Lima) o "lo que te traje antes".

Responde SOLO con un JSON, sin texto alrededor:
{"resultados": [{"n": 1, "vista": "..."}], "orden": [1], "frase": "..."}`;

/** Las vistas que tiene cada herramienta */
export function vistasDe(herramienta: string): Vista[] {
  if (herramienta === 'consultar_capacidad') return ['totales', 'detalle', 'uso', 'frase', 'plegado'];
  if (herramienta === 'busqueda_masiva') return ['totales', 'detalle', 'frase', 'plegado'];
  // Un atajo de capacidad puede enseñar el consumo en % ("el consumo del bt lima en porcentaje")
  if (herramienta === 'ejecutar_atajo') return ['detalle', 'uso', 'frase', 'plegado'];
  return ['detalle', 'frase', 'plegado'];
}

/** Lo que el mensaje dice de la forma ("en un cuadro", "el total", "solo"…): entonces se presenta */
export const PIDE_FORMA = /\b(cuadro|tabla|total(es)?|resum\w*|solo|detall\w*|porcentaje|uso|cu[aá]nt[oa]s|lista\w*)\b/i;

export function promptPresentar(mensaje: string, pasos: PasoEjecutado[], intermedios: Set<number>, fraseDelCodigo: string): { sistema: string; mensaje: string } {
  const lineas = pasos.filter((p) => p.estado !== 'error').map((p) => [
    `- Resultado ${p.n}: ${p.que}${intermedios.has(p.n) ? ' (intermedio: da sus códigos a otro paso)' : ''}${p.comprobacion ? ' (es una comprobación)' : ''}`,
    `  Lo que dice: ${p.resumen}`,
    `  Vistas permitidas: ${vistasDe(p.herramienta).join(', ')}`,
  ].join('\n'));
  return {
    sistema: SISTEMA_PRESENTAR,
    mensaje: `LO QUE PIDIÓ LA PERSONA
«${mensaje}»

LOS RESULTADOS
${lineas.join('\n')}

LA FRASE QUE ARMÓ EL SISTEMA (con las cifras buenas)
${fraseDelCodigo}`,
  };
}

const numeros = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));

/**
 * Lee lo que decidió Presentar. Un paso que no existe o una vista que no tiene
 * no vale (otro intento). La frase, con cifras o códigos que no están en lo que
 * dijeron los resultados, se descarta (queda la del código) sin tirar las vistas.
 */
export function leerPresentacion(salida: string, pasos: PasoEjecutado[], material: string): Lectura<Presentacion> {
  const j = primerJson(salida);
  if (!j) return { ok: false, motivo: 'no devolvió un JSON' };
  const validos = pasos.filter((p) => p.estado !== 'error');
  const vistas: Record<string, Vista> = {};
  for (const r of Array.isArray(j.resultados) ? (j.resultados as Array<Record<string, unknown>>) : []) {
    const n = Number(r?.n);
    const paso = validos.find((p) => p.n === n);
    if (!paso) return { ok: false, motivo: `el resultado ${String(r?.n)} no existe` };
    const v = String(r.vista ?? '') === 'cuadro' ? 'detalle' : (String(r.vista ?? '') as Vista);
    if (!vistasDe(paso.herramienta).includes(v)) return { ok: false, motivo: `el resultado ${n} no tiene la vista «${String(r.vista)}» (tiene: ${vistasDe(paso.herramienta).join(', ')})` };
    vistas[String(n)] = v;
  }
  const pedido = (Array.isArray(j.orden) ? j.orden : []).map(Number).filter((n) => validos.some((p) => p.n === n));
  const orden = [...new Set([...pedido, ...validos.map((p) => p.n)])];

  // La frase: natural, pero con lo que hay. Cada cifra (y cada código) tiene que salir de los resultados
  let frase = typeof j.frase === 'string' ? j.frase.trim().replace(/\s+/g, ' ').slice(0, 600) : '';
  const permitidos = new Set(numeros(material));
  if (frase && (frase.includes('|') || numeros(frase).some((n) => !permitidos.has(n)))) frase = '';
  return { ok: true, valor: { vistas, orden, frase: frase || null } };
}
