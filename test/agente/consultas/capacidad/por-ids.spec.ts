import { describe, expect, it, vi } from 'vitest';
import { CapacidadAgenteService } from '../../../../src/agente/consultas/capacidad/capacidad.service.js';

/**
 * La capacidad con las agendas ya resueltas (los ids que guardan los atajos):
 * una lectura por agenda, sin buscar la oficina, sus zonas ni sus agendas.
 */
function armar() {
  const picking = {
    obtener: vi.fn(async () => ({
      capacityByDayArray: [{ day: '2026-11-23T00:00:00Z', active: true, assigned: 100, occupied: 40 }],
    })),
    listarAgendasPorOficina: vi.fn(),
  };
  const despacho = {
    buscarCapacidades: vi.fn(async () => ({
      agenda: { servicios: ['S', 'DT'], unitMeasure: 'pedidos' },
      dias: [{ date: '23/11/2026', active: false, assigned: 300, occupied: 10 }],
    })),
    listarZonas: vi.fn(),
  };
  const recepcion = {
    diasPorCapacidad: vi.fn(async () => [{ day: '2026-11-23T00:00:00Z', active: true, assigned: 50, occupied: 5 }]),
    capacidadesDeLaOficina: vi.fn(),
  };
  const s = new CapacidadAgenteService(picking as never, despacho as never, recepcion as never, {} as never);
  return { s, picking, despacho, recepcion };
}

describe('Capacidad por ids', () => {
  it('picking: los días de cada agenda con su scheduleId', async () => {
    const { s, picking } = armar();
    const r = await s.consultarPorIds(
      { tipo: 'picking', codigo: '20026', pais: 'PE', desde: '2026-11-23', dias: 12 } as never,
      '20026',
      [{ id: 'sch-1', nombre: 'Agenda Picking ST - 20026', servicio: 'ST', unidad: 'unidades' }],
    );
    expect(picking.obtener).toHaveBeenCalledWith('sch-1', '23-11-2026', 'PE');
    expect(picking.listarAgendasPorOficina).not.toHaveBeenCalled();
    expect(r.oficinas[0]).toMatchObject({
      oficina: '20026',
      agendas: [
        {
          agenda: 'Agenda Picking ST - 20026',
          servicio: 'ST',
          dias: [{ fecha: '2026-11-23', asignado: 100, ocupado: 40, disponible: 60 }],
          primerDiaDisponible: '2026-11-23',
        },
      ],
    });
  });

  it('despacho: con el mainScheduleId (los servicios y la unidad, de Ripley); avisos guardados', async () => {
    const { s, despacho } = armar();
    const r = await s.consultarPorIds(
      { tipo: 'despacho', codigo: '1401', pais: 'PE', desde: '2026-11-23' } as never,
      '1401',
      [{ id: 'ms-9', nombre: 'Agenda 1401', servicio: null, zona: 'Zona 1401' }],
      ['1401: aviso de cuando se resolvió'],
    );
    expect(despacho.buscarCapacidades).toHaveBeenCalledWith('ms-9', '23-11-2026', 'PE');
    expect(despacho.listarZonas).not.toHaveBeenCalled();
    expect(r.oficinas[0].agendas[0]).toMatchObject({ servicio: 'S, DT', unidad: 'pedidos', zona: 'Zona 1401' });
    expect(r.sinDatos).toEqual(['1401: aviso de cuando se resolvió']);
  });

  it('recepción: con el id de su capacidad; sin él, sin días', async () => {
    const { s, recepcion } = armar();
    const r = await s.consultarPorIds(
      { tipo: 'recepcion', codigo: '20021', pais: 'PE', desde: '2026-11-23' } as never,
      '20021',
      [
        { id: 'sch-r', capacidadId: 'cap-1', nombre: 'Agenda Recepción ST', servicio: 'ST' },
        { id: 'sch-r2', capacidadId: null, nombre: 'Agenda sin capacidad', servicio: 'SE' },
      ],
    );
    expect(recepcion.diasPorCapacidad).toHaveBeenCalledTimes(1);
    expect(recepcion.diasPorCapacidad).toHaveBeenCalledWith('cap-1', '23-11-2026', 'PE');
    expect(recepcion.capacidadesDeLaOficina).not.toHaveBeenCalled();
    expect(r.oficinas[0].agendas.map((a) => a.dias.length)).toEqual([1, 0]);
  });

  it('un id que Ripley ya no reconoce lanza (quien llama resuelve por nombre)', async () => {
    const { s, picking } = armar();
    picking.obtener.mockRejectedValueOnce(new Error('La API corporativa respondió 404'));
    await expect(
      s.consultarPorIds({ tipo: 'picking', codigo: '20026', pais: 'PE' } as never, '20026', [
        { id: 'viejo', nombre: 'A', servicio: 'ST' },
      ]),
    ).rejects.toThrow(/404/);
  });
});
