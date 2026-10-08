import { afterEach, describe, expect, it } from 'vitest';
import configuration from '../../src/config/configuration.js';

/**
 * Una variable de endpoint que falta tiene que notarse como lo que es.
 *
 * Antes se armaba la ruta con la variable tal cual y una que faltaba acababa
 * en la URL como "…/v1undefined": Ripley respondía 404 y el panel decía "No hay
 * datos para ese recurso". Así llegó a producción la agenda de transferencia.
 */
describe('Las rutas de los endpoints', () => {
  const guardadas = { ...process.env };
  afterEach(() => { process.env = { ...guardadas }; });

  it('sin su variable, la ruta queda vacía (y endpoint() dice "Falta configurar")', () => {
    process.env.RIPLEY_PATH_PREFIX = '/prefijo';
    delete process.env.RIPLEY_EP_CLUSTERS;

    expect(configuration().ripley.endpoints.clusters).toBe('');
  });

  it('con su variable, prefijo + ruta', () => {
    process.env.RIPLEY_PATH_PREFIX = '/prefijo';
    process.env.RIPLEY_EP_CLUSTERS = '/cluster';

    expect(configuration().ripley.endpoints.clusters).toBe('/prefijo/cluster');
  });

  it('las capacidades de transferencia usan las de recepción si no tienen la suya, aunque esté vacía', () => {
    process.env.RIPLEY_PATH_PREFIX = '/p';
    process.env.RIPLEY_EP_CAPACITIES_TRANSFER = '';
    process.env.RIPLEY_EP_CAPACITIES_RECEPTION = '/capacities';

    expect(configuration().ripley.endpoints.capacitiesTransfer).toBe('/p/capacities');
  });
});
