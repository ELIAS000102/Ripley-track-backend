import {
  BadRequestException,
  Controller,
  Get,
  MiddlewareConsumer,
  Module,
  NestModule,
  Post,
  Put,
} from '@nestjs/common';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditoriaInterceptor } from '../../src/auditoria/auditoria.interceptor.js';
import { AuditoriaMiddleware, pideSimulacro } from '../../src/auditoria/auditoria.middleware.js';
import { AuditoriaService } from '../../src/auditoria/auditoria.service.js';
import { ContextoAuditoria } from '../../src/auditoria/contexto-auditoria.service.js';
import { Auditar } from '../../src/auditoria/decorators/auditar.decorator.js';
import type { RegistroUso } from '../../src/auditoria/interfaces/auditoria.interface.js';
import { SimulacroInterceptor, SinMarcaSimulacro } from '../../src/auditoria/simulacro.interceptor.js';
import type { CacheCatalogosService } from '../../src/common/ripley/cache-catalogos.service.js';
import { RipleyHttpService } from '../../src/common/ripley/ripley-http.service.js';
import type { TokenRipleyService } from '../../src/configuracion/token-ripley/token-ripley.service.js';

/**
 * El simulacro: una petición que recorre todo como si fuera de verdad, pero
 * sin escribir nada en Ripley.
 *
 * Es lo que permitirá probar una rutina sin tocar ninguna agenda, así que lo
 * que se fija aquí es lo que no puede fallar: que **ninguna escritura salga**,
 * que las lecturas sí —también las que van por POST—, que la respuesta diga
 * que fue un simulacro, y que una petición en simulacro no contagie a otra que
 * corre a la vez.
 *
 * Se monta el cableado real —middleware, interceptores y el cliente de Ripley—
 * sobre un HTTP falso que apunta lo que le llega.
 */

const USUARIO = { id: 'u1', email: 'ana@ejemplo.com' };

@Controller('prueba')
class ControladorDePrueba {
  constructor(
    private readonly ripley: RipleyHttpService,
    private readonly contexto: ContextoAuditoria,
  ) {}

  /** Como un service de agendas: lee, escribe y mira la respuesta */
  @Auditar('prueba.escribir')
  @Put('escribir')
  async escribir() {
    this.contexto.identificarUsuario(USUARIO.id, USUARIO.email);
    const antes = await this.ripley.get<{ valor: number }>('/dato', 'PE');
    const r = await this.ripley.put<{ matchedCount?: number }>('/dato', 'PE', { valor: 2 }, undefined, { matchedCount: 1 });
    return { antes: antes.valor, coincidencias: r.matchedCount };
  }

  /** Un POST que solo lee, como listar los servicios de un OPL */
  @Post('leer')
  async leer() {
    this.contexto.identificarUsuario(USUARIO.id, USUARIO.email);
    return this.ripley.postDeLectura<{ filas: number }>('/buscar', 'PE', { q: 'x' });
  }

  /** Un POST que escribe sin decir qué respondería Ripley */
  @Post('enviar')
  async enviar() {
    this.contexto.identificarUsuario(USUARIO.id, USUARIO.email);
    return { respuesta: await this.ripley.post('/enviar', 'PE', { a: 1 }) };
  }

  @Get('lista')
  lista() {
    return [1, 2, 3];
  }

  /** Una respuesta que no habla de Ripley, como el aviso de un paso de una rutina */
  @SinMarcaSimulacro()
  @Post('aviso')
  aviso() {
    return { seguir: true };
  }
}

