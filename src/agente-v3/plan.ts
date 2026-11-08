import type { Clasificacion, ContextoTurno, PlanV3 } from './interfaces/agente-v3.interface.js';

/**
 * Lo que sigue después de clasificar. Un atajo, repetir lo del anterior o mirar
 * lo guardado tienen el plan hecho SIN otra llamada al modelo (~60 % de los
 * mensajes reales); la charla se contesta ya; una consulta pasa por Armar (1b)
 * y un cálculo por Qué calcular (1c).
 */

export type QueSigue =
  | { ok: true; plan: PlanV3 }
  | { ok: true; armar: true }
  | { ok: true; calcular: true }
  | { ok: true; charla: true }
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
      if (!pasos) return { ok: false, motivo: 'No sé qué parte de lo que tengo guardado quieres ver: ¿tiendas, OPL, CDs, servicios o atajos?' };
      return { ok: true, plan: { origen: 'saber', pasos } };
    }

    case 'charla':
      return { ok: true, charla: true };

    case 'consulta':
      return { ok: true, armar: true };

    case 'calculo': {
      const ant = contexto.anterior;
      if (!ant) return { ok: false, motivo: 'No hay un mensaje anterior con datos sobre los que calcular.' };
      if (!ant.resultados.some((r) => r.datos)) return { ok: false, motivo: 'Ese mensaje ya no tiene sus datos guardados (solo los 5 más recientes del chat los guardan): pídemelo de nuevo y lo consulto.' };
      return { ok: true, calcular: true };
    }
  }
}

/**
 * Qué parte de lo guardado: es buscar palabras, no entender, así que lo hace
 * el código. Si no queda claro, se dice que no y se pregunta con palabras.
 */
function queSaber(mensaje: string, contexto: ContextoTurno): PlanV3['pasos'] | null {
  const m = plano(mensaje);
  const pais = /chile/.test(m) ? 'CL' : /peru/.test(m) ? 'PE' : contexto.pais;
  if (/\batajo/.test(m)) return [{ herramienta: 'saber_atajos', param: {} }];
  if (/\bcds?\b|centro de distribucion/.test(m)) return [{ herramienta: 'saber_entidades', param: { pais, tipo: 'almacen', es_cd: true } }];
  if (/\bopls?\b|operador/.test(m)) return [{ herramienta: 'saber_entidades', param: { pais, tipo: 'opl' } }];
  if (/almacen/.test(m)) return [{ herramienta: 'saber_entidades', param: { pais, tipo: 'almacen' } }];
  if (/tienda|sucursal/.test(m)) return [{ herramienta: 'saber_entidades', param: { pais, tipo: 'tienda' } }];
  if (/servicio|fase/.test(m)) return [{ herramienta: 'saber_servicios', param: { pais } }];
  return null;
}
