import {
  BadRequestException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EditarCapacidadDto } from '../dto/edicion.dto.js';
import type { DespachoService } from '../../agendas/despacho/despacho.service.js';
import type { PickingService } from '../../agendas/picking/picking.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { hoyEnPais, sumarDias } from '../../common/ripley/utils/date.util.js';
import type { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { ContextoAgenteService } from '../contexto.service.js';
import { EditarCapacidadAgenteService } from './capacidad.service.js';

/**
 * La escritura del agente, y sobre todo **cuándo se niega a escribir**.
 *
 * Cada caso de aquí es uno en el que el modelo podría razonablemente equivocarse
 * y nadie se enteraría hasta mirar el panel. Lo que se comprueba no es solo que
 * responda un error: es que **no haya llamado a Ripley**.
 */

const USUARIO = { id: 'u1', email: 'ana@ripley.com.pe' } as UsuarioAutenticado;

const HOY = hoyEnPais('PE');
const MANANA = sumarDias(HOY, 1);
const AYER = sumarDias(HOY, -1);

/** Un día tal como lo devuelve picking: fecha ISO completa */
const diaPicking = (fecha: string, assigned = 1688, occupied = 1282) => ({
  day: `${fecha}T00:00:00.000Z`,
  active: true,
  assigned,
  occupied,
});

function armar(
  opciones: {
    agendas?: Array<Record<string, unknown>>;
    dias?: Array<Record<string, unknown>>;
  } = {},
) {
  const actualizarPicking = vi.fn().mockResolvedValue({ ok: true });
  const actualizarDespacho = vi.fn().mockResolvedValue({ ok: true });

  const obtenerPicking = vi.fn().mockResolvedValue({
    capacityByDayArray: opciones.dias ?? [diaPicking(MANANA)],
  });

  const picking = {
    listarAgendasPorOficina: vi.fn().mockResolvedValue(
      opciones.agendas ?? [
        {
          scheduleId: 'cap-1',
          nombre: 'Picking S',
          typeOfService: 'S',
          unitMeasure: 'unidades',
        },
      ],
    ),
    obtener: obtenerPicking,
    actualizar: actualizarPicking,
  } as unknown as PickingService;

  const despacho = {
    listarZonas: vi
      .fn()
      .mockResolvedValue([{ zoneId: 'z-1', nombre: 'Lima Centro' }]),
    listarAgendas: vi
      .fn()
      .mockResolvedValue([{ mainScheduleId: 'ms-1', nombre: 'Agenda DT' }]),
    buscarCapacidades: vi.fn().mockResolvedValue({
      agenda: { unitMeasure: 'unidades' },
      // Despacho habla en DD-MM-YYYY y manda "assigned" como texto
      dias: [
        {
          date: `${MANANA.slice(8, 10)}-${MANANA.slice(5, 7)}-${MANANA.slice(0, 4)}`,
          assigned: '500',
          occupied: 120,
          active: true,
        },
      ],
    }),
    actualizar: actualizarDespacho,
  } as unknown as DespachoService;

  const contexto = {
    armar: vi.fn().mockResolvedValue({ pais: 'PE', hoy: HOY }),
  } as unknown as ContextoAgenteService;

  const registrarCambio = vi.fn();
  const auditoria = { registrarCambio } as unknown as ContextoAuditoria;

  return {
    servicio: new EditarCapacidadAgenteService(
      picking,
      despacho,
      contexto,
      auditoria,
    ),
    actualizarPicking,
    actualizarDespacho,
    registrarCambio,
    obtenerPicking,
  };
}

/**
 * Lo que devuelve de verdad el almacén 20026.
 *
 * Cinco agendas comparten el tipo de servicio RC: la que se usa y cuatro
 * marcadas "NO FUNCIONAL". Filtrar solo por servicio deja cinco candidatas y
 * la petición se quedaba en bucle — el agente preguntaba cuál y no tenía
 * ningún campo donde mandar la respuesta.
 */
const AGENDAS_20026 = [
  { scheduleId: 'c-s', nombre: 'Agenda Picking S - 20026', typeOfService: 'S' },
  {
    scheduleId: 'c-rc',
    nombre: 'Agenda Picking RC - 20026',
    typeOfService: 'RC',
  },
  {
    scheduleId: 'c-olva',
    nombre: 'Agenda Picking Olva - NO FUNCIONAL',
    typeOfService: 'RC',
  },
  {
    scheduleId: 'c-andes',
    nombre: 'Agenda Picking Andes - NO FUNCIONAL',
    typeOfService: 'RC',
  },
  {
    scheduleId: 'c-bus',
    nombre: 'Agenda Picking MOVIL BUS - NO FUNCIONAL',
    typeOfService: 'RC',
  },
  {
    scheduleId: 'c-tambo',
    nombre: 'Agenda Picking Tambo - NO FUNCIONAL',
    typeOfService: 'RC',
  },
];

const editar = (extra: Record<string, unknown>) =>
  ({
    tipo: 'picking',
    codigo: '20026',
    fecha: MANANA,
    ...extra,
  }) as never;

describe('Edición del agente: lo que sí escribe', () => {
  it('cambia el asignado y devuelve el antes y el después', async () => {
    const { servicio, actualizarPicking } = armar();

    const r = await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'S', asignado: 1800 }),
    );

    expect(actualizarPicking).toHaveBeenCalledWith(
      'cap-1',
      { day: `${MANANA}T00:00:00.000Z`, assigned: 1800, active: true },
      'PE',
    );

    expect(r.agendas[0].dias).toHaveLength(1);
    expect(r.agendas[0].dias[0].antes?.asignado).toBe(1688);
    expect(r.agendas[0].dias[0].despues?.asignado).toBe(1800);
    // El ocupado no lo toca nadie desde aquí
    expect(r.agendas[0].dias[0].despues?.ocupado).toBe(1282);
    expect(r.agendas[0].dias[0].despues?.disponible).toBe(518);
    expect(r.resumen).toEqual({ pedidos: 1, cambiados: 1, sinCambiar: 0 });
  });

  it('cambiar solo "activa" conserva el asignado que ya tenía', async () => {
    const { servicio, actualizarPicking } = armar();

    await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'S', activa: false }),
    );

    expect(actualizarPicking).toHaveBeenCalledWith(
      'cap-1',
      expect.objectContaining({ assigned: 1688, active: false }),
      'PE',
    );
  });

  it('resuelve zona y agenda en despacho y escribe en su formato de fecha', async () => {
    const { servicio, actualizarDespacho } = armar();

    const r = await servicio.editarCapacidad(
      USUARIO,
      editar({
        tipo: 'despacho',
        codigo: '1130',
        zona: 'centro',
        agenda: 'DT',
        asignado: 600,
      }),
    );

    const esperado = `${MANANA.slice(8, 10)}-${MANANA.slice(5, 7)}-${MANANA.slice(0, 4)}`;

    expect(actualizarDespacho).toHaveBeenCalledWith(
      '1130',
      'z-1',
      'ms-1',
      { date: esperado, assigned: 600, active: true },
      'PE',
    );

    expect(r.agendas[0].zona).toBe('Lima Centro');
    // "500" llega como texto desde Ripley y sale como número
    expect(r.agendas[0].dias[0].antes?.asignado).toBe(500);
  });
});

