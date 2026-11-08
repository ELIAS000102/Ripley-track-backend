import { codigosQueCumplen, filasDe } from './filas.js';
import type { AgendaConocida, ContextoTurno } from './interfaces/agente-v3.interface.js';

/**
 * Las agendas que se conocen en un turno: las que trajo el mensaje anterior y
 * las que el backend buscó porque el plan nombraba una que no conocía.
 *
 * Quién decide a qué agenda se refiere la persona ("el centralizaso de San
 * Luis" = «Centralizado HUB San Luis») es el MODELO de Armar, que ve esta lista
 * (decisión del usuario, 2026-11-08: el código no entiende lo que está escrito
 * de otra manera). El código solo comprueba que lo elegido exista y lo manda a
 * Ripley con su zona y su nombre exactos, a las oficinas que la tienen.
 */

/** Las herramientas que filtran por zona o agenda, y dónde llevan sus códigos */
export const CON_AGENDA: Record<string, { lista: string; tipo: (p: Record<string, unknown>) => string | null }> = {
  consultar_capacidad: { lista: 'codigo', tipo: (p) => String(p.tipo ?? '') || null },
  editar_capacidad: { lista: 'codigo', tipo: (p) => String(p.tipo ?? '') || null },
  consultar_servicios_opl: { lista: 'opl', tipo: () => 'opl' },
  editar_servicio_opl: { lista: 'opl', tipo: () => 'opl' },
};

const BLOQUE: Record<string, { herramienta: string; tipo: string | null }> = {
  picking: { herramienta: 'consultar_capacidad', tipo: 'picking' },
  despacho: { herramienta: 'consultar_capacidad', tipo: 'despacho' },
  recepcion: { herramienta: 'consultar_capacidad', tipo: 'recepcion' },
  opl: { herramienta: 'consultar_servicios_opl', tipo: 'opl' },
};

const plano = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
export const mismoNombre = (a: unknown, b: unknown) => Boolean(plano(a)) && plano(a) === plano(b);

function sinRepetir(l: AgendaConocida[]): AgendaConocida[] {
  const vistas = new Set<string>();
  return l.filter((a) => {
    const k = `${a.codigo}|${a.tipo}|${plano(a.zona)}|${plano(a.agenda)}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}

/** Las agendas de lo que devolvió una herramienta (un atajo: las de sus bloques de capacidad y de OPL) */
export function agendasDeDatos(herramienta: string, datos: unknown, tipo: string | null = null): AgendaConocida[] {
  if (!datos || typeof datos !== 'object') return [];
  if (herramienta === 'ejecutar_atajo') {
    const bloques = (datos as { bloques?: Array<{ tipo: string; items?: Array<{ resultado?: unknown }> }> }).bloques ?? [];
    return sinRepetir(bloques.flatMap((b) => {
      const de = BLOQUE[b.tipo];
      return de ? (b.items ?? []).filter((i) => i.resultado).flatMap((i) => agendasDeDatos(de.herramienta, i.resultado, de.tipo)) : [];
    }));
  }
  if (herramienta === 'consultar_capacidad') tipo = tipo ?? ((datos as { tipo?: string }).tipo ?? null);
  else if (herramienta === 'consultar_servicios_opl') tipo = 'opl';
  else return [];
  return sinRepetir(filasDe(herramienta, datos).filter((f) => f.agenda).map((f) => ({
    codigo: f.codigo, tipo, zona: f.zona ?? null, agenda: String(f.agenda), servicio: f.servicio ?? null,
  })));
}

/** Todo lo que se conoce en el turno */
export function agendasConocidas(contexto: ContextoTurno): AgendaConocida[] {
  const delAnterior = (contexto.anterior?.resultados ?? []).filter((r) => r.datos).flatMap((r) => agendasDeDatos(r.herramienta, r.datos));
  return sinRepetir([...delAnterior, ...(contexto.agendas ?? [])]);
}

/** Los códigos que trajo el mensaje anterior ({ ref: 'anterior' }) */
export function codigosDelAnterior(contexto: ContextoTurno): string[] {
  const res = (contexto.anterior?.resultados ?? []).filter((x) => x.datos);
  return [...new Set(res.flatMap((x) => x.cumplen ?? codigosQueCumplen(filasDe(x.herramienta, x.datos, contexto.hoy))))];
}

/** Las conocidas de esas oficinas y de ese tipo (las de OPL valen también como de despacho, y al revés) */
export function deLasOficinas(conocidas: AgendaConocida[], codigos: string[], tipo: string | null): AgendaConocida[] {
  const compatible = (t: string | null) => !tipo || !t || t === tipo || ((t === 'opl' || t === 'despacho') && (tipo === 'opl' || tipo === 'despacho'));
  return conocidas.filter((a) => codigos.includes(a.codigo) && compatible(a.tipo));
}

/**
 * Las que encajan con lo que eligió el modelo: por el nombre exacto de la
 * agenda o de la zona; si no hay ninguna exacta, las que lo contienen
 * ("centralizado" → todas las centralizadas).
 */
export function lasQueEncajan(agendas: AgendaConocida[], agenda: unknown, zona: unknown): AgendaConocida[] {
  const filtra = (exacto: boolean) => agendas.filter((a) => {
    const cumple = (v: unknown) => !plano(v) || (exacto
      ? mismoNombre(a.agenda, v) || mismoNombre(a.zona, v)
      : plano(a.agenda).includes(plano(v)) || plano(a.zona).includes(plano(v)));
    return cumple(agenda) && cumple(zona);
  });
  const exactas = filtra(true);
  return exactas.length ? exactas : filtra(false);
}

/** "1100 · despacho · Centralizado HUB San Luis › Centralizado HUB San Luis · S" */
export function agendaEnLinea(a: AgendaConocida): string {
  return [a.codigo, a.tipo, `${a.zona && !mismoNombre(a.zona, a.agenda) ? `${a.zona} › ` : ''}${a.agenda}`, a.servicio].filter(Boolean).join(' · ');
}

/**
 * Para el prompt: primero las de las oficinas del mensaje (o del anterior), y
 * como mucho `max`. Si son más, se dice cuántas quedaron fuera.
 */
export function agendasParaPrompt(contexto: ContextoTurno, max = 80): string[] {
  const todas = agendasConocidas(contexto);
  if (!todas.length) return [];
  const delMensaje = new Set(contexto.entidades.flatMap((e) => e.candidatos.map((c) => c.codigo)));
  const ordenadas = [...todas.filter((a) => delMensaje.has(a.codigo)), ...todas.filter((a) => !delMensaje.has(a.codigo))];
  const lineas = ordenadas.slice(0, max).map((a) => `- ${agendaEnLinea(a)}`);
  return todas.length > max ? [...lineas, `- …y ${todas.length - max} más`] : lineas;
}
