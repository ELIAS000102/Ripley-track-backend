import { describe, expect, it, vi } from 'vitest';
import { AgenteV3Service } from '../../src/agente-v3/agente-v3.service.js';
import { AprendizajeService } from '../../src/agente-v3/aprender/aprendizaje.service.js';
import { hechoEnPalabras, leerAprendido } from '../../src/agente-v3/aprender/prompt.js';
import { leerPlan } from '../../src/agente-v3/armar/leer.js';
import { promptArmar } from '../../src/agente-v3/armar/prompt.js';
import { promptClasificar } from '../../src/agente-v3/clasificar/prompt.js';
import { EjecucionV3Service } from '../../src/agente-v3/ejecucion.service.js';
import type { ContextoTurno, Hecho, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';

/**
 * "Dame las tiendas con un solo flujo de picking" (2026-11-08): Armar no tenía
 * cómo listar todas las tiendas y cambió la pregunta por una búsqueda masiva.
 * Ahora: listar_oficinas, la regla "no cambies la pregunta" (si no entiende
 * una palabra, pregunta) y aprender palabras de la operación.
 */

const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };
const M = { cuenta: 1, nombre: 'gemini-3.5-flash-lite' };
const MENSAJE = 'dame las tiendas con un solo flujo de picking';
const HOY = '2026-11-08';

const CTX: ContextoTurno = {
  hoy: HOY, pais: 'PE', motivo_pais: '', anterior: null, aclaraciones: [], pregunta: null, rondas: 0, atajos: [], entidades: [], almacenes: [],
  servicios: [{ codigo: 'RT', nombre: null, metodo_entrega: 'RT', fase: 'F1' }],
};

const TIENDAS = [
  { codigo: '20021', nombre: 'Ripley Chorrillos', tipo: 'tienda', es_cd: false, pais: 'PE', fuente: 'ripley' },
  { codigo: '20048', nombre: 'Ripley Breña', tipo: 'tienda', es_cd: false, pais: 'PE', fuente: 'ripley' },
];
const dia = (asignado: number) => ({ fecha: HOY, activo: true, asignado, ocupado: 0, disponible: asignado, uso: 0 });
const PICKING = { tipo: 'picking', pais: 'PE', desde: HOY, sinDatos: [], oficinas: [
  { oficina: '20021 - Ripley Chorrillos', agendas: [{ agenda: 'Picking RT', servicio: 'RT', unidad: null, dias: [dia(100)] }] },
  { oficina: '20048 - Ripley Breña', agendas: [{ agenda: 'Picking RT', servicio: 'RT', unidad: null, dias: [dia(100)] }, { agenda: 'Picking ST', servicio: 'ST', unidad: null, dias: [dia(80)] }] },
] };
const PLAN = { pasos: [
  { herramienta: 'listar_oficinas', param: { tipo: 'tienda' } },
  { herramienta: 'consultar_capacidad', param: { tipo: 'picking', codigo: { ref: 'paso', n: 1 } }, condicion: { campo: 'jornadas', op: '=', valor: 1 } },
] };

/** Un Supabase de mentira: cada tabla con sus filas; lo que se escribe se anota */
function supabaseDe(tablas: Record<string, unknown[]>, faltan: string[] = []) {
  const escrito: Array<{ tabla: string; valor: unknown }> = [];
  const from = (tabla: string) => {
    let respuesta: { data?: unknown; error: unknown } = faltan.includes(tabla) ? { data: null, error: { code: '42P01', message: `relation "${tabla}" does not exist` } } : { data: tablas[tabla] ?? [], error: null };
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      upsert: (v: unknown) => { if (!faltan.includes(tabla)) escrito.push({ tabla, valor: v }); else respuesta = { error: respuesta.error }; return q; },
      // A propósito: la consulta de Supabase también se espera con await
      // oxlint-disable-next-line unicorn/no-thenable
      then: (ok: (r: unknown) => unknown) => Promise.resolve(respuesta).then(ok),
    };
    return q;
  };
  return { supabase: { admin: { from: vi.fn(from), rpc: vi.fn(async () => ({ data: 'm-1', error: null })) } }, escrito };
}

