import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TransfService } from '../../configuracion/transf-suc/transf.service.js';
import type { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import type { ContextoAgenteService } from '../contexto.service.js';
import { EditarTransferenciaAgenteService } from './transferencia.service.js';

/**
 * La dirección y los días son lo que se equivoca aquí.
 *
 * La relación cuelga del origen —de dónde SALE el stock—, y el agente la
 * invertía al consultar. Invertirla al escribir sería cambiar la relación de
 * otro par de almacenes.
 *
 * Y los días: "los días de transferencia son lunes y martes" quiere decir que
 * los demás no. Mandar solo los dos nombrados dejaría encendidos los que ya
 * estaban, que es lo contrario de lo que se pidió.
 */

const USUARIO = { id: 'u1', email: 'ana@ripley.com.pe' } as UsuarioAutenticado;

const SEMANA = {
  monday: true,
  tuesday: true,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
};

const RELACIONES = [
  {
    relacionId: 'r-1',
    destino: '20021 - Chorrillos',
    canTransfer: true,
    transferPeriod: 2,
    preTransferPeriod: 1,
    availableDays: SEMANA,
  },
  {
    relacionId: 'r-2',
    destino: '1121 - Suc. Chorrillos',
    canTransfer: false,
    transferPeriod: 0,
    preTransferPeriod: 0,
    availableDays: SEMANA,
  },
];

function armar(relaciones = RELACIONES) {
  const actualizarRelacion = vi.fn().mockResolvedValue({ ok: true });

  const transf = {
    buscarAlmacen: vi.fn().mockResolvedValue({
      almacenes: [{ id: 'w-1', code: '20026', nombre: 'CD Villa El Salvador' }],
    }),
    listarRelaciones: vi.fn().mockResolvedValue({ relaciones }),
    actualizarRelacion,
  } as unknown as TransfService;

  const contexto = {
    armar: vi.fn().mockResolvedValue({ pais: 'PE' }),
  } as unknown as ContextoAgenteService;

  const registrarCambio = vi.fn();

  return {
    servicio: new EditarTransferenciaAgenteService(transf, contexto, {
      registrarCambio,
    } as unknown as ContextoAuditoria),
    actualizarRelacion,
    registrarCambio,
  };
}

const editar = (extra: Record<string, unknown>) =>
  ({ origen: '20026', destino: '20021', ...extra }) as never;

describe('Editar una transferencia: lo que sí cambia', () => {
  it('habilita la relación sin tocar los días ni los períodos', async () => {
    const { servicio, actualizarRelacion } = armar();

    await servicio.editar(
      USUARIO,
      editar({ destino: '1121', habilitada: true }),
    );

    expect(actualizarRelacion).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouseId: 'w-1',
        relacionId: 'r-2',
        canTransfer: true,
        transferPeriod: undefined,
        preTransferPeriod: undefined,
        availableDays: undefined,
      }),
    );
  });

  it('cambia los períodos y devuelve el desfase ya sumado', async () => {
    const { servicio } = armar();

    // Estaba en 1 + 2 = 3; se pide 2 + 4
    const r = await servicio.editar(
      USUARIO,
      editar({ preparacion: 2, transito: 4 }),
    );

    expect(r.antes.desfase).toBe(3);
    expect(r.origen).toBe('20026 - CD Villa El Salvador');
    expect(r.destino).toBe('20021 - Chorrillos');
  });

  it('fija los días nombrados y apaga el resto', async () => {
    // "los días son jueves y viernes" quiere decir que los demás no
    const { servicio, actualizarRelacion } = armar();

    await servicio.editar(USUARIO, editar({ dias: 'jueves, viernes' }));

    expect(actualizarRelacion).toHaveBeenCalledWith(
      expect.objectContaining({
        availableDays: {
          monday: false,
          tuesday: false,
          wednesday: false,
          thursday: true,
          friday: true,
          saturday: false,
          sunday: false,
        },
      }),
    );
  });

  it('entiende "todos" y "ninguno"', async () => {
    const { servicio, actualizarRelacion } = armar();

    await servicio.editar(USUARIO, editar({ dias: 'todos' }));
    expect(actualizarRelacion.mock.calls[0][0].availableDays).toEqual(
      expect.objectContaining({ monday: true, sunday: true }),
    );

    const otro = armar();
    await otro.servicio.editar(USUARIO, editar({ dias: 'ninguno' }));
    expect(otro.actualizarRelacion.mock.calls[0][0].availableDays).toEqual(
      expect.objectContaining({ monday: false, sunday: false }),
    );
  });

  it('admite los días con tilde y sin ella', async () => {
    const { servicio, actualizarRelacion } = armar();

    await servicio.editar(USUARIO, editar({ dias: 'miercoles, sábado' }));

    expect(actualizarRelacion.mock.calls[0][0].availableDays).toEqual(
      expect.objectContaining({ wednesday: true, saturday: true }),
    );
  });
});

