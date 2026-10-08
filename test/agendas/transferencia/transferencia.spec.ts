import { describe, expect, it, vi } from 'vitest';
import type { CatalogosRipleyService } from '../../../src/common/ripley/catalogos.service.js';
import type { RipleyHttpService } from '../../../src/common/ripley/ripley-http.service.js';
import type { ContextoAuditoria } from '../../../src/auditoria/contexto-auditoria.service.js';
import { RipleyApiError } from '../../../src/common/ripley/ripley.errors.js';
import { idDePais } from '../../../src/common/ripley/utils/pais.util.js';
import { TransferenciaAgendasService } from '../../../src/agendas/transferencia/transferencia-agendas.service.js';

/**
 * Agendas de transferencia: cuánto puede transferir al día una sucursal de
 * stock a un clúster de destino.
 *
 * Los datos son los del panel corporativo: la sucursal 20026 y el clúster de
 * Chorrillos, al que llegan dos agendas —la ST del 20026 y la SG de otro
 * origen—. Lo que se fija:
 * - se busca por los dos lados y las dos búsquedas llevan a la misma agenda;
 * - los días van con el `capacityId` (el de la capacidad del origen), no con
 *   el id de la agenda, que se le parece;
 * - el PUT tiene exactamente la forma del panel corporativo.
 */

const SUCURSAL_20026 = { id: '5dd8082dfbf76111b3f26b12', code: '20026', name: 'Ripley Fulfillment' };
const OTRO_ORIGEN = { id: '60a29939e0d2770bf4949595', code: '20096', name: 'CD Aldeas' };

const CLUSTERS = [
  { _id: '63235b45d51a418d28ea9fe2', name: '20021 - Chorrillos', warehouses: [{ code: 20021, name: 'Chorrillos', _id: 'w1' }] },
  { _id: '63235c17d51a418d28ea9fea', name: '20048 - Breña', warehouses: [{ code: 20048, name: 'Breña', _id: 'w2' }] },
  { _id: '63235c01d51a418d28ea9fe9', name: 'Asia', warehouses: [] },
  { _id: '65142dbfd7597b0012a7f167', name: 'PICKIT', warehouses: [] },
];

const SERVICIOS = new Map([
  ['655fc89913e5bdabaae5cecf', 'ST'],
  ['6890e2bc932119e50089801f', 'SG'],
  ['650dae9cd40ed947ac92ff46', 'RT'],
]);

const agendaST = {
  _id: '634878417e6a170011a32302',
  active: true,
  warehouses: [SUCURSAL_20026.id],
  services: ['655fc89913e5bdabaae5cecf'],
  autogenerate: false,
  name: 'Clúster Chorrillos ST - 20026 / 20021',
  type: { isTransferSchedule: true, isPickingSchedule: false, isDispatchSchedule: false, isReceptionSchedule: false, isStockSchedule: false, isPickingSupplierSchedule: false },
  unitMeasure: 'Unidades',
  validityStart: '2022-10-13T05:00:00.000Z',
  validityEnd: '2027-12-31T05:00:00.000Z',
  weekBaseCapacity: { monday: 70, sunday: 70 },
  weekCutTime: { monday: '23:59', sunday: '23:59' },
  cluster: '63235b45d51a418d28ea9fe2',
  // Se parece al id de la agenda (…302) y no lo es (…305)
  capacities: [{ capacityId: '634878417e6a170011a32305', warehouseId: SUCURSAL_20026.id, lastDayOccupied: '2026-10-09T00:00:00.000Z' }],
};

const agendaSG = {
  ...agendaST,
  _id: '6328cd7d1f78990014972922',
  name: 'Chorrillos SG',
  warehouses: [OTRO_ORIGEN.id],
  services: ['6890e2bc932119e50089801f'],
  capacities: [{ capacityId: '6328cd7d1f78990014972925', warehouseId: OTRO_ORIGEN.id }],
};

const agendaPickit = {
  ...agendaST,
  _id: '6515bfe3e69aaf0012bca1ef',
  name: 'Clúster PICKIT - 20026 / PICKIT',
  services: ['650dae9cd40ed947ac92ff46'],
  cluster: '65142dbfd7597b0012a7f167',
  capacities: [{ capacityId: '6515bfe3e69aaf0012bca1f1', warehouseId: SUCURSAL_20026.id }],
};

