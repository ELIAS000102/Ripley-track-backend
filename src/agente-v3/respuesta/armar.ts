import type { Ejecucion } from '../../configuracion/atajos/interfaces/atajos.interface.js';
import type { ResultadoCalculo } from '../calcular/calcular.js';
import type { Condicion } from '../filas.js';
import type { Pais, PasoEjecutado, Pregunta, RespuestaPanel, ResultadoPanel, Turno } from '../interfaces/agente-v3.interface.js';
import { herramienta as herramientaDe } from '../herramientas.js';
import { fraseAtajo, fraseConsulta, markdownAtajo, markdownConsulta, nombreCorto } from './atajo.js';
import { fraseDeCambios, markdownCambio, resumenCambio } from './cambio.js';
import { queEs } from '../que.js';

/**
 * Etapa 7 · Responder: la frase, los datos de cada paso para que el panel los
 * dibuje, y el Markdown. Sin IA: cada cifra sale de los datos.
 */

export interface FilaEntidad { codigo: string; nombre: string | null; tipo: string; es_cd: boolean; pais: string; fuente: string }
export interface FilaServicio { pais: string; codigo: string; nombre: string | null; metodo_entrega: string | null; fase: string | null; fuente?: string; origen?: string | null; descripcion?: string | null; ensenado_por?: string | null }
export interface FilaFase { codigo: string; metodo_entrega: string; nombre: string | null; recorrido: string[]; descripcion: string }
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
  if (herramienta.startsWith('saber_')) return loGuardado(herramienta, datos, param);
  if (herramientaDe(herramienta)?.edicion) return resumenCambio(herramienta, datos);
  return { estado: 'ok', resumen: '' };
}

const METODO: Record<string, string> = { RT: 'retiro en tienda', DP: 'despacho a domicilio' };
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? String(v).split(',') : []);

/** Un servicio en una frase: lo que es, su fase, de dónde sale el stock y lo que enseñó la gente */
function servicioEnPalabras(s: FilaServicio): string {
  const partes = [
    s.metodo_entrega ? METODO[s.metodo_entrega] ?? s.metodo_entrega : null,
    s.fase ? `fase ${s.fase}` : null,
    s.origen ? `el stock sale del ${s.origen}` : null,
  ].filter(Boolean);
  return `${s.codigo}${s.nombre ? ` · ${s.nombre}` : ''}${partes.length ? `: ${partes.join(', ')}` : ''}.${s.descripcion ? ` ${s.descripcion}` : ''}`;
}

/**
 * Lo guardado, contestando lo que se preguntó: "¿qué es la fase 1?" → su
 * recorrido y sus servicios; "¿qué es la SG?" → lo que se sabe de la SG;
 * "¿qué es el 1130?" → su tipo, nombre y país; sin filtro, el inventario.
 */
