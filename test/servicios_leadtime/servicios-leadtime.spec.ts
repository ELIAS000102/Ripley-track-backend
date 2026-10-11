import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../src/auditoria/contexto-auditoria.service.js';
import { MallasDespachoService } from '../../src/mallas_despacho/mallas-despacho.service.js';
import { MallasLeadtimeService } from '../../src/mallas_leadtime/mallas-leadtime.service.js';
import { ServiciosLeadtimeService } from '../../src/servicios_leadtime/servicios-leadtime.service.js';
import { supabaseEnMemoria, type Fila } from '../fixtures/supabase-memoria.js';

/**
 * Los servicios de lead time: un tipo de servicio con sus tiendas (matrices) o
 * sus OPLs (mallas de despacho), y cuándo se despacha lo vendido una fecha.
 */

const USUARIO = { id: 'u-1', email: 'u@ripley.pe' };
const _ = null;

function montar() {
  const tablas: Record<string, Fila[]> = {
    // Matriz: la tienda 10002 transfiere el jueves y recepciona el viernes; en el Cyber, el jueves y recepciona el sábado
    mallas_leadtime: [
      { id: 'mv', pais: 'PE', tipo: 'regular', nombre: 'Valle', archivo: 'v.xlsx', tiendas: 1, avisos: [], cargado_por: 'u', cargado_en: '2026-10-01T00:00:00Z' },
      { id: 'mc', pais: 'PE', tipo: 'evento', nombre: 'Cyber', archivo: 'c.xlsx', tiendas: 1, avisos: [], cargado_por: 'u', cargado_en: '2026-10-02T00:00:00Z' },
    ],
    malla_leadtime_tiendas: [
      { malla_id: 'mv', codigo: '10002', tienda: 'Jockey', desfase: 1, transferencia: [_, _, _, 'A', _, _, _], intermedio: Array(7).fill(_), recepcion: [_, _, _, _, 'A', _, _] },
      { malla_id: 'mc', codigo: '10002', tienda: 'Jockey', desfase: 1, transferencia: [_, _, _, 'A', _, _, _], intermedio: Array(7).fill(_), recepcion: [_, _, _, _, _, 'A', _] },
    ],
    malla_evento_vigencias: [{ pais: 'PE', evento: 'Cyber', codigo: '10002', desde: '2026-11-07', hasta: '2026-11-07' }],
    // Malla: la OPL 4014 despacha a los 3 días; en el Cyber, a los 5
    mallas_despacho: [
      { id: 'dv', pais: 'PE', tipo: 'regular', nombre: 'Valle', archivo: 'v.xlsx', opls: 1, avisos: [], cargado_por: 'u', cargado_en: '2026-10-01T00:00:00Z' },
      { id: 'dc', pais: 'PE', tipo: 'evento', nombre: 'Cyber', archivo: 'c.xlsx', opls: 1, avisos: [], cargado_por: 'u', cargado_en: '2026-10-02T00:00:00Z' },
    ],
    malla_despacho_opls: [
      { malla_id: 'dv', codigo: '4014', nombre: 'SD_PIURA_FE', dias: Array(7).fill(0).map((__, i) => ({ transito: null, despacho: ['J', 'V', 'S', 'D', 'L', 'M', 'W'][i] })) },
      { malla_id: 'dc', codigo: '4014', nombre: 'SD_PIURA_FE', dias: Array(7).fill(0).map((__, i) => ({ transito: null, despacho: ['S', 'D', 'L', 'M', 'W', 'J', 'V'][i] })) },
    ],
    malla_despacho_vigencias: [{ pais: 'PE', evento: 'Cyber', codigo: '4014', desde: '2026-11-02', hasta: '2026-11-03' }],
    servicios_leadtime: [],
  };
  const supabase = supabaseEnMemoria(tablas);
  const auditoria = { registrarCambio: vi.fn() } as unknown as ContextoAuditoria;
  const servicio = new ServiciosLeadtimeService(
    supabase,
    auditoria,
    new MallasLeadtimeService(supabase, auditoria),
    new MallasDespachoService(supabase, auditoria),
  );
  return { servicio, tablas };
}

