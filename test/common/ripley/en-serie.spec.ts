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

function armar(opciones: { fallar?: Set<string> } = {}) {
  const vuelo = { activas: 0, maximo: 0, orden: [] as string[] };
  const http = {
    get: (url: string) =>
      new Observable((s) => {
        vuelo.activas++;
        vuelo.maximo = Math.max(vuelo.maximo, vuelo.activas);
        vuelo.orden.push(url.split('/').at(-1)!);
        setTimeout(() => {
          vuelo.activas--;
          const ruta = url.split('/').at(-1)!;
          if (opciones.fallar?.has(ruta)) {
            opciones.fallar.delete(ruta);
            s.error(Object.assign(new Error('caída'), { response: { status: 503, headers: {} } }));
            return;
          }
          s.next({ data: { ok: true, ruta } });
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

  it('no repite una lectura que ya hizo, y cuenta solo las que salieron', async () => {
    const { ripley, contexto, vuelo } = armar();
    const llamadas = await contexto.ejecutar(async () => {
      contexto.identificarUsuario('u', 'u@r.pe');
      contexto.activarSecuencial();
      await ripley.get('/ruta/zonas', 'PE', { courier: '1' });
      const segunda = await ripley.get<{ ruta: string }>('/ruta/zonas', 'PE', { courier: '1' });
      expect(segunda.ruta).toBe('zonas');
      await ripley.get('/ruta/zonas', 'PE', { courier: '2' });
      return contexto.llamadasHechas();
    });
    expect(vuelo.orden).toEqual(['zonas', 'zonas']);
    expect(llamadas).toBe(2);
  });

  it('con las lecturas de la actualización, la tabla siguiente aprovecha lo que leyó la anterior', async () => {
    const { ripley, contexto, vuelo } = armar();
    const lecturas = new Map<string, unknown>();
    const tabla = () => contexto.ejecutar(async () => {
      contexto.identificarUsuario('u', 'u@r.pe');
      contexto.activarSecuencial({ lecturas });
      await ripley.get('/ruta/agendas', 'PE', { oficina: '20027' });
      return contexto.llamadasHechas();
    });
    expect(await tabla()).toBe(1);
    expect(await tabla()).toBe(0);
    expect(vuelo.orden).toEqual(['agendas']);
  });

  it('lo que falló no se guarda: el reintento vuelve a pedirlo', async () => {
    const { ripley, contexto, vuelo } = armar({ fallar: new Set(['agendas']) });
    await contexto.ejecutar(async () => {
      contexto.identificarUsuario('u', 'u@r.pe');
      contexto.activarSecuencial();
      await expect(ripley.get('/ruta/agendas', 'PE')).rejects.toThrow(/503/);
      await ripley.get('/ruta/agendas', 'PE');
    });
    expect(vuelo.orden).toEqual(['agendas', 'agendas']);
  });

  it('sin ir en serie no se guarda nada: el resto del backend lee siempre de Ripley', async () => {
    const { ripley, contexto, vuelo } = armar();
    await contexto.ejecutar(async () => {
      contexto.identificarUsuario('u', 'u@r.pe');
      await ripley.get('/ruta/zonas', 'PE');
      await ripley.get('/ruta/zonas', 'PE');
    });
    expect(vuelo.orden).toEqual(['zonas', 'zonas']);
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
