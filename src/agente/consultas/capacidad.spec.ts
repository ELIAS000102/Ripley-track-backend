import { describe, expect, it, vi } from 'vitest';
import type { DespachoService } from '../../agendas/despacho/despacho.service.js';
import type { PickingService } from '../../agendas/picking/picking.service.js';
import { CapacidadAgenteService } from './capacidad.service.js';

/**
 * Consultar la capacidad de varias oficinas en una llamada.
 *
 * "Dame el despacho de la 1130 1017 1024" devolvía solo la primera y avisaba
 * de que las otras dos no valían — cuando lo que pasaba es que el backend solo
 * miraba una. La edición ya aceptaba listas; la consulta no.
 */

const HOY = '2026-09-27';

/** Un día cualquiera, con la forma que devuelve picking */
const diaPicking = (fecha: string) => ({
  day: `${fecha}T00:00:00.000Z`,
  active: true,
  assigned: 90,
  occupied: 0,
});

function armar({
  agendasPorOficina,
  zonasPorOperador,
}: {
  agendasPorOficina?: Record<string, Array<Record<string, unknown>>>;
  zonasPorOperador?: Record<string, Array<Record<string, unknown>>>;
} = {}) {
  const listarAgendasPorOficina = vi.fn((codigo: string) => {
    const agendas = agendasPorOficina?.[codigo];

    if (!agendas) {
      return Promise.reject(
        new Error(`No se encontró el almacén con código ${codigo}`),
      );
    }

    return Promise.resolve(agendas);
  });

  const picking = {
    listarAgendasPorOficina,
    obtener: vi.fn().mockResolvedValue({
      capacityByDayArray: [diaPicking(HOY)],
    }),
  } as unknown as PickingService;

  const listarZonas = vi.fn((codigo: string) => {
    const zonas = zonasPorOperador?.[codigo];

    if (!zonas) {
      return Promise.reject(
        new Error(`No se encontró el operador con código ${codigo}`),
      );
    }

    return Promise.resolve(zonas);
  });

  const despacho = {
    listarZonas,
    listarAgendas: vi
      .fn()
      .mockResolvedValue([{ mainScheduleId: 'ms-1', nombre: 'Agenda DT' }]),
    buscarCapacidades: vi.fn().mockResolvedValue({
      agenda: { unitMeasure: 'UNIDAD', servicios: ['EX', 'DT'] },
      dias: [{ date: '27-09-2026', assigned: '90', occupied: 0, active: true }],
    }),
  } as unknown as DespachoService;

  return {
    servicio: new CapacidadAgenteService(picking, despacho),
    listarAgendasPorOficina,
    listarZonas,
  };
}

const consultar = (extra: Record<string, unknown>) =>
  ({ tipo: 'picking', desde: HOY, dias: 1, pais: 'PE', ...extra }) as never;

const PICKING = {
  '20026': [{ scheduleId: 'c-1', nombre: 'Picking S', typeOfService: 'S' }],
  '20096': [{ scheduleId: 'c-2', nombre: 'Picking SG', typeOfService: 'SG' }],
};

const DESPACHO = {
  '1130': [{ zoneId: 'z-1', nombre: 'Zona 1130 - EX Miraflores' }],
  '1140': [{ zoneId: 'z-2', nombre: 'Zona 1140' }],
};

