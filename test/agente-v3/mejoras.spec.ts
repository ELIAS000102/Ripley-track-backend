import { describe, expect, it, vi } from 'vitest';
import { AgenteV3Service, porQueSinModelo } from '../../src/agente-v3/agente-v3.service.js';
import { hechoEnPalabras, leerAprendido, SISTEMA_APRENDER } from '../../src/agente-v3/aprender/prompt.js';
import { leerPlan } from '../../src/agente-v3/armar/leer.js';
import { promptArmar } from '../../src/agente-v3/armar/prompt.js';
import { calcular } from '../../src/agente-v3/calcular/calcular.js';
import { leerCalculo } from '../../src/agente-v3/calcular/prompt.js';
import { agendasDeDatos } from '../../src/agente-v3/agendas.js';
import { EjecucionV3Service, enClaro } from '../../src/agente-v3/ejecucion.service.js';
import { mencionesDe, type EntidadDirectorio } from '../../src/agente-v3/entidades.js';
import { filasDe } from '../../src/agente-v3/filas.js';
import type { ContextoTurno, Hecho, IntentoModelo, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';
import { elegirModelo } from '../../src/agente-v3/modelos.js';
import { preguntaDeAprender, respuestaDeAprender } from '../../src/agente-v3/preguntas.js';
import { filasDelCambio, markdownCambio, resumenCambio } from '../../src/agente-v3/respuesta/cambio.js';

/**
 * Las mejoras decididas el 2026-11-08 (agente-v3/PLAN.md): aprender, lo
 * guardado con precisión, el país, retomar un mensaje que falló, los cambios
 * en vista previa (sin aplicar nada) y los cálculos sobre lo guardado.
 */

const HOY = '2026-11-07';
const MANANA = '2026-11-08';
const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };
const M = { cuenta: 1, nombre: 'gemini-3.5-flash-lite' };

const DIRECTORIO: EntidadDirectorio[] = [
  { pais: 'PE', codigo: '20048', tipo: 'tienda', es_cd: false, nombre: 'Ripley Breña', alias: [] },
  { pais: 'PE', codigo: '20026', tipo: 'almacen', es_cd: true, nombre: 'CD Villa El Salvador', alias: [] },
  { pais: 'PE', codigo: '20096', tipo: 'almacen', es_cd: true, nombre: 'CD Aldeas', alias: ['aldeas'] },
];

const ctx = (mensaje: string, extra: Partial<ContextoTurno> = {}): ContextoTurno => ({
  hoy: HOY, pais: 'PE', motivo_pais: '', anterior: null, aclaraciones: [], pregunta: null, rondas: 0, avisos: [],
  atajos: [],
  servicios: ['RT', 'SE', 'SG', 'SD', 'S'].map((codigo) => ({ codigo, nombre: null, metodo_entrega: null, fase: null })),
  entidades: mencionesDe(mensaje, DIRECTORIO, 'PE'),
  ...extra,
});

const dia = (fecha: string, activo: boolean, asignado: number, ocupado: number) => ({ fecha, activo, asignado, ocupado, disponible: asignado - ocupado, uso: asignado > 0 ? Math.round((100 * ocupado) / asignado) : 0 });
const CAPACIDAD = { tipo: 'despacho', pais: 'PE', desde: HOY, sinDatos: [], oficinas: [
  { oficina: '1100 - Lima metropolitana', agendas: [{ agenda: 'Centralizado HUB Surquillo', servicio: 'S', unidad: null, dias: [dia(HOY, true, 100, 40)] }] },
] };
/** Lo que devuelve la edición de capacidad de la v2 (releído el antes; el después, lo que quedaría) */
const EDICION = {
  tipo: 'despacho',
  oficinas: [{ oficina: '1100 - Lima metropolitana', agendas: [
    { agenda: 'Centralizado HUB Surquillo', dias: [{ fecha: MANANA, antes: dia(MANANA, true, 100, 0), despues: dia(MANANA, false, 100, 0) }] },
    { agenda: 'Flota exclusiva', dias: [{ fecha: MANANA, antes: dia(MANANA, false, 30, 0), despues: dia(MANANA, false, 30, 0) }] },
  ] }],
  resumen: { pedidos: 2, cambiados: 1, sinCambiar: 1 },
};