describe('Edición del agente: cuándo se niega', () => {
  /** Ninguna negativa puede haber llamado a Ripley */
  async function rechaza(
    dto: Record<string, unknown>,
    error: typeof BadRequestException | typeof NotFoundException,
    fragmento: RegExp,
    opciones?: Parameters<typeof armar>[0],
  ) {
    const { servicio, actualizarPicking, actualizarDespacho } = armar(opciones);

    await expect(
      servicio.editarCapacidad(USUARIO, dto as never),
    ).rejects.toThrow(error);

    await expect(
      servicio.editarCapacidad(USUARIO, dto as never),
    ).rejects.toThrow(fragmento);

    expect(actualizarPicking).not.toHaveBeenCalled();
    expect(actualizarDespacho).not.toHaveBeenCalled();
  }

  it('si no se pide ningún cambio', async () => {
    await rechaza(
      editar({ servicio: 'S' }),
      BadRequestException,
      /nada que cambiar/,
    );
  });

  it('si la fecha ya pasó', async () => {
    await rechaza(
      editar({ servicio: 'S', asignado: 100, fecha: AYER }),
      BadRequestException,
      /ya pasó/,
    );
  });

  it('si la fecha está a más de un año', async () => {
    const lejos = `${Number(HOY.slice(0, 4)) + 2}${HOY.slice(4)}`;

    await rechaza(
      editar({ servicio: 'S', asignado: 100, fecha: lejos }),
      BadRequestException,
      /más de un año/,
    );
  });

  it('si el filtro deja más de una agenda', async () => {
    // Dos agendas y ningún "servicio" que las distinga. En una consulta se
    // tomaría la primera; aquí eso sería cambiar la que nadie pidió.
    await rechaza(
      editar({ asignado: 100 }),
      BadRequestException,
      /no voy a elegir por ti/,
      {
        agendas: [
          { scheduleId: 'a', nombre: 'Picking S', typeOfService: 'S' },
          { scheduleId: 'b', nombre: 'Picking ST', typeOfService: 'ST' },
        ],
      },
    );
  });

  it('y dice cuáles son las opciones', async () => {
    const { servicio } = armar({
      agendas: [
        { scheduleId: 'a', nombre: 'Picking S', typeOfService: 'S' },
        { scheduleId: 'b', nombre: 'Picking ST', typeOfService: 'ST' },
      ],
    });

    await expect(
      servicio.editarCapacidad(USUARIO, editar({ asignado: 100 })),
    ).rejects.toThrow(/S \(Picking S\), ST \(Picking ST\)/);
  });

  it('si el servicio pedido no existe en ese almacén', async () => {
    await rechaza(
      editar({ servicio: 'ZZ', asignado: 100 }),
      NotFoundException,
      /No encontré el servicio que pides/,
    );
  });

  it('si el día no está configurado en la agenda', async () => {
    await rechaza(
      editar({ servicio: 'S', asignado: 100 }),
      NotFoundException,
      /no se crean días nuevos/i,
      { dias: [] },
    );
  });

  it('si el asignado quedaría por debajo de lo ya ocupado', async () => {
    // 1282 ocupados: dejarlo en 900 deja la agenda sobrevendida
    await rechaza(
      editar({ servicio: 'S', asignado: 900 }),
      BadRequestException,
      /sobrevendido/,
    );
  });

  it('y ahí sugiere lo que la operación hace de verdad', async () => {
    const { servicio } = armar();

    await expect(
      servicio.editarCapacidad(USUARIO, editar({ servicio: 'S', asignado: 0 })),
    ).rejects.toThrow(/activa: false/);
  });

  it('si el día ya está exactamente así', async () => {
    await rechaza(
      editar({ servicio: 'S', asignado: 1688, activa: true }),
      BadRequestException,
      /ya estaba así/i,
    );
  });
});

