import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgenteV3Service } from '../../src/agente-v3/agente-v3.service.js';
import { EjecucionV3Service } from '../../src/agente-v3/ejecucion.service.js';
import type { ContextoTurno, ModeloElegido, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';
import { GeminiService, type Prompt, type SalidaGemini } from '../../src/agente-v3/motor/gemini.service.js';
import { MotorV3Service, type EventoV3 } from '../../src/agente-v3/motor/motor.service.js';

/**
 * Fase A de la migración (2026-11-13): el agente vive en el backend, sin n8n.
 * El adaptador de Gemini (con un fetch de mentira: no gasta cuota) y el motor
 * que recorre el turno entero con eventos.
 */

const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };

describe('GeminiService: la llamada a la API', () => {
  const config = { get: vi.fn((k: string) => ({ 'agente.v3.gemini.claves': { 1: 'CLAVE-UNO', 2: '', 3: 'CLAVE-TRES' }, 'agente.v3.gemini.url': 'https://gemini.test/v1beta', 'agente.v3.gemini.timeoutMs': 50 } as Record<string, unknown>)[k]) };
  const gemini = new GeminiService(config as never);
  const prompt: Prompt = { sistema: 'Eres el clasificador.', mensaje: 'hola' };
  afterEach(() => vi.unstubAllGlobals());

  it('la instrucción de sistema aparte, la clave en la cabecera (nunca en la URL), temperatura 0; sin lo que "pensó"', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'pensando…', thought: true }, { text: '{"tipo":"charla"}' }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await gemini.generar({ cuenta: 1, nombre: 'gemini-3.5-flash-lite' }, prompt)).toEqual({ salida: '{"tipo":"charla"}' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gemini.test/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(url).not.toContain('CLAVE');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('CLAVE-UNO');
    expect(JSON.parse(String(init.body))).toEqual({
      systemInstruction: { parts: [{ text: 'Eres el clasificador.' }] },
      contents: [{ role: 'user', parts: [{ text: 'hola' }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 2048 },
    });
  });

  it('los errores, como los de Gemini (de ahí sale si es cuota o saturado); y sin decir la clave', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }), { status: 429 })));
    expect(await gemini.generar({ cuenta: 3, nombre: 'gemini-3.5-flash-lite' }, prompt)).toEqual({ error: '429 RESOURCE_EXHAUSTED Quota exceeded' });
    expect(await gemini.generar({ cuenta: 2, nombre: 'gemini-3.5-flash-lite' }, prompt)).toEqual({ error: 'sin clave de Gemini para la cuenta 2 (GEMINI_CLAVE_2)' });
  });

  it('si no contesta a tiempo, se dice', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_ok, mal) => init.signal!.addEventListener('abort', () => mal(Object.assign(new Error('aborted'), { name: 'AbortError' }))))));
    expect(await gemini.generar({ cuenta: 1, nombre: 'gemini-3.5-flash-lite' }, prompt)).toEqual({ error: 'timeout: Gemini no contestó en 0 s' });
  });
});

// ── El motor, de punta a punta ──

const CTX: ContextoTurno = {
  hoy: '2026-11-13', pais: 'PE', motivo_pais: '', anterior: null, aclaraciones: [], pregunta: null, rondas: 0, atajos: [], entidades: [], almacenes: [],
  servicios: [{ codigo: 'RT', nombre: null, metodo_entrega: 'RT', fase: 'F1' }],
};
const RT = { servicio: 'RT', agendas: [{ opl: '20021 - Ripley Chorrillos', agenda: 'A', activa: true, enCheckout: true }, { opl: '20048 - Ripley Breña', agenda: 'B', activa: false, enCheckout: false }] };
const CONSULTA = JSON.stringify({ tipo: 'consulta', depende_del_anterior: false, atajo: '(ninguno)', motivo: '' });
const PLAN = JSON.stringify({ pasos: [{ herramienta: 'busqueda_masiva', param: { servicio: ['RT'] } }] });

/** Un Gemini de mentira: lo que contesta cada rol, en orden */
function geminiDe(guion: Record<string, SalidaGemini[]>) {
  const llamadas: Array<{ rol: string; modelo: string }> = [];
  return {
    llamadas,
    generar: vi.fn(async (m: ModeloElegido) => {
      llamadas.push({ rol: m.rol, modelo: m.nombre });
      return guion[m.rol]?.shift() ?? { error: `el guion no tiene más para ${m.rol}` };
    }),
  };
}