function armarServicio(contexto: ContextoTurno, { simulacro = true, capacidadDatos = CAPACIDAD as unknown } = {}) {
  const filas = new Map<string, Turno>();
  let n = 0;
  const turnos = {
    crear: vi.fn(async (d: Partial<Turno>) => {
      const t = { id: `00000000-0000-4000-8000-0000000000${String(++n).padStart(2, '0')}`, etapa: 'clasificar', estado: 'en_curso', contexto: null, clasificacion: null, plan: null, pasos: [], modelos: [], respuesta: null, mensaje_id: null, creado_en: new Date().toISOString(), ...d } as Turno;
      filas.set(t.id, t);
      return { ...t };
    }),
    obtener: vi.fn(async (id: string) => structuredClone(filas.get(id)!)),
    actualizar: vi.fn(async (id: string, c: Partial<Turno>) => { filas.set(id, { ...filas.get(id)!, ...structuredClone(c) }); }),
  };
  const ctxServ = {
    comprobarChat: vi.fn(async () => undefined),
    armar: vi.fn(async () => structuredClone(contexto)),
    cambiarPais: vi.fn(async (c: ContextoTurno, m: string, pais: 'PE' | 'CL', motivo: string) => ({ ...c, pais, motivo_pais: motivo, entidades: mencionesDe(m, DIRECTORIO, pais), avisos: [...(c.avisos ?? []), `Paso a ${pais === 'CL' ? 'Chile' : 'Perú'}: ${motivo}.`] })),
    rebuscar: vi.fn(async (m: string, pais: 'PE' | 'CL') => mencionesDe(m, DIRECTORIO, pais)),
    olvidarDirectorio: vi.fn(),
  };
  const rpc = vi.fn(async () => ({ data: 'm-1', error: null }));
  const supabase = { admin: { rpc } };
  const capacidad = { consultar: vi.fn(async () => structuredClone(capacidadDatos)) };
  // El simulacro: lo que hace ContextoAuditoria (no tiene vuelta atrás)
  let enSimulacro = false;
  const auditoria = { activarSimulacro: vi.fn(() => { if (simulacro) enSimulacro = true; }), enSimulacro: vi.fn(() => enSimulacro) };
  const editarCapacidad = { editarCapacidad: vi.fn(async () => { expect(enSimulacro).toBe(true); return structuredClone(EDICION); }) };
  const ejecucion = new EjecucionV3Service(supabase as never, {} as never, {} as never, capacidad as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    auditoria as never, editarCapacidad as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const interrupcion = { registrar: vi.fn(), estaInterrumpida: vi.fn(() => false) };
  const aprendizaje = {
    sabido: vi.fn(async () => ['- servicio SG: {"fase":"F3"}']),
    fases: vi.fn(async () => ['- F2 (Fase 2): Se pickea en el CD o almacén, se transfiere…']),
    revisar: vi.fn(async () => ({ choques: ['Tenía la SG con fase «F3»; pasaría a «F2».'], intocables: [] })),
    guardar: vi.fn(async (h: Hecho[]) => ({ guardados: h.map((x) => x.codigo), omitidos: [] })),
  };
  const servicio = new AgenteV3Service(turnos as never, ctxServ as never, ejecucion, interrupcion as never, supabase as never, aprendizaje as never);
  return { servicio, filas, ctxServ, rpc, auditoria, editarCapacidad, aprendizaje, capacidad };
}

const clasif = (tipo: string, extra: Record<string, unknown> = {}) => JSON.stringify({ tipo, depende_del_anterior: false, atajo: '(ninguno)', motivo: '', ...extra });
async function hastaElFinal(servicio: AgenteV3Service, id: string) {
  let r = await servicio.ejecutar(USUARIO, id);
  for (let i = 0; i < 6 && r.camino === 'avisar'; i++) r = await servicio.ejecutar(USUARIO, id);
  return r;
}

const SG = 'la SG es el site to store de gran volumen, los pedidos salen siempre del CD aldeas (20096), se pickea y se transfiere a las tiendas con recepcion SG';
const HECHO_SG = { tipo: 'servicio', codigo: 'SG', nombre: 'Site to Store Gran Volumen', metodo_entrega: 'RT', fase: 'F2', origen: '20096', descripcion: 'Se pickea en el CD y se transfiere a las tiendas que reciben la SG.' };

describe('Cambios: cómo quedaría, sin aplicar nada', () => {
  it('cambio → Armar con las ediciones → ejecutar en simulacro → antes/después y "No apliqué nada"', async () => {
    const m = 'cierra el despacho de la 1100 mañana';
    const { servicio, auditoria, editarCapacidad } = armarServicio(ctx(m));
    const t = await servicio.crear(USUARIO, { mensaje: m, chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('cambio'), modelo: M });
    expect(a.camino).toBe('armar');
    expect(a.prompt!.sistema).toContain('ES UN CAMBIO');
    expect(a.prompt!.sistema).toContain('- editar_capacidad:');
    const e = await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify({ pasos: [{ herramienta: 'editar_capacidad', param: { tipo: 'despacho', codigo: ['1100'], fecha: 'mañana', activa: false } }] }), modelo: M });
    expect(e.camino).toBe('ejecutar');
    const r = await hastaElFinal(servicio, t.turno_id);
    expect(auditoria.activarSimulacro).toHaveBeenCalled();
    expect(editarCapacidad.editarCapacidad).toHaveBeenCalledWith(USUARIO, expect.objectContaining({ tipo: 'despacho', codigo: '1100', fecha: MANANA, activa: false, pais: 'PE' }));
    expect(r.respuesta!.frase).toBe('Así quedaría: cambiaría 1 de 2; 1 ya estaba así. No apliqué nada: es solo una vista previa. Para aplicarlo, pídeselo al agente v2 con el modo editor.');
    expect((r.respuesta!.resultados[0].datos as { vista: unknown[] }).vista[0]).toEqual({ donde: '1100 · Lima metropolitana · Centralizado HUB Surquillo', dia: MANANA, antes: 'abierto · asignado 100 · disponible 100', despues: 'cerrado · asignado 100 · disponible 100' });
    expect(r.respuesta!.markdown).toContain('| Dónde | Día | Ahora | Quedaría |');
  });

  it('si la petición no queda en simulacro, no se llama a la edición', async () => {
    const m = 'cierra el despacho de la 1100 mañana';
    const { servicio, editarCapacidad } = armarServicio(ctx(m), { simulacro: false });
    const t = await servicio.crear(USUARIO, { mensaje: m, chat_id: 'c' });
    await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('cambio'), modelo: M });
    await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify({ pasos: [{ herramienta: 'editar_capacidad', param: { tipo: 'despacho', codigo: ['1100'], fecha: 'mañana', activa: false } }] }), modelo: M });
    const r = await hastaElFinal(servicio, t.turno_id);
    expect(editarCapacidad.editarCapacidad).not.toHaveBeenCalled();
    expect(r.respuesta!.frase).toMatch(/^No pude: no pude poner la petición en simulacro/);
  });

  it('leerPlan: una edición sin pedir un cambio no vale; un cambio sin edición tampoco; uno solo', () => {
    const c = ctx('cierra la 1100');
    const edicion = { herramienta: 'editar_capacidad', param: { tipo: 'despacho', codigo: ['1100'], fecha: 'hoy', activa: false } };
    expect(leerPlan(JSON.stringify({ pasos: [edicion] }), c, 'cierra la 1100')).toMatchObject({ ok: false, motivo: 'paso 1: editar_capacidad es un cambio, y no se pidió ningún cambio' });
    expect(leerPlan(JSON.stringify({ pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'despacho', codigo: ['1100'] } }] }), c, 'cierra la 1100', true)).toMatchObject({ ok: false, motivo: 'se pidió un cambio y el plan no trae ninguno' });
    expect(leerPlan(JSON.stringify({ pasos: [edicion, edicion] }), c, 'cierra la 1100', true)).toMatchObject({ ok: false, motivo: 'paso 2: un solo cambio por mensaje' });
    expect(leerPlan(JSON.stringify({ pasos: [edicion] }), c, 'cierra la 1100', true)).toMatchObject({ ok: true, valor: { plan: { origen: 'cambio' } } });
    // Sin cambio, las ediciones ni aparecen en el catálogo
    expect(promptArmar('la 1100', c, { tipo: 'consulta', dep: false, atajo: null, motivo: '' }).sistema).not.toContain('editar_capacidad');
  });

  it('la vista previa de las demás ediciones: CD, OPL, transferencia', () => {
    expect(filasDelCambio('cortar_reabrir_cd', { jornadas: [{ cd: '20026', jornada: 'AM', agenda: 'Picking AM', fecha: MANANA, antes: true, despues: false }] })[0]).toMatchObject({ antes: 'abierta', despues: 'cortada' });
    expect(filasDelCambio('editar_servicio_opl', { servicios: [{ opl: '1100', zona: 'Lima', agenda: 'Centralizado', servicio: 'S', antes: { activo: true, enCheckout: true, cortes: ['14:00'], diasHolgura: 1, maxOcurrencia: null }, despues: { activo: true, enCheckout: false, cortes: ['14:00'], diasHolgura: 1, maxOcurrencia: null } }] })[0].despues).toBe('activo · fuera del checkout · corte 14:00 · holgura 1');
    const t = { origen: '20026', destinos: [{ destino: '20048', antes: null, despues: null, error: 'no existe esa relación' }] };
    expect(resumenCambio('editar_transferencia', t)).toEqual({ estado: 'vacio', resumen: 'No cambiaría nada: ya está así; 1 no se podría tocar (no existe esa relación). No apliqué nada: es solo una vista previa. Para aplicarlo, pídeselo al agente v2 con el modo editor.' });
    expect(markdownCambio('editar_transferencia', t)).toContain('no se puede: no existe esa relación');
  });
});