describe('Capacidad: varias oficinas de una vez', () => {
  it('picking devuelve un grupo por almacén', async () => {
    const { servicio } = armar({ agendasPorOficina: PICKING });

    const r = await servicio.consultar(consultar({ codigo: '20026, 20096' }));

    expect(r.oficinas).toHaveLength(2);
    expect(r.oficinas.map((o) => o.oficina)).toEqual(['20026', '20096']);
    expect(r.oficinas[0].agendas).toHaveLength(1);
  });

  it('despacho también', async () => {
    const { servicio } = armar({ zonasPorOperador: DESPACHO });

    const r = await servicio.consultar(
      consultar({ tipo: 'despacho', codigo: '1130, 1140' }),
    );

    expect(r.oficinas).toHaveLength(2);
    expect(r.oficinas[0].agendas[0].agenda).toBe('Agenda DT');
  });

  it('la lista viene igual aunque se pida una sola', async () => {
    const { servicio } = armar({ agendasPorOficina: PICKING });

    const r = await servicio.consultar(consultar({ codigo: '20026' }));

    expect(r.oficinas).toHaveLength(1);
  });

  /** La frase exacta de la captura: separados por espacios */
  it('los separa por espacios, como se escriben en el chat', async () => {
    const { servicio, listarZonas } = armar({ zonasPorOperador: DESPACHO });

    await servicio
      .consultar(consultar({ tipo: 'despacho', codigo: '1130 1017 1024' }))
      .catch(() => null);

    expect(listarZonas.mock.calls.map((c) => c[0])).toEqual([
      '1130',
      '1017',
      '1024',
    ]);
  });

  it('una que falla no arrastra a las demás', async () => {
    const { servicio } = armar({ zonasPorOperador: DESPACHO });

    const r = await servicio.consultar(
      consultar({ tipo: 'despacho', codigo: '1130, 9999' }),
    );

    expect(r.oficinas[0].agendas).toHaveLength(1);
    expect(r.oficinas[1].error).toMatch(/No se encontró el operador/);
    expect(r.oficinas[1].agendas).toHaveLength(0);
  });

  it('si fallan todas, es un 404 con los motivos', async () => {
    const { servicio } = armar({ zonasPorOperador: DESPACHO });

    await expect(
      servicio.consultar(consultar({ tipo: 'despacho', codigo: '8888, 9999' })),
    ).rejects.toThrow(/Ninguna de las 2 oficinas se pudo consultar/);
  });

  it('una repetida se consulta una sola vez', async () => {
    const { servicio, listarAgendasPorOficina } = armar({
      agendasPorOficina: PICKING,
    });

    const r = await servicio.consultar(consultar({ codigo: '20026, 20026' }));

    expect(r.oficinas).toHaveLength(1);
    expect(listarAgendasPorOficina).toHaveBeenCalledOnce();
  });

  it('hay tope, y remite al reporte de los CDs', async () => {
    // Cada oficina son sus agendas, y cada agenda una llamada más
    const { servicio, listarAgendasPorOficina } = armar();

    await expect(
      servicio.consultar(consultar({ codigo: '1 2 3 4 5 6' })),
    ).rejects.toThrow(/máximo por vez es 5[\s\S]*reporte de los CDs/);

    expect(listarAgendasPorOficina).not.toHaveBeenCalled();
  });
});

describe('Capacidad: el alias y los avisos', () => {
  it('"90 min" es el 1130 en despacho, y se dice cuál era', async () => {
    const { servicio, listarZonas } = armar({ zonasPorOperador: DESPACHO });

    const r = await servicio.consultar(
      consultar({ tipo: 'despacho', codigo: '90 min' }),
    );

    expect(listarZonas).toHaveBeenCalledWith('1130', 'PE');
    expect(r.oficinas[0].oficina).toBe('1130 (90 min)');
  });

  it('en picking el alias no aplica: es otro catálogo', async () => {
    const { servicio, listarAgendasPorOficina } = armar({
      agendasPorOficina: { '90 min': [] },
    });

    await servicio.consultar(consultar({ codigo: '90 min' }));

    expect(listarAgendasPorOficina).toHaveBeenCalledWith('90 min', 'PE');
  });

  it('los avisos dicen de qué oficina hablan', async () => {
    // Con varias, "no tiene agendas" a secas no dice de cuál
    const { servicio } = armar({
      agendasPorOficina: { ...PICKING, '20099': [] },
    });

    const r = await servicio.consultar(
      consultar({ codigo: '20026, 20099', servicio: 'S' }),
    );

    expect(r.sinDatos.join(' ')).toMatch(/20099:/);
  });
});
