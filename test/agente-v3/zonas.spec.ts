import { describe, expect, it, vi } from 'vitest';
import { AgenteV3Service, repiteMotivo, serviciosSinDatos } from '../../src/agente-v3/agente-v3.service.js';
import { leerPlan, serviciosSinUsar } from '../../src/agente-v3/armar/leer.js';
import { promptClasificar } from '../../src/agente-v3/clasificar/prompt.js';
import { EjecucionV3Service } from '../../src/agente-v3/ejecucion.service.js';
import type { ContextoTurno, IntentoModelo, MensajeAnterior, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';

/**
 * Las pruebas del 2026-11-09: "cierra la fecha 11-11 para los tres" (las
 * agendas que se vieron), la zona preguntada con opciones, comprobar no es
 * cambiar, no dejar fuera lo nombrado, el cálculo sin sus datos y "¿de otra
 * forma?" como petición nueva.
 */

const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };
const M = { cuenta: 1, nombre: 'gemini-3.5-flash-lite' };
const HOY = '2026-11-09';
const dia = (fecha: string) => ({ fecha, activo: true, asignado: 50, ocupado: 0, disponible: 50, uso: 0 });
const ag = (zona: string, agenda: string) => ({ agenda, zona, servicio: 'S', unidad: null, dias: [dia(HOY)] });

/** Lo que enseñó el atajo «Big Ticket Lima»: UNA agenda de cada OPL (cada una tiene dos zonas) */
const BIG_TICKET = { atajo: 'Big Ticket Lima', resumen: { items: 3, correctas: 3, fallidas: 0 }, bloques: [{ orden: 1, tipo: 'despacho', nota: null, items: [
  { resultado: { tipo: 'despacho', oficinas: [{ oficina: '1401', agendas: [ag('Zona 1401 - Suc. Aldea 6 Lima/Metropolitana', 'Agenda 1401 - Suc. Aldea 6 Lima/Metropolitana')] }] } },
  { resultado: { tipo: 'despacho', oficinas: [{ oficina: '1402', agendas: [ag('Zona 1402 - Suc. Aldea 6 Perif.', 'Agenda 1402 - Suc. Aldea 6 Perif.')] }] } },
  { resultado: { tipo: 'despacho', oficinas: [{ oficina: '1403', agendas: [ag('Zona BT Playas', 'Zona BT Playas')] }] } },
] }] };
const ANTERIOR: MensajeAnterior = { id: 'm0', persona: 'dame el bt lima', frase: '«Big Ticket Lima»: 3 oficinas…', herramientas: ['ejecutar_atajo'], plan: null, version: 3, elegido: false,
  resultados: [{ herramienta: 'ejecutar_atajo', titulo: 'Atajo «Big Ticket Lima»', datos: BIG_TICKET }] };

/** El despacho de las OPL completo: dos zonas cada una */
const DESPACHO = { tipo: 'despacho', pais: 'PE', desde: HOY, sinDatos: [], oficinas: [
  { oficina: '1401', agendas: [ag('Zona 1401 - Suc. Aldea 6 Lima/Metropolitana', 'Agenda A'), ag('Zona 1401 - Suc. Aldea 6 Lima/Metropolitana BT', 'Agenda B')] },
  { oficina: '1402', agendas: [ag('Zona 1402 - Suc. Aldea 6 Perif.', 'Agenda C'), ag('Zona 1402 - Suc. Aldea 6 Perif. BT', 'Agenda D')] },
] };

const ctx = (extra: Partial<ContextoTurno> = {}): ContextoTurno => ({
  hoy: HOY, pais: 'PE', motivo_pais: '', anterior: null, aclaraciones: [], pregunta: null, rondas: 0, atajos: [], entidades: [], almacenes: [],
  servicios: ['RT', 'RE', 'SE', 'ST', 'S'].map((codigo) => ({ codigo, nombre: null, metodo_entrega: null, fase: null })),
  ...extra,
});

