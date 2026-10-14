import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { defer, from, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../../src/auditoria/contexto-auditoria.service.js';
import type { CacheCatalogosService } from '../../../src/common/ripley/cache-catalogos.service.js';
import { RipleyHttpService } from '../../../src/common/ripley/ripley-http.service.js';
import { Carril, ritmoDe, RITMO_POR_DEFECTO } from '../../../src/common/ripley/ritmo.js';
import type { TokenRipleyService } from '../../../src/configuracion/token-ripley/token-ripley.service.js';

/**
 * El ritmo hacia la API corporativa.
 *
 * Todo sale del mismo servidor, así que para Ripley un atajo de cuarenta ítems
 * y una rutina a la vez son una ráfaga de un solo origen. Lo que se fija aquí:
 * que nunca haya más peticiones a la vez de las permitidas ni arranquen más
 * seguidas de lo permitido, que lo idéntico no se pida dos veces, que un token
 * rechazado no se siga mandando, y que si Ripley pide frenar se le haga caso.
 */

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Un carril', () => {
  it('nunca pasa del tope de peticiones a la vez', async () => {
    const carril = new Carril({ paralelas: 2, intervaloMs: 0 });
    let ahora = 0;
    let maximo = 0;
    const tarea = () => carril.turno(async () => {
      maximo = Math.max(maximo, ++ahora);
      await espera(15);
      ahora--;
    });

    await Promise.all(Array.from({ length: 7 }, tarea));
    expect(maximo).toBe(2);
  });

  it('deja el intervalo entre un arranque y el siguiente, y respeta el orden de llegada', async () => {
    const carril = new Carril({ paralelas: 10, intervaloMs: 25 });
    const arranques: number[] = [];
    const orden: number[] = [];

    await Promise.all([0, 1, 2, 3].map((i) => carril.turno(async () => {
      arranques.push(Date.now());
      orden.push(i);
    })));

    expect(orden).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < arranques.length; i++) expect(arranques[i] - arranques[i - 1]).toBeGreaterThanOrEqual(20);
  });

  it('un fallo libera su sitio igual', async () => {
    const carril = new Carril({ paralelas: 1, intervaloMs: 0 });
    await expect(carril.turno(async () => { throw new Error('mal'); })).rejects.toThrow('mal');
    await expect(carril.turno(async () => 'bien')).resolves.toBe('bien');
  });

  it('frenar para a todo el carril ese tiempo', async () => {
    const carril = new Carril({ paralelas: 4, intervaloMs: 0 });
    carril.frenar(40);
    const antes = Date.now();
    await carril.turno(async () => undefined);
    expect(Date.now() - antes).toBeGreaterThanOrEqual(35);
  });

  it('una configuración rota cae en la de por defecto', () => {
    expect(ritmoDe('/api/x', RITMO_POR_DEFECTO.general)).toEqual(RITMO_POR_DEFECTO.general);
    expect(ritmoDe({ paralelas: '0', intervaloMs: '-5' }, RITMO_POR_DEFECTO.general)).toEqual(RITMO_POR_DEFECTO.general);
    expect(ritmoDe({ paralelas: '3', intervaloMs: '200' }, RITMO_POR_DEFECTO.general)).toEqual({ paralelas: 3, intervaloMs: 200 });
  });
});

/** El cliente de verdad, con un HTTP falso que tarda un poco en responder */
function montar(opciones: { get?: () => unknown; token?: () => string } = {}) {
  const lento = <T>(valor: T, ms = 15) => from(new Promise<T>((r) => setTimeout(() => r(valor), ms)));
  const http = {
    get: vi.fn(opciones.get ?? (() => lento({ data: { filas: [1, 2, 3] } }))),
    post: vi.fn(() => lento({ data: { fecha: '15/10/2026' } })),
    put: vi.fn(() => lento({ data: { ok: true } })),
  };
  const config = {
    get: (clave: string) => ({
      'ripley.urls': { PE: 'https://interno', CL: 'https://interno-cl' },
      'ripley.endpoints.simulator': '/simulador',
      'ripley.ritmo.general': { paralelas: '2', intervaloMs: '0' },
      'ripley.ritmo.simulacion': { paralelas: '1', intervaloMs: '0' },
    } as Record<string, unknown>)[clave],
  } as unknown as ConfigService;
  const contexto = { usuarioActual: () => ({ id: 'u1', email: 'ana@ejemplo.com' }), enSimulacro: () => false } as unknown as ContextoAuditoria;
  const tokens = { obtenerParaUso: vi.fn(async () => (opciones.token ?? (() => 'token-1'))()) } as unknown as TokenRipleyService;
  const cache = { olvidar: vi.fn() } as unknown as CacheCatalogosService;
  const servicio = new RipleyHttpService(http as unknown as HttpService, config, contexto, tokens, cache);
  (servicio as unknown as { logger: Record<string, unknown> }).logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { servicio, http };
}

