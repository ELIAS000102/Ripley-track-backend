import { describe, expect, it, vi } from 'vitest';
import { AgenteV3Service, atajoPorNombre } from '../../src/agente-v3/agente-v3.service.js';
import { EjecucionV3Service } from '../../src/agente-v3/ejecucion.service.js';
import type { ContextoTurno, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';
import { fraseAtajo, markdownAtajo, nombreCorto } from '../../src/agente-v3/respuesta/atajo.js';
import type { Ejecucion } from '../../src/configuracion/atajos/interfaces/atajos.interface.js';

/**
 * Un turno de la v3 de punta a punta, con dobles en lugar de Supabase, Ripley y
 * n8n: lo que contesta cada ruta (`camino`), que lo que dice el modelo se
 * valida y no se arregla, y que la respuesta sale de los datos.
 */

const USUARIO = { id: 'u1', email: 'jose@ripley.com.pe' };
const HOY = '2026-11-07';
const MANANA = '2026-11-08';

const CTX: ContextoTurno = {
  hoy: HOY,
  pais: 'PE',
  motivo_pais: 'un chat nuevo es de Perú',
  atajos: [
    { nombre: 'Simulación SE', descripcion: 'las once tiendas de retiro', tipos: ['simulacion'], pais: 'PE' },
    { nombre: 'Paqueteria Lima', descripcion: 'capacidad de despacho de la PQT LIMA', tipos: ['despacho'], pais: 'PE' },
    { nombre: 'Tiendas RT chile', descripcion: 'picking RT de chile', tipos: ['picking'], pais: 'CL' },
  ],
  anterior: null,
  entidades: [],
  servicios: [],
  aclaraciones: [],
  pregunta: null,
  rondas: 0,
};

const SIMULACION_SE: Ejecucion = {
  atajo: 'Simulación SE',
  bloques: [
    {
      orden: 1, tipo: 'simulacion', accion: 'consultar', nota: null,
      items: [
        { orden: 1, nota: null, resultado: { resultados: [
          { opl: '20066 - Ripley Plaza Lima Norte', destino: 'Lima', servicio: 'SE', entrega: '08/11/2026 00:00', dias: 1 },
          { opl: '20048 - Ripley Breña', destino: 'Lima', servicio: '-', entrega: null },
        ] } },
        { orden: 2, nota: 'Atocongo', error: 'Ripley no respondió' },
      ],
    },
  ],
  resumen: { items: 2, correctas: 1, fallidas: 1 },
};

const dia = (fecha: string, activo: boolean, asignado: number, ocupado: number) => ({ fecha, activo, asignado, ocupado, disponible: asignado - ocupado, uso: asignado > 0 ? Math.round((100 * ocupado) / asignado) : 0 });
const PQT: Ejecucion = {
  atajo: 'Paqueteria Lima',
  bloques: [
    {
      orden: 1, tipo: 'despacho', accion: 'consultar', nota: null,
      items: [{ orden: 1, nota: null, resultado: { tipo: 'despacho', pais: 'PE', desde: HOY, sinDatos: [], oficinas: [
        { oficina: '1100 - Lima metropolitana', agendas: [
          { agenda: 'Centralizado HUB Surquillo', servicio: 'S', unidad: null, dias: [dia(HOY, false, 100, 0), dia(MANANA, true, 100, 100)] },
          { agenda: 'Centralizado HUB Cedros', servicio: 'S', unidad: null, dias: [dia(HOY, false, 100, 0), dia(MANANA, true, -1, 0)] },
        ] },
      ] } }],
    },
  ],
  resumen: { items: 1, correctas: 1, fallidas: 0 },
};

function armar({ ejecucion = SIMULACION_SE, interrumpida = false } = {}) {
  const filas = new Map<string, Turno>();
  let n = 0;
  const turnos = {
    crear: vi.fn(async (d: Partial<Turno>) => {
      const t = { id: `00000000-0000-4000-8000-00000000000${++n}`, etapa: 'clasificar', estado: 'en_curso', contexto: null, clasificacion: null, plan: null, pasos: [], modelos: [], respuesta: null, mensaje_id: null, creado_en: new Date().toISOString(), ...d } as Turno;
      filas.set(t.id, t);
      return { ...t };
    }),
    obtener: vi.fn(async (id: string) => structuredClone(filas.get(id)!)),
    actualizar: vi.fn(async (id: string, c: Partial<Turno>) => { filas.set(id, { ...filas.get(id)!, ...structuredClone(c) }); }),
  };
  const contexto = { comprobarChat: vi.fn(async () => undefined), armar: vi.fn(async () => structuredClone(CTX)) };
  const rpc = vi.fn(async (_funcion: string, _args: { p: Record<string, unknown> }) => ({ data: 'mensaje-1', error: null }));
  const supabase = { admin: { rpc } };
  const porNombre = vi.fn(async (nombre: string) => ({ id: 'a1', nombre }));
  const ejecutar = vi.fn(async () => structuredClone(ejecucion));
  const ejec = new EjecucionV3Service(supabase as never, { porNombre } as never, { ejecutar } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const interrupcion = { registrar: vi.fn(), estaInterrumpida: vi.fn(() => interrumpida) };
  const servicio = new AgenteV3Service(turnos as never, contexto as never, ejec, interrupcion as never, supabase as never);
  return { servicio, filas, turnos, rpc, porNombre, ejecutar, interrupcion };
}

const clasif = (o: Record<string, unknown>) => JSON.stringify({ depende_del_anterior: false, atajo: '(ninguno)', motivo: '', ...o });

describe('Un turno de un atajo, de punta a punta', () => {
  it('turnos → clasificar (con su modelo y su prompt) → ejecutar → responder, y se guarda en la memoria del chat', async () => {
    const { servicio, rpc, porNombre, interrupcion } = armar();
    const t = await servicio.crear(USUARIO, { mensaje: 'simula la se', chat_id: 'chat-1', peticion_id: 'p1', ejecucion: '123' });
    expect(t.camino).toBe('clasificar');
    expect(t.modelo?.nombre).toBe('gemini-3.5-flash-lite');
    expect(t.prompt?.mensaje).toContain('«simula la se»');
    expect(interrupcion.registrar).toHaveBeenCalledWith('p1', 'u1', '123');

    const c = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif({ tipo: 'atajo', atajo: 'Simulación SE' }), modelo: { cuenta: t.modelo!.cuenta, nombre: t.modelo!.nombre } });
    expect(c.camino).toBe('ejecutar');

    const r = await servicio.ejecutar(USUARIO, t.turno_id);
    expect(porNombre).toHaveBeenCalledWith('Simulación SE');
    expect(r.camino).toBe('responder');
    expect(r.respuesta).toMatchObject({ v: 3, tipo: 'resultado', mensaje_id: 'mensaje-1', pais: 'PE' });
    expect(r.respuesta!.frase).toBe('«Simulación SE»: entrega más temprana el 08/11 con SE (1 día), en 1 de 2 simulados (1 sin respuesta).');
    expect(r.respuesta!.resultados).toEqual([expect.objectContaining({ herramienta: 'ejecutar_atajo', atajo: 'Simulación SE', principal: true })]);
    expect(r.respuesta!.markdown).toContain('| 20066 · Plaza Lima Norte | Lima | SE | 08/11 | 1 |');
    expect(r.respuesta!.markdown).toContain('- Atocongo: Ripley no respondió');

    const [funcion, guardado] = rpc.mock.calls[0];
    expect(funcion).toBe('agente_v3_guardar_mensaje');
    expect(guardado.p).toMatchObject({ chat_id: 'chat-1', usuario_id: 'u1', persona: 'simula la se', pais: 'PE', con_contenido: true, plan: { v: 3, origen: 'atajo' } });
  });

  it('una llamada repetida o tardía no rehace nada: contesta lo que ya hay', async () => {
    const { servicio, ejecutar } = armar();
    const t = await servicio.crear(USUARIO, { mensaje: 'simula la se', chat_id: 'chat-1' });
    await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif({ tipo: 'atajo', atajo: 'Simulación SE' }), modelo: { cuenta: 1, nombre: 'gemini-3.5-flash-lite' } });
    const a = await servicio.ejecutar(USUARIO, t.turno_id);
    const b = await servicio.ejecutar(USUARIO, t.turno_id);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    expect(b.respuesta).toEqual(a.respuesta);
  });
});

