import { primerJson, type Lectura } from '../clasificar/leer.js';
import { codigosPermitidos } from '../armar/leer.js';
import type { ContextoTurno, Hecho } from '../interfaces/agente-v3.interface.js';

/**
 * Aprender (decisión del usuario, 2026-11-08): lo que una persona enseña de la
 * operación ("la SG es el site to store de gran volumen; sale siempre del CD
 * Aldeas 20096…") lo pasa a datos LIMPIOS un modelo (el 3.5 Flash primero) y el
 * código lo valida. No se guarda nada sin un "sí", y la pregunta va al final.
 */

const NOMBRE_PAIS = { PE: 'Perú', CL: 'Chile' } as const;

export const SISTEMA_APRENDER = `Pasas a datos LIMPIOS lo que una persona le enseña al asistente de la operación logística de Ripley (Perú y Chile), para guardarlo y que lo use todo el equipo. No contestas a la persona.

Devuelve "hechos" (uno por servicio o por código del que se enseña algo) y "dudas":
- Un SERVICIO: {"tipo": "servicio", "codigo": "SG", "nombre": "Site to Store Gran Volumen", "metodo_entrega": "RT" | "DP", "fase": "F1" | "F2" | "F3" | "DD", "origen": "20096", "descripcion": "…"}
  · nombre: el nombre del servicio bien escrito (mayúsculas donde toca), sin el código.
  · metodo_entrega: "RT" si se retira en tienda; "DP" si se despacha a domicilio.
  · fase (mira FASES): F1 = la tienda pickea y la misma tienda entrega; F2 = el CD o almacén pickea, transfiere y la tienda recepciona y entrega; F3 = una tienda fuente de stock pickea, transfiere a un CD y este a otra tienda; DD = despacho a domicilio. Solo si se dijo o se deduce SIN DUDA del recorrido que se cuenta.
  · origen: el código del CD o almacén de donde sale SIEMPRE el stock, si se dijo (mira CÓDIGOS DEL MENSAJE para "el CD Aldeas").
  · descripcion: una o dos frases en buen español que expliquen el recorrido y lo que lo distingue (sin repetir el nombre ni el origen), corrigiendo faltas y muletillas.
- Un CÓDIGO (tienda, almacén/CD u OPL): {"tipo": "entidad", "codigo": "1439", "clase": "tienda" | "almacen" | "opl", "es_cd": true | false, "nombre": "BT F.E Trujillo", "alias": ["…"]}
Reglas:
- Lo que no se dijo va null: no inventes nada. Ningún código que no esté en el mensaje o en CÓDIGOS DEL MENSAJE.
- Si algo no queda claro (¿qué CD es "el de Aldeas"?, ¿es retiro o despacho?), ponlo en "dudas" como una pregunta corta.
- Si la persona corrige lo que entendiste antes (LO QUE ACLARÓ), manda lo último que dijo.

Responde SOLO con un JSON, sin texto alrededor:
{"hechos": [...], "dudas": []}`;

export function promptAprender(texto: string, contexto: ContextoTurno, sabido: string[], fases: string[]): { sistema: string; mensaje: string } {
  const codigos = contexto.entidades
    .map((e) => (e.porNombre
      ? `- "${e.texto}" → ${e.candidatos.map((c) => `${c.codigo} · ${c.nombre ?? ''} (${c.es_cd ? 'CD' : c.tipo})`).join(' o ')}`
      : `- ${e.texto}${e.candidatos[0] ? ` · ${e.candidatos[0].nombre ?? ''} (${e.candidatos[0].es_cd ? 'CD' : e.candidatos[0].tipo})` : ''}`))
    .join('\n');
  return {
    sistema: SISTEMA_APRENDER,
    mensaje: `PAÍS: ${NOMBRE_PAIS[contexto.pais]}

FASES
${fases.join('\n') || '(no las tengo)'}

LO QUE YA SÉ DE LO QUE SE NOMBRA
${sabido.join('\n') || '(nada)'}

CÓDIGOS DEL MENSAJE
${codigos || '(ninguno)'}
${contexto.aclaraciones.length ? `\nLO QUE ACLARÓ LA PERSONA\n${contexto.aclaraciones.map((a) => `- ${a}`).join('\n')}\n` : ''}
LO QUE ENSEÑA
«${texto}»`,
  };
}

const FASES = new Set(['F1', 'F2', 'F3', 'DD']);
const METODO_DE_FASE: Record<string, 'RT' | 'DP'> = { F1: 'RT', F2: 'RT', F3: 'RT', DD: 'DP' };
const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);

/**
 * Lee lo que propone el modelo. Un hecho con un código que nadie dijo, una
 * fase que no existe o una fase que no cuadra con el método no vale: el turno
 * prueba otro modelo (no se arregla en silencio).
 */