/**
 * Lo que de verdad llega al service después de pasar por la validación.
 *
 * Los tests de arriba construyen el DTO a mano, y por ahí se coló un fallo que
 * llegó a producción: n8n manda **todos** los campos, rellenos o no, así que
 * "solo desactiva el día" viajaba con `asignado: ''`. El `@Type(() => Number)`
 * corría antes del `@Transform` y lo convertía en `Number('') === 0`; el
 * service recibía un cero indistinguible de uno pedido a propósito y **borraba
 * la capacidad asignada del día**.
 *
 * Por eso esta tanda pasa por el pipe de verdad, con los cuerpos tal como los
 * arma n8n.
 */
describe('Edición del agente: lo que llega tras validar', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = {
    type: 'body' as const,
    metatype: EditarCapacidadDto,
    data: '',
  };

  const validar = (cuerpo: Record<string, unknown>) =>
    pipe.transform(cuerpo, meta) as Promise<EditarCapacidadDto>;

  /** Un cuerpo como el que arma n8n: todos los campos, vacíos los que no usó */
  const comoN8n = (relleno: Record<string, unknown>) => ({
    tipo: 'picking',
    codigo: '20026',
    servicio: '',
    zona: '',
    agenda: '',
    fecha: '2026-12-01',
    asignado: '',
    activa: '',
    pais: 'PE',
    ...relleno,
  });

  it('desactivar un día NO toca el asignado', async () => {
    const dto = await validar(comoN8n({ servicio: 'S', activa: 'false' }));

    expect(dto.activa).toBe(false);
    expect(dto.asignado).toBeUndefined();
  });

  it('cambiar el asignado NO toca el estado', async () => {
    const dto = await validar(comoN8n({ servicio: 'S', asignado: '1800' }));

    expect(dto.asignado).toBe(1800);
    expect(dto.activa).toBeUndefined();
  });

  it('un cero pedido a propósito sí es un cero', async () => {
    const dto = await validar(comoN8n({ servicio: 'S', asignado: '0' }));

    expect(dto.asignado).toBe(0);
  });

  it('los textos vacíos llegan como ausentes, no como cadena vacía', async () => {
    const dto = await validar(comoN8n({ activa: 'true' }));

    // Un '' es "no lo indiqué", que es lo que hace saltar la regla de "hay
    // varias agendas, elige tú". Que llegue como undefined y no como '' evita
    // además que un formato exigido se aplique a un campo que nadie rellenó.
    expect(dto.servicio).toBeUndefined();
    expect(dto.zona).toBeUndefined();
  });

  it('un asignado que no es número se rechaza, no se convierte en NaN', async () => {
    await expect(
      validar(comoN8n({ asignado: 'mil ochocientos' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('sigue habiendo tope para el asignado', async () => {
    // Los motivos de un 400 de validación van en el cuerpo, no en el message
    const motivos = await validar(comoN8n({ asignado: '999999999' })).then(
      () => [] as string[],
      (e: { response?: { message?: string[] } }) => e.response?.message ?? [],
    );

    expect(motivos.join(' ')).toMatch(/no puede pasar de/);
  });
});

describe('Edición del agente: varios días de una vez', () => {
  const dias = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      diaPicking(sumarDias(MANANA, i), 350, 0),
    );

  it('cierra todo el rango con una sola llamada al backend', async () => {
    const { servicio, actualizarPicking } = armar({ dias: dias(4) });
    const hasta = sumarDias(MANANA, 3);

    const r = await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'S', activa: false, hasta }),
    );

    expect(r.agendas[0].dias).toHaveLength(4);
    expect(r.resumen).toEqual({ pedidos: 4, cambiados: 4, sinCambiar: 0 });
    expect(actualizarPicking).toHaveBeenCalledTimes(4);

    // Y ninguno perdió su capacidad por el camino
    r.agendas[0].dias.forEach((d) => {
      expect(d.despues?.activo).toBe(false);
      expect(d.despues?.asignado).toBe(350);
    });
  });

  it('lee la agenda una sola vez, no una por día', async () => {
    const { servicio, obtenerPicking } = armar({ dias: dias(4) });
    const hasta = sumarDias(MANANA, 3);

    await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'S', activa: false, hasta }),
    );

    // Escribir un día no cambia los otros, así que una lectura basta
    expect(obtenerPicking).toHaveBeenCalledTimes(1);
  });

  it('un día que falla no arrastra a los demás', async () => {
    // Solo existen el primero y el tercero
    const { servicio } = armar({
      dias: [
        diaPicking(MANANA, 350, 0),
        diaPicking(sumarDias(MANANA, 2), 350, 0),
      ],
    });

    const r = await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'S', activa: false, hasta: sumarDias(MANANA, 2) }),
    );

    expect(r.resumen).toEqual({ pedidos: 3, cambiados: 2, sinCambiar: 1 });
    expect(r.agendas[0].dias[1].error).toMatch(/no se crean días nuevos/);
    expect(r.agendas[0].dias[1].despues).toBeNull();
    expect(r.agendas[0].dias[2].despues?.activo).toBe(false);
  });

  it('el historial guarda el conjunto, no el último día', async () => {
    const { servicio, registrarCambio } = armar({ dias: dias(3) });

    await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'S', activa: false, hasta: sumarDias(MANANA, 2) }),
    );

    const [antes, despues] = registrarCambio.mock.calls[0] as [
      { dias: unknown[] },
      { dias: unknown[] },
    ];

    expect(antes.dias).toHaveLength(3);
    expect(despues.dias).toHaveLength(3);
  });

  it('rechaza un rango al revés', async () => {
    const { servicio, actualizarPicking } = armar({ dias: dias(4) });

    await expect(
      servicio.editarCapacidad(
        USUARIO,
        editar({
          servicio: 'S',
          activa: false,
          fecha: sumarDias(MANANA, 3),
          hasta: MANANA,
        }),
      ),
    ).rejects.toThrow(/al revés/);

    expect(actualizarPicking).not.toHaveBeenCalled();
  });

  it('rechaza un rango más largo que el tope', async () => {
    const { servicio, actualizarPicking } = armar({ dias: dias(4) });

    await expect(
      servicio.editarCapacidad(
        USUARIO,
        editar({
          servicio: 'S',
          activa: false,
          hasta: sumarDias(MANANA, 40),
        }),
      ),
    ).rejects.toThrow(/máximo por vez/);

    expect(actualizarPicking).not.toHaveBeenCalled();
  });
});

