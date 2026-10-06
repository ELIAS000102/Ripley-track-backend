import {
  CanActivate,
  Controller,
  ExecutionContext,
  INestApplication,
  Injectable,
  Put,
  Get,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestConUsuario } from '../../../src/auth/interfaces/auth.interface.js';
import { ConsultasAgenteController } from '../../../src/agente/consultas/consultas.controller.js';
import { AgenteGuard } from '../../../src/agente/seguridad/agente.guard.js';
import { InterrupcionAgenteController } from '../../../src/agente/seguridad/interrupcion.controller.js';
import { InterrupcionAgenteService } from '../../../src/agente/seguridad/interrupcion.service.js';
import { ModoAgenteService } from '../../../src/agente/seguridad/modo.service.js';
import {
  PermitidoAgente,
  PermitidoAgenteEditor,
} from '../../../src/agente/seguridad/permitido-agente.decorator.js';

/**
 * El botón "Detener" del chat.
 *
 * Lo que se fija:
 * 1. Detenida una petición, **ninguna herramienta suya pasa**, ni las que leen
 *    ni las que escriben. Es lo que protege aunque n8n no pueda parar.
 * 2. n8n se para con su API, con la clave en cabecera, y solo si está
 *    configurada. Un fallo de n8n no rompe nada.
 * 3. Si se detiene antes de que la ejecución se registre, se para al
 *    registrarse.
 * 4. Una petición de otro usuario no se toca.
 */

const configCon = (valores: Record<string, string>) =>
  ({ get: (k: string) => valores[k] ?? '' }) as unknown as ConfigService;

const CON_API = configCon({ 'agente.n8nApiUrl': 'https://n8n.ejemplo/', 'agente.n8nApiKey': 'clave-secreta' });

