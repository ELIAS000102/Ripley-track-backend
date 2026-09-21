import { BadGatewayException } from '@nestjs/common';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { TokenRipleyService } from '../../configuracion/token-ripley/token-ripley.service.js';
import { RipleyApiError } from './ripley.errors.js';
import { RipleyHttpService } from './ripley-http.service.js';

/**
 * La dirección de la API corporativa no sale por ningún lado.
 *
 * Ni en la respuesta ni en el log. En la respuesta importa porque lo que recibe
 * el agente acaba impreso en el chat; en el log importa porque una consola se
 * comparte en capturas, en tickets y en el panel del proveedor de la nube.
 *
 * Y un 404 no es un fallo: una agenda sin capacidades creadas devuelve eso, así
 * que se lanza como "no encontrado" y no como error del servidor. Cuando subía
 * sin más, el manejador de excepciones imprimía una traza por cada agenda vacía.
 */

const HOST = 'https://api-pe.ripley.com';
const RUTA = '/retail/supply/logistic/configuration/v1/capacities/picking';

/** Lo que devuelve axios cuando la API responde con un código de error */
const falloAxios = (status: number) => ({
  message: `Request failed with status code ${status}`,
  response: { status, data: { mensaje: 'algo' } },
  config: { url: `${HOST}${RUTA}/651c80d6` },
});

function armar(fallo: unknown) {
  const http = {
    get: vi.fn(() => throwError(() => fallo)),
  } as unknown as HttpService;

  const config = {
    get: vi.fn((clave: string) =>
      clave === 'ripley.urls' ? { PE: HOST } : `${RUTA}`,
    ),
  } as unknown as ConfigService;

  const contexto = {
    usuarioActual: () => ({ id: 'u1', email: 'ana@ripley.com.pe' }),
  } as unknown as ContextoAuditoria;

  const tokens = {
    obtenerParaUso: vi.fn().mockResolvedValue('token-corporativo'),
  } as unknown as TokenRipleyService;

  const servicio = new RipleyHttpService(http, config, contexto, tokens);

  // El logger de la instancia, para vigilar qué se escribe
  const logger = (servicio as unknown as { logger: Record<string, unknown> })
    .logger;
  const escrito: string[] = [];

  for (const nivel of ['log', 'warn', 'error', 'debug', 'verbose']) {
    logger[nivel] = vi.fn((...args: unknown[]) => {
      escrito.push(args.map((a) => String(a)).join(' '));
    });
  }

  return { servicio, escrito };
}

/**
 * El error de una llamada que tiene que fallar.
 *
 * `.catch()` devolvería la unión con el tipo resuelto, y aquí siempre falla.
 */
async function capturar(servicio: RipleyHttpService): Promise<Error> {
  try {
    await servicio.get<unknown>('/lo-que-sea', 'PE');
  } catch (e) {
    return e as Error;
  }

  throw new Error('la llamada no falló, y esta prueba necesita que falle');
}

/** Nada de lo que se escriba puede delatar la API corporativa */
function sinRastro(textos: string[]) {
  const todo = textos.join('\n');

  expect(todo).not.toMatch(/https?:\/\//);
  expect(todo).not.toMatch(/ripley\.com/);
  expect(todo).not.toMatch(/capacities\/picking/);
}

describe('Cuando la API corporativa dice que no hay recurso (404)', () => {
  it('lanza un "no encontrado", no un error del servidor', async () => {
    const { servicio } = armar(falloAxios(404));

    const error = await capturar(servicio);

    expect(error).toBeInstanceOf(RipleyApiError);
    expect((error as RipleyApiError).getStatus()).toBe(404);
    expect((error as RipleyApiError).esNoEncontrado).toBe(true);
  });

  it('sin la dirección en el mensaje', async () => {
    const { servicio } = armar(falloAxios(404));

    const error = await capturar(servicio);

    sinRastro([error.message]);
  });

  it('sin la dirección en el objeto de error, que el log imprime entero', async () => {
    const { servicio } = armar(falloAxios(404));

    const error = await capturar(servicio);

    sinRastro([JSON.stringify(error), ...Object.values(error).map(String)]);
  });

  it('y sin escribir nada en el log: una agenda vacía no es una incidencia', async () => {
    const { servicio, escrito } = armar(falloAxios(404));

    await servicio.get('/lo-que-sea', 'PE').catch(() => undefined);

    expect(escrito).toEqual([]);
  });
});

describe('Cuando la API corporativa falla de verdad', () => {
  it('sale como 502 y dice el código que respondió', async () => {
    const { servicio } = armar(falloAxios(500));

    const error = await capturar(servicio);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect(error.message).toMatch(/respondió 500/);
  });

  it('eso sí se registra, pero sin la dirección', async () => {
    const { servicio, escrito } = armar(falloAxios(500));

    await servicio.get('/lo-que-sea', 'PE').catch(() => undefined);

    expect(escrito.length).toBeGreaterThan(0);
    sinRastro(escrito);
  });

  it('y el mensaje que viaja tampoco la lleva', async () => {
    const { servicio } = armar(falloAxios(502));

    const error = await capturar(servicio);

    sinRastro([error.message, JSON.stringify(error)]);
  });

  it('si no hubo respuesta, lo dice sin inventar un código', async () => {
    const { servicio } = armar({ message: 'connect ETIMEDOUT' });

    const error = await capturar(servicio);

    expect(error.message).toMatch(/No se pudo contactar/);
  });
});
