import { describe, expect, it, vi } from 'vitest';
import { seguir } from './ayuda.js';
import { AgenteV3Service } from '../../src/agente-v3/agente-v3.service.js';
import { leerPlan } from '../../src/agente-v3/armar/leer.js';
import { EjecucionV3Service } from '../../src/agente-v3/ejecucion.service.js';
import type { ContextoTurno, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';

/**
 * Varios cambios en un mensaje (2026-11-08): "activa las suc de la SE y
 * desactiva las suc de la ST que coincidan con las de la SE y el resto de suc
 * de la ST actívalas". Antes, "un solo cambio por mensaje" hizo que el modelo
 * se quedara con el primero y callara los otros dos.
 */

const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };
const M = { cuenta: 1, nombre: 'gemini-3.5-flash-lite' };
const MENSAJE = 'activa las suc de la SE y desactva las suc de la ST que coincidan con los de la SE y el resto de suc de la ST activalas';

const CTX: ContextoTurno = {
  hoy: '2026-11-08', pais: 'PE', motivo_pais: '', anterior: null, aclaraciones: [], pregunta: null, rondas: 0, atajos: [], entidades: [], almacenes: [],
  servicios: ['SE', 'ST'].map((codigo) => ({ codigo, nombre: null, metodo_entrega: 'RT', fase: 'F2' })),
};

const agenda = (codigo: string, nombre: string, activa: boolean) => ({ opl: `${codigo} - Ripley ${nombre}`, agenda: `Agenda ${nombre}`, zona: `Zona ${nombre}`, activa, enCheckout: activa });
const MASIVA: Record<string, unknown> = {
  SE: { servicio: 'SE', agendas: [agenda('20021', 'Chorrillos', false), agenda('20048', 'Breña', false)] },
  ST: { servicio: 'ST', agendas: [agenda('20021', 'Chorrillos', true), agenda('20048', 'Breña', true), agenda('20066', 'Plaza Lima Norte', false), agenda('20027', 'San Isidro', false)] },
};

/** Lo que haría la edición masiva de la v2: cada agenda de esas sucursales, del estado de la búsqueda al pedido */
function editarMasivo(dto: { servicio: string; opls?: string; activo?: boolean }) {
  const opls = String(dto.opls ?? '').split(',').filter(Boolean);
  const agendas = (MASIVA[dto.servicio] as { agendas: Array<ReturnType<typeof agenda>> }).agendas.filter((a) => !opls.length || opls.some((c) => a.opl.startsWith(c)));
  const cambiadas = agendas.filter((a) => a.activa !== dto.activo).map((a) => ({ opl: a.opl, agenda: a.agenda, zona: a.zona, antes: { activo: a.activa, enCheckout: a.enCheckout }, despues: { activo: dto.activo, enCheckout: a.enCheckout } }));
  return { servicio: dto.servicio, opls: dto.opls, cambiadas, resumen: { encontradas: agendas.length, alcanzadas: agendas.length, cambiadas: cambiadas.length, sinCambiar: agendas.length - cambiadas.length } };
}

function armar(editar: (dto: { servicio: string; opls?: string; activo?: boolean; maximo?: number }) => unknown = editarMasivo) {
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
  let simulacro = false;
  const auditoria = { activarSimulacro: vi.fn(() => { simulacro = true; }), enSimulacro: vi.fn(() => simulacro) };
  const edicion = { editar: vi.fn(async (_u: unknown, dto: { servicio: string; opls?: string; activo?: boolean; maximo?: number }) => { expect(simulacro).toBe(true); return editar(dto); }) };
  const ejecucion = new EjecucionV3Service(supabase as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, masivo as never, {} as never,
    auditoria as never, {} as never, {} as never, {} as never, {} as never, edicion as never, {} as never);
  const servicio = new AgenteV3Service(turnos as never, ctxServ as never, ejecucion, { registrar: vi.fn(), estaInterrumpida: () => false } as never, supabase as never, {} as never);
  return { servicio, edicion, masivo };
}

const PLAN = { pasos: [
  { herramienta: 'busqueda_masiva', param: { servicio: ['SE'] } },
  { herramienta: 'editar_masivo', param: { servicio: 'SE', opls: { ref: 'paso', n: 1 }, activo: true } },
  { herramienta: 'editar_masivo', param: { servicio: 'ST', opls: { ref: 'paso', n: 1 }, activo: false } },
  { herramienta: 'busqueda_masiva', param: { servicio: ['ST'] } },
  { herramienta: 'editar_masivo', param: { servicio: 'ST', opls: { ref: 'paso', n: 4, sin: 1 }, activo: true } },
] };

