import { describe, expect, it, vi } from 'vitest';
import type { CatalogosRipleyService } from '../../common/ripley/catalogos.service.js';
import type { RipleyHttpService } from '../../common/ripley/ripley-http.service.js';
import type { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { RipleyApiError } from '../../common/ripley/ripley.errors.js';
import {
  hoyEnPais,
  isoToRipleyDate,
} from '../../common/ripley/utils/date.util.js';
import { RecepcionService } from './recepcion.service.js';

/**
 * Lo que distingue a recepción de picking.
 *
 * Dos identificadores que se parecen: la agenda tiene su `id` y dentro lleva el
 * `capacityId` de su capacidad. Se listan y se eligen por el primero; los días
 * se leen y se escriben con el segundo. Confundirlos no da error, da "sin
 * datos", así que aquí se fija cuál viaja a dónde.
 *
 * Y el PUT, que solo puede tocar dos campos: el asignado y el estado.
 */

const OFICINA = { id: 'o-20021', code: '20021', name: 'Ripley Chorrillos' };
const OTRA = { id: 'o-20026', code: '20026' };

const SERVICIOS = new Map([
  ['s-se', 'SE'],
  ['s-rc', 'RC'],
]);

/** Un día tal como lo devuelve /capacities */
const dia = (fecha: string, assigned = 250, occupied = 0) => ({
  day: `${fecha}T00:00:00.000Z`,
  active: true,
  assigned,
  occupied,
});

const DIAS = [dia('2026-09-29', 50, 24), dia('2026-09-30'), dia('2026-10-02')];

const agenda = (extra: Record<string, unknown> = {}) => ({
  id: 'a-se',
  name: 'Agenda de Recepción 20021 SE',
  active: true,
  autogenerate: false,
  unitMeasure: 'Unidades',
  type: { isReceptionSchedule: true },
  services: ['s-se'],
  oplOffices: [OFICINA],
  warehouses: [],
  // Se parece al id de la agenda y no lo es: cambia el final
  capacities: [{ capacityId: 'a-se-cap' }],
  capacitiesSelected: DIAS,
  weekBaseCapacity: { monday: 50, sunday: 50 },
  weekCutTime: { monday: '23:59', sunday: '23:59' },
  validityStart: '2024-02-06T05:00:00.000Z',
  validityEnd: '2030-12-31T05:00:00.000Z',
  ...extra,
});

function armar(filas: Array<Record<string, unknown>>, dias = DIAS) {
  const catalogos = {
    oficinaPorCodigo: vi.fn().mockResolvedValue(OFICINA),
    agendasDeRecepcion: vi.fn().mockResolvedValue(filas),
    mapaServicios: vi.fn().mockResolvedValue(SERVICIOS),
    capacidadesDeRecepcion: vi
      .fn()
      .mockResolvedValue({ id: 'a-se-cap', capacityByDayArray: dias }),
    servicios: vi.fn(),
    oficinasConTotal: vi.fn(),
  } as unknown as CatalogosRipleyService;

  const ripley = {
    endpoint: vi.fn().mockReturnValue('/capacities'),
    put: vi.fn().mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
    }),
  } as unknown as RipleyHttpService;

  const contexto = {
    registrarCambio: vi.fn(),
  } as unknown as ContextoAuditoria;

  return {
    servicio: new RecepcionService(catalogos, ripley, contexto),
    catalogos,
    ripley,
    contexto,
  };
}

describe('Las agendas son de la oficina que se pidió', () => {
  it('descarta la que pertenece a otra oficina', async () => {
    const { servicio } = armar([
      agenda(),
      agenda({ id: 'a-otra', services: ['s-rc'], oplOffices: [OTRA] }),
    ]);

    const agendas = await servicio.listarAgendasPorOficina('20021');

    expect(agendas.map((a) => a.scheduleId)).toEqual(['a-se']);
  });

  it('la reconoce por código aunque el id no coincida', async () => {
    const { servicio } = armar([
      agenda({ oplOffices: [{ id: 'otro-id', code: '20021' }] }),
    ]);

    expect(await servicio.listarAgendasPorOficina('20021')).toHaveLength(1);
  });

  it('pide a Ripley solo las de esta oficina', async () => {
    const { servicio, catalogos } = armar([agenda()]);

    await servicio.listarAgendasPorOficina('20021');

    expect(catalogos.agendasDeRecepcion).toHaveBeenCalledWith('o-20021', 'PE');
  });
});

