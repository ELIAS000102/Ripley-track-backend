//src/agente/agente.spec.ts
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  Post,
  Put,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestConUsuario } from '../auth/interfaces/auth.interface.js';
import {
  PermitidoAgente,
  PermitidoAgenteEditor,
} from './decorators/permitido-agente.decorator.js';
import { AgenteGuard } from './guards/agente.guard.js';
import { ModoAgenteService } from './modo.service.js';

/**
 * Fija las garantías que sostienen al agente de IA:
 *
 * 1. La lista es cerrada: lo que nadie marcó explícitamente queda fuera, así que
 *    un endpoint nuevo nace bloqueado aunque quien lo escriba no sepa que el
 *    agente existe.
 * 2. El token corporativo de Ripley es inalcanzable, incluso si alguien marca
 *    esas rutas por error. Ese caso es el que prueba `TokenPorDescuidoController`:
 *    lleva @PermitidoAgente() a propósito, y aun así debe responder 403.
 * 3. Escribir exige el modo editor **del usuario que pregunta**, comprobado
 *    contra el servidor. Sin él, 403 aunque la ruta esté marcada.
 * 4. El agente no puede cambiarse el modo a sí mismo. Es la garantía de la que
 *    dependen todas las demás: si pudiera, bastaría una instrucción colada en
 *    un dato para que se concediera permiso y acto seguido escribiera.
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

@Controller('edicion')
class EdicionController {
  @PermitidoAgenteEditor()
  @Put('capacidad')
  editar() {
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

/** El mismo descuido, pero sobre el interruptor: marcarlo no debe abrirlo. */
@Controller('agente/modo')
class ModoPorDescuidoController {
  @PermitidoAgente()
  @Get()
  leer() {
    return { ok: true };
  }

  @PermitidoAgenteEditor()
  @Put()
  cambiar() {
    return { ok: true };
  }
}

/** Hace el papel del guard de sesión: el usuario llega en una cabecera */
@Injectable()
class SesionFalsa implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    const peticion = contexto.switchToHttp().getRequest<RequestConUsuario>();
    const id = peticion.get('x-usuario');

    if (id) peticion.usuario = { id, email: `${id}@ripley.com.pe` };

    return true;
  }
}

