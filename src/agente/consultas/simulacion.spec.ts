import { describe, expect, it, vi } from 'vitest';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import type { SimulacionService } from '../../simulacion/simulacion.service.js';
import type { ContextoAgenteService } from '../contexto.service.js';
import { SimulacionAgenteService } from './simulacion.service.js';
import { SKU_POR_DEFECTO } from '../constantes/simulacion.constants.js';

/**
 * La simulación del agente, después de sacarle las listas de OPL.
 *
 * Aquí vivían dos listas escritas en el código: los cinco operadores de
 * despacho y las once tiendas de retiro, con el destino de cada uno. "Simula
 * SD" a secas las disparaba. Se fueron a las preconfiguraciones, así que lo que
 * se fija aquí es lo que cambió: que ya no se adivina nada, y que lo que sí es
 * un valor por defecto —el SKU, el punto de entrega— sigue funcionando.
 */

const USUARIO = { id: 'u1', email: 'jose@ripley.com.pe' } as UsuarioAutenticado;

function armar() {
  const simular = vi.fn().mockResolvedValue({
    resultados: [{ fecha: '2026-10-01' }],
  });

  const simulacion = {
    simular,
    buscarAlmacenes: vi.fn().mockResolvedValue([]),
    buscarOpl: vi
      .fn()
      .mockResolvedValue([{ id: 'o1', code: '1111', nombre: 'San Borja' }]),
    // El servicio compara con String(p.sku), no con un `code`
    buscarSku: vi
      .fn()
      .mockResolvedValue([{ sku: SKU_POR_DEFECTO, nombre: 'Producto' }]),
    listarRegiones: vi.fn().mockResolvedValue([{ id: 'r1', nombre: 'Lima' }]),
    listarDistritosDeRegion: vi.fn().mockResolvedValue([
      { id: 'c1', nombre: 'San Borja', provincia: 'Lima' },
      { id: 'c2', nombre: 'Chorrillos', provincia: 'Lima' },
      { id: 'c3', nombre: 'Lima', provincia: 'Lima' },
    ]),
  } as unknown as SimulacionService;

  const contexto = {
    armar: vi.fn().mockResolvedValue({ pais: 'PE' }),
  } as unknown as ContextoAgenteService;

  const servicio = new SimulacionAgenteService(simulacion, contexto);

  return { servicio, simular, simulacion };
}

/** Lo mínimo que hace falta para que la simulación llegue a Ripley */
const pedir = (extra: Record<string, unknown> = {}) => ({
  pais: 'PE',
  region: 'Lima',
  provincia: 'Lima',
  distrito: 'San Borja',
  ...extra,
});

describe('Sin operador ya no se adivina la lista de siempre', () => {
  it('lo dice, y dice cómo pedir la revisión de siempre', async () => {
    const { servicio } = armar();

    await expect(
      // Antes esto disparaba los cinco OPL de despacho escritos en el código
      servicio.simular(USUARIO, pedir({ servicio: 'SD' }) as never),
    ).rejects.toThrow(/ejecuta la Simulación SD/);
  });

  it('tampoco con SE', async () => {
    const { servicio } = armar();

    await expect(
      servicio.simular(USUARIO, pedir({ servicio: 'SE' }) as never),
    ).rejects.toThrow(/operador logístico o la tienda/);
  });

  it('con operador funciona, y va una sola vez', async () => {
    const { servicio, simular } = armar();

    await servicio.simular(
      USUARIO,
      pedir({ servicio: 'SD', operador: '1111' }) as never,
    );

    expect(simular).toHaveBeenCalledTimes(1);
  });

  it('varios operadores por coma siguen siendo una sola consulta', async () => {
    const { servicio, simular } = armar();

    await servicio.simular(
      USUARIO,
      pedir({ servicio: 'SD', operador: '1111, 1110, 1112' }) as never,
    );

    expect(simular).toHaveBeenCalledTimes(3);
  });
});

describe('Lo que sigue siendo un valor por defecto', () => {
  it('el SKU de referencia, cuando no se aporta uno', async () => {
    const { servicio, simulacion } = armar();

    await servicio.simular(
      USUARIO,
      pedir({ servicio: 'SD', operador: '1111' }) as never,
    );

    expect(simulacion.buscarSku).toHaveBeenCalledWith(SKU_POR_DEFECTO, 'PE');
  });

  it('el punto de entrega, cuando no se dice a dónde', async () => {
    const { servicio, simular } = armar();

    await servicio.simular(USUARIO, {
      pais: 'PE',
      servicio: 'SD',
      operador: '1111',
    } as never);

    // "Lima" como distrito es el punto de entrega por defecto
    expect(simular.mock.calls[0][0].communeId).toBe('c3');
  });

  it('el destino que llega manda sobre el de por defecto', async () => {
    const { servicio, simular } = armar();

    await servicio.simular(
      USUARIO,
      pedir({
        servicio: 'SD',
        operador: '1111',
        distrito: 'Chorrillos',
      }) as never,
    );

    expect(simular.mock.calls[0][0].communeId).toBe('c2');
  });
});

describe('El método de entrega', () => {
  it('lo decide el servicio: SE se retira en tienda', async () => {
    const { servicio, simular } = armar();

    await servicio.simular(
      USUARIO,
      pedir({ servicio: 'SE', operador: '20066' }) as never,
    );

    expect(simular.mock.calls[0][0].deliveryMethod).toBe('RT');
  });

  it('y SD se despacha a domicilio', async () => {
    const { servicio, simular } = armar();

    await servicio.simular(
      USUARIO,
      pedir({ servicio: 'SD', operador: '1111' }) as never,
    );

    expect(simular.mock.calls[0][0].deliveryMethod).toBe('DP');
  });

  it('sin servicio cae a despacho, que es la mayoría de los casos', async () => {
    const { servicio, simular } = armar();

    // Antes lo delataba la lista del código en la que estuviera el OPL
    await servicio.simular(USUARIO, pedir({ operador: '1111' }) as never);

    expect(simular.mock.calls[0][0].deliveryMethod).toBe('DP');
  });

  it('el método explícito manda sobre todo', async () => {
    const { servicio, simular } = armar();

    await servicio.simular(
      USUARIO,
      pedir({ servicio: 'SD', operador: '1111', metodo: 'RT' }) as never,
    );

    expect(simular.mock.calls[0][0].deliveryMethod).toBe('RT');
  });
});
