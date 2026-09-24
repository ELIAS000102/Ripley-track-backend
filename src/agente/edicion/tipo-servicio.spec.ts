import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EditarTipoServicioDto } from '../dto/edicion.dto.js';
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
    opls?: Record<string, { id: string; nombre: string }>;
  } = {},
) {
  const actualizarServicio = vi.fn().mockResolvedValue({ ok: true });

  const opl = {
    buscarOpl: vi.fn((termino: string) => {
      // Cada código devuelve su propio operador; lo que no está, no existe
      const conocidos: Record<string, { id: string; nombre: string }> = {
        '1130': { id: 'o-1', nombre: 'Olva' },
        '1140': { id: 'o-2', nombre: 'Urbano' },
        ...opciones.opls,
      };

      const encontrado = conocidos[termino.trim()];

      return Promise.resolve({
        opls: encontrado
          ? [
              {
                id: encontrado.id,
                code: termino.trim(),
                nombre: encontrado.nombre,
              },
            ]
          : [],
      });
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
  it('desactivar apaga también el checkout, aunque solo se pida el estado', async () => {
    // Un servicio inactivo que sigue ofreciéndose en el checkout es un estado
    // que nadie pide a propósito: el cliente lo elige y no hay quien lo despache
    const { servicio, actualizarServicio } = armar();

    await servicio.editar(USUARIO, editar({ activo: false }));

    expect(actualizarServicio).toHaveBeenCalledWith(
      's-sd',
      expect.objectContaining({
        courier: 'o-1',
        mainZone: 'z-1',
        mainSchedule: 'a-1',
        isActive: false,
        enabledForCheckout: false,
        cortes: undefined,
      }),
    );
  });

  it('y quitarlo del checkout también lo desactiva', async () => {
    const { servicio, actualizarServicio } = armar();

    await servicio.editar(USUARIO, editar({ enCheckout: false }));

    expect(actualizarServicio.mock.calls[0][1]).toMatchObject({
      isActive: false,
      enabledForCheckout: false,
    });
  });

  it('pero activar NO es simétrico: solo toca lo que se pide', async () => {
    // Activar un servicio para revisarlo antes de ofrecerlo es una operación
    // real, así que encender el estado no lo mete en el checkout solo
    const { servicio, actualizarServicio } = armar({
      servicios: [{ ...SERVICIOS[1], code: 'SD', idServicio: 's-sd' }],
    });

    await servicio.editar(USUARIO, editar({ activo: true }));

    expect(actualizarServicio.mock.calls[0][1]).toMatchObject({
      isActive: true,
      enabledForCheckout: undefined,
    });
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

    expect(r.servicios[0].antes?.cortes).toEqual([
      'Lunes 23:30',
      'Jueves 23:30',
    ]);
    expect(r.opls).toEqual(['1130 - Olva']);
    expect(r.servicios[0].agenda).toBe('Agenda DT');
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
    ).rejects.toThrow(/Ya estaba así/);

    expect(actualizarServicio).not.toHaveBeenCalled();
  });

  it('y una hora de corte igual a la que ya tenía tampoco cuenta', async () => {
    const { servicio } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ dia: 'jueves', corte: '23:30' })),
    ).rejects.toThrow(/Ya estaba así/);
  });
});

/**
 * Varios servicios en una llamada.
 *
 * "Desactiva el SD y el ST de Olva" es una decisión, no dos. Confirmarla
 * servicio por servicio convertía una frase en cuatro turnos de chat.
 */
