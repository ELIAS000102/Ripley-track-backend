import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ContextoAuditoria } from '../../../src/auditoria/contexto-auditoria.service.js';
import type { CacheCatalogosService } from '../../../src/common/ripley/cache-catalogos.service.js';
import { RipleyHttpService } from '../../../src/common/ripley/ripley-http.service.js';
import { Cupo, cupoDe, CUPO_POR_DEFECTO } from '../../../src/common/ripley/ritmo.js';
import type { TokenRipleyService } from '../../../src/configuracion/token-ripley/token-ripley.service.js';

/**
 * El cupo de Ripley por token: unas 120 llamadas por ventana de 60 s, medido
 * con tres actualizaciones del G12. Aquí, con ventanas de milisegundos.
 */

describe('El cupo por ventana', () => {
  it('deja pasar el cupo sin esperar, y la siguiente espera a que cierre la ventana', async () => {
    const cupo = new Cupo({ llamadas: 3, ventanaMs: 80, margenMs: 0 });
    const esperas = [await cupo.tomar(), await cupo.tomar(), await cupo.tomar()];
    expect(esperas.every((e) => e < 10)).toBe(true);

    const cuarta = await cupo.tomar();
    expect(cuarta).toBeGreaterThanOrEqual(65);
  });

  it('un 429 da la ventana por gastada: nadie sale hasta que cierre, y después empieza otra', async () => {
    const cupo = new Cupo({ llamadas: 100, ventanaMs: 60, margenMs: 0 });
    await cupo.tomar();
    cupo.agotado(0);
    expect(await cupo.tomar()).toBeGreaterThanOrEqual(45);
    // La nueva ventana tiene su cupo entero
    expect(await cupo.tomar()).toBeLessThan(10);
  });

  it('si Ripley pide esperar más que lo que falta de la ventana, se espera eso', async () => {
    const cupo = new Cupo({ llamadas: 100, ventanaMs: 20, margenMs: 0 });
    await cupo.tomar();
    cupo.agotado(90);
    expect(await cupo.tomar()).toBeGreaterThanOrEqual(75);
  });

  it('una configuración vacía o rota cae en 110 cada 60 s', () => {
    expect(cupoDe(undefined)).toEqual(CUPO_POR_DEFECTO);
    expect(cupoDe('/x')).toEqual({ llamadas: 110, ventanaMs: 60_000, margenMs: 1_000 });
    expect(cupoDe({ llamadas: '100', ventanaMs: 'nada', margenMs: '0' })).toEqual({ llamadas: 100, ventanaMs: 60_000, margenMs: 0 });
  });
});

function armar(opciones: { cupo: Record<string, unknown>; respuesta?: (n: number) => { status?: number; retry?: string } | null }) {
  const llamadas: number[] = [];
  const http = {
    get: () =>
      new Observable((s) => {
        llamadas.push(Date.now());
        const fallo = opciones.respuesta?.(llamadas.length) ?? null;
        setTimeout(() => {
          if (fallo?.status) {
            s.error({ message: String(fallo.status), response: { status: fallo.status, data: '', headers: fallo.retry ? { 'retry-after': fallo.retry } : {} } });
            return;
          }
          s.next({ data: { ok: true } });
          s.complete();
        }, 2);
      }),
  } as unknown as HttpService;
  const config = {
    get: (clave: string) => ({
      'ripley.urls': { PE: 'https://api' },
      'ripley.ritmo.general': { paralelas: '8', intervaloMs: '0' },
      'ripley.cupo': opciones.cupo,
    } as Record<string, unknown>)[clave],
  } as unknown as ConfigService;
  const tokens = { obtenerParaUso: async () => 'token' } as unknown as TokenRipleyService;
  const cache = { olvidar: () => undefined } as unknown as CacheCatalogosService;
  const contexto = new ContextoAuditoria();
  const ripley = new RipleyHttpService(http, config, contexto, tokens, cache);
  (ripley as unknown as { logger: Record<string, unknown> }).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  return { ripley, contexto, llamadas };
}

describe('El cliente de Ripley con cupo', () => {
  it('al llegar al cupo, las demás esperan la ventana siguiente; la espera queda anotada', async () => {
    const { ripley, contexto, llamadas } = armar({ cupo: { llamadas: 2, ventanaMs: 80, margenMs: 0 } });
    const { esperaMs } = await contexto.ejecutar(() => {
      contexto.identificarUsuario('u', 'u@r.pe');
      contexto.activarSecuencial({ aLaVez: 4 });
      return contexto.medir(() => Promise.all(['a', 'b', 'c'].map((x) => ripley.get(`/ruta/${x}`, 'PE'))));
    });
    expect(llamadas).toHaveLength(3);
    expect(llamadas[2] - llamadas[0]).toBeGreaterThanOrEqual(65);
    expect(esperaMs).toBeGreaterThanOrEqual(60);
  });

  it('un 429 se repite cuando cierra la ventana, no a los pocos segundos', async () => {
    const { ripley, contexto, llamadas } = armar({
      cupo: { llamadas: 100, ventanaMs: 70, margenMs: 0 },
      respuesta: (n) => (n === 1 ? { status: 429, retry: '0' } : null),
    });
    await contexto.ejecutar(async () => {
      contexto.identificarUsuario('u', 'u@r.pe');
      await expect(ripley.get('/ruta/a', 'PE')).resolves.toEqual({ ok: true });
    });
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1] - llamadas[0]).toBeGreaterThanOrEqual(60);
  });

  it('si el 429 sigue, se rinde tras dos repeticiones y lo dice', async () => {
    const { ripley, contexto, llamadas } = armar({
      cupo: { llamadas: 100, ventanaMs: 5, margenMs: 0 },
      respuesta: () => ({ status: 429, retry: '0' }),
    });
    await contexto.ejecutar(async () => {
      contexto.identificarUsuario('u', 'u@r.pe');
      await expect(ripley.get('/ruta/a', 'PE')).rejects.toThrow(/pidió ir más despacio \(429\)/);
    });
    expect(llamadas).toHaveLength(3);
  });
});
