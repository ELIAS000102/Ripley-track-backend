import { describe, expect, it, vi } from 'vitest';
import type { DespachoService } from '../../../src/agendas/despacho/despacho.service.js';
import type { PickingService } from '../../../src/agendas/picking/picking.service.js';
import type { ContextoAgenteService } from '../../../src/agente/contexto.service.js';
import { EditarCapacidadAgenteService } from '../../../src/agente/edicion/capacidad/capacidad.service.js';
import { EditarTipoServicioAgenteService } from '../../../src/agente/edicion/tipo-servicio/tipo-servicio.service.js';
import type { GuardadoAtajo, IdsRipleyService } from '../../../src/agente/ids/ids-ripley.service.js';
import { ConsultasConIdsService } from '../../../src/agente/ids/consultas-con-ids.service.js';
import { conListados, Listados } from '../../../src/agente/ids/listados.js';
import type { OplService } from '../../../src/configuracion/tipo-servicio/opl/opl.service.js';
import type { ContextoPeticion } from '../../../src/nucleo/contexto/contexto-peticion.service.js';
import type { UsuarioAutenticado } from '../../../src/nucleo/contexto/usuario.interface.js';
import { hoyEnPais, sumarDias } from '../../../src/nucleo/fechas.js';
import { RipleyApiError } from '../../../src/ripley/ripley.errors.js';
import { almacenesDePrueba } from '../../fixtures/almacenes.js';

/**
 * Los cambios con los ids guardados: se guardan los LISTADOS de Ripley (las
 * agendas del almacén, las zonas y agendas del operador) y la elección se hace
 * igual que siempre sobre ellos. Antes de escribir se lee con esos ids; si algo
 * falla con lo guardado, no se escribió nada y se repite con lo de Ripley.
 */

const USUARIO = { id: 'u1', email: 'ana@ripley.com.pe' } as UsuarioAutenticado;
const HOY = hoyEnPais('PE');
const MANANA = sumarDias(HOY, 1);

/** La tabla atajo_ids, en memoria */
function tabla(inicial: Record<string, { ids: unknown; consultadoEn?: string }> = {}) {
  const filas = new Map<string, GuardadoAtajo>(
    Object.entries(inicial).map(([firma, f]) => [
      firma,
      { firma, ids: f.ids as never, consultadoEn: f.consultadoEn ?? new Date().toISOString() },
    ]),
  );
  const ids = {
    cargar: vi.fn(
      async (firmas: string[]) => new Map(firmas.filter((f) => filas.has(f)).map((f) => [f, filas.get(f)!])),
    ),
    guardar: vi.fn(async (nuevas: Array<{ firma: string; ids: unknown }>) => {
      for (const n of nuevas)
        filas.set(n.firma, { firma: n.firma, ids: n.ids as never, consultadoEn: new Date().toISOString() });
    }),
  };
  return { ids: ids as unknown as IdsRipleyService, cargar: ids.cargar, guardar: ids.guardar, filas };
}

const lista = (tipo: string, lista: unknown) => ({ ids: { tipo, lista } });

