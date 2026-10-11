import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../../src/auditoria/contexto-auditoria.service.js';
import { MatricesService } from '../../../src/lead_time/matrices/matrices.service.js';
import { supabaseEnMemoria, type Fila } from '../../fixtures/supabase-memoria.js';

/**
 * Las matrices de eventos: varias, cada una con su nombre, y en cada tienda con
 * su vigencia. La base (Valle o Regular) sigue siendo una sola.
 */

const USUARIO = { id: 'u-1', email: 'u@ripley.cl' };
const G = { id: 'g1', pais: 'CL' };
const fila7 = (v: (string | null)[]) => v;
const tiendaDe = (mallaId: string, codigo: string) => ({
  version_id: mallaId, codigo, tienda: `Tienda ${codigo}`, desfase: 0,
  transferencia: fila7(['A', null, null, null, null, null, null]), intermedio: fila7(Array(7).fill(null)), recepcion: fila7([null, 'A', null, null, null, null, null]),
});

function montar() {
  const tablas: Record<string, Fila[]> = {
    matrices: [
      { id: 'v1', grupo_id: 'g1', pais: 'CL', tipo: 'regular', nombre: 'Valle', archivo: 'valle.xlsx', tiendas: 2, avisos: [], cargado_por: 'u', cargado_en: '2026-10-01T00:00:00Z' },
      { id: 'c1', grupo_id: 'g1', pais: 'CL', tipo: 'evento', nombre: 'Cyber', archivo: 'cyber.xlsx', tiendas: 2, avisos: [], cargado_por: 'u', cargado_en: '2026-10-05T00:00:00Z' },
      { id: 'n1', grupo_id: 'g1', pais: 'CL', tipo: 'evento', nombre: 'Navidad', archivo: 'navidad.xlsx', tiendas: 1, avisos: [], cargado_por: 'u', cargado_en: '2026-10-06T00:00:00Z' },
    ],
    matriz_tiendas: [tiendaDe('v1', '10002'), tiendaDe('v1', '10021'), tiendaDe('c1', '10002'), tiendaDe('c1', '10021'), tiendaDe('n1', '10002')],
    matriz_vigencias: [{ grupo_id: 'g1', evento: 'Navidad', codigo: '10002', desde: '2026-12-20', hasta: '2026-12-26' }],
  };
  const auditoria = { registrarCambio: vi.fn() } as unknown as ContextoAuditoria;
  return { servicio: new MatricesService(supabaseEnMemoria(tablas), auditoria), tablas };
}

