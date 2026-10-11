import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../src/auditoria/contexto-auditoria.service.js';
import { fechasDeVentaOpl, leerDia, ventasDeOpl } from '../../src/mallas_despacho/malla-despacho.calculo.js';
import { leerMallaDespacho } from '../../src/mallas_despacho/malla-despacho.lector.js';
import { crearPlantillaDespacho } from '../../src/mallas_despacho/malla-despacho.plantilla.js';
import { MallasDespachoService } from '../../src/mallas_despacho/mallas-despacho.service.js';
import type { OplMalla } from '../../src/mallas_despacho/interfaces/malla-despacho.interface.js';
import { supabaseEnMemoria, type Fila } from '../fixtures/supabase-memoria.js';

/**
 * Las mallas de despacho: por OPL, qué día va en tránsito y qué día se
 * despacha lo vendido cada día de la semana. La OPL de ejemplo es la de la
 * malla que pasó la operación (4014 SD_PIURA_FE), escrita a mano.
 */

const d = (transito: string | null, despacho: string) => ({ transito, despacho });
const PIURA: OplMalla = {
  codigo: '4014',
  nombre: 'SD_PIURA_FE',
  //     lunes          martes         miércoles      jueves         viernes        sábado         domingo
  dias: [d('W', 'J'), d('W', 'J'), d('V', 'S'), d('V', 'S'), d('L', 'M'), d('L', 'M'), d('W', 'J')],
};

const USUARIO = { id: 'u-1', email: 'u@ripley.pe' };

/** Un Excel con la plantilla y estas filas desde la A3 */
async function excelCon(filas: (string | number | null)[][]) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load((await crearPlantillaDespacho()) as unknown as ArrayBuffer);
  const hoja = libro.getWorksheet('Malla')!;
  filas.forEach((f, i) => { hoja.getRow(i + 3).values = f; });
  return Buffer.from(await libro.xlsx.writeBuffer());
}

describe('Los días de una malla de despacho', () => {
  it('se escriben completos, abreviados, con su letra, con o sin tilde, y con "+N"', () => {
    expect(['Miércoles', 'mie', 'W', 'X', 'Sábado', 'dom.', 'Lunes+7', 'jue + 2'].map(leerDia)).toEqual([
      { dia: 'W', suma: 0 }, { dia: 'W', suma: 0 }, { dia: 'W', suma: 0 }, { dia: 'W', suma: 0 },
      { dia: 'S', suma: 0 }, { dia: 'D', suma: 0 }, { dia: 'L', suma: 7 }, { dia: 'J', suma: 2 },
    ]);
    expect([leerDia(''), leerDia('Feriado'), leerDia('Lunes+31')]).toEqual([null, undefined, undefined]);
  });
});

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

  it('el mismo día de la semana es el mismo día, y "+7" la semana siguiente', () => {
    const o: OplMalla = { codigo: '1', nombre: 'X', dias: [d('L', 'L'), d(null, 'M+7'), null, null, null, null, null] };
    const [lunes, martes] = ventasDeOpl(o);
    expect([lunes.diasHastaTransito, lunes.diasHastaDespacho, martes.transita, martes.diasHastaDespacho]).toEqual([0, 0, null, 7]);
  });

  it('un día de venta sin fila va con el siguiente que la tiene', () => {
    const o: OplMalla = { codigo: '1', nombre: 'X', dias: [d('W', 'J'), null, null, null, null, null, null] };
    const martes = ventasDeOpl(o)[1];
    expect([martes.segun, martes.diasDeEspera, martes.diasHastaDespacho]).toEqual(['L', 6, 9]);
  });

  it('las fechas de una venta concreta', () => {
    // El lunes 18 de mayo de 2026, como en la malla
    expect(fechasDeVentaOpl(PIURA, '2026-05-18')).toEqual({ venta: '2026-05-18', transito: '2026-05-20', despacho: '2026-05-21', diasHastaDespacho: 3 });
    expect(fechasDeVentaOpl(PIURA, '2026-05-24')).toEqual({ venta: '2026-05-24', transito: '2026-05-27', despacho: '2026-05-28', diasHastaDespacho: 4 });
  });
});

