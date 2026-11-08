import type { EntidadMencion } from './entidades.js';
import type { ContextoTurno, Pregunta } from './interfaces/agente-v3.interface.js';

/**
 * Parte 1d · las preguntas. Las detecta el código (no depende de que el modelo
 * se acuerde de preguntar) y el turno espera la respuesta (Wait en n8n). Lo que
 * se contesta se suma a las aclaraciones del turno y la etapa que preguntó
 * vuelve a empezar con ellas. Como mucho 3 rondas por mensaje.
 */

export const MAX_RONDAS = 3;

const TIPO: Record<string, string> = { tienda: 'tienda', almacen: 'almacén', opl: 'OPL' };

/** Un nombre del mensaje que es de varios códigos ("Plaza Oeste" → 10045 y 20099) */
export function preguntaDeNombre(m: EntidadMencion): Pregunta {
  return {
    id: `nombre:${m.texto}`,
    etapa: 'entidades',
    nombre: m.texto,
    texto: `«${m.texto}» es más de un código: ¿cuál?`,
    opciones: m.candidatos.map((c) => ({ id: c.codigo, texto: `${c.codigo} · ${String(c.nombre ?? '').replace(/^ripley\s+/i, '')} (${c.es_cd ? 'CD' : TIPO[c.tipo] ?? c.tipo})` })),
    libre: 'O escribe el código',
  };
}

/** Lo que el modelo dice que falta, o por qué no se pudo armar */
export function preguntaAbierta(etapa: Pregunta['etapa'], texto: string): Pregunta {
  return { id: `${etapa}:abierta`, etapa, texto, opciones: [], libre: 'Escríbelo aquí' };
}

export interface Contestacion {
  respuestas?: Record<string, unknown>;
  texto?: string;
  cancelar?: boolean;
}

/**
 * Aplica lo que contestó la persona. Devuelve el contexto nuevo, o null si la
 * respuesta no contesta nada (se vuelve a preguntar) o si canceló.
 */
export function aplicarRespuesta(contexto: ContextoTurno, r: Contestacion): { contexto: ContextoTurno } | { cancelar: true } | { nada: true } {
  const p = contexto.pregunta;
  if (r.cancelar) return { cancelar: true };
  if (!p) return { nada: true };
  const elegida = r.respuestas ? String(r.respuestas[p.id] ?? '').trim() : '';
  const texto = String(r.texto ?? '').trim().slice(0, 500);

  if (p.etapa === 'entidades') {
    // Una opción, o un código escrito que sea una de ellas (o cualquiera, si lo escribe)
    const codigo = elegida || /\b(\d{3,6})\b/.exec(texto)?.[1] || '';
    if (!codigo) return texto ? { contexto: { ...contexto, pregunta: null, aclaraciones: [...contexto.aclaraciones, texto] } } : { nada: true };
    const entidades = contexto.entidades.map((e) => (e.porNombre && e.texto === p.nombre
      ? { ...e, candidatos: e.candidatos.filter((c) => c.codigo === codigo).length ? e.candidatos.filter((c) => c.codigo === codigo) : [{ codigo, tipo: 'tienda' as const, es_cd: false, nombre: null, pais: contexto.pais }] }
      : e));
    return { contexto: { ...contexto, entidades, pregunta: null, aclaraciones: [...contexto.aclaraciones, `«${p.nombre}» es la ${codigo}`] } };
  }

  const dicho = elegida || texto;
  if (!dicho) return { nada: true };
  return { contexto: { ...contexto, pregunta: null, aclaraciones: [...contexto.aclaraciones, dicho] } };
}