function armar(contexto: ContextoTurno) {
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
  const ctxServ = { comprobarChat: vi.fn(async () => undefined), armar: vi.fn(async () => structuredClone(contexto)), rebuscar: vi.fn(async () => []) };
  const supabase = { admin: { rpc: vi.fn(async () => ({ data: 'm-1', error: null })) } };
  const capacidad = { consultar: vi.fn(async () => structuredClone(DESPACHO)) };
  const masivo = { buscar: vi.fn(async (_u: unknown, dto: { servicio: string }) => ({ servicio: dto.servicio, agendas: [{ opl: '20021 - Ripley Chorrillos', agenda: `Agenda ${dto.servicio}`, activa: false, enCheckout: false }] })) };
  let simulacro = false;
  const auditoria = { activarSimulacro: vi.fn(() => { simulacro = true; }), enSimulacro: vi.fn(() => simulacro) };
  const editarCapacidad = { editarCapacidad: vi.fn(async (_u: unknown, dto: { codigo: string; zona?: string; agenda?: string }) => ({
    tipo: 'despacho',
    oficinas: dto.codigo.split(',').map((c) => ({ oficina: c, agendas: [{ agenda: dto.agenda ?? dto.zona ?? '?', zona: dto.zona, dias: [{ fecha: '2026-11-11', antes: dia('2026-11-11'), despues: { ...dia('2026-11-11'), activo: false } }] }] })),
    resumen: { pedidos: 1, cambiados: 1, sinCambiar: 0 },
  })) };
  const ejecucion = new EjecucionV3Service(supabase as never, {} as never, {} as never, capacidad as never, {} as never, {} as never, {} as never, masivo as never, {} as never,
    auditoria as never, editarCapacidad as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const servicio = new AgenteV3Service(turnos as never, ctxServ as never, ejecucion, { registrar: vi.fn(), estaInterrumpida: () => false } as never, supabase as never, {} as never);
  return { servicio, capacidad, editarCapacidad, masivo, filas };
}

const clasif = (tipo: string, extra: Record<string, unknown> = {}) => JSON.stringify({ tipo, depende_del_anterior: false, atajo: '(ninguno)', motivo: '', ...extra });
const cerrar = (codigo: unknown) => JSON.stringify({ pasos: [{ herramienta: 'editar_capacidad', param: { tipo: 'despacho', codigo, fecha: '11-11', activa: false } }] });

async function hastaArmar(servicio: AgenteV3Service, mensaje: string, tipo = 'cambio') {
  const t = await servicio.crear(USUARIO, { mensaje, chat_id: 'c' });
  const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif(tipo), modelo: M });
  return { t, a };
}

