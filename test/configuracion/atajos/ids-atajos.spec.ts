import { describe, expect, it, vi } from 'vitest';
import type { UsuarioAutenticado } from '../../../src/nucleo/contexto/usuario.interface.js';
import type { BusquedaMasivaAgenteService } from '../../../src/agente/consultas/busqueda-masiva/busqueda-masiva.service.js';
import type { CapacidadAgenteService } from '../../../src/agente/consultas/capacidad/capacidad.service.js';
import type { SimulacionAgenteService } from '../../../src/agente/consultas/simulacion/simulacion.service.js';
import type { TipoServicioAgenteService } from '../../../src/agente/consultas/tipo-servicio/tipo-servicio.service.js';
import type { TransferenciaAgenteService } from '../../../src/agente/consultas/transferencia/transferencia.service.js';
import { EjecutorAtajoService } from '../../../src/configuracion/atajos/ejecutor.service.js';
import {
  firmaAtajo,
  vencido,
  VIGENCIA_IDS_DIAS,
  type AtajoIdsService,
  type GuardadoAtajo,
} from '../../../src/configuracion/atajos/ids-atajos.service.js';
import type { Atajo } from '../../../src/configuracion/atajos/interfaces/atajos.interface.js';
import { RipleyApiError } from '../../../src/ripley/ripley.errors.js';

/**
 * Los atajos guardan los ids de Ripley de sus ítems tras la primera consulta y
 * los usan las siguientes (decisión del usuario, 2026-11-23): en capacidad, se
 * leen los días de cada agenda sin buscar la oficina, sus zonas ni sus agendas;
 * en los servicios de un OPL, una llamada en vez de cuatro.
 */

const USUARIO = { id: 'u1', email: 'jose@ripley.com.pe' } as UsuarioAutenticado;

const atajo = (tipo: string, items: Array<Record<string, unknown>>): Atajo =>
  ({
    id: 'a1',
    nombre: 'BT LIMA',
    bloques: [
      {
        id: 'b1',
        orden: 1,
        tipo,
        accion: 'consultar',
        nota: null,
        items: items.map((c, i) => ({ id: i + 1, orden: i + 1, nota: null, ...c })),
      },
    ],
  }) as Atajo;

const AGENDA = {
  agenda: 'Agenda 1401 - Suc. Aldea 6',
  servicio: 'S',
  zona: 'Zona 1401 - Suc. Aldea 6',
  unidad: 'pedidos',
  dias: [{ fecha: '2026-11-23', activo: true, asignado: 300, ocupado: 100, disponible: 200, uso: 33 }],
  ids: { agendaId: 'sch-1', zonaId: 'zona-1' },
};
const RESPUESTA = {
  tipo: 'despacho',
  pais: 'PE',
  oficinas: [{ oficina: '1401', agendas: [AGENDA] }],
  desde: '2026-11-23',
  sinDatos: [],
};

function armar(guardados: GuardadoAtajo[] = []) {
  const capacidad = {
    consultar: vi.fn(async () => structuredClone(RESPUESTA)),
    consultarPorIds: vi.fn(async () => ({ ...structuredClone(RESPUESTA), leidoPorIds: true })),
  };
  const tipoServicio = {
    consultar: vi.fn(async () => ({
      contexto: {},
      opls: [
        {
          opl: '4007 - DD_AT Lima',
          zona: 'Zona SD PQT LIMA',
          agenda: 'Agenda 4007',
          servicios: [],
          ids: { courier: 'c-1', mainZone: 'mz-1', mainSchedule: 'ms-1', avisos: [] },
        },
      ],
      sinDatos: [],
    })),
    consultarPorIds: vi.fn(async () => ({ contexto: {}, opls: [], sinDatos: [], leidoPorIds: true })),
  };
  const ids = {
    cargar: vi.fn(async () => new Map(guardados.map((g) => [g.firma, g]))),
    guardar: vi.fn(async () => undefined),
  };
  const servicio = new EjecutorAtajoService(
    capacidad as unknown as CapacidadAgenteService,
    tipoServicio as unknown as TipoServicioAgenteService,
    {} as unknown as BusquedaMasivaAgenteService,
    {} as unknown as TransferenciaAgenteService,
    {} as unknown as SimulacionAgenteService,
    ids as unknown as AtajoIdsService,
  );
  return { servicio, capacidad, tipoServicio, ids };
}

