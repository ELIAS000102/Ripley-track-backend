import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ContextoAuditoria } from '../../../src/auditoria/contexto-auditoria.service.js';
import type { CacheCatalogosService } from '../../../src/common/ripley/cache-catalogos.service.js';
import { RipleyHttpService } from '../../../src/common/ripley/ripley-http.service.js';
import type { TokenRipleyService } from '../../../src/configuracion/token-ripley/token-ripley.service.js';

/**
 * Una petición "en serie" (el G12) no lanza dos llamadas a Ripley a la vez,
 * aunque las pida a la vez: cada una espera a la anterior. Las demás
 * peticiones siguen a su ritmo.
 */

function armar() {
  const vuelo = { activas: 0, maximo: 0, orden: [] as string[] };
  const http = {
    get: (url: string) =>
      new Observable((s) => {
        vuelo.activas++;
        vuelo.maximo = Math.max(vuelo.maximo, vuelo.activas);
        vuelo.orden.push(url.split('/').at(-1)!);
        setTimeout(() => {
          vuelo.activas--;
          s.next({ data: { ok: true } });
          s.complete();
        }, 20);
      }),
  } as unknown as HttpService;
  const config = {
    get: (clave: string) => (clave === 'ripley.urls' ? { PE: 'https://api' } : undefined),
  } as unknown as ConfigService;
  const tokens = { obtenerParaUso: async () => 'token' } as unknown as TokenRipleyService;
  const cache = { olvidar: () => undefined } as unknown as CacheCatalogosService;
  const contexto = new ContextoAuditoria();
  const ripley = new RipleyHttpService(http, config, contexto, tokens, cache);
  return { ripley, contexto, vuelo };
}

describe('Las llamadas a Ripley en serie', () => {
  it('con la petición en serie, de una en una y en el orden pedido', async () => {
    const { ripley, contexto, vuelo } = armar();
    await contexto.ejecutar(async () => {
      contexto.identificarUsuario('u', 'u@r.pe');
      contexto.activarSecuencial();
      await Promise.all(['a', 'b', 'c', 'd'].map((x) => ripley.get(`/ruta/${x}`, 'PE')));
    });
    expect(vuelo.maximo).toBe(1);
    expect(vuelo.orden).toEqual(['a', 'b', 'c', 'd']);
  });

  it('una que falla no atasca a las siguientes', async () => {
    const { contexto } = armar();
    const salida: string[] = [];
    await contexto.ejecutar(async () => {
      contexto.activarSecuencial();
      await Promise.allSettled([
        contexto.enFila(async () => { throw new Error('429'); }),
        contexto.enFila(async () => { salida.push('siguiente'); }),
      ]);
    });
    expect(salida).toEqual(['siguiente']);
  });
});