describe('Edición del agente: las agendas NO FUNCIONAL no se editan', () => {
  it('con el servicio RC no pregunta nada: solo una es utilizable', async () => {
    // Cinco agendas comparten el servicio RC y cuatro están marcadas fuera de
    // uso. Preguntar a cuál aplicar el cambio es preguntar por algo que solo
    // tiene una respuesta posible.
    const { servicio, actualizarPicking } = armar({ agendas: AGENDAS_20026 });

    const r = await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'RC', activa: false }),
    );

    expect(r.agendas[0].agenda).toBe('RC - Agenda Picking RC - 20026');
    expect(actualizarPicking).toHaveBeenCalledWith(
      'c-rc',
      expect.objectContaining({ active: false }),
      'PE',
    );
  });

  it('también deja fuera las que tienen la vigencia vencida', async () => {
    // Las cuatro RC apartadas del 20026 vencieron el 31-12-2025 y las que se
    // usan llegan a 2030: la fecha es mejor señal que el rótulo del nombre
    const { servicio, actualizarPicking } = armar({
      agendas: [
        {
          scheduleId: 'c-rc',
          nombre: 'Agenda Picking RC - 20026',
          typeOfService: 'RC',
          vigenteHasta: '2030-12-31',
        },
        {
          scheduleId: 'c-vieja',
          nombre: 'Agenda Picking RC del año pasado',
          typeOfService: 'RC',
          vigenteHasta: '2025-12-31',
        },
      ],
    });

    await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'RC', activa: false }),
    );

    expect(actualizarPicking).toHaveBeenCalledWith(
      'c-rc',
      expect.anything(),
      'PE',
    );
  });

  it('una vigencia que aún no ha vencido no estorba', async () => {
    const { servicio, actualizarPicking } = armar({
      agendas: [
        {
          scheduleId: 'c-rc',
          nombre: 'Agenda Picking RC - 20026',
          typeOfService: 'RC',
          vigenteHasta: '2030-12-31',
        },
      ],
    });

    await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'RC', activa: false }),
    );

    expect(actualizarPicking).toHaveBeenCalledOnce();
  });

  it('se niega si nombran una a propósito, y dice por qué', async () => {
    const { servicio, actualizarPicking } = armar({ agendas: AGENDAS_20026 });

    await expect(
      servicio.editarCapacidad(
        USUARIO,
        editar({ agenda: 'Agenda Picking Olva - NO FUNCIONAL', activa: false }),
      ),
    ).rejects.toThrow(/NO FUNCIONAL: no se edita desde el chat/);

    expect(actualizarPicking).not.toHaveBeenCalled();
  });

  it('tampoco cuentan para decidir si hay ambigüedad', async () => {
    // Dos utilizables con el mismo servicio: ahí sí hay que preguntar, y las
    // opciones que se ofrecen son solo las que se pueden tocar.
    const { servicio } = armar({
      agendas: [
        ...AGENDAS_20026,
        {
          scheduleId: 'c-rc2',
          nombre: 'Agenda Picking RC turno tarde',
          typeOfService: 'RC',
        },
      ],
    });

    const error = await servicio
      .editarCapacidad(USUARIO, editar({ servicio: 'RC', activa: false }))
      .catch((e: Error) => e.message);

    expect(error).toMatch(/Hay 2 opciones/);
    expect(error).toMatch(/Agenda Picking RC - 20026/);
    expect(error).toMatch(/turno tarde/);
    expect(error).not.toMatch(/NO FUNCIONAL/);
  });

  it('cuando hay que preguntar, dice que el desempate va en "agenda"', async () => {
    const { servicio } = armar({
      agendas: [
        {
          scheduleId: 'a',
          nombre: 'Agenda Picking RC - 20026',
          typeOfService: 'RC',
        },
        {
          scheduleId: 'b',
          nombre: 'Agenda Picking RC turno tarde',
          typeOfService: 'RC',
        },
      ],
    });

    await expect(
      servicio.editarCapacidad(
        USUARIO,
        editar({ servicio: 'RC', activa: false }),
      ),
    ).rejects.toThrow(/indicando el nombre exacto en "agenda"/);
  });
});

