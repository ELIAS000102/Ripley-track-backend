import type { Ejecucion } from '../../configuracion/atajos/interfaces/atajos.interface.js';
import type { Pais, PasoEjecutado, RespuestaPanel, ResultadoPanel, Turno } from '../interfaces/agente-v3.interface.js';
import { fraseAtajo, markdownAtajo, nombreCorto } from './atajo.js';

/**
 * Etapa 7 · Responder: la frase, los datos de cada paso para que el panel los
 * dibuje, y el Markdown. Sin IA.
 */

export interface FilaEntidad { codigo: string; nombre: string | null; tipo: string; es_cd: boolean; pais: string; fuente: string }
export interface FilaServicio { pais: string; codigo: string; nombre: string | null; metodo_entrega: string | null; fase: string | null }
export interface FilaAtajo { nombre: string; descripcion: string | null; tipos: string[]; pais: string }

const NOMBRE_PAIS: Record<string, string> = { PE: 'Perú', CL: 'Chile' };
const TIPO_ENTIDAD: Record<string, [string, string]> = { tienda: ['tienda', 'tiendas'], almacen: ['almacén', 'almacenes'], opl: ['OPL', 'OPL'] };
const algunos = (l: string[], n = 5) => (l.length <= n ? l.join(', ') : `${l.slice(0, n).join(', ')} y ${l.length - n} más`);
const celda = (s: unknown) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const tabla = (cab: string[], filas: unknown[][]) =>
  filas.length ? [`| ${cab.join(' | ')} |`, `| ${cab.map(() => '---').join(' | ')} |`, ...filas.map((f) => `| ${f.map(celda).join(' | ')} |`)].join('\n') : '';

/** Lo que dice un paso de sí mismo (va en el progreso y en "pasos") */
export function resumenDelPaso(herramienta: string, datos: unknown, param: Record<string, unknown>, hoy: string): { estado: PasoEjecutado['estado']; resumen: string } {
  if (herramienta === 'ejecutar_atajo') {
    const e = datos as Ejecucion;
    const vacio = !e.resumen.items || !e.resumen.correctas;
    return { estado: vacio ? 'vacio' : 'ok', resumen: fraseAtajo(e, hoy) };
  }
  if (herramienta === 'saber_entidades') {
    const l = datos as FilaEntidad[];
    const [uno, varios] = TIPO_ENTIDAD[String(param.tipo)] ?? ['código', 'códigos'];
    const que = param.es_cd ? (l.length === 1 ? 'CD' : 'CDs') : l.length === 1 ? uno : varios;
    return { estado: l.length ? 'ok' : 'vacio', resumen: l.length ? `${l.length} ${que} de ${NOMBRE_PAIS[String(param.pais)] ?? param.pais}` : `ningún ${que} guardado` };
  }
  if (herramienta === 'saber_servicios') {
    const l = datos as FilaServicio[];
    return { estado: l.length ? 'ok' : 'vacio', resumen: `${l.length} servicios de ${NOMBRE_PAIS[String(param.pais)] ?? param.pais}` };
  }
  if (herramienta === 'saber_atajos') {
    const l = datos as FilaAtajo[];
    return { estado: l.length ? 'ok' : 'vacio', resumen: `${l.length} atajos` };
  }
  return { estado: 'ok', resumen: '' };
}

/** La frase de la respuesta: la del último paso que trajo algo (es el que contesta) */
function frase(pasos: PasoEjecutado[], principal: PasoEjecutado | undefined): string {
  if (!pasos.length) return 'No hice nada.';
  if (!principal) {
    const err = pasos.find((p) => p.estado === 'error');
    return err ? `No pude: ${err.error ?? err.resumen}` : 'No vino nada.';
  }
  if (principal.herramienta === 'saber_entidades') {
    const l = principal.datos as FilaEntidad[];
    return `Tengo guardados ${principal.resumen}: ${algunos(l.map((e) => (e.nombre ? `${e.codigo} · ${nombreCorto(e.nombre)}` : e.codigo)))}.`;
  }
  if (principal.herramienta === 'saber_servicios') {
    const l = principal.datos as FilaServicio[];
    return `Tengo guardados ${principal.resumen}: ${algunos(l.map((s) => `${s.codigo}${s.fase ? ` (${s.fase})` : ''}`), 12)}.`;
  }
  if (principal.herramienta === 'saber_atajos') {
    const l = principal.datos as FilaAtajo[];
    return `Hay ${l.length} atajos: ${algunos(l.map((a) => `«${a.nombre}»`), 8)}.`;
  }
  return principal.resumen;
}

