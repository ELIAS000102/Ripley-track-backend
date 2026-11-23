import { describe, expect, it, vi } from 'vitest';
import type { UsuarioAutenticado } from '../../../src/nucleo/contexto/usuario.interface.js';
import type { BusquedaMasivaAgenteService } from '../../../src/agente/consultas/busqueda-masiva/busqueda-masiva.service.js';
import type { CapacidadAgenteService } from '../../../src/agente/consultas/capacidad/capacidad.service.js';
import type { SimulacionAgenteService } from '../../../src/agente/consultas/simulacion/simulacion.service.js';
import type { TipoServicioAgenteService } from '../../../src/agente/consultas/tipo-servicio/tipo-servicio.service.js';
import type { TransferenciaAgenteService } from '../../../src/agente/consultas/transferencia/transferencia.service.js';
import { EjecutorAtajoService } from '../../../src/configuracion/atajos/ejecutor.service.js';
import {
  deLaForma,
  firmaAtajo,
  vencido,
  VIGENCIA_IDS_DIAS,
  type IdsRipleyService,
  type GuardadoAtajo,
} from '../../../src/agente/ids/ids-ripley.service.js';
import type { Atajo } from '../../../src/configuracion/atajos/interfaces/atajos.interface.js';
import { RipleyApiError } from '../../../src/ripley/ripley.errors.js';

