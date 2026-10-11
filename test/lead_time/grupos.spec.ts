import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../src/auditoria/contexto-auditoria.service.js';
import { GruposLeadtimeService } from '../../src/lead_time/grupos.service.js';
import { MallasService } from '../../src/lead_time/mallas/mallas.service.js';
import { MatricesService } from '../../src/lead_time/matrices/matrices.service.js';
import { supabaseEnMemoria, type Fila } from '../fixtures/supabase-memoria.js';

/**
 * Los grupos de lead time: cada uno con nombre, descripción y tipo, y dentro
 * su base y sus eventos, de matrices o de mallas.
 */

const USUARIO = { id: 'u-1', email: 'u@ripley.pe' };
const _ = null;

function montar() {
  const tablas: Record<string, Fila[]> = {
    grupos_leadtime: [
      { id: 'g-st', pais: 'PE', nombre: 'Matriz ST (Site to Store)', descripcion: 'Tiendas abastecidas desde un CD', tipo: 'matriz', creado_en: '2026-10-01T00:00:00Z' },
      { id: 'g-bt', pais: 'PE', nombre: 'BT Provincia', descripcion: 'Una malla por OPL', tipo: 'malla', creado_en: '2026-10-02T00:00:00Z' },
    ],
    // Matriz: la tienda 10002 transfiere el jueves y recepciona el viernes; en el Cyber, el sábado
    matrices: [
      { id: 'mv', grupo_id: 'g-st', pais: 'PE', tipo: 'regular', nombre: 'Valle', archivo: 'v.xlsx', tiendas: 1, avisos: [], cargado_por: 'u', cargado_en: '2026-10-01T00:00:00Z' },
      { id: 'mc', grupo_id: 'g-st', pais: 'PE', tipo: 'evento', nombre: 'Cyber', archivo: 'c.xlsx', tiendas: 1, avisos: [], cargado_por: 'u', cargado_en: '2026-10-02T00:00:00Z' },
    ],
    matriz_tiendas: [
      { version_id: 'mv', codigo: '10002', tienda: 'Jockey', desfase: 1, transferencia: [_, _, _, 'A', _, _, _], intermedio: Array(7).fill(_), recepcion: [_, _, _, _, 'A', _, _] },
      { version_id: 'mc', codigo: '10002', tienda: 'Jockey', desfase: 1, transferencia: [_, _, _, 'A', _, _, _], intermedio: Array(7).fill(_), recepcion: [_, _, _, _, _, 'A', _] },
    ],
    matriz_vigencias: [{ grupo_id: 'g-st', evento: 'Cyber', codigo: '10002', desde: '2026-11-07', hasta: '2026-11-07' }],
    // Malla: la OPL 4014 despacha a los 3 días; en el Cyber, a los 5
    mallas_despacho: [
      { id: 'dv', grupo_id: 'g-bt', pais: 'PE', tipo: 'regular', nombre: 'Valle', archivo: 'v.xlsx', opls: 1, avisos: [], cargado_por: 'u', cargado_en: '2026-10-01T00:00:00Z' },
      { id: 'dc', grupo_id: 'g-bt', pais: 'PE', tipo: 'evento', nombre: 'Cyber', archivo: 'c.xlsx', opls: 1, avisos: [], cargado_por: 'u', cargado_en: '2026-10-02T00:00:00Z' },
    ],
    malla_despacho_opls: [
      { version_id: 'dv', codigo: '4014', nombre: '', servicio: 'S', dias: Array(7).fill({ transito: null, despacho: 3 }) },
      { version_id: 'dc', codigo: '4014', nombre: '', servicio: 'S', dias: Array(7).fill({ transito: 2, despacho: 5 }) },
    ],
    malla_despacho_vigencias: [{ grupo_id: 'g-bt', evento: 'Cyber', codigo: '4014', desde: '2026-11-02', hasta: '2026-11-03' }],
  };
  const supabase = supabaseEnMemoria(tablas);
  const auditoria = { registrarCambio: vi.fn() } as unknown as ContextoAuditoria;
  const grupos = new GruposLeadtimeService(supabase, auditoria, new MatricesService(supabase, auditoria), new MallasService(supabase, auditoria));
  return { grupos, tablas };
}

