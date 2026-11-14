import { describe, expect, it, vi } from 'vitest';
import { seguir } from './ayuda.js';
import { AgenteV3Service, VIGENCIA_PREVIA_MS } from '../../src/agente-v3/agente-v3.service.js';
import { inversoDe } from '../../src/agente-v3/deshacer.js';
import { EjecucionV3Service } from '../../src/agente-v3/ejecucion.service.js';
import { mencionesDe, type EntidadDirectorio } from '../../src/agente-v3/entidades.js';
import type { ContextoTurno, PasoAplicado, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';
import { esRespuesta, preguntaDeAplicar } from '../../src/agente-v3/preguntas.js';

/**
 * Habilitar la edición (decisiones del usuario, 2026-11-13): modo editor +
 * «¿Procedo?»; lo que se aplica es lo de la vista previa, sin simulacro;
 * pasados 10 minutos la vista previa se rehace; «Deshacer» arma el inverso,
 * lo enseña y pregunta otra vez.
 */

const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };
const M = { cuenta: 1, nombre: 'gemini-3.5-flash-lite' };
const MENSAJE = 'cierra el picking de la 20021 el 14';
const DIRECTORIO: EntidadDirectorio[] = [{ pais: 'PE', codigo: '20021', tipo: 'tienda', es_cd: false, nombre: 'Ripley Chorrillos', alias: [] }];
const CTX: ContextoTurno = {
  hoy: '2026-11-13', pais: 'PE', motivo_pais: '', anterior: null, aclaraciones: [], pregunta: null, rondas: 0, atajos: [], almacenes: [], servicios: [],
  entidades: mencionesDe(MENSAJE, DIRECTORIO, 'PE'),
};
const PLAN = { pasos: [{ herramienta: 'editar_capacidad', param: { tipo: 'picking', codigo: ['20021'], fecha: '2026-11-14', activa: false } }] };
const clasif = JSON.stringify({ tipo: 'cambio', depende_del_anterior: false, atajo: '(ninguno)', motivo: '' });

function armar(opciones: { editor?: boolean } = {}) {
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
  const ctxServ = { comprobarChat: vi.fn(async () => undefined), armar: vi.fn(async () => structuredClone(CTX)) };
  const supabase = { admin: { rpc: vi.fn(async () => ({ data: 'm-1', error: null })) } };
  // El simulacro es de cada petición: la vista previa lo enciende y la siguiente petición empieza sin él
  let simulacro = false;
  const auditoria = { activarSimulacro: vi.fn(() => { simulacro = true; }), enSimulacro: vi.fn(() => simulacro) };
  const nuevaPeticion = () => { simulacro = false; };
  // Ripley: el día 14 de la 20021, abierto; solo una escritura de verdad lo cambia
  const estado = { activo: true };
  const llamadas: Array<{ dto: Record<string, unknown>; simulacro: boolean }> = [];
  const editarCapacidad = {
    editarCapacidad: vi.fn(async (_u: unknown, dto: Record<string, unknown>) => {
      llamadas.push({ dto: { ...dto }, simulacro });
      const antes = { fecha: '2026-11-14', activo: estado.activo, asignado: 50, ocupado: 0, disponible: 50, uso: 0 };
      const despues = { ...antes, activo: dto.activa === undefined ? estado.activo : Boolean(dto.activa) };
      if (!simulacro) estado.activo = despues.activo;
      return { tipo: 'picking', oficinas: [{ oficina: '20021 - Ripley Chorrillos', agendas: [{ agenda: 'Agenda Picking DT - 20021', dias: [{ fecha: '2026-11-14', antes, despues }] }] }], resumen: { pedidos: 1, cambiados: 1, sinCambiar: 0 } };
    }),
  };
  const registro = { registrar: vi.fn() };
  const ejecucion = new EjecucionV3Service(supabase as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    auditoria as never, editarCapacidad as never, {} as never, {} as never, {} as never, {} as never, {} as never, registro as never);
  const modo = { editor: opciones.editor ?? true };
  const modoServ = { estado: vi.fn(() => ({ modo: modo.editor ? 'editor' : 'consultor' })) };
  const servicio = new AgenteV3Service(turnos as never, ctxServ as never, ejecucion, { registrar: vi.fn(), estaInterrumpida: () => false } as never, supabase as never, {} as never, modoServ as never);
  return { servicio, llamadas, estado, registro, modo, filas, nuevaPeticion };
}

