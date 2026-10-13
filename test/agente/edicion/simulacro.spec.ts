import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ContextoAgenteService } from '../../../src/agente/contexto.service.js';
import { EditarTipoServicioAgenteService } from '../../../src/agente/edicion/tipo-servicio/tipo-servicio.service.js';
import { EditarTransferenciaAgenteService } from '../../../src/agente/edicion/transferencia/transferencia.service.js';
import { ContextoAuditoria } from '../../../src/auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../../src/auth/interfaces/auth.interface.js';
import type { CacheCatalogosService } from '../../../src/common/ripley/cache-catalogos.service.js';
import type { CatalogosRipleyService } from '../../../src/common/ripley/catalogos.service.js';
import { RipleyHttpService } from '../../../src/common/ripley/ripley-http.service.js';
import { OplService } from '../../../src/configuracion/tipo-servicio/opl/opl.service.js';
import type { TokenRipleyService } from '../../../src/configuracion/token-ripley/token-ripley.service.js';
import { TransfService } from '../../../src/configuracion/transf-suc/transf.service.js';
import { almacenesDePrueba } from '../../fixtures/almacenes.js';

/**
 * El "después" de una edición del agente, en un simulacro.
 *
 * Dos ediciones releen Ripley después de escribir, para contar lo que quedó y
 * no lo que se pidió: los tipos de servicio y las transferencias. En un
 * simulacro esa relectura diría el estado de antes —nada llegó a Ripley— y el
 * agente contaría que no cambió nada. Así que ahí el "después" sale de lo que
 * se habría guardado.
 *
 * Se monta la cadena real —la edición del agente, el service de configuración
 * y el cliente de Ripley— sobre un HTTP falso, porque lo que se vigila es
 * justo cómo encajan: que el cliente corte la escritura, que el service arme
 * lo que Ripley habría devuelto y que la edición lo use.
 */

const USUARIO = { id: 'u1', email: 'ana@ejemplo.com' } as UsuarioAutenticado;

const SEMANA = { monday: true, tuesday: true, wednesday: false, thursday: false, friday: false, saturday: false, sunday: false };

/** El documento de relaciones del 20026, como lo devuelve Ripley */
const DOCUMENTO = {
  id: 'doc-1',
  warehouse: 'w-1',
  relationships: [
    { _id: 'r-1', courier: 'c-1', label: '20021 - Chorrillos', canTransfer: false, transferPeriod: 2, preTransferPeriod: 1, availableDays: SEMANA },
  ],
};

/** Los servicios de la agenda del 1130, como los devuelve Ripley */
const SERVICIOS = {
  typeOfServices: [
    {
      id: 's-sd', code: 'SD', label: 'SD', description: 'Despacho a domicilio',
      isActive: true, enabledForCheckout: true, maxOcurrence: '0', slackDays: '1',
      cutTime: [{ id: 1, label: 'Lunes', value: '23:30' }, { id: 4, label: 'Jueves', value: '23:30' }],
      channelSale: [],
    },
  ],
};

/** El cliente de Ripley de verdad, sobre un HTTP que responde según la ruta */
function cadena() {
  const contexto = new ContextoAuditoria();

  const responder = (url: string) => {
    if (url.endsWith('/officeRelationship')) return DOCUMENTO;
    if (url.endsWith('/mainzones')) return { rows: [{ id: 'z-1', name: 'Lima Centro' }] };
    if (url.endsWith('/mainschedules')) return { rows: [{ id: 'a-1', name: 'Agenda DT', mainZone: 'z-1', courier: 'o-1' }] };
    if (url.endsWith('/listTypeServices')) return SERVICIOS;
    return {};
  };

  const http = {
    get: vi.fn((url: string) => of({ data: responder(url) })),
    post: vi.fn((url: string) => of({ data: responder(url) })),
    put: vi.fn(() => of({ data: { ok: true } })),
  };

  const config = {
    get: (clave: string) => (clave === 'ripley.urls' ? { PE: 'https://interno' } : `/${clave.split('.').pop()}`),
  } as unknown as ConfigService;

  const ripley = new RipleyHttpService(
    http as unknown as HttpService,
    config,
    contexto,
    { obtenerParaUso: vi.fn().mockResolvedValue('token') } as unknown as TokenRipleyService,
    { olvidar: vi.fn() } as unknown as CacheCatalogosService,
  );

  const catalogos = {
    oficinasConTotal: vi.fn(async (_pais: string, filtro: { tipo?: string }) => ({
      total: 1,
      filas: [filtro.tipo === 'almacen' ? { id: 'w-1', code: '20026', name: 'CD Villa El Salvador' } : { id: 'o-1', code: '1130', name: 'Olva' }],
    })),
  } as unknown as CatalogosRipleyService;

  const agente = { armar: vi.fn().mockResolvedValue({ pais: 'PE' }) } as unknown as ContextoAgenteService;

  const transferencias = new EditarTransferenciaAgenteService(new TransfService(ripley, catalogos, contexto), agente, contexto, almacenesDePrueba());
  const tiposDeServicio = new EditarTipoServicioAgenteService(new OplService(ripley, catalogos, contexto), agente, contexto, { leer: vi.fn() } as never);

  /** Como una petición: con su usuario y, si se pide, en simulacro */
  const peticion = <T>(fn: () => Promise<T>, simulacro: boolean) =>
    contexto.ejecutar(async () => {
      contexto.identificarUsuario(USUARIO.id, USUARIO.email);
      const resultado = await fn();
      return { resultado, evitadas: contexto.escriturasEvitadas().length };
    }, { simulacro });

  return { http, transferencias, tiposDeServicio, peticion };
}