const dia = (fecha: string, active = true, assigned = 190, occupied = 0) => ({
  day: `${fecha}T00:00:00.000Z`, active, assigned, occupied,
});
const DIAS = [dia('2026-10-08', true, 190, 4), dia('2026-10-09', true, 190, 12), dia('2026-10-10', false), dia('2026-10-11'), dia('2026-10-12')];

function armar(agendas: Array<Record<string, unknown>> = [agendaST, agendaPickit], dias = DIAS) {
  const catalogos = {
    clusters: vi.fn().mockResolvedValue(CLUSTERS),
    oficinaPorCodigo: vi.fn().mockResolvedValue(SUCURSAL_20026),
    oficinas: vi.fn().mockImplementation(async (_pais: string, { id }: { id: string }) =>
      [SUCURSAL_20026, OTRO_ORIGEN].filter((o) => o.id === id)),
    oficinasConTotal: vi.fn().mockResolvedValue({ total: 1, filas: [SUCURSAL_20026] }),
    agendasDeTransferencia: vi.fn().mockResolvedValue(agendas),
    mapaServicios: vi.fn().mockImplementation(async () => new Map(SERVICIOS)),
    serviciosDeFechaDeDespacho: vi.fn().mockResolvedValue([]),
    capacidadesDeTransferencia: vi.fn().mockResolvedValue({ _id: 'cap', capacityByDayArray: dias }),
  } as unknown as CatalogosRipleyService;

  const ripley = {
    endpoint: vi.fn().mockReturnValue('/capacities'),
    put: vi.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1, upsertedId: null, upsertedCount: 0, matchedCount: 1 }),
  } as unknown as RipleyHttpService;

  const contexto = { registrarCambio: vi.fn() } as unknown as ContextoAuditoria;

  return { servicio: new TransferenciaAgendasService(catalogos, ripley, contexto), catalogos, ripley, contexto };
}

describe('Primera forma: por sucursal de stock', () => {
  it('busca las agendas del origen por su id interno', async () => {
    const { servicio, catalogos } = armar();

    await servicio.listarAgendas({ origen: '20026' });

    expect(catalogos.oficinaPorCodigo).toHaveBeenCalledWith('20026', 'PE', 'almacen', 'la sucursal de stock');
    expect(catalogos.agendasDeTransferencia).toHaveBeenCalledWith({ warehouseId: SUCURSAL_20026.id }, 'PE');
  });

  it('cada agenda con su origen, su destino y su servicio ya traducidos', async () => {
    const { servicio } = armar();

    const [st, pickit] = await servicio.listarAgendas({ origen: '20026' });

    expect(st).toMatchObject({
      scheduleId: '634878417e6a170011a32302',
      capacityId: '634878417e6a170011a32305',
      nombre: 'Clúster Chorrillos ST - 20026 / 20021',
      origen: { code: '20026', nombre: 'Ripley Fulfillment' },
      destino: { code: '20021', nombre: '20021 - Chorrillos', clusterId: '63235b45d51a418d28ea9fe2' },
      typeOfService: 'ST',
      unitMeasure: 'Unidades',
      activa: true,
      vigenteHasta: '2027-12-31',
      capacidadSemanal: { monday: 70, sunday: 70 },
      ultimoDiaOcupado: '2026-10-09',
    });
    // Un clúster sin almacén es un destino sin código, con su nombre
    expect(pickit.destino).toEqual({ code: null, nombre: 'PICKIT', clusterId: '65142dbfd7597b0012a7f167' });
  });

  it('descarta lo que no sea de ese origen, aunque Ripley lo devuelva', async () => {
    const { servicio } = armar([agendaST, agendaSG]);

    const agendas = await servicio.listarAgendas({ origen: '20026' });

    expect(agendas.map((a) => a.scheduleId)).toEqual(['634878417e6a170011a32302']);
  });
});

