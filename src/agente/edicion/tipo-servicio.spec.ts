import { describe, expect, it, vi } from 'vitest';
import type { OplService } from '../../configuracion/tipo-servicio/opl/opl.service.js';
import type { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import type { ContextoAgenteService } from '../contexto.service.js';
import { EditarTipoServicioAgenteService } from './tipo-servicio.service.js';

/**
 * Editar un servicio de la agenda de un operador.
 *
 * Dos cosas se vigilan aquí. La primera, que la cadena OPL → zona → agenda se
 * resuelva **sin elegir**: al consultar, quedarse con la primera zona y avisar
 * es razonable; al escribir sería cambiar la configuración de una agenda que
 * nadie nombró.
 *
 * La segunda, las horas de corte. La API las identifica por número del 1 al 7;
 * pedirle al agente que traduzca "el jueves" a un 4 es pedirle que se equivoque
 * en algo que aquí es una tabla.
 */

const USUARIO = { id: 'u1', email: 'ana@ripley.com.pe' } as UsuarioAutenticado;

const CORTES = [
  { id: 1, label: 'Lunes', value: '23:30' },
  { id: 4, label: 'Jueves', value: '23:30' },
];

const SERVICIOS = [
  {
    idServicio: 's-sd',
    code: 'SD',
    descripcion: 'Despacho a domicilio',
    isActive: true,
    enabledForCheckout: true,
    cortes: CORTES,
  },
  {
    idServicio: 's-st',
    code: 'ST',
    descripcion: 'Retiro en tienda',
    isActive: false,
    enabledForCheckout: false,
    cortes: [],
  },
];

function armar(
  opciones: {
    zonas?: Array<Record<string, unknown>>;
    agendas?: Array<Record<string, unknown>>;
    servicios?: typeof SERVICIOS;
  } = {},
) {
  const actualizarServicio = vi.fn().mockResolvedValue({ ok: true });

  const opl = {
    buscarOpl: vi.fn().mockResolvedValue({
      opls: [{ id: 'o-1', code: '1130', nombre: 'Olva' }],
    }),
    listarZonas: vi
      .fn()
      .mockResolvedValue(
        opciones.zonas ?? [{ mainZone: 'z-1', nombre: 'Lima Centro' }],
      ),
    listarAgendas: vi
      .fn()
      .mockResolvedValue(
        opciones.agendas ?? [{ mainSchedule: 'a-1', nombre: 'Agenda DT' }],
      ),
    listarServicios: vi
      .fn()
      .mockResolvedValue({ servicios: opciones.servicios ?? SERVICIOS }),
    actualizarServicio,
  } as unknown as OplService;

  const contexto = {
    armar: vi.fn().mockResolvedValue({ pais: 'PE' }),
  } as unknown as ContextoAgenteService;

  const registrarCambio = vi.fn();

  return {
    servicio: new EditarTipoServicioAgenteService(opl, contexto, {
      registrarCambio,
    } as unknown as ContextoAuditoria),
    actualizarServicio,
    registrarCambio,
  };
}

const editar = (extra: Record<string, unknown>) =>
  ({ opl: '1130', servicio: 'SD', ...extra }) as never;

describe('Editar un tipo de servicio: lo que sí cambia', () => {
  it('desactiva el servicio sin tocar el checkout ni los cortes', async () => {
    const { servicio, actualizarServicio } = armar();

    await servicio.editar(USUARIO, editar({ activo: false }));

    expect(actualizarServicio).toHaveBeenCalledWith(
      's-sd',
      expect.objectContaining({
        courier: 'o-1',
        mainZone: 'z-1',
        mainSchedule: 'a-1',
        isActive: false,
        enabledForCheckout: undefined,
        cortes: undefined,
      }),
    );
  });

  it('traduce el día a su número y manda solo ese corte', async () => {
    const { servicio, actualizarServicio } = armar();

    await servicio.editar(USUARIO, editar({ dia: 'jueves', corte: '17:00' }));

    expect(actualizarServicio.mock.calls[0][1].cortes).toEqual([
      { id: 4, value: '17:00' },
    ]);
  });

  it('admite el día con tilde y sin ella', async () => {
    const { servicio, actualizarServicio } = armar();

    await servicio.editar(
      USUARIO,
      editar({ dia: 'miércoles', corte: '18:00' }),
    );

    expect(actualizarServicio.mock.calls[0][1].cortes).toEqual([
      { id: 3, value: '18:00' },
    ]);
  });

  it('devuelve los cortes como se leen', async () => {
    const { servicio } = armar();

    const r = await servicio.editar(USUARIO, editar({ activo: false }));

    expect(r.antes.cortes).toEqual(['Lunes 23:30', 'Jueves 23:30']);
    expect(r.opl).toBe('1130 - Olva');
    expect(r.agenda).toBe('Agenda DT');
  });
});

describe('Editar un tipo de servicio: cuándo se niega', () => {
  it('si no se pide ningún cambio', async () => {
    const { servicio, actualizarServicio } = armar();

    await expect(servicio.editar(USUARIO, editar({}))).rejects.toThrow(
      /nada que cambiar/,
    );
    expect(actualizarServicio).not.toHaveBeenCalled();
  });

  it('si llega el día sin la hora, o al revés', async () => {
    const { servicio } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ dia: 'jueves' })),
    ).rejects.toThrow(/hacen falta las dos cosas/);

    await expect(
      servicio.editar(USUARIO, editar({ corte: '17:00' })),
    ).rejects.toThrow(/hacen falta las dos cosas/);
  });

  it('si el día no se reconoce', async () => {
    const { servicio } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ dia: 'juebes', corte: '17:00' })),
    ).rejects.toThrow(/No reconozco el día "juebes"/);
  });

  it('si el operador tiene varias zonas y no dicen cuál', async () => {
    // Al consultar se tomaría la primera y se avisaría; al escribir no
    const { servicio, actualizarServicio } = armar({
      zonas: [
        { mainZone: 'z-1', nombre: 'Lima Centro' },
        { mainZone: 'z-2', nombre: 'Lima Norte' },
      ],
    });

    await expect(
      servicio.editar(USUARIO, editar({ activo: false })),
    ).rejects.toThrow(/no voy a elegir por ti: indica la zona/);

    expect(actualizarServicio).not.toHaveBeenCalled();
  });

  it('y dice cuáles son las zonas', async () => {
    const { servicio } = armar({
      zonas: [
        { mainZone: 'z-1', nombre: 'Lima Centro' },
        { mainZone: 'z-2', nombre: 'Lima Norte' },
      ],
    });

    await expect(
      servicio.editar(USUARIO, editar({ activo: false })),
    ).rejects.toThrow(/Lima Centro, Lima Norte/);
  });

  it('pero nombrar la zona desempata', async () => {
    const { servicio, actualizarServicio } = armar({
      zonas: [
        { mainZone: 'z-1', nombre: 'Lima Centro' },
        { mainZone: 'z-2', nombre: 'Lima Norte' },
      ],
    });

    await servicio.editar(USUARIO, editar({ activo: false, zona: 'Norte' }));

    expect(actualizarServicio.mock.calls[0][1].mainZone).toBe('z-2');
  });

  it('si la agenda no tiene ese servicio, y dice los que tiene', async () => {
    const { servicio } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ servicio: 'ZZ', activo: false })),
    ).rejects.toThrow(/no tiene el servicio ZZ.*SD, ST/s);
  });

  it('si el servicio ya estaba exactamente así', async () => {
    const { servicio, actualizarServicio } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ activo: true, enCheckout: true })),
    ).rejects.toThrow(/ya está así/);

    expect(actualizarServicio).not.toHaveBeenCalled();
  });

  it('y una hora de corte igual a la que ya tenía tampoco cuenta', async () => {
    const { servicio } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ dia: 'jueves', corte: '23:30' })),
    ).rejects.toThrow(/ya está así/);
  });
});

describe('Editar un tipo de servicio: el historial', () => {
  it('guarda el antes y el después del servicio', async () => {
    const { servicio, registrarCambio } = armar();

    await servicio.editar(USUARIO, editar({ activo: false }));

    const [antes] = registrarCambio.mock.calls[0];

    expect(antes).toEqual(
      expect.objectContaining({ servicio: 'SD', activo: true }),
    );
  });
});