describe('Una transferencia, en simulacro', () => {
  const habilitar = { origen: '20026', destino: '20021', habilitada: true, transito: 3 } as never;

  it('no escribe, y el "después" es como quedaría', async () => {
    const { http, transferencias, peticion } = cadena();

    const { resultado, evitadas } = await peticion(() => transferencias.editar(USUARIO, habilitar), true);

    expect(http.put).not.toHaveBeenCalled();
    expect(evitadas).toBe(1);
    expect(resultado.destinos[0].antes).toMatchObject({ habilitada: false, transito: 2, desfase: 3 });
    expect(resultado.destinos[0].despues).toMatchObject({ habilitada: true, transito: 3, desfase: 4 });
  });

  it('y no relee: Ripley diría lo de antes', async () => {
    const { http, transferencias, peticion } = cadena();

    await peticion(() => transferencias.editar(USUARIO, habilitar), true);

    // Una lectura para resolver el destino y otra del service para armar el
    // guardado; la tercera, la relectura, es la que sobra en un simulacro
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('sin simulacro, escribe y relee como siempre', async () => {
    const { http, transferencias, peticion } = cadena();

    const { evitadas } = await peticion(() => transferencias.editar(USUARIO, habilitar), false);

    expect(http.put).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledTimes(3);
    expect(evitadas).toBe(0);
  });
});

describe('Un tipo de servicio, en simulacro', () => {
  const editar = (extra: Record<string, unknown>) => ({ opl: '1130', servicio: 'SD', ...extra }) as never;

  it('no escribe, y el "después" es como quedaría, con sus reglas: desactivar lo saca del checkout', async () => {
    const { http, tiposDeServicio, peticion } = cadena();

    const { resultado, evitadas } = await peticion(() => tiposDeServicio.editar(USUARIO, editar({ activo: false })), true);

    expect(http.put).not.toHaveBeenCalled();
    expect(evitadas).toBe(1);
    expect(resultado.servicios[0].antes).toMatchObject({ activo: true, enCheckout: true });
    expect(resultado.servicios[0].despues).toMatchObject({ activo: false, enCheckout: false });
  });

  it('una hora de corte cambia solo su día', async () => {
    const { tiposDeServicio, peticion } = cadena();

    const { resultado } = await peticion(() => tiposDeServicio.editar(USUARIO, editar({ dia: 'jueves', corte: '17:00' })), true);

    expect(resultado.servicios[0].despues?.cortes).toEqual(['Lunes 23:30', 'Jueves 17:00']);
  });

  it('la lista de servicios es un POST que lee: va a Ripley igual, pero no se relee', async () => {
    const { http, tiposDeServicio, peticion } = cadena();

    await peticion(() => tiposDeServicio.editar(USUARIO, editar({ activo: false })), true);

    // La consulta de la edición y la del service al armar el guardado
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it('sin simulacro, escribe y relee como siempre', async () => {
    const { http, tiposDeServicio, peticion } = cadena();

    await peticion(() => tiposDeServicio.editar(USUARIO, editar({ activo: false })), false);

    expect(http.put).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledTimes(3);
  });
});