async function montar() {
  const guardadas: RegistroUso[] = [];

  const http = {
    get: vi.fn(() => of({ data: { valor: 1 } })),
    put: vi.fn(() => of({ data: { matchedCount: 7 } })),
    post: vi.fn(() => of({ data: { filas: 3 } })),
  };
  const config = {
    get: (clave: string) => (clave === 'ripley.urls' ? { PE: 'https://interno' } : '/x'),
  } as unknown as ConfigService;
  const tokens = { obtenerParaUso: vi.fn().mockResolvedValue('token') };
  const cache = { olvidar: vi.fn() };

  const auditoriaFalsa = {
    registrar: vi.fn((fila: RegistroUso) => guardadas.push(fila)),
    censurar: new AuditoriaService(null as never).censurar.bind(new AuditoriaService(null as never)),
  };

  @Module({
    controllers: [ControladorDePrueba],
    providers: [
      ContextoAuditoria,
      AuditoriaMiddleware,
      { provide: AuditoriaService, useValue: auditoriaFalsa },
      {
        provide: RipleyHttpService,
        inject: [ContextoAuditoria],
        useFactory: (contexto: ContextoAuditoria) =>
          new RipleyHttpService(
            http as unknown as HttpService,
            config,
            contexto,
            tokens as unknown as TokenRipleyService,
            cache as unknown as CacheCatalogosService,
          ),
      },
      { provide: APP_INTERCEPTOR, useClass: AuditoriaInterceptor },
      { provide: APP_INTERCEPTOR, useClass: SimulacroInterceptor },
    ],
  })
  class ModuloDePrueba implements NestModule {
    configure(consumer: MiddlewareConsumer) {
      consumer.apply(AuditoriaMiddleware).forRoutes('*');
    }
  }

  const modulo = await Test.createTestingModule({ imports: [ModuloDePrueba] }).compile();
  const app = modulo.createNestApplication();
  await app.init();

  return { servidor: app.getHttpServer(), http, tokens, cache, guardadas };
}

describe('En simulacro, nada se escribe en Ripley', () => {
  let m: Awaited<ReturnType<typeof montar>>;
  beforeEach(async () => {
    m = await montar();
  });

  it('el PUT no sale, y quien llama recibe lo que Ripley habría respondido', async () => {
    const r = await request(m.servidor).put('/prueba/escribir').set('X-Simulacro', 'si').expect(200);

    expect(m.http.put).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({ antes: 1, coincidencias: 1 });
  });

  it('las lecturas sí van a Ripley: sin ellas no hay qué probar', async () => {
    await request(m.servidor).put('/prueba/escribir').set('X-Simulacro', 'si').expect(200);
    expect(m.http.get).toHaveBeenCalledTimes(1);
  });

  it('también las que van por POST, si son de lectura', async () => {
    const r = await request(m.servidor).post('/prueba/leer').set('X-Simulacro', 'si').expect(201);

    expect(m.http.post).toHaveBeenCalledTimes(1);
    expect(r.body.filas).toBe(3);
  });

  it('un POST que escribe no sale, y lo de por defecto no se hace pasar por Ripley', async () => {
    const r = await request(m.servidor).post('/prueba/enviar').set('X-Simulacro', 'si').expect(201);

    expect(m.http.post).not.toHaveBeenCalled();
    expect(r.body.respuesta).toEqual({ simulado: true });
  });

  it('la respuesta lo dice: cabecera, cuántas escrituras se evitaron y que el "después" es lo que quedaría', async () => {
    const r = await request(m.servidor).put('/prueba/escribir').set('X-Simulacro', 'si').expect(200);

    expect(r.headers['x-simulacro']).toBe('si');
    expect(r.body.simulacro.escriturasEvitadas).toBe(1);
    expect(r.body.simulacro.aviso).toMatch(/no se cambió nada en Ripley.*lo que quedaría/);
  });

  it('una lista se queda como lista: solo lleva la cabecera', async () => {
    const r = await request(m.servidor).get('/prueba/lista').set('X-Simulacro', 'si').expect(200);

    expect(r.body).toEqual([1, 2, 3]);
    expect(r.headers['x-simulacro']).toBe('si');
  });

  it('una ruta con @SinMarcaSimulacro no se marca: su respuesta no habla de Ripley', async () => {
    const r = await request(m.servidor).post('/prueba/aviso').set('X-Simulacro', 'si').expect(201);

    expect(r.body).toEqual({ seguir: true });
    expect(r.headers['x-simulacro']).toBeUndefined();
  });

  it('la caché de catálogos no se olvida: nada cambió', async () => {
    await request(m.servidor).put('/prueba/escribir').set('X-Simulacro', 'si').expect(200);
    expect(m.cache.olvidar).not.toHaveBeenCalled();
  });

  it('sin token de Ripley falla igual que fallaría de verdad', async () => {
    m.tokens.obtenerParaUso.mockRejectedValue(new BadRequestException('No tienes guardado el token de Ripley de PE'));

    const r = await request(m.servidor).put('/prueba/escribir').set('X-Simulacro', 'si').expect(400);

    expect(r.body.message).toMatch(/token de Ripley/);
    expect(m.http.put).not.toHaveBeenCalled();
  });

  it('el registro de uso lo anota, pero marcado: no fue un cambio', async () => {
    await request(m.servidor).put('/prueba/escribir').set('X-Simulacro', 'si').expect(200);

    expect(m.guardadas.map((g) => g.accion)).toEqual(['prueba.escribir.simulacro']);
  });
});