describe('Editar una transferencia: cuándo se niega', () => {
  it('si no se pide ningún cambio', async () => {
    const { servicio, actualizarRelacion } = armar();

    await expect(servicio.editar(USUARIO, editar({}))).rejects.toThrow(
      /nada que cambiar/,
    );
    expect(actualizarRelacion).not.toHaveBeenCalled();
  });

  it('si el destino coincide con varios y no se dio el código', async () => {
    // "Chorrillos" está en los dos destinos, y son sitios distintos
    const { servicio, actualizarRelacion } = armar();

    await expect(
      servicio.editar(
        USUARIO,
        editar({ destino: 'Chorrillos', habilitada: false }),
      ),
    ).rejects.toThrow(/coincide con 2 destinos/);

    expect(actualizarRelacion).not.toHaveBeenCalled();
  });

  it('pero el código exacto desempata', async () => {
    const { servicio, actualizarRelacion } = armar();

    await servicio.editar(USUARIO, editar({ destino: '20021', transito: 5 }));

    expect(actualizarRelacion.mock.calls[0][0].relacionId).toBe('r-1');
  });

  it('si la relación no existe, y lo distingue de estar deshabilitada', async () => {
    const { servicio } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ destino: '99999', habilitada: true })),
    ).rejects.toThrow(/la relación no existe/);
  });

  it('si el día no se reconoce', async () => {
    const { servicio, actualizarRelacion } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ dias: 'lunes, lunez' })),
    ).rejects.toThrow(/No reconozco el día "lunez"/);

    expect(actualizarRelacion).not.toHaveBeenCalled();
  });

  it('si ya estaba exactamente así', async () => {
    const { servicio, actualizarRelacion } = armar();

    await expect(
      servicio.editar(
        USUARIO,
        editar({ habilitada: true, preparacion: 1, transito: 2 }),
      ),
    ).rejects.toThrow(/ya está así/);

    expect(actualizarRelacion).not.toHaveBeenCalled();
  });

  it('y los días iguales tampoco cuentan como cambio', async () => {
    const { servicio } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ dias: 'lunes, martes' })),
    ).rejects.toThrow(/ya está así/);
  });
});

describe('Editar una transferencia: el historial', () => {
  it('guarda el antes y el después de la relación', async () => {
    const { servicio, registrarCambio } = armar();

    await servicio.editar(USUARIO, editar({ transito: 5 }));

    const [antes, despues] = registrarCambio.mock.calls[0];

    expect(antes).toEqual(
      expect.objectContaining({ destino: '20021 - Chorrillos', transito: 2 }),
    );
    expect(despues).toEqual(
      expect.objectContaining({ destino: '20021 - Chorrillos' }),
    );
  });
});

describe('Editar una transferencia: tipos de error', () => {
  it('un destino ambiguo es 400 y uno inexistente es 404', async () => {
    const { servicio } = armar();

    await expect(
      servicio.editar(
        USUARIO,
        editar({ destino: 'Chorrillos', habilitada: false }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      servicio.editar(USUARIO, editar({ destino: 'nada', habilitada: false })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
