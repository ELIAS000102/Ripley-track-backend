import { agendasDeDatos, CON_AGENDA, deLasOficinas } from './agendas.js';
import type { AgendaConocida, ContextoTurno, Pregunta } from './interfaces/agente-v3.interface.js';

/**
 * Las zonas de un cambio de despacho o de servicios de OPL (decisiones del
 * usuario, 2026-11-09):
 *
 * - "cierra la fecha 11-11 para los tres" después de un atajo que ENSEÑABA una
 *   agenda de cada OPL: el cambio va a esas agendas exactas (zona y agenda), no
 *   a todas las de la OPL.
 * - Si una oficina tiene varias zonas y no se sabe cuál, se PREGUNTA con
 *   opciones (una duda por oficina, y "Todas"). La pregunta es la de siempre
 *   (Wait de n8n): la ejecución espera y sigue en el mismo paso.
 */

export interface Grupo { codigos: string[]; extra: Record<string, unknown>; exacta: boolean }

/** Las herramientas de cambio cuya agenda vive en una zona */
const CON_ZONA = new Set(['editar_capacidad', 'editar_servicio_opl']);

/** "Todas las zonas" de una oficina: la edición de la v2 lo entiende así */
export const TODAS = 'todas';

/** Si una oficina tiene más que esto con varias zonas, no se pregunta una por una */
const MAX_DUDAS = 6;

export const esDelAnterior = (v: unknown) => Boolean(v && typeof v === 'object' && !Array.isArray(v) && (v as { ref?: string }).ref === 'anterior');

/** Las agendas que ENSEÑÓ el mensaje anterior (no las buscadas en este turno) */
export function agendasDelAnterior(contexto: ContextoTurno): AgendaConocida[] {
  return (contexto.anterior?.resultados ?? []).filter((r) => r.datos).flatMap((r) => agendasDeDatos(r.herramienta, r.datos));
}

/** El tipo del paso, si sus agendas viven en zonas (despacho, OPL); si no, null */
export function tipoConZona(id: string, p: Record<string, unknown>): string | null {
  if (!CON_ZONA.has(id)) return null;
  const tipo = CON_AGENDA[id]?.tipo(p) ?? null;
  return tipo === 'despacho' || tipo === 'opl' ? tipo : null;
}

/**
 * Un cambio sobre "lo del mensaje anterior", sin agenda ni zona: a las agendas
 * exactas que se vieron, una llamada por zona y agenda. Null si el anterior no
 * enseñaba agendas de esas oficinas.
 */
export function porLoQueSeVio(id: string, p: Record<string, unknown>, codigos: string[], vistas: AgendaConocida[]): { grupos: Grupo[]; notas: string[] } | null {
  const cfg = CON_AGENDA[id];
  if (!cfg || !CON_ZONA.has(id) || p.agenda || p.zona || p.atajo || !codigos.length) return null;
  const tipo = cfg.tipo(p);
  const deEllas = deLasOficinas(vistas, codigos, tipo);
  if (!deEllas.length) return null;
  const conZona = tipo === 'despacho' || tipo === 'opl';
  const grupos = new Map<string, Grupo>();
  for (const a of deEllas) {
    const extra: Record<string, unknown> = { agenda: a.agenda, ...(conZona && a.zona ? { zona: a.zona } : {}) };
    const k = JSON.stringify(extra);
    const g = grupos.get(k) ?? { codigos: [], extra, exacta: true };
    if (!g.codigos.includes(a.codigo)) g.codigos.push(a.codigo);
    grupos.set(k, g);
  }
  const con = new Set(deEllas.map((a) => a.codigo));
  const sin = codigos.filter((c) => !con.has(c));
  return { grupos: [...grupos.values()], notas: [`las agendas que se vieron (${deEllas.length})${sin.length ? `; sin ninguna a la vista: ${sin.join(', ')}` : ''}`] };
}

