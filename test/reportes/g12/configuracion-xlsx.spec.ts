import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { configuracionAXlsx, nombreXlsxConfiguracion, xlsxAConfiguracion } from '../../../src/reportes/g12/configuracion-xlsx.js';
import { configuracionVacia, normalizarConfiguracion } from '../../../src/reportes/g12/g12.validacion.js';
import type { ConfiguracionG12 } from '../../../src/reportes/g12/interfaces/g12.interface.js';

/**
 * La configuración del G12 en Excel: lo que se exporta se vuelve a importar
 * igual, y un Excel editado a mano dice dónde está cada problema.
 */

function config(): ConfiguracionG12 {
  const c = configuracionVacia();
  const pickup = c.componentes.find((x) => x.clave === 'pickup_lima')!;
  pickup.filas = [{ nombre: 'San Isidro' }, { nombre: 'Miraflores' }];
  pickup.bloques = [
    { tipo: 'simulacion', muestra: true, nota: 'RE primero', items: [
      { fila: 'San Isidro', campos: { servicio: 'RE', operador: '20027', almacen: '20027', region: 'Lima', provincia: 'Lima', distrito: 'San Isidro' } },
      { fila: 'Miraflores', nota: 'tienda nueva', campos: { servicio: 'RE', operador: '20030', region: 'Lima', distrito: 'Miraflores', hora: '21:00' } },
    ] },
    { tipo: 'picking', items: [{ fila: 'San Isidro', campos: { codigo: '20027', servicio: 'RT', agenda: 'Agenda Picking RT - 20027' } }] },
  ];
  const dd = c.componentes.find((x) => x.clave === 'dd_lima')!;
  dd.filas = [{ nombre: 'Paquetería Lima Total', suma: ['Big Ticket Lima'] }, { nombre: 'Big Ticket Lima' }, { nombre: 'SAME DAY', oracle: ['SD_RM - 1er Turno', 'SD_RM - 2do*'] }];
  dd.bloques = [{ tipo: 'capacidad', items: [{ fila: 'Big Ticket Lima', campos: { lun: 280, mar: 280, mie: 280, jue: 280, vie: 280, sab: 0, dom: 0 } }] }];
  c.resumen = [{ nombre: 'Retiro en tienda', partes: [{ componente: 'pickup_lima' }, { componente: 'dd_lima', fila: 'Big Ticket Lima' }] }];
  return normalizarConfiguracion(c).configuracion;
}

describe('La configuración del G12 en Excel', () => {
  it('lo que se exporta se importa igual', async () => {
    const original = config();
    const libro = await configuracionAXlsx(original, 'PE');
    const { configuracion, errores } = await xlsxAConfiguracion(libro);

    expect(errores).toEqual([]);
    const limpia = normalizarConfiguracion(configuracion);
    expect(limpia.errores).toEqual([]);
    expect(limpia.configuracion).toEqual(original);
  });

  it('lleva una hoja por tipo de bloque, con nombres y no ids', async () => {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await configuracionAXlsx(config(), 'PE')) as unknown as ArrayBuffer);
    expect(libro.worksheets.map((h) => h.name)).toEqual(['Léeme', 'Filas', 'Simulación', 'Picking', 'Recepción', 'Despacho', 'Cupos a mano', 'Resumen']);
    const sim = libro.getWorksheet('Simulación')!;
    expect((sim.getRow(1).values as unknown[]).slice(1, 6)).toEqual(['Cuadro', 'Bloque', 'Muestra', 'Fila', 'Servicio']);
    expect((sim.getRow(2).values as unknown[]).slice(1, 5)).toEqual(['Pickup in store - Lima', 1, 'Sí', 'San Isidro']);
    // La muestra y la nota son del bloque: solo en su primera fila
    expect(sim.getRow(3).getCell(3).value).toBe('');
  });

  it('un Excel editado a mano: cada problema con su hoja y su fila', async () => {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await configuracionAXlsx(config(), 'PE')) as unknown as ArrayBuffer);
    // Un cuadro que no existe, y el bloque 1 de Pickup Lima también en Picking (ya es de Simulación)
    libro.getWorksheet('Filas')!.addRow(['Cuadro inventado', 'X']);
    libro.getWorksheet('Picking')!.addRow(['Pickup in store - Lima', 1, 'San Isidro', '20027', 'RT']);
    const { errores } = await xlsxAConfiguracion(Buffer.from(await libro.xlsx.writeBuffer()));
    expect(errores).toEqual([
      expect.stringMatching(/^Filas, fila \d+: "Cuadro inventado" no es un cuadro del G12\.$/),
      expect.stringMatching(/^Picking, fila 3: el bloque 1 de Pickup in store - Lima ya tiene ítems en la hoja "Simulación"/),
    ]);
  });

  it('un archivo que no es un Excel se dice', async () => {
    const { errores } = await xlsxAConfiguracion(Buffer.from('hola'));
    expect(errores).toEqual(['El archivo no es un Excel .xlsx que se pueda leer.']);
  });

  it('se llama por el país y la hora, en la del país', () => {
    expect(nombreXlsxConfiguracion('PE', new Date('2026-11-11T13:31:00.000Z'))).toBe('G12-configuracion-PE-2026-11-11-0831.xlsx');
  });
});