describe('Las matrices de eventos', () => {
  it('cada evento se lee por su nombre, sin distinguir mayúsculas, y la de valle sigue sin nombre', async () => {
    const { servicio } = montar();
    const cyber = await servicio.actual(G, { tipo: 'evento', nombre: 'CYBER' });
    const valle = await servicio.actual(G);
    expect([cyber.malla?.nombre, cyber.malla?.tiendas.length, valle.malla?.nombre, valle.malla?.tiendas.length]).toEqual(['Cyber', 2, 'Valle', 2]);
  });

  it('cargar un evento con un nombre que ya existe sigue con ese, en vez de abrir otro', async () => {
    const { servicio, tablas } = montar();
    const libro = await (await import('exceljs')).default;
    const wb = new libro.Workbook();
    const hoja = wb.addWorksheet('Matriz');
    hoja.addRow(['Código', 'Tienda', 'Desfase', ...'LMWJVSD'.split(''), ...'LMWJVSD'.split(''), ...'LMWJVSD'.split('')]);
    hoja.addRow(['10002', 'Mall', 0, 'A', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'A', '', '', '', '', '']);
    const r = await servicio.cargar(Buffer.from(await wb.xlsx.writeBuffer()), 'cyber2.xlsx', G, USUARIO, { tipo: 'evento', nombre: 'cyber' });
    expect([r.nombre, tablas.matrices.filter((f) => f.nombre === 'Cyber').length]).toEqual(['Cyber', 2]);
  });

  it('un evento no se puede llamar como la de valle, ni quedarse sin nombre', async () => {
    const { servicio } = montar();
    await expect(servicio.vigencias(G, 'valle')).rejects.toThrow(/es la matriz base/);
    await expect(servicio.vigencias(G, '  ')).rejects.toThrow(/Falta el nombre del evento/);
  });

  it('la lista de eventos dice su última carga y entre qué fechas tienen vigencia', async () => {
    const { servicio } = montar();
    const eventos = await servicio.eventos(G);
    expect(eventos.map((e) => [e.nombre, e.conVigencia, e.desde, e.hasta])).toEqual([['Cyber', 0, null, null], ['Navidad', 1, '2026-12-20', '2026-12-26']]);
  });

  it('la vigencia se guarda por tienda y sobrevive a volver a cargar el evento', async () => {
    const { servicio, tablas } = montar();
    await servicio.guardarVigencias(G, 'Cyber', [{ codigo: '10002', desde: '2026-11-03', hasta: '2026-11-05' }], USUARIO);
    tablas.matrices.push({ id: 'c2', grupo_id: 'g1', pais: 'CL', tipo: 'evento', nombre: 'Cyber', archivo: 'otra.xlsx', tiendas: 2, avisos: [], cargado_por: 'u', cargado_en: '2026-10-09T00:00:00Z' });
    tablas.matriz_tiendas.push(tiendaDe('c2', '10002'), tiendaDe('c2', '10021'));
    const r = await servicio.actual(G, { tipo: 'evento', nombre: 'Cyber' });
    expect(r.malla?.tiendas.map((t) => [t.codigo, (t as { vigencia?: unknown }).vigencia])).toEqual([
      ['10002', { codigo: '10002', desde: '2026-11-03', hasta: '2026-11-05' }], ['10021', null],
    ]);
  });

  it('rechaza una tienda que no está en el evento, un rango al revés y que se pise con otro evento', async () => {
    const { servicio, tablas } = montar();
    const error = await servicio.guardarVigencias(G, 'Cyber', [
      { codigo: '10099', desde: '2026-11-01', hasta: '2026-11-02' },
      { codigo: '10021', desde: '2026-11-05', hasta: '2026-11-01' },
      { codigo: '10002', desde: '2026-12-24', hasta: '2026-12-31' },
    ], USUARIO).catch((e: Error) => e.message);
    for (const motivo of ['10099 no está en la matriz del evento "Cyber"', '10021: la vigencia empieza el 2026-11-05', '10002: del 2026-12-24 al 2026-12-31 se pisa con el evento "Navidad"']) {
      expect(error).toContain(motivo);
    }
    expect(tablas.matriz_vigencias).toHaveLength(1);
  });

  it('retirar un evento se lleva sus cargas y su vigencia, y deja los demás', async () => {
    const { servicio, tablas } = montar();
    await servicio.retirarEvento(G, 'navidad');
    expect([tablas.matrices.map((f) => f.nombre), tablas.matriz_vigencias]).toEqual([['Valle', 'Cyber'], []]);
  });

  it('para quien calcula: cada evento con su malla interpretada y la vigencia de cada tienda', async () => {
    const { servicio } = montar();
    const eventos = await servicio.eventosConVigencia(G);
    expect(eventos.map((e) => [e.nombre, [...e.porCodigo.keys()], [...e.vigencias.keys()]])).toEqual([
      ['Cyber', ['10002', '10021'], []], ['Navidad', ['10002'], ['10002']],
    ]);
  });

  it('cada grupo tiene lo suyo: un evento de otro grupo no se ve, aunque se llame igual', async () => {
    const { servicio, tablas } = montar();
    tablas.matrices.push({ id: 'o1', grupo_id: 'g2', pais: 'CL', tipo: 'evento', nombre: 'Otro', archivo: 'o.xlsx', tiendas: 1, avisos: [], cargado_por: 'u', cargado_en: '2026-10-07T00:00:00Z' });
    tablas.matriz_tiendas.push(tiendaDe('o1', '10002'));
    expect((await servicio.eventos(G)).map((e) => e.nombre)).toEqual(['Cyber', 'Navidad']);
    expect((await servicio.eventos({ id: 'g2', pais: 'CL' })).map((e) => e.nombre)).toEqual(['Otro']);
    expect((await servicio.actual({ id: 'g2', pais: 'CL' })).malla).toBeNull();
  });
});