function armar(contexto: ContextoTurno = CTX) {
  const filas = new Map<string, Turno>();
  const turnos = {
    crear: vi.fn(async (d: Partial<Turno>) => {
      const t = { id: '00000000-0000-4000-8000-000000000001', etapa: 'clasificar', estado: 'en_curso', contexto: null, clasificacion: null, plan: null, pasos: [], modelos: [], respuesta: null, mensaje_id: null, creado_en: new Date().toISOString(), ...d } as Turno;
      filas.set(t.id, t);
      return { ...t };
    }),
    obtener: vi.fn(async (id: string) => structuredClone(filas.get(id)!)),
    actualizar: vi.fn(async (id: string, c: Partial<Turno>) => { filas.set(id, { ...filas.get(id)!, ...structuredClone(c) }); }),
  };
  const ctxServ = { comprobarChat: vi.fn(async () => undefined), armar: vi.fn(async () => structuredClone(contexto)), olvidarDirectorio: vi.fn() };
  const { supabase } = supabaseDe({ agente_entidades: TIENDAS });
  const capacidad = { consultar: vi.fn(async () => structuredClone(PICKING)) };
  const ejecucion = new EjecucionV3Service(supabase as never, {} as never, {} as never, capacidad as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const aprendizaje = {
    sabido: vi.fn(async () => []), fases: vi.fn(async () => []),
    revisar: vi.fn(async () => ({ choques: [], intocables: [] })),
    guardar: vi.fn(async (h: Hecho[]) => ({ guardados: h.map((x) => `«${x.codigo}»`), omitidos: [] })),
  };
  const servicio = new AgenteV3Service(turnos as never, ctxServ as never, ejecucion, { registrar: vi.fn(), estaInterrumpida: () => false } as never, supabase as never, aprendizaje as never);
  return { servicio, capacidad, aprendizaje, filas };
}

const clasif = (tipo: string) => JSON.stringify({ tipo, depende_del_anterior: false, atajo: '(ninguno)', motivo: '' });
async function hastaElFinal(servicio: AgenteV3Service, id: string) {
  let r = await servicio.ejecutar(USUARIO, id);
  for (let i = 0; i < 6 && r.camino === 'avisar'; i++) r = await servicio.ejecutar(USUARIO, id);
  return r;
}

describe('"Las tiendas con un solo flujo de picking": su propio plan', () => {
  it('Armar puede listar las tiendas, y no cambiar la pregunta', () => {
    const p = promptArmar(MENSAJE, CTX, { tipo: 'consulta', dep: false, atajo: null, motivo: '' });
    expect(p.sistema).toContain('- listar_oficinas:');
    expect(p.sistema).toContain('NO CAMBIES LA PREGUNTA');
    // listar_oficinas es leer el directorio: lo mismo que "¿qué tiendas conoces?"
    expect(leerPlan(JSON.stringify(PLAN), CTX, MENSAJE)).toMatchObject({ ok: true, valor: { plan: { pasos: [{ herramienta: 'saber_entidades', param: { tipo: 'tienda' } }, { herramienta: 'consultar_capacidad', condicion: { campo: 'jornadas', valor: 1 } }] } } });
    expect(leerPlan(JSON.stringify({ pasos: [{ herramienta: 'listar_oficinas', param: { tipo: 'cd' } }] }), CTX, 'los cds')).toMatchObject({ ok: true, valor: { plan: { pasos: [{ param: { tipo: 'almacen', es_cd: true } }] } } });
  });

  it('de punta a punta: las tiendas del directorio → su picking → las de una sola jornada', async () => {
    const { servicio, capacidad } = armar();
    const t = await servicio.crear(USUARIO, { mensaje: MENSAJE, chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('consulta'), modelo: M });
    await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify(PLAN), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    const r = await hastaElFinal(servicio, t.turno_id);
    expect(capacidad.consultar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'picking', codigo: '20021,20048' }));
    expect(r.respuesta!.frase).toMatch(/^1 de 2 con 1 jornada: 20021/);
  });
});

