import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BusquedaMasivaAgenteService } from './busqueda-masiva.service.js';
import type { OplMasivoService } from '../../configuracion/tipo-servicio/opl-masivo/opl-masivo.service.js';
import type { ContextoAgenteService } from '../contexto.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';

/**
 * El agente manda el tipo de servicio y nada más: el método de entrega es una
 * regla de negocio que se resuelve aquí.
 *
 * Lo que se vigila es que se resuelva **bien**. Equivocar el método no da un
 * error: da una lista vacía o, peor, las agendas del otro método, y eso no se
 * ve mirando la respuesta.
 */

const CATALOGO = [
  {
    code: 'RT',
    nombre: 'Retiro en tienda',
    servicios: [
      {
        code: 'SE',
        nombre: 'Retiro express',
        isActive: true,
        enabledForCheckout: true,
      },
      {
        code: 'ST',
        nombre: 'Retiro en tienda',
        isActive: true,
        enabledForCheckout: true,
      },
    ],
  },
  {
    code: 'DP',
    nombre: 'Despacho a domicilio',
    servicios: [
      {
        code: 'SD',
        nombre: 'Despacho a domicilio',
        isActive: true,
        enabledForCheckout: true,
      },
      {
        code: 'S',
        nombre: 'Despacho normal',
        isActive: true,
        enabledForCheckout: true,
      },
      {
        code: 'NV',
        nombre: 'Servicio nuevo sin tabla',
        isActive: true,
        enabledForCheckout: true,
      },
    ],
  },
];

const USUARIO = { id: 'u1' } as UsuarioAutenticado;

function armar() {
  const consultar = vi.fn().mockResolvedValue({ total: 0, agendas: [] });

  const masivo = {
    listarMetodosEntrega: vi.fn().mockResolvedValue(CATALOGO),
    listarOrigenes: vi
      .fn()
      .mockResolvedValue([{ code: '20026', nombre: 'CD VES' }]),
    consultar,
  } as unknown as OplMasivoService;

  const contexto = {
    armar: vi.fn().mockResolvedValue({ pais: 'PE' }),
  } as unknown as ContextoAgenteService;

  return {
    servicio: new BusquedaMasivaAgenteService(masivo, contexto),
    consultar,
  };
}

/** Con qué deliveryCode se acabó llamando al catálogo de abajo */
async function metodoUsado(dto: Record<string, unknown>) {
  const { servicio, consultar } = armar();
  const respuesta = await servicio.buscar(USUARIO, dto as never);

  expect(consultar).toHaveBeenCalledOnce();
  const llamada = consultar.mock.calls[0][0] as { deliveryCode: string };

  // El método resuelto viaja también en la respuesta, para que el agente
  // pueda mostrarlo sin deducirlo él
  expect(respuesta.metodo).toBe(llamada.deliveryCode);
  return llamada.deliveryCode;
}

describe('Búsqueda masiva: el método se deduce del servicio', () => {
  it('deduce RT para un servicio de retiro', async () => {
    expect(await metodoUsado({ servicio: 'SE' })).toBe('RT');
  });

  it('deduce DP para un servicio de despacho', async () => {
    expect(await metodoUsado({ servicio: 'SD' })).toBe('DP');
  });

  it('no confunde un código de una letra con un nombre que la contenga', async () => {
    // "S" aparece dentro de "Retiro express"; buscar por nombre primero
    // devolvería RT y las agendas equivocadas
    expect(await metodoUsado({ servicio: 'S' })).toBe('DP');
  });

  it('admite el servicio en minúsculas y con espacios', async () => {
    expect(await metodoUsado({ servicio: '  se  ' })).toBe('RT');
  });

  it('encuentra en el catálogo un servicio que la tabla no conoce', async () => {
    expect(await metodoUsado({ servicio: 'NV' })).toBe('DP');
  });

  it('admite la descripción en vez del código', async () => {
    expect(await metodoUsado({ servicio: 'retiro express' })).toBe('RT');
  });

  it('respeta el método si de todas formas se lo mandan', async () => {
    expect(await metodoUsado({ servicio: 'ST', metodo: 'RT' })).toBe('RT');
  });

  it('explica qué servicios hay cuando ninguno coincide', async () => {
    const { servicio } = armar();

    await expect(
      servicio.buscar(USUARIO, { servicio: 'ZZ' } as never),
    ).rejects.toThrow(NotFoundException);

    await expect(
      servicio.buscar(USUARIO, { servicio: 'ZZ' } as never),
    ).rejects.toThrow(/SE\/ST/);
  });
});
