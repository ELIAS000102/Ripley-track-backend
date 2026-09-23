import { describe, expect, it, vi } from 'vitest';
import type { PickingService } from '../../agendas/picking/picking.service.js';
import type { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import type { ContextoAgenteService } from '../contexto.service.js';
import { ReasignarCapacidadAgenteService } from './reasignar.service.js';

/**
 * Mover capacidad de una jornada a otra.
 *
 * Es la escritura con más reglas y la única que hace **dos escrituras que solo
 * valen juntas**. Lo que se fija aquí es que ninguna de las dos ocurra si
 * alguna regla no se cumple, y que el orden entre ellas deje el lado seguro
 * cuando la segunda falla.
 */

const USUARIO = { id: 'u1', email: 'ana@ripley.com.pe' } as UsuarioAutenticado;

const agenda = (jornada: string) => ({
  scheduleId: `s-${jornada}`,
  nombre: `Agenda Picking ${jornada}`,
  typeOfService: jornada,
  unitMeasure: 'unidades',
  activa: true,
  vigenteHasta: null,
});

/** 20026 opera RC, ST, S, SE, SD, AT, OP */
const AGENDAS_PE = ['RC', 'ST', 'S', 'SE', 'SD', 'AT', 'OP'].map(agenda);

function armar({
  agendas = AGENDAS_PE,
  asignado = 1000,
  ocupado = 200,
  pais = 'PE',
}: {
  agendas?: ReturnType<typeof agenda>[];
  asignado?: number;
  ocupado?: number;
  pais?: string;
} = {}) {
  const actualizar = vi.fn().mockResolvedValue({ ok: true });

  const picking = {
    listarAgendasPorOficina: vi.fn().mockResolvedValue(agendas),
    obtener: vi.fn().mockResolvedValue({
      capacityByDayArray: [
        {
          day: '2026-09-23T00:00:00.000Z',
          active: true,
          assigned: asignado,
          occupied: ocupado,
        },
        {
          day: '2026-09-24T00:00:00.000Z',
          active: true,
          assigned: asignado,
          occupied: ocupado,
        },
      ],
    }),
    actualizar,
  } as unknown as PickingService;

  const contexto = {
    armar: vi.fn().mockResolvedValue({ pais }),
  } as unknown as ContextoAgenteService;

  const registrarCambio = vi.fn();

  return {
    servicio: new ReasignarCapacidadAgenteService(picking, contexto, {
      registrarCambio,
    } as unknown as ContextoAuditoria),
    actualizar,
    registrarCambio,
  };
}

const mover = (extra: Record<string, unknown>) =>
  ({
    cd: '20026',
    origen: 'ST',
    destino: 'S',
    unidades: 100,
    fecha: '2026-09-23',
    ...extra,
  }) as never;

describe('Reasignar capacidad: lo que sí mueve', () => {
  it('descuenta del origen y suma al destino', async () => {
    const { servicio, actualizar } = armar();

    const r = await servicio.reasignar(USUARIO, mover({}));

    expect(r.origen.asignadoAntes).toBe(1000);
    expect(r.origen.asignadoDespues).toBe(900);
    expect(r.destino.asignadoAntes).toBe(1000);
    expect(r.destino.asignadoDespues).toBe(1100);
    expect(actualizar).toHaveBeenCalledTimes(2);
  });

  /**
   * Si la segunda escritura falla, es mejor que sobre capacidad a que falte:
   * lo que falta no cabe en ningún sitio y nadie se entera hasta que un pedido
   * se cae.
   */
  it('escribe primero el destino', async () => {
    const { servicio, actualizar } = armar();

    await servicio.reasignar(USUARIO, mover({}));

    expect(actualizar.mock.calls[0][0]).toBe('s-S');
    expect(actualizar.mock.calls[1][0]).toBe('s-ST');
  });

  it('no abre ni cierra el día de paso', async () => {
    const { servicio, actualizar } = armar();

    await servicio.reasignar(USUARIO, mover({}));

    expect(actualizar.mock.calls[0][1].active).toBe(true);
    expect(actualizar.mock.calls[1][1].active).toBe(true);
  });

  it('deja resuelto lo que queda disponible', async () => {
    const { servicio } = armar();

    const r = await servicio.reasignar(USUARIO, mover({}));

    expect(r.origen.disponible).toBe(700);
    expect(r.destino.disponible).toBe(900);
  });

  it('avisa si la segunda escritura falló, y dice cómo quedó', async () => {
    const { servicio, actualizar } = armar();
    actualizar.mockResolvedValueOnce({ ok: true });
    actualizar.mockRejectedValueOnce(new Error('timeout'));

    await expect(servicio.reasignar(USUARIO, mover({}))).rejects.toThrow(
      /NO se pudieron descontar de ST.*unidades de más/s,
    );
  });
});

describe('Reasignar capacidad: quién puede con qué', () => {
  it('entre ST, S y RC del 20026 no pide permiso', async () => {
    const { servicio, actualizar } = armar();

    await servicio.reasignar(USUARIO, mover({ origen: 'RC', destino: 'ST' }));

    expect(actualizar).toHaveBeenCalledTimes(2);
  });

  it('hacia AT, OP, SD o SE sí lo pide, y no escribe nada', async () => {
    const { servicio, actualizar } = armar();

    await expect(
      servicio.reasignar(USUARIO, mover({ origen: 'ST', destino: 'SE' })),
    ).rejects.toThrow(/necesita autorización/);

    expect(actualizar).not.toHaveBeenCalled();
  });

  it('y el mensaje dice entre cuáles sí se puede sin permiso', async () => {
    const { servicio } = armar();

    await expect(
      servicio.reasignar(USUARIO, mover({ origen: 'AT', destino: 'OP' })),
    ).rejects.toThrow(/solo se puede entre ST, S, RC/);
  });

  it('declarar la autorización lo desbloquea', async () => {
    const { servicio, actualizar } = armar();

    const r = await servicio.reasignar(
      USUARIO,
      mover({ origen: 'ST', destino: 'SE', autorizado: true }),
    );

    expect(actualizar).toHaveBeenCalledTimes(2);
    expect(r.conAutorizacion).toBe(true);
  });

  it('basta que una de las dos esté condicionada', async () => {
    // Lo que se vigila es a dónde va a parar tanto como de dónde sale
    const { servicio } = armar();

    await expect(
      servicio.reasignar(USUARIO, mover({ origen: 'SD', destino: 'S' })),
    ).rejects.toThrow(/necesita autorización/);
  });

  it('en el 20096 la pareja libre es S y SG', async () => {
    const { servicio, actualizar } = armar({
      agendas: ['S', 'SG'].map(agenda),
    });

    await servicio.reasignar(
      USUARIO,
      mover({ cd: '20096', origen: 'S', destino: 'SG' }),
    );

    expect(actualizar).toHaveBeenCalledTimes(2);
  });

  it('en Chile todo pide permiso, aunque sean jornadas suyas', async () => {
    const { servicio, actualizar } = armar({
      agendas: ['ST', 'S', 'RC', 'ND', 'DX'].map(agenda),
      pais: 'CL',
    });

    await expect(
      servicio.reasignar(
        USUARIO,
        mover({ cd: '10095', origen: 'ST', destino: 'S' }),
      ),
    ).rejects.toThrow(/toda reasignación necesita permiso/);

    expect(actualizar).not.toHaveBeenCalled();
  });
});

describe('Reasignar capacidad: las fechas', () => {
  it('por defecto las dos jornadas son del mismo día', async () => {
    const { servicio } = armar();

    const r = await servicio.reasignar(USUARIO, mover({}));

    expect(r.origen.fecha).toBe('2026-09-23');
    expect(r.destino.fecha).toBe('2026-09-23');
  });

  it('cruzar fechas está cerrado, y no escribe nada', async () => {
    const { servicio, actualizar } = armar();

    await expect(
      servicio.reasignar(USUARIO, mover({ fechaDestino: '2026-09-24' })),
    ).rejects.toThrow(/dentro de la misma fecha/);

    expect(actualizar).not.toHaveBeenCalled();
  });

  it('salvo ND y DX en Chile, que es la excepción acordada', async () => {
    const { servicio, actualizar } = armar({
      agendas: ['ST', 'S', 'RC', 'ND', 'DX'].map(agenda),
      pais: 'CL',
    });

    const r = await servicio.reasignar(
      USUARIO,
      mover({
        cd: '10095',
        origen: 'ND',
        destino: 'DX',
        fechaDestino: '2026-09-24',
        autorizado: true,
      }),
    );

    expect(r.origen.fecha).toBe('2026-09-23');
    expect(r.destino.fecha).toBe('2026-09-24');
    expect(actualizar).toHaveBeenCalledTimes(2);
  });

  it('y la excepción no se extiende a las demás jornadas chilenas', async () => {
    const { servicio } = armar({
      agendas: ['ST', 'S', 'RC', 'ND', 'DX'].map(agenda),
      pais: 'CL',
    });

    await expect(
      servicio.reasignar(
        USUARIO,
        mover({
          cd: '10095',
          origen: 'ST',
          destino: 'RC',
          fechaDestino: '2026-09-24',
          autorizado: true,
        }),
      ),
    ).rejects.toThrow(/dentro de la misma fecha/);
  });
});

describe('Reasignar capacidad: cuándo se niega', () => {
  it('si el origen no tiene tantas unidades libres', async () => {
    // 1000 asignadas y 950 ocupadas: solo 50 libres
    const { servicio, actualizar } = armar({ ocupado: 950 });

    await expect(
      servicio.reasignar(USUARIO, mover({ unidades: 100 })),
    ).rejects.toThrow(/solo hay 50 libres y se piden 100/);

    expect(actualizar).not.toHaveBeenCalled();
  });

  it('y dice que dejaría la jornada sobrevendida', async () => {
    const { servicio } = armar({ ocupado: 950 });

    await expect(
      servicio.reasignar(USUARIO, mover({ unidades: 100 })),
    ).rejects.toThrow(/sobrevendida/);
  });

  it('si la jornada no es de ese CD', async () => {
    const { servicio, actualizar } = armar();

    await expect(
      servicio.reasignar(USUARIO, mover({ destino: 'SG' })),
    ).rejects.toThrow(/SG no es una jornada de 20026/);

    expect(actualizar).not.toHaveBeenCalled();
  });

  it('si el origen y el destino son la misma', async () => {
    const { servicio, actualizar } = armar();

    await expect(
      servicio.reasignar(USUARIO, mover({ destino: 'ST' })),
    ).rejects.toThrow(/la misma jornada/);

    expect(actualizar).not.toHaveBeenCalled();
  });

  it('si el CD no se reconoce, y dice cuáles hay', async () => {
    const { servicio } = armar();

    await expect(
      servicio.reasignar(USUARIO, mover({ cd: 'CD Inventado' })),
    ).rejects.toThrow(/No reconozco.*20026.*20096/s);
  });

  it('si esa jornada no tiene el día configurado', async () => {
    const { servicio, actualizar } = armar();

    await expect(
      servicio.reasignar(USUARIO, mover({ fecha: '2026-12-25' })),
    ).rejects.toThrow(/no tiene configurado el 2026-12-25/);

    expect(actualizar).not.toHaveBeenCalled();
  });
});

describe('Reasignar capacidad: el CD por su nombre', () => {
  it('"villa el salvador" es el 20026', async () => {
    const { servicio } = armar();

    const r = await servicio.reasignar(
      USUARIO,
      mover({ cd: 'CD Villa El Salvador' }),
    );

    expect(r.cd).toBe('20026 - CD Villa El Salvador');
  });

  it('"aldeas" es el 20096', async () => {
    const { servicio } = armar({ agendas: ['S', 'SG'].map(agenda) });

    const r = await servicio.reasignar(
      USUARIO,
      mover({ cd: 'aldeas', origen: 'S', destino: 'SG' }),
    );

    expect(r.cd).toBe('20096 - CD Aldea 6');
  });
});

describe('Reasignar capacidad: el historial', () => {
  it('guarda las dos jornadas, no solo la que se tocó última', async () => {
    const { servicio, registrarCambio } = armar();

    await servicio.reasignar(USUARIO, mover({}));

    const [antes, despues] = registrarCambio.mock.calls[0] as [
      Record<string, number | string>,
      Record<string, number | string>,
    ];

    expect(antes.ST).toBe(1000);
    expect(antes.S).toBe(1000);
    expect(despues.ST).toBe(900);
    expect(despues.S).toBe(1100);
  });
});
