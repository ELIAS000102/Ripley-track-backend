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
  dd.filas = [{ nombre: 'Paquetería Lima Total', suma: ['Big Ticket Lima'] }, { nombre: 'Big Ticket Lima' }];
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