describe('Aprender: se pregunta al final y se guarda con un "sí"', () => {
  it('enseñar → Aprender (3.5 Flash) → "¿lo guardo?" con lo que tenía → sí → al directorio común', async () => {
    const { servicio, aprendizaje, filas } = armarServicio(ctx(SG));
    const t = await servicio.crear(USUARIO, { mensaje: SG, chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('enseñar'), modelo: M });
    expect(a.camino).toBe('aprender');
    expect(a.modelo).toMatchObject({ rol: 'aprender', nombre: 'gemini-3.5-flash', nodo: expect.stringMatching(/^Gemini 3\.5 Flash · cuenta \d$/) });
    expect(a.prompt!.sistema).toBe(SISTEMA_APRENDER);
    expect(a.prompt!.mensaje).toContain('LO QUE YA SÉ DE LO QUE SE NOMBRA\n- servicio SG: {"fase":"F3"}');
    expect(a.prompt!.mensaje).toContain('CÓDIGOS DEL MENSAJE\n- 20096 · CD Aldeas (CD)');

    const p = await servicio.aprendido(USUARIO, t.turno_id, { salida: JSON.stringify({ hechos: [HECHO_SG], dudas: [] }), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    expect(p.camino).toBe('preguntar');
    const duda = p.pregunta!.dudas![0];
    expect(duda.opciones.map((o) => o.id)).toEqual(['si', 'no']);
    expect(duda.pregunta).toBe('Me enseñaste esto. ¿Lo guardo para todos?\n• SG · Site to Store Gran Volumen: retiro en tienda, fase F2, el stock sale siempre del 20096. Se pickea en el CD y se transfiere a las tiendas que reciben la SG.\nOjo: Tenía la SG con fase «F3»; pasaría a «F2».');

    const r = await servicio.respuesta(USUARIO, t.turno_id, { respuestas: { aprender: 'si' } });
    expect(aprendizaje.guardar).toHaveBeenCalledWith([expect.objectContaining({ codigo: 'SG', origen: '20096', fase: 'F2', metodo_entrega: 'RT' })], 'jhumanim8@ripley.com.pe');
    expect(r.camino).toBe('responder');
    expect(r.respuesta!.frase).toBe('Guardado para todos: SG. Ya lo uso desde el próximo mensaje.');
    expect(filas.get(t.turno_id)!.contexto!.ensenanza!.final).toBe('guardado');
  });

  it('escribir es corregir: vuelve a Aprender con la corrección; «No ahora» no guarda nada', async () => {
    const { servicio, aprendizaje } = armarServicio(ctx(SG));
    const t = await servicio.crear(USUARIO, { mensaje: SG, chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('enseñar'), modelo: M });
    await servicio.aprendido(USUARIO, t.turno_id, { salida: JSON.stringify({ hechos: [HECHO_SG], dudas: [] }), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    const otra = await servicio.respuesta(USUARIO, t.turno_id, { texto: 'no, es fase 3' });
    expect(otra.camino).toBe('aprender');
    expect(otra.prompt!.mensaje).toContain('LO QUE ACLARÓ LA PERSONA\n- no, es fase 3');
    await servicio.aprendido(USUARIO, t.turno_id, { salida: JSON.stringify({ hechos: [{ ...HECHO_SG, fase: 'F3' }], dudas: [] }), modelo: { cuenta: otra.modelo!.cuenta, nombre: otra.modelo!.nombre } });
    const r = await servicio.respuesta(USUARIO, t.turno_id, { respuestas: { aprender: 'no' } });
    expect(aprendizaje.guardar).not.toHaveBeenCalled();
    expect(r.respuesta!.frase).toBe('De acuerdo: no guardé lo que me enseñaste.');
  });

  it('lo que se enseña de paso: primero la consulta; al final, "¿lo guardo?" CON los resultados', async () => {
    const m = 'dame el despacho de la 1100, que es el OPL de lima metropolitana';
    const { servicio, aprendizaje, rpc } = armarServicio(ctx(m));
    const t = await servicio.crear(USUARIO, { mensaje: m, chat_id: 'c' });
    await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('consulta', { ensena: true }), modelo: M });
    await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify({ pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'despacho', codigo: ['1100'] } }] }), modelo: M });
    const fin = await hastaElFinal(servicio, t.turno_id);
    expect(fin.camino).toBe('aprender');
    const p = await servicio.aprendido(USUARIO, t.turno_id, { salida: JSON.stringify({ hechos: [{ tipo: 'entidad', codigo: '1100', clase: 'opl', nombre: 'Lima Metropolitana' }], dudas: [] }), modelo: { cuenta: fin.modelo!.cuenta, nombre: fin.modelo!.nombre } });
    expect(p.camino).toBe('preguntar');
    expect(p.pregunta!.tipo).toBe('pregunta');
    expect(p.pregunta!.resultados[0]).toMatchObject({ herramienta: 'consultar_capacidad' });
    expect(p.pregunta!.frase).toMatch(/^1 oficina/);
    expect(p.pregunta!.dudas![0].pregunta).toContain('• 1100 · Lima Metropolitana: OPL.');
    // Nadie contesta: la respuesta se guarda en el chat igual, sin aprender
    const r = await servicio.respuesta(USUARIO, t.turno_id, { caducada: true });
    expect(r.camino).toBe('fin');
    expect(aprendizaje.guardar).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('agente_v3_guardar_mensaje', expect.objectContaining({ p: expect.objectContaining({ con_contenido: true }) }));
  });

  it('leerAprendido: limpio y validado (un código que nadie dijo, o una fase que no cuadra, no vale)', () => {
    const c = ctx(SG);
    expect(leerAprendido(JSON.stringify({ hechos: [HECHO_SG] }), c, SG)).toMatchObject({ ok: true, valor: { hechos: [{ codigo: 'SG', pais: 'PE', origen: '20096' }] } });
    expect(leerAprendido(JSON.stringify({ hechos: [{ ...HECHO_SG, origen: '20027' }] }), c, SG)).toMatchObject({ ok: false, motivo: 'hecho 1: el origen 20027 no lo dijo nadie' });
    expect(leerAprendido(JSON.stringify({ hechos: [{ ...HECHO_SG, metodo_entrega: 'DP' }] }), c, SG)).toMatchObject({ ok: false, motivo: 'hecho 1: la fase F2 es de RT, no de DP' });
    // Sin método, la fase lo dice
    expect(leerAprendido(JSON.stringify({ hechos: [{ ...HECHO_SG, metodo_entrega: null }] }), c, SG)).toMatchObject({ ok: true, valor: { hechos: [{ metodo_entrega: 'RT' }] } });
    expect(hechoEnPalabras({ tipo: 'entidad', pais: 'PE', codigo: '20096', nombre: 'CD Aldeas', clase: 'almacen', es_cd: true, alias: ['aldeas'] })).toBe('20096 · CD Aldeas: CD (también «aldeas»).');
  });

  it('"¿lo guardo?": sin nada que se pueda guardar no ofrece "sí"; las respuestas escritas se entienden', () => {
    const intocable = preguntaDeAprender({ texto: '', hechos: [{ tipo: 'servicio', pais: 'PE', codigo: 'ST', fase: 'F1' }], dudas: [], choques: [], intocables: ['La ST la puso a mano el administrador: no la cambio desde el chat.'] });
    expect(intocable.opciones.map((o) => o.id)).toEqual(['no']);
    const p = preguntaDeAprender({ texto: '', hechos: [HECHO_SG as Hecho], dudas: [], choques: [], intocables: [] });
    expect(respuestaDeAprender(p, { texto: 'sí, guárdalo' })).toEqual({ si: true });
    expect(respuestaDeAprender(p, { texto: 'No ahora' })).toEqual({ no: true });
    expect(respuestaDeAprender(p, { cancelar: true })).toEqual({ no: true });
    expect(respuestaDeAprender(p, { texto: 'sale del 20026' })).toEqual({ corrige: 'sale del 20026' });
  });
});