export function leerAprendido(salida: string, contexto: ContextoTurno, ensena: string): Lectura<{ hechos: Hecho[]; dudas: string[] }> {
  const j = primerJson(salida);
  if (!j) return { ok: false, motivo: 'no devolvió un JSON' };
  const crudos = Array.isArray(j.hechos) ? j.hechos : [];
  const dudas = Array.isArray(j.dudas) ? j.dudas.map((d) => texto(d, 200)).filter((d): d is string => Boolean(d)).slice(0, 3) : [];
  if (!crudos.length && !dudas.length) return { ok: false, motivo: 'no sacó nada de lo que se enseña' };
  if (crudos.length > 6) return { ok: false, motivo: 'demasiados hechos de una vez' };
  const permitidos = codigosPermitidos(contexto, ensena);
  const hechos: Hecho[] = [];
  for (const [i, c] of crudos.entries()) {
    const h = (c ?? {}) as Record<string, unknown>;
    const n = i + 1;
    if (h.tipo === 'servicio') {
      const codigo = String(h.codigo ?? '').trim().toUpperCase();
      if (!/^[A-Z]{1,3}$/.test(codigo)) return { ok: false, motivo: `hecho ${n}: "${codigo}" no es un código de servicio` };
      const fase = h.fase ? String(h.fase).toUpperCase() : null;
      if (fase && !FASES.has(fase)) return { ok: false, motivo: `hecho ${n}: la fase "${fase}" no existe` };
      let metodo = h.metodo_entrega ? String(h.metodo_entrega).toUpperCase() : null;
      if (metodo && metodo !== 'RT' && metodo !== 'DP') return { ok: false, motivo: `hecho ${n}: método "${metodo}" (es RT o DP)` };
      if (fase && metodo && METODO_DE_FASE[fase] !== metodo) return { ok: false, motivo: `hecho ${n}: la fase ${fase} es de ${METODO_DE_FASE[fase]}, no de ${metodo}` };
      if (fase && !metodo) metodo = METODO_DE_FASE[fase];
      const origen = h.origen ? String(h.origen).trim() : null;
      if (origen && (!/^\d{3,6}$/.test(origen) || !permitidos.has(origen))) return { ok: false, motivo: `hecho ${n}: el origen ${origen} no lo dijo nadie` };
      hechos.push({ tipo: 'servicio', pais: contexto.pais, codigo, nombre: texto(h.nombre, 80), metodo_entrega: metodo as Hecho['metodo_entrega'], fase, origen, descripcion: texto(h.descripcion, 400) });
    } else if (h.tipo === 'entidad') {
      const codigo = String(h.codigo ?? '').trim();
      if (!/^\d{3,6}$/.test(codigo) || !permitidos.has(codigo)) return { ok: false, motivo: `hecho ${n}: el código ${codigo} no lo dijo nadie` };
      const clase = h.clase ? String(h.clase) : null;
      if (clase && !['tienda', 'almacen', 'opl'].includes(clase)) return { ok: false, motivo: `hecho ${n}: "${clase}" no es tienda, almacén ni OPL` };
      const es_cd = h.es_cd === true;
      if (es_cd && clase && clase !== 'almacen') return { ok: false, motivo: `hecho ${n}: un CD es un almacén` };
      const alias = Array.isArray(h.alias) ? h.alias.map((a) => texto(a, 60)).filter((a): a is string => Boolean(a)).slice(0, 5) : [];
      hechos.push({ tipo: 'entidad', pais: contexto.pais, codigo, nombre: texto(h.nombre, 80), clase: (es_cd ? 'almacen' : clase) as Hecho['clase'], es_cd, alias });
    } else {
      return { ok: false, motivo: `hecho ${n}: tipo "${String(h.tipo)}" (es servicio o entidad)` };
    }
  }
  return { ok: true, valor: { hechos, dudas } };
}

/** Un hecho en palabras, para la pregunta "¿lo guardo?" */
export function hechoEnPalabras(h: Hecho): string {
  if (h.tipo === 'servicio') {
    const partes = [
      h.metodo_entrega ? (h.metodo_entrega === 'RT' ? 'retiro en tienda' : 'despacho a domicilio') : null,
      h.fase ? `fase ${h.fase}` : null,
      h.origen ? `el stock sale siempre del ${h.origen}` : null,
    ].filter(Boolean);
    return `${h.codigo}${h.nombre ? ` · ${h.nombre}` : ''}${partes.length ? `: ${partes.join(', ')}` : ''}.${h.descripcion ? ` ${h.descripcion}` : ''}`;
  }
  const clase = h.es_cd ? 'CD' : h.clase === 'almacen' ? 'almacén' : h.clase === 'opl' ? 'OPL' : h.clase ?? 'código';
  return `${h.codigo}${h.nombre ? ` · ${h.nombre}` : ''}: ${clase}${h.alias?.length ? ` (también «${h.alias.join('», «')}»)` : ''}.`;
}