/**
 * Varias jornadas en una sola llamada.
 *
 * "Cierra la ST y la RC del 20026" es una decisión, no dos. Confirmarla
 * jornada por jornada era lo que convertía una frase en cuatro turnos de chat.
 */
describe('Edición del agente: varias jornadas de una vez', () => {
  /** Dos jornadas utilizables en el mismo almacén */
  const DOS = [
    { scheduleId: 'cap-s', nombre: 'Picking S', typeOfService: 'S' },
    { scheduleId: 'cap-st', nombre: 'Picking ST', typeOfService: 'ST' },
  ];

  it('cambia las dos y devuelve una entrada por agenda', async () => {
    const { servicio, actualizarPicking } = armar({ agendas: DOS });

    const r = await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'S, ST', activa: false }),
    );

    expect(r.agendas).toHaveLength(2);
    expect(r.agendas.map((a) => a.agenda)).toEqual([
      'S - Picking S',
      'ST - Picking ST',
    ]);
    expect(actualizarPicking).toHaveBeenCalledTimes(2);
  });

  it('la lista viene igual aunque se pida una sola', async () => {
    const { servicio } = armar({ agendas: DOS });

    const r = await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'S', activa: false }),
    );

    expect(r.agendas).toHaveLength(1);
  });

  it('una jornada que no existe no arrastra a las demás', async () => {
    const { servicio, actualizarPicking } = armar({ agendas: DOS });

    const r = await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'S, ZZ', activa: false }),
    );

    expect(r.agendas[1].error).toBeTruthy();
    expect(r.agendas[1].dias).toHaveLength(0);

    // La que sí existe se escribió
    expect(actualizarPicking).toHaveBeenCalledOnce();
    expect(r.resumen.cambiados).toBe(1);
  });

  it('una jornada repetida se escribe una sola vez', async () => {
    const { servicio, actualizarPicking } = armar({ agendas: DOS });

    const r = await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'S, s', activa: false }),
    );

    expect(r.agendas).toHaveLength(1);
    expect(actualizarPicking).toHaveBeenCalledOnce();
  });

  it('hay tope, y remite a la herramienta del CD si son muchas', async () => {
    const { servicio, actualizarPicking } = armar({ agendas: DOS });

    const muchas = Array.from({ length: 11 }, (_, i) => `J${i}`).join(', ');

    await expect(
      servicio.editarCapacidad(
        USUARIO,
        editar({ servicio: muchas, activa: false }),
      ),
    ).rejects.toThrow(/máximo por vez es 10[\s\S]*herramienta del CD/);

    expect(actualizarPicking).not.toHaveBeenCalled();
  });
});

