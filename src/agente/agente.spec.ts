//src/agente/agente.spec.ts
import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PermitidoAgente } from './decorators/permitido-agente.decorator.js';
import { AgenteGuard } from './guards/agente.guard.js';

/**
 * Fija las dos garantías que sostienen al agente de IA:
 *
 * 1. La lista es cerrada: lo que nadie marcó explícitamente queda fuera, así que
 *    un endpoint nuevo nace bloqueado aunque quien lo escriba no sepa que el
 *    agente existe.
 * 2. El token corporativo de Ripley es inalcanzable, incluso si alguien marca
 *    esas rutas por error. Ese caso es el que prueba `TokenPorDescuidoController`:
 *    lleva @PermitidoAgente() a propósito, y aun así debe responder 403.
 */

@Controller('consultas')
class ConsultasController {
  @PermitidoAgente()
  @Get('permitida')
  permitida() {
    return { ok: true };
  }

  @Get('sin-marcar')
  sinMarcar() {
    return { ok: true };
  }

  @Post('escribir')
  escribir() {
    return { ok: true };
  }
}

/** Simula el descuido: alguien marca la gestión del token como accesible. */
@Controller('configuracion/token-ripley')
class TokenPorDescuidoController {
  @PermitidoAgente()
  @Get('estado')
  estado() {
    return { ok: true };
  }

  @PermitidoAgente()
  @Post()
  guardar() {
    return { ok: true };
  }
}

describe('AgenteGuard', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [ConsultasController, TokenPorDescuidoController],
      providers: [{ provide: APP_GUARD, useClass: AgenteGuard }],
    }).compile();

    app = modulo.createNestApplication();
    await app.init();
  });

  // Cada test levanta su propia app; sin esto se quedarían abiertas.
  afterEach(async () => {
    await app.close();
  });

  const servidor = () => app.getHttpServer();
  const comoAgente = (r: request.Test) => r.set('X-Origen', 'agente');

  it('deja pasar lo marcado con @PermitidoAgente()', async () => {
    await comoAgente(request(servidor()).get('/consultas/permitida')).expect(
      200,
    );
  });

  it('bloquea lo que nadie marcó', async () => {
    await comoAgente(request(servidor()).get('/consultas/sin-marcar')).expect(
      403,
    );
    await comoAgente(request(servidor()).post('/consultas/escribir')).expect(
      403,
    );
  });

  it('bloquea el token de Ripley aunque esté marcado por error', async () => {
    const estado = await comoAgente(
      request(servidor()).get('/configuracion/token-ripley/estado'),
    ).expect(403);

    expect(estado.body.message).toContain('token de Ripley');

    await comoAgente(request(servidor()).post('/configuracion/token-ripley'))
      .send({ pais: 'PE', token: 'lo-que-sea' })
      .expect(403);
  });

  it('no estorba a las peticiones que no vienen del agente', async () => {
    // Sin la cabecera es una persona en el panel: le toca su sesión, no esto.
    await request(servidor()).get('/consultas/sin-marcar').expect(200);
    await request(servidor()).post('/consultas/escribir').expect(201);
    await request(servidor())
      .get('/configuracion/token-ripley/estado')
      .expect(200);
  });

  it('reconoce la cabecera sin importar mayúsculas', async () => {
    await request(servidor())
      .get('/consultas/sin-marcar')
      .set('X-Origen', 'AGENTE')
      .expect(403);
  });
});
