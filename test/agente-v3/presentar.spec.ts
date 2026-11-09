import { describe, expect, it, vi } from 'vitest';
import { seguir } from './ayuda.js';
import { AgenteV3Service } from '../../src/agente-v3/agente-v3.service.js';
import { EjecucionV3Service } from '../../src/agente-v3/ejecucion.service.js';
import type { ContextoTurno, PasoEjecutado, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';
import { leerPresentacion, promptPresentar, SISTEMA_PRESENTAR } from '../../src/agente-v3/presentar/prompt.js';

/**
 * Presentar (2026-11-09): un modelo decide cómo se enseña cada resultado según
 * cómo lo pidió la persona, y redacta la frase con las cifras de los datos.
 */

const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };
const M = { cuenta: 1, nombre: 'gemini-3.5-flash-lite' };
const MENSAJE = 'fijate que las sucursales de la RE se mantengan inactivas y en un cuadro solo dame el total de sucursales activas e inactivas de la RT';

const CTX: ContextoTurno = {
  hoy: '2026-11-09', pais: 'PE', motivo_pais: '', anterior: null, aclaraciones: [], pregunta: null, rondas: 0, atajos: [], entidades: [], almacenes: [],
  servicios: ['RT', 'RE'].map((codigo) => ({ codigo, nombre: null, metodo_entrega: 'RT', fase: 'F1' })),
};
const agendas = (n: number, activas: number) => Array.from({ length: n }, (_, i) => ({ opl: `${20000 + i} - Ripley T${i}`, agenda: `A${i}`, activa: i < activas, enCheckout: i < activas }));
const MASIVA: Record<string, unknown> = { RE: { servicio: 'RE', agendas: agendas(30, 0) }, RT: { servicio: 'RT', agendas: agendas(46, 41) } };
const PLAN = { pasos: [
  { herramienta: 'busqueda_masiva', param: { servicio: ['RE'] }, comprobar: { campo: 'activa', op: '=', valor: false, cuantos: 'todos', servicio: 'RE' } },
  { herramienta: 'busqueda_masiva', param: { servicio: ['RT'] } },
], ver: 'cuadro' };

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
  const masivo = { buscar: vi.fn(async (_u: unknown, dto: { servicio: string }) => structuredClone(MASIVA[dto.servicio])) };
  const ejecucion = new EjecucionV3Service(supabase as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, masivo as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const servicio = new AgenteV3Service(turnos as never, ctxServ as never, ejecucion, { registrar: vi.fn(), estaInterrumpida: () => false } as never, supabase as never, {} as never);
  return { servicio, filas };
}

async function hastaPresentar(mensaje = MENSAJE, plan: unknown = PLAN) {
  const { servicio, filas } = armar();
  const t = await servicio.crear(USUARIO, { mensaje, chat_id: 'c' });
  const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: JSON.stringify({ tipo: 'consulta', depende_del_anterior: false, atajo: '(ninguno)', motivo: '' }), modelo: M });
  await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify(plan), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
  let r = await servicio.ejecutar(USUARIO, t.turno_id);
  for (let i = 0; i < 6 && r.camino === 'avisar'; i++) r = await servicio.ejecutar(USUARIO, t.turno_id);
  return { servicio, filas, t, r };
}

const FRASE = 'Las 30 sucursales de la RE siguen inactivas. En la RT hay 41 activas y 5 inactivas, de 46.';