describe('Poner nombre a los orígenes sin bombardear la API', () => {
  /** Veinticinco agendas hacia un destino, cada una de un origen distinto */
  const deVariosOrigenes = Array.from({ length: 25 }, (_, i) => ({
    ...agendaSG, _id: `a${i}`, warehouses: [`w${i}`], capacities: [{ capacityId: `c${i}`, warehouseId: `w${i}` }],
  }));

  it('primero el catálogo de sucursales, de una vez: si están ahí, ni una consulta más', async () => {
    const { servicio, catalogos } = armar(deVariosOrigenes);
    const todas = deVariosOrigenes.map((_, i) => ({ id: `w${i}`, code: String(10000 + i), name: `Tienda ${i}` }));
    vi.mocked(catalogos.oficinas).mockImplementation(async (_p, f) => (f?.tipo === 'almacen' ? todas : []));

    const agendas = await servicio.listarAgendas({ destinos: ['20021'] });

    expect(agendas[24].origen).toEqual({ code: '10024', nombre: 'Tienda 24' });
    expect(catalogos.oficinas).toHaveBeenCalledTimes(1);
  });

  it('con la API caída, al primer fallo deja de preguntar y las agendas llegan igual', async () => {
    const { servicio, catalogos } = armar(deVariosOrigenes);
    vi.mocked(catalogos.oficinas).mockImplementation(async (_p, f) => {
      if (f?.tipo === 'almacen') return [];
      throw new Error('La API corporativa respondió 503 al consultar');
    });

    const agendas = await servicio.listarAgendas({ destinos: ['20021'] });

    expect(agendas).toHaveLength(25);
    expect(agendas[0].origen).toBeNull();
    // El catálogo, y como mucho una tanda de cuatro: no veinticinco
    expect(vi.mocked(catalogos.oficinas).mock.calls.length).toBeLessThanOrEqual(5);
  });
});

describe('Sin catálogo de clústeres', () => {
  it('por origen se sigue: la agenda llega, con su destino sin nombre', async () => {
    const { servicio, catalogos } = armar([agendaST]);
    vi.mocked(catalogos.clusters).mockRejectedValue(new Error('Falta configurar el endpoint "clusters"'));

    const [st] = await servicio.listarAgendas({ origen: '20026' });

    expect(st).toMatchObject({ scheduleId: agendaST._id, origen: { code: '20026' }, destino: { code: null, nombre: '' } });
  });

  it('por destino no: sin el catálogo no se sabe qué clúster es, y se dice', async () => {
    const { servicio, catalogos } = armar([agendaST]);
    vi.mocked(catalogos.clusters).mockRejectedValue(new Error('Falta configurar el endpoint "clusters"'));

    await expect(servicio.listarAgendas({ destinos: ['20021'] })).rejects.toThrow(/Falta configurar el endpoint "clusters"/);
  });
});

describe('Segunda forma: por clúster de destino', () => {
  it('"20021" es el clúster que tiene ese almacén: se busca por su id', async () => {
    const { servicio, catalogos } = armar([agendaSG, agendaST]);

    await servicio.listarAgendas({ destinos: ['20021'] });

    expect(catalogos.agendasDeTransferencia).toHaveBeenCalledWith({ clusters: ['63235b45d51a418d28ea9fe2'] }, 'PE');
  });

  it('llegan las agendas de todos los orígenes, cada una con el suyo', async () => {
    const { servicio } = armar([agendaSG, agendaST]);

    const agendas = await servicio.listarAgendas({ destinos: ['20021'] });

    expect(agendas.map((a) => [a.nombre, a.origen?.code, a.typeOfService])).toEqual([
      ['Chorrillos SG', '20096', 'SG'],
      ['Clúster Chorrillos ST - 20026 / 20021', '20026', 'ST'],
    ]);
  });

  it('un clúster sin almacén se encuentra por su nombre', async () => {
    const { servicio, catalogos } = armar([agendaPickit]);

    await servicio.listarAgendas({ destinos: ['pickit'] });

    expect(catalogos.agendasDeTransferencia).toHaveBeenCalledWith({ clusters: ['65142dbfd7597b0012a7f167'] }, 'PE');
  });

  it('varios destinos van en una sola búsqueda', async () => {
    const { servicio, catalogos } = armar([]);

    await servicio.listarAgendas({ destinos: ['20021', '20048'] });

    expect(catalogos.agendasDeTransferencia).toHaveBeenCalledTimes(1);
    expect(catalogos.agendasDeTransferencia).toHaveBeenCalledWith({ clusters: ['63235b45d51a418d28ea9fe2', '63235c17d51a418d28ea9fea'] }, 'PE');
  });

  it('con origen y destino, solo las de ese par', async () => {
    const { servicio } = armar([agendaSG, agendaST]);

    const agendas = await servicio.listarAgendas({ origen: '20026', destinos: ['20021'] });

    expect(agendas.map((a) => a.scheduleId)).toEqual(['634878417e6a170011a32302']);
  });

  it('un destino que no existe se dice, no se busca en todo el país', async () => {
    const { servicio, catalogos } = armar();

    await expect(servicio.listarAgendas({ destinos: ['99999'] })).rejects.toThrow(/ningún clúster de destino/);
    expect(catalogos.agendasDeTransferencia).not.toHaveBeenCalled();
  });

  it('sin origen ni destino no se busca nada', async () => {
    const { servicio } = armar();

    await expect(servicio.listarAgendas({})).rejects.toThrow(/sucursal de stock .* o el clúster de destino/);
  });
});