const FIRMA = 'despacho|PE|1401|zona 1401 - suc. aldea 6|';
const guardado = (consultadoEn = new Date().toISOString()): GuardadoAtajo => ({
  firma: FIRMA,
  consultadoEn,
  ids: {
    tipo: 'despacho',
    oficina: '1401',
    agendas: [
      { id: 'sch-1', nombre: AGENDA.agenda, servicio: 'S', zona: AGENDA.zona, zonaId: 'zona-1', unidad: 'pedidos' },
    ],
    avisos: [],
  },
});
const ITEM = { pais: 'PE', codigo: '1401', zona: 'Zona 1401 - Suc. Aldea 6' };

describe('La firma de un ítem', () => {
  it('tipo, país y los campos con que se buscan sus ids; sin mayúsculas ni tildes', () => {
    expect(firmaAtajo('despacho', ITEM)).toBe(FIRMA);
    expect(firmaAtajo('picking', { codigo: '20026', servicio: 'ST' })).toBe('picking|PE|20026|st|');
    expect(firmaAtajo('opl', { opl: '4007', zona: 'Zona SD PQT LIMA' })).toBe('opl|PE|4007|zona sd pqt lima|');
  });

  it('varias oficinas en un ítem, o un tipo sin ids (masivo, simulación): sin firma', () => {
    expect(firmaAtajo('despacho', { codigo: '1401, 1402' })).toBeNull();
    expect(firmaAtajo('masivo', { servicio: 'SE' })).toBeNull();
    expect(firmaAtajo('simulacion', { operador: '1111' })).toBeNull();
  });

  it('caduca a los días de vigencia', () => {
    expect(vencido(guardado())).toBe(false);
    expect(vencido(guardado(new Date(Date.now() - (VIGENCIA_IDS_DIAS + 1) * 86_400_000).toISOString()))).toBe(true);
  });
});

describe('Capacidad: primero consulta, después guarda los ids y los usa', () => {
  it('sin ids guardados: por nombre (pidiendo los ids), los guarda y no los enseña', async () => {
    const { servicio, capacidad, ids } = armar();
    const r = await servicio.ejecutar(USUARIO, atajo('despacho', [ITEM]));
    expect(capacidad.consultar).toHaveBeenCalledWith(expect.objectContaining({ codigo: '1401', tipo: 'despacho' }), {
      conIds: true,
    });
    expect(capacidad.consultarPorIds).not.toHaveBeenCalled();
    expect(ids.guardar).toHaveBeenCalledWith([
      {
        firma: FIRMA,
        ids: {
          tipo: 'despacho',
          oficina: '1401',
          agendas: [
            {
              id: 'sch-1',
              zonaId: 'zona-1',
              nombre: AGENDA.agenda,
              servicio: 'S',
              zona: AGENDA.zona,
              unidad: 'pedidos',
            },
          ],
          avisos: [],
        },
      },
    ]);
    const leida = (r.bloques[0].items[0].resultado as typeof RESPUESTA).oficinas[0].agendas[0];
    expect(leida).not.toHaveProperty('ids');
  });

  it('con ids guardados: se lee con ellos, sin resolver la oficina, y no se guarda nada', async () => {
    const { servicio, capacidad, ids } = armar([guardado()]);
    const r = await servicio.ejecutar(USUARIO, atajo('despacho', [ITEM]));
    expect(capacidad.consultar).not.toHaveBeenCalled();
    expect(capacidad.consultarPorIds).toHaveBeenCalledWith(
      expect.objectContaining({ codigo: '1401' }),
      '1401',
      guardado().ids.tipo === 'despacho' ? (guardado().ids as { agendas: unknown[] }).agendas : [],
      [],
    );
    expect(r.bloques[0].items[0].resultado).toMatchObject({ leidoPorIds: true });
    expect(ids.guardar).toHaveBeenCalledWith([]);
  });

  it('Ripley ya no reconoce el id: se resuelve por nombre y se guardan los nuevos', async () => {
    const { servicio, capacidad, ids } = armar([guardado()]);
    capacidad.consultarPorIds.mockRejectedValueOnce(new RipleyApiError('Recurso no encontrado'));
    const r = await servicio.ejecutar(USUARIO, atajo('despacho', [ITEM]));
    expect(capacidad.consultar).toHaveBeenCalledTimes(1);
    expect(ids.guardar).toHaveBeenCalledWith([expect.objectContaining({ firma: FIRMA })]);
    expect(r.bloques[0].items[0].error).toBeUndefined();
  });

  it('otro fallo (no de ids) no se tapa reconsultando: el ítem lleva su error', async () => {
    const { servicio, capacidad } = armar([guardado()]);
    capacidad.consultarPorIds.mockRejectedValueOnce(
      new Error('La API corporativa respondió 429: demasiadas peticiones'),
    );
    const r = await servicio.ejecutar(USUARIO, atajo('despacho', [ITEM]));
    expect(capacidad.consultar).not.toHaveBeenCalled();
    expect(r.bloques[0].items[0].error).toMatch(/429/);
  });

  it('ids caducados: se resuelve por nombre (por si hay agendas nuevas) y se renuevan', async () => {
    const viejo = guardado(new Date(Date.now() - (VIGENCIA_IDS_DIAS + 1) * 86_400_000).toISOString());
    const { servicio, capacidad, ids } = armar([viejo]);
    await servicio.ejecutar(USUARIO, atajo('despacho', [ITEM]));
    expect(capacidad.consultarPorIds).not.toHaveBeenCalled();
    expect(capacidad.consultar).toHaveBeenCalledTimes(1);
    expect(ids.guardar).toHaveBeenCalledWith([expect.objectContaining({ firma: FIRMA })]);
  });

  it('un ítem con varias oficinas va por nombre, como siempre, y no guarda nada', async () => {
    const { servicio, capacidad, ids } = armar();
    await servicio.ejecutar(USUARIO, atajo('despacho', [{ pais: 'PE', codigo: '1401,1402' }]));
    expect(capacidad.consultar).toHaveBeenCalledWith(expect.objectContaining({ codigo: '1401,1402' }));
    expect(ids.guardar).toHaveBeenCalledWith([]);
  });
});