/** El mensaje hasta el final de la vista previa */
async function vistaPrevia(s: ReturnType<typeof armar>) {
  const t = await s.servicio.crear(USUARIO, { mensaje: MENSAJE, chat_id: 'c' });
  await s.servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif, modelo: M });
  expect((await s.servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify(PLAN), modelo: M })).camino).toBe('ejecutar');
  const r = await seguir(s.servicio, t.turno_id, await s.servicio.ejecutar(USUARIO, t.turno_id));
  return { id: t.turno_id, r };
}

describe('Sin modo editor: solo la vista previa', () => {
  it('no pregunta ni escribe, y dice cómo aplicarlo', async () => {
    const s = armar({ editor: false });
    const { r } = await vistaPrevia(s);
    expect(r.camino).toBe('responder');
    expect(r.respuesta!.frase).toBe('Así quedaría: cambiaría 1 de 1. No apliqué nada: es solo una vista previa.');
    expect(r.respuesta!.avisos).toContain('Para aplicarlo, activa el modo editor y pídemelo otra vez.');
    expect(s.llamadas.map((l) => l.simulacro)).toEqual([true]);
    expect(r.respuesta!.deshacer).toBeUndefined();
  });
});

describe('Con modo editor: «¿Procedo?» y se aplica lo que se previsualizó', () => {
  it('pregunta con la vista previa a la vista', async () => {
    const s = armar();
    const { r } = await vistaPrevia(s);
    expect(r.camino).toBe('preguntar');
    expect(r.pregunta!.dudas).toEqual([{ id: 'aplicar', pregunta: '¿Procedo con el cambio? Es 1 cambio en Ripley.', opciones: [{ id: 'si', texto: 'Sí, aplicar' }, { id: 'no', texto: 'No, dejarlo como está' }], libre: null }]);
    expect(r.pregunta!.resultados[0]).toMatchObject({ herramienta: 'editar_capacidad' });
  });

  it('"no": no escribe nada', async () => {
    const s = armar();
    const { id } = await vistaPrevia(s);
    s.nuevaPeticion();
    const r = await s.servicio.respuesta(USUARIO, id, { respuestas: { aplicar: 'no' } });
    expect(r.camino).toBe('responder');
    expect(r.respuesta!.notas).toContain('De acuerdo: no apliqué nada.');
    expect(s.llamadas).toHaveLength(1);
    expect(s.estado.activo).toBe(true);
  });

  it('"sí": manda el MISMO cuerpo, sin simulacro, lo audita y ofrece deshacer', async () => {
    const s = armar();
    const { id } = await vistaPrevia(s);
    s.nuevaPeticion();
    const a = await s.servicio.respuesta(USUARIO, id, { respuestas: { aplicar: 'si' } });
    expect(a.camino).toBe('aplicar');
    const r = await s.servicio.aplicar(USUARIO, id);
    expect(r.camino).toBe('responder');
    expect(s.llamadas.map((l) => l.simulacro)).toEqual([true, false]);
    expect(s.llamadas[1].dto).toEqual(s.llamadas[0].dto);
    expect(s.estado.activo).toBe(false);
    expect(r.respuesta!.frase).toBe('Apliqué el cambio: cambió 1 de 1.');
    expect(r.respuesta!.deshacer).toBe(true);
    expect(r.respuesta!.resultados[0]).toMatchObject({ aplicado: true, datos: { aplicado: true } });
    expect(r.respuesta!.markdown).toContain('| Dónde | Día | Antes | Quedó |');
    expect(s.registro.registrar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'agente-v3.editar_capacidad', origen: 'agente', exitoso: true, usuario_id: 'u1' }));
  });

  it('si el modo editor se apagó antes del "sí", no escribe', async () => {
    const s = armar();
    const { id } = await vistaPrevia(s);
    s.nuevaPeticion();
    s.modo.editor = false;
    const r = await s.servicio.respuesta(USUARIO, id, { texto: 'sí' });
    expect(r.respuesta!.notas).toContain('El modo editor ya no está activo: no apliqué nada. Actívalo y pídemelo otra vez.');
    expect(s.llamadas).toHaveLength(1);
  });

  it('una vista previa de más de 10 minutos se rehace y se vuelve a preguntar', async () => {
    const s = armar();
    const { id } = await vistaPrevia(s);
    const t = s.filas.get(id)!;
    t.contexto = { ...t.contexto!, vista_previa_en: new Date(Date.now() - VIGENCIA_PREVIA_MS - 1000).toISOString() };
    s.nuevaPeticion();
    const r = await s.servicio.respuesta(USUARIO, id, { respuestas: { aplicar: 'si' } });
    expect(r.camino).toBe('ejecutar');
    const otra = await seguir(s.servicio, id, await s.servicio.ejecutar(USUARIO, id));
    expect(otra.camino).toBe('preguntar');
    expect(otra.pregunta!.avisos).toContain('La vista previa tenía más de 10 minutos: la rehice con cómo está ahora. Mírala antes de decir que sí.');
    expect(s.llamadas.map((l) => l.simulacro)).toEqual([true, true]);
  });

  it('lo escrito contesta «¿Procedo?» solo si es un sí o un no', () => {
    const p = preguntaDeAplicar([], false);
    expect(esRespuesta(p, { texto: 'Sí' })).toBe(true);
    expect(esRespuesta(p, { texto: 'mejor no' })).toBe(true);
    expect(esRespuesta(p, { texto: 'y la 20048?' })).toBe(false);
  });
});

