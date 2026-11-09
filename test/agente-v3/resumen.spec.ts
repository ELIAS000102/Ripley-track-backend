import { describe, expect, it, vi } from 'vitest';
import { seguir } from './ayuda.js';
import { AgenteV3Service, otrosSinDatos } from '../../src/agente-v3/agente-v3.service.js';
import { calcular, fuenteDe, LO_ANTERIOR } from '../../src/agente-v3/calcular/calcular.js';
import { EjecucionV3Service } from '../../src/agente-v3/ejecucion.service.js';
import { filasDe } from '../../src/agente-v3/filas.js';
import type { ContextoTurno, MensajeAnterior, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';
import { vistasDe } from '../../src/agente-v3/presentar/prompt.js';

/**
 * Tras probar Presentar (2026-11-09): "el consumo del bt lima en porcentaje"
 * no es un cálculo sobre lo anterior (se consulta); "un resumen de todo lo
 * activo e inactivo" va por servicio y con el total; y las frases no nombran
 * los pasos por dentro.
 */

const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };
const M = { cuenta: 1, nombre: 'gemini-3.5-flash-lite' };
const agendas = (n: number, activas: number) => Array.from({ length: n }, (_, i) => ({ opl: `${20000 + i} - Ripley T${i}`, agenda: `A${i}`, activa: i < activas, enCheckout: i < activas }));
const RE = { servicio: 'RE', agendas: agendas(30, 0) };
const RT = { servicio: 'RT', agendas: agendas(46, 41) };
const ANTERIOR: MensajeAnterior = { id: 'm0', persona: 'la RE y la RT', frase: '…', herramientas: ['busqueda_masiva'], plan: null, version: 3, elegido: true,
  resultados: [{ herramienta: 'busqueda_masiva', titulo: 'Búsqueda masiva de RE', datos: RE }, { herramienta: 'busqueda_masiva', titulo: 'Búsqueda masiva de RT', datos: RT }] };
const CTX: ContextoTurno = {
  hoy: '2026-11-09', pais: 'PE', motivo_pais: '', anterior: ANTERIOR, aclaraciones: [], pregunta: null, rondas: 0, entidades: [], almacenes: [],
  atajos: [{ nombre: 'Big Ticket Lima', descripcion: 'despacho del BT', tipos: ['despacho'], pais: 'PE' }],
  servicios: ['RT', 'RE'].map((codigo) => ({ codigo, nombre: null, metodo_entrega: 'RT', fase: 'F1' })),
};

function armar() {
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
  const ctxServ = { comprobarChat: vi.fn(async () => undefined), armar: vi.fn(async () => structuredClone(CTX)) };
  const supabase = { admin: { rpc: vi.fn(async () => ({ data: 'm-1', error: null })) } };
  const ejecucion = new EjecucionV3Service(supabase as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const servicio = new AgenteV3Service(turnos as never, ctxServ as never, ejecucion, { registrar: vi.fn(), estaInterrumpida: () => false } as never, supabase as never, {} as never);
  return { servicio, filas };
}

async function hastaCalcular(mensaje: string) {
  const { servicio, filas } = armar();
  const t = await servicio.crear(USUARIO, { mensaje, chat_id: 'c' });
  const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: JSON.stringify({ tipo: 'calculo', depende_del_anterior: true, atajo: '(ninguno)', motivo: '' }), modelo: M });
  return { servicio, filas, t, a };
}

describe('Un cálculo sin sus datos pasa a consulta', () => {
  it('Calcular falla porque falta el dato ("no tiene ocupado"): a Armar, sin "¿de otra forma?", y se avisa', async () => {
    const { servicio, filas, t, a } = await hastaCalcular('dame el consumo en porcentaje');
    expect(a.camino).toBe('calcular');
    const r = await servicio.calculo(USUARIO, t.turno_id, { salida: '{"operacion": "porcentaje", "campo": "uso", "filtro": {}, "agrupar": ["total"]}', modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    expect(r.camino).toBe('armar');
    expect(filas.get(t.turno_id)!.clasificacion!.tipo).toBe('consulta');
    expect(filas.get(t.turno_id)!.contexto!.avisos).toContain('Eso no estaba en lo que traje antes: lo consulté.');
  });

  it('un atajo que no estaba en lo anterior (por su nombre), o un código que no trajo, no se calcula', () => {
    expect(otrosSinDatos('el consumo del big ticket lima en porcentaje', CTX)).toEqual(['«Big Ticket Lima»']);
    expect(otrosSinDatos('y de la RT cuántas', CTX)).toEqual([]);
  });
});

describe('Un resumen de varios servicios: por servicio y con el total', () => {
  it('"un resumen de todo lo activo e inactivo" sobre la RE y la RT', async () => {
    const { servicio, t, a } = await hastaCalcular('dame un resumen de todo lo que esta activo e inactivo');
    await servicio.calculo(USUARIO, t.turno_id, { salida: '{"operacion": "contar", "campo": null, "filtro": {}, "agrupar": ["activa"]}', modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    const r = await seguir(servicio, t.turno_id, await servicio.ejecutar(USUARIO, t.turno_id));
    const datos = r.respuesta!.resultados[0].datos as { filas: Array<[string, number]> };
    expect(datos.filas).toEqual([['RE · inactivas', 30], ['RT · activas', 41], ['RT · inactivas', 5], ['Total · inactivas', 35], ['Total · activas', 41]]);
    expect(r.respuesta!.frase).toContain('Con lo que traje antes.');
    expect(r.respuesta!.frase).not.toContain('Búsqueda masiva');
  });

  it('"todo junto" no se separa', async () => {
    const { servicio, t, a } = await hastaCalcular('cuantas activas e inactivas hay en total, todo junto');
    await servicio.calculo(USUARIO, t.turno_id, { salida: '{"operacion": "contar", "campo": null, "filtro": {}, "agrupar": ["activa"]}', modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    const r = await seguir(servicio, t.turno_id, await servicio.ejecutar(USUARIO, t.turno_id));
    expect((r.respuesta!.resultados[0].datos as { filas: unknown[] }).filas).toEqual([['inactivas', 35], ['activas', 41]]);
  });

  it('la fuente: el nombre de un atajo sí; los títulos de los pasos, no', () => {
    expect(fuenteDe(['Atajo «Paquetería Lima»'])).toBe('Paquetería Lima');
    expect(fuenteDe(['Búsqueda masiva de RE', 'Búsqueda masiva de RT'])).toBe(LO_ANTERIOR);
    const filas = filasDe('busqueda_masiva', RT);
    expect(calcular(filas, { operacion: 'contar', campo: null, filtro: {}, agrupar: ['activa'] }, LO_ANTERIOR).frase).toBe('Cuántas: activas, 41; inactivas, 5. Con lo que traje antes.');
  });
});

describe('El consumo en porcentaje de un atajo', () => {
  it('un atajo puede enseñarse como "uso"', () => {
    expect(vistasDe('ejecutar_atajo')).toContain('uso');
  });
});
