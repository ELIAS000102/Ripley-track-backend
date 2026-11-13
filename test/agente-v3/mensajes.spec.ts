import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Pregunta, SalidaRuta, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';
import { MensajesV3Controller } from '../../src/agente-v3/motor/mensajes.controller.js';
import { MotorV3Service, type EventoV3 } from '../../src/agente-v3/motor/motor.service.js';
import { esRespuesta } from '../../src/agente-v3/preguntas.js';

/**
 * Fase B (2026-11-13): las rutas del panel sin n8n. Un flujo de eventos en la
 * misma petición, y lo que pasa con una pregunta pendiente cuando llega otro
 * mensaje (decisión del usuario: espera hasta el siguiente mensaje).
 */

const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };
const ZONA: Pregunta = { id: 'zona:1', etapa: 'zona', paso: 1, texto: '¿Cuál?', opciones: [], libre: null, dudas: [{ id: 'zona:1:1401', texto: '1401: ¿qué zona?', opciones: [{ id: 'Zona A', texto: '1401 · Zona A' }, { id: 'todas', texto: '1401 · todas' }] }] };
const FALTA: Pregunta = { id: 'armar:abierta', etapa: 'armar', texto: '¿De qué servicio?', opciones: [], libre: 'Escríbelo aquí' };

/** Un "Response" de Express de mentira: lo que se escribe, y si se cerró */
function respuestaDeMentira() {
  const res = Object.assign(new EventEmitter(), {
    lineas: [] as string[], estado: 0, cabeceras: {} as Record<string, string>, writableEnded: false,
    status(n: number) { res.estado = n; return res; },
    setHeader(k: string, v: string) { res.cabeceras[k] = v; },
    flushHeaders() {},
    write(s: string) { res.lineas.push(s); return true; },
    end() { res.writableEnded = true; },
  });
  return res;
}

async function* eventos(lista: EventoV3[], alSalir?: () => void) {
  for (const e of lista) yield e;
  alSalir?.();
}

describe('La ruta: un flujo de eventos, una línea JSON por evento', () => {
  const controller = new MensajesV3Controller({} as never);
  it('cada evento según llega, y al final se cierra', async () => {
    const res = respuestaDeMentira();
    await controller.enviar(res as never, eventos([{ tipo: 'turno', turno_id: 't1' }, { tipo: 'etapa', etapa: 'clasificar', modelo: 'm' }]));
    expect(res.estado).toBe(200);
    expect(res.cabeceras['Content-Type']).toBe('application/x-ndjson; charset=utf-8');
    expect(res.lineas.map((l) => JSON.parse(l))).toEqual([{ tipo: 'turno', turno_id: 't1' }, { tipo: 'etapa', etapa: 'clasificar', modelo: 'm' }]);
    expect(res.writableEnded).toBe(true);
  });

  it('si el panel se va a mitad, el turno sigue hasta el final (sin escribir)', async () => {
    const res = respuestaDeMentira();
    let terminado = false;
    async function* largo() {
      yield { tipo: 'turno', turno_id: 't1' } as EventoV3;
      res.emit('close');
      yield { tipo: 'respuesta', respuesta: {} } as EventoV3;
      terminado = true;
    }
    await controller.enviar(res as never, largo());
    expect(terminado).toBe(true);
    expect(res.lineas).toHaveLength(1);
  });
});

describe('Una pregunta pendiente y un mensaje nuevo', () => {
  it('¿contesta o es nuevo?: elegir y cancelar contestan; lo escrito, si la pregunta admite texto o es una opción', () => {
    expect(esRespuesta(ZONA, { respuestas: { 'zona:1:1401': 'todas' } })).toBe(true);
    expect(esRespuesta(ZONA, { cancelar: true })).toBe(true);
    expect(esRespuesta(ZONA, { texto: '1401 · Zona A' })).toBe(true);
    expect(esRespuesta(ZONA, { texto: 'dame las sucursales de la RT' })).toBe(false);
    expect(esRespuesta(FALTA, { texto: 'de la RT' })).toBe(true);
  });

  function motorCon(pendiente: Turno | null) {
    const salida = (id: string): SalidaRuta => ({ turno_id: id, camino: 'responder', modelo: null, prompt: null, progreso: null, pregunta: null, respuesta: { frase: 'ok' } as never });
    const agente = {
      pendienteDelChat: vi.fn(async () => pendiente),
      obtener: vi.fn(async () => pendiente),
      cerrarPendiente: vi.fn(async () => undefined),
      crear: vi.fn(async () => salida('nuevo')),
      respuesta: vi.fn(async () => salida(pendiente?.id ?? 'x')),
    };
    const motor = new MotorV3Service(agente as never, {} as never, { estaInterrumpida: () => false } as never);
    return { motor, agente };
  }
  const turno = (p: Pregunta) => ({ id: 'viejo', chat_id: 'c', estado: 'pregunta', contexto: { pregunta: p } }) as unknown as Turno;

  it('con una pregunta que admite texto, lo escrito la contesta (sigue aquel turno)', async () => {
    const { motor, agente } = motorCon(turno(FALTA));
    const ev = await motor.todo(motor.mensaje(USUARIO, { mensaje: 'de la RT', chat_id: 'c' }));
    expect(agente.respuesta).toHaveBeenCalledWith(USUARIO, 'viejo', { texto: 'de la RT' });
    expect(agente.crear).not.toHaveBeenCalled();
    expect(ev[0]).toEqual({ tipo: 'turno', turno_id: 'viejo' });
  });

  it('con una de opciones (qué zona), otra cosa es un mensaje nuevo: aquel turno se cierra y empieza otro', async () => {
    const { motor, agente } = motorCon(turno(ZONA));
    const ev = await motor.todo(motor.mensaje(USUARIO, { mensaje: 'dame las sucursales de la RT', chat_id: 'c' }));
    expect(agente.cerrarPendiente).toHaveBeenCalledWith(USUARIO, 'viejo');
    expect(agente.crear).toHaveBeenCalledWith(USUARIO, { mensaje: 'dame las sucursales de la RT', chat_id: 'c' });
    expect(ev[0]).toEqual({ tipo: 'turno', turno_id: 'nuevo' });
  });

  it('lo mismo si llega por "contestar" (el panel creía que era la respuesta)', async () => {
    const { motor, agente } = motorCon(turno(ZONA));
    await motor.todo(motor.contestar(USUARIO, 'viejo', { texto: 'dame las sucursales de la RT' }, 'p1'));
    expect(agente.cerrarPendiente).toHaveBeenCalledWith(USUARIO, 'viejo');
    expect(agente.crear).toHaveBeenCalledWith(USUARIO, { mensaje: 'dame las sucursales de la RT', chat_id: 'c', peticion_id: 'p1' });
  });

  it('sin pregunta pendiente, un turno nuevo como siempre', async () => {
    const { motor, agente } = motorCon(null);
    await motor.todo(motor.mensaje(USUARIO, { mensaje: 'hola', chat_id: 'c' }));
    expect(agente.cerrarPendiente).not.toHaveBeenCalled();
    expect(agente.crear).toHaveBeenCalledTimes(1);
  });
});
