import { BadRequestException, Controller, Get, MiddlewareConsumer, Module, NestModule, Put } from '@nestjs/common';
import type { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgenteGuard } from '../../src/agente/seguridad/agente.guard.js';
import { InterrupcionAgenteService } from '../../src/agente/seguridad/interrupcion.service.js';
import { ModoAgenteService } from '../../src/agente/seguridad/modo.service.js';
import { PermitidoAgente, PermitidoAgenteEditor } from '../../src/agente/seguridad/permitido-agente.decorator.js';
import { AuditoriaMiddleware } from '../../src/auditoria/auditoria.middleware.js';
import { ContextoAuditoria } from '../../src/auditoria/contexto-auditoria.service.js';
import { SimulacroInterceptor } from '../../src/auditoria/simulacro.interceptor.js';
import { CacheSesiones } from '../../src/auth/cache-sesiones.service.js';
import { SupabaseAuthGuard } from '../../src/auth/guards/supabase-auth.guard.js';
import { TokenRutinaService } from '../../src/auth/token-rutina.service.js';
import { CifradoService } from '../../src/common/cifrado/cifrado.service.js';
import type { CacheCatalogosService } from '../../src/common/ripley/cache-catalogos.service.js';
import { RipleyHttpService } from '../../src/common/ripley/ripley-http.service.js';
import { SupabaseService } from '../../src/common/supabase/supabase.service.js';
import type { TokenRipleyService } from '../../src/configuracion/token-ripley/token-ripley.service.js';
import { LlamadasRutinaInterceptor, LlamadasRutinaService } from '../../src/rutinas/ejecutor/llamadas.js';
import { supabaseEnMemoria, type Fila } from '../fixtures/supabase-memoria.js';

/**
 * Un paso de una rutina, llamando a una herramienta de verdad.
 *
 * Es donde encajan todas las piezas: el guard de sesión reconoce el token de
 * rutina y abre el simulacro si es una prueba; AgenteGuard le deja escribir sin
 * el interruptor; el cliente de Ripley no deja salir la escritura; y el
 * registro anota la llamada para que el ejecutor decida si el paso salió bien.
 */

const JOSE = { id: 'u-jose', email: 'jose@ejemplo.com' };

@Controller('agente')
class HerramientasFalsas {
  constructor(private readonly ripley: RipleyHttpService) {}

  @PermitidoAgenteEditor()
  @Put('capacidad')
  async editar() {
    await this.ripley.put('/capacidades', 'PE', { assigned: 0 });
    return { dias: [{ fecha: '2026-10-14', error: 'Ya estaba así. No he cambiado nada aquí.' }] };
  }

  @PermitidoAgente()
  @Get('capacidad')
  consultar() {
    return { oficinas: [{ codigo: '1088', error: 'El operador 1088 no tiene la zona 4' }] };
  }

  /** Como el cambio en bloque cuando todo ya estaba como se pedía */
  @PermitidoAgenteEditor()
  @Put('masivo')
  masivo() {
    throw new BadRequestException('Las 21 agendas ya estaban así. No he cambiado nada.');
  }

  /** Un 400 de verdad */
  @PermitidoAgenteEditor()
  @Put('tipo-servicio')
  tipoServicio() {
    throw new BadRequestException('La agenda no tiene el servicio DX');
  }
}

@Controller('consultas')
class RutasDelPanel {
  @Get('libre')
  libre() {
    return { ok: true };
  }
}

