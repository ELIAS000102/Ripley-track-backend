import { agendasDeDatos, CON_AGENDA, deLasOficinas } from './agendas.js';
import type { AgendaConocida, ContextoTurno, Pregunta } from './interfaces/agente-v3.interface.js';

/**
 * A qué agenda (o zona) va un cambio cuando la persona no lo dice (decisiones
 * del usuario, 2026-11-09 y 2026-11-13):
 *
 * - Sobre "lo del mensaje anterior": si de una oficina se vio UNA agenda, va a
 *   esa ("cierra la fecha 11-11 para los tres", una de cada OPL). Si se vieron
 *   VARIAS, se PREGUNTA a cuál (y "todas"): "cierra la fecha 18-11" después del
 *   despacho de la 1401, que tiene la de Aldea 6 y la BT.
 * - Sin nada a la vista, un cambio de despacho o de OPL en una oficina con
 *   varias zonas también pregunta cuál.
 * La pregunta es la de siempre: el turno espera y sigue en el mismo paso.
 */

export interface Grupo { codigos: string[]; extra: Record<string, unknown>; exacta: boolean }

/** Las herramientas de cambio que van a una agenda (y a su zona, en despacho y OPL) */
const CON_ZONA = new Set(['editar_capacidad', 'editar_servicio_opl']);

/** "Todas": las agendas que se vieron de esa oficina, o todas sus zonas (la edición de la v2 lo entiende así) */
export const TODAS = 'todas';

/** Si hay más oficinas que esto por elegir, no se pregunta una por una */
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

/** Una cosa que se puede elegir: una agenda exacta ("a:zona›agenda"), una zona (su nombre) o "todas" */
const codificar = (a: AgendaConocida) => `a:${a.zona ?? ''}›${a.agenda}`;
function decodificar(id: string): { zona?: string; agenda?: string } | 'todas' {
  if (id === TODAS) return TODAS;
  if (id.startsWith('a:')) {
    const [zona, agenda] = id.slice(2).split('›');
    return { ...(zona ? { zona } : {}), agenda };
  }
  return { zona: id };
}

/** Lo que se vio de cada oficina, por código */
function vistasPorOficina(vistas: AgendaConocida[], codigos: string[], tipo: string | null): Map<string, AgendaConocida[]> {
  const m = new Map<string, AgendaConocida[]>();
  for (const a of deLasOficinas(vistas, codigos, tipo)) m.set(a.codigo, [...(m.get(a.codigo) ?? []), a]);
  return m;
}

/**
 * Los grupos de llamadas de un cambio sin agenda ni zona: lo que eligió la
 * persona; si no eligió, la única agenda que se vio de esa oficina. Null si no
 * hay ni lo uno ni lo otro (el paso va tal cual).
 */
export function porEleccion(id: string, p: Record<string, unknown>, codigos: string[], vistas: AgendaConocida[], elegidas: Record<string, string> | undefined): { grupos: Grupo[]; notas: string[] } | null {
  const cfg = CON_AGENDA[id];
  if (!cfg || !CON_ZONA.has(id) || p.agenda || p.zona || p.atajo || !codigos.length) return null;
  const tipo = cfg.tipo(p);
  const conZona = tipo === 'despacho' || tipo === 'opl';
  const porOficina = vistasPorOficina(vistas, codigos, tipo);
  const extraDe = (a: AgendaConocida) => ({ agenda: a.agenda, ...(conZona && a.zona ? { zona: a.zona } : {}) });
  const grupos = new Map<string, Grupo>();
  const meter = (codigo: string, extra: Record<string, unknown>) => {
    const k = JSON.stringify(extra);
    const g = grupos.get(k) ?? { codigos: [], extra, exacta: Object.keys(extra).length > 0 };
    if (!g.codigos.includes(codigo)) g.codigos.push(codigo);
    grupos.set(k, g);
  };
  let usado = false;
  const notas: string[] = [];
  for (const c of codigos) {
    const vistasDeC = porOficina.get(c) ?? [];
    const e = elegidas?.[c] ?? elegidas?.['*'];
    if (e) {
      usado = true;
      const d = decodificar(e);
      if (d === TODAS) {
        if (vistasDeC.length) vistasDeC.forEach((a) => meter(c, extraDe(a)));
        else meter(c, conZona ? { zona: TODAS } : {});
      } else meter(c, d);
      notas.push(`${c}: ${d === TODAS ? 'todas' : d.agenda ?? d.zona}`);
    } else if (vistasDeC.length) {
      // Una vista (o varias, si no hubo a quién preguntar): a esas
      usado = true;
      vistasDeC.forEach((a) => meter(c, extraDe(a)));
    } else meter(c, {});
  }
  if (!usado) return null;
  const vistas_ = codigos.filter((c) => !(elegidas?.[c] ?? elegidas?.['*']) && porOficina.get(c)?.length).length;
  return {
    grupos: [...grupos.values()],
    notas: [
      ...(notas.length ? [`elegido: ${notas.slice(0, 4).join('; ')}${notas.length > 4 ? ` y ${notas.length - 4} más` : ''}`] : []),
      ...(vistas_ ? [`las agendas que se vieron (${vistas_ === 1 ? '1 oficina' : `${vistas_} oficinas`})`] : []),
    ],
  };
}

