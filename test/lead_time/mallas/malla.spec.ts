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
 * Las mallas: por OPL y flujo, qué día va en tránsito, se recoge y se despacha
 * lo vendido cada día de la semana, con el formato de la malla de la
 * operación. La OPL de ejemplo es la que pasó la operación (4014, flujos S y
 * OP), escrita a mano.
 */

const d = (transito: number | null, despacho: number, recojo: number | null = null) => ({ transito, recojo, despacho });
const PIURA_S: OplMalla = {
  codigo: '4014/S',
  opl: '4014',
  servicio: 'S',
  nombre: '',
  //     lunes     martes    miércoles jueves    viernes   sábado    domingo
  dias: [d(2, 3), d(1, 2), d(2, 3), d(1, 2), d(3, 4), d(2, 3), d(3, 4)],
};
const PIURA_OP: OplMalla = {
  codigo: '4014/OP',
  opl: '4014',
  servicio: 'OP',
  nombre: '',
  dias: [d(null, 2), d(null, 2), d(null, 2), d(null, 4), d(null, 3), d(null, 3), d(null, 2, 1)],
};

const USUARIO = { id: 'u-1', email: 'u@ripley.pe' };
const GRUPO = { id: 'g-bt', pais: 'PE' };
const SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

type FilaMalla = [string, string, Record<number, string>];

/**
 * Un Excel como el de la operación: fechas en la fila 1, el encabezado con los
 * días en la 2 y una fila por venta, con sus marcas en la columna de su día.
 * Con `conDia`, lleva además la columna "Dia" con el día de venta.
 */