describe('El listado no arrastra los días', () => {
  it('devuelve cuántos hay, no cuáles', async () => {
    const { servicio } = armar([agenda()]);

    const [primera] = await servicio.listarAgendasPorOficina('20021');

    expect(primera.dias).toBe(3);
    expect(primera).not.toHaveProperty('capacitiesSelected');
  });

  it('ni los pide: el listado no llama a /capacities', async () => {
    const { servicio, catalogos } = armar([agenda()]);

    await servicio.listarAgendasPorOficina('20021');

    expect(catalogos.capacidadesDeRecepcion).not.toHaveBeenCalled();
  });

  it('resuelve el código del servicio y la configuración semanal', async () => {
    const { servicio } = armar([agenda()]);

    const [primera] = await servicio.listarAgendasPorOficina('20021');

    expect(primera).toMatchObject({
      scheduleId: 'a-se',
      capacityId: 'a-se-cap',
      typeOfService: 'SE',
      unitMeasure: 'Unidades',
      activa: true,
      autogenera: false,
      vigenteDesde: '2024-02-06',
      vigenteHasta: '2030-12-31',
      capacidadSemanal: { monday: 50, sunday: 50 },
      cortesSemanales: { monday: '23:59', sunday: '23:59' },
    });
  });

  it('descarta la agenda cuyo servicio no está en el catálogo', async () => {
    const { servicio } = armar([agenda({ services: ['s-desconocido'] })]);

    expect(await servicio.listarAgendasPorOficina('20021')).toEqual([]);
  });
});

describe('Elegir una agenda entre varias', () => {
  const DOS_SE = [
    agenda(),
    agenda({ id: 'a-se-2', name: 'Agenda de Recepción 20021 SE bis' }),
  ];

  it('el identificador elige la agenda, no la primera del servicio', async () => {
    const { servicio } = armar(DOS_SE);

    const { agenda: elegida } = await servicio.buscarCapacidades(
      '20021',
      'SE',
      undefined,
      'PE',
      undefined,
      'a-se-2',
    );

    expect(elegida.scheduleId).toBe('a-se-2');
  });

  it('con solo el servicio, y dos agendas SE, no elige ninguna', async () => {
    const { servicio } = armar(DOS_SE);

    await expect(servicio.buscarCapacidades('20021', 'SE')).rejects.toThrow(
      /2 agendas con servicio SE/,
    );
  });

  it('con el servicio basta cuando solo hay una', async () => {
    const { servicio } = armar([agenda()]);

    const { agenda: elegida } = await servicio.buscarCapacidades('20021', 'SE');

    expect(elegida.scheduleId).toBe('a-se');
  });

  it('un identificador que no es de esta oficina no vale', async () => {
    const { servicio } = armar([agenda()]);

    await expect(
      servicio.buscarCapacidades(
        '20021',
        undefined,
        undefined,
        'PE',
        undefined,
        'a-de-otra',
      ),
    ).rejects.toThrow(/no tiene ninguna agenda de recepción/);
  });

  it('sin servicio ni identificador, lo dice en vez de adivinar', async () => {
    const { servicio } = armar([agenda()]);

    await expect(
      servicio.buscarCapacidades('20021', undefined),
    ).rejects.toThrow(/Indica el tipo de servicio o el identificador/);
  });
});

