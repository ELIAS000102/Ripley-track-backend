import type { Ejecucion } from '../../configuracion/atajos/interfaces/atajos.interface.js';
import type { ResultadoCalculo } from '../calcular/calcular.js';
import type { Condicion } from '../filas.js';
import type { Pais, PasoEjecutado, Pregunta, RespuestaPanel, ResultadoPanel, Turno } from '../interfaces/agente-v3.interface.js';
import { fraseAtajo, fraseConsulta, markdownAtajo, markdownConsulta, nombreCorto } from './atajo.js';

/**
 * Etapa 7 · Responder: la frase, los datos de cada paso para que el panel los
 * dibuje, y el Markdown. Sin IA: cada cifra sale de los datos.
 */

export interface FilaEntidad { codigo: string; nombre: string | null; tipo: string; es_cd: boolean; pais: string; fuente: string }
export interface FilaServicio { pais: string; codigo: string; nombre: string | null; metodo_entrega: string | null; fase: string | null }
export interface FilaAtajo { nombre: string; descripcion: string | null; tipos: string[]; pais: string }

const NOMBRE_PAIS: Record<string, string> = { PE: 'Perú', CL: 'Chile' };
const TIPO_ENTIDAD: Record<string, [string, string]> = { tienda: ['tienda', 'tiendas'], almacen: ['almacén', 'almacenes'], opl: ['OPL', 'OPL'] };
const CONSULTAS = new Set(['consultar_capacidad', 'consultar_reporte_cds', 'consultar_transferencia', 'consultar_servicios_opl', 'busqueda_masiva', 'simular_entrega']);
const algunos = (l: string[], n = 5) => (l.length <= n ? l.join(', ') : `${l.slice(0, n).join(', ')} y ${l.length - n} más`);
const celda = (s: unknown) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const tabla = (cab: string[], filas: unknown[][]) =>
  filas.length ? [`| ${cab.join(' | ')} |`, `| ${cab.map(() => '---').join(' | ')} |`, ...filas.map((f) => `| ${f.map(celda).join(' | ')} |`)].join('\n') : '';

/** Una condición en palabras: "inactivas", "sin cupo", "uso >= 80" */
export function enPalabras(c: Condicion): string {
  if (c.campo === 'activa' || c.campo === 'habilitada') return (c.op === '!=' ? !c.valor : c.valor === true || c.valor === 'true') ? (c.campo === 'activa' ? 'activas' : 'habilitadas') : (c.campo === 'activa' ? 'inactivas' : 'deshabilitadas');
  if (c.campo === 'enCheckout') return c.valor ? 'en checkout' : 'fuera del checkout';
  if (c.campo === 'disponible' && ['<=', '='].includes(c.op) && Number(c.valor) === 0) return 'sin cupo';
  if (c.campo === 'jornadas') return `con ${c.valor} ${Number(c.valor) === 1 ? 'jornada' : 'jornadas'}`;
  return `${c.campo} ${c.op} ${String(c.valor)}${c.campo === 'uso' ? ' %' : ''}`;
}

type Salida = Pick<PasoEjecutado, 'cumplen' | 'total' | 'condicion' | 'comprobacion'>;