async function montar() {
  const tablas: Record<string, Fila[]> = { rutina_ejecuciones: [{ id: 'e-1', rutina_id: 'r-1', estado: 'en_curso' }] };
  const http = { put: vi.fn(() => of({ data: { ok: true } })), get: vi.fn(() => of({ data: {} })) };
  const config = {
    get: (clave: string) =>
      clave === 'cifrado.clave' ? 'una-clave-de-prueba-con-mas-de-treinta-y-dos-caracteres'
        : clave === 'ripley.urls' ? { PE: 'https://interno' } : '',
  };

  @Module({
    controllers: [HerramientasFalsas, RutasDelPanel],
    providers: [
      { provide: ConfigService, useValue: config },
      { provide: SupabaseService, useValue: supabaseEnMemoria(tablas) },
      CifradoService,
      TokenRutinaService,
      CacheSesiones,
      ContextoAuditoria,
      AuditoriaMiddleware,
      ModoAgenteService,
      InterrupcionAgenteService,
      LlamadasRutinaService,
      {
        provide: RipleyHttpService,
        inject: [ContextoAuditoria],
        useFactory: (contexto: ContextoAuditoria) => new RipleyHttpService(
          http as unknown as HttpService, config as unknown as ConfigService, contexto,
          { obtenerParaUso: vi.fn().mockResolvedValue('token-de-ripley') } as unknown as TokenRipleyService,
          { olvidar: vi.fn() } as unknown as CacheCatalogosService,
        ),
      },
      { provide: APP_GUARD, useClass: SupabaseAuthGuard },
      { provide: APP_GUARD, useClass: AgenteGuard },
      { provide: APP_INTERCEPTOR, useClass: SimulacroInterceptor },
      { provide: APP_INTERCEPTOR, useClass: LlamadasRutinaInterceptor },
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

  const tokens = modulo.get(TokenRutinaService);
  const emitir = (modo: 'prueba' | 'real' = 'prueba') =>
    tokens.emitir({ ejecucion: 'e-1', rutina: 'r-1', usuario: JOSE, modo, tarea: 1, paso: 1 });

  return { servidor: app.getHttpServer(), http, tablas, emitir, llamadas: modulo.get(LlamadasRutinaService) };
}

describe('Un paso de una rutina llamando a una herramienta', () => {
  let m: Awaited<ReturnType<typeof montar>>;
  beforeEach(async () => {
    m = await montar();
  });

  const comoPaso = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`).set('X-Origen', 'agente');

  it('en una prueba escribe sin el interruptor, pero en simulacro: nada sale hacia Ripley', async () => {
    const { token } = m.emitir('prueba');

    const r = await comoPaso(request(m.servidor).put('/agente/capacidad'), token).expect(200);

    expect(m.http.put).not.toHaveBeenCalled();
    expect(r.body.simulacro.escriturasEvitadas).toBe(1);
  });

  it('y queda anotado lo que llamó: con eso se decide si el paso salió bien', async () => {
    const { token, permiso } = m.emitir('prueba');

    await comoPaso(request(m.servidor).put('/agente/capacidad'), token).expect(200);
    await comoPaso(request(m.servidor).get('/agente/capacidad'), token).expect(200);

    expect(m.llamadas.tomar(permiso.id)).toEqual([
      { herramienta: 'Editar capacidad de una agenda', estado: 200, problemas: [], escriturasEvitadas: 1 },
      { herramienta: 'Capacidad de agendas', estado: 200, problemas: ['El operador 1088 no tiene la zona 4'], escriturasEvitadas: 0 },
    ]);
  });

  it('un 400 porque todo ya estaba así se anota como cumplido; uno de verdad, como fallo', async () => {
    const { token, permiso } = m.emitir('prueba');

    await comoPaso(request(m.servidor).put('/agente/masivo'), token).expect(400);
    await comoPaso(request(m.servidor).put('/agente/tipo-servicio'), token).expect(400);

    expect(m.llamadas.tomar(permiso.id)).toEqual([
      { herramienta: 'Activar o desactivar agendas en bloque', estado: 400, problemas: [], escriturasEvitadas: 0, yaEstaba: true },
      { herramienta: 'Editar un tipo de servicio', estado: 400, problemas: ['La agenda no tiene el servicio DX'], escriturasEvitadas: 0 },
    ]);
  });

  it('una ejecución real sí escribe', async () => {
    await comoPaso(request(m.servidor).put('/agente/capacidad'), m.emitir('real').token).expect(200);
    expect(m.http.put).toHaveBeenCalledTimes(1);
  });

  it('con la ejecución ya terminada, el token no vale', async () => {
    m.tablas.rutina_ejecuciones[0].estado = 'completada';
    await comoPaso(request(m.servidor).get('/agente/capacidad'), m.emitir().token).expect(401);
  });

  it('no abre las rutas del panel', async () => {
    await request(m.servidor).get('/consultas/libre').set('Authorization', `Bearer ${m.emitir().token}`).expect(403);
  });
});