function armar(guion: Record<string, SalidaGemini[]>, { interrumpida = false } = {}) {
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
  const ctxServ = { comprobarChat: vi.fn(async () => undefined), armar: vi.fn(async () => structuredClone(CTX)), rebuscar: vi.fn(async () => []) };
  const supabase = { admin: { rpc: vi.fn(async () => ({ data: 'm-1', error: null })) } };
  const masivo = { buscar: vi.fn(async () => structuredClone(RT)) };
  const ejecucion = new EjecucionV3Service(supabase as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, masivo as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const interrupcion = { registrar: vi.fn(), estaInterrumpida: vi.fn(() => interrumpida) };
  const agente = new AgenteV3Service(turnos as never, ctxServ as never, ejecucion, interrupcion as never, supabase as never, {} as never);
  const gemini = geminiDe(guion);
  const motor = new MotorV3Service(agente, gemini as never, interrupcion as never);
  return { motor, gemini, filas, masivo };
}

const tipos = (ev: EventoV3[]) => ev.map((e) => (e.tipo === 'etapa' ? `etapa:${e.etapa}` : e.tipo));

describe('MotorV3Service: el turno entero, sin n8n', () => {
  it('un mensaje: clasificar → armar → el aviso del plan → el paso → la respuesta, con un evento por cosa', async () => {
    const { motor, masivo } = armar({ clasificar: [{ salida: CONSULTA }], armar: [{ salida: PLAN }] });
    const ev = await motor.todo(motor.mensaje(USUARIO, { mensaje: 'dame las sucursales de la RT', chat_id: 'c' }));
    expect(tipos(ev)).toEqual(['turno', 'etapa:clasificar', 'etapa:armar', 'progreso', 'respuesta']);
    expect(masivo.buscar).toHaveBeenCalledTimes(1);
    const r = (ev.at(-1) as Extract<EventoV3, { tipo: 'respuesta' }>).respuesta;
    expect(r.frase).toBe('RT, 1 activas y 1 inactivas de 2 agendas.');
  });

  it('un modelo saturado: el motor prueba el que diga el backend (otro modelo), sin que nadie reintente a mano', async () => {
    const { motor, gemini } = armar({ clasificar: [{ error: '503 UNAVAILABLE The model is overloaded' }, { salida: CONSULTA }], armar: [{ salida: PLAN }] });
    const ev = await motor.todo(motor.mensaje(USUARIO, { mensaje: 'dame las sucursales de la RT', chat_id: 'c' }));
    expect(tipos(ev)).toEqual(['turno', 'etapa:clasificar', 'etapa:clasificar', 'etapa:armar', 'progreso', 'respuesta']);
    expect(gemini.llamadas[0].modelo).not.toBe(gemini.llamadas[1].modelo);
  });

  it('una pregunta deja el turno esperando; la respuesta lo sigue donde estaba', async () => {
    const { motor, filas } = armar({ clasificar: [{ salida: CONSULTA }], armar: [{ salida: JSON.stringify({ pasos: [], faltan: ['¿De qué servicio?'] }) }, { salida: PLAN }] });
    const uno = await motor.todo(motor.mensaje(USUARIO, { mensaje: 'dame las sucursales', chat_id: 'c' }));
    expect(tipos(uno)).toEqual(['turno', 'etapa:clasificar', 'etapa:armar', 'pregunta']);
    const id = (uno[0] as Extract<EventoV3, { tipo: 'turno' }>).turno_id;
    expect(filas.get(id)!.estado).toBe('pregunta');
    const dos = await motor.todo(motor.contestar(USUARIO, id, { texto: 'la RT' }));
    expect(tipos(dos)).toEqual(['turno', 'etapa:armar', 'progreso', 'respuesta']);
  });

  it('"Detener": el turno se cierra donde esté (aquí, antes de pedirle nada a un modelo)', async () => {
    const { motor, gemini } = armar({ clasificar: [{ salida: CONSULTA }] }, { interrumpida: true });
    const ev = await motor.todo(motor.mensaje(USUARIO, { mensaje: 'dame las sucursales de la RT', chat_id: 'c', peticion_id: 'p1' }));
    expect(tipos(ev)).toEqual(['turno', 'respuesta']);
    expect((ev[1] as Extract<EventoV3, { tipo: 'respuesta' }>).respuesta.tipo).toBe('cancelada');
    expect(gemini.generar).not.toHaveBeenCalled();
  });

  it('un turno que no se puede empezar (el chat es de otro): un evento de error, sin romper', async () => {
    const { motor } = armar({});
    const otro = new MotorV3Service({ crear: vi.fn(async () => { throw new Error('Ese chat es de otra persona'); }) } as never, {} as never, { estaInterrumpida: () => false } as never);
    expect(await otro.todo(otro.mensaje(USUARIO, { mensaje: 'x', chat_id: 'c' }))).toEqual([{ tipo: 'error', mensaje: 'Ese chat es de otra persona' }]);
    expect(motor).toBeDefined();
  });
});

describe('El progreso, a la vista antes de cada paso que se retoma', () => {
  it('al seguir tras una pregunta (camino ejecutar), primero los pasos y luego la respuesta', async () => {
    const progreso = { tipo: 'progreso', pasos: [{ n: 1, que: 'Vista previa', estado: 'en_curso' }] };
    const agente = {
      respuesta: vi.fn(async () => ({ turno_id: 't1', camino: 'ejecutar' })),
      progresoDe: vi.fn(async () => progreso),
      ejecutar: vi.fn(async () => ({ turno_id: 't1', camino: 'responder', respuesta: { frase: 'listo' } })),
      obtener: vi.fn(async () => null),
    };
    const motor = new MotorV3Service(agente as never, {} as never, { estaInterrumpida: () => false } as never);
    const eventos = await motor.todo(motor.contestar(USUARIO, 't1', { respuestas: { 'zona:2': 'todas' } }));
    expect(eventos.map((e) => e.tipo)).toEqual(['turno', 'progreso', 'respuesta']);
  });
});