async function excelComoElDeLaOperacion(filas: FilaMalla[], { encabezado = ['OPL', 'Flujo'], conDia = false, dias = [...SEMANA, ...SEMANA] } = {}) {
  const fijas = [...encabezado, ...(conDia ? ['Dia'] : [])];
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Hoja1');
  hoja.addRow([...fijas.map(() => ''), ...Array.from({ length: dias.length }, (_, i) => `${18 + i}-May`)]);
  hoja.addRow([...fijas, ...dias]);
  for (const [opl, flujo, marcas] of filas) {
    const venta = Number(Object.entries(marcas).find(([, m]) => m === 'Venta')?.[0] ?? 0);
    const fila = [opl, flujo, ...(conDia ? [SEMANA[venta % 7]] : []), ...Array<string>(dias.length).fill('')];
    for (const [dia, marca] of Object.entries(marcas)) fila[fijas.length + Number(dia)] = marca;
    hoja.addRow(fila);
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** Las filas de la OPL 4014 como en la imagen de la operación (0 = lunes de la primera semana) */
const FILAS_OP: FilaMalla[] = [
  ['4014', 'OP', { 0: 'Venta', 2: 'Despacho' }],
  ['4014', 'OP', { 1: 'Venta', 3: 'Despacho' }],
  ['4014', 'OP', { 2: 'Venta', 4: 'Despacho' }],
  ['4014', 'OP', { 3: 'Venta', 7: 'Despacho' }],
  ['4014', 'OP', { 4: 'Venta', 7: 'Despacho' }],
  ['4014', 'OP', { 5: 'Venta', 8: 'Despacho' }],
  ['4014', 'OP', { 6: 'Venta', 7: 'RECOJO', 8: 'Despacho' }],
];
const FILAS_S: FilaMalla[] = [
  ['4014', 'S', { 0: 'Venta', 2: 'Transito', 3: 'Despacho' }],
  ['4014', 'S', { 1: 'Venta', 2: 'Transito', 3: 'Despacho' }],
  ['4014', 'S', { 2: 'Venta', 4: 'Transito', 5: 'Despacho' }],
  ['4014', 'S', { 3: 'Venta', 4: 'Transito', 5: 'Despacho' }],
  ['4014', 'S', { 4: 'Venta', 7: 'Transito', 8: 'Despacho' }],
  ['4014', 'S', { 5: 'Venta', 7: 'Transito', 8: 'Despacho' }],
  ['4014', 'S', { 6: 'Venta', 9: 'Transito', 10: 'Despacho' }],
];

describe('El lead time de una malla', () => {
  it('cada día de venta, con su tránsito y su despacho, como en la malla de Piura (flujo S)', () => {
    expect(ventasDeOpl(PIURA_S).map((v) => [v.venta, v.transita, v.despacha, v.diasHastaTransito, v.diasHastaDespacho])).toEqual([
      ['L', 'W', 'J', 2, 3],
      ['M', 'W', 'J', 1, 2],
      ['W', 'V', 'S', 2, 3],
      ['J', 'V', 'S', 1, 2],
      ['V', 'L', 'M', 3, 4],
      ['S', 'L', 'M', 2, 3],
      ['D', 'W', 'J', 3, 4],
    ]);
  });

  it('el recojo, como en el flujo OP: venta el domingo, recojo el lunes y despacho el martes', () => {
    const domingo = ventasDeOpl(PIURA_OP)[6];
    expect([domingo.recoge, domingo.diasHastaRecojo, domingo.despacha, domingo.diasHastaDespacho, domingo.transita]).toEqual(['L', 1, 'M', 2, null]);
    expect(fechasDeVentaOpl(PIURA_OP, '2026-05-24')).toEqual({ venta: '2026-05-24', transito: null, recojo: '2026-05-25', despacho: '2026-05-26', diasHastaDespacho: 2 });
  });

  it('un día de venta sin fila va con el siguiente que la tiene', () => {
    const o: OplMalla = { codigo: '1/S', opl: '1', servicio: 'S', nombre: '', dias: [d(null, 3), null, null, null, null, null, null] };
    const martes = ventasDeOpl(o)[1];
    expect([martes.segun, martes.diasDeEspera, martes.diasHastaDespacho, martes.transita]).toEqual(['L', 6, 9, null]);
  });

  it('las fechas de una venta concreta', () => {
    // El lunes 18 y el domingo 24 de mayo de 2026, como en la malla
    expect(fechasDeVentaOpl(PIURA_S, '2026-05-18')).toEqual({ venta: '2026-05-18', transito: '2026-05-20', recojo: null, despacho: '2026-05-21', diasHastaDespacho: 3 });
    expect(fechasDeVentaOpl(PIURA_S, '2026-05-24')).toEqual({ venta: '2026-05-24', transito: '2026-05-27', recojo: null, despacho: '2026-05-28', diasHastaDespacho: 4 });
  });
});

describe('Leer mallas con el formato de la operación', () => {
  it('una OPL con varios flujos en el mismo archivo, como el Excel de la operación (OPL · Flujo · Dia)', async () => {
    const lectura = await leerMalla(await excelComoElDeLaOperacion([...FILAS_OP, ...FILAS_S], { conDia: true }));
    expect([lectura.errores, lectura.avisos, lectura.items]).toEqual([[], [], [PIURA_OP, PIURA_S]]);
  });

  it('varias OPLs, cada una con sus flujos, en una sola carga', async () => {
    const otra = (filas: FilaMalla[]): FilaMalla[] => filas.map(([, f, m]) => ['4020', f, m]);
    const lectura = await leerMalla(await excelComoElDeLaOperacion([...FILAS_S, ...otra(FILAS_OP), ...FILAS_OP, ...otra(FILAS_S)]));
    expect(lectura.items.map((o) => o.codigo)).toEqual(['4014/OP', '4014/S', '4020/OP', '4020/S']);
  });

  it('vale también la columna "T. de servicio", y el flujo no distingue mayúsculas', async () => {
    const filas: FilaMalla[] = FILAS_S.map(([o, , m], i) => [o, i % 2 ? 's' : 'S', m]);
    const lectura = await leerMalla(await excelComoElDeLaOperacion(filas, { encabezado: ['OPL', 'T. de servicio'] }));
    expect(lectura.items).toEqual([PIURA_S]);
  });

  it('la plantilla rellena se vuelve a leer igual', async () => {
    const lectura = await leerMalla(await crearPlantillaMalla([PIURA_OP, PIURA_S]));
    expect([lectura.errores, lectura.items]).toEqual([[], [PIURA_OP, PIURA_S]]);
  });

  it('rechaza una fila sin despacho, en desorden, una venta repetida en el flujo y un día que no cuadra, diciendo la fila', async () => {
    const lectura = await leerMalla(await excelComoElDeLaOperacion([
      ['4014', 'S', { 0: 'Venta', 2: 'Transito' }],
      ['4014', 'S', { 1: 'Venta', 3: 'Transito', 2: 'Despacho' }],
      ['4015', 'OP', { 0: 'Venta', 3: 'Despacho' }],
      ['4015', 'OP', { 0: 'Venta', 4: 'Despacho' }],
      ['4015', 'S', { 0: 'Venta', 2: 'Recojo', 3: 'Despacho' }],
    ]));
    const todo = lectura.errores.join(' | ');
    expect(lectura.items).toEqual([]);
    expect(lectura.errores).toContain('Fila 3 (OPL 4014 S): falta el "Despacho": escríbelo en la columna del día en que se despacha. En la fila hay: Venta el lunes (columna C), Transito el miércoles (columna E).');
    expect(todo).toMatch(/Fila 4 \(OPL 4014 S\): la "Venta" va primero y la "Despacho" al final/);
    expect(todo).toMatch(/Fila 6 \(OPL 4015 OP\): la OPL 4015 ya tiene una venta el lunes en el flujo OP, en la fila 5/);
    // El mismo día en otro flujo sí vale
    expect(todo).not.toMatch(/Fila 7/);
  });

  it('una fila sin la Venta dice qué falta y dónde está lo que sí hay, como el sábado de OP sin venta', async () => {
    // Como la plantilla de la operación: OPL, T. de servicio y dos semanas; el sábado del flujo OP sin su "Venta"
    const filas = FILAS_OP.map(([o, f, m], i): FilaMalla => [o, f, i === 5 ? { 8: 'Despacho' } : m]);
    const lectura = await leerMalla(await excelComoElDeLaOperacion([...filas, ...FILAS_S], { encabezado: ['OPL', 'T. de servicio'] }));
    expect(lectura.errores).toEqual(['Fila 8 (OPL 4014 OP): falta la "Venta": escríbela en la columna del día en que se vende. En la fila hay: Despacho el martes (columna K).']);
  });

  it('dos marcas iguales en una fila también se dicen', async () => {
    const lectura = await leerMalla(await excelComoElDeLaOperacion([['4014', 'S', { 0: 'Venta', 1: 'Venta', 3: 'Despacho' }]]));
    expect(lectura.errores[0]).toBe('Fila 3 (OPL 4014 S): hay 2 "Venta" y solo puede haber una. En la fila hay: Venta el lunes (columna C), Venta el martes (columna D), Despacho el jueves (columna F).');
  });

  it('pide los días del calendario seguidos y la columna del flujo', async () => {
    const desordenado = await leerMalla(await excelComoElDeLaOperacion(FILAS_S, { dias: ['Lunes', 'Miércoles', ...SEMANA.slice(2), ...SEMANA] }));
    expect(desordenado.errores[0]).toMatch(/tienen que ir seguidos y en orden/);
    const sinFlujo = await leerMalla(await excelComoElDeLaOperacion(FILAS_S, { encabezado: ['OPL', 'Zona'] }));
    expect(sinFlujo.errores[0]).toMatch(/Falta la columna "Flujo"/);
  });

  it('avisa de los días de venta que le faltan a una malla y de lo que no entiende, sin rechazarla', async () => {
    const lectura = await leerMalla(await excelComoElDeLaOperacion([['4014', 'S', { 0: 'Venta', 3: 'Despacho', 5: 'Feriado' }]]));
    expect(lectura.errores).toEqual([]);
    expect(lectura.items[0].dias[0]).toEqual({ transito: null, recojo: null, despacho: 3 });
    expect(lectura.avisos.join(' | ')).toMatch(/"Feriado".*se ignora/);
    expect(lectura.avisos.join(' | ')).toMatch(/OPL 4014, flujo S: no tiene venta el martes, miércoles, jueves, viernes, sábado, domingo/);
  });
});

describe('El servicio de mallas', () => {
  function montar() {
    const tablas: Record<string, Fila[]> = {};
    const auditoria = { registrarCambio: vi.fn() } as unknown as ContextoAuditoria;
    return { servicio: new MallasService(supabaseEnMemoria(tablas), auditoria), tablas };
  }

  it('guarda cada carga como versión del grupo, con una malla por OPL y flujo, y la base se llama Regular en Perú', async () => {
    const { servicio, tablas } = montar();
    const r = await servicio.cargar(await crearPlantillaMalla([PIURA_OP, PIURA_S]), 'bt.xlsx', GRUPO, USUARIO);
    const actual = await servicio.actual(GRUPO);
    expect([r.nombre, r.codigos, actual.malla?.nombre, actual.malla?.opls.map((o) => o.ventas[4].diasHastaDespacho)]).toEqual(['Regular', ['4014/OP', '4014/S'], 'Regular', [3, 4]]);
    expect(tablas.mallas_despacho[0]).toMatchObject({ grupo_id: 'g-bt', pais: 'PE', nombre: 'Valle', opls: 2 });
    expect(tablas.malla_despacho_opls[1]).toMatchObject({ version_id: r.id, codigo: '4014/S', opl: '4014', servicio: 'S' });
  });

  it('los eventos llevan vigencia por OPL y flujo, y no pueden llamarse como la base', async () => {
    const { servicio } = montar();
    await servicio.cargar(await crearPlantillaMalla([PIURA_S]), 'cyber.xlsx', GRUPO, USUARIO, { tipo: 'evento', nombre: 'Cyber' });
    await servicio.guardarVigencias(GRUPO, 'cyber', [{ codigo: '4014/S', desde: '2026-11-02', hasta: '2026-11-04' }], USUARIO);
    expect((await servicio.vigencias(GRUPO, 'Cyber')).vigencias).toEqual([{ codigo: '4014/S', desde: '2026-11-02', hasta: '2026-11-04' }]);
    await expect(servicio.vigencias(GRUPO, 'Regular')).rejects.toThrow(/es la malla base/);
    await expect(servicio.guardarVigencias(GRUPO, 'Cyber', [{ codigo: '4014/OP', desde: '2026-11-02', hasta: '2026-11-04' }], USUARIO))
      .rejects.toThrow(/La OPL 4014\/OP no está en la malla del evento "Cyber"/);
  });

  it('calcula una venta por OPL y flujo; la OPL sola vale si tiene un único flujo', async () => {
    const { servicio } = montar();
    await servicio.cargar(await crearPlantillaMalla([PIURA_OP, PIURA_S]), 'bt.xlsx', GRUPO, USUARIO);
    expect(await servicio.calcular(GRUPO, '4014/s', '2026-05-22')).toEqual({
      codigo: '4014/S', opl: '4014', servicio: 'S', nombre: '', malla: 'Regular', venta: '2026-05-22', transito: '2026-05-25', recojo: null, despacho: '2026-05-26', diasHastaDespacho: 4,
    });
    await expect(servicio.calcular(GRUPO, '4014', '2026-05-22')).rejects.toThrow(/tiene varios flujos \(OP, S\): pide uno, como "4014\/OP"/);
  });
});