describe('Lo aprendido se usa: el origen del servicio es un código "dicho"', () => {
  it('"el desfase de la transferencia de la SG a la 20048": el origen 20096 vale aunque no se diga', () => {
    const m = 'el desfase de la transferencia de la SG a la 20048';
    const c = ctx(m, { servicios: [{ codigo: 'SG', nombre: 'Site to Store Gran Volumen', metodo_entrega: 'RT', fase: 'F2', origen: '20096', descripcion: null }] });
    expect(promptArmar(m, c, null).mensaje).toContain('- SG · Site to Store Gran Volumen · retiro en tienda · fase F2 · ORIGEN DE STOCK 20096');
    expect(leerPlan(JSON.stringify({ pasos: [{ herramienta: 'consultar_transferencia', param: { origen: '20096', destino: ['20048'] } }] }), c, m)).toMatchObject({ ok: true });
    expect(leerPlan(JSON.stringify({ pasos: [{ herramienta: 'consultar_transferencia', param: { origen: '20027', destino: ['20048'] } }] }), ctx(m), m)).toMatchObject({ ok: false });
  });
});

describe('País y retomar un mensaje que falló', () => {
  it('"es de Perú" tras uno que falló: se pide aquello con la aclaración, en Perú', async () => {
    const anterior = { id: 'm0', persona: 'el picking de la 20048', frase: 'No tengo la 20048 en Chile.', herramientas: [], plan: null, resultados: [], version: 3 as const, elegido: false, fallido: true };
    const { servicio, ctxServ } = armarServicio(ctx('es de peru', { pais: 'CL', anterior }));
    const t = await servicio.crear(USUARIO, { mensaje: 'es de peru', chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('consulta', { retoma: true }), modelo: M });
    expect(ctxServ.cambiarPais).toHaveBeenCalledWith(expect.anything(), 'el picking de la 20048 (es de peru)', 'PE', 'lo aclaraste («es de peru»)');
    expect(a.camino).toBe('armar');
    expect(a.prompt!.mensaje).toContain('PAÍS: Perú');
    expect(a.prompt!.mensaje).toContain('«el picking de la 20048 (es de peru)»');
    expect(a.prompt!.mensaje).toContain('- 20048 · Ripley Breña (tienda)');
  });
});

