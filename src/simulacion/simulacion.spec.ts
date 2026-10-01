import { describe, expect, it, vi } from 'vitest';
import type { CatalogosRipleyService } from '../common/ripley/catalogos.service.js';
import type { RipleyHttpService } from '../common/ripley/ripley-http.service.js';
import { SimulacionService } from './simulacion.service.js';
import type { SimularDto } from './dto/simular.dto.js';

/**
 * Qué payload sale hacia el simulador de Ripley.
 *
 * Lo que se fija aquí es el campo que se equivocó: `localityCode`. Ripley busca
 * el distrito por él, y su propio simulador manda el `identifier` de la
 * comuna —"070102"— y no el `code` —"70102"—. Son el mismo número con y sin el
 * cero de delante, y **coinciden cuando el código de la región tiene dos
 * cifras**, así que mandar el `code` funcionaba en Lima (la 15) y fallaba en
 * Callao (la 7) con "Comuna o distrito no existe en la base de datos".
 *
 * Los datos son los de una petición real: región de Callao, distrito
 * Bellavista, y la de Lima - Breña que sí respondía.
 */

/** Callao: código de región de UNA cifra, así que sus localidades llevan cero */
const CALLAO = {
  id: '5d2f5130ce78551883139dec',
  name: 'Callao',
  code: '7',
  provinces: [
    {
      id: '5d2f6db48b5b5a4761f20f5a',
      name: 'Prov. Const. del Callao',
      code: '0701',
      communes: [
        {
          id: '5d2f8c2640ae9d7f94e5b01a',
          name: 'Callao',
          code: '70101',
          identifier: '070101',
          province: '5d2f6db48b5b5a4761f20f5a',
          region: '5d2f5130ce78551883139dec',
        },
        {
          id: '5d2f8c2640ae9d7f94e5b01b',
          name: 'Bellavista',
          code: '70102',
          identifier: '070102',
          province: '5d2f6db48b5b5a4761f20f5a',
          region: '5d2f5130ce78551883139dec',
        },
      ],
    },
  ],
};

/** Lima: código de DOS cifras, así que los dos campos valen lo mismo */
const LIMA = {
  id: '5d2f5130ce78551883139df4',
  name: 'Lima',
  code: '15',
  provinces: [
    {
      id: '5d2f6db48b5b5a4761f20f99',
      name: 'Lima',
      code: '1501',
      communes: [
        {
          id: '5d2f8c2f40ae9d7f94e5b25e',
          name: 'Breña',
          code: '150105',
          identifier: '150105',
          province: '5d2f6db48b5b5a4761f20f99',
          region: '5d2f5130ce78551883139df4',
        },
      ],
    },
  ],
};

const OFICINA = { id: '63d92b62b63078efda5a2f23', code: '1111', name: 'DD_PQT_RM - SD CD A2' };

/** El catálogo de SKU responde en `rows`, no como array suelto */
const SKU = {
  rows: [
    {
      code: '2013435160001',
      name: '2000 CALORI CURVO BLACK',
      description: '2000 CALORI CURVO BLACK',
      type: { isStoreProduct: true, isCargoProduct: false, isMarketplaceProduct: false },
    },
  ],
};

function armar(region: unknown = CALLAO) {
  const post = vi.fn().mockResolvedValue({ matrix: [{ typeOfServices: {} }] });

  const get = vi.fn(async (ruta: string) => {
    if (ruta.includes('regions')) return region;
    if (ruta.includes('offices')) return OFICINA;
    return SKU;
  });

  const ripley = {
    get,
    post,
    endpoint: (nombre: string) => `/${nombre}`,
  } as unknown as RipleyHttpService;

  const servicio = new SimulacionService(
    ripley,
    // Solo lo usa la búsqueda de oficinas, que aquí no se toca
    { oficinas: vi.fn() } as unknown as CatalogosRipleyService,
  );

  /** El cuerpo que se mandó a Ripley */
  const enviado = () => post.mock.calls[0]?.[2] as Record<string, unknown>;

  return { servicio, enviado, post };
}

const PETICION = {
  pais: 'PE',
  deliveryMethod: 'DP',
  courierId: '63d92b62b63078efda5a2f23',
  regionId: '5d2f5130ce78551883139dec',
  communeId: '5d2f8c2640ae9d7f94e5b01b',
  products: [{ sku: 2013435160001, quantity: 1 }],
  date: '01/10/2026',
  hour: '01:26',
} as unknown as SimularDto;

describe('El distrito que se manda a Ripley', () => {
  it('va con el cero de delante: es el identifier, no el code', async () => {
    const { servicio, enviado } = armar();

    await servicio.simular(PETICION);

    // Su propio simulador manda "070102" para Bellavista
    expect(enviado().localityCode).toBe('070102');
  });

  it('el id de la comuna va aparte, y ese sí es el id interno', async () => {
    const { servicio, enviado } = armar();

    await servicio.simular(PETICION);

    expect(enviado().commune).toBe('5d2f8c2640ae9d7f94e5b01b');
  });

  it('en Lima los dos campos valen lo mismo, y por eso no se notaba', async () => {
    const { servicio, enviado } = armar(LIMA);

    await servicio.simular({
      ...PETICION,
      regionId: '5d2f5130ce78551883139df4',
      communeId: '5d2f8c2f40ae9d7f94e5b25e',
    } as unknown as SimularDto);

    expect(enviado().localityCode).toBe('150105');
  });

  it('sin identifier se cae al code: es lo que había, y es mejor que un undefined', async () => {
    // No debería pasar —Ripley lo manda siempre— pero mandar undefined sería
    // cambiar un distrito equivocado por ninguno
    const sinIdentifier = structuredClone(CALLAO);
    const bellavista = sinIdentifier.provinces[0].communes[1] as Partial<
      typeof CALLAO.provinces[0]['communes'][0]
    >;
    bellavista.identifier = undefined;

    const { servicio, enviado } = armar(sinIdentifier);

    await servicio.simular(PETICION);

    expect(enviado().localityCode).toBe('70102');
  });

  it('un distrito de otra región no se simula a ciegas', async () => {
    const { servicio, post } = armar();

    await expect(
      servicio.simular({ ...PETICION, communeId: 'no-es-de-callao' } as unknown as SimularDto),
    ).rejects.toThrow(/no pertenece a la región Callao/);

    expect(post).not.toHaveBeenCalled();
  });
});