describe('Las dos formas llevan a los mismos días', () => {
  it('los días se piden con el capacityId de la agenda, no con su id', async () => {
    const { servicio, catalogos } = armar();

    const r = await servicio.buscarCapacidades({ origen: '20026' }, '634878417e6a170011a32302', '08-10-2026');

    expect(catalogos.capacidadesDeTransferencia).toHaveBeenCalledWith('634878417e6a170011a32305', 'PE', '08-10-2026');
    expect(r.dias).toHaveLength(5);
    expect(r.agenda.typeOfService).toBe('ST');
  });

  it('por destino, la misma agenda y la misma llamada', async () => {
    const { servicio, catalogos } = armar([agendaSG, agendaST]);

    await servicio.buscarCapacidades({ destinos: ['20021'] }, '634878417e6a170011a32302', '08-10-2026');

    expect(catalogos.capacidadesDeTransferencia).toHaveBeenCalledWith('634878417e6a170011a32305', 'PE', '08-10-2026');
  });

  it('se toma la capacidad del almacén de origen, no la primera de la lista', async () => {
    const conDos = { ...agendaST, capacities: [{ capacityId: 'de-otro', warehouseId: 'otro' }, ...agendaST.capacities] };
    const { servicio, catalogos } = armar([conDos]);

    await servicio.buscarCapacidades({ origen: '20026' }, agendaST._id, '08-10-2026');

    expect(catalogos.capacidadesDeTransferencia).toHaveBeenCalledWith('634878417e6a170011a32305', 'PE', '08-10-2026');
  });

  it('el capacityId expandido como documento se lee igual', async () => {
    const expandida = { ...agendaST, capacities: [{ capacityId: { _id: '634878417e6a170011a32305' }, warehouseId: SUCURSAL_20026.id }] };
    const { servicio, catalogos } = armar([expandida]);

    await servicio.buscarCapacidades({ origen: '20026' }, agendaST._id, '08-10-2026');

    expect(catalogos.capacidadesDeTransferencia).toHaveBeenCalledWith('634878417e6a170011a32305', 'PE', '08-10-2026');
  });

  it('"dias" recorta desde la fecha pedida', async () => {
    const { servicio } = armar();

    const r = await servicio.buscarCapacidades({ origen: '20026' }, agendaST._id, '09-10-2026', 'PE', 2);

    expect(r.dias.map((d) => d.day.slice(0, 10))).toEqual(['2026-10-09', '2026-10-10']);
  });

  it('una agenda sin capacidad creada es una agenda vacía, no un error', async () => {
    const { servicio, catalogos } = armar();
    vi.mocked(catalogos.capacidadesDeTransferencia).mockRejectedValue(new RipleyApiError('No hay datos para ese recurso'));

    const r = await servicio.buscarCapacidades({ origen: '20026' }, agendaST._id);

    expect(r).toMatchObject({ dias: [], aviso: 'Esta agenda no tiene capacidades configuradas.' });
  });

  it('un id que no es de ese origen o destino es un 404', async () => {
    const { servicio } = armar();

    await expect(servicio.buscarCapacidades({ origen: '20026' }, 'otra')).rejects.toThrow(/ninguna agenda de transferencia/);
  });
});