function markdownDelPaso(p: PasoEjecutado): string {
  if (p.estado === 'error') return `**${p.que}**: ${p.error ?? 'falló'}`;
  if (p.herramienta === 'ejecutar_atajo') return markdownAtajo(p.datos as Ejecucion);
  if (p.herramienta === 'saber_entidades') {
    return tabla(['Código', 'Nombre', 'Tipo', 'De dónde'], (p.datos as FilaEntidad[]).map((e) => [e.codigo, nombreCorto(e.nombre), e.es_cd ? 'CD' : e.tipo, e.fuente]));
  }
  if (p.herramienta === 'saber_servicios') {
    return tabla(['Servicio', 'Nombre', 'Método', 'Fase'], (p.datos as FilaServicio[]).map((s) => [s.codigo, s.nombre, s.metodo_entrega, s.fase]));
  }
  if (p.herramienta === 'saber_atajos') {
    return tabla(['Atajo', 'Para qué', 'Bloques', 'País'], (p.datos as FilaAtajo[]).map((a) => [a.nombre, a.descripcion, a.tipos.join(', '), NOMBRE_PAIS[a.pais] ?? a.pais]));
  }
  return '';
}

export function armarRespuesta(turno: Turno, ahora = new Date()): RespuestaPanel {
  const pasos = turno.pasos ?? [];
  const principal = [...pasos].reverse().find((p) => p.estado === 'ok') ?? [...pasos].reverse().find((p) => p.estado === 'vacio');
  const texto = frase(pasos, principal);
  const resultados: ResultadoPanel[] = pasos
    .filter((p) => p.estado !== 'error')
    .map((p) => ({
      n: p.n,
      herramienta: p.herramienta,
      ...(p.herramienta === 'ejecutar_atajo' ? { atajo: (p.datos as Ejecucion).atajo } : {}),
      titulo: p.que,
      principal: p === principal,
      datos: p.datos,
    }));
  const cuerpo = [principal, ...pasos.filter((p) => p !== principal)].filter(Boolean).map((p) => markdownDelPaso(p!)).filter((s) => s.trim());
  return {
    v: 3,
    tipo: principal ? 'resultado' : 'error',
    turno_id: turno.id,
    mensaje_id: turno.mensaje_id,
    pais: (turno.contexto?.pais ?? 'PE') as Pais,
    hora: ahora.toISOString(),
    frase: texto,
    resultados,
    markdown: [texto, ...cuerpo].join('\n\n'),
    notas: [],
    avisos: [],
    pasos: pasos.map(({ n, que, estado, resumen, ms }) => ({ n, que, estado, resumen, ms })),
    detalles: { clasificacion: turno.clasificacion, modelos: turno.modelos ?? [], ms: ahora.getTime() - Date.parse(turno.creado_en) },
  };
}

/** Una respuesta sin pasos: lo que todavía no se hace, o lo que no se pudo entender */
export function respuestaSinPlan(turno: Turno, texto: string, ahora = new Date()): RespuestaPanel {
  return {
    v: 3,
    tipo: 'error',
    turno_id: turno.id,
    mensaje_id: turno.mensaje_id,
    pais: (turno.contexto?.pais ?? 'PE') as Pais,
    hora: ahora.toISOString(),
    frase: texto,
    resultados: [],
    markdown: texto,
    notas: [],
    avisos: [],
    pasos: [],
    detalles: { clasificacion: turno.clasificacion, modelos: turno.modelos ?? [], ms: ahora.getTime() - Date.parse(turno.creado_en) },
  };
}

/** El progreso mientras quedan pasos: lo hecho y lo que falta */
export function respuestaProgreso(turno: Turno, ahora = new Date()): RespuestaPanel {
  const hechos = turno.pasos ?? [];
  const faltan = (turno.plan?.pasos ?? []).slice(hechos.length);
  return {
    ...respuestaSinPlan(turno, `Voy por el paso ${hechos.length + 1} de ${hechos.length + faltan.length}.`, ahora),
    tipo: 'progreso',
    pasos: hechos.map(({ n, que, estado, resumen, ms }) => ({ n, que, estado, resumen, ms })),
  };
}
