import { describe, expect, it, vi } from 'vitest';
import type { PickingService } from '../../agendas/picking/picking.service.js';
import type { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import type { ContextoAgenteService } from '../contexto.service.js';
import { EditarCdAgenteService } from './cd.service.js';

/**
 * Cortar el picking de un CD entero.
 *
 * Nació de una frase que no se podía atender: "desactiva todas las jornadas del
 * CD de hoy". Se resolvía con una llamada por jornada y **una confirmación cada
 * vez** — siete preguntas seguidas para una sola decisión.
 *
 * Es la escritura más ancha sobre capacidad, así que lo que se vigila es que
 * esté acotada: solo picking, solo las jornadas propias del CD, y nada de
 * tocar el asignado de paso.
 */

const USUARIO = { id: 'u1', email: 'ana@ripley.com.pe' } as UsuarioAutenticado;
const HOY = '2026-09-23';

const agenda = (
  typeOfService: string,
  nombre = `Agenda Picking ${typeOfService}`,
) => ({
  scheduleId: `s-${typeOfService}-${nombre}`,
  nombre,
  typeOfService,
  unitMeasure: 'unidades',
  activa: true,
  vigenteHasta: null,
});

const AGENDAS_20026 = ['RC', 'ST', 'S', 'SE', 'SD', 'AT', 'OP'].map((j) =>
  agenda(j),
);

function armar({
  agendas = AGENDAS_20026,
  activo = true,
  porAlmacen,
}: {
  agendas?: ReturnType<typeof agenda>[];
  activo?: boolean;
  porAlmacen?: Record<string, ReturnType<typeof agenda>[]>;
} = {}) {
  const actualizar = vi.fn().mockResolvedValue({ ok: true });

  const picking = {
    listarAgendasPorOficina: vi.fn((codigo: string) =>
      Promise.resolve(porAlmacen ? (porAlmacen[codigo] ?? []) : agendas),
    ),
    obtener: vi.fn().mockResolvedValue({
      capacityByDayArray: [
        {
          day: `${HOY}T00:00:00.000Z`,
          active: activo,
          assigned: 500,
          occupied: 100,
        },
        {
          day: '2026-09-24T00:00:00.000Z',
          active: activo,
          assigned: 500,
          occupied: 100,
        },
      ],
    }),
    actualizar,
  } as unknown as PickingService;

  const contexto = {
    armar: vi.fn().mockResolvedValue({ pais: 'PE' }),
  } as unknown as ContextoAgenteService;

  const registrarCambio = vi.fn();

  return {
    servicio: new EditarCdAgenteService(picking, contexto, {
      registrarCambio,
    } as unknown as ContextoAuditoria),
    actualizar,
    listar: picking.listarAgendasPorOficina as ReturnType<typeof vi.fn>,
    registrarCambio,
  };
}

const cerrar = (extra: Record<string, unknown> = {}) =>
  ({ cd: '20026', fecha: HOY, activa: false, ...extra }) as never;

describe('Cortar un CD: una llamada, todas las jornadas', () => {
  it('corta las siete jornadas del 20026 de una vez', async () => {
    const { servicio, actualizar } = armar();

    const r = await servicio.editar(USUARIO, cerrar());

    expect(r.resumen).toEqual({ pedidas: 7, cambiadas: 7, sinCambiar: 0 });
    expect(actualizar).toHaveBeenCalledTimes(7);
  });

  it('devuelve la lista entera, con jornada y agenda', async () => {
    // Un corte tan ancho solo se revisa viendo cuáles
    const { servicio } = armar();

    const r = await servicio.editar(USUARIO, cerrar());

    expect(r.jornadas).toHaveLength(7);
    expect(r.jornadas[0]).toMatchObject({
      cd: '20026',
      fecha: HOY,
      antes: true,
      despues: false,
    });
    expect(r.jornadas.map((j) => j.jornada).sort()).toEqual([
      'AT',
      'OP',
      'RC',
      'S',
      'SD',
      'SE',
      'ST',
    ]);
  });

  /**
   * Mandar el asignado de paso fue lo que una vez dejó una agenda en cero sin
   * que nadie lo pidiera. Aquí se reenvía tal como está.
   */
  it('no toca el asignado', async () => {
    const { servicio, actualizar } = armar();

    await servicio.editar(USUARIO, cerrar());

    for (const llamada of actualizar.mock.calls) {
      expect(llamada[1].assigned).toBe(500);
      expect(llamada[1].active).toBe(false);
    }
  });

  it('sin cd, son los dos CDs del país', async () => {
    const { servicio, listar } = armar({
      porAlmacen: {
        '20026': AGENDAS_20026,
        '20096': ['S', 'SG'].map((j) => agenda(j)),
      },
    });

    const r = await servicio.editar(USUARIO, cerrar({ cd: undefined }));

    expect(listar).toHaveBeenCalledWith('20026', 'PE');
    expect(listar).toHaveBeenCalledWith('20096', 'PE');
    expect(r.cds).toHaveLength(2);
    expect(r.resumen.cambiadas).toBe(9);
  });

  it('"perú" también son los dos', async () => {
    const { servicio, listar } = armar({
      porAlmacen: {
        '20026': AGENDAS_20026,
        '20096': ['S', 'SG'].map((j) => agenda(j)),
      },
    });

    await servicio.editar(USUARIO, cerrar({ cd: 'Perú' }));

    expect(listar).toHaveBeenCalledTimes(2);
  });

  it('un CD concreto solo toca ese', async () => {
    const { servicio, listar } = armar({
      porAlmacen: {
        '20026': AGENDAS_20026,
        '20096': ['S', 'SG'].map((j) => agenda(j)),
      },
    });

    const r = await servicio.editar(
      USUARIO,
      cerrar({ cd: 'CD Villa El Salvador' }),
    );

    expect(listar).toHaveBeenCalledOnce();
    expect(r.cds).toEqual(['20026 - CD Villa El Salvador']);
  });

  it('un rango de días se resuelve en la misma llamada', async () => {
    const { servicio, actualizar } = armar();

    const r = await servicio.editar(USUARIO, cerrar({ hasta: '2026-09-24' }));

    // Siete jornadas por dos días
    expect(r.resumen.pedidas).toBe(14);
    expect(actualizar).toHaveBeenCalledTimes(14);
  });

  it('acota a las jornadas pedidas si se nombran', async () => {
    const { servicio, actualizar } = armar();

    const r = await servicio.editar(USUARIO, cerrar({ jornadas: 'ST, RC' }));

    expect(r.resumen.pedidas).toBe(2);
    expect(actualizar).toHaveBeenCalledTimes(2);
  });

  it('también sirve para reabrir', async () => {
    const { servicio, actualizar } = armar({ activo: false });

    const r = await servicio.editar(USUARIO, cerrar({ activa: true }));

    expect(r.activa).toBe(true);
    expect(actualizar.mock.calls[0][1].active).toBe(true);
  });
});

describe('Cortar un CD: lo que queda fuera', () => {
  it('las agendas NO FUNCIONAL no se tocan', async () => {
    const { servicio, actualizar } = armar({
      agendas: [
        agenda('RC'),
        agenda('RC', 'Agenda Picking Olva - NO FUNCIONAL'),
        agenda('RC', 'Agenda Picking Andes - NO FUNCIONAL'),
      ],
    });

    const r = await servicio.editar(USUARIO, cerrar());

    expect(r.resumen.pedidas).toBe(1);
    expect(actualizar).toHaveBeenCalledOnce();
  });

  it('las jornadas que no son del CD tampoco', async () => {
    // Ripley arrastra agendas de prueba; cortarlas no es lo que se pidió
    const { servicio, actualizar } = armar({
      agendas: [agenda('RC'), agenda('ZZ'), agenda('PRUEBA')],
    });

    const r = await servicio.editar(USUARIO, cerrar());

    expect(r.resumen.pedidas).toBe(1);
    expect(actualizar).toHaveBeenCalledOnce();
  });

  it('una jornada que ya estaba así se anota y no se escribe', async () => {
    const { servicio, actualizar } = armar({
      agendas: [agenda('RC')],
      activo: false,
    });

    await expect(servicio.editar(USUARIO, cerrar())).rejects.toThrow(
      /Ninguna de las 1 jornadas cambió/,
    );

    expect(actualizar).not.toHaveBeenCalled();
  });

  it('una que falla no arrastra a las demás', async () => {
    const { servicio, actualizar } = armar({
      agendas: ['RC', 'ST', 'S'].map((j) => agenda(j)),
    });
    actualizar.mockRejectedValueOnce(new Error('timeout'));

    const r = await servicio.editar(USUARIO, cerrar());

    expect(r.resumen).toEqual({ pedidas: 3, cambiadas: 2, sinCambiar: 1 });
    expect(r.jornadas.find((j) => j.error)?.error).toMatch(/timeout/);
  });

  it('si el CD no se reconoce, se dice cuáles hay', async () => {
    const { servicio, actualizar } = armar();

    await expect(
      servicio.editar(USUARIO, cerrar({ cd: 'CD Inventado' })),
    ).rejects.toThrow(/No reconozco.*20026.*20096/s);

    expect(actualizar).not.toHaveBeenCalled();
  });

  it('el rango no puede ir al revés', async () => {
    const { servicio, actualizar } = armar();

    await expect(
      servicio.editar(USUARIO, cerrar({ hasta: '2026-09-20' })),
    ).rejects.toThrow(/va al revés/);

    expect(actualizar).not.toHaveBeenCalled();
  });
});

describe('Cortar un CD: el historial', () => {
  it('guarda el conjunto, no la última jornada', async () => {
    const { servicio, registrarCambio } = armar();

    await servicio.editar(USUARIO, cerrar());

    const [antes, despues] = registrarCambio.mock.calls[0] as [
      { cds: string[]; jornadas: unknown[] },
      { cds: string[]; jornadas: unknown[] },
    ];

    expect(antes.cds).toEqual(['20026']);
    expect(antes.jornadas).toHaveLength(7);
    expect(despues.jornadas).toHaveLength(7);
  });
});