describe('Sin modelo: la causa real', () => {
  const f = (clase: IntentoModelo['clase'], motivo = 'x'): IntentoModelo => ({ rol: 'armar', cuenta: 1, nombre: 'gemini-3.5-flash-lite', ok: false, clase, motivo });
  it('cuota, saturados o lo que respondieron', () => {
    expect(porQueSinModelo([f('cuota'), f('cuota')], 'armar')).toBe('se acabó la cuota gratis de los modelos por hoy (429): vuelve a intentarlo más tarde');
    expect(porQueSinModelo([f('saturado')], 'armar')).toBe('los modelos están saturados ahora mismo (503): vuelve a intentarlo en un momento');
    expect(porQueSinModelo([f('respuesta', 'no devolvió un JSON')], 'armar')).toBe('los modelos respondieron, pero no algo que valiera (no devolvió un JSON)');
  });
  it('una respuesta que no valía en un rol no descarta ese modelo en otro rol', () => {
    const malo: IntentoModelo = { rol: 'clasificar', cuenta: 1, nombre: 'gemini-3.5-flash-lite', ok: false, clase: 'respuesta', motivo: 'no devolvió un JSON' };
    const turno = '00000000-0000-4000-8000-000000000001';
    const primera = elegirModelo('armar', turno, [])!;
    expect(elegirModelo('armar', turno, [{ ...malo, cuenta: primera.cuenta }])).toMatchObject({ nombre: primera.nombre, cuenta: primera.cuenta });
    expect(elegirModelo('armar', turno, [{ ...malo, cuenta: primera.cuenta, clase: 'otro' }])).not.toMatchObject({ nombre: primera.nombre, cuenta: primera.cuenta });
  });
});

