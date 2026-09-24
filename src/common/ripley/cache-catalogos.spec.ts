import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { CacheCatalogosService } from './cache-catalogos.service.js';

/**
 * La caché de catálogos.
 *
 * Ahorra llamadas a una API corporativa lenta, y por eso mismo es peligrosa:
 * lo que se vigila aquí es que no ahorre de más. Que no mezcle usuarios, que
 * no sobreviva a una escritura, y que caduque.
 */

const contextoDe = (id: string | null) =>
  ({
    usuarioActual: () => (id ? { id, email: `${id}@ripley.com.pe` } : null),
  }) as unknown as ContextoAuditoria;

describe('Caché de catálogos: lo que ahorra', () => {
  it('la segunda vez no vuelve a pedir', async () => {
    const cache = new CacheCatalogosService(contextoDe('u1'));
    const traer = vi.fn().mockResolvedValue(['dato']);

    const a = await cache.recordar('offices', 'PE', traer);
    const b = await cache.recordar('offices', 'PE', traer);

    expect(a).toEqual(b);
    expect(traer).toHaveBeenCalledOnce();
  });

  it('claves distintas no se pisan', async () => {
    const cache = new CacheCatalogosService(contextoDe('u1'));
    const uno = vi.fn().mockResolvedValue('A');
    const otro = vi.fn().mockResolvedValue('B');

    expect(await cache.recordar('offices', 'PE', uno)).toBe('A');
    expect(await cache.recordar('services', 'PE', otro)).toBe('B');
  });

  it('el mismo catálogo en otro país es otra entrada', async () => {
    const cache = new CacheCatalogosService(contextoDe('u1'));
    const traer = vi
      .fn()
      .mockResolvedValueOnce('PE')
      .mockResolvedValueOnce('CL');

    expect(await cache.recordar('services', 'PE', traer)).toBe('PE');
    expect(await cache.recordar('services', 'CL', traer)).toBe('CL');
    expect(traer).toHaveBeenCalledTimes(2);
  });
});

describe('Caché de catálogos: lo que NO comparte', () => {
  /**
   * El catálogo es el mismo para todos hoy, pero el token con el que se pide
   * no lo es. Compartir la respuesta entre usuarios sería decidir que sus
   * permisos son iguales, y eso no le toca decidirlo a una caché.
   */
  it('no sirve la respuesta de un usuario a otro', async () => {
    const contexto = { usuarioActual: vi.fn() } as unknown as ContextoAuditoria;
    const cache = new CacheCatalogosService(contexto);

    const usuarioActual = contexto.usuarioActual as ReturnType<typeof vi.fn>;
    const traer = vi
      .fn()
      .mockResolvedValueOnce('de u1')
      .mockResolvedValueOnce('de u2');

    usuarioActual.mockReturnValue({ id: 'u1', email: 'a@b.c' });
    expect(await cache.recordar('offices', 'PE', traer)).toBe('de u1');

    usuarioActual.mockReturnValue({ id: 'u2', email: 'c@d.e' });
    expect(await cache.recordar('offices', 'PE', traer)).toBe('de u2');

    expect(traer).toHaveBeenCalledTimes(2);
  });

  it('sin usuario no se guarda nada', async () => {
    // Significa que la petición no pasó por el guard: no hay a quién atribuirla
    const cache = new CacheCatalogosService(contextoDe(null));
    const traer = vi.fn().mockResolvedValue('dato');

    await cache.recordar('offices', 'PE', traer);
    await cache.recordar('offices', 'PE', traer);

    expect(traer).toHaveBeenCalledTimes(2);
  });
});

describe('Caché de catálogos: cuándo se olvida', () => {
  it('una escritura la invalida en ese país', async () => {
    const cache = new CacheCatalogosService(contextoDe('u1'));
    const traer = vi
      .fn()
      .mockResolvedValueOnce('antes')
      .mockResolvedValueOnce('después');

    expect(await cache.recordar('offices', 'PE', traer)).toBe('antes');

    cache.olvidar('PE');

    expect(await cache.recordar('offices', 'PE', traer)).toBe('después');
  });

  it('y no toca la del otro país', async () => {
    const cache = new CacheCatalogosService(contextoDe('u1'));
    const pe = vi.fn().mockResolvedValue('PE');
    const cl = vi.fn().mockResolvedValue('CL');

    await cache.recordar('offices', 'PE', pe);
    await cache.recordar('offices', 'CL', cl);

    cache.olvidar('PE');

    await cache.recordar('offices', 'PE', pe);
    await cache.recordar('offices', 'CL', cl);

    expect(pe).toHaveBeenCalledTimes(2);
    expect(cl).toHaveBeenCalledOnce();
  });

  it('caduca sola', async () => {
    vi.useFakeTimers();

    const cache = new CacheCatalogosService(contextoDe('u1'));
    const traer = vi.fn().mockResolvedValue('dato');

    await cache.recordar('offices', 'PE', traer);
    vi.advanceTimersByTime(61_000);
    await cache.recordar('offices', 'PE', traer);

    expect(traer).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('un fallo no se guarda como si fuera un dato', async () => {
    const cache = new CacheCatalogosService(contextoDe('u1'));
    const traer = vi
      .fn()
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce('dato');

    await expect(cache.recordar('offices', 'PE', traer)).rejects.toThrow('502');

    // El siguiente intento vuelve a preguntar en vez de repetir el error
    expect(await cache.recordar('offices', 'PE', traer)).toBe('dato');
  });
});