describe('InterrupcionAgenteService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sin interrumpir, nada está interrumpido', () => {
    const s = new InterrupcionAgenteService(configCon({}));
    s.registrar('peticion-1', 'ana', '123');

    expect(s.estaInterrumpida('peticion-1')).toBe(false);
    expect(s.estaInterrumpida(undefined)).toBe(false);
    expect(s.estaInterrumpida('otra-peticion')).toBe(false);
  });

  it('para la ejecución de n8n con su API y la clave en cabecera', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetch);

    const s = new InterrupcionAgenteService(CON_API);
    s.registrar('peticion-1', 'ana', '123');
    const r = await s.interrumpir('peticion-1', 'ana');

    expect(r).toEqual({ interrumpida: true, ejecucionDetenida: true });
    expect(s.estaInterrumpida('peticion-1')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    const [url, opciones] = fetch.mock.calls[0];
    expect(url).toBe('https://n8n.ejemplo/api/v1/executions/123/stop');
    expect(opciones.method).toBe('POST');
    expect(opciones.headers['X-N8N-API-KEY']).toBe('clave-secreta');
  });

  it('sin API configurada, igual queda interrumpida, sin llamar a n8n', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const s = new InterrupcionAgenteService(configCon({}));
    s.registrar('peticion-1', 'ana', '123');

    expect(await s.interrumpir('peticion-1', 'ana')).toEqual({ interrumpida: true, ejecucionDetenida: false });
    expect(s.estaInterrumpida('peticion-1')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('si n8n falla o no responde, queda interrumpida igual', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('caído')));
    const s = new InterrupcionAgenteService(CON_API);
    s.registrar('p-caido-1', 'ana', '7');
    expect(await s.interrumpir('p-caido-1', 'ana')).toEqual({ interrumpida: true, ejecucionDetenida: false });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    s.registrar('p-caido-2', 'ana', '8');
    expect(await s.interrumpir('p-caido-2', 'ana')).toEqual({ interrumpida: true, ejecucionDetenida: false });

    expect(s.estaInterrumpida('p-caido-1') && s.estaInterrumpida('p-caido-2')).toBe(true);
  });

  it('detenida antes de registrarse la ejecución: se para al registrarse', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetch);

    const s = new InterrupcionAgenteService(CON_API);
    expect(await s.interrumpir('peticion-1', 'ana')).toEqual({ interrumpida: true, ejecucionDetenida: false });
    expect(fetch).not.toHaveBeenCalled();

    s.registrar('peticion-1', 'ana', '456');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0]).toBe('https://n8n.ejemplo/api/v1/executions/456/stop');
  });

  it('la petición de otro usuario no se toca', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetch);

    const s = new InterrupcionAgenteService(CON_API);
    s.registrar('peticion-1', 'ana', '123');

    expect(await s.interrumpir('peticion-1', 'luis')).toEqual({ interrumpida: true, ejecucionDetenida: false });
    expect(s.estaInterrumpida('peticion-1')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();

    // Ni registrándola encima
    s.registrar('peticion-1', 'luis', '999');
    await s.interrumpir('peticion-1', 'ana');
    expect(fetch.mock.calls[0][0]).toContain('/executions/123/stop');
  });

  it('un id de ejecución que no es un número no llega a la URL', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetch);

    const s = new InterrupcionAgenteService(CON_API);
    s.registrar('peticion-1', 'ana', '../workflows/1');
    await s.interrumpir('peticion-1', 'ana');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('caduca a los quince minutos', async () => {
    vi.useFakeTimers();
    try {
      const s = new InterrupcionAgenteService(configCon({}));
      await s.interrumpir('peticion-1', 'ana');
      expect(s.estaInterrumpida('peticion-1')).toBe(true);

      vi.advanceTimersByTime(16 * 60 * 1000);
      expect(s.estaInterrumpida('peticion-1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('interpretar apunta la ejecución de la petición', () => {
  it('con peticion y ejecucion, las registra a nombre del usuario', () => {
    const registrar = vi.fn();
    const ctrl = { interrupcion: { registrar } } as unknown as ConsultasAgenteController;

    ConsultasAgenteController.prototype.interpretar.call(
      ctrl,
      { pregunta: 'hola', peticion: 'peticion-1', ejecucion: '321' } as never,
      { id: 'ana', email: 'ana@ripley.com.pe' },
    );

    expect(registrar).toHaveBeenCalledWith('peticion-1', 'ana', '321');
  });

  it('sin peticion no registra nada', () => {
    const registrar = vi.fn();
    const ctrl = { interrupcion: { registrar } } as unknown as ConsultasAgenteController;

    ConsultasAgenteController.prototype.interpretar.call(ctrl, { pregunta: 'hola' } as never, { id: 'ana', email: 'a' });
    expect(registrar).not.toHaveBeenCalled();
  });
});

@Controller('herramientas')
class HerramientasController {
  @PermitidoAgente()
  @Get('leer')
  leer() {
    return { ok: true };
  }

  @PermitidoAgenteEditor()
  @Put('escribir')
  escribir() {
    return { ok: true };
  }
}

@Injectable()
class SesionFalsa implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    const peticion = contexto.switchToHttp().getRequest<RequestConUsuario>();
    const id = peticion.get('x-usuario');
    if (id) peticion.usuario = { id, email: `${id}@ripley.com.pe` };
    return true;
  }
}

describe('AgenteGuard con una petición detenida', () => {
  let app: INestApplication;
  let interrupcion: InterrupcionAgenteService;
  let modo: ModoAgenteService;

  beforeEach(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [HerramientasController, InterrupcionAgenteController],
      providers: [
        ModoAgenteService,
        InterrupcionAgenteService,
        { provide: ConfigService, useValue: configCon({}) },
        { provide: APP_GUARD, useClass: SesionFalsa },
        { provide: APP_GUARD, useClass: AgenteGuard },
      ],
    }).compile();

    interrupcion = modulo.get(InterrupcionAgenteService);
    modo = modulo.get(ModoAgenteService);
    app = modulo.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const servidor = () => app.getHttpServer();
  const herramienta = (r: request.Test, peticion?: string) => {
    const t = r.set('X-Origen', 'agente').set('X-Usuario', 'ana');
    return peticion ? t.set('X-Peticion', peticion) : t;
  };

  it('ninguna herramienta de esa petición pasa: ni leer ni escribir', async () => {
    modo.activar('ana');
    await interrupcion.interrumpir('peticion-1', 'ana');

    const leer = await herramienta(request(servidor()).get('/herramientas/leer'), 'peticion-1');
    expect(leer.status).toBe(409);
    expect(leer.body.message).toContain('detuvo');

    await herramienta(request(servidor()).put('/herramientas/escribir'), 'peticion-1').expect(409);
  });

  it('las demás peticiones siguen', async () => {
    modo.activar('ana');
    await interrupcion.interrumpir('peticion-1', 'ana');

    await herramienta(request(servidor()).get('/herramientas/leer'), 'peticion-2').expect(200);
    await herramienta(request(servidor()).put('/herramientas/escribir'), 'peticion-2').expect(200);
    await herramienta(request(servidor()).get('/herramientas/leer')).expect(200);
  });

  it('la persona detiene desde el panel; el agente no puede', async () => {
    const r = await request(servidor())
      .post('/agente/interrumpir')
      .set('X-Usuario', 'ana')
      .send({ peticion: 'peticion-panel-1' })
      .expect(200);
    expect(r.body).toEqual({ interrumpida: true, ejecucionDetenida: false });
    expect(interrupcion.estaInterrumpida('peticion-panel-1')).toBe(true);

    await herramienta(request(servidor()).post('/agente/interrumpir'))
      .send({ peticion: 'peticion-panel-2' })
      .expect(403);
    expect(interrupcion.estaInterrumpida('peticion-panel-2')).toBe(false);
  });
});