describe('Cálculos sobre lo guardado', () => {
  const ENTIDADES = [
    { codigo: '20048', nombre: 'Ripley Breña', tipo: 'tienda', es_cd: false, pais: 'PE', fuente: 'ripley' },
    { codigo: '20066', nombre: 'Ripley Plaza Lima Norte', tipo: 'tienda', es_cd: false, pais: 'PE', fuente: 'ripley' },
    { codigo: '20026', nombre: 'CD Villa El Salvador', tipo: 'almacen', es_cd: true, pais: 'PE', fuente: 'cds' },
  ];
  it('lo guardado también son filas: contar por tipo, filtrar por nombre', () => {
    const filas = filasDe('saber_entidades', ENTIDADES);
    expect(filas.map((f) => [f.codigo, f.tipo])).toEqual([['20048', 'tienda'], ['20066', 'tienda'], ['20026', 'CD']]);
    expect(calcular(filas, { operacion: 'contar', campo: null, filtro: {}, agrupar: ['tipo'] }, 'Los códigos').filas).toEqual([['tienda', 2], ['CD', 1]]);
    const plaza = calcular(filas, { operacion: 'filtrar', campo: null, filtro: { nombre: 'plaza' }, agrupar: [] }, 'Los códigos');
    expect(plaza.frase).toBe('1 de 3 códigos («plaza»), según «Los códigos».');
    expect(plaza.filas).toEqual([['20066 · Plaza Lima Norte', 'tienda', 'PE']]);
  });
  it('los servicios de una fase, y filtrar cuenta agendas (con cuántos códigos)', () => {
    const servicios = filasDe('saber_fases', { fase: { codigo: 'F2' }, servicios: [{ codigo: 'SG', nombre: 'Site to Store', metodo_entrega: 'RT', fase: 'F2', origen: '20096' }] });
    expect(servicios[0]).toMatchObject({ clase: 'servicio', codigo: 'SG', fase: 'F2', origen: '20096' });
    const masiva = filasDe('busqueda_masiva', { servicio: 'RE', agendas: [
      { opl: '20021 - Ripley Chorrillos', agenda: 'A', activa: false, enCheckout: false },
      { opl: '20021 - Ripley Chorrillos', agenda: 'B', activa: false, enCheckout: false },
      { opl: '20048 - Ripley Breña', agenda: 'C', activa: true, enCheckout: true },
    ] });
    expect(calcular(masiva, { operacion: 'filtrar', campo: null, filtro: { activa: false }, agrupar: [] }, 'Búsqueda masiva de RE').frase).toBe('2 de 3 agendas (1 código) (inactivas), según «Búsqueda masiva de RE».');
  });
  it('un dato que no se guarda se dice, no se sustituye por otro', () => {
    expect(leerCalculo(JSON.stringify({ operacion: null, falta: 'la ciudad de cada tienda' }), ctx(''), filasDe('saber_entidades', ENTIDADES))).toEqual({ ok: true, valor: { falta: 'la ciudad de cada tienda' } });
  });
});

// ── Las agendas: el modelo elige el nombre exacto, el código lo comprueba y lo manda solo donde está ──

