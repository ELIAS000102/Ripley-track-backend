import { describe, expect, it, vi } from 'vitest';
import type { CatalogosRipleyService } from '../../common/ripley/catalogos.service.js';
import type { RipleyHttpService } from '../../common/ripley/ripley-http.service.js';
import type { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { PickingService } from './picking.service.js';

/**
 * Cada agenda tiene que quedarse con **su** capacidad en este almacén.
 *
 * Se tomaba `capacities[0]`, y una agenda puede tener capacidades en varios
 * almacenes. El resultado se vio en el panel: cinco agendas del 20026 —la de RC
 * y cuatro marcadas "NO FUNCIONAL"— aparecían con el mismo Schedule ID y
 * exactamente los mismos días. Editar cualquiera de ellas escribía sobre la
 * misma, y no había forma de saberlo mirando la pantalla.
 */

const ALMACEN = 'w-20026';
const OTRO = 'w-20040';

/** El catálogo de servicios: id interno -> código visible */
const SERVICIOS = new Map([
  ['s-rc', 'RC'],
  ['s-s', 'S'],
]);

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

  it('dos agendas distintas no comparten identificador', async () => {
    // El caso real: varias agendas con el servicio RC, cada una con su
    // capacidad en el 20026 y una ajena compartida que iba primera
    const compartida = { capacityId: 'cap-compartida', warehouseId: OTRO };

    const { servicio } = armar([
      {
        name: 'Agenda Picking RC - 20026',
        services: ['s-rc'],
        capacities: [
          compartida,
          { capacityId: 'cap-rc', warehouseId: ALMACEN },
        ],
      },
      {
        name: 'Agenda Picking Olva - NO FUNCIONAL',
        services: ['s-rc'],
        capacities: [
          compartida,
          { capacityId: 'cap-olva', warehouseId: ALMACEN },
        ],
      },
    ]);

    const agendas = await servicio.listarAgendasPorOficina('20026');
    const ids = agendas.map((a) => a.scheduleId);

    expect(ids).toEqual(['cap-rc', 'cap-olva']);
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

  it('resuelve el código visible del servicio', async () => {
    const { servicio } = armar([
      {
        name: 'Agenda Picking RC - 20026',
        services: ['s-rc'],
        unitMeasure: 'Unidades',
        active: true,
        capacities: [{ capacityId: 'cap-rc', warehouseId: ALMACEN }],
      },
    ]);

    expect((await servicio.listarAgendasPorOficina('20026'))[0]).toEqual({
      scheduleId: 'cap-rc',
      nombre: 'Agenda Picking RC - 20026',
      typeOfService: 'RC',
      unitMeasure: 'Unidades',
      activa: true,
    });
  });
});