describe('Los grupos de lead time', () => {
  it('la lista del país dice de cada grupo qué tiene cargado: la base y los eventos con su vigencia', async () => {
    const { grupos } = montar();
    const r = await grupos.listar('PE');
    expect(r.base).toBe('Regular');
    expect(r.grupos.map((g) => [g.nombre, g.tipo, g.base?.codigos, g.eventos.map((e) => e.nombre)])).toEqual([
      ['BT Provincia', 'malla', 1, ['Cyber']],
      ['Matriz ST (Site to Store)', 'matriz', 1, ['Cyber']],
    ]);
  });

  it('se crean con nombre, descripción y tipo, sin repetir nombre en el país', async () => {
    const { grupos } = montar();
    const nuevo = await grupos.crear('PE', { nombre: ' BT Lima ', descripcion: 'OPLs de Lima', tipo: 'malla' }, USUARIO);
    expect(nuevo).toMatchObject({ pais: 'PE', nombre: 'BT Lima', descripcion: 'OPLs de Lima', tipo: 'malla' });
    await expect(grupos.crear('PE', { nombre: 'bt provincia', tipo: 'malla' }, USUARIO)).rejects.toThrow(/Ya hay un grupo "BT Provincia"/);
    await expect(grupos.crear('CL', { nombre: 'BT Provincia', tipo: 'malla' }, USUARIO)).resolves.toBeTruthy();
  });

  it('un grupo con cargas no cambia de tipo; uno vacío, sí', async () => {
    const { grupos } = montar();
    await expect(grupos.actualizar('g-bt', { nombre: 'BT Provincia', tipo: 'matriz' }, USUARIO)).rejects.toThrow(/no puede cambiar de tipo/);
    const vacio = await grupos.crear('PE', { nombre: 'Vacío', tipo: 'malla' }, USUARIO);
    expect((await grupos.actualizar(vacio.id, { nombre: 'Vacío', descripcion: 'otra', tipo: 'matriz' }, USUARIO)).tipo).toBe('matriz');
  });

  it('borrar un grupo lo quita (sus cargas se van en cascada en la base de datos)', async () => {
    const { grupos, tablas } = montar();
    await grupos.borrar('g-bt');
    expect(tablas.grupos_leadtime.map((g) => g.id)).toEqual(['g-st']);
    await expect(grupos.obtener('g-bt')).rejects.toThrow(/No hay ningún grupo/);
  });

  it('el reporte ST usa el grupo de matrices pedido, o el primero que se creó; uno de mallas no vale', async () => {
    const { grupos } = montar();
    expect((await grupos.grupoDeMatrices('PE'))?.id).toBe('g-st');
    await expect(grupos.grupoDeMatrices('PE', 'g-bt')).rejects.toThrow(/no es de matrices/);
    expect(await grupos.grupoDeMatrices('CL')).toBeNull();
  });

  it('el lead time de un grupo de mallas: la del evento si la venta cae en su vigencia; si no, la base', async () => {
    const { grupos } = montar();
    const cyber = await grupos.calcular('g-bt', '2026-11-02');
    const normal = await grupos.calcular('g-bt', '2026-11-09');
    expect(cyber.filas.map((f) => [f.codigo, f.usada, f.transito, f.despacho, f.diasHastaDespacho])).toEqual([['4014', 'Cyber', '2026-11-04', '2026-11-07', 5]]);
    expect([normal.filas[0].usada, normal.filas[0].despacho, normal.resumen]).toEqual(['Regular', '2026-11-12', { calculados: 1, minimo: 3, maximo: 3 }]);
  });

  it('el lead time de un grupo de matrices: la del evento si, según ella, la recepción cae en su vigencia', async () => {
    const { grupos } = montar();
    // Venta el jueves 5: con el Cyber recepciona el sábado 7, dentro; el jueves 12 iría al 14, fuera
    const enCyber = (await grupos.calcular('g-st', '2026-11-05')).filas[0];
    const fuera = (await grupos.calcular('g-st', '2026-11-12')).filas[0];
    expect([enCyber.usada, enCyber.recepcion, enCyber.despacho, enCyber.diasHastaDespacho]).toEqual(['Cyber', '2026-11-07', '2026-11-08', 3]);
    expect([fuera.usada, fuera.recepcion, fuera.despacho, fuera.diasHastaDespacho]).toEqual(['Regular', '2026-11-13', '2026-11-14', 2]);
  });
});