/** El despacho de la "Paquetería Lima" (captura del usuario, 2026-11-08): en la 1100 cada zona es una agenda */
const zona = (nombre: string, agenda = nombre) => ({ agenda, zona: nombre, servicio: 'S', unidad: null, dias: [dia(MANANA, true, 1000, 0)] });
const DESPACHO = { tipo: 'despacho', pais: 'PE', desde: HOY, sinDatos: [], oficinas: [
  { oficina: '1100 - Lima metropolitana', agendas: [zona('Centralizado HUB Cedros'), zona('Centralizado HUB San Luis'), zona('CT Chorrillos - 99 Min'), zona('Flota Exclusiva'), zona('Centralizado HUB Surquillo')] },
  { oficina: '1007', agendas: [zona('Zona 1007 - Sector Zona Lejana', 'Agenda 1007 - Sector Zona Lejana')] },
  { oficina: '1008', agendas: [zona('Zona  Courrier Consolida')] },
] };
const ATAJO_PAQUETERIA = { atajo: 'Paqueteria Lima', bloques: [{ orden: 1, tipo: 'despacho', nota: null, items: [{ resultado: DESPACHO }] }], resumen: { items: 1, correctas: 1, fallidas: 0 } };
const ANTERIOR = { id: 'm0', persona: 'AHORA DAME LA PQT LIMA', frase: '«Paqueteria Lima»: 3 oficinas…', herramientas: ['ejecutar_atajo'], plan: null, version: 3 as const, elegido: false,
  resultados: [{ herramienta: 'ejecutar_atajo', titulo: 'Atajo «Paqueteria Lima»', datos: ATAJO_PAQUETERIA }] };
const SAN_LUIS = 'CIERRA LA FECHA 12-11 DEL CENTRALIZASO DE SAN LUIS';
const cerrar = (agenda: string, codigo: unknown = { ref: 'anterior' }) => JSON.stringify({ pasos: [{ herramienta: 'editar_capacidad', param: { tipo: 'despacho', codigo, fecha: '12-11', activa: false, agenda } }] });