/** Lo que dice un paso de sí mismo (va en el progreso y en "pasos") */
export function resumenDelPaso(herramienta: string, datos: unknown, param: Record<string, unknown>, hoy: string, salida: Salida = {}): { estado: PasoEjecutado['estado']; resumen: string } {
  if (herramienta === 'ejecutar_atajo') {
    const e = datos as Ejecucion;
    const vacio = !e.resumen.items || !e.resumen.correctas;
    return { estado: vacio ? 'vacio' : 'ok', resumen: conCondicion(fraseAtajo(e, hoy).replace(/\.$/, ''), salida) };
  }
  if (CONSULTAS.has(herramienta)) {
    const base = fraseConsulta(herramienta, datos, hoy);
    const notas = (datos as { notas?: string[] })?.notas ?? [];
    return { estado: base === 'sin datos' ? 'vacio' : 'ok', resumen: conCondicion(`${base}${notas.length ? `; ${notas.join('; ')}` : ''}`, salida) };
  }
  if (herramienta === 'calcular') {
    const r = datos as ResultadoCalculo;
    return { estado: r.usadas ? 'ok' : 'vacio', resumen: r.frase };
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

/** La condición y la comprobación delante de la frase: lo primero es contestar */
function conCondicion(base: string, s: Salida): string {
  const partes: string[] = [];
  if (s.comprobacion) {
    const { pregunta: c, si, total, cumplen, noCumplen } = s.comprobacion;
    const que = `${enPalabras(c)}${c.servicio ? ` (${c.servicio})` : ''}`;
    if (c.cuantos === 'todos') partes.push(si ? `Sí: los ${total} están ${que}` : `No: ${noCumplen.length} de ${total} no están ${que}: ${algunos(noCumplen)}`);
    else if (c.cuantos === 'ninguno') partes.push(si ? `Sí: ninguno de los ${total} está ${que}` : `No: ${cumplen.length} de ${total} están ${que}: ${algunos(cumplen)}`);
    else partes.push(si ? `Sí: ${cumplen.length} de ${total} están ${que}: ${algunos(cumplen)}` : `No: ninguno de los ${total} está ${que}`);
  }
  if (s.condicion && s.total !== undefined) {
    const n = s.cumplen?.length ?? 0;
    partes.push(n ? `${n} de ${s.total} ${enPalabras(s.condicion)}: ${algunos(s.cumplen ?? [])}` : `Ninguna de las ${s.total} está ${enPalabras(s.condicion)}`);
    return `${partes.join('. ')}.`;
  }
  return partes.length ? `${partes.join('. ')}. ${base}` : base;
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
  const r = principal.resumen.trim();
  const fallidos = pasos.filter((p) => p.estado === 'error');
  return `${/[.!?]$/.test(r) ? r : `${r}.`}${fallidos.length ? ` (${fallidos.length === 1 ? 'Un paso falló' : `${fallidos.length} pasos fallaron`}: ${fallidos.map((p) => p.error).join('; ')}.)` : ''}`;
}

function markdownDelPaso(p: PasoEjecutado): string {
  if (p.estado === 'error') return `**${p.que}**: ${p.error ?? 'falló'}`;
  if (p.herramienta === 'ejecutar_atajo') return markdownAtajo(p.datos as Ejecucion);
  if (CONSULTAS.has(p.herramienta)) return markdownConsulta(p.herramienta, p.datos);
  if (p.herramienta === 'calcular') {
    const r = p.datos as ResultadoCalculo;
    return r.columnas.length ? tabla(r.columnas, r.filas) : '';
  }
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

function base(turno: Turno, ahora: Date): Omit<RespuestaPanel, 'tipo' | 'frase' | 'markdown'> {
  return {
    v: 3,
    turno_id: turno.id,
    mensaje_id: turno.mensaje_id,
    pais: (turno.contexto?.pais ?? 'PE') as Pais,
    hora: ahora.toISOString(),
    resultados: [],
    notas: [],
    avisos: [],
    pasos: [],
    detalles: { clasificacion: turno.clasificacion, modelos: turno.modelos ?? [], ms: ahora.getTime() - Date.parse(turno.creado_en) },
  };
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
      ...(p.total !== undefined ? { total: p.total } : {}),
    }));
  const cuerpo = [principal, ...pasos.filter((p) => p !== principal)].filter(Boolean).map((p) => markdownDelPaso(p!)).filter((s) => s.trim());
  const ver = turno.plan?.ver;
  return {
    ...base(turno, ahora),
    tipo: principal ? 'resultado' : 'error',
    frase: texto,
    resultados,
    markdown: [texto, ...cuerpo].join('\n\n'),
    ver: ver ?? null,
    pasos: pasos.map(({ n, que, estado, resumen, ms }) => ({ n, que, estado, resumen, ms })),
  };
}

/** Una respuesta sin pasos: lo que todavía no se hace, o lo que no se pudo entender */
export function respuestaSinPlan(turno: Turno, texto: string, ahora = new Date()): RespuestaPanel {
  return { ...base(turno, ahora), tipo: 'error', frase: texto, markdown: texto };
}

/** La conversación genérica: un saludo, un gracias, la ayuda */
export function respuestaCharla(turno: Turno, texto: string, ahora = new Date()): RespuestaPanel {
  return { ...base(turno, ahora), tipo: 'resultado', frase: texto.split('\n')[0], markdown: texto, notas: texto.includes('\n') ? texto.split('\n').slice(1).filter(Boolean) : [] };
}

/** Una pregunta (1d), con el formato de dudas que ya entiende el panel */
export function respuestaPregunta(turno: Turno, p: Pregunta, ahora = new Date()): RespuestaPanel {
  return {
    ...base(turno, ahora),
    tipo: 'pregunta',
    frase: p.texto,
    markdown: p.texto,
    dudas: [{ id: p.id, pregunta: p.texto, opciones: p.opciones, libre: p.libre }],
  };
}

/** El progreso mientras quedan pasos: lo hecho y lo que falta */
export function respuestaProgreso(turno: Turno, ahora = new Date()): RespuestaPanel {
  const hechos = turno.pasos ?? [];
  const faltan = (turno.plan?.pasos ?? []).slice(hechos.length);
  const texto = `Voy por el paso ${hechos.length + 1} de ${hechos.length + faltan.length}.`;
  return {
    ...base(turno, ahora),
    tipo: 'progreso',
    frase: texto,
    markdown: texto,
    pasos: hechos.map(({ n, que, estado, resumen, ms }) => ({ n, que, estado, resumen, ms })),
  };
}