describe('Los servicios de lead time', () => {
  it('se crean con su modo y sus códigos, sin repetidos, y dicen cuáles no están en la base', async () => {
    const { servicio } = montar();
    const creado = await servicio.crear('PE', { nombre: ' Despacho a domicilio ', modo: 'malla', codigos: ['4014', ' 4014', '9999'] }, USUARIO);
    expect([creado.nombre, creado.miembros, creado.fuera]).toEqual([
      'Despacho a domicilio',
      [{ codigo: '4014', nombre: 'SD_PIURA_FE', enBase: true }, { codigo: '9999', nombre: null, enBase: false }],
      ['9999'],
    ]);
  });

  it('no deja dos servicios con el mismo nombre en un país, sin distinguir mayúsculas', async () => {
    const { servicio } = montar();
    await servicio.crear('PE', { nombre: 'Retiro en tienda', modo: 'matriz', codigos: ['10002'] }, USUARIO);
    await expect(servicio.crear('PE', { nombre: 'RETIRO EN TIENDA', modo: 'malla', codigos: [] }, USUARIO)).rejects.toThrow(/Ya hay un servicio "Retiro en tienda"/);
    // En otro país, sí
    await expect(servicio.crear('CL', { nombre: 'Retiro en tienda', modo: 'matriz', codigos: [] }, USUARIO)).resolves.toBeTruthy();
  });

  it('se editan y se borran', async () => {
    const { servicio, tablas } = montar();
    const { id } = await servicio.crear('PE', { nombre: 'Express', modo: 'malla', codigos: ['4014'] }, USUARIO);
    const editado = await servicio.actualizar('PE', id, { nombre: 'Express', modo: 'matriz', codigos: ['10002'] }, USUARIO);
    expect([editado.modo, editado.miembros[0].nombre]).toEqual(['matriz', 'Jockey']);
    await servicio.borrar('PE', id);
    expect(tablas.servicios_leadtime).toEqual([]);
  });

  it('con mallas: la del evento si la fecha de venta está en su vigencia; si no, la base (Regular en Perú)', async () => {
    const { servicio } = montar();
    const { id } = await servicio.crear('PE', { nombre: 'Domicilio', modo: 'malla', codigos: ['4014', '9999'] }, USUARIO);
    const lunesCyber = await servicio.calcular('PE', id, '2026-11-02');
    const lunesNormal = await servicio.calcular('PE', id, '2026-11-09');
    expect(lunesCyber.filas.map((f) => [f.codigo, f.usada, f.despacho, f.diasHastaDespacho])).toEqual([['4014', 'Cyber', '2026-11-07', 5], ['9999', undefined, undefined, undefined]]);
    expect(lunesCyber.filas[1].error).toMatch(/No está en la malla de despacho Regular/);
    expect([lunesNormal.filas[0].usada, lunesNormal.filas[0].despacho, lunesNormal.resumen]).toEqual(['Regular', '2026-11-12', { calculados: 1, minimo: 3, maximo: 3 }]);
  });

  it('con matrices: la del evento si, según ella, la recepción cae en su vigencia (que es de recepción)', async () => {
    const { servicio } = montar();
    const { id } = await servicio.crear('PE', { nombre: 'Retiro', modo: 'matriz', codigos: ['10002'] }, USUARIO);
    // Venta el jueves 5: con el Cyber recepciona el sábado 7, dentro de la vigencia
    const enCyber = (await servicio.calcular('PE', id, '2026-11-05')).filas[0];
    // Venta el jueves 12: con el Cyber recepcionaría el 14, fuera; va con la base
    const fuera = (await servicio.calcular('PE', id, '2026-11-12')).filas[0];
    expect([enCyber.usada, enCyber.recepcion, enCyber.despacho, enCyber.diasHastaDespacho]).toEqual(['Cyber', '2026-11-07', '2026-11-08', 3]);
    expect([fuera.usada, fuera.recepcion, fuera.despacho, fuera.diasHastaDespacho]).toEqual(['Regular', '2026-11-13', '2026-11-14', 2]);
  });
});
