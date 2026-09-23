import { describe, expect, it, vi } from 'vitest';
import type { OplService } from '../../configuracion/tipo-servicio/opl/opl.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import type { ContextoAgenteService } from '../contexto.service.js';
import { TipoServicioAgenteService } from './tipo-servicio.service.js';

/**
 * Consultar los servicios de un OPL.
 *
 * Lo que se vigila es lo que la respuesta **omitía**: el máximo de ocurrencias
 * y los días de holgura venían en la respuesta de Ripley y se perdían al
 * compactar. No son campos internos ni identificadores: son parte de la
 * configuración por la que se pregunta, y faltaban sin que nada lo dijera.
 */

const USUARIO = { id: 'u1', email: 'ana@ripley.com.pe' } as UsuarioAutenticado;

const SERVICIO = {
  idServicio: '62b380e68a5c61001213be68',
  code: 'S',
  descripcion: '07:00 a 22:00 hrs',
  isActive: false,
  enabledForCheckout: false,
  maxOcurrence: 15,
  slackDays: 1,
  cortes: [
    { id: 1, label: 'Lu', value: '21:00' },
    { id: 6, label: 'Sa', value: '17:00' },
  ],
};

function armar(servicios: Array<Record<string, unknown>> = [SERVICIO]) {
  const buscarOpl = vi.fn().mockResolvedValue({
    opls: [{ id: 'o-1', code: '1088', nombre: 'Courier Paquetería' }],
  });

  const opl = {
    buscarOpl,
    listarZonas: vi
      .fn()
      .mockResolvedValue([{ mainZone: 'z-1', nombre: 'Zona 4' }]),
    listarAgendas: vi
      .fn()
      .mockResolvedValue([{ mainSchedule: 'a-1', nombre: 'Zona 4' }]),
    listarServicios: vi.fn().mockResolvedValue({ servicios }),
  } as unknown as OplService;

  const contexto = {
    armar: vi.fn().mockResolvedValue({ pais: 'CL' }),
  } as unknown as ContextoAgenteService;

  return {
    servicio: new TipoServicioAgenteService(opl, contexto),
    buscarOpl,
  };
}

const consultar = (extra: Record<string, unknown> = {}) =>
  ({ opl: '1088', ...extra }) as never;

describe('Consultar tipos de servicio: lo que devuelve', () => {
  it('incluye el máximo de ocurrencias y los días de holgura', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(USUARIO, consultar());

    expect(r.servicios[0].maxOcurrencia).toBe(15);
    expect(r.servicios[0].diasHolgura).toBe(1);
  });

  it('los admite como cadena, que es como los manda a veces la API', async () => {
    const { servicio } = armar([
      { ...SERVICIO, maxOcurrence: '15', slackDays: '1' },
    ]);

    const r = await servicio.consultar(USUARIO, consultar());

    expect(r.servicios[0].maxOcurrencia).toBe(15);
    expect(r.servicios[0].diasHolgura).toBe(1);
  });

  /**
   * Un cero es una configuración válida y distinta de "no está configurado".
   * Devolver `0` para lo segundo haría que se leyeran igual.
   */
  it('un cero se conserva, y lo ausente es null', async () => {
    const { servicio } = armar([
      { ...SERVICIO, maxOcurrence: 0, slackDays: null },
    ]);

    const r = await servicio.consultar(USUARIO, consultar());

    expect(r.servicios[0].maxOcurrencia).toBe(0);
    expect(r.servicios[0].diasHolgura).toBeNull();
  });

  it('sigue trayendo el resto de la configuración', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(USUARIO, consultar());

    expect(r.servicios[0]).toMatchObject({
      code: 'S',
      activo: false,
      enCheckout: false,
    });
    // El día va como lo manda Ripley en "label", sin reescribirlo
    expect(r.servicios[0].cortes).toEqual(['Lu 21:00', 'Sa 17:00']);
  });
});

describe('Consultar tipos de servicio: el alias del operador', () => {
  it('"90 min" se busca como el 1130', async () => {
    const { servicio, buscarOpl } = armar();

    await servicio.consultar(USUARIO, consultar({ opl: '90 min' }));

    expect(buscarOpl).toHaveBeenCalledWith('1130', 'CL');
  });

  it('"90 minutos" también', async () => {
    const { servicio, buscarOpl } = armar();

    await servicio.consultar(USUARIO, consultar({ opl: '90 minutos' }));

    expect(buscarOpl).toHaveBeenCalledWith('1130', 'CL');
  });

  it('un código normal se busca tal cual', async () => {
    const { servicio, buscarOpl } = armar();

    await servicio.consultar(USUARIO, consultar({ opl: '1088' }));

    expect(buscarOpl).toHaveBeenCalledWith('1088', 'CL');
  });
});
