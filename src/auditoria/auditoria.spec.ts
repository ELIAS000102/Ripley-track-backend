import {
  Controller,
  Get,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestModule,
  Put,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditoriaInterceptor } from './auditoria.interceptor.js';
import { AuditoriaMiddleware } from './auditoria.middleware.js';
import { AuditoriaService } from './auditoria.service.js';
import { ContextoAuditoria } from './contexto-auditoria.service.js';
import { Auditar } from './decorators/auditar.decorator.js';
import type { RegistroUso } from './interfaces/auditoria.interface.js';

/**
 * Reproduce el cableado real —middleware, interceptor y un service que reporta
 * su cambio— para comprobar que el contexto sobrevive hasta el final.
 *
 * Es el punto frágil del diseño: si el contexto se abriera en el interceptor en
 * vez del middleware, el handler correría fuera de él y el "antes/después"
 * llegaría vacío sin que nada fallara a la vista.
 */

@Injectable()
class ServicioDePrueba {
  constructor(private readonly contexto: ContextoAuditoria) {}

  async cambiarAlgo() {
    // Varios saltos asíncronos: el contexto tiene que sobrevivir a todos
    await new Promise((r) => setTimeout(r, 5));
    this.contexto.registrarCambio({ assigned: 300 }, { assigned: 500 });
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true };
  }
}

@Controller('prueba')
class ControladorDePrueba {
  constructor(private readonly servicio: ServicioDePrueba) {}

  @Auditar('prueba.cambio')
  @Put('con-auditoria')
  conAuditoria() {
    return this.servicio.cambiarAlgo();
  }

  @Put('sin-auditoria')
  sinAuditoria() {
    return this.servicio.cambiarAlgo();
  }

  /**
   * Una consulta marcada por descuido.
   *
   * Es el caso real que motivó la regla: las seis consultas del agente
   * llevaban @Auditar y llenaban la tabla de filas que no decían nada.
   */
  @Auditar('prueba.consultaMarcada')
  @Get('consulta-marcada')
  consultaMarcada() {
    return this.servicio.cambiarAlgo();
  }
}

describe('Auditoría de cambios', () => {
  let app: Awaited<ReturnType<typeof crearApp>>;
  let guardadas: RegistroUso[];

  async function crearApp() {
    guardadas = [];

    const registrar = vi.fn((fila: RegistroUso) => {
      guardadas.push(fila);
    });

    // El service real, pero sin tocar Supabase: solo interesa qué fila se arma
    const auditoriaFalsa = {
      registrar,
      censurar: new AuditoriaService(null as never).censurar.bind(
        new AuditoriaService(null as never),
      ),
    };

    @Module({
      controllers: [ControladorDePrueba],
      providers: [
        ServicioDePrueba,
        ContextoAuditoria,
        AuditoriaMiddleware,
        { provide: AuditoriaService, useValue: auditoriaFalsa },
        { provide: APP_INTERCEPTOR, useClass: AuditoriaInterceptor },
      ],
    })
    class ModuloDePrueba implements NestModule {
      configure(consumer: MiddlewareConsumer) {
        consumer.apply(AuditoriaMiddleware).forRoutes('*');
      }
    }

    const modulo = await Test.createTestingModule({
      imports: [ModuloDePrueba],
    }).compile();

    const instancia = modulo.createNestApplication();
    await instancia.init();
    return instancia;
  }

  beforeEach(async () => {
    app = await crearApp();
  });

  it('guarda el estado anterior y el nuevo en un endpoint marcado con @Auditar', async () => {
    await request(app.getHttpServer()).put('/prueba/con-auditoria').expect(200);

    expect(guardadas).toHaveLength(1);

    const fila = guardadas[0];
    expect(fila.accion).toBe('prueba.cambio');
    expect(fila.datos_antes).toEqual({ assigned: 300 });
    expect(fila.datos_despues).toEqual({ assigned: 500 });
    expect(fila.exitoso).toBe(true);
    expect(fila.estado).toBe(200);
  });

  it('no registra nada en un endpoint sin @Auditar', async () => {
    await request(app.getHttpServer()).put('/prueba/sin-auditoria').expect(200);

    expect(guardadas).toHaveLength(0);
  });

  it('ignora la marca sobre una consulta, aunque el handler cambie algo', async () => {
    // Un GET no genera un cambio por definición: al historial de cambios no
    // va, y da igual que esté marcado o que por dentro haga lo que sea.
    await request(app.getHttpServer())
      .get('/prueba/consulta-marcada')
      .expect(200);

    expect(guardadas).toHaveLength(0);
  });

  it('aísla el contexto entre peticiones simultáneas', async () => {
    await Promise.all([
      request(app.getHttpServer()).put('/prueba/con-auditoria').expect(200),
      request(app.getHttpServer()).put('/prueba/con-auditoria').expect(200),
      request(app.getHttpServer()).put('/prueba/con-auditoria').expect(200),
    ]);

    expect(guardadas).toHaveLength(3);
    guardadas.forEach((fila) => {
      expect(fila.datos_antes).toEqual({ assigned: 300 });
      expect(fila.datos_despues).toEqual({ assigned: 500 });
    });
  });
});

describe('Censura de datos sensibles', () => {
  const servicio = new AuditoriaService(null as never);

  it('oculta contraseñas y tokens, y deja el resto intacto', () => {
    const censurado = servicio.censurar({
      email: 'user@ripley.com',
      password: 'secreto',
      refreshToken: 'rt-1',
      assigned: 500,
      anidado: { apiKey: 'k', valor: 1 },
    });

    expect(censurado).toEqual({
      email: 'user@ripley.com',
      password: '[CENSURADO]',
      refreshToken: '[CENSURADO]',
      assigned: 500,
      anidado: { apiKey: '[CENSURADO]', valor: 1 },
    });
  });
});