describe('Los días se leen del endpoint de capacidades', () => {
  it('con el id de la CAPACIDAD, no con el de la agenda', async () => {
    const { servicio, catalogos } = armar([agenda()]);

    await servicio.buscarCapacidades('20021', 'SE', '29-09-2026');

    expect(catalogos.capacidadesDeRecepcion).toHaveBeenCalledWith(
      'a-se-cap',
      'PE',
      '29-09-2026',
    );
  });

  it('sin "from" arranca en hoy, no en el principio de la agenda', async () => {
    const { servicio, catalogos } = armar([agenda()]);

    await servicio.buscarCapacidades('20021', 'SE');

    expect(catalogos.capacidadesDeRecepcion).toHaveBeenCalledWith(
      'a-se-cap',
      'PE',
      isoToRipleyDate(hoyEnPais('PE')),
    );
  });

  it('no usa la copia incrustada en la agenda', async () => {
    // La agenda dice tres días; el endpoint dice uno. Manda el endpoint.
    const { servicio } = armar([agenda()], [dia('2026-09-29')]);

    const { dias } = await servicio.buscarCapacidades('20021', 'SE');

    expect(dias).toHaveLength(1);
  });

  it('con "dias" se recorta desde la fecha pedida', async () => {
    const { servicio } = armar([agenda()]);

    const { dias } = await servicio.buscarCapacidades(
      '20021',
      'SE',
      '29-09-2026',
      'PE',
      2,
    );

    expect(dias.map((d) => d.day.slice(0, 10))).toEqual([
      '2026-09-29',
      '2026-09-30',
    ]);
  });

  it('una agenda sin capacidad creada no revienta: lo avisa', async () => {
    const { servicio, catalogos } = armar([agenda({ capacities: [] })]);

    const { dias, aviso } = await servicio.buscarCapacidades('20021', 'SE');

    expect(catalogos.capacidadesDeRecepcion).not.toHaveBeenCalled();
    expect(dias).toEqual([]);
    expect(aviso).toMatch(/no tiene capacidades/);
  });

  it('un 404 de Ripley es una agenda vacía, no un fallo', async () => {
    const { servicio, catalogos } = armar([agenda()]);
    vi.mocked(catalogos.capacidadesDeRecepcion).mockRejectedValue(
      new RipleyApiError('No hay datos para ese recurso'),
    );

    const { dias, aviso } = await servicio.buscarCapacidades('20021', 'SE');

    expect(dias).toEqual([]);
    expect(aviso).toMatch(/no tiene capacidades/);
  });

  it('otro fallo sí sube', async () => {
    const { servicio, catalogos } = armar([agenda()]);
    vi.mocked(catalogos.capacidadesDeRecepcion).mockRejectedValue(
      new Error('se cayó la red'),
    );

    await expect(servicio.buscarCapacidades('20021', 'SE')).rejects.toThrow(
      'se cayó la red',
    );
  });

  it('con días, no hay aviso', async () => {
    const { servicio } = armar([agenda()]);

    const { aviso } = await servicio.buscarCapacidades('20021', 'SE');

    expect(aviso).toBeUndefined();
  });
});