describe('Los ids de Ripley en el Excel de configuración', () => {
  it('cada ítem lleva sus ids guardados en columnas grises; al importar se ignoran', async () => {
    const { firmaIdsG12 } = await import('../../../src/reportes/g12/ids-g12.service.js');
    const original = config();
    const pickup = original.componentes.find((x) => x.clave === 'pickup_lima')!;
    const sim = pickup.bloques[0].items[0];
    const pick = pickup.bloques[1].items[0];
    const ids = new Map([
      [firmaIdsG12('simulacion', sim.campos)!, { firma: 'x', tipo: 'simulacion' as const, consultadoEn: '2026-11-14T15:40:00.000Z', ids: {
        tipo: 'simulacion' as const, regionId: 'r-15', regionNombre: 'Lima',
        comuna: { id: 'c-isidro', name: 'San Isidro', code: '150131', identifier: '150131', province: 'Lima', region: 'Lima' },
        operador: { id: 'id-20027', code: '20027' }, almacen: { id: 'id-alm', code: '20027' }, productos: [{ sku: 2013435160001, quantity: '1', type: {} as never }],
      } }],
      [firmaIdsG12('picking', pick.campos)!, { firma: 'y', tipo: 'picking' as const, consultadoEn: '2026-11-14T15:40:00.000Z', ids: {
        tipo: 'picking' as const, agendas: [{ id: 'sch-1', nombre: 'Agenda Picking RT - 20027', servicio: 'RT' }],
      } }],
    ]);
    const xlsx = await configuracionAXlsx(original, 'PE', new Date(), ids);

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(xlsx as unknown as ArrayBuffer);
    const filaDe = (hoja: string, n: number) => (libro.getWorksheet(hoja)!.getRow(n).values as unknown[]).slice(1).map((v) => String(v ?? ''));
    const sims = [filaDe('Simulación', 1), filaDe('Simulación', 2), filaDe('Simulación', 3)];
    // Una sola columna de ids, la última
    expect(sims[0].at(-1)).toBe('Ids de Ripley');
    expect(sims[0].filter((t) => t.startsWith('Id'))).toEqual(['Ids de Ripley']);
    expect(sims[1].at(-1)).toBe('Región r-15 · Distrito c-isidro (150131) · Operador id-20027 · Almacén id-alm · SKU 2013435160001');
    // Miraflores no tiene ids guardados todavía
    expect(sims[2].at(-1)).toBe('Sin consultar: en la próxima actualización');
    expect(filaDe('Picking', 2).at(-1)).toBe('sch-1');
    // La portada dice cuántos tienen ids
    expect(String(libro.getWorksheet('Léeme')!.getColumn(2).values.join(' '))).toMatch(/2 de 3 ítems con sus ids guardados.*1 se consulta en la próxima actualización/);

    const { configuracion, errores } = await xlsxAConfiguracion(xlsx);
    expect(errores).toEqual([]);
    expect(normalizarConfiguracion(configuracion).configuracion).toEqual(original);
  });

  it('al guardar se olvidan los ids de lo que ya no está y las regiones que nadie usa; lo demás se queda', async () => {
    const { IdsG12Service, firmaIdsG12, firmaRegionG12 } = await import('../../../src/reportes/g12/ids-g12.service.js');
    const { supabaseEnMemoria } = await import('../../fixtures/supabase-memoria.js');
    const original = config();
    const items = original.componentes.find((x) => x.clave === 'pickup_lima')!.bloques[0].items;
    const fila = (firma: string, ids: Record<string, unknown>) => ({ pais: 'PE', firma, tipo: ids.tipo, ids, consultado_en: 'x' });
    const tablas = { g12_ids: [
      fila(firmaIdsG12('simulacion', items[0].campos)!, { tipo: 'simulacion', regionId: 'r-15' }),
      fila(firmaIdsG12('simulacion', items[1].campos)!, { tipo: 'simulacion', regionId: 'r-15' }),
      fila(firmaRegionG12('r-15'), { tipo: 'region' }),
      fila(firmaRegionG12('r-7'), { tipo: 'region' }),
      fila('picking|99|rt|', { tipo: 'picking', agendas: [] }),
    ] };
    const servicio = new IdsG12Service(supabaseEnMemoria(tablas));

    // Miraflores cambia de distrito: su firma es otra
    items[1].campos.distrito = 'Surco';
    await servicio.limpiar('PE', original);
    expect(tablas.g12_ids.map((f) => f.firma)).toEqual([firmaIdsG12('simulacion', items[0].campos), firmaRegionG12('r-15')]);
  });
});