describe('Editar un tipo de servicio: varios de una vez', () => {
  it('cambia los dos y devuelve uno por cada uno', async () => {
    const { servicio, actualizarServicio } = armar();

    const r = await servicio.editar(
      USUARIO,
      editar({ servicio: 'SD, ST', activo: false }),
    );

    expect(r.resumen).toEqual({ pedidos: 2, cambiados: 1, sinCambiar: 1 });

    // El ST ya estaba inactivo y fuera del checkout: se anota, no se escribe
    expect(r.servicios[1].error).toMatch(/Ya estaba así/);
    expect(actualizarServicio).toHaveBeenCalledOnce();
  });

  it('la lista viene igual aunque se pida uno solo', async () => {
    const { servicio } = armar();

    const r = await servicio.editar(USUARIO, editar({ activo: false }));

    expect(r.servicios).toHaveLength(1);
    expect(r.resumen.pedidos).toBe(1);
  });

  it('uno que no existe no arrastra a los demás', async () => {
    const { servicio, actualizarServicio } = armar();

    const r = await servicio.editar(
      USUARIO,
      editar({ servicio: 'SD, ZZ', activo: false }),
    );

    expect(r.resumen).toEqual({ pedidos: 2, cambiados: 1, sinCambiar: 1 });
    expect(r.servicios[1].error).toMatch(/no tiene el servicio ZZ/);
    expect(r.servicios[1].antes).toBeNull();
    expect(actualizarServicio).toHaveBeenCalledOnce();
  });

  it('si ninguno existe, es un 404 y no se escribe nada', async () => {
    const { servicio, actualizarServicio } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ servicio: 'ZZ, YY', activo: false })),
    ).rejects.toThrow(/Ninguno de los 2 cambios se pudo aplicar.*ZZ.*YY/s);

    expect(actualizarServicio).not.toHaveBeenCalled();
  });

  it('una hora de corte se cambia de uno en uno', async () => {
    // La hora no tiene por qué ser la misma en todos los servicios
    const { servicio, actualizarServicio } = armar();

    await expect(
      servicio.editar(
        USUARIO,
        editar({ servicio: 'SD, ST', dia: 'jueves', corte: '17:00' }),
      ),
    ).rejects.toThrow(/un servicio por vez/);

    expect(actualizarServicio).not.toHaveBeenCalled();
  });

  it('un servicio repetido se escribe una sola vez', async () => {
    const { servicio, actualizarServicio } = armar();

    const r = await servicio.editar(
      USUARIO,
      editar({ servicio: 'SD, sd', activo: false }),
    );

    expect(r.servicios).toHaveLength(1);
    expect(actualizarServicio).toHaveBeenCalledOnce();
  });
});

/**
 * Varios operadores en una sola llamada.
 *
 * Es el caso que falló en producción: se pidió activar un servicio en once
 * operadores y el agente los mandó todos juntos en "opl". El backend los
 * buscaba como un único nombre y respondía que no existía ninguno.
 */
describe('Editar un tipo de servicio: varios operadores de una vez', () => {
  it('cambia el servicio en los dos y lo devuelve en una lista plana', async () => {
    const { servicio, actualizarServicio } = armar();

    const r = await servicio.editar(
      USUARIO,
      editar({ opl: '1130, 1140', activo: false }),
    );

    expect(r.opls).toEqual(['1130 - Olva', '1140 - Urbano']);
    expect(r.resumen).toEqual({ pedidos: 2, cambiados: 2, sinCambiar: 0 });

    // Cada fila dice de qué operador es: con varios, la tabla necesita esa columna
    expect(r.servicios.map((s) => s.opl)).toEqual([
      '1130 - Olva',
      '1140 - Urbano',
    ]);
    expect(actualizarServicio).toHaveBeenCalledTimes(2);
  });

  it('cruza operadores con servicios', async () => {
    const { servicio } = armar();

    const r = await servicio.editar(
      USUARIO,
      editar({ opl: '1130, 1140', servicio: 'SD, ST', activo: false }),
    );

    // Dos operadores por dos servicios
    expect(r.servicios).toHaveLength(4);
  });

  it('un operador que no existe no arrastra a los demás', async () => {
    const { servicio, actualizarServicio } = armar();

    const r = await servicio.editar(
      USUARIO,
      editar({ opl: '1130, 9999', activo: false }),
    );

    expect(r.resumen).toEqual({ pedidos: 2, cambiados: 1, sinCambiar: 1 });
    expect(r.servicios[1].error).toMatch(/No se encontró ningún operador/);
    expect(r.servicios[1].antes).toBeNull();

    // El que sí se pudo, se escribió
    expect(actualizarServicio).toHaveBeenCalledOnce();
  });

  it('la lista viene igual aunque se pida uno solo', async () => {
    const { servicio } = armar();

    const r = await servicio.editar(USUARIO, editar({ activo: false }));

    expect(r.opls).toHaveLength(1);
    expect(r.servicios).toHaveLength(1);
  });

  it('un operador repetido se escribe una sola vez', async () => {
    const { servicio, actualizarServicio } = armar();

    const r = await servicio.editar(
      USUARIO,
      editar({ opl: '1130, 1130', activo: false }),
    );

    expect(r.opls).toHaveLength(1);
    expect(actualizarServicio).toHaveBeenCalledOnce();
  });

  it('una hora de corte se cambia en un operador por vez', async () => {
    // La hora suele ser propia de cada operador
    const { servicio, actualizarServicio } = armar();

    await expect(
      servicio.editar(
        USUARIO,
        editar({ opl: '1130, 1140', dia: 'jueves', corte: '17:00' }),
      ),
    ).rejects.toThrow(/un operador por vez/);

    expect(actualizarServicio).not.toHaveBeenCalled();
  });

  it('hay tope, y sugiere el cambio en bloque si son demasiados', async () => {
    const { servicio, actualizarServicio } = armar();

    const muchos = Array.from({ length: 11 }, (_, i) => `op${i}`).join(', ');

    await expect(
      servicio.editar(USUARIO, editar({ opl: muchos, activo: false })),
    ).rejects.toThrow(/máximo por vez es 10.*cambio en bloque/s);

    expect(actualizarServicio).not.toHaveBeenCalled();
  });

  it('si ninguno se pudo resolver, es un 404 con los motivos', async () => {
    const { servicio, actualizarServicio } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ opl: '9998, 9999', activo: false })),
    ).rejects.toThrow(/Ninguno de los 2 cambios se pudo aplicar/);

    expect(actualizarServicio).not.toHaveBeenCalled();
  });
});

