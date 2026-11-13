import { hechoEnPalabras } from './aprender/prompt.js';
import type { EntidadMencion } from './entidades.js';
import type { ContextoTurno, Ensenanza, Pregunta } from './interfaces/agente-v3.interface.js';

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

/** Lo que el modelo dice que falta ("¿qué es un flujo de picking?") */
export function preguntaAbierta(etapa: Pregunta['etapa'], texto: string): Pregunta {
  return { id: `${etapa}:abierta`, etapa, texto, opciones: [], libre: 'Escríbelo aquí' };
}

/**
 * "No pude…: ¿me lo dices de otra forma?": lo que se escriba es la petición
 * NUEVA (se vuelve a clasificar), no una aclaración de la que falló.
 */
export function preguntaOtraForma(etapa: Pregunta['etapa'], texto: string): Pregunta {
  return { id: `${etapa}:otra-forma`, etapa, texto, opciones: [], libre: 'Escríbelo de otra forma' };
}

/**
 * "¿Lo guardo para todos?" (decisión del usuario, 2026-11-08): va AL FINAL de
 * la petición, con lo que se entendió, lo que cambiaría y lo que no se puede
 * tocar. Siempre se puede decir «No ahora»; escribir es corregir lo entendido.
 */
export function preguntaDeAprender(e: Ensenanza): Pregunta {
  const guardables = e.hechos.length > 0 && e.intocables.length < e.hechos.length;
  const lineas = [
    guardables ? 'Me enseñaste esto. ¿Lo guardo para todos?' : e.hechos.length ? 'Entendí esto, pero no lo puedo guardar desde el chat:' : 'No me quedó claro lo que me enseñas.',
    ...e.hechos.map((h) => `• ${hechoEnPalabras(h)}`),
    ...(e.choques.length ? [`Ojo: ${e.choques.join(' ')}`] : []),
    ...e.intocables,
    ...(e.dudas.length ? [`No me quedó claro: ${e.dudas.join(' ')}`] : []),
  ];
  return {
    id: 'aprender',
    etapa: 'aprender',
    texto: lineas.join('\n'),
    opciones: [...(guardables ? [{ id: 'si', texto: 'Sí, guárdalo' }] : []), { id: 'no', texto: 'No ahora' }],
    libre: guardables ? 'O corrígeme: escribe cómo es' : 'Explícamelo de otra forma',
  };
}

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Lo que contestó a "¿lo guardo?": sí, no, o una corrección (lo que escribió) */
export function respuestaDeAprender(p: Pregunta, r: Contestacion): { si: true } | { no: true } | { corrige: string } | { nada: true } {
  if (r.cancelar) return { no: true };
  const elegida = r.respuestas ? String(r.respuestas[p.id] ?? '').trim() : '';
  const texto = String(r.texto ?? '').trim().slice(0, 500);
  if (elegida === 'si' && p.opciones.some((o) => o.id === 'si')) return { si: true };
  if (elegida === 'no') return { no: true };
  const t = plano(texto);
  if (/^(no|no ahora|ahora no|no gracias|no lo guardes|dejalo|mejor no)$/.test(t)) return { no: true };
  if (/^(si|si guardalo|guardalo|dale|ok|vale|correcto|esta bien|si esta bien)$/.test(t) && p.opciones.some((o) => o.id === 'si')) return { si: true };
  return texto ? { corrige: texto } : { nada: true };
}

const planoTexto = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

/**
 * ¿Lo escrito contesta la pregunta pendiente, o es un mensaje nuevo?
 * (decisión del usuario, 2026-11-13). Elegir, cancelar o una pregunta que
 * admite texto (lo que falta, "¿de otra forma?", corregir lo aprendido): la
 * contesta. Una pregunta de opciones (qué zona): solo si lo escrito es una de
 * sus opciones; si no, es un mensaje nuevo.
 */
export function esRespuesta(p: Pregunta, r: Contestacion): boolean {
  if (r.cancelar || (r.respuestas && Object.keys(r.respuestas).length)) return true;
  const t = planoTexto(r.texto);
  if (!t) return false;
  if (p.libre !== null && !p.dudas?.length) return true;
  const opciones = [...p.opciones, ...(p.dudas ?? []).flatMap((d) => d.opciones)];
  return opciones.some((o) => planoTexto(o.texto) === t || planoTexto(o.id) === t);
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