describe('conListados', () => {
  it('sin guardado: lista en Ripley y lo guarda con su firma', async () => {
    const t = tabla();
    const listar = vi.fn(async () => ['a']);
    const r = await conListados(t.ids, 'picking', 'pe', true, (l) => l.de('agendas|20026', listar));
    expect(r).toEqual(['a']);
    expect(listar).toHaveBeenCalledTimes(1);
    expect([...t.filas.keys()]).toEqual(['lista|picking|PE|agendas|20026']);
    expect(Listados.firma('picking', 'pe', 'agendas|20026')).toBe('lista|picking|PE|agendas|20026');
  });

  it('con guardado sin caducar: no llama a Ripley', async () => {
    const t = tabla({ 'lista|picking|PE|agendas|20026': lista('picking', ['guardada']) });
    const listar = vi.fn(async () => ['de Ripley']);
    const r = await conListados(t.ids, 'picking', 'PE', true, (l) => l.de('agendas|20026', listar));
    expect(r).toEqual(['guardada']);
    expect(listar).not.toHaveBeenCalled();
  });

  it('caducado (más de 7 días) o de otro tipo: se vuelve a listar', async () => {
    const viejo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const t = tabla({
      'lista|picking|PE|agendas|1': { ...lista('picking', ['vieja']), consultadoEn: viejo },
      'lista|picking|PE|agendas|2': lista('despacho', ['otra']),
    });
    const listar = vi.fn(async () => ['nueva']);
    await conListados(t.ids, 'picking', 'PE', true, async (l) => [
      await l.de('agendas|1', listar),
      await l.de('agendas|2', listar),
    ]);
    expect(listar).toHaveBeenCalledTimes(2);
  });

  it('si falla con lo guardado, se repite con lo de Ripley (una vez)', async () => {
    const t = tabla({ 'lista|picking|PE|agendas|20026': lista('picking', ['vieja']) });
    const leer = vi.fn(async (l: Listados) => {
      const a = await l.de('agendas|20026', async () => ['nueva']);
      if (a[0] === 'vieja') throw new RipleyApiError('no existe');
      return a;
    });
    expect(await conListados(t.ids, 'picking', 'PE', true, leer)).toEqual(['nueva']);
    expect(leer).toHaveBeenCalledTimes(2);
    // Y lo nuevo reemplaza a lo guardado
    expect((t.filas.get('lista|picking|PE|agendas|20026')!.ids as never as { lista: unknown }).lista).toEqual([
      'nueva',
    ]);
  });

  it('si falla sin haber usado nada guardado, el error es el de Ripley y no se repite', async () => {
    const t = tabla();
    const leer = vi.fn(async (l: Listados) => {
      await l.de('agendas|20026', async () => ['a']);
      throw new Error('Ripley respondió 500');
    });
    await expect(conListados(t.ids, 'picking', 'PE', true, leer)).rejects.toThrow(/500/);
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it('sin `guardados` (todas, atajo, cortar un CD): siempre a Ripley, y se guarda', async () => {
    const t = tabla({ 'lista|picking|PE|agendas|20026': lista('picking', ['vieja']) });
    const r = await conListados(t.ids, 'picking', 'PE', false, (l) => l.de('agendas|20026', async () => ['nueva']));
    expect(r).toEqual(['nueva']);
    expect(t.guardar).toHaveBeenCalled();
  });

  it('sin el service de ids: como antes', async () => {
    const r = await conListados(undefined, 'picking', 'PE', true, (l) => l.de('x', async () => 1));
    expect(r).toBe(1);
  });
});

// ---------- Capacidad ----------

const AGENDAS = [
  { scheduleId: 'c-s', nombre: 'Agenda Picking S - 20026', typeOfService: 'S', vigenteHasta: '2030-12-31' },
  { scheduleId: 'c-st', nombre: 'Agenda Picking ST - 20026', typeOfService: 'ST', vigenteHasta: '2030-12-31' },
];

function capacidad(t: ReturnType<typeof tabla>) {
  const picking = {
    listarAgendasPorOficina: vi.fn(async () => AGENDAS),
    obtener: vi.fn(async (id: string) => {
      if (id === 'c-borrada') throw new RipleyApiError('La agenda no existe');
      return { capacityByDayArray: [{ day: `${MANANA}T00:00:00.000Z`, active: true, assigned: 100, occupied: 10 }] };
    }),
    actualizar: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  };
  const despacho = {
    listarZonas: vi.fn(async () => [{ zoneId: 'z-1', nombre: 'Lima Centro' }]),
    listarAgendas: vi.fn(async () => [{ mainScheduleId: 'ms-1', nombre: 'Agenda DT' }]),
    buscarCapacidades: vi.fn(async () => ({
      agenda: {},
      dias: [
        {
          date: `${MANANA.slice(8, 10)}-${MANANA.slice(5, 7)}-${MANANA.slice(0, 4)}`,
          assigned: 500,
          occupied: 1,
          active: true,
        },
      ],
    })),
    actualizar: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  };
  const servicio = new EditarCapacidadAgenteService(
    picking as unknown as PickingService,
    despacho as unknown as DespachoService,
    {} as never,
    { armar: vi.fn(async () => ({ pais: 'PE', hoy: HOY })) } as unknown as ContextoAgenteService,
    { registrarCambio: vi.fn() } as unknown as ContextoPeticion,
    undefined as never,
    { leer: vi.fn() } as never,
    almacenesDePrueba(),
    t.ids,
  );
  return { servicio, picking, despacho };
}

const pedir = (extra: Record<string, unknown>) =>
  ({ tipo: 'picking', codigo: '20026', fecha: MANANA, asignado: 150, ...extra }) as never;

describe('Cambios de capacidad con los ids guardados', () => {
  it('picking: la primera vez lista en Ripley y guarda; la segunda, ya no lista', async () => {
    const t = tabla();
    const { servicio, picking } = capacidad(t);

    await servicio.editarCapacidad(USUARIO, pedir({ servicio: 'ST' }));
    await servicio.editarCapacidad(USUARIO, pedir({ servicio: 'S' }));

    expect(picking.listarAgendasPorOficina).toHaveBeenCalledTimes(1);
    expect(picking.actualizar.mock.calls.map((c) => c[0])).toEqual(['c-st', 'c-s']);
    // Siempre se lee con el id antes de escribir
    expect(picking.obtener).toHaveBeenCalledTimes(2);
  });

  it('picking: un id guardado que Ripley ya no reconoce → se lista otra vez, y se escribe una sola vez', async () => {
    const t = tabla({
      'lista|picking|PE|agendas|20026': lista('picking', [
        { scheduleId: 'c-borrada', nombre: 'Agenda Picking ST - 20026', typeOfService: 'ST', vigenteHasta: null },
      ]),
    });
    const { servicio, picking } = capacidad(t);

    await servicio.editarCapacidad(USUARIO, pedir({ servicio: 'ST' }));

    expect(picking.listarAgendasPorOficina).toHaveBeenCalledTimes(1);
    expect(picking.actualizar).toHaveBeenCalledTimes(1);
    expect(picking.actualizar.mock.calls[0][0]).toBe('c-st');
  });

  it('picking: lo guardado ya no encaja con lo pedido (no está la jornada) → se pregunta a Ripley', async () => {
    const t = tabla({ 'lista|picking|PE|agendas|20026': lista('picking', [AGENDAS[0]]) });
    const { servicio, picking } = capacidad(t);

    await servicio.editarCapacidad(USUARIO, pedir({ servicio: 'ST' }));

    expect(picking.listarAgendasPorOficina).toHaveBeenCalledTimes(1);
    expect(picking.actualizar.mock.calls[0][0]).toBe('c-st');
  });

  it('picking: "todas" las agendas no usa lo guardado (una nueva no estaría)', async () => {
    const t = tabla({ 'lista|picking|PE|agendas|20026': lista('picking', [AGENDAS[0]]) });
    const { servicio, picking } = capacidad(t);

    await servicio.editarCapacidad(USUARIO, pedir({ agenda: 'todas' }));

    expect(picking.listarAgendasPorOficina).toHaveBeenCalledTimes(1);
    expect(picking.actualizar).toHaveBeenCalledTimes(2);
  });

  it('despacho: las zonas y las agendas de la zona, de lo guardado', async () => {
    const t = tabla();
    const { servicio, despacho } = capacidad(t);
    const dto = pedir({ tipo: 'despacho', codigo: '1130', zona: 'centro', agenda: 'DT', asignado: 600 });

    await servicio.editarCapacidad(USUARIO, dto);
    await servicio.editarCapacidad(USUARIO, dto);

    expect(despacho.listarZonas).toHaveBeenCalledTimes(1);
    expect(despacho.listarAgendas).toHaveBeenCalledTimes(1);
    expect(despacho.buscarCapacidades).toHaveBeenCalledTimes(2);
    expect(despacho.actualizar.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      ['1130', 'z-1', 'ms-1'],
      ['1130', 'z-1', 'ms-1'],
    ]);
  });
});

// ---------- Servicios de OPL ----------

describe('Cambios de servicios de OPL con los ids guardados', () => {
  function opl(t: ReturnType<typeof tabla>) {
    const o = {
      buscarOpl: vi.fn(async () => ({ opls: [{ id: 'o-1', code: '1130', nombre: 'Olva' }] })),
      listarZonas: vi.fn(async () => [{ mainZone: 'z-1', nombre: 'Lima Centro' }]),
      listarAgendas: vi.fn(async () => [{ mainSchedule: 'a-1', nombre: 'Agenda DT' }]),
      listarServicios: vi.fn(async (c: { mainSchedule: string }) => {
        if (c.mainSchedule === 'a-vieja') throw new Error('La API corporativa respondió 404');
        return {
          servicios: [{ idServicio: 's-sd', code: 'SD', isActive: true, enabledForCheckout: true, cortes: [] }],
        };
      }),
      actualizarServicio: vi.fn(async () => ({ ok: true })),
    };
    const servicio = new EditarTipoServicioAgenteService(
      o as unknown as OplService,
      { armar: vi.fn(async () => ({ pais: 'PE' })) } as unknown as ContextoAgenteService,
      { registrarCambio: vi.fn(), enSimulacro: () => false } as unknown as ContextoPeticion,
      { leer: vi.fn() } as never,
      t.ids,
    );
    return { servicio, o };
  }

  it('la segunda vez no busca el operador, sus zonas ni sus agendas', async () => {
    const t = tabla();
    const { servicio, o } = opl(t);

    await servicio.editar(USUARIO, { opl: '1130', servicio: 'SD', activo: false } as never);
    await servicio.editar(USUARIO, { opl: '1130', servicio: 'SD', activo: false } as never);

    expect(o.buscarOpl).toHaveBeenCalledTimes(1);
    expect(o.listarZonas).toHaveBeenCalledTimes(1);
    expect(o.listarAgendas).toHaveBeenCalledTimes(1);
    expect(o.actualizarServicio).toHaveBeenCalledTimes(2);
  });

  it('una agenda guardada que Ripley ya no reconoce → se vuelve a listar y se escribe en la buena', async () => {
    const t = tabla({
      'lista|opl|PE|agendas|z-1': lista('opl', [{ mainSchedule: 'a-vieja', nombre: 'Agenda DT' }]),
    });
    const { servicio, o } = opl(t);

    await servicio.editar(USUARIO, { opl: '1130', servicio: 'SD', activo: false } as never);

    expect(o.listarAgendas).toHaveBeenCalledTimes(1);
    expect(o.actualizarServicio).toHaveBeenCalledTimes(1);
    expect(o.actualizarServicio).toHaveBeenCalledWith('s-sd', expect.objectContaining({ mainSchedule: 'a-1' }));
  });
});

// ---------- Consultas de Silvana ----------

describe('Consultas directas con los ids guardados (Silvana)', () => {
  function consultas(t: ReturnType<typeof tabla>, respuesta: Record<string, unknown>) {
    const capacidad = {
      consultar: vi.fn(async () => respuesta),
      consultarPorIds: vi.fn(async () => ({ tipo: 'picking', oficinas: [], sinDatos: [] })),
    };
    const s = new ConsultasConIdsService(capacidad as never, {} as never, {} as never, {} as never, t.ids);
    return { s, capacidad };
  }
  const OFICINA = {
    oficina: '20026',
    agendas: [{ agenda: 'A', servicio: 'ST', dias: [], ids: { agendaId: 'sch-1' } }],
  };

  it('una consulta sola abre y cierra su tanda: la segunda lee con los ids', async () => {
    const t = tabla();
    const { s, capacidad } = consultas(t, { tipo: 'picking', oficinas: [OFICINA], sinDatos: [] });
    const dto = { tipo: 'picking', codigo: '20026', servicio: 'ST', pais: 'PE' };

    const r = (await s.consultar(USUARIO, 'picking', dto)) as { oficinas: Array<{ agendas: object[] }> };
    expect(r.oficinas[0].agendas[0]).not.toHaveProperty('ids');
    expect([...t.filas.keys()]).toEqual(['picking|PE|20026|st|']);

    await s.consultar(USUARIO, 'picking', dto);
    expect(capacidad.consultar).toHaveBeenCalledTimes(1);
    expect(capacidad.consultarPorIds).toHaveBeenCalledTimes(1);
  });

  it('una oficina a la que se le cayó una agenda al leerla no se guarda', async () => {
    const t = tabla();
    const { s } = consultas(t, { tipo: 'picking', oficinas: [{ ...OFICINA, incompleta: true }], sinDatos: ['x'] });

    const r = (await s.consultar(USUARIO, 'picking', { tipo: 'picking', codigo: '20026' })) as {
      oficinas: object[];
    };
    expect(t.filas.size).toBe(0);
    expect(r.oficinas[0]).not.toHaveProperty('incompleta');
  });

  it('sin firma (sin código): como siempre, sin guardar', async () => {
    const t = tabla();
    const { s, capacidad } = consultas(t, { tipo: 'picking', oficinas: [OFICINA], sinDatos: [] });
    await s.consultar(USUARIO, 'picking', { tipo: 'picking', codigo: '' });
    expect(capacidad.consultar).toHaveBeenCalledWith({ tipo: 'picking', codigo: '' });
    expect(t.guardar).not.toHaveBeenCalled();
  });
});