/** Lo que hay que elegir de una oficina: sus agendas a la vista, o sus zonas */
export interface PorElegir { codigo: string; que: 'agenda' | 'zona'; opciones: Array<{ id: string; texto: string }> }

/** De lo que se vio: las oficinas con VARIAS agendas a la vista y nada elegido */
export function agendasPorElegir(vistas: AgendaConocida[], codigos: string[], tipo: string | null): PorElegir[] {
  const porOficina = vistasPorOficina(vistas, codigos, tipo);
  return codigos.flatMap((codigo) => {
    const l = porOficina.get(codigo) ?? [];
    if (l.length < 2) return [];
    return [{ codigo, que: 'agenda' as const, opciones: l.map((a) => ({ id: codificar(a), texto: `${codigo} · ${a.agenda}${a.zona && a.zona !== a.agenda ? ` (${a.zona})` : ''}` })) }];
  });
}

/** De lo conocido (o buscado): las oficinas con más de una zona */
export function oficinasConVariasZonas(agendas: AgendaConocida[], codigos: string[]): PorElegir[] {
  return codigos
    .map((codigo) => ({ codigo, zonas: [...new Set(agendas.filter((a) => a.codigo === codigo).map((a) => a.zona ?? a.agenda))] }))
    .filter((x) => x.zonas.length > 1)
    .map((x) => ({ codigo: x.codigo, que: 'zona' as const, opciones: x.zonas.map((z) => ({ id: z, texto: `${x.codigo} · ${z}` })) }));
}

/** La pregunta: una duda por oficina con sus opciones y "todas"; con muchas oficinas, una sola: ¿todas? */
export function preguntaDeZonas(n: number, que: string, oficinas: PorElegir[]): Pregunta {
  const deAgenda = oficinas.every((o) => o.que === 'agenda');
  if (oficinas.length > MAX_DUDAS) {
    return {
      id: `zona:${n}:*`, etapa: 'zona', paso: n,
      texto: `${oficinas.length} oficinas tienen varias ${deAgenda ? 'agendas' : 'zonas'} (${oficinas.slice(0, 4).map((o) => o.codigo).join(', ')}…). Para «${que}», ¿en todas?`,
      opciones: [{ id: TODAS, texto: deAgenda ? 'Sí, en todas las agendas' : 'Sí, en todas las zonas' }],
      libre: 'O dime cuál, con su nombre',
    };
  }
  const una = oficinas.length === 1 ? oficinas[0] : null;
  return {
    id: `zona:${n}`, etapa: 'zona', paso: n,
    texto: una
      ? `De la ${una.codigo} hay ${una.opciones.length} ${una.que === 'agenda' ? 'agendas' : 'zonas'}. Para «${que}», ¿a cuál?`
      : `Estas oficinas tienen varias ${deAgenda ? 'agendas' : 'zonas'}. Para «${que}», ¿a cuál de cada una?`,
    opciones: [],
    libre: null,
    dudas: oficinas.map((o) => ({
      id: `zona:${n}:${o.codigo}`,
      texto: `${o.codigo}: ¿${o.que === 'agenda' ? 'qué agenda' : 'qué zona'}?`,
      opciones: [...o.opciones, { id: TODAS, texto: `${o.codigo} · todas` }],
    })),
  };
}

/** Lo que eligió: { código: opción } (con "*" para todas las oficinas). Null si no contestó nada que valga */
export function zonasDeLaRespuesta(p: Pregunta, r: { respuestas?: Record<string, unknown>; texto?: string }): Record<string, string> | null {
  const elegidas: Record<string, string> = {};
  if (p.dudas?.length) {
    for (const d of p.dudas) {
      const v = String(r.respuestas?.[d.id] ?? '').trim();
      // También lo escrito, si es una de sus opciones ("1401 · Agenda …")
      const t = String(r.texto ?? '').trim().toLowerCase();
      const opcion = d.opciones.find((o) => o.id === v) ?? (t ? d.opciones.find((o) => o.texto.toLowerCase() === t) : undefined);
      if (opcion) elegidas[d.id.split(':').pop()!] = opcion.id;
    }
    return Object.keys(elegidas).length === p.dudas.length ? elegidas : null;
  }
  const v = String(r.respuestas?.[p.id] ?? '').trim() || String(r.texto ?? '').trim();
  if (!v) return null;
  return { '*': p.opciones.some((o) => o.id === v) ? v : v.slice(0, 120) };
}
