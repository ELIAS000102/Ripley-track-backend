import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../src/auditoria/contexto-auditoria.service.js';
import { MallasLeadtimeService } from '../../src/mallas_leadtime/mallas-leadtime.service.js';
import { supabaseEnMemoria, type Fila } from '../fixtures/supabase-memoria.js';

/**
 * Las matrices de eventos: varias, cada una con su nombre, y en cada tienda con
 * su vigencia. La base (Valle o Regular) sigue siendo una sola.
 */

const USUARIO = { id: 'u-1', email: 'u@ripley.cl' };
const fila7 = (v: (string | null)[]) => v;
const tiendaDe = (mallaId: string, codigo: string) => ({
  malla_id: mallaId, codigo, tienda: `Tienda ${codigo}`, desfase: 0,
  transferencia: fila7(['A', null, null, null, null, null, null]), intermedio: fila7(Array(7).fill(null)), recepcion: fila7([null, 'A', null, null, null, null, null]),
});

function montar() {
  const tablas: Record<string, Fila[]> = {
    mallas_leadtime: [
      { id: 'v1', pais: 'CL', tipo: 'regular', nombre: 'Valle', archivo: 'valle.xlsx', tiendas: 2, avisos: [], cargado_por: 'u', cargado_en: '2026-10-01T00:00:00Z' },
      { id: 'c1', pais: 'CL', tipo: 'evento', nombre: 'Cyber', archivo: 'cyber.xlsx', tiendas: 2, avisos: [], cargado_por: 'u', cargado_en: '2026-10-05T00:00:00Z' },
      { id: 'n1', pais: 'CL', tipo: 'evento', nombre: 'Navidad', archivo: 'navidad.xlsx', tiendas: 1, avisos: [], cargado_por: 'u', cargado_en: '2026-10-06T00:00:00Z' },
    ],
    malla_leadtime_tiendas: [tiendaDe('v1', '10002'), tiendaDe('v1', '10021'), tiendaDe('c1', '10002'), tiendaDe('c1', '10021'), tiendaDe('n1', '10002')],
    malla_evento_vigencias: [{ pais: 'CL', evento: 'Navidad', codigo: '10002', desde: '2026-12-20', hasta: '2026-12-26' }],
  };
  const auditoria = { registrarCambio: vi.fn() } as unknown as ContextoAuditoria;
  return { servicio: new MallasLeadtimeService(supabaseEnMemoria(tablas), auditoria), tablas };
}

describe('Las matrices de eventos', () => {
  it('cada evento se lee por su nombre, sin distinguir mayúsculas, y la de valle sigue sin nombre', async () => {
    const { servicio } = montar();
    const cyber = await servicio.actual('CL', { tipo: 'evento', nombre: 'CYBER' });
    const valle = await servicio.actual('CL');
    expect([cyber.malla?.nombre, cyber.malla?.tiendas.length, valle.malla?.nombre, valle.malla?.tiendas.length]).toEqual(['Cyber', 2, 'Valle', 2]);
  });

  it('cargar un evento con un nombre que ya existe sigue con ese, en vez de abrir otro', async () => {
    const { servicio, tablas } = montar();
    const libro = await (await import('exceljs')).default;
    const wb = new libro.Workbook();
    const hoja = wb.addWorksheet('Matriz');
    hoja.addRow(['Código', 'Tienda', 'Desfase', ...'LMWJVSD'.split(''), ...'LMWJVSD'.split(''), ...'LMWJVSD'.split('')]);
    hoja.addRow(['10002', 'Mall', 0, 'A', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'A', '', '', '', '', '']);
    const r = await servicio.cargar(Buffer.from(await wb.xlsx.writeBuffer()), 'cyber2.xlsx', 'CL', USUARIO, { tipo: 'evento', nombre: 'cyber' });
    expect([r.nombre, tablas.mallas_leadtime.filter((f) => f.nombre === 'Cyber').length]).toEqual(['Cyber', 2]);
  });

  it('un evento no se puede llamar como la de valle, ni quedarse sin nombre', async () => {
    const { servicio } = montar();
    await expect(servicio.vigencias('CL', 'valle')).rejects.toThrow(/es la matriz base/);
    await expect(servicio.vigencias('CL', '  ')).rejects.toThrow(/Falta el nombre del evento/);
  });

  it('la lista de eventos dice su última carga y entre qué fechas tienen vigencia', async () => {
    const { servicio } = montar();
    const eventos = await servicio.eventos('CL');
    expect(eventos.map((e) => [e.nombre, e.conVigencia, e.desde, e.hasta])).toEqual([['Cyber', 0, null, null], ['Navidad', 1, '2026-12-20', '2026-12-26']]);
  });

  it('la vigencia se guarda por tienda y sobrevive a volver a cargar el evento', async () => {
    const { servicio, tablas } = montar();
    await servicio.guardarVigencias('CL', 'Cyber', [{ codigo: '10002', desde: '2026-11-03', hasta: '2026-11-05' }], USUARIO);
    tablas.mallas_leadtime.push({ id: 'c2', pais: 'CL', tipo: 'evento', nombre: 'Cyber', archivo: 'otra.xlsx', tiendas: 2, avisos: [], cargado_por: 'u', cargado_en: '2026-10-09T00:00:00Z' });
    tablas.malla_leadtime_tiendas.push(tiendaDe('c2', '10002'), tiendaDe('c2', '10021'));
    const r = await servicio.actual('CL', { tipo: 'evento', nombre: 'Cyber' });
    expect(r.malla?.tiendas.map((t) => [t.codigo, (t as { vigencia?: unknown }).vigencia])).toEqual([
      ['10002', { codigo: '10002', desde: '2026-11-03', hasta: '2026-11-05' }], ['10021', null],
    ]);
  });

  it('rechaza una tienda que no está en el evento, un rango al revés y que se pise con otro evento', async () => {
    const { servicio, tablas } = montar();
    const error = await servicio.guardarVigencias('CL', 'Cyber', [
      { codigo: '10099', desde: '2026-11-01', hasta: '2026-11-02' },
      { codigo: '10021', desde: '2026-11-05', hasta: '2026-11-01' },
      { codigo: '10002', desde: '2026-12-24', hasta: '2026-12-31' },
    ], USUARIO).catch((e: Error) => e.message);
    for (const motivo of ['10099 no está en la matriz del evento "Cyber"', '10021: la vigencia empieza el 2026-11-05', '10002: del 2026-12-24 al 2026-12-31 se pisa con el evento "Navidad"']) {
      expect(error).toContain(motivo);
    }
    expect(tablas.malla_evento_vigencias).toHaveLength(1);
  });

  it('retirar un evento se lleva sus cargas y su vigencia, y deja los demás', async () => {
    const { servicio, tablas } = montar();
    await servicio.retirarEvento('CL', 'navidad');
    expect([tablas.mallas_leadtime.map((f) => f.nombre), tablas.malla_evento_vigencias]).toEqual([['Valle', 'Cyber'], []]);
  });

  it('para el reporte ST: cada evento con su malla interpretada y la vigencia de cada tienda', async () => {
    const { servicio } = montar();
    const eventos = await servicio.eventosVigentes('CL');
    expect(eventos.map((e) => [e.nombre, [...e.porCodigo.keys()], [...e.vigencias.keys()]])).toEqual([
      ['Cyber', ['10002', '10021'], []], ['Navidad', ['10002'], ['10002']],
    ]);
  });
});
