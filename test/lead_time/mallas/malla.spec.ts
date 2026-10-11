import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../../src/auditoria/contexto-auditoria.service.js';
import { fechasDeVentaOpl, ventasDeOpl } from '../../../src/lead_time/mallas/malla.calculo.js';
import { leerMalla } from '../../../src/lead_time/mallas/malla.lector.js';
import { crearPlantillaMalla } from '../../../src/lead_time/mallas/malla.plantilla.js';
import { MallasService } from '../../../src/lead_time/mallas/mallas.service.js';
import type { OplMalla } from '../../../src/lead_time/mallas/interfaces/malla.interface.js';
import { supabaseEnMemoria, type Fila } from '../../fixtures/supabase-memoria.js';

/**
 * Las mallas: por OPL, qué día va en tránsito y qué día se despacha lo vendido
 * cada día de la semana, con el formato de la malla de la operación. La OPL de
 * ejemplo es la que pasó la operación (4014, servicio S), escrita a mano.
 */

const d = (transito: number | null, despacho: number) => ({ transito, despacho });
const PIURA: OplMalla = {
  codigo: '4014',
  nombre: '',
  servicio: 'S',
  //     lunes     martes    miércoles jueves    viernes   sábado    domingo
  dias: [d(2, 3), d(1, 2), d(2, 3), d(1, 2), d(3, 4), d(2, 3), d(3, 4)],
};

const USUARIO = { id: 'u-1', email: 'u@ripley.pe' };
const GRUPO = { id: 'g-bt', pais: 'PE' };
const SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/**
 * Un Excel como el de la operación: fechas en la fila 1, el encabezado con los
 * días en la 2 y una fila por venta, con sus marcas en la columna de su día.
 */