describe('Editar un tipo de servicio: el historial', () => {
  it('guarda el antes y el después del servicio', async () => {
    const { servicio, registrarCambio } = armar();

    await servicio.editar(USUARIO, editar({ activo: false }));

    const [antes] = registrarCambio.mock.calls[0] as [
      {
        opls: string[];
        servicios: Array<{ agenda: string; antes: { activo: boolean } }>;
      },
    ];

    // Se guarda el conjunto, con su operador y su agenda en cada fila
    expect(antes.opls).toEqual(['1130 - Olva']);
    expect(antes.servicios[0].agenda).toBe('Agenda DT');
    expect(antes.servicios[0].antes.activo).toBe(true);
  });
});

describe('Editar un tipo de servicio: lo que llega tras validar', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = {
    type: 'body' as const,
    metatype: EditarTipoServicioDto,
    data: '',
  };

  const validar = (cuerpo: Record<string, unknown>) =>
    pipe.transform(cuerpo, meta) as Promise<EditarTipoServicioDto>;

  /** Un cuerpo como el que arma n8n: todos los campos, vacíos los que no usó */
  const comoN8n = (relleno: Record<string, unknown>) => ({
    opl: '1130',
    servicio: 'DT',
    zona: '',
    agenda: '',
    activo: '',
    enCheckout: '',
    dia: '',
    corte: '',
    pais: 'PE',
    ...relleno,
  });

  /**
   * El caso que rompió en producción: desactivar un servicio no lleva hora de
   * corte, pero n8n manda `corte: ''` igualmente y el formato HH:MM lo
   * rechazaba. El cambio no se llegaba a intentar.
   */
  it('un corte vacío no dispara el formato HH:MM', async () => {
    const dto = await validar(
      comoN8n({ activo: 'false', enCheckout: 'false' }),
    );

    expect(dto.corte).toBeUndefined();
    expect(dto.dia).toBeUndefined();
    expect(dto.activo).toBe(false);
    expect(dto.enCheckout).toBe(false);
  });

  it('y una hora mal escrita sí se sigue rechazando', async () => {
    const motivos = await validar(
      comoN8n({ dia: 'jueves', corte: '25:99' }),
    ).then(
      () => [] as string[],
      (e: { response?: { message?: string[] } }) => e.response?.message ?? [],
    );

    expect(motivos.join(' ')).toMatch(/formato HH:MM/);
  });

  it('una hora buena pasa tal cual', async () => {
    const dto = await validar(comoN8n({ dia: 'jueves', corte: '17:00' }));

    expect(dto.corte).toBe('17:00');
    expect(dto.dia).toBe('jueves');
  });

  it('los filtros vacíos llegan como ausentes', async () => {
    const dto = await validar(comoN8n({ activo: 'false' }));

    expect(dto.zona).toBeUndefined();
    expect(dto.agenda).toBeUndefined();
    expect(dto.enCheckout).toBeUndefined();
  });
});