/** Con las zonas que eligió la persona: una llamada por zona (y "todas" donde lo pidió) */
export function porZonaElegida(codigos: string[], elegidas: Record<string, string> | undefined): { grupos: Grupo[]; notas: string[] } | null {
  if (!elegidas || !Object.keys(elegidas).length) return null;
  const grupos = new Map<string, Grupo>();
  for (const c of codigos) {
    const zona = elegidas[c] ?? elegidas['*'];
    const extra: Record<string, unknown> = zona ? { zona } : {};
    const k = JSON.stringify(extra);
    const g = grupos.get(k) ?? { codigos: [], extra, exacta: Boolean(zona) };
    g.codigos.push(c);
    grupos.set(k, g);
  }
  const elegidasAqui = codigos.filter((c) => elegidas[c] ?? elegidas['*']).map((c) => `${c}: ${elegidas[c] ?? elegidas['*']}`);
  return { grupos: [...grupos.values()], notas: elegidasAqui.length ? [`zona elegida: ${elegidasAqui.slice(0, 4).join('; ')}${elegidasAqui.length > 4 ? ` y ${elegidasAqui.length - 4} más` : ''}`] : [] };
}

/** Las oficinas con más de una zona, de las conocidas */
export function oficinasConVariasZonas(agendas: AgendaConocida[], codigos: string[]): Array<{ codigo: string; zonas: string[] }> {
  return codigos
    .map((codigo) => ({ codigo, zonas: [...new Set(agendas.filter((a) => a.codigo === codigo).map((a) => a.zona ?? a.agenda))] }))
    .filter((x) => x.zonas.length > 1);
}

/** La pregunta: una duda por oficina con sus zonas y "Todas"; con muchas oficinas, una sola: ¿todas las zonas? */
export function preguntaDeZonas(n: number, que: string, oficinas: Array<{ codigo: string; zonas: string[] }>): Pregunta {
  if (oficinas.length > MAX_DUDAS) {
    return {
      id: `zona:${n}:*`, etapa: 'zona', paso: n,
      texto: `${oficinas.length} oficinas tienen varias zonas (${oficinas.slice(0, 4).map((o) => o.codigo).join(', ')}…). Para «${que}», ¿en todas sus zonas?`,
      opciones: [{ id: TODAS, texto: 'Sí, en todas las zonas' }],
      libre: 'O dime cuál, con su nombre',
    };
  }
  return {
    id: `zona:${n}`, etapa: 'zona', paso: n,
    texto: oficinas.length === 1
      ? `${oficinas[0].codigo} tiene ${oficinas[0].zonas.length} zonas. Para «${que}», ¿cuál?`
      : `Estas oficinas tienen varias zonas. Para «${que}», ¿cuál de cada una?`,
    opciones: [],
    libre: null,
    dudas: oficinas.map((o) => ({
      id: `zona:${n}:${o.codigo}`,
      texto: `${o.codigo}: ¿qué zona?`,
      opciones: [...o.zonas.map((z) => ({ id: z, texto: `${o.codigo} · ${z}` })), { id: TODAS, texto: `${o.codigo} · todas` }],
    })),
  };
}

/** Lo que eligió: { código: zona } (con "*" para todas las oficinas). Null si no contestó nada que valga */
export function zonasDeLaRespuesta(p: Pregunta, r: { respuestas?: Record<string, unknown>; texto?: string }): Record<string, string> | null {
  const elegidas: Record<string, string> = {};
  if (p.dudas?.length) {
    for (const d of p.dudas) {
      const v = String(r.respuestas?.[d.id] ?? '').trim();
      if (v && d.opciones.some((o) => o.id === v)) elegidas[d.id.split(':').pop()!] = v;
    }
    return Object.keys(elegidas).length === p.dudas.length ? elegidas : null;
  }
  const v = String(r.respuestas?.[p.id] ?? '').trim() || String(r.texto ?? '').trim();
  if (!v) return null;
  return { '*': p.opciones.some((o) => o.id === v) ? v : v.slice(0, 120) };
}
