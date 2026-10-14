import type { LlamadaHerramienta, RespuestaAgente } from '../interfaces/rutinas.interface.js';

export interface Evaluacion {
  estado: 'completado' | 'fallido';
  /** Por qué falló, en una frase que diga qué hacer */
  motivo?: string;
}

/** Lo que el flujo llama por su cuenta y el backend no anota como herramienta */
const DEL_FLUJO = new Set(['Atajos disponibles']);

const normalizar = (s?: string) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const recorte = (s?: string, n = 300) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const fallo = (motivo: string): Evaluacion => ({ estado: 'fallido', motivo });

/** Lo que dice "Explicar fallo" cuando el que reventó fue el modelo, no una herramienta */
const IA_CAIDA: Record<string, string> = {
  saturado: 'estaba saturada',
  cuota: 'se quedó sin cuota',
};

/**
 * Si un paso de una rutina salió bien.
 *
 * **Los pasos son estrictos**: cualquier cosa que en el chat terminaría en una
 * pregunta o en un "lo demás, pídemelo después" aquí es un fallo, porque nadie
 * va a contestar. Y no se fía del texto de Silvana: lo que decide es lo que el
 * backend respondió a cada herramienta que el paso llamó con su token.
 *
 * Falla, en este orden:
 * 1. si no se pudo hablar con n8n, o tardó demasiado;
 * 2. si el flujo no es el que entiende las rutinas (hay que reimportarlo);
 * 3. si el flujo no supo terminar (y si fue la IA, lo dice);
 * 3b. si la IA no dio un plan —ni la de respaldo—: el paso no se hizo;
 * 4. si le faltó un dato, o no entendió la instrucción;
 * 4b. si el plan traía algo que no se puede hacer: el flujo no hizo nada;
 * 5. si dejó parte del paso sin hacer, o se paró antes de hacer sus llamadas;
 * 6. si una herramienta respondió con error;
 * 7. si una herramienta respondió bien pero con filas que fallaron;
 * 8. si el flujo llamó a más herramientas de las que llegaron al backend: a
 *    alguna la rechazó un guard antes de que se pudiera anotar;
 * 9. si el paso nombraba atajos y no se usó alguno.
 */
export function evaluarPaso(e: {
  respuesta?: RespuestaAgente;
  error?: string;
  llamadas: LlamadaHerramienta[];
  atajos: string[];
}): Evaluacion {
  if (e.error) return fallo(e.error);

  const r = e.respuesta ?? {};
  const rutina = r.rutina;

  if (!rutina) {
    return fallo('El flujo de n8n no reconoce las rutinas: reimporta el flujo actualizado y vuelve a probar.');
  }
  if (rutina.error) {
    const ia = IA_CAIDA[rutina.motivo ?? ''];
    return fallo(ia
      ? `La IA (Gemini) ${ia} a mitad del paso, también el modelo de respaldo: quedó a medias. Suele ser pasajero: reanúdala en unos minutos.`
      : `Silvana no pudo terminar el paso${r.respuesta ? `: ${recorte(r.respuesta)}` : '.'}`);
  }
  if (rutina.tipo === 'sinPlan') {
    return (rutina.fallaIA ?? 'no respondió').startsWith('no respondió')
      ? fallo('La IA que arma el plan (Gemini) no respondió, tampoco la de respaldo: no se hizo nada de este paso. Suele ser pasajero: reanúdala en unos minutos.')
      : fallo('La IA que arma el plan respondió algo que no es un plan: no se hizo nada de este paso. Reanúdala; si se repite, reescribe la instrucción con los datos concretos.');
  }
  if (rutina.tipo === 'faltan') {
    const faltan = (rutina.faltan ?? []).filter(Boolean);
    return fallo(`Le faltó un dato para hacerlo${faltan.length ? `: ${faltan.join('; ')}` : ''}. Escríbelo en la instrucción.`);
  }
  if (rutina.tipo === 'aclarar' || rutina.tipo === 'corregir') {
    return fallo('No entendió la instrucción. Reescríbela con los datos concretos: códigos, servicios y fechas.');
  }
  if (rutina.tipo === 'incompleto') {
    // El flujo no hizo nada: un plan a medias dejaría aplicada la mitad
    const descartados = (rutina.descartados ?? []).filter(Boolean);
    return fallo(`No se hizo nada de este paso: el plan traía algo que no se puede hacer${descartados.length ? ` (${descartados.join('; ')})` : ''}. Reescribe la instrucción con los datos concretos, o pártela en pasos.`);
  }
  if (rutina.descartados?.length) {
    return fallo(`Dejó sin hacer parte del paso: ${rutina.descartados.join('; ')}. Pártelo en pasos más cortos.`);
  }

  if (rutina.sinTerminar) {
    const faltaron = (rutina.faltaron ?? []).filter(Boolean);
    return fallo(faltaron.length
      ? `No llegó a hacer todas las llamadas: faltaron ${faltaron.join(', ')}.`
      : `Se paró antes de terminar: en vez de llamar a las herramientas, contestó "${recorte(r.respuesta, 200)}".`);
  }

  // Un 400 porque todo ya estaba como se pedía no es un fallo: el estado se cumple
  const mala = e.llamadas.find((l) => l.estado >= 400 && !l.yaEstaba);
  if (mala) return fallo(`"${mala.herramienta}" respondió ${mala.estado}: ${mala.problemas[0] ?? 'sin detalle'}`);

  const conProblemas = e.llamadas.find((l) => l.problemas.length);
  if (conProblemas) return fallo(`"${conProblemas.herramienta}": ${conProblemas.problemas.join(' · ')}`);

  const dichas = (rutina.herramientas ?? []).filter((h) => !DEL_FLUJO.has(h));
  if (dichas.length > e.llamadas.length) {
    return fallo('Una de las herramientas que llamó no llegó a responder: el backend la rechazó antes. Vuelve a probarla.');
  }

  const usados = e.llamadas.map((l) => normalizar(l.atajo)).filter(Boolean);
  const sinUsar = e.atajos.filter((a) => {
    const pedido = normalizar(a);
    return !usados.some((u) => u === pedido || u.includes(pedido) || pedido.includes(u));
  });
  if (sinUsar.length) {
    return fallo(`No usó ${sinUsar.length === 1 ? 'el atajo' : 'los atajos'} que pide el paso: ${sinUsar.map((a) => `"${a}"`).join(', ')}.`);
  }

  return { estado: 'completado' };
}
