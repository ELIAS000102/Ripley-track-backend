import { describe, expect, it, vi } from 'vitest';
import { enLotes } from '../../../src/common/utils/lotes.util.js';

/**
 * El freno de mano contra la API corporativa.
 *
 * Estaba escrito tres veces —capacidad, simulación y el reporte de CDs— y al
 * juntarlo en un sitio se quedó sin nadie que vigilara lo único que de verdad
 * hace: que no salgan todas las llamadas a la vez. Un `enLotes` que no agrupa
 * devuelve exactamente los mismos resultados, así que ningún test de los
 * servicios lo delataba.
 */

/** Cuántas llamadas había en vuelo a la vez, como máximo */
function espiarConcurrencia() {
  let enVuelo = 0;
  let maximo = 0;
  const orden: number[] = [];

  const fn = vi.fn(async (n: number) => {
    enVuelo++;
    maximo = Math.max(maximo, enVuelo);
    await new Promise((r) => setTimeout(r, 1));
    enVuelo--;
    orden.push(n);
    return n * 2;
  });

  return { fn, maximo: () => maximo, orden };
}

describe('Recorrer por tandas', () => {
  it('no lanza más de las que caben en un lote', async () => {
    const { fn, maximo } = espiarConcurrencia();

    await enLotes([1, 2, 3, 4, 5, 6, 7], 3, fn);

    expect(maximo()).toBe(3);
  });

  it('con tamaño 1 va de una en una', async () => {
    const { fn, maximo } = espiarConcurrencia();

    await enLotes([1, 2, 3], 1, fn);

    expect(maximo()).toBe(1);
  });

  it('devuelve todos los resultados, en el orden de entrada', async () => {
    const { fn } = espiarConcurrencia();

    const salida = await enLotes([1, 2, 3, 4, 5], 2, fn);

    // El orden de la salida es el de la lista, no el de quién acabó antes
    expect(salida).toEqual([2, 4, 6, 8, 10]);
  });

  it('una lista vacía no llama a nada', async () => {
    const { fn } = espiarConcurrencia();

    expect(await enLotes([], 3, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('un lote más grande que la lista no es un problema', async () => {
    const { fn, maximo } = espiarConcurrencia();

    await enLotes([1, 2], 10, fn);

    expect(maximo()).toBe(2);
  });

  it('un fallo en un lote corta: lo que no se pidió, no se pide', async () => {
    const llamadas: number[] = [];
    const fn = vi.fn(async (n: number) => {
      llamadas.push(n);
      if (n === 2) throw new Error('esa agenda ya no existe');
      return n;
    });

    await expect(enLotes([1, 2, 3, 4], 2, fn)).rejects.toThrow('ya no existe');

    // El segundo lote no llegó a salir: quien llama decide si reintenta, pero
    // seguir pidiendo contra una API que acaba de fallar no es decisión de aquí
    expect(llamadas).toEqual([1, 2]);
  });
});