async function excelComoElDeLaOperacion(filas: Array<[string, string, Record<number, string>]>, encabezado = ['OPL', 'T. de servicio', ...SEMANA, ...SEMANA]) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Hoja1');
  hoja.addRow(['', '', ...Array.from({ length: 14 }, (_, i) => `${18 + i}-May`)]);
  hoja.addRow(encabezado);
  for (const [opl, servicio, marcas] of filas) {
    const fila = [opl, servicio, ...Array<string>(14).fill('')];
    for (const [dia, marca] of Object.entries(marcas)) fila[2 + Number(dia)] = marca;
    hoja.addRow(fila);
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** Las siete filas de la OPL de Piura, como en la imagen de la operación (0 = lunes de la primera semana) */
const FILAS_PIURA: Array<[string, string, Record<number, string>]> = [
  ['4014', 'S', { 0: 'Venta', 2: 'Transito', 3: 'Despacho' }],
  ['4014', 'S', { 1: 'Venta', 2: 'Transito', 3: 'Despacho' }],
  ['4014', 'S', { 2: 'Venta', 4: 'Transito', 5: 'Despacho' }],
  ['4014', 'S', { 3: 'Venta', 4: 'Transito', 5: 'Despacho' }],
  ['4014', 'S', { 4: 'Venta', 7: 'Transito', 8: 'Despacho' }],
  ['4014', 'S', { 5: 'Venta', 7: 'Transito', 8: 'Despacho' }],
  ['4014', 'S', { 6: 'Venta', 9: 'Transito', 10: 'Despacho' }],
];

describe('El lead time de una OPL', () => {
  it('cada día de venta, con su tránsito y su despacho, como en la malla de Piura', () => {
    expect(ventasDeOpl(PIURA).map((v) => [v.venta, v.transita, v.despacha, v.diasHastaTransito, v.diasHastaDespacho])).toEqual([
      ['L', 'W', 'J', 2, 3],
      ['M', 'W', 'J', 1, 2],
      ['W', 'V', 'S', 2, 3],
      ['J', 'V', 'S', 1, 2],
      ['V', 'L', 'M', 3, 4],
      ['S', 'L', 'M', 2, 3],
      ['D', 'W', 'J', 3, 4],
    ]);
  });

  it('un día de venta sin fila va con el siguiente que la tiene', () => {
    const o: OplMalla = { codigo: '1', nombre: '', servicio: 'S', dias: [d(null, 3), null, null, null, null, null, null] };
    const martes = ventasDeOpl(o)[1];
    expect([martes.segun, martes.diasDeEspera, martes.diasHastaDespacho, martes.transita]).toEqual(['L', 6, 9, null]);
  });

  it('las fechas de una venta concreta', () => {
    // El lunes 18 y el domingo 24 de mayo de 2026, como en la malla
    expect(fechasDeVentaOpl(PIURA, '2026-05-18')).toEqual({ venta: '2026-05-18', transito: '2026-05-20', despacho: '2026-05-21', diasHastaDespacho: 3 });
    expect(fechasDeVentaOpl(PIURA, '2026-05-24')).toEqual({ venta: '2026-05-24', transito: '2026-05-27', despacho: '2026-05-28', diasHastaDespacho: 4 });
  });
});

describe('Leer mallas con el formato de la operación', () => {
  it('lee el Excel de la operación tal cual, con sus fechas encima', async () => {
    const lectura = await leerMalla(await excelComoElDeLaOperacion(FILAS_PIURA));
    expect([lectura.errores, lectura.avisos, lectura.items]).toEqual([[], [], [PIURA]]);
  });

  it('varias OPLs en una sola carga', async () => {
    const otra: Array<[string, string, Record<number, string>]> = FILAS_PIURA.map(([, s, m]) => ['4020', s, m]);
    const lectura = await leerMalla(await excelComoElDeLaOperacion([...FILAS_PIURA, ...otra]));
    expect(lectura.items.map((o) => o.codigo)).toEqual(['4014', '4020']);
  });

  it('la plantilla rellena se vuelve a leer igual', async () => {
    const lectura = await leerMalla(await crearPlantillaMalla([PIURA, { ...PIURA, codigo: '4020' }]));
    expect([lectura.errores, lectura.items]).toEqual([[], [PIURA, { ...PIURA, codigo: '4020' }]]);
  });

  it('rechaza una fila sin despacho, en desorden, una venta repetida y dos servicios en una OPL, diciendo la fila', async () => {
    const lectura = await leerMalla(await excelComoElDeLaOperacion([
      ['4014', 'S', { 0: 'Venta', 2: 'Transito' }],
      ['4014', 'S', { 1: 'Venta', 3: 'Transito', 2: 'Despacho' }],
      ['4015', 'S', { 0: 'Venta', 3: 'Despacho' }],
      ['4015', 'S', { 0: 'Venta', 4: 'Despacho' }],
      ['4015', 'E', { 1: 'Venta', 4: 'Despacho' }],
    ]));
    const todo = lectura.errores.join(' | ');
    expect(lectura.items).toEqual([]);
    expect(todo).toMatch(/Fila 3 \(OPL 4014\): tiene que llevar una "Venta", una "Despacho"/);
    expect(todo).toMatch(/Fila 4 \(OPL 4014\): el orden tiene que ser Venta, Transito y Despacho/);
    expect(todo).toMatch(/Fila 6 \(OPL 4015\): la OPL 4015 ya tiene una venta el lunes en la fila 5/);
    expect(todo).toMatch(/Fila 7 \(OPL 4015\): la OPL 4015 ya tiene el tipo de servicio "S"/);
  });

  it('pide los días del calendario seguidos y la columna del tipo de servicio', async () => {
    const desordenado = await leerMalla(await excelComoElDeLaOperacion(FILAS_PIURA, ['OPL', 'T. de servicio', 'Lunes', 'Miércoles', ...SEMANA.slice(2), ...SEMANA]));
    expect(desordenado.errores[0]).toMatch(/tienen que ir seguidos y en orden/);
    const sinServicio = await leerMalla(await excelComoElDeLaOperacion(FILAS_PIURA, ['OPL', 'Zona', ...SEMANA, ...SEMANA]));
    expect(sinServicio.errores[0]).toMatch(/Falta la columna "T. de servicio"/);
  });

  it('avisa de los días de venta que le faltan a una OPL y de lo que no entiende, sin rechazarla', async () => {
    const lectura = await leerMalla(await excelComoElDeLaOperacion([['4014', 'S', { 0: 'Venta', 3: 'Despacho', 5: 'Feriado' }]]));
    expect(lectura.errores).toEqual([]);
    expect(lectura.items[0].dias[0]).toEqual({ transito: null, despacho: 3 });
    expect(lectura.avisos.join(' | ')).toMatch(/"Feriado".*se ignora/);
    expect(lectura.avisos.join(' | ')).toMatch(/OPL 4014: no tiene venta el martes, miércoles, jueves, viernes, sábado, domingo/);
  });
});

describe('El servicio de mallas', () => {
  function montar() {
    const tablas: Record<string, Fila[]> = {};
    const auditoria = { registrarCambio: vi.fn() } as unknown as ContextoAuditoria;
    return { servicio: new MallasService(supabaseEnMemoria(tablas), auditoria), tablas };
  }

  it('guarda cada carga como versión del grupo, y la base se llama Regular en Perú', async () => {
    const { servicio, tablas } = montar();
    const r = await servicio.cargar(await crearPlantillaMalla([PIURA]), 'bt.xlsx', GRUPO, USUARIO);
    const actual = await servicio.actual(GRUPO);
    expect([r.nombre, r.codigos, actual.malla?.nombre, actual.malla?.opls[0].ventas[4].diasHastaDespacho]).toEqual(['Regular', ['4014'], 'Regular', 4]);
    expect(tablas.mallas_despacho[0]).toMatchObject({ grupo_id: 'g-bt', pais: 'PE', nombre: 'Valle', opls: 1 });
    expect(tablas.malla_despacho_opls[0]).toMatchObject({ version_id: r.id, codigo: '4014', servicio: 'S' });
  });

  it('los eventos llevan vigencia por OPL, y no pueden llamarse como la base', async () => {
    const { servicio } = montar();
    await servicio.cargar(await crearPlantillaMalla([PIURA]), 'cyber.xlsx', GRUPO, USUARIO, { tipo: 'evento', nombre: 'Cyber' });
    await servicio.guardarVigencias(GRUPO, 'cyber', [{ codigo: '4014', desde: '2026-11-02', hasta: '2026-11-04' }], USUARIO);
    expect((await servicio.vigencias(GRUPO, 'Cyber')).vigencias).toEqual([{ codigo: '4014', desde: '2026-11-02', hasta: '2026-11-04' }]);
    await expect(servicio.vigencias(GRUPO, 'Regular')).rejects.toThrow(/es la malla base/);
    await expect(servicio.guardarVigencias(GRUPO, 'Cyber', [{ codigo: '9999', desde: '2026-11-02', hasta: '2026-11-04' }], USUARIO))
      .rejects.toThrow(/La OPL 9999 no está en la malla del evento "Cyber"/);
  });

  it('calcula las fechas de una venta en una OPL', async () => {
    const { servicio } = montar();
    await servicio.cargar(await crearPlantillaMalla([PIURA]), 'bt.xlsx', GRUPO, USUARIO);
    expect(await servicio.calcular(GRUPO, '4014', '2026-05-22')).toEqual({
      codigo: '4014', nombre: '', servicio: 'S', malla: 'Regular', venta: '2026-05-22', transito: '2026-05-25', despacho: '2026-05-26', diasHastaDespacho: 4,
    });
  });
});
