import { describe, expect, it, vi } from 'vitest';
import type { CatalogosRipleyService } from '../../common/ripley/catalogos.service.js';
import type { RipleyHttpService } from '../../common/ripley/ripley-http.service.js';
import type { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { RipleyApiError } from '../../common/ripley/ripley.errors.js';
import { PickingService } from './picking.service.js';

/**
 * Cómo se identifica una agenda dentro de un almacén.
 *
 * En el panel, cinco agendas del 20026 —la de RC y cuatro "NO FUNCIONAL"—
 * aparecían con el mismo Schedule ID y los mismos días. La respuesta real de
 * Ripley trae **doce agendas con doce capacityId distintos**, así que el
 * identificador no venía repetido de origen: lo repetía este backend al buscar
 * la agenda por su tipo de servicio, que cinco de ellas comparten.
 *
 * De ahí las dos cosas que se fijan aquí: que cada agenda conserva su propia
 * capacidad, y que el servicio **no** sirve para elegir una.
 */

const ALMACEN = 'w-20026';
const OTRO = 'w-20040';

/** El catálogo de servicios: id interno -> código visible */
const SERVICIOS = new Map([
  ['s-rc', 'RC'],
  ['s-s', 'S'],
]);

/** Las tres primeras agendas de servicio RC del 20026, como las devuelve Ripley */
const AGENDAS_RC = [
  {
    name: 'Agenda Picking RC - 20026',
    services: ['s-rc'],
    capacities: [
      { capacityId: '651b444be69aaf0012c044c6', warehouseId: ALMACEN },
    ],
  },
  {
    name: 'Agenda Picking Olva - NO FUNCIONAL',
    services: ['s-rc'],
    capacities: [
      { capacityId: '651c80d62b24860012956e46', warehouseId: ALMACEN },
    ],
  },
  {
    name: 'Agenda Picking Andes - NO FUNCIONAL',
    services: ['s-rc'],
    capacities: [
      { capacityId: '651c9b1ccc58e90012651e4c', warehouseId: ALMACEN },
    ],
  },
];

function armar(agendas: Array<Record<string, unknown>>) {
  const catalogos = {
    oficinaPorCodigo: vi.fn().mockResolvedValue({ id: ALMACEN, code: '20026' }),
    agendasDePicking: vi.fn().mockResolvedValue(agendas),
    mapaServicios: vi.fn().mockResolvedValue(SERVICIOS),
  } as unknown as CatalogosRipleyService;

  const servicio = new PickingService(
    catalogos,
    {} as RipleyHttpService,
    {} as ContextoAuditoria,
  );

  return { servicio, catalogos };
}

describe('Agendas de un almacén: cada una con su propia capacidad', () => {
  it('toma la capacidad de ESTE almacén, no la primera de la lista', async () => {
    const { servicio } = armar([
      {
        name: 'Agenda Picking RC - 20026',
        services: ['s-rc'],
        // La del otro almacén va primera a propósito
        capacities: [
          { capacityId: 'cap-otro', warehouseId: OTRO },
          { capacityId: 'cap-rc', warehouseId: ALMACEN },
        ],
      },
    ]);

    const agendas = await servicio.listarAgendasPorOficina('20026');

    expect(agendas).toHaveLength(1);
    expect(agendas[0].scheduleId).toBe('cap-rc');
  });

  it('cada agenda conserva su identificador, como los trae Ripley', async () => {
    // Tal cual responde la API: una capacidad por agenda, todas en este
    // almacén y con identificadores distintos
    const { servicio } = armar(AGENDAS_RC);

    const ids = (await servicio.listarAgendasPorOficina('20026')).map(
      (a) => a.scheduleId,
    );

    expect(ids).toEqual([
      '651b444be69aaf0012c044c6',
      '651c80d62b24860012956e46',
      '651c9b1ccc58e90012651e4c',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('descarta la agenda que no tiene capacidad en este almacén', async () => {
    // Sin fallback a propósito: quedarse con la de otro almacén sería
    // escribir donde nadie pidió
    const { servicio } = armar([
      {
        name: 'Agenda Picking S - 20026',
        services: ['s-s'],
        capacities: [{ capacityId: 'cap-s', warehouseId: ALMACEN }],
      },
      {
        name: 'Agenda de otro almacén',
        services: ['s-rc'],
        capacities: [{ capacityId: 'cap-ajena', warehouseId: OTRO }],
      },
    ]);

    const agendas = await servicio.listarAgendasPorOficina('20026');

    expect(agendas).toHaveLength(1);
    expect(agendas[0].nombre).toBe('Agenda Picking S - 20026');
  });

  it('descarta la agenda cuyo servicio no está en el catálogo', async () => {
    const { servicio } = armar([
      {
        name: 'Agenda con servicio desconocido',
        services: ['s-fantasma'],
        capacities: [{ capacityId: 'cap-x', warehouseId: ALMACEN }],
      },
    ]);

    expect(await servicio.listarAgendasPorOficina('20026')).toHaveLength(0);
  });

  it('resuelve el código visible del servicio y la vigencia', async () => {
    const { servicio } = armar([
      {
        name: 'Agenda Picking RC - 20026',
        services: ['s-rc'],
        unitMeasure: 'Unidades',
        active: true,
        validityEnd: '2030-12-31T05:00:00.000Z',
        capacities: [{ capacityId: 'cap-rc', warehouseId: ALMACEN }],
      },
    ]);

    expect((await servicio.listarAgendasPorOficina('20026'))[0]).toEqual({
      scheduleId: 'cap-rc',
      nombre: 'Agenda Picking RC - 20026',
      typeOfService: 'RC',
      unitMeasure: 'Unidades',
      activa: true,
      vigenteHasta: '2030-12-31',
    });
  });

  it('deja la vigencia en null si Ripley no la manda', async () => {
    const { servicio } = armar([
      {
        name: 'Agenda sin vigencia',
        services: ['s-rc'],
        capacities: [{ capacityId: 'cap-x', warehouseId: ALMACEN }],
      },
    ]);

    expect(
      (await servicio.listarAgendasPorOficina('20026'))[0].vigenteHasta,
    ).toBeNull();
  });
});

describe('Elegir una agenda entre varias del mismo servicio', () => {
  /** Devuelve días para cualquier agenda, para no parar en la lectura */
  function conCapacidades(agendas: Array<Record<string, unknown>>) {
    const { servicio, catalogos } = armar(agendas);

    (
      catalogos as unknown as {
        capacidadesDePicking: ReturnType<typeof vi.fn>;
      }
    ).capacidadesDePicking = vi
      .fn()
      .mockResolvedValue({ capacityByDayArray: [] });

    return { servicio, catalogos };
  }

  it('el identificador elige la agenda, no la primera del servicio', async () => {
    const { servicio } = conCapacidades(AGENDAS_RC);

    const r = await servicio.buscarCapacidades(
      '20026',
      undefined,
      undefined,
      'PE',
      undefined,
      '651c9b1ccc58e90012651e4c',
    );

    expect(r.agenda.nombre).toBe('Agenda Picking Andes - NO FUNCIONAL');
  });

  it('con solo el servicio, y cinco agendas RC, no elige ninguna', async () => {
    // Era el fallo: devolvía siempre la primera, así que las cinco opciones
    // del panel enseñaban los datos de la misma
    const { servicio } = conCapacidades(AGENDAS_RC);

    await expect(servicio.buscarCapacidades('20026', 'RC')).rejects.toThrow(
      /tiene 3 agendas con servicio RC/,
    );
  });

  it('y dice cuáles son, para poder desempatar', async () => {
    const { servicio } = conCapacidades(AGENDAS_RC);

    await expect(servicio.buscarCapacidades('20026', 'RC')).rejects.toThrow(
      /Agenda Picking RC - 20026, Agenda Picking Olva/,
    );
  });

  it('con el servicio basta cuando solo hay una', async () => {
    const { servicio } = conCapacidades([
      {
        name: 'Agenda Picking S - 20026',
        services: ['s-s'],
        capacities: [
          { capacityId: '63d139467011f400114fa824', warehouseId: ALMACEN },
        ],
      },
    ]);

    const r = await servicio.buscarCapacidades('20026', 'S');

    expect(r.agenda.scheduleId).toBe('63d139467011f400114fa824');
  });

  it('un identificador que no es de este almacén no vale', async () => {
    const { servicio } = conCapacidades(AGENDAS_RC);

    await expect(
      servicio.buscarCapacidades(
        '20026',
        undefined,
        undefined,
        'PE',
        undefined,
        'de-otro-almacen',
      ),
    ).rejects.toThrow(/ninguna agenda de picking con ese identificador/);
  });

  it('sin servicio ni identificador, lo dice en vez de adivinar', async () => {
    const { servicio } = conCapacidades(AGENDAS_RC);

    await expect(
      servicio.buscarCapacidades('20026', undefined),
    ).rejects.toThrow(/Indica el tipo de servicio o el identificador/);
  });
});

describe('Una agenda sin capacidades no es un error', () => {
  /**
   * Es el caso de las agendas apartadas: existen en el catálogo pero nunca se
   * les creó una capacidad, y Ripley responde 404. Subía hasta el manejador de
   * excepciones, que imprimía una traza por cada una y devolvía un 500 al panel
   * por consultar algo que simplemente no tiene días.
   */
  function conRespuesta(respuesta: unknown | Error) {
    const { servicio, catalogos } = armar(AGENDAS_RC);

    (
      catalogos as unknown as {
        capacidadesDePicking: ReturnType<typeof vi.fn>;
      }
    ).capacidadesDePicking = vi.fn(() =>
      respuesta instanceof Error
        ? Promise.reject(respuesta)
        : Promise.resolve(respuesta),
    );

    return servicio;
  }

  const buscar = (servicio: PickingService) =>
    servicio.buscarCapacidades(
      '20026',
      undefined,
      undefined,
      'PE',
      undefined,
      '651c80d62b24860012956e46',
    );

  it('devuelve la agenda con cero días en vez de reventar', async () => {
    const servicio = conRespuesta(new RipleyApiError('No hay datos'));

    const r = await buscar(servicio);

    expect(r.agenda.nombre).toBe('Agenda Picking Olva - NO FUNCIONAL');
    expect(r.dias).toEqual([]);
  });

  it('y lo dice, para que el panel no parezca roto', async () => {
    const servicio = conRespuesta(new RipleyApiError('No hay datos'));

    expect((await buscar(servicio)).aviso).toMatch(/no tiene capacidades/);
  });

  it('un fallo que no sea "sin datos" sí sube', async () => {
    // Callar un 502 sería decir que la agenda no tiene días cuando lo que pasó
    // es que no se pudo preguntar
    const servicio = conRespuesta(
      new Error('La API corporativa respondió 502'),
    );

    await expect(buscar(servicio)).rejects.toThrow(/502/);
  });

  it('con días, no hay aviso', async () => {
    const servicio = conRespuesta({
      capacityByDayArray: [
        {
          day: '2026-09-21T00:00:00.000Z',
          active: true,
          assigned: 350,
          occupied: 0,
        },
      ],
    });

    const r = await buscar(servicio);

    expect(r.dias).toHaveLength(1);
    expect(r.aviso).toBeUndefined();
  });
});