describe('Servicios de OPL: una llamada en vez de cuatro', () => {
  const OPL = { pais: 'PE', opl: '4007', zona: 'Zona SD PQT LIMA' };
  const FIRMA_OPL = 'opl|PE|4007|zona sd pqt lima|';

  it('la primera vez: por nombre, y se guardan el courier, la zona y la agenda', async () => {
    const { servicio, tipoServicio, ids } = armar();
    const r = await servicio.ejecutar(USUARIO, atajo('opl', [OPL]));
    expect(tipoServicio.consultar).toHaveBeenCalledWith(USUARIO, expect.objectContaining({ opl: '4007' }), {
      conIds: true,
    });
    expect(ids.guardar).toHaveBeenCalledWith([
      {
        firma: FIRMA_OPL,
        ids: {
          tipo: 'opl',
          opl: '4007 - DD_AT Lima',
          zona: 'Zona SD PQT LIMA',
          agenda: 'Agenda 4007',
          ids: { courier: 'c-1', mainZone: 'mz-1', mainSchedule: 'ms-1', avisos: [] },
        },
      },
    ]);
    expect((r.bloques[0].items[0].resultado as { opls: unknown[] }).opls[0]).not.toHaveProperty('ids');
  });

  it('las siguientes: con los ids guardados', async () => {
    const g: GuardadoAtajo = {
      firma: FIRMA_OPL,
      consultadoEn: new Date().toISOString(),
      ids: {
        tipo: 'opl',
        opl: '4007 - DD_AT Lima',
        zona: 'Zona SD PQT LIMA',
        agenda: 'Agenda 4007',
        ids: { courier: 'c-1', mainZone: 'mz-1', mainSchedule: 'ms-1', avisos: [] },
      },
    };
    const { servicio, tipoServicio } = armar([g]);
    await servicio.ejecutar(USUARIO, atajo('opl', [OPL]));
    expect(tipoServicio.consultar).not.toHaveBeenCalled();
    expect(tipoServicio.consultarPorIds).toHaveBeenCalledWith(USUARIO, expect.objectContaining({ opl: '4007' }), g.ids);
  });
});
