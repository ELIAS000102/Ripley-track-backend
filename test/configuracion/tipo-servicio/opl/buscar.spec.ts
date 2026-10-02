import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../../../src/auditoria/contexto-auditoria.service.js';
import type { CatalogosRipleyService } from '../../../../src/common/ripley/catalogos.service.js';
import type { RipleyHttpService } from '../../../../src/common/ripley/ripley-http.service.js';
import { OplService } from '../../../../src/configuracion/tipo-servicio/opl/opl.service.js';

/**
 * Buscar la oficina cuyos tipos de servicio se van a mirar.
 *
 * Filtraba por `isOPLOffice`, y con eso la 20021 —una tienda— no aparecía: el
 * agente contestaba que ese código "es un almacén, no un OPL" y se negaba a
 * mirar. Pero una tienda tiene tipos de servicio con sus horas de corte, y
 * Ripley los devuelve sin problema.
 *
 * Lo que se fija es que la búsqueda **no presuponga el catálogo**.
 */

function armar(filas: Array<Record<string, unknown>>) {
  const oficinasConTotal = vi
    .fn()
    .mockResolvedValue({ total: filas.length, filas });

  const servicio = new OplService(
    {} as unknown as RipleyHttpService,
    { oficinasConTotal } as unknown as CatalogosRipleyService,
    // Buscar no escribe nada, así que el registro de uso no se toca
    { registrarCambio: vi.fn() } as unknown as ContextoAuditoria,
  );

  return { servicio, oficinasConTotal };
}

describe('Se busca en todas las oficinas, no solo en los OPL', () => {
  it('no manda ningún filtro de tipo', async () => {
    const { servicio, oficinasConTotal } = armar([]);

    await servicio.buscarOpl('20021', 'PE');

    expect(oficinasConTotal).toHaveBeenCalledWith('PE', { q: '20021' });
  });

  it('una tienda aparece, que es lo que no pasaba', async () => {
    const { servicio } = armar([
      { id: 'o1', code: '20021', name: 'Ripley Chorrillos', isActive: true },
    ]);

    const { opls, total } = await servicio.buscarOpl('20021', 'PE');

    expect(total).toBe(1);
    expect(opls[0]).toMatchObject({ code: '20021', nombre: 'Ripley Chorrillos' });
  });

  it('y un operador logístico sigue apareciendo igual', async () => {
    const { servicio } = armar([
      { id: 'o2', code: '1130', name: '90 Min', isActive: true },
    ]);

    const { opls } = await servicio.buscarOpl('1130', 'PE');

    expect(opls[0].code).toBe('1130');
  });

  it('un nombre sin `name` no revienta: queda vacío', async () => {
    const { servicio } = armar([{ id: 'o3', code: '1140' }]);

    const { opls } = await servicio.buscarOpl('1140', 'PE');

    expect(opls[0]).toMatchObject({ code: '1140', nombre: '', activo: null });
  });
});