describe('Varios cambios en un mensaje, en vista previa', () => {
  it('los tres cambios, con "el resto" (lo de la ST sin lo de la SE); la frase y el Markdown los dicen todos', async () => {
    const { servicio, edicion } = armar();
    const t = await servicio.crear(USUARIO, { mensaje: MENSAJE, chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: JSON.stringify({ tipo: 'cambio', depende_del_anterior: false, atajo: '(ninguno)', motivo: '' }), modelo: M });
    expect(a.prompt!.sistema).toContain('NO RECORTES');
    expect(a.prompt!.sistema).toContain('{"ref": "paso", "n": N, "sin": M}');
    const e = await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify(PLAN), modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    expect(e.camino).toBe('ejecutar');

    let r = await servicio.ejecutar(USUARIO, t.turno_id);
    expect(r.progreso!.pasos.map((p) => p.descripcion)).toEqual([
      'Búsqueda masiva de SE',
      'Vista previa: activar SE en lo del paso 1',
      'Vista previa: desactivar ST en lo del paso 1',
      'Búsqueda masiva de ST',
      'Vista previa: activar ST en lo del paso 4 menos lo del paso 1',
    ]);
    r = await seguir(servicio, t.turno_id, r);

    expect(edicion.editar.mock.calls.map(([, dto]) => [dto.servicio, dto.opls, dto.activo])).toEqual([
      ['SE', '20021,20048', true],
      ['ST', '20021,20048', false],
      ['ST', '20066,20027', true],
    ]);
    const resp = r.respuesta!;
    expect(resp.frase).toBe('Así quedaría — paso 2 · activar SE en lo del paso 1: cambiarían 2 de 2. '
      + 'paso 3 · desactivar ST en lo del paso 1: cambiarían 2 de 2. '
      + 'paso 5 · activar ST en lo del paso 4 menos lo del paso 1: cambiarían 2 de 2. '
      + 'No apliqué nada: es solo una vista previa.');
    expect(resp.markdown).toContain('**Vista previa: desactivar ST en lo del paso 1**\n\n| Dónde | Ahora | Quedaría |');
    expect(resp.markdown).toContain('| 20066 · Plaza Lima Norte · Agenda Plaza Lima Norte (Zona Plaza Lima Norte) | inactivo · fuera del checkout | activo · fuera del checkout |');
    expect(resp.resultados.filter((x) => x.herramienta === 'editar_masivo')).toHaveLength(3);
  });

  it('"sin" tiene que ser otro paso anterior', () => {
    const malo = { pasos: [PLAN.pasos[0], { herramienta: 'editar_masivo', param: { servicio: 'ST', opls: { ref: 'paso', n: 1, sin: 2 }, activo: true } }] };
    expect(leerPlan(JSON.stringify(malo), CTX, MENSAJE, true)).toMatchObject({ ok: false, motivo: 'paso 2 (editar_masivo): opls: "sin" tiene que ser otro paso anterior ({"ref":"paso","n":1,"sin":2})' });
    expect(leerPlan(JSON.stringify(PLAN), CTX, MENSAJE, true)).toMatchObject({ ok: true, valor: { plan: { origen: 'cambio' } } });
  });
});

describe('La vista previa de la edición masiva, sin el tope de 30', () => {
  const unPaso = (servicio: string, activo: boolean) => JSON.stringify({ pasos: [{ herramienta: 'editar_masivo', param: { servicio, activo } }] });
  async function hasta(servicio: AgenteV3Service, plan: string) {
    const t = await servicio.crear(USUARIO, { mensaje: 'desactiva la ST', chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: JSON.stringify({ tipo: 'cambio', depende_del_anterior: false, atajo: '(ninguno)', motivo: '' }), modelo: M });
    await servicio.armado(USUARIO, t.turno_id, { salida: plan, modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre } });
    let r = await servicio.ejecutar(USUARIO, t.turno_id);
    r = await seguir(servicio, t.turno_id, r);
    return r;
  }

  it('32 agendas: la v2 se negaría (máximo 30); la vista previa las enseña todas', async () => {
    const muchas = Array.from({ length: 32 }, (_, i) => agenda(String(20100 + i), `Tienda ${i}`, true));
    const { servicio, edicion } = armar((dto) => {
      // Lo que hace la edición masiva de la v2 con su tope
      if ((dto.maximo ?? 30) < muchas.length) throw new Error(`La búsqueda alcanza ${muchas.length} agendas y el máximo por vez es 30.`);
      return { servicio: dto.servicio, opls: 'todos', cambiadas: muchas.map((a) => ({ opl: a.opl, agenda: a.agenda, zona: a.zona, antes: { activo: true, enCheckout: true }, despues: { activo: false, enCheckout: true } })), resumen: { encontradas: 32, alcanzadas: 32, cambiadas: 32, sinCambiar: 0 } };
    });
    const r = await hasta(servicio, unPaso('ST', false));
    expect(edicion.editar).toHaveBeenCalledWith(USUARIO, expect.objectContaining({ maximo: Number.MAX_SAFE_INTEGER }));
    expect(r.respuesta!.frase).toMatch(/^Así quedaría: cambiarían 32 de 32\. No apliqué nada/);
  });

  it('"ya estaban así" no es un error: no cambiaría nada', async () => {
    const { servicio } = armar(() => { throw new Error('Las 21 agendas ya estaban así. No he cambiado nada.'); });
    const r = await hasta(servicio, unPaso('ST', true));
    expect(r.respuesta!.pasos[0].estado).toBe('vacio');
    expect(r.respuesta!.frase).toBe('No cambiaría nada: las 21 agendas ya están así. No apliqué nada: es solo una vista previa.');
  });

  it('el prompt dice cómo es "las de la ST que coinciden con las de la SE"', async () => {
    const { servicio } = armar();
    const t = await servicio.crear(USUARIO, { mensaje: MENSAJE, chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: JSON.stringify({ tipo: 'cambio', depende_del_anterior: false, atajo: '(ninguno)', motivo: '' }), modelo: M });
    expect(a.prompt!.sistema).toContain('"Las de la ST que coinciden con las de la SE" es editar_masivo de la ST con opls = las de la SE');
  });
});