describe('La plantilla de la malla de despacho', () => {
  it('rellena con una malla, se vuelve a leer igual', async () => {
    const lectura = await leerMallaDespacho(await crearPlantillaDespacho([PIURA]));
    expect([lectura.errores, lectura.avisos, lectura.items]).toEqual([[], [], [PIURA]]);
  });

  it('rechaza días que no lo son, un día de venta repetido y un despacho vacío, diciendo la fila', async () => {
    const lectura = await leerMallaDespacho(await excelCon([
      ['4014', 'SD_PIURA_FE', 'Lunes', 'Miércoles', 'Jueves'],
      ['4014', 'SD_PIURA_FE', 'lunes', 'Miércoles', 'Jueves'],
      ['4014', 'SD_PIURA_FE', 'Feriado', 'Miércoles', 'Jueves'],
      ['4015', 'OTRA', 'Martes', 'Jueves', ''],
    ]));
    expect(lectura.items).toEqual([]);
    expect(lectura.errores.join(' | ')).toMatch(/Fila 4.*ya tiene el lunes.*fila 3/);
    expect(lectura.errores.join(' | ')).toMatch(/Fila 5.*"Feriado" no es un día/);
    expect(lectura.errores.join(' | ')).toMatch(/Fila 6.*despacho "\(vacío\)"/);
  });

  it('avisa de los días de venta que le faltan a una OPL, sin rechazarla', async () => {
    const lectura = await leerMallaDespacho(await excelCon([['4014', 'SD_PIURA_FE', 'Lunes', '', 'Jueves']]));
    expect(lectura.errores).toEqual([]);
    expect(lectura.items[0].dias[0]).toEqual({ transito: null, despacho: 'J' });
    expect(lectura.avisos[0]).toMatch(/no tiene fila para martes, miércoles, jueves, viernes, sábado, domingo/);
  });
});

describe('El servicio de mallas de despacho', () => {
  function montar() {
    const tablas: Record<string, Fila[]> = {};
    const auditoria = { registrarCambio: vi.fn() } as unknown as ContextoAuditoria;
    return { servicio: new MallasDespachoService(supabaseEnMemoria(tablas), auditoria), tablas };
  }

  it('guarda cada carga como versión y la base se llama Regular en Perú y Valle en Chile', async () => {
    const { servicio, tablas } = montar();
    const excel = await crearPlantillaDespacho([PIURA]);
    const pe = await servicio.cargar(excel, 'piura.xlsx', 'PE', USUARIO);
    await servicio.cargar(excel, 'piura.xlsx', 'CL', USUARIO);
    const actual = await servicio.actual('PE');
    expect([pe.nombre, (await servicio.actual('CL')).malla?.nombre, actual.malla?.nombre, actual.malla?.opls[0].ventas[0].diasHastaDespacho]).toEqual(['Regular', 'Valle', 'Regular', 3]);
    expect(tablas.mallas_despacho.map((f) => f.nombre)).toEqual(['Valle', 'Valle']);
  });

  it('los eventos llevan vigencia por OPL, y no pueden llamarse como la base', async () => {
    const { servicio } = montar();
    await servicio.cargar(await crearPlantillaDespacho([PIURA]), 'cyber.xlsx', 'PE', USUARIO, { tipo: 'evento', nombre: 'Cyber' });
    await servicio.guardarVigencias('PE', 'cyber', [{ codigo: '4014', desde: '2026-11-02', hasta: '2026-11-04' }], USUARIO);
    expect((await servicio.vigencias('PE', 'Cyber')).vigencias).toEqual([{ codigo: '4014', desde: '2026-11-02', hasta: '2026-11-04' }]);
    await expect(servicio.vigencias('PE', 'Regular')).rejects.toThrow(/es la malla de despacho base/);
    await expect(servicio.guardarVigencias('PE', 'Cyber', [{ codigo: '9999', desde: '2026-11-02', hasta: '2026-11-04' }], USUARIO))
      .rejects.toThrow(/La OPL 9999 no está en la malla de despacho del evento "Cyber"/);
  });

  it('calcula las fechas de una venta en una OPL', async () => {
    const { servicio } = montar();
    await servicio.cargar(await crearPlantillaDespacho([PIURA]), 'piura.xlsx', 'PE', USUARIO);
    expect(await servicio.calcular('PE', '4014', '2026-05-22')).toEqual({
      codigo: '4014', nombre: 'SD_PIURA_FE', malla: 'Regular', venta: '2026-05-22', transito: '2026-05-25', despacho: '2026-05-26', diasHastaDespacho: 4,
    });
  });
});
