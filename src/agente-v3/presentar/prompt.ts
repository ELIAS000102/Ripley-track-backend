import { primerJson, type Lectura } from '../clasificar/leer.js';
import { herramienta } from '../herramientas.js';
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

La "frase": una o dos oraciones naturales, en español claro y cercano, que contesten lo que pidió en su orden, como se lo diría una compañera del equipo. NO copies la frase del sistema: cuéntalo con tus palabras (sin punto y coma, sin "con 1 cerradas"; concuerda el singular y el plural). Lo importante primero (lo que está cerrado o sin cupo), y la tienda por su nombre con el código entre paréntesis si lo tienes ("Plaza Norte (20025)"). USA SOLO las cifras, códigos y nombres que aparecen en lo que dicen los resultados: no calcules, no redondees, no inventes, no añadas datos. Sin tablas ni listas. No nombres los pasos por dentro («Búsqueda masiva de…», «Cálculo con lo del mensaje anterior»): di de qué es (la RE, la RT, el Big Ticket Lima) o "lo que te traje antes".

Las "etiquetas": si abajo hay NOMBRES LARGOS DE LAS TABLAS, dale a cada uno un nombre corto para la columna (como mucho 24 letras) hecho SOLO con sus propias palabras o abreviándolas, quitando lo que ya dice su grupo o se repite (el código de la tienda, "Agenda", el servicio repetido): "Agenda Picking DT - 20021" → "Picking DT"; "Centralizado HUB San Luis - Zona Sur" → "Centralizado San Luis Sur". Si no hay, {}.

Responde SOLO con un JSON, sin texto alrededor:
{"resultados": [{"n": 1, "vista": "..."}], "orden": [1], "frase": "...", "etiquetas": {}}`;

/** Lo que es "largo" para una columna de la tabla */
const LARGO = 30;
const MAX_ETIQUETAS = 60;

/** Los nombres de agenda y de zona de los resultados que no caben bien en la tabla */
export function nombresLargos(pasos: PasoEjecutado[]): string[] {
  const vistos = new Set<string>();
  const recorrer = (v: unknown, hondo: number): void => {
    if (!v || typeof v !== 'object' || hondo > 8 || vistos.size >= MAX_ETIQUETAS) return;
    if (Array.isArray(v)) return v.forEach((x) => recorrer(x, hondo + 1));
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if ((k === 'agenda' || k === 'zona') && typeof x === 'string' && x.trim().length > LARGO) vistos.add(x.trim());
      else if (x && typeof x === 'object') recorrer(x, hondo + 1);
    }
  };
  // Los cambios tienen su propia tabla (dónde · día · ahora · quedaría): no se acortan
  for (const p of pasos) if (p.estado !== 'error' && !herramienta(p.herramienta)?.edicion) recorrer(p.datos, 0);
  return [...vistos].slice(0, MAX_ETIQUETAS);
}

const fichas = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Los nombres cortos que propuso el modelo, uno por uno: solo para nombres que
 * existen, más cortos, y hechos con sus propias palabras (enteras o abreviadas:
 * "Centr." de "Centralizado"); una cifra tiene que estar tal cual. Lo que no
 * cumple se descarta (queda el nombre largo); no tumba lo demás.
 */
export function leerEtiquetas(v: unknown, largos: string[]): Record<string, string> {
  const fuera: Record<string, string> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fuera;
  for (const [largo, corto] of Object.entries(v as Record<string, unknown>)) {
    if (!largos.includes(largo) || typeof corto !== 'string') continue;
    const c = corto.trim().replace(/\s+/g, ' ');
    if (c.length < 2 || c.length > 32 || c.length >= largo.length) continue;
    const suyas = fichas(largo);
    const vale = fichas(c).every((w) => (/^\d+$/.test(w) ? suyas.includes(w) : suyas.some((s) => s === w || (w.length >= 2 && s.startsWith(w)))));
    if (vale) fuera[largo] = c;
  }
  return fuera;
}

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
  const largos = nombresLargos(pasos);
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

LA FRASE QUE ARMÓ EL SISTEMA (con las cifras buenas; escríbela mejor)
${fraseDelCodigo}${largos.length ? `\n\nNOMBRES LARGOS DE LAS TABLAS\n${largos.map((l) => `- ${l}`).join('\n')}` : ''}`,
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
  const etiquetas = leerEtiquetas(j.etiquetas, nombresLargos(pasos));
  return { ok: true, valor: { vistas, orden, frase: frase || null, ...(Object.keys(etiquetas).length ? { etiquetas } : {}) } };
}
