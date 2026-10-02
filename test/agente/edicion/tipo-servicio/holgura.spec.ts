import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../../../src/auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../../../src/auth/interfaces/auth.interface.js';
import type { OplService } from '../../../../src/configuracion/tipo-servicio/opl/opl.service.js';
import type { ContextoAgenteService } from '../../../../src/agente/contexto.service.js';
import { EditarTipoServicioDto } from '../../../../src/agente/dto/edicion.dto.js';
import { EditarTipoServicioAgenteService } from '../../../../src/agente/edicion/tipo-servicio/tipo-servicio.service.js';

/**
 * Los días de holgura y el máximo de ocurrencias, desde el chat.
 *
 * Se consultaban y no se podían cambiar: el agente contestaba que eso se hace
 * en el panel, obligando a abrir otra pantalla para mover un número que ya se
 * estaba mirando. El backend sabía guardarlos desde el principio —el apartado
 * de servicios por OPL los escribe—; lo que faltaba era la superficie del
 * agente.
 */

const USUARIO = { id: 'u1', email: 'jose@ripley.com.pe' } as UsuarioAutenticado;

/** El servicio S de la 1088, con los valores de la pantalla */
const SERVICIOS = [
  {
    idServicio: 's-s',
    code: 'S',
    descripcion: '9 a 21 hrs',
    isActive: false,
    enabledForCheckout: false,
    slackDays: 1,
    maxOcurrence: 10,
    cortes: [{ id: 1, label: 'Lunes', value: '23:59' }],
  },
];

function armar(servicios = SERVICIOS) {
  const actualizarServicio = vi.fn().mockResolvedValue({ ok: true });

  const opl = {
    buscarOpl: vi.fn().mockResolvedValue({
      opls: [{ id: 'o-1', code: '1088', nombre: 'Courier Paquetería' }],
    }),
    listarZonas: vi.fn().mockResolvedValue([{ mainZone: 'z-4', nombre: 'Zona 4' }]),
    listarAgendas: vi
      .fn()
      .mockResolvedValue([{ mainSchedule: 'a-1', nombre: 'Agenda Zona 4' }]),
    listarServicios: vi.fn().mockResolvedValue({ servicios }),
    actualizarServicio,
  } as unknown as OplService;

  const contexto = {
    armar: vi.fn().mockResolvedValue({ pais: 'CL' }),
  } as unknown as ContextoAgenteService;

  return {
    servicio: new EditarTipoServicioAgenteService(opl, contexto, {
      registrarCambio: vi.fn(),
    } as unknown as ContextoAuditoria),
    actualizarServicio,
  };
}

const pedir = (extra: Record<string, unknown>) =>
  ({ opl: '1088', servicio: 'S', pais: 'CL', ...extra }) as never;