describe('Lo que dice el modelo se valida; si no vale, otro modelo', () => {
  it('un JSON roto: se anota por qué y se prueba otro modelo con el mismo prompt', async () => {
    const { servicio, filas } = armar();
    const t = await servicio.crear(USUARIO, { mensaje: 'simula la se', chat_id: 'c' });
    const c = await servicio.clasificacion(USUARIO, t.turno_id, { salida: 'Es el atajo de la SE', modelo: { cuenta: t.modelo!.cuenta, nombre: t.modelo!.nombre } });
    expect(c.camino).toBe('clasificar');
    expect(c.modelo).not.toEqual(t.modelo);
    expect(c.prompt).toEqual(t.prompt);
    expect(filas.get(t.turno_id)!.modelos).toEqual([expect.objectContaining({ ok: false, motivo: 'no devolvió un JSON' })]);
  });

  it('un atajo de Chile en un chat de Perú (sin que el mensaje diga Chile) no vale', async () => {
    const { servicio, filas } = armar();
    const t = await servicio.crear(USUARIO, { mensaje: 'dame el picking de las tiendas RT', chat_id: 'c' });
    const c = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif({ tipo: 'atajo', atajo: 'Tiendas RT chile' }), modelo: { cuenta: 1, nombre: 'gemini-3.5-flash-lite' } });
    expect(c.camino).toBe('clasificar');
    expect(filas.get(t.turno_id)!.modelos[0].motivo).toBe('«Tiendas RT chile» es de Chile y el chat está en Perú');
  });

  it('sin ningún modelo que responda: un mensaje que nombra UN atajo se ejecuta igual', async () => {
    const { servicio } = armar();
    const t = await servicio.crear(USUARIO, { mensaje: 'dame la Paqueteria Lima', chat_id: 'c' });
    let r = t;
    for (let i = 0; i < 6 && r.camino === 'clasificar'; i++) {
      r = await servicio.clasificacion(USUARIO, t.turno_id, { error: '503 Service Unavailable: overloaded', modelo: { cuenta: r.modelo!.cuenta, nombre: r.modelo!.nombre } });
    }
    expect(r.camino).toBe('ejecutar');
  });

  it('…y si no nombra ninguno, se dice por qué, sin inventar nada', async () => {
    const { servicio } = armar();
    const t = await servicio.crear(USUARIO, { mensaje: 'cómo va lo de hoy', chat_id: 'c' });
    let r = t;
    for (let i = 0; i < 6 && r.camino === 'clasificar'; i++) {
      r = await servicio.clasificacion(USUARIO, t.turno_id, { error: '429 RESOURCE_EXHAUSTED', modelo: { cuenta: r.modelo!.cuenta, nombre: r.modelo!.nombre } });
    }
    expect(r.camino).toBe('responder');
    expect(r.respuesta!.frase).toMatch(/^No pude entender el mensaje: los modelos no respondieron/);
  });
});

