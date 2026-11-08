import type { Clasificacion, ContextoTurno, PlanV3 } from './interfaces/agente-v3.interface.js';

/**
 * Lo que sigue después de clasificar. Un atajo, repetir lo del anterior o mirar
 * lo guardado tienen el plan hecho SIN otra llamada al modelo (~60 % de los
 * mensajes reales); la charla se contesta ya; una consulta pasa por Armar (1b),
 * un cálculo por Qué calcular (1c), un cambio por Armar con las ediciones (en
 * vista previa: no se aplica nada) y lo que se enseña por Aprender.
 */

export type QueSigue =
  | { ok: true; plan: PlanV3 }
  | { ok: true; armar: true; cambio?: boolean }
  | { ok: true; calcular: true }
  | { ok: true; charla: true }
  | { ok: true; aprender: true }
  | { ok: false; motivo: string };

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function planDe(c: Clasificacion, contexto: ContextoTurno, mensaje: string): QueSigue {
  switch (c.tipo) {
    case 'atajo':
      return { ok: true, plan: { origen: 'atajo', pasos: [{ herramienta: 'ejecutar_atajo', param: { nombre: c.atajo } }] } };

    case 'repetir': {
      const ant = contexto.anterior;
      if (!ant) return { ok: false, motivo: 'No hay un mensaje anterior que repetir.' };
      if (!ant.plan?.pasos.length) return { ok: false, motivo: 'No sé repetir lo que hizo ese mensaje: pídemelo con sus palabras.' };
      return { ok: true, plan: { origen: 'repetir', pasos: ant.plan.pasos, ...(ant.plan.calculo ? { calculo: ant.plan.calculo } : {}) } };
    }

    case 'saber': {
      const pasos = queSaber(mensaje, contexto);
      if (!pasos) return { ok: false, motivo: 'No sé qué parte de lo que tengo guardado quieres ver: ¿tiendas, OPL, CDs, servicios, fases o atajos?' };
      return { ok: true, plan: { origen: 'saber', pasos } };
    }

    case 'charla':
      return { ok: true, charla: true };

    case 'consulta':
      return { ok: true, armar: true };

    case 'cambio':
      return { ok: true, armar: true, cambio: true };

    case 'enseñar':
      return { ok: true, aprender: true };

    case 'calculo': {
      const ant = contexto.anterior;
      if (!ant) return { ok: false, motivo: 'No hay un mensaje anterior con datos sobre los que calcular.' };
      if (!ant.resultados.some((r) => r.datos)) return { ok: false, motivo: 'Ese mensaje ya no tiene sus datos guardados (solo los 5 más recientes del chat los guardan): pídemelo de nuevo y lo consulto.' };
      return { ok: true, calcular: true };
    }
  }
}

/** "fase 1", "F2", "fase tres", "despacho directo" → F1, F2, F3, DD */
export function faseDe(mensaje: string): string | null {
  const m = plano(mensaje);
  const n = /\bf\s?([123])\b|\bfase\s*(1|2|3|uno|dos|tres|i{1,3})\b|\b(primera|segunda|tercera) fase\b/.exec(m);
  if (n) {
    const v = n[1] ?? n[2] ?? n[3];
    const num = ({ uno: 1, i: 1, primera: 1, dos: 2, ii: 2, segunda: 2, tres: 3, iii: 3, tercera: 3 } as Record<string, number>)[v] ?? Number(v);
    return `F${num}`;
  }
  return /\bdd\b|despacho directo|fase dd/.test(m) ? 'DD' : null;
}

/**
 * Los servicios que nombra el mensaje: "la SG", "el servicio ST", o en
 * mayúsculas. "se" suelto es una palabra, no la SE: solo cuenta en mayúsculas
 * o detrás de "la", "el", "del", "servicio".
 */
export function serviciosNombrados(mensaje: string, conocidos: string[]): string[] {
  const set = new Set(conocidos.map((c) => c.toUpperCase()));
  const salida = new Set<string>();
  for (const m of mensaje.matchAll(/\b(?:la|el|del|de la|servicio|servicios)\s+([A-Za-z]{1,3})\b/gi)) if (set.has(m[1].toUpperCase())) salida.add(m[1].toUpperCase());
  for (const m of mensaje.matchAll(/\b([A-Z]{1,3})\b/g)) if (set.has(m[1])) salida.add(m[1]);
  return [...salida];
}

/**
 * Qué parte de lo guardado, y de qué: es buscar palabras y códigos, no
 * entender, así que lo hace el código. "¿Qué es la fase 1?" → esa fase; "¿qué
 * es la SG?" → ese servicio; "¿qué es el 1130?" → esa entidad. Si no queda
 * claro, se dice que no y se pregunta con palabras.
 */
function queSaber(mensaje: string, contexto: ContextoTurno): PlanV3['pasos'] | null {
  const m = plano(mensaje);
  const pais = /chile/.test(m) ? 'CL' : /peru/.test(m) ? 'PE' : contexto.pais;
  const fase = faseDe(mensaje);
  const servicios = serviciosNombrados(mensaje, contexto.servicios.map((s) => s.codigo));
  const codigos = contexto.entidades.flatMap((e) => (e.porNombre ? e.candidatos.map((c) => c.codigo) : [e.texto]));
  const metodo = /retiro/.test(m) ? 'RT' : /despacho|domicilio/.test(m) ? 'DP' : null;
  if (/\batajo/.test(m)) return [{ herramienta: 'saber_atajos', param: {} }];
  if (fase && !servicios.length) return [{ herramienta: 'saber_fases', param: { pais, fase } }];
  if (servicios.length) return [{ herramienta: 'saber_servicios', param: { pais, servicio: servicios } }];
  if (codigos.length) return [{ herramienta: 'saber_entidades', param: { codigo: codigos } }];
  if (/\bcds?\b|centro de distribucion/.test(m)) return [{ herramienta: 'saber_entidades', param: { pais, tipo: 'almacen', es_cd: true } }];
  if (/\bopls?\b|operador/.test(m)) return [{ herramienta: 'saber_entidades', param: { pais, tipo: 'opl' } }];
  if (/almacen/.test(m)) return [{ herramienta: 'saber_entidades', param: { pais, tipo: 'almacen' } }];
  if (/tienda|sucursal/.test(m)) return [{ herramienta: 'saber_entidades', param: { pais, tipo: 'tienda' } }];
  if (/servicio|fase/.test(m)) return [{ herramienta: 'saber_servicios', param: { pais, ...(metodo ? { metodo } : {}) } }];
  return null;
}