/**
 * Lo exacto gana sobre lo parecido.
 *
 * El filtro usaba `includes` a secas, así que la jornada "S" casaba también
 * con "ST", "SD" y "SE": no había forma de apuntarla en un almacén que
 * tuviera varias, y la petición se quedaba pidiendo desempatar algo que ya
 * venía sin ambigüedad.
 */
describe('Edición del agente: el servicio se busca exacto primero', () => {
  const VARIAS = [
    { scheduleId: 'cap-s', nombre: 'Picking S', typeOfService: 'S' },
    { scheduleId: 'cap-st', nombre: 'Picking ST', typeOfService: 'ST' },
    { scheduleId: 'cap-sd', nombre: 'Picking SD', typeOfService: 'SD' },
  ];

  it('"S" es la S, no las tres que empiezan por S', async () => {
    const { servicio, actualizarPicking } = armar({ agendas: VARIAS });

    const r = await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'S', activa: false }),
    );

    expect(r.agendas[0].agenda).toBe('S - Picking S');
    expect(actualizarPicking).toHaveBeenCalledOnce();
    expect(actualizarPicking.mock.calls[0][0]).toBe('cap-s');
  });

  it('y sigue valiendo buscar por parte del nombre', async () => {
    const { servicio } = armar({ agendas: VARIAS });

    const r = await servicio.editarCapacidad(
      USUARIO,
      editar({ servicio: 'SD', agenda: 'Picking SD', activa: false }),
    );

    expect(r.agendas[0].agenda).toBe('SD - Picking SD');
  });
});