describe('Presentar: cómo se enseña cada resultado y la frase', () => {
  it('se llama al final, con lo que pidió la persona y las vistas de cada resultado', async () => {
    const { r } = await hastaPresentar();
    expect(r.camino).toBe('presentar');
    expect(r.modelo).toMatchObject({ rol: 'presentar', nombre: 'gemini-3.5-flash-lite' });
    expect(r.prompt!.sistema).toBe(SISTEMA_PRESENTAR);
    expect(r.prompt!.mensaje).toContain(`«${MENSAJE}»`);
    expect(r.prompt!.mensaje).toContain('- Resultado 1: Búsqueda masiva de RE (es una comprobación)');
    expect(r.prompt!.mensaje).toContain('Vistas permitidas: totales, detalle, frase, plegado');
  });

  it('la RE en la frase, la RT en un cuadro de totales, y la frase natural (con las cifras de los datos)', async () => {
    const { servicio, t, r } = await hastaPresentar();
    const salida = JSON.stringify({ resultados: [{ n: 1, vista: 'frase' }, { n: 2, vista: 'totales' }], orden: [1, 2], frase: FRASE });
    const fin = await seguir(servicio, t.turno_id, r, salida);
    expect(fin.camino).toBe('responder');
    expect(fin.respuesta!.frase).toBe(FRASE);
    expect(fin.respuesta!.resultados.map((x) => [x.n, x.vista])).toEqual([[1, 'frase'], [2, 'totales']]);
    // Sin tabla para la RE en el Markdown (va en la frase); la de la RT, sí
    expect(fin.respuesta!.markdown).not.toContain('**Búsqueda masiva de RE**');
    expect(fin.respuesta!.markdown).toContain('**Búsqueda masiva de RT**');
  });

  it('una frase con una cifra que no está en los datos se descarta (queda la del código); las vistas, no', async () => {
    const { servicio, t, r } = await hastaPresentar();
    const salida = JSON.stringify({ resultados: [{ n: 2, vista: 'totales' }], frase: 'En la RT hay 47 activas.' });
    const fin = await seguir(servicio, t.turno_id, r, salida);
    expect(fin.respuesta!.frase).toMatch(/^Sí: los 30 están inactivas \(RE\)\./);
    expect(fin.respuesta!.resultados.find((x) => x.n === 2)!.vista).toBe('totales');
  });

  it('sin modelo: lo del código, que ya hace lo de siempre ("el total" manda sobre "cuadro"; la comprobación, plegada)', async () => {
    const { servicio, t, r } = await hastaPresentar();
    const fin = await seguir(servicio, t.turno_id, r);
    expect(fin.respuesta!.resultados.map((x) => [x.n, x.vista])).toEqual([[1, 'plegado'], [2, 'totales']]);
  });

  it('un resultado simple sin pedir forma: no se llama a Presentar', async () => {
    const { r } = await hastaPresentar('dame las sucursales de la RT', { pasos: [{ herramienta: 'busqueda_masiva', param: { servicio: ['RT'] } }] });
    expect(r.camino).toBe('responder');
    expect(r.respuesta!.resultados[0].vista).toBe('detalle');
  });

  it('la lectura: un resultado o una vista que no existen no valen; "cuadro" es detalle; el orden se completa', () => {
    const pasos = [
      { n: 1, que: 'A', herramienta: 'busqueda_masiva', estado: 'ok', resumen: 'RE, 30 inactivas', ms: 1 },
      { n: 2, que: 'B', herramienta: 'consultar_transferencia', estado: 'ok', resumen: '2 de 2 habilitadas', ms: 1 },
    ] as PasoEjecutado[];
    expect(leerPresentacion('{"resultados": [{"n": 3, "vista": "detalle"}]}', pasos, '')).toMatchObject({ ok: false, motivo: 'el resultado 3 no existe' });
    expect(leerPresentacion('{"resultados": [{"n": 2, "vista": "totales"}]}', pasos, '')).toMatchObject({ ok: false, motivo: 'el resultado 2 no tiene la vista «totales» (tiene: detalle, frase, plegado)' });
    expect(leerPresentacion('{"resultados": [{"n": 1, "vista": "cuadro"}], "orden": [2]}', pasos, 'RE 30')).toEqual({ ok: true, valor: { vistas: { 1: 'detalle' }, orden: [2, 1], frase: null } });
    expect(promptPresentar('x', pasos, new Set([1]), 'f').mensaje).toContain('- Resultado 1: A (intermedio: da sus códigos a otro paso)');
  });
});