describe('Guardar un día', () => {
  const DIA = '2026-10-02T00:00:00.000Z';

  it('escribe sobre el id de la CAPACIDAD', async () => {
    const { servicio, ripley } = armar([agenda()]);

    await servicio.actualizar('20021', 'a-se', {
      day: DIA,
      assigned: 0,
      active: false,
    });

    expect(ripley.put).toHaveBeenCalledWith(
      '/capacities/a-se-cap',
      'PE',
      expect.anything(),
    );
  });

  it('manda el payload que espera Ripley', async () => {
    const { servicio, ripley } = armar([agenda()]);

    await servicio.actualizar('20021', 'a-se', {
      day: DIA,
      assigned: 0,
      active: false,
    });

    expect(vi.mocked(ripley.put).mock.calls[0][2]).toEqual({
      capacities: [
        {
          day: DIA,
          occupied: 0,
          assigned: 0,
          active: false,
          parsedDate: '02-10-2026',
          parsedDay: 'Friday',
        },
      ],
      schedules: [
        {
          country: 'PE',
          idOffice: '20021',
          type: 'reception',
          typeOfService: 'SE',
          unitMeasure: 'Unidades',
        },
      ],
    });
  });

  it('el ocupado sale del estado actual, no de quien edita', async () => {
    const { servicio, ripley } = armar([agenda()]);

    // El 29 lleva 24 unidades recibidas
    await servicio.actualizar('20021', 'a-se', {
      day: '2026-09-29T00:00:00.000Z',
      assigned: 80,
      active: true,
    });

    const payload = vi.mocked(ripley.put).mock.calls[0][2] as {
      capacities: { occupied: number; assigned: number }[];
    };

    expect(payload.capacities[0]).toMatchObject({ occupied: 24, assigned: 80 });
  });

  it('el idOffice es el código resuelto, no lo que escribió el cliente', async () => {
    const { servicio, ripley } = armar([agenda()]);

    // Una búsqueda incompleta que el catálogo resuelve a la 20021
    await servicio.actualizar('2002', 'a-se', {
      day: DIA,
      assigned: 0,
      active: false,
    });

    const payload = vi.mocked(ripley.put).mock.calls[0][2] as {
      schedules: { idOffice: string }[];
    };

    expect(payload.schedules[0].idOffice).toBe('20021');
  });

  it('registra cómo estaba el día y cómo queda', async () => {
    const { servicio, contexto } = armar([agenda()]);

    await servicio.actualizar('20021', 'a-se', {
      day: '2026-09-29T00:00:00.000Z',
      assigned: 80,
      active: false,
    });

    expect(contexto.registrarCambio).toHaveBeenCalledWith(
      expect.objectContaining({ assigned: 50, active: true, occupied: 24 }),
      expect.objectContaining({ assigned: 80, active: false }),
    );
  });

  it('un día que no está en la agenda no se inventa', async () => {
    const { servicio, ripley } = armar([agenda()]);

    await expect(
      servicio.actualizar('20021', 'a-se', {
        day: '2027-01-01T00:00:00.000Z',
        assigned: 0,
        active: false,
      }),
    ).rejects.toThrow(/No se encontró el día 2027-01-01/);

    expect(ripley.put).not.toHaveBeenCalled();
  });

  it('una agenda sin capacidad creada no se escribe', async () => {
    const { servicio, ripley } = armar([agenda({ capacities: [] })]);

    await expect(
      servicio.actualizar('20021', 'a-se', {
        day: DIA,
        assigned: 0,
        active: false,
      }),
    ).rejects.toThrow(/no tiene capacidad creada/);

    expect(ripley.put).not.toHaveBeenCalled();
  });

  it('matchedCount en cero es un 200 que no guardó nada, y se dice', async () => {
    const { servicio, ripley } = armar([agenda()]);
    vi.mocked(ripley.put).mockResolvedValue({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
    });

    await expect(
      servicio.actualizar('20021', 'a-se', {
        day: DIA,
        assigned: 0,
        active: false,
      }),
    ).rejects.toThrow(/no se guardó nada/);
  });

  it('devuelve qué quedó guardado', async () => {
    const { servicio } = armar([agenda()]);

    const resultado = await servicio.actualizar('20021', 'a-se', {
      day: DIA,
      assigned: 120,
      active: true,
    });

    expect(resultado).toEqual({
      agenda: 'SE - Agenda de Recepción 20021 SE',
      dia: '02-10-2026',
      asignado: 120,
      activa: true,
      ocupado: 0,
    });
  });
});

describe('El catálogo de servicios', () => {
  it('va sin los parámetros de despacho ni el correo de quien lo editó', async () => {
    const { servicio, catalogos } = armar([]);

    vi.mocked(catalogos.servicios).mockResolvedValue([
      {
        id: 's-se',
        code: 'SE',
        description: 'Recíbelo Hoy',
        isActive: true,
        serviceGroup: 'Despacho prioritario',
        enabledForCheckout: false,
        // Lo que Ripley manda de más y aquí no pinta nada
        maxOcurrence: 3,
        slackDays: 0,
        user: { email: 'alguien@ripley.com.pe' },
      } as never,
    ]);

    const [primero] = await servicio.listarServicios('PE');

    expect(primero).toEqual({
      id: 's-se',
      code: 'SE',
      descripcion: 'Recíbelo Hoy',
      activo: true,
      grupo: 'Despacho prioritario',
      enCheckout: false,
    });
  });
});

describe('La búsqueda de la oficina', () => {
  it('filtra por operador logístico y conserva el total de Ripley', async () => {
    const { servicio, catalogos } = armar([]);

    vi.mocked(catalogos.oficinasConTotal).mockResolvedValue({
      total: 1,
      filas: [{ id: 'o-20021', code: '20021', name: 'Ripley Chorrillos' }],
    });

    const { total, oficinas } = await servicio.buscarOficinas('20021', 'PE');

    expect(catalogos.oficinasConTotal).toHaveBeenCalledWith('PE', {
      q: '20021',
      tipo: 'opl',
    });
    expect(total).toBe(1);
    expect(oficinas).toEqual([
      {
        id: 'o-20021',
        code: '20021',
        nombre: 'Ripley Chorrillos',
        activo: null,
      },
    ]);
  });
});
