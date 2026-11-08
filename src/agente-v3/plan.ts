import type { Clasificacion, ContextoTurno, PlanV3 } from './interfaces/agente-v3.interface.js';

/**
 * El plan que sale de la clasificación SIN otra llamada al modelo: un atajo,
 * repetir lo del anterior o mirar lo guardado (~60 % de los mensajes reales).
 * Las consultas a mano y los cálculos llegan en las partes 1b y 1c: hasta
 * entonces se contesta que todavía no.
 */

export type PlanDe = { ok: true; plan: PlanV3 } | { ok: false; motivo: string };

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function planDe(c: Clasificacion, contexto: ContextoTurno, mensaje: string): PlanDe {
  switch (c.tipo) {
    case 'atajo':
      return { ok: true, plan: { origen: 'atajo', pasos: [{ herramienta: 'ejecutar_atajo', param: { nombre: c.atajo } }] } };

    case 'repetir': {
      const ant = contexto.anterior;
      if (!ant) return { ok: false, motivo: 'No hay un mensaje anterior que repetir.' };
      if (!ant.plan?.pasos.length) return { ok: false, motivo: 'Todavía no sé repetir lo que hizo ese mensaje: pídemelo con sus palabras.' };
      return { ok: true, plan: { origen: 'repetir', pasos: ant.plan.pasos } };
    }

    case 'saber': {
      const pasos = queSaber(mensaje, contexto);
      if (!pasos) return { ok: false, motivo: 'No sé qué parte de lo que tengo guardado quieres ver: ¿tiendas, OPL, CDs, servicios o atajos?' };
      return { ok: true, plan: { origen: 'saber', pasos } };
    }

    case 'consulta':
      return { ok: false, motivo: 'Las consultas a mano (sin un atajo) todavía no las hace la v3: llegan en la parte 1b.' };

    case 'calculo':
      return { ok: false, motivo: 'Calcular con lo que trajo el mensaje anterior todavía no lo hace la v3: llega en la parte 1c.' };
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
