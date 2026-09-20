import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CatalogosRipleyService } from './catalogos.service.js';
import type { RipleyHttpService } from './ripley-http.service.js';

/**
 * Estos catálogos los leían siete services, cada uno con su copia de la
 * llamada. Al unificarlos, lo único que no se puede romper en silencio es
 * **qué se le pide a Ripley**: el endpoint y los parámetros exactos.
 *
 * Un filtro de más devuelve menos filas; uno de menos, filas de otro tipo. En
 * ninguno de los dos casos falla nada a la vista: el reporte sale con huecos y
 * el buscador con resultados que no son.
 */

function armar(respuesta: unknown = { count: 0, rows: [] }) {
  const get = vi.fn().mockResolvedValue(respuesta);

  const ripley = {
    get,
    endpoint: (nombre: string) => `/api/${nombre}`,
  } as unknown as RipleyHttpService;

  return { servicio: new CatalogosRipleyService(ripley), get };
}

/** [path, pais, params] de la única llamada que se hizo */
function llamada(get: ReturnType<typeof vi.fn>) {
  expect(get).toHaveBeenCalledOnce();
  return get.mock.calls[0];
}

describe('Catálogos de Ripley: qué se le pide exactamente', () => {
  it('lista almacenes con isStoreOffice y nada más', async () => {
    const { servicio, get } = armar();
    await servicio.oficinas('PE', { tipo: 'almacen' });

    expect(llamada(get)).toEqual([
      '/api/offices',
      'PE',
      { isStoreOffice: true },
    ]);
  });

  it('lista operadores con isOPLOffice y nada más', async () => {
    const { servicio, get } = armar();
    await servicio.oficinas('PE', { tipo: 'opl' });

    expect(llamada(get)).toEqual(['/api/offices', 'PE', { isOPLOffice: true }]);
  });

  it('añade q a la búsqueda incremental sin perder el tipo', async () => {
    const { servicio, get } = armar();
    await servicio.oficinas('CL', { q: '20026', tipo: 'almacen' });

    expect(llamada(get)).toEqual([
      '/api/offices',
      'CL',
      { q: '20026', isStoreOffice: true },
    ]);
  });

  it('busca por id SIN bandera de tipo', async () => {
    // Picking traduce un id de almacén a su código. Añadirle isStoreOffice
    // aquí filtraría un catálogo en el que ya se sabe qué fila se quiere.
    const { servicio, get } = armar();
    await servicio.oficinas('PE', { id: '5dd808' });

    expect(llamada(get)).toEqual(['/api/offices', 'PE', { id: '5dd808' }]);
  });

  it('pide el catálogo de servicios sin parámetros', async () => {
    const { servicio, get } = armar();
    await servicio.servicios('PE');

    expect(llamada(get)).toEqual(['/api/services', 'PE']);
  });

  it('pide las agendas de picking por almacén', async () => {
    const { servicio, get } = armar();
    await servicio.agendasDePicking('5dd808', 'PE');

    expect(llamada(get)).toEqual([
      '/api/schedulesPicking',
      'PE',
      { warehouse: '5dd808' },
    ]);
  });

  it('pide las capacidades con el id en la ruta', async () => {
    const { servicio, get } = armar({});
    await servicio.capacidadesDePicking('cap-1', 'PE', '17-09-2026');

    expect(llamada(get)).toEqual([
      '/api/capacitiesPicking/cap-1',
      'PE',
      { from: '17-09-2026' },
    ]);
  });

  it('omite "from" cuando no se pide una fecha', async () => {
    // Mandar { from: undefined } no es lo mismo: axios lo serializa
    const { servicio, get } = armar({});
    await servicio.capacidadesDePicking('cap-1', 'PE');

    expect(llamada(get)).toEqual([
      '/api/capacitiesPicking/cap-1',
      'PE',
      undefined,
    ]);
  });
});

describe('Catálogos de Ripley: cómo se elige una oficina', () => {
  const FILAS = {
    count: 3,
    rows: [
      { id: 'a', code: '200261' },
      { id: 'b', code: '20026' },
    ],
  };

  it('el código exacto gana a la primera coincidencia parcial', async () => {
    const { servicio } = armar(FILAS);
    const oficina = await servicio.oficinaPorCodigo('20026', 'PE', 'almacen');

    expect(oficina.id).toBe('b');
  });

  it('sin código exacto se acepta la primera, que es lo que hacía cada copia', async () => {
    const { servicio } = armar(FILAS);
    const oficina = await servicio.oficinaPorCodigo('2002', 'PE', 'almacen');

    expect(oficina.id).toBe('a');
  });

  it('sin resultados avisa nombrando lo que se buscaba', async () => {
    const { servicio } = armar({ count: 0, rows: [] });

    await expect(
      servicio.oficinaPorCodigo('999', 'PE', 'opl', 'el OPL'),
    ).rejects.toThrow(
      new NotFoundException('No se encontró el OPL con código 999'),
    );
  });

  it('conserva el total que informa Ripley, que no es el número de filas', async () => {
    const { servicio } = armar(FILAS);
    const { total, filas } = await servicio.oficinasConTotal('PE', { q: '2' });

    expect(total).toBe(3);
    expect(filas).toHaveLength(2);
  });
});