describe('AgenteGuard', () => {
  let app: INestApplication;
  let modo: ModoAgenteService;

  beforeEach(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [
        ConsultasController,
        EdicionController,
        TokenPorDescuidoController,
        ModoPorDescuidoController,
      ],
      providers: [
        ModoAgenteService,
        // El orden importa: la sesión resuelve el usuario que el otro lee
        { provide: APP_GUARD, useClass: SesionFalsa },
        { provide: APP_GUARD, useClass: AgenteGuard },
      ],
    }).compile();

    modo = modulo.get(ModoAgenteService);
    app = modulo.createNestApplication();
    await app.init();
  });

  // Cada test levanta su propia app; sin esto se quedarían abiertas.
  afterEach(async () => {
    await app.close();
  });

  const servidor = () => app.getHttpServer();
  const comoAgente = (r: request.Test, usuario = 'ana') =>
    r.set('X-Origen', 'agente').set('X-Usuario', usuario);

  describe('consultas', () => {
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

  describe('lista negra', () => {
    it('bloquea el token de Ripley aunque esté marcado por error', async () => {
      const estado = await comoAgente(
        request(servidor()).get('/configuracion/token-ripley/estado'),
      ).expect(403);

      expect(estado.body.message).toContain('token de Ripley');

      await comoAgente(request(servidor()).post('/configuracion/token-ripley'))
        .send({ pais: 'PE', token: 'lo-que-sea' })
        .expect(403);
    });

    it('el agente no puede leer ni cambiar su propio modo', async () => {
      // Ni siquiera en modo editor: si pudiera tocarlo, el interruptor no
      // serviría de nada, porque se lo pondría él solo.
      modo.activar('ana');

      const leer = await comoAgente(request(servidor()).get('/agente/modo'));
      expect(leer.status).toBe(403);
      expect(leer.body.message).toContain('una persona');

      await comoAgente(request(servidor()).put('/agente/modo'))
        .send({ modo: 'editor' })
        .expect(403);
    });

    it('el panel sí puede cambiar el modo', async () => {
      await request(servidor()).put('/agente/modo').expect(200);
    });
  });

  describe('escrituras y modo editor', () => {
    it('en modo consultor rechaza y dice cómo activarlo', async () => {
      const respuesta = await comoAgente(
        request(servidor()).put('/edicion/capacidad'),
      ).expect(403);

      expect(respuesta.body.message).toContain('modo consultor');
      expect(respuesta.body.message).toContain('interruptor');
    });

    it('en modo editor deja escribir', async () => {
      modo.activar('ana');

      await comoAgente(request(servidor()).put('/edicion/capacidad')).expect(
        200,
      );
    });

    it('al volver a consultor deja de dejar', async () => {
      modo.activar('ana');
      await comoAgente(request(servidor()).put('/edicion/capacidad')).expect(
        200,
      );

      modo.desactivar('ana');
      await comoAgente(request(servidor()).put('/edicion/capacidad')).expect(
        403,
      );
    });

    it('el modo es de cada usuario, no del backend', async () => {
      // Que Ana esté editando no puede habilitar la conversación de Beto
      modo.activar('ana');

      await comoAgente(
        request(servidor()).put('/edicion/capacidad'),
        'beto',
      ).expect(403);
    });

    it('sin usuario resuelto no se escribe', async () => {
      modo.activar('ana');

      // Con la cabecera del agente pero sin sesión: el guard de arriba dejaría
      // esto en 401 en la aplicación real; aquí se comprueba que este tampoco
      // lo deja pasar por su cuenta.
      await request(servidor())
        .put('/edicion/capacidad')
        .set('X-Origen', 'agente')
        .expect(403);
    });

    it('la ruta de edición sigue abierta para el panel', async () => {
      // El interruptor acota al agente, no a la persona: quien entra por el
      // panel ya pasó por su propia sesión y sus permisos.
      await request(servidor()).put('/edicion/capacidad').expect(200);
    });

    it('el modo editor no cambia nada en las consultas', async () => {
      modo.activar('ana');

      await comoAgente(request(servidor()).get('/consultas/permitida')).expect(
        200,
      );
      await comoAgente(request(servidor()).get('/consultas/sin-marcar')).expect(
        403,
      );
    });
  });
});

describe('ModoAgenteService', () => {
  let modo: ModoAgenteService;

  beforeEach(() => {
    modo = new ModoAgenteService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arranca en consultor', () => {
    expect(modo.estado('ana').modo).toBe('consultor');
    expect(modo.puedeEscribir('ana')).toBe(false);
  });

  it('caduca solo a la media hora', () => {
    vi.useFakeTimers();

    modo.activar('ana');
    expect(modo.puedeEscribir('ana')).toBe(true);

    vi.advanceTimersByTime(29 * 60 * 1000);
    expect(modo.puedeEscribir('ana')).toBe(true);

    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(modo.puedeEscribir('ana')).toBe(false);
  });

  it('volver a activarlo renueva el tiempo', () => {
    vi.useFakeTimers();

    modo.activar('ana');
    vi.advanceTimersByTime(29 * 60 * 1000);
    modo.activar('ana');

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(modo.puedeEscribir('ana')).toBe(true);
  });

  it('informa de cuánto queda, para que el panel pueda avisar', () => {
    const estado = modo.activar('ana');

    expect(estado.modo).toBe('editor');
    expect(estado.minutosRestantes).toBeGreaterThan(25);
    expect(estado.expiraEn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sin usuario no escribe', () => {
    expect(modo.puedeEscribir(undefined)).toBe(false);
    expect(modo.puedeEscribir('')).toBe(false);
  });
});