describe('Las consultas van a Armar, y Detener', () => {
  it('una consulta a mano: va a Armar, con su prompt y su modelo', async () => {
    const { servicio, ejecutar } = armar();
    const t = await servicio.crear(USUARIO, { mensaje: 'dame el despacho de la 1401', chat_id: 'c' });
    const r = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif({ tipo: 'consulta' }), modelo: { cuenta: 1, nombre: 'gemini-3.5-flash-lite' } });
    expect(r.camino).toBe('armar');
    expect(r.modelo?.rol).toBe('armar');
    expect(r.prompt?.sistema).toContain('CATÁLOGO DE HERRAMIENTAS');
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it('con "Detener" pulsado, no se ejecuta el paso y la respuesta es "cancelada"', async () => {
    const { servicio, ejecutar } = armar({ interrumpida: true });
    const t = await servicio.crear(USUARIO, { mensaje: 'simula la se', chat_id: 'c', peticion_id: 'p1' });
    await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif({ tipo: 'atajo', atajo: 'Simulación SE' }), modelo: { cuenta: 1, nombre: 'gemini-3.5-flash-lite' } });
    const r = await servicio.ejecutar(USUARIO, t.turno_id);
    expect(ejecutar).not.toHaveBeenCalled();
    expect(r.respuesta!.tipo).toBe('cancelada');
  });
});

describe('La frase y el Markdown de un atajo salen de sus datos', () => {
  it('capacidad: hoy cerradas; mañana sin cupo la que está llena; "sin capacidad" (asignado -1) no es "sin cupo"', () => {
    expect(fraseAtajo(PQT, HOY)).toBe('«Paqueteria Lima»: 1 oficina del 07/11 al 08/11; hoy (07/11) cerradas; sin cupo 1100 · Lima metropolitana (08/11).');
    const md = markdownAtajo(PQT);
    expect(md).toContain('| 1100 · Lima metropolitana | Centralizado HUB Surquillo · S | 100 / 0 / 100 CERRADA | 100 / 100 / 0 |');
    expect(md).toContain('| 1100 · Lima metropolitana | Centralizado HUB Cedros · S | 100 / 0 / 100 CERRADA | sin capacidad |');
  });

  it('un atajo que no trajo nada lo dice', () => {
    const vacio: Ejecucion = { atajo: 'Paqueteria Lima', bloques: [{ ...PQT.bloques[0], items: [{ orden: 1, nota: null, error: 'sin token' }, { orden: 2, nota: null, error: 'sin token' }] }], resumen: { items: 2, correctas: 0, fallidas: 2 } };
    expect(fraseAtajo(vacio, HOY)).toBe('«Paqueteria Lima»: sin datos (2 sin respuesta).');
  });

  it('los nombres: código · nombre, sin "Ripley"', () => {
    expect(nombreCorto('20066 - Ripley Plaza Lima Norte')).toBe('20066 · Plaza Lima Norte');
    expect(nombreCorto('1130')).toBe('1130');
    expect(nombreCorto('Ripley Breña')).toBe('Breña');
  });

  it('el atajo nombrado tal cual en el mensaje (sin modelo): uno solo, y entero', () => {
    const nombres = CTX.atajos.map((a) => a.nombre);
    expect(atajoPorNombre('dame la PAQUETERIA LIMA', nombres)).toBe('Paqueteria Lima');
    expect(atajoPorNombre('simula la se', nombres)).toBeNull();
  });
});