function loGuardado(herramienta: string, datos: unknown, param: Record<string, unknown>): { estado: PasoEjecutado['estado']; resumen: string } {
  const pais = NOMBRE_PAIS[String(param.pais)] ?? String(param.pais ?? '');
  if (herramienta === 'saber_fases') {
    const d = datos as { fase: FilaFase | null; servicios: FilaServicio[] };
    if (!d.fase) return { estado: 'vacio', resumen: `No tengo guardada la fase ${String(param.fase)}.` };
    const f = d.fase;
    const recorrido = (f.recorrido ?? []).length ? ` Recorrido: ${f.recorrido.join(' → ')}.` : '';
    const servicios = d.servicios.length ? ` En ${pais}: ${d.servicios.map((s) => `${s.codigo}${s.nombre ? ` (${s.nombre})` : ''}`).join(', ')}.` : ` En ${pais} no tengo servicios de esa fase.`;
    return { estado: 'ok', resumen: `La fase ${f.codigo}${f.nombre ? ` (${f.nombre})` : ''}: ${f.descripcion}${/[.!?]$/.test(f.descripcion) ? '' : '.'}${recorrido}${servicios}` };
  }
  if (herramienta === 'saber_servicios') {
    const l = datos as FilaServicio[];
    const pedidos = lista(param.servicio);
    if (pedidos.length) {
      const faltan = pedidos.filter((c) => !l.some((s) => s.codigo === c));
      const texto = [...l.map(servicioEnPalabras), ...(faltan.length ? [`No tengo guardado ${faltan.join(', ')} en ${pais}.`] : [])].join(' ');
      return { estado: l.length ? 'ok' : 'vacio', resumen: texto };
    }
    return { estado: l.length ? 'ok' : 'vacio', resumen: l.length ? `Tengo guardados ${l.length} servicios de ${pais}: ${algunos(l.map((s) => `${s.codigo}${s.fase ? ` (${s.fase})` : ''}`), 12)}.` : `No tengo servicios guardados de ${pais}.` };
  }
  if (herramienta === 'saber_entidades') {
    const l = datos as FilaEntidad[];
    const pedidos = lista(param.codigo);
    if (pedidos.length) {
      const faltan = pedidos.filter((c) => !l.some((e) => e.codigo === c));
      const una = (e: FilaEntidad) => `${e.codigo}${e.nombre ? ` · ${nombreCorto(e.nombre)}` : ''}: ${e.es_cd ? 'CD' : TIPO_ENTIDAD[e.tipo]?.[0] ?? e.tipo} de ${NOMBRE_PAIS[e.pais] ?? e.pais}.`;
      return { estado: l.length ? 'ok' : 'vacio', resumen: [...l.map(una), ...(faltan.length ? [`No tengo guardado el ${faltan.join(', ')}.`] : [])].join(' ') };
    }
    const [uno, varios] = TIPO_ENTIDAD[String(param.tipo)] ?? ['código', 'códigos'];
    const que = param.es_cd ? (l.length === 1 ? 'CD' : 'CDs') : l.length === 1 ? uno : varios;
    const guardadas = param.tipo === 'tienda' && !param.es_cd ? (l.length === 1 ? 'guardada' : 'guardadas') : l.length === 1 ? 'guardado' : 'guardados';
    return { estado: l.length ? 'ok' : 'vacio', resumen: l.length ? `Tengo ${guardadas} ${l.length} ${que} de ${pais}: ${algunos(l.map((e) => (e.nombre ? `${e.codigo} · ${nombreCorto(e.nombre)}` : e.codigo)))}.` : `No tengo ningún ${que} de ${pais} guardado.` };
  }
  const l = datos as FilaAtajo[];
  return { estado: l.length ? 'ok' : 'vacio', resumen: l.length ? `Hay ${l.length} atajos: ${algunos(l.map((a) => `«${a.nombre}»`), 8)}.` : 'No hay atajos guardados.' };
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
  if (p.herramienta === 'saber_servicios' || p.herramienta === 'saber_fases') {
    const l = p.herramienta === 'saber_fases' ? (p.datos as { servicios: FilaServicio[] }).servicios : (p.datos as FilaServicio[]);
    return tabla(['Servicio', 'Nombre', 'Método', 'Fase', 'Origen del stock'], l.map((s) => [s.codigo, s.nombre, s.metodo_entrega, s.fase, s.origen ?? '']));
  }
  if (herramientaDe(p.herramienta)?.edicion) return markdownCambio(p.herramienta, p.datos);
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
  // Varios cambios: la frase los dice todos y cada uno lleva su tabla con su título
  const cambios = pasos.filter((p) => herramientaDe(p.herramienta)?.edicion);
  const varios = cambios.length > 1 && cambios.some((p) => p.estado !== 'error');
  const texto = varios ? fraseDeCambios(cambios) : frase(pasos, principal);
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
  const cuerpo = varios
    ? [...cambios.map((p) => `**${p.que}**\n\n${markdownDelPaso(p)}`), ...pasos.filter((p) => !cambios.includes(p)).map((p) => markdownDelPaso(p))].filter((s) => s.trim())
    : [principal, ...pasos.filter((p) => p !== principal)].filter(Boolean).map((p) => markdownDelPaso(p!)).filter((s) => s.trim());
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

/**
 * Una pregunta (1d), con el formato de dudas que ya entiende el panel. La de
 * aprender va al final de la petición: lleva lo que se consultó, para que la
 * persona tenga su respuesta aunque no conteste.
 */
export function respuestaPregunta(turno: Turno, p: Pregunta, ahora = new Date()): RespuestaPanel {
  if (p.etapa === 'aprender' && (turno.pasos ?? []).length) {
    const r = armarRespuesta(turno, ahora);
    return { ...r, tipo: 'pregunta', markdown: `${r.markdown}\n\n${p.texto}`, dudas: [{ id: p.id, pregunta: p.texto, opciones: p.opciones, libre: p.libre }] };
  }
  return {
    ...base(turno, ahora),
    tipo: 'pregunta',
    frase: p.texto,
    markdown: p.texto,
    dudas: [{ id: p.id, pregunta: p.texto, opciones: p.opciones, libre: p.libre }],
  };
}

/**
 * El progreso mientras quedan pasos: TODOS los del plan, con lo hecho, el que
 * va (`en_curso`) y los que faltan (`pendiente`). Lleva `descripcion` y
 * `contexto`, que es lo que pinta el "Pensando…" del panel (como con la v2).
 */
export function respuestaProgreso(turno: Turno, ahora = new Date()): RespuestaPanel {
  const hechos = turno.pasos ?? [];
  const plan = turno.plan?.pasos ?? [];
  const texto = `Voy por el paso ${hechos.length + 1} de ${plan.length}.`;
  const pasos = plan.map((p, i) => {
    const hecho = hechos[i];
    if (hecho) return { n: hecho.n, que: hecho.que, descripcion: hecho.que, estado: hecho.estado, resumen: hecho.resumen, ms: hecho.ms };
    const que = queEs(p, turno.contexto?.pais);
    return { n: i + 1, que, descripcion: que, estado: i === hechos.length ? 'en_curso' : 'pendiente', resumen: '', ms: 0 };
  });
  return {
    ...base(turno, ahora),
    tipo: 'progreso',
    frase: texto,
    markdown: texto,
    pasos: pasos as RespuestaPanel['pasos'],
    contexto: { pais: turno.contexto?.pais ?? 'PE', motivo_pais: turno.contexto?.motivo_pais ?? null },
  };
}