describe('«Deshacer»: el inverso, en vista previa y con otra pregunta', () => {
  it('vuelve a abrir el día que cerró, preguntando antes', async () => {
    const s = armar();
    const { id } = await vistaPrevia(s);
    s.nuevaPeticion();
    await s.servicio.respuesta(USUARIO, id, { respuestas: { aplicar: 'si' } });
    await s.servicio.aplicar(USUARIO, id);
    s.nuevaPeticion();
    const d = await s.servicio.deshacer(USUARIO, id);
    expect(d.camino).toBe('ejecutar');
    const r = await seguir(s.servicio, d.turno_id, await s.servicio.ejecutar(USUARIO, d.turno_id));
    expect(r.camino).toBe('preguntar');
    expect(r.pregunta!.dudas![0]).toMatchObject({ pregunta: '¿Lo dejo como estaba? Es 1 cambio en Ripley.', opciones: [{ id: 'si', texto: 'Sí, deshacer' }, { id: 'no', texto: 'No, dejarlo así' }] });
    expect(s.llamadas[2]).toEqual({ simulacro: true, dto: expect.objectContaining({ tipo: 'picking', codigo: '20021', agenda: 'Agenda Picking DT - 20021', fecha: '2026-11-14', activa: true }) });
    s.nuevaPeticion();
    await s.servicio.respuesta(USUARIO, d.turno_id, { respuestas: { aplicar: 'si' } });
    const f = await s.servicio.aplicar(USUARIO, d.turno_id);
    expect(f.respuesta!.frase).toBe('Apliqué el cambio: cambió 1 de 1.');
    expect(s.estado.activo).toBe(true);
  });

  it('un mensaje que no aplicó nada no se deshace', async () => {
    const s = armar({ editor: false });
    const { id } = await vistaPrevia(s);
    await expect(s.servicio.deshacer(USUARIO, id)).rejects.toThrow('no aplicó ningún cambio');
  });
});