describe('Sin simulacro, todo sigue igual', () => {
  let m: Awaited<ReturnType<typeof montar>>;
  beforeEach(async () => {
    m = await montar();
  });

  it('el PUT sale, con la respuesta de verdad, sin marca y con la acción de siempre', async () => {
    const r = await request(m.servidor).put('/prueba/escribir').expect(200);

    expect(m.http.put).toHaveBeenCalledTimes(1);
    expect(r.body).toEqual({ antes: 1, coincidencias: 7 });
    expect(r.headers['x-simulacro']).toBeUndefined();
    expect(m.guardadas.map((g) => g.accion)).toEqual(['prueba.escribir']);
    expect(m.cache.olvidar).toHaveBeenCalledWith('PE');
  });

  it('"X-Simulacro: no" es no', async () => {
    await request(m.servidor).put('/prueba/escribir').set('X-Simulacro', 'no').expect(200);
    expect(m.http.put).toHaveBeenCalledTimes(1);
  });

  it('una petición en simulacro no contagia a la que corre a la vez, ni al revés', async () => {
    const [simulada, real] = await Promise.all([
      request(m.servidor).put('/prueba/escribir').set('X-Simulacro', 'si'),
      request(m.servidor).put('/prueba/escribir'),
    ]);

    expect(m.http.put).toHaveBeenCalledTimes(1);
    expect(simulada.body.simulacro).toBeDefined();
    expect(real.body.simulacro).toBeUndefined();
  });
});

describe('Qué pide un simulacro', () => {
  it.each(['si', 'sí', 'SI', '1', 'true', 'yes'])('"%s" lo pide: ante la duda, no se escribe', (valor) => {
    expect(pideSimulacro(valor)).toBe(true);
  });

  it.each([undefined, '', '  ', 'no', 'NO', '0', 'false'])('%j no', (valor) => {
    expect(pideSimulacro(valor)).toBe(false);
  });
});

describe('Una vez en simulacro, no se sale', () => {
  it('activarlo a mitad de petición vale desde ese momento, y no hay forma de apagarlo', () => {
    const contexto = new ContextoAuditoria();

    contexto.ejecutar(() => {
      expect(contexto.enSimulacro()).toBe(false);
      contexto.activarSimulacro();
      contexto.activarSimulacro();
      expect(contexto.enSimulacro()).toBe(true);
      expect(Object.getOwnPropertyNames(ContextoAuditoria.prototype).filter((m) => /desactivar|salir/i.test(m))).toEqual([]);
    });
  });

  it('las escrituras evitadas se cuentan por petición', () => {
    const contexto = new ContextoAuditoria();

    contexto.ejecutar(() => {
      contexto.anotarEscrituraEvitada({ metodo: 'put', accion: 'actualizar' });
      expect(contexto.escriturasEvitadas()).toEqual([{ metodo: 'put', accion: 'actualizar' }]);
    }, { simulacro: true });

    // Otra petición empieza de cero, y fuera de una no hay simulacro que valga
    contexto.ejecutar(() => expect(contexto.escriturasEvitadas()).toEqual([]), { simulacro: true });
    expect(contexto.enSimulacro()).toBe(false);
  });
});