/**
 * Los atajos guardan los ids de Ripley de sus ítems tras la primera consulta y
 * los usan las siguientes (decisión del usuario, 2026-11-23): capacidad
 * (picking, despacho, recepción), servicios de OPL, búsqueda masiva y
 * simulación, también con varias oficinas, operadores o servicios en un ítem.
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

const agenda = (n: string) => ({
  agenda: `Agenda ${n}`,
  servicio: 'S',
  zona: `Zona ${n}`,
  unidad: 'pedidos',
  dias: [{ fecha: '2026-11-23', activo: true, asignado: 300, ocupado: 100, disponible: 200, uso: 33 }],
  ids: { agendaId: `sch-${n}`, zonaId: `zona-${n}` },
});
const RESPUESTA = (oficinas = ['1401']) => ({
  tipo: 'despacho',
  pais: 'PE',
  oficinas: oficinas.map((o) => ({ oficina: o, agendas: [agenda(o)] })),
  desde: '2026-11-23',
  sinDatos: [],
});
const MASIVA = { contexto: {}, metodo: 'RT', servicio: 'SE', origenes: ['20026'], resumen: {}, agendas: [] };
const SIMULACION = { contexto: {}, parametros: {}, resultados: [{ opl: '1111 - X', entrega: '2026-11-25' }] };
const RESUELTA = {
  almacen: { id: 'w-1', code: '20026', nombre: 'Ripley Fulfillment' },
  almacenPorDefecto: true,
  producto: { sku: 2000351484005, nombre: 'Polo' },
  destinos: [
    {
      code: '1111',
      distrito: 'San Borja',
      operador: { id: 'c-1111', nombre: 'Bellavista' },
      regionId: 'r-15',
      communeId: 'k-1',
    },
  ],
};

function armar(guardados: GuardadoAtajo[] = []) {
  const capacidad = {
    consultar: vi.fn(async (dto: { codigo: string }) => structuredClone(RESPUESTA(dto.codigo.split(',')))),
    consultarPorIds: vi.fn(async () => ({ ...structuredClone(RESPUESTA()), leidoPorIds: true })),
  };
  const tipoServicio = {
    consultar: vi.fn(async (_u: unknown, dto: { opl: string }) => ({
      contexto: {},
      opls: dto.opl.split(',').map((o) => ({
        opl: `${o} - DD_AT`,
        zona: `Zona ${o}`,
        agenda: `Agenda ${o}`,
        servicios: [],
        ids: { courier: `c-${o}`, mainZone: `mz-${o}`, mainSchedule: `ms-${o}`, avisos: [] },
      })),
      sinDatos: [],
    })),
    consultarPorIds: vi.fn(async () => ({ contexto: {}, opls: [], sinDatos: [], leidoPorIds: true })),
  };
  const masivo = {
    buscar: vi.fn(
      async (_u: unknown, _dto: unknown, o: { resueltos?: unknown; alResolver?: (k: string, v: unknown) => void }) => {
        if (!o?.resueltos) o?.alResolver?.('se', { metodo: 'RT', servicio: 'SE', origenes: ['20026'] });
        return { ...structuredClone(MASIVA), ...(o?.resueltos ? { leidoPorIds: true } : {}) };
      },
    ),
  };
  const simulacion = {
    simular: vi.fn(async (_u: unknown, _dto: unknown, o: { resuelta?: unknown; alResolver?: (r: unknown) => void }) => {
      if (!o?.resuelta) o?.alResolver?.(structuredClone(RESUELTA));
      return { ...structuredClone(SIMULACION), ...(o?.resuelta ? { leidoPorIds: true } : {}) };
    }),
  };
  const ids = {
    cargar: vi.fn(async () => new Map(guardados.map((g) => [g.firma, g]))),
    guardar: vi.fn(async () => undefined),
  };
  const servicio = new EjecutorAtajoService(
    capacidad as unknown as CapacidadAgenteService,
    tipoServicio as unknown as TipoServicioAgenteService,
    masivo as unknown as BusquedaMasivaAgenteService,
    {} as unknown as TransferenciaAgenteService,
    simulacion as unknown as SimulacionAgenteService,
    ids as unknown as IdsRipleyService,
  );
  return { servicio, capacidad, tipoServicio, masivo, simulacion, ids };
}

const FIRMA = 'despacho|PE|1401|zona 1401|';
const OFICINAS = [
  {
    oficina: '1401',
    agendas: [
      {
        id: 'sch-1401',
        zonaId: 'zona-1401',
        nombre: 'Agenda 1401',
        servicio: 'S',
        zona: 'Zona 1401',
        unidad: 'pedidos',
      },
    ],
  },
];
const guardado = (consultadoEn = new Date().toISOString()): GuardadoAtajo => ({
  firma: FIRMA,
  consultadoEn,
  ids: { tipo: 'despacho', oficinas: OFICINAS, avisos: [] },
});
const ITEM = { pais: 'PE', codigo: '1401', zona: 'Zona 1401' };
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

describe('La firma de un ítem', () => {
  it('tipo, país y los campos con que se buscan sus ids; sin mayúsculas ni tildes', () => {
    expect(firmaAtajo('despacho', ITEM)).toBe(FIRMA);
    expect(firmaAtajo('picking', { codigo: '20026', servicio: 'ST' })).toBe('picking|PE|20026|st|');
    expect(firmaAtajo('opl', { opl: '4007', zona: 'Zona SD PQT LIMA' })).toBe('opl|PE|4007|zona sd pqt lima|');
    expect(firmaAtajo('masivo', { servicio: 'SE' })).toBe('masivo|PE|se||');
    expect(firmaAtajo('simulacion', { operador: '1111', distrito: 'San Borja' })).toBe(
      'simulacion|PE|1111|||san borja||',
    );
  });

  it('varias oficinas también tienen firma; la transferencia y un ítem sin a quién, no', () => {
    expect(firmaAtajo('despacho', { codigo: '1401, 1402' })).toBe('despacho|PE|1401, 1402||');
    expect(firmaAtajo('transferencia', { origen: '20026' })).toBeNull();
    expect(firmaAtajo('despacho', { zona: 'Zona 1401' })).toBeNull();
  });

  it('caduca a los días de vigencia; un guardado con la forma de antes no vale', () => {
    expect(vencido(guardado())).toBe(false);
    expect(vencido(guardado(hace(VIGENCIA_IDS_DIAS + 1)))).toBe(true);
    const viejo = { firma: FIRMA, consultadoEn: hace(0), ids: { tipo: 'despacho', oficina: '1401', agendas: [] } };
    expect(deLaForma(viejo as unknown as GuardadoAtajo, 'despacho')).toBe(false);
    expect(deLaForma(guardado(), 'despacho')).toBe(true);
    expect(deLaForma(guardado(), 'picking')).toBe(false);
  });
});

describe('Capacidad: primero consulta, después guarda los ids y los usa', () => {
  it('sin ids guardados: por nombre (pidiendo los ids), los guarda y no los enseña', async () => {
    const { servicio, capacidad, ids } = armar();
    const r = await servicio.ejecutar(USUARIO, atajo('despacho', [ITEM]));
    expect(capacidad.consultar).toHaveBeenCalledWith(expect.objectContaining({ codigo: '1401', tipo: 'despacho' }), {
      conIds: true,
    });
    expect(ids.guardar).toHaveBeenCalledWith([
      { firma: FIRMA, ids: { tipo: 'despacho', oficinas: OFICINAS, avisos: [] } },
    ]);
    const leida = (r.bloques[0].items[0].resultado as ReturnType<typeof RESPUESTA>).oficinas[0].agendas[0];
    expect(leida).not.toHaveProperty('ids');
  });

  it('con ids guardados: se lee con ellos, sin resolver la oficina, y no se guarda nada', async () => {
    const { servicio, capacidad, ids } = armar([guardado()]);
    const r = await servicio.ejecutar(USUARIO, atajo('despacho', [ITEM]));
    expect(capacidad.consultar).not.toHaveBeenCalled();
    expect(capacidad.consultarPorIds).toHaveBeenCalledWith(expect.objectContaining({ codigo: '1401' }), OFICINAS, []);
    expect(r.bloques[0].items[0].resultado).toMatchObject({ leidoPorIds: true });
    expect(ids.guardar).toHaveBeenCalledWith([]);
  });

  it('varias oficinas en un ítem: se guardan las de todas', async () => {
    const { servicio, ids } = armar();
    await servicio.ejecutar(USUARIO, atajo('despacho', [{ pais: 'PE', codigo: '1401,1402' }]));
    const guardadas = (
      ids.guardar.mock.calls[0] as unknown as [Array<{ ids: { oficinas: Array<{ oficina: string }> } }>]
    )[0];
    expect(guardadas[0].ids.oficinas.map((o) => o.oficina)).toEqual(['1401', '1402']);
  });

  it('una oficina que falla: no se guarda nada (quedaría fuera)', async () => {
    const { servicio, capacidad, ids } = armar();
    capacidad.consultar.mockResolvedValueOnce({
      ...RESPUESTA(['1401']),
      oficinas: [
        { oficina: '1401', agendas: [agenda('1401')] },
        { oficina: '1402', agendas: [], error: 'No existe' },
      ],
    } as never);
    await servicio.ejecutar(USUARIO, atajo('despacho', [{ pais: 'PE', codigo: '1401,1402' }]));
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
    const { servicio, capacidad, ids } = armar([guardado(hace(VIGENCIA_IDS_DIAS + 1))]);
    await servicio.ejecutar(USUARIO, atajo('despacho', [ITEM]));
    expect(capacidad.consultarPorIds).not.toHaveBeenCalled();
    expect(capacidad.consultar).toHaveBeenCalledTimes(1);
    expect(ids.guardar).toHaveBeenCalledWith([expect.objectContaining({ firma: FIRMA })]);
  });
});

describe('Servicios de OPL: una llamada en vez de cuatro', () => {
  const OPL = { pais: 'PE', opl: '4007', zona: 'Zona SD PQT LIMA' };
  const FIRMA_OPL = 'opl|PE|4007|zona sd pqt lima|';
  const OPLS = [
    {
      opl: '4007 - DD_AT',
      zona: 'Zona 4007',
      agenda: 'Agenda 4007',
      ids: { courier: 'c-4007', mainZone: 'mz-4007', mainSchedule: 'ms-4007', avisos: [] },
    },
  ];

  it('la primera vez: por nombre, y se guardan el courier, la zona y la agenda', async () => {
    const { servicio, tipoServicio, ids } = armar();
    const r = await servicio.ejecutar(USUARIO, atajo('opl', [OPL]));
    expect(tipoServicio.consultar).toHaveBeenCalledWith(USUARIO, expect.objectContaining({ opl: '4007' }), {
      conIds: true,
    });
    expect(ids.guardar).toHaveBeenCalledWith([{ firma: FIRMA_OPL, ids: { tipo: 'opl', opls: OPLS } }]);
    expect((r.bloques[0].items[0].resultado as { opls: unknown[] }).opls[0]).not.toHaveProperty('ids');
  });

  it('las siguientes: con los ids guardados (también con varios operadores)', async () => {
    const g: GuardadoAtajo = { firma: FIRMA_OPL, consultadoEn: hace(0), ids: { tipo: 'opl', opls: OPLS } };
    const { servicio, tipoServicio } = armar([g]);
    await servicio.ejecutar(USUARIO, atajo('opl', [OPL]));
    expect(tipoServicio.consultar).not.toHaveBeenCalled();
    expect(tipoServicio.consultarPorIds).toHaveBeenCalledWith(USUARIO, expect.objectContaining({ opl: '4007' }), OPLS);
  });
});

describe('Búsqueda masiva: sin los dos catálogos', () => {
  const FIRMA_M = 'masivo|PE|se||';
  it('la primera vez se guarda lo resuelto (método, servicio, orígenes); la siguiente se usa', async () => {
    const a = armar();
    await a.servicio.ejecutar(USUARIO, atajo('masivo', [{ pais: 'PE', servicio: 'SE' }]));
    expect(a.ids.guardar).toHaveBeenCalledWith([
      {
        firma: FIRMA_M,
        ids: { tipo: 'masivo', resueltos: { se: { metodo: 'RT', servicio: 'SE', origenes: ['20026'] } } },
      },
    ]);

    const g = (a.ids.guardar.mock.calls[0] as unknown as [Array<{ firma: string; ids: GuardadoAtajo['ids'] }>])[0][0];
    const b = armar([{ ...g, consultadoEn: hace(0) }]);
    const r = await b.servicio.ejecutar(USUARIO, atajo('masivo', [{ pais: 'PE', servicio: 'SE' }]));
    expect(b.masivo.buscar).toHaveBeenCalledWith(USUARIO, expect.anything(), {
      resueltos: g.ids.tipo === 'masivo' ? g.ids.resueltos : {},
    });
    expect(r.bloques[0].items[0].resultado).toMatchObject({ leidoPorIds: true });
  });

  it('con varios servicios, si uno no existe no se guarda nada', async () => {
    const { servicio, masivo, ids } = armar();
    masivo.buscar.mockResolvedValueOnce({ contexto: {}, busquedas: [{ servicio: 'XX', error: 'No existe' }] } as never);
    await servicio.ejecutar(USUARIO, atajo('masivo', [{ pais: 'PE', servicio: 'SE,XX' }]));
    expect(ids.guardar).toHaveBeenCalledWith([]);
  });
});

describe('Simulación: solo la llamada al simulador', () => {
  const ITEM_SIM = {
    pais: 'PE',
    servicio: 'SD',
    operador: '1111',
    region: 'Lima',
    provincia: 'Lima',
    distrito: 'San Borja',
  };
  const FIRMA_SIM = 'simulacion|PE|1111|lima|lima|san borja||';

  it('la primera vez se guarda lo resuelto (almacén, producto, destinos); la siguiente se simula con ello', async () => {
    const a = armar();
    await a.servicio.ejecutar(USUARIO, atajo('simulacion', [ITEM_SIM]));
    expect(a.ids.guardar).toHaveBeenCalledWith([{ firma: FIRMA_SIM, ids: { tipo: 'simulacion', resuelta: RESUELTA } }]);

    const b = armar([{ firma: FIRMA_SIM, consultadoEn: hace(0), ids: { tipo: 'simulacion', resuelta: RESUELTA } }]);
    const r = await b.servicio.ejecutar(USUARIO, atajo('simulacion', [ITEM_SIM]));
    expect(b.simulacion.simular).toHaveBeenCalledWith(USUARIO, expect.objectContaining({ operador: '1111' }), {
      resuelta: RESUELTA,
    });
    expect(r.bloques[0].items[0].resultado).toMatchObject({ leidoPorIds: true });
  });

  it('si con los ids guardados Ripley ya no reconoce algo, se resuelve de nuevo', async () => {
    const b = armar([{ firma: FIRMA_SIM, consultadoEn: hace(0), ids: { tipo: 'simulacion', resuelta: RESUELTA } }]);
    b.simulacion.simular.mockRejectedValueOnce(new RipleyApiError('Los ids guardados de la simulación ya no valen'));
    await b.servicio.ejecutar(USUARIO, atajo('simulacion', [ITEM_SIM]));
    expect(b.simulacion.simular).toHaveBeenCalledTimes(2);
    expect(b.ids.guardar).toHaveBeenCalledWith([expect.objectContaining({ firma: FIRMA_SIM })]);
  });
});