describe('Editar un día', () => {
  const BODY = { day: '2026-10-12T00:00:00.000Z', assigned: 190, active: false };

  it('el PUT va al capacityId con la forma exacta del panel corporativo', async () => {
    const { servicio, ripley } = armar();

    await servicio.actualizar({ origen: '20026' }, agendaST._id, BODY);

    expect(ripley.put).toHaveBeenCalledWith('/capacities/634878417e6a170011a32305', 'PE', {
      capacities: [{ active: false, assigned: 190, day: '2026-10-12T00:00:00.000Z', occupied: 0 }],
      schedules: [{ country: 'PE', idOffice: '20026', type: 'transfer', typeOfService: 'ST', unitMeasure: 'Unidades' }],
    });
  });

  it('buscando por destino se escribe igual, con el código del ORIGEN', async () => {
    const { servicio, ripley } = armar([agendaSG, agendaST]);

    await servicio.actualizar({ destinos: ['20021'] }, agendaST._id, BODY);

    expect(vi.mocked(ripley.put).mock.calls[0][2]).toMatchObject({ schedules: [{ idOffice: '20026' }] });
  });

  it('lo ocupado sale del estado actual, no de la petición', async () => {
    const { servicio, ripley } = armar();

    await servicio.actualizar({ origen: '20026' }, agendaST._id, { day: '2026-10-08T00:00:00.000Z', assigned: 200, active: true });

    expect(vi.mocked(ripley.put).mock.calls[0][2]).toMatchObject({ capacities: [{ occupied: 4, assigned: 200 }] });
  });

  it('un día que no está en la agenda no se escribe', async () => {
    const { servicio, ripley } = armar();

    await expect(servicio.actualizar({ origen: '20026' }, agendaST._id, { ...BODY, day: '2026-11-30T00:00:00.000Z' })).rejects.toThrow(/No se encontró el día/);
    expect(ripley.put).not.toHaveBeenCalled();
  });

  it('matchedCount 0 no es un "guardado"', async () => {
    const { servicio, ripley } = armar();
    vi.mocked(ripley.put).mockResolvedValue({ matchedCount: 0 });

    await expect(servicio.actualizar({ origen: '20026' }, agendaST._id, BODY)).rejects.toThrow(/no se guardó nada/);
  });

  it('queda en el registro el antes y el después', async () => {
    const { servicio, contexto } = armar();

    await servicio.actualizar({ origen: '20026' }, agendaST._id, BODY);

    expect(contexto.registrarCambio).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, assigned: 190, occupied: 0 }),
      expect.objectContaining({ active: false, assigned: 190 }),
    );
  });

  it('un servicio que /services no tiene se busca en el catálogo de fecha de despacho', async () => {
    const { servicio, catalogos, ripley } = armar([{ ...agendaST, services: ['nuevo'] }]);
    vi.mocked(catalogos.serviciosDeFechaDeDespacho).mockResolvedValue([{ id: 'nuevo', code: 'XX' }]);

    await servicio.actualizar({ origen: '20026' }, agendaST._id, BODY);

    expect(vi.mocked(ripley.put).mock.calls[0][2]).toMatchObject({ schedules: [{ typeOfService: 'XX' }] });
  });

  it('sin servicio resuelto no se escribe a ciegas', async () => {
    const { servicio, ripley } = armar([{ ...agendaST, services: ['desconocido'] }]);

    await expect(servicio.actualizar({ origen: '20026' }, agendaST._id, BODY)).rejects.toThrow(/tipo de servicio/);
    expect(ripley.put).not.toHaveBeenCalled();
  });
});

describe('El país del catálogo de clústeres', () => {
  it('va con el id interno de cada país', () => {
    expect(idDePais('PE')).toBe('5d2f3e289c66136f62dafb48');
    expect(idDePais('cl')).toBe('5d2f3e139c66136f62dafb47');
  });
});
