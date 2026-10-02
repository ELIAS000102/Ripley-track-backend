import { describe, expect, it, vi } from 'vitest';
import type { DespachoService } from '../../../../src/agendas/despacho/despacho.service.js';
import type { PickingService } from '../../../../src/agendas/picking/picking.service.js';
import type { RecepcionService } from '../../../../src/agendas/recepcion/recepcion.service.js';
import { CapacidadAgenteService } from '../../../../src/agente/consultas/capacidad/capacidad.service.js';

/**
 * Pedir una zona o una agenda concretas, y que no vengan sus parecidas.
 *
 * Los nombres reales se solapan: el operador 1401 tiene la zona
 * "Zona 1401 - Suc. Aldea 6 Lima/Metropolitana" y también la
 * "…Lima/Metropolitana BT", y la primera es prefijo de la segunda. Con el
 * `includes` que había, pedir la primera consultaba las dos y el resultado
 * decía que se habían mirado dos zonas que nadie pidió.
 *
 * Y faltaba poder pedir la agenda: una zona tiene varias, así que sin ese campo
 * solo se podían traer todas las de la zona. El apartado del panel sí la pide.
 */

const HOY = '2026-10-01';

/** Las zonas del 1401, tal como vienen: una es prefijo de la otra */
const ZONAS_1401 = [
  { zoneId: 'z-1', nombre: 'Zona 1401 - Suc. Aldea 6 Lima/Metropolitana' },
  { zoneId: 'z-2', nombre: 'Zona 1401 - Suc. Aldea 6 Lima/Metropolitana BT' },
];

const AGENDAS_POR_ZONA: Record<string, Array<Record<string, unknown>>> = {
  'z-1': [
    { mainScheduleId: 'a-1', nombre: 'Agenda SD Aldea 6' },
    { mainScheduleId: 'a-2', nombre: 'Agenda SD Aldea 6 Express' },
  ],
  'z-2': [{ mainScheduleId: 'a-3', nombre: 'Agenda SD Aldea 6 BT' }],
};

function armar() {
  const listarAgendas = vi.fn((zoneId: string) =>
    Promise.resolve(AGENDAS_POR_ZONA[zoneId] ?? []),
  );

  const despacho = {
    listarZonas: vi.fn().mockResolvedValue(ZONAS_1401),
    listarAgendas,
    buscarCapacidades: vi.fn().mockResolvedValue({
      agenda: { unitMeasure: 'UNIDAD', servicios: ['SD'] },
      dias: [{ date: '01-10-2026', assigned: '90', occupied: 0, active: true }],
    }),
  } as unknown as DespachoService;

  const picking = {
    listarAgendasPorOficina: vi.fn().mockResolvedValue([
      { scheduleId: 'p-1', nombre: 'Agenda Picking RC', typeOfService: 'RC' },
      { scheduleId: 'p-2', nombre: 'Agenda Picking RC Norte', typeOfService: 'RC' },
    ]),
    obtener: vi.fn().mockResolvedValue({
      capacityByDayArray: [
        { day: `${HOY}T00:00:00.000Z`, active: true, assigned: 90, occupied: 0 },
      ],
    }),
  } as unknown as PickingService;

  const recepcion = {
    capacidadesDeLaOficina: vi.fn().mockResolvedValue([
      {
        scheduleId: 'r-1',
        nombre: 'Agenda de Recepción 20021',
        typeOfService: 'RC',
        unitMeasure: 'Unidades',
        dias: [
          { day: `${HOY}T00:00:00.000Z`, assigned: 50, occupied: 0, active: true },
        ],
      },
      {
        scheduleId: 'r-2',
        nombre: 'Agenda de Recepción 20021 BT',
        typeOfService: 'RC',
        unitMeasure: 'Unidades',
        dias: [
          { day: `${HOY}T00:00:00.000Z`, assigned: 10, occupied: 0, active: true },
        ],
      },
    ]),
  } as unknown as RecepcionService;

  return {
    servicio: new CapacidadAgenteService(picking, despacho, recepcion),
    listarAgendas,
  };
}

const pedir = (extra: Record<string, unknown>) =>
  ({ desde: HOY, dias: 1, pais: 'PE', codigo: '1401', ...extra }) as never;

