import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SinRastroInterceptor } from './sin-rastro.interceptor.js';

/**
 * Lo que el agente devuelve acaba impreso en el chat.
 *
 * Pasó de verdad: un 404 de la API corporativa llevaba el endpoint entero en el
 * mensaje —host, path y query— y el agente lo publicó en la conversación como
 * un aviso más. El origen está arreglado, pero por estas respuestas viajan
 * también los textos de error que escribe la propia API de Ripley, y ahí no se
 * controla qué ponen.
 */

/** Un aviso como el que se vio en el chat */
const AVISO_REAL =
  'Agenda Picking SD - NO FUNCIONAL: Recurso no encontrado en ' +
  'https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/capacities/picking/640ba2d6df0e3e0012988d05?from=20-09-2026';

@Controller('prueba')
class ControladorDePrueba {
  @Get('respuesta')
  respuesta() {
    return {
      oficina: '20040',
      sinDatos: [AVISO_REAL],
      agendas: [
        { nombre: 'Agenda Picking DT - 20040', asignado: 30 },
        { nombre: 'anidado', detalle: { aviso: AVISO_REAL } },
      ],
    };
  }

  @Get('webhook')
  webhook() {
    return { webhookUrl: 'https://n8n.example.com/webhook/abc-123' };
  }

  @Get('falla')
  falla(): never {
    throw new Error(AVISO_REAL);
  }
}

describe('Lo que sale hacia el agente no lleva direcciones', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [ControladorDePrueba],
    }).compile();

    app = modulo.createNestApplication();
    app.useGlobalInterceptors(new SinRastroInterceptor());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const servidor = () => app.getHttpServer();
  const comoAgente = (r: request.Test) => r.set('X-Origen', 'agente');

  it('borra la URL del aviso que se vio en el chat', async () => {
    const r = await comoAgente(request(servidor()).get('/prueba/respuesta'));

    expect(r.body.sinDatos[0]).not.toMatch(/https?:/);
    expect(r.body.sinDatos[0]).not.toMatch(/ripley\.com/);
    // El resto del aviso se conserva: dice qué agenda falló
    expect(r.body.sinDatos[0]).toMatch(/Agenda Picking SD - NO FUNCIONAL/);
  });

  it('también en lo que va anidado', async () => {
    const r = await comoAgente(request(servidor()).get('/prueba/respuesta'));

    expect(r.body.agendas[1].detalle.aviso).not.toMatch(/api-pe/);
  });

  it('no toca los datos que no son direcciones', async () => {
    const r = await comoAgente(request(servidor()).get('/prueba/respuesta'));

    expect(r.body.oficina).toBe('20040');
    expect(r.body.agendas[0]).toEqual({
      nombre: 'Agenda Picking DT - 20040',
      asignado: 30,
    });
  });

  it('borra la dirección también de un error', async () => {
    const r = await comoAgente(request(servidor()).get('/prueba/falla'));

    expect(JSON.stringify(r.body)).not.toMatch(/https?:\/\//);
    expect(JSON.stringify(r.body)).not.toMatch(/ripley\.com/);
  });

  it('al panel no le recorta nada', async () => {
    // El panel es la vista de quien ya tiene la sesión, y muestra la dirección
    // del webhook a propósito. Protegerlo de sí mismo sería romperlo.
    const r = await request(servidor()).get('/prueba/webhook').expect(200);

    expect(r.body.webhookUrl).toBe('https://n8n.example.com/webhook/abc-123');
  });

  it('pero al agente sí, aunque sea la del propio flujo', async () => {
    const r = await comoAgente(request(servidor()).get('/prueba/webhook'));

    expect(r.body.webhookUrl).not.toMatch(/n8n/);
  });
});