describe('Aprender palabras de la operación', () => {
  it('se lee y se escribe en limpio', () => {
    const m = 'un flujo de picking es una jornada de picking';
    expect(leerAprendido(JSON.stringify({ hechos: [{ tipo: 'termino', termino: 'El flujo de picking', significa: 'una jornada de picking' }] }), CTX, m))
      .toEqual({ ok: true, valor: { hechos: [{ tipo: 'termino', pais: 'PE', codigo: 'flujo de picking', significa: 'una jornada de picking' }], dudas: [] } });
    expect(leerAprendido(JSON.stringify({ hechos: [{ tipo: 'termino', termino: 'flujo' }] }), CTX, m)).toMatchObject({ ok: false, motivo: 'hecho 1: «flujo» sin lo que significa' });
    expect(hechoEnPalabras({ tipo: 'termino', pais: 'PE', codigo: 'pqt', significa: 'paquetería' })).toBe('«pqt»: paquetería.');
    // Tras una aclaración, no sacar nada no es un fallo
    expect(leerAprendido('{"hechos": [], "dudas": []}', CTX, 'la 20048', true)).toEqual({ ok: true, valor: { hechos: [], dudas: [] } });
  });

  it('se guarda en agente_vocabulario; lo que había, se avisa; sin la tabla, se dice que falta el sql/03', async () => {
    const termino: Hecho = { tipo: 'termino', pais: 'PE', codigo: 'flujo de picking', significa: 'una jornada de picking' };
    const { supabase, escrito } = supabaseDe({ agente_vocabulario: [{ termino: 'flujo de picking', significa: 'un turno', fuente: 'usuario' }] });
    const s = new AprendizajeService(supabase as never);
    expect(await s.revisar([termino])).toEqual({ choques: ['Tenía «flujo de picking» como «un turno»; pasaría a «una jornada de picking».'], intocables: [] });
    expect(await s.guardar([termino], 'jhumanim8@ripley.com.pe')).toEqual({ guardados: ['«flujo de picking»'], omitidos: [] });
    expect(escrito).toEqual([{ tabla: 'agente_vocabulario', valor: expect.objectContaining({ pais: 'PE', termino: 'flujo de picking', significa: 'una jornada de picking', fuente: 'usuario', ensenado_por: 'jhumanim8@ripley.com.pe' }) }]);

    const sin = supabaseDe({}, ['agente_vocabulario']);
    expect(await new AprendizajeService(sin.supabase as never).guardar([termino], 'x')).toEqual({ guardados: [], omitidos: ['«flujo de picking» (falta correr agente-v3/sql/03)'] });
  });

  it('lo aprendido entra en los prompts de Clasificar y Armar', () => {
    const c = { ...CTX, vocabulario: [{ termino: 'flujo de picking', significa: 'una jornada de picking' }] };
    const linea = 'PALABRAS QUE ENSEÑÓ EL EQUIPO (valen como el vocabulario)\n- «flujo de picking»: una jornada de picking';
    expect(promptClasificar(MENSAJE, c).mensaje).toContain(linea);
    expect(promptArmar(MENSAJE, c, null).mensaje).toContain(linea);
    expect(promptClasificar(MENSAJE, CTX).mensaje).not.toContain('PALABRAS QUE ENSEÑÓ');
  });

  it('Armar pregunta qué es una palabra; la persona lo explica; responde y al final ofrece guardarlo', async () => {
    const { servicio, aprendizaje } = armar();
    const t = await servicio.crear(USUARIO, { mensaje: MENSAJE, chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('consulta'), modelo: M });
    const p = await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify({ pasos: [], faltan: ['¿Qué es un flujo de picking?'] }), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    expect(p.camino).toBe('preguntar');
    const b = await servicio.respuesta(USUARIO, t.turno_id, { texto: 'un flujo es una jornada de picking' });
    expect(b.camino).toBe('armar');
    await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify(PLAN), modelo: { cuenta: b.modelo!.cuenta, nombre: b.modelo!.nombre } });
    const fin = await hastaElFinal(servicio, t.turno_id);
    expect(fin.camino).toBe('aprender');
    expect(fin.prompt!.mensaje).toContain('LO QUE ACLARÓ LA PERSONA\n- un flujo es una jornada de picking');
    const q = await servicio.aprendido(USUARIO, t.turno_id, { salida: JSON.stringify({ hechos: [{ tipo: 'termino', termino: 'flujo de picking', significa: 'una jornada de picking' }] }), modelo: { cuenta: fin.modelo!.cuenta, nombre: fin.modelo!.nombre } });
    expect(q.camino).toBe('preguntar');
    expect(q.pregunta!.resultados).toHaveLength(2);
    expect(q.pregunta!.dudas![0].pregunta).toContain('• «flujo de picking»: una jornada de picking.');
    const r = await servicio.respuesta(USUARIO, t.turno_id, { respuestas: { aprender: 'si' } });
    expect(aprendizaje.guardar).toHaveBeenCalledWith([expect.objectContaining({ tipo: 'termino', codigo: 'flujo de picking' })], USUARIO.email);
    expect(r.respuesta!.notas).toContain('Guardado para todos: «flujo de picking». Ya lo uso desde el próximo mensaje.');
  });

  it('…y si lo que contestó no enseña nada ("la 20048"), responde sin preguntar', async () => {
    const { servicio, aprendizaje } = armar();
    const t = await servicio.crear(USUARIO, { mensaje: MENSAJE, chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('consulta'), modelo: M });
    await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify({ pasos: [], faltan: ['¿De qué tiendas?'] }), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    const b = await servicio.respuesta(USUARIO, t.turno_id, { texto: 'de todas las de Lima' });
    await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify(PLAN), modelo: { cuenta: b.modelo!.cuenta, nombre: b.modelo!.nombre } });
    const fin = await hastaElFinal(servicio, t.turno_id);
    const r = await servicio.aprendido(USUARIO, t.turno_id, { salida: '{"hechos": [], "dudas": []}', modelo: { cuenta: fin.modelo!.cuenta, nombre: fin.modelo!.nombre } });
    expect(r.camino).toBe('responder');
    expect(r.respuesta!.frase).toMatch(/^1 de 2 con 1 jornada/);
    expect(aprendizaje.revisar).not.toHaveBeenCalled();
  });
});