describe('Cambiar la holgura', () => {
  it('se escribe, que es lo que no se podía', async () => {
    const { servicio, actualizarServicio } = armar();

    await servicio.editar(USUARIO, pedir({ diasHolgura: 2 }));

    expect(actualizarServicio).toHaveBeenCalledWith(
      's-s',
      expect.objectContaining({ slackDays: 2 }),
    );
  });

  it('y el máximo de ocurrencias igual', async () => {
    const { servicio, actualizarServicio } = armar();

    await servicio.editar(USUARIO, pedir({ maxOcurrencia: 15 }));

    expect(actualizarServicio).toHaveBeenCalledWith(
      's-s',
      expect.objectContaining({ maxOcurrence: 15 }),
    );
  });

  it('cambiar la holgura NO toca el estado ni el checkout', async () => {
    const { servicio, actualizarServicio } = armar();

    await servicio.editar(USUARIO, pedir({ diasHolgura: 2 }));

    // Lo que no se manda, el service de abajo lo conserva. Si aquí saliera
    // `isActive: false` se estaría apagando un servicio que nadie mencionó
    const payload = actualizarServicio.mock.calls[0][1];
    expect(payload.isActive).toBeUndefined();
    expect(payload.enabledForCheckout).toBeUndefined();
  });

  it('desactivar tampoco toca la holgura', async () => {
    // Uno que SÍ está activo: desactivar el que ya estaba apagado no cambia
    // nada y el service lo rechaza, que es otra cosa
    const { servicio, actualizarServicio } = armar([
      { ...SERVICIOS[0], isActive: true, enabledForCheckout: true },
    ]);

    // Desactivar apaga el checkout —eso sí se contagia— pero no la holgura:
    // son configuración, no estado
    await servicio.editar(USUARIO, pedir({ activo: false }));

    const payload = actualizarServicio.mock.calls[0][1];
    expect(payload.enabledForCheckout).toBe(false);
    expect(payload.slackDays).toBeUndefined();
    expect(payload.maxOcurrence).toBeUndefined();
  });

  it('pedir el valor que ya tiene no escribe, y lo dice', async () => {
    const { servicio, actualizarServicio } = armar();

    await expect(
      servicio.editar(USUARIO, pedir({ diasHolgura: 1 })),
    ).rejects.toThrow(/Ya estaba así/);

    expect(actualizarServicio).not.toHaveBeenCalled();
  });

  it('un 0 sí es un cambio cuando antes había 1', async () => {
    const { servicio, actualizarServicio } = armar();

    await servicio.editar(USUARIO, pedir({ diasHolgura: 0 }));

    expect(actualizarServicio).toHaveBeenCalledWith(
      's-s',
      expect.objectContaining({ slackDays: 0 }),
    );
  });

  it('el número viene como texto de Ripley y se compara igual', async () => {
    // Llega "1" en vez de 1 según el endpoint; sin normalizar, pedir 1 se
    // vería como un cambio y escribiría por nada
    const { servicio, actualizarServicio } = armar([
      { ...SERVICIOS[0], slackDays: '1' as unknown as number },
    ]);

    await expect(
      servicio.editar(USUARIO, pedir({ diasHolgura: 1 })),
    ).rejects.toThrow(/Ya estaba así/);

    expect(actualizarServicio).not.toHaveBeenCalled();
  });
});

describe('El antes y el después los enseñan', () => {
  it('los dos números salen en el resultado', async () => {
    const { servicio } = armar();

    const r = await servicio.editar(USUARIO, pedir({ diasHolgura: 2 }));

    expect(r.servicios[0].antes).toMatchObject({
      diasHolgura: 1,
      maxOcurrencia: 10,
    });
    expect(r.servicios[0].despues).toMatchObject({
      diasHolgura: 1,
      maxOcurrencia: 10,
    });
  });
});

describe('Lo que el DTO no deja pasar', () => {
  const validar = async (cuerpo: Record<string, unknown>) => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });

    try {
      await pipe.transform(
        { opl: '1088', servicio: 'S', ...cuerpo },
        { type: 'body', metatype: EditarTipoServicioDto },
      );
      return null;
    } catch (e) {
      return JSON.stringify((e as { response?: unknown }).response);
    }
  };

  it('una holgura negativa', async () => {
    expect(await validar({ diasHolgura: -1 })).toContain('diasHolgura');
  });

  it('una holgura absurda: es un dedazo, no una decisión', async () => {
    expect(await validar({ diasHolgura: 900 })).toContain('diasHolgura');
  });

  it('un decimal', async () => {
    expect(await validar({ diasHolgura: 1.5 })).toContain('diasHolgura');
  });

  it('pero el vacío que manda n8n no es un error: es "no lo indico"', async () => {
    expect(await validar({ diasHolgura: '', maxOcurrencia: '', activo: 'false' }))
      .toBeNull();
  });

  it('y un número en texto se convierte, que es como viaja desde el chat', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });

    const dto = (await pipe.transform(
      { opl: '1088', servicio: 'S', diasHolgura: '2' },
      { type: 'body', metatype: EditarTipoServicioDto },
    )) as EditarTipoServicioDto;

    expect(dto.diasHolgura).toBe(2);
  });

  it('sin nada que cambiar, lo dice y nombra los campos', async () => {
    const { servicio } = armar();

    await expect(servicio.editar(USUARIO, pedir({}))).rejects.toThrow(
      /diasHolgura/,
    );
  });
});
