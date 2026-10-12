import { describe, expect, it, vi } from 'vitest';
import { AlmacenesAgenteService } from '../../src/agente/almacenes.service.js';
import type { ConfiguracionCdsService } from '../../src/reportes/cds/configuracion-cds.service.js';
import { almacenesDePrueba } from '../fixtures/almacenes.js';

/**
 * Los almacenes como los nombra la operación: los alias de la configuración de
 * los CDs ("CD Villa" es el 20026) y la fuente de stock por defecto.
 */
describe('Los almacenes del agente', () => {
  it('"CD Villa", "VES" y "villa el salvador" son el 20026; un código o lo que no es un CD, tal cual', async () => {
    const a = almacenesDePrueba();
    expect(await a.codigos(['CD Villa', 'VES', 'villa el salvador', '20021', 'Aldeas', 'Chorrillos'], 'PE'))
      .toEqual(['20026', '20021', '20096', 'Chorrillos']);
  });

  it('sin fuente de stock, la de por defecto de Perú, y se dice', async () => {
    expect(await almacenesDePrueba().fuente(undefined, 'PE', 'x')).toEqual({ codigo: '20026', porDefecto: true });
    expect(await almacenesDePrueba().fuente(' CD Villa ', 'PE', 'x')).toEqual({ codigo: '20026', porDefecto: false });
  });

  it('en Chile no hay una por defecto: se pide', async () => {
    await expect(almacenesDePrueba().fuente('', 'CL', 'la transferencia')).rejects.toThrow(/en CL no hay uno por defecto/);
  });

  it('si no se puede leer la configuración, sigue con el texto tal cual', async () => {
    const rota = { cds: vi.fn().mockRejectedValue(new Error('Supabase caído')) } as unknown as ConfiguracionCdsService;
    expect(await new AlmacenesAgenteService(rota).codigo('CD Villa', 'PE')).toBe('CD Villa');
  });
});
