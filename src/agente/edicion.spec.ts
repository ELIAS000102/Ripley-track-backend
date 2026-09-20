import {
  BadRequestException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EditarCapacidadDto } from './dto/consultas-agente.dto.js';
import type { DespachoService } from '../agendas/despacho/despacho.service.js';
import type { PickingService } from '../agendas/picking/picking.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { hoyEnPais, sumarDias } from '../common/ripley/utils/date.util.js';
import type { ContextoAgenteService } from './contexto.service.js';
import { EdicionAgenteService } from './edicion.service.js';

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
    obtener: vi.fn().mockResolvedValue({
      capacityByDayArray: opciones.dias ?? [diaPicking(MANANA)],
    }),
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

  return {
    servicio: new EdicionAgenteService(picking, despacho, contexto),
    actualizarPicking,
    actualizarDespacho,
  };
}

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

    expect(r.antes.asignado).toBe(1688);
    expect(r.despues.asignado).toBe(1800);
    // El ocupado no lo toca nadie desde aquí
    expect(r.despues.ocupado).toBe(1282);
    expect(r.despues.disponible).toBe(518);
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

    expect(r.zona).toBe('Lima Centro');
    // "500" llega como texto desde Ripley y sale como número
    expect(r.antes.asignado).toBe(500);
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
      /ya está así/,
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

  it('los textos vacíos no cuentan como filtro', async () => {
    const dto = await validar(comoN8n({ activa: 'true' }));

    // Un servicio '' es falsy y el service lo trata como "no indicado", que es
    // lo que hace saltar la regla de "hay varias agendas, elige tú"
    expect(dto.servicio).toBe('');
    expect(dto.zona).toBe('');
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