describe('Los inversos, herramienta por herramienta', () => {
  const ok = (cuerpo: Record<string, unknown>) => ({ cuerpo, ok: true });
  const aplicado = (herramienta: string, cuerpo: Record<string, unknown>, datos: unknown): PasoAplicado => ({ n: 1, herramienta, cuerpos: [ok(cuerpo)], datos });

  it('masiva: solo las agendas que cambiaron, cada grupo a como estaba', () => {
    const inv = inversoDe(aplicado('editar_masivo', { pais: 'PE', servicio: 'SE', opls: '20021,20048', activo: true }, {
      servicio: 'SE',
      cambiadas: [
        { opl: '20021 - Chorrillos', agenda: 'Agenda SE Chorrillos', antes: { activo: false, enCheckout: false }, despues: { activo: true, enCheckout: false } },
        { opl: '20048 - Breña', agenda: 'Agenda SE Breña', antes: { activo: false, enCheckout: true }, despues: { activo: true, enCheckout: true } },
      ],
    }), 'PE');
    expect(inv.cuerpos).toEqual([
      { pais: 'PE', servicio: 'SE', opls: '20021', agendas: ['Agenda SE Chorrillos'], activo: false, enCheckout: false },
      { pais: 'PE', servicio: 'SE', opls: '20048', agendas: ['Agenda SE Breña'], activo: false, enCheckout: true },
    ]);
  });

  it('CD: las jornadas de un día a como estaban', () => {
    const inv = inversoDe(aplicado('cortar_reabrir_cd', { pais: 'PE', cd: '20026', activa: false }, {
      jornadas: [
        { cd: '20026 - CD Villa', jornada: 'AM', fecha: '2026-11-14', antes: true, despues: false },
        { cd: '20026 - CD Villa', jornada: 'PM', fecha: '2026-11-14', antes: true, despues: false },
        { cd: '20026 - CD Villa', jornada: 'NOCHE', fecha: '2026-11-14', antes: false, despues: false },
      ],
    }), 'PE');
    expect(inv.cuerpos).toEqual([{ pais: 'PE', cd: '20026', fecha: '2026-11-14', jornadas: 'AM,PM', activa: true }]);
  });

  it('reasignar: lo mismo, al revés', () => {
    const inv = inversoDe(aplicado('reasignar_capacidad', { pais: 'CL', cd: '10', origen: 'DX', destino: 'ND', unidades: 30, fechaOrigen: '2026-11-14', fechaDestino: '2026-11-13' }, {
      cd: '10', origen: { jornada: 'DX', fecha: '2026-11-14', asignadoAntes: 100, asignadoDespues: 70 }, destino: { jornada: 'ND', fecha: '2026-11-13', asignadoAntes: 50, asignadoDespues: 80 },
    }), 'CL');
    expect(inv.cuerpos).toEqual([{ pais: 'CL', cd: '10', origen: 'ND', destino: 'DX', unidades: 30, fechaOrigen: '2026-11-13', fechaDestino: '2026-11-14' }]);
  });

  it('servicio de OPL: lo que cambió vuelve; el corte se dice y no se toca', () => {
    const inv = inversoDe(aplicado('editar_servicio_opl', { pais: 'PE', opl: '1401', servicio: 'S' }, {
      servicios: [{ opl: '1401 - San Luis', agenda: 'Centralizado', zona: 'Zona Sur', servicio: 'S', antes: { activo: true, enCheckout: true, cortes: ['14:00'], diasHolgura: 1 }, despues: { activo: false, enCheckout: true, cortes: ['16:00'], diasHolgura: 1 } }],
    }), 'PE');
    expect(inv.cuerpos).toEqual([{ pais: 'PE', opl: '1401', servicio: 'S', agenda: 'Centralizado', zona: 'Zona Sur', activo: true }]);
    expect(inv.sin).toEqual(['el corte de S en 1401 (vuelve a ponerlo a mano: 14:00)']);
  });

  it('transferencia: cada destino a como estaba', () => {
    const inv = inversoDe(aplicado('editar_transferencia', { pais: 'PE', origen: '20026', destino: '20021', habilitada: false }, {
      origen: '20026 - CD Villa',
      destinos: [{ destino: '20021 - Chorrillos', antes: { habilitada: true, preparacion: 1, transito: 2, dias: 'L-V' }, despues: { habilitada: false, preparacion: 1, transito: 2, dias: 'L-V' } }],
    }), 'PE');
    expect(inv.cuerpos).toEqual([{ pais: 'PE', origen: '20026', destino: '20021', habilitada: true }]);
  });

  it('lo que falló al aplicar no se deshace', () => {
    const inv = inversoDe(aplicado('editar_capacidad', { pais: 'PE', tipo: 'picking', codigo: '20021' }, {
      tipo: 'picking', oficinas: [{ oficina: '20021', agendas: [{ agenda: 'A', dias: [{ fecha: '2026-11-14', antes: { activo: true, asignado: 5 }, despues: { activo: true, asignado: 5 }, error: 'ya estaba así' }] }] }],
    }), 'PE');
    expect(inv.cuerpos).toEqual([]);
  });
});