describe('"Cierra la fecha 11-11 para los tres": las agendas que se vieron', () => {
  it('cada OPL con su zona y su agenda exactas, sin preguntar', async () => {
    const { servicio, editarCapacidad } = armar(ctx({ anterior: ANTERIOR }));
    const { t, a } = await hastaArmar(servicio, 'cierra la fecha 11-11 para los tres');
    await servicio.armado(USUARIO, t.turno_id, { salida: cerrar({ ref: 'anterior' }), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    let r = await servicio.ejecutar(USUARIO, t.turno_id);
    for (let i = 0; i < 4 && r.camino === 'avisar'; i++) r = await servicio.ejecutar(USUARIO, t.turno_id);
    expect(r.camino).toBe('responder');
    expect(editarCapacidad.editarCapacidad.mock.calls.map(([, d]) => [d.codigo, d.zona, d.agenda])).toEqual([
      ['1401', 'Zona 1401 - Suc. Aldea 6 Lima/Metropolitana', 'Agenda 1401 - Suc. Aldea 6 Lima/Metropolitana'],
      ['1402', 'Zona 1402 - Suc. Aldea 6 Perif.', 'Agenda 1402 - Suc. Aldea 6 Perif.'],
      ['1403', 'Zona BT Playas', 'Zona BT Playas'],
    ]);
    expect(r.respuesta!.frase).toMatch(/^Así quedaría: cambiarían 3 de 3 \(las agendas que se vieron \(3\)\)/);
  });
});

describe('Varias zonas y no sabe cuál: pregunta con opciones y sigue en el mismo paso', () => {
  it('una duda por OPL con sus zonas y "todas"; con la elección, cada una a su zona', async () => {
    const { servicio, editarCapacidad, capacidad } = armar(ctx());
    const { t, a } = await hastaArmar(servicio, 'cierra el despacho de la 1401 y la 1402 el 11-11');
    await servicio.armado(USUARIO, t.turno_id, { salida: cerrar(['1401', '1402']), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    const anuncio = await servicio.ejecutar(USUARIO, t.turno_id);
    expect(anuncio.camino).toBe('avisar');
    const p = await servicio.ejecutar(USUARIO, t.turno_id);
    expect(capacidad.consultar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'despacho', codigo: '1401,1402', dias: 1 }));
    expect(editarCapacidad.editarCapacidad).not.toHaveBeenCalled();
    expect(p.camino).toBe('preguntar');
    expect(p.pregunta!.dudas!.map((d) => [d.id, d.opciones.map((o) => o.id)])).toEqual([
      ['zona:1:1401', ['Zona 1401 - Suc. Aldea 6 Lima/Metropolitana', 'Zona 1401 - Suc. Aldea 6 Lima/Metropolitana BT', 'todas']],
      ['zona:1:1402', ['Zona 1402 - Suc. Aldea 6 Perif.', 'Zona 1402 - Suc. Aldea 6 Perif. BT', 'todas']],
    ]);
    // Contesta: la ejecución sigue en el mismo paso (camino "ejecutar"), sin volver a preguntar
    const s = await servicio.respuesta(USUARIO, t.turno_id, { respuestas: { 'zona:1:1401': 'Zona 1401 - Suc. Aldea 6 Lima/Metropolitana BT', 'zona:1:1402': 'todas' } });
    expect(s.camino).toBe('ejecutar');
    const r = await servicio.ejecutar(USUARIO, t.turno_id);
    expect(r.camino).toBe('responder');
    expect(editarCapacidad.editarCapacidad.mock.calls.map(([, d]) => [d.codigo, d.zona])).toEqual([
      ['1401', 'Zona 1401 - Suc. Aldea 6 Lima/Metropolitana BT'],
      ['1402', 'todas'],
    ]);
  });

  it('a medias no vale: se vuelve a preguntar', async () => {
    const { servicio } = armar(ctx());
    const { t, a } = await hastaArmar(servicio, 'cierra el despacho de la 1401 y la 1402 el 11-11');
    await servicio.armado(USUARIO, t.turno_id, { salida: cerrar(['1401', '1402']), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    await servicio.ejecutar(USUARIO, t.turno_id);
    await servicio.ejecutar(USUARIO, t.turno_id);
    const otra = await servicio.respuesta(USUARIO, t.turno_id, { respuestas: { 'zona:1:1401': 'todas' } });
    expect(otra.camino).toBe('preguntar');
  });
});

describe('Comprobar no es cambiar, y no repetir el mismo fallo', () => {
  it('Clasificar lo sabe; y si dijo "cambio" pero Armar armó una consulta, vale como consulta', async () => {
    expect(promptClasificar('x', ctx()).sistema).toContain('"fíjate que estén / se mantengan inactivas", "verifica", "comprueba", "¿están todas activas?" NO es cambio');
    const m = 'fijate que las sucursales de la RE se mantengan inactivas';
    const { servicio, filas } = armar(ctx());
    const { t, a } = await hastaArmar(servicio, m);
    const e = await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify({ pasos: [{ herramienta: 'busqueda_masiva', param: { servicio: ['RE'] }, comprobar: { campo: 'activa', op: '=', valor: false, cuantos: 'todos' } }] }), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    expect(e.camino).toBe('ejecutar');
    expect(filas.get(t.turno_id)!.clasificacion!.tipo).toBe('consulta');
    expect(filas.get(t.turno_id)!.plan!.origen).toBe('armar');
  });

  it('el mismo motivo dos veces seguidas: no se pide un tercer modelo, se pregunta', async () => {
    const intento = (motivo: string): IntentoModelo => ({ rol: 'armar', cuenta: 1, nombre: 'x', ok: false, clase: 'respuesta', motivo });
    expect(repiteMotivo([intento('a'), intento('a')], 'armar')).toBe(true);
    expect(repiteMotivo([intento('a'), intento('b')], 'armar')).toBe(false);
    const { servicio, filas } = armar(ctx());
    const { t, a } = await hastaArmar(servicio, 'el picking de la 20030', 'consulta');
    const malo = JSON.stringify({ pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'picking', codigo: ['20031'] } }] });
    const b = await servicio.armado(USUARIO, t.turno_id, { salida: malo, modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    const c = await servicio.armado(USUARIO, t.turno_id, { salida: malo, modelo: { cuenta: b.modelo!.cuenta, nombre: b.modelo!.nombre } });
    expect(c.camino).toBe('preguntar');
    expect(filas.get(t.turno_id)!.modelos.filter((x) => x.rol === 'armar')).toHaveLength(2);
  });
});

describe('No dejar fuera lo que se nombra', () => {
  const m = 'solo detállame qué sucursales están activas e inactivas de la RT y RE';
  it('"la RT y RE" con un plan solo de la RT no vale; con las dos, sí', () => {
    const solo = JSON.stringify({ pasos: [{ herramienta: 'busqueda_masiva', param: { servicio: ['RT'] } }] });
    expect(leerPlan(solo, ctx(), m)).toEqual({ ok: false, motivo: 'el mensaje nombra RE y el plan no lo usa: pon todo lo que pide' });
    expect(leerPlan(JSON.stringify({ pasos: [{ herramienta: 'busqueda_masiva', param: { servicio: ['RT', 'RE'] } }] }), ctx(), m)).toMatchObject({ ok: true });
  });
  it('un atajo que la lleva en su nombre cuenta; un paso sin servicio (el reporte de CDs) no obliga', () => {
    const c = ctx({ atajos: [{ nombre: 'OPLS de la SE', descripcion: null, tipos: ['masivo'], pais: 'PE' }] });
    expect(serviciosSinUsar([{ herramienta: 'ejecutar_atajo', param: { nombre: 'OPLS de la SE' } }, { herramienta: 'consultar_transferencia', param: {} }], 'la transferencia de los OPL de la SE', c)).toEqual([]);
    expect(serviciosSinUsar([{ herramienta: 'consultar_reporte_cds', param: { cd: '20026' } }], 'cómo va la ST del 20026', c)).toEqual([]);
  });
});

describe('Un cálculo sin sus datos pasa a consulta (y se avisa)', () => {
  const SOLO_RT: MensajeAnterior = { id: 'm1', persona: 'la RT', frase: 'RT…', herramientas: ['busqueda_masiva'], plan: null, version: 3, elegido: false,
    resultados: [{ herramienta: 'busqueda_masiva', titulo: 'Búsqueda masiva de RT', datos: { servicio: 'RT', agendas: [{ opl: '20021 - Ripley Chorrillos', agenda: 'A', activa: true, enCheckout: true }] } }] };
  it('"cuántas activas en la RE" sobre lo que solo traía la RT: Armar, no Calcular', async () => {
    expect(serviciosSinDatos('Y cuadro cuantas sucursales estan activas en la RE', ctx({ anterior: SOLO_RT }))).toEqual(['RE']);
    expect(serviciosSinDatos('y de la RT cuantas', ctx({ anterior: SOLO_RT }))).toEqual([]);
    const { servicio, filas } = armar(ctx({ anterior: SOLO_RT }));
    const { t, a } = await hastaArmar(servicio, 'Y cuadro cuantas sucursales estan activas e inactivas en la RE', 'calculo');
    expect(a.camino).toBe('armar');
    expect(filas.get(t.turno_id)!.clasificacion!.tipo).toBe('consulta');
    await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify({ pasos: [{ herramienta: 'busqueda_masiva', param: { servicio: ['RE'] } }], ver: 'totales' }), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    let r = await servicio.ejecutar(USUARIO, t.turno_id);
    for (let i = 0; i < 4 && r.camino === 'avisar'; i++) r = await servicio.ejecutar(USUARIO, t.turno_id);
    expect(r.respuesta!.avisos).toContain('RE no estaba en lo que traje antes: lo consulté.');
  });
});