describe('El cliente de Ripley, con ritmo', () => {
  it('dos lecturas idénticas a la vez son una sola petición, y cada una recibe su copia', async () => {
    const { servicio, http } = montar();

    const [a, b] = await Promise.all([
      servicio.get<{ filas: number[] }>('/agendas', 'PE', { id: '1' }),
      servicio.get<{ filas: number[] }>('/agendas', 'PE', { id: '1' }),
    ]);

    expect(http.get).toHaveBeenCalledTimes(1);
    a.filas.push(99);
    expect(b.filas).toEqual([1, 2, 3]);
  });

  it('lecturas distintas sí van cada una, como mucho las permitidas a la vez', async () => {
    let ahora = 0;
    let maximo = 0;
    const { servicio, http } = montar({
      get: () => defer(async () => {
        maximo = Math.max(maximo, ++ahora);
        await espera(15);
        ahora--;
        return { data: {} };
      }),
    });

    await Promise.all([1, 2, 3, 4, 5].map((id) => servicio.get('/agendas', 'PE', { id: String(id) })));

    expect(http.get).toHaveBeenCalledTimes(5);
    expect(maximo).toBe(2);
  });

  it('una simulación repetida enseguida sale de lo recordado, y una escritura la olvida', async () => {
    const { servicio, http } = montar();
    const pedir = () => servicio.postDeLectura('/simulador', 'PE', { sku: '1', destino: 'Lima' });

    await pedir();
    await pedir();
    expect(http.post).toHaveBeenCalledTimes(1);

    await servicio.put('/capacidades', 'PE', { assigned: 10 });
    await pedir();
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it('tras un 401, ese token no se vuelve a mandar durante un minuto; uno nuevo sí', async () => {
    let token = 'token-viejo';
    const { servicio, http } = montar({
      token: () => token,
      get: () => (token === 'token-viejo'
        ? throwError(() => ({ message: '401', response: { status: 401, data: '' } }))
        : from(Promise.resolve({ data: { ok: true } }))),
    });

    await expect(servicio.get('/agendas', 'PE')).rejects.toThrow('respondió 401');
    await expect(servicio.get('/otra', 'PE')).rejects.toThrow('no se le vuelve a llamar con él durante un minuto');
    expect(http.get).toHaveBeenCalledTimes(1);

    token = 'token-nuevo';
    await expect(servicio.get('/otra', 'PE')).resolves.toEqual({ ok: true });
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('el 401 de un país no frena al otro', async () => {
    const { servicio, http } = montar({
      get: () => (http.get.mock.calls.length === 1
        ? throwError(() => ({ message: '401', response: { status: 401, data: '' } }))
        : from(Promise.resolve({ data: { ok: true } }))),
    });

    await expect(servicio.get('/agendas', 'PE')).rejects.toThrow('401');
    await expect(servicio.get('/agendas', 'CL')).resolves.toEqual({ ok: true });
  });

  it('si Ripley pide ir más despacio (429), espera lo que dice y reintenta una vez', async () => {
    const { servicio, http } = montar({
      get: () => (http.get.mock.calls.length === 1
        ? throwError(() => ({ message: '429', response: { status: 429, data: '', headers: { 'retry-after': '0.05' } } }))
        : from(Promise.resolve({ data: { ok: true } }))),
    });

    const antes = Date.now();
    await expect(servicio.get('/agendas', 'PE')).resolves.toEqual({ ok: true });
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(Date.now() - antes).toBeGreaterThanOrEqual(40);
  });

  it('y si vuelve a pedirlo, lo dice como lo que es, sin la dirección', async () => {
    const { servicio } = montar({
      get: () => throwError(() => ({ message: '429', response: { status: 429, data: '', headers: { 'retry-after': '0' } } })),
    });

    const error = await servicio.get('/agendas', 'PE').catch((e: Error) => e);
    expect((error as Error).message).toBe('La API corporativa de PE pidió ir más despacio (429) al consultar, también después de esperar. Vuelve a intentarlo en un minuto.');
  });
});