describe('Agendas: el modelo las empareja, el código las comprueba', () => {
  it('las agendas del anterior, con su zona (también las de un atajo)', () => {
    const a = agendasDeDatos('ejecutar_atajo', ATAJO_PAQUETERIA);
    expect(a).toHaveLength(7);
    expect(a[1]).toEqual({ codigo: '1100', tipo: 'despacho', zona: 'Centralizado HUB San Luis', agenda: 'Centralizado HUB San Luis', servicio: 'S' });
  });

  it('el caso de la captura: un nombre que no es ninguno no vale; el modelo ve por qué y elige el exacto; va solo a la 1100, con su zona', async () => {
    const { servicio, editarCapacidad } = armarServicio(ctx(SAN_LUIS, { anterior: ANTERIOR }));
    const t = await servicio.crear(USUARIO, { mensaje: SAN_LUIS, chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('cambio'), modelo: M });
    expect(a.prompt!.mensaje).toContain('AGENDAS QUE CONOZCO (oficina · tipo · zona › agenda · servicio)\n- 1100 · despacho · Centralizado HUB Cedros · S\n- 1100 · despacho · Centralizado HUB San Luis · S');
    expect(a.prompt!.mensaje).toContain('- 1007 · despacho · Zona 1007 - Sector Zona Lejana › Agenda 1007 - Sector Zona Lejana · S');

    // Lo que hizo el modelo aquella vez: otro modelo, y el prompt dice por qué no valió
    const otra = await servicio.armado(USUARIO, t.turno_id, { salida: cerrar('centralizado de San Luis'), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    expect(otra.camino).toBe('armar');
    expect(otra.prompt!.mensaje).toContain('TU PLAN ANTERIOR NO VALIÓ: paso 1: «centralizado de San Luis» no es ninguna de las agendas de 1100, 1007, 1008 (son: Centralizado HUB Cedros, Centralizado HUB San Luis,');

    const e = await servicio.armado(USUARIO, t.turno_id, { salida: cerrar('Centralizado HUB San Luis'), modelo: { cuenta: otra.modelo!.cuenta, nombre: otra.modelo!.nombre } });
    expect(e.camino).toBe('ejecutar');
    const r = await hastaElFinal(servicio, t.turno_id);
    expect(editarCapacidad.editarCapacidad).toHaveBeenCalledTimes(1);
    expect(editarCapacidad.editarCapacidad).toHaveBeenCalledWith(USUARIO, expect.objectContaining({ codigo: '1100', zona: 'Centralizado HUB San Luis', agenda: 'Centralizado HUB San Luis', fecha: '2026-11-12', activa: false }));
    expect((r.respuesta!.resultados[0].datos as { notas: string[] }).notas).toEqual(['agenda: Centralizado HUB San Luis; sin ella: 1007, 1008']);
    // (El doble de la edición contesta siempre EDICION.) A qué se aplicaría, en la frase; el día como en el panel
    expect(r.respuesta!.frase).toMatch(/^Así quedaría: cambiaría 1 de 2 \(agenda: Centralizado HUB San Luis; sin ella: 1007, 1008\); 1 ya estaba así\. No apliqué nada/);
    expect(r.respuesta!.markdown).toContain('| 1100 · Lima metropolitana · Centralizado HUB Surquillo | 08/11 |');
    // La zona no se repite si se llama como la agenda
    expect(filasDelCambio('editar_capacidad', { oficinas: [{ oficina: '1100', agendas: [{ agenda: 'Centralizado HUB San Luis', zona: 'Centralizado HUB San Luis', dias: [{ fecha: MANANA, antes: null, despues: null }] }, { agenda: 'Agenda 1007', zona: 'Zona 1007', dias: [{ fecha: MANANA, antes: null, despues: null }] }] }] }).map((f) => f.donde))
      .toEqual(['1100 · Centralizado HUB San Luis', '1100 · Agenda 1007 (Zona 1007)']);
  });

  it('sin nada que la conozca: el backend busca las agendas de esas oficinas (solo leer) y Armar vuelve a elegir, viéndolas', async () => {
    const m = 'cierra el centralizaso de san luis de la 1100 mañana';
    const { servicio, capacidad, editarCapacidad } = armarServicio(ctx(m), { capacidadDatos: DESPACHO });
    const t = await servicio.crear(USUARIO, { mensaje: m, chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('cambio'), modelo: M });
    expect(a.prompt!.mensaje).not.toContain('AGENDAS QUE CONOZCO');
    const b = await servicio.armado(USUARIO, t.turno_id, { salida: cerrar('centralizaso de san luis', ['1100']), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    expect(capacidad.consultar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'despacho', codigo: '1100', dias: 1 }));
    expect(editarCapacidad.editarCapacidad).not.toHaveBeenCalled();
    expect(b.camino).toBe('armar');
    expect(b.prompt!.mensaje).toContain('- 1100 · despacho · Centralizado HUB San Luis · S');
    const e = await servicio.armado(USUARIO, t.turno_id, { salida: cerrar('Centralizado HUB San Luis', ['1100']), modelo: { cuenta: b.modelo!.cuenta, nombre: b.modelo!.nombre } });
    expect(e.camino).toBe('ejecutar');
    await hastaElFinal(servicio, t.turno_id);
    expect(editarCapacidad.editarCapacidad).toHaveBeenCalledWith(USUARIO, expect.objectContaining({ codigo: '1100', zona: 'Centralizado HUB San Luis', agenda: 'Centralizado HUB San Luis' }));
  });

  it('"los centralizados": la parte común vale, y cada uno va con su zona exacta', () => {
    const c = ctx('cierra los centralizados', { anterior: ANTERIOR });
    expect(leerPlan(cerrar('Centralizado'), c, 'cierra los centralizados', true)).toMatchObject({ ok: true });
  });

  it('el error de una edición, en claro', () => {
    expect(enClaro('No se cambió nada de lo 3 pedido. Motivos: Hay 5 opciones · No encontré la agenda')).toBe('Hay 5 opciones; No encontré la agenda');
  });
});

describe('"dame el picking RT de las tiendas del fase 1": el plan de Armar', () => {
  it('ve los servicios con su fase, y vale la búsqueda masiva de RT + su picking RT (ref al paso 1)', () => {
    const m = 'dame el picking RT de las tiendas del fase 1';
    const c = ctx(m, { servicios: [
      { codigo: 'RE', nombre: 'Retiro en Tienda Express', metodo_entrega: 'RT', fase: 'F1' },
      { codigo: 'RT', nombre: 'Retiro en Tienda', metodo_entrega: 'RT', fase: 'F1' },
      { codigo: 'SE', nombre: 'Site to Store Express', metodo_entrega: 'RT', fase: 'F2' },
    ] });
    expect(promptArmar(m, c, { tipo: 'consulta', dep: false, atajo: null, motivo: '' }).mensaje).toContain('- RT · Retiro en Tienda · retiro en tienda · fase F1');
    const plan = { pasos: [
      { herramienta: 'busqueda_masiva', param: { servicio: ['RT'] } },
      { herramienta: 'consultar_capacidad', param: { tipo: 'picking', codigo: { ref: 'paso', n: 1 }, servicio: ['RT'] } },
    ] };
    expect(leerPlan(JSON.stringify(plan), c, m)).toMatchObject({ ok: true, valor: { plan: { origen: 'armar', pasos: [{ herramienta: 'busqueda_masiva', param: { servicio: ['RT'] } }, { herramienta: 'consultar_capacidad', param: { tipo: 'picking', codigo: { ref: 'paso', n: 1 }, servicio: ['RT'] } }] } } });
  });
});