/** Los nombres de las agendas que volvieron, de todas las oficinas */
const nombres = (r: { oficinas: { agendas: { agenda: string }[] }[] }) =>
  r.oficinas.flatMap((o) => o.agendas.map((a) => a.agenda));

const zonas = (r: { oficinas: { agendas: { zona?: string | null }[] }[] }) => [
  ...new Set(r.oficinas.flatMap((o) => o.agendas.map((a) => a.zona))),
];

describe('La zona exacta no arrastra a la que la contiene', () => {
  it('pedir la zona completa trae solo esa', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      pedir({
        tipo: 'despacho',
        zona: 'Zona 1401 - Suc. Aldea 6 Lima/Metropolitana',
      }),
    );

    expect(zonas(r)).toEqual(['Zona 1401 - Suc. Aldea 6 Lima/Metropolitana']);
  });

  it('y la que termina en BT se pide por su nombre, también sola', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      pedir({
        tipo: 'despacho',
        zona: 'Zona 1401 - Suc. Aldea 6 Lima/Metropolitana BT',
      }),
    );

    expect(zonas(r)).toEqual(['Zona 1401 - Suc. Aldea 6 Lima/Metropolitana BT']);
  });

  it('un nombre parcial sigue trayendo las que empiecen por él', async () => {
    const { servicio } = armar();

    // Es lo que permite escribir "Aldea 6" y no el nombre entero
    const r = await servicio.consultar(pedir({ tipo: 'despacho', zona: 'Aldea 6' }));

    expect(zonas(r)).toHaveLength(2);
  });

  it('sin zona vienen todas', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(pedir({ tipo: 'despacho' }));

    expect(zonas(r)).toHaveLength(2);
  });
});

describe('La agenda, que antes no se podía pedir', () => {
  it('en despacho acota dentro de la zona', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      pedir({
        tipo: 'despacho',
        zona: 'Zona 1401 - Suc. Aldea 6 Lima/Metropolitana',
        agenda: 'Agenda SD Aldea 6',
      }),
    );

    // Exacta: no arrastra "Agenda SD Aldea 6 Express"
    expect(nombres(r)).toEqual(['Agenda SD Aldea 6']);
  });

  it('en picking desempata dos agendas del mismo servicio', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      pedir({ tipo: 'picking', codigo: '20026', servicio: 'RC', agenda: 'Agenda Picking RC' }),
    );

    expect(nombres(r)).toEqual(['Agenda Picking RC']);
  });

  it('en recepción también', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      pedir({ tipo: 'recepcion', codigo: '20021', agenda: 'Agenda de Recepción 20021' }),
    );

    expect(nombres(r)).toEqual(['Agenda de Recepción 20021']);
  });

  it('se filtra sobre todas las zonas, no zona por zona', async () => {
    const { servicio } = armar();

    // "Agenda SD Aldea 6 BT" solo existe en la segunda zona: pedirla sin zona
    // debe encontrarla, no dejar a la primera sin agendas y avisar de nada
    const r = await servicio.consultar(
      pedir({ tipo: 'despacho', agenda: 'Agenda SD Aldea 6 BT' }),
    );

    expect(nombres(r)).toEqual(['Agenda SD Aldea 6 BT']);
    expect(r.sinDatos ?? []).toEqual([]);
  });
});

describe('Cuando ningún filtro encaja, el aviso dice cuál', () => {
  it('nombra la agenda pedida y no dice que no haya agendas', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      pedir({ tipo: 'despacho', agenda: 'Agenda que no existe' }),
    );

    expect(r.sinDatos?.join(' ')).toContain('Agenda que no existe');
    expect(r.sinDatos?.join(' ')).not.toMatch(/no tiene agendas de despacho$/);
  });

  it('y nombra los dos cuando se filtró por servicio y por agenda', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      pedir({ tipo: 'picking', codigo: '20026', servicio: 'RC', agenda: 'ninguna' }),
    );

    const aviso = r.sinDatos?.join(' ') ?? '';
    expect(aviso).toContain('servicio RC');
    expect(aviso).toContain('"ninguna"');
  });
});
