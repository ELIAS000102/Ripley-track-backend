import ExcelJS from 'exceljs';
import type { OplMalla } from './interfaces/malla.interface.js';

/**
 * La plantilla de las mallas, con el formato de la operación: una fila por OPL
 * y día de venta, y un calendario de lunes a domingo —tres semanas, o las que
 * hagan falta— donde se escribe "Venta", "Transito" y "Despacho" en su día.
 *
 * Las celdas del calendario se colorean solas al escribir: amarillo la venta,
 * morado el tránsito y verde el despacho, como en la malla de la operación.
 * Caben todas las OPLs del grupo en una sola carga.
 *
 * Con `opls` sale rellena: son las mallas guardadas, listas para corregirlas y
 * volver a cargarlas.
 */

const NOMBRES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const COLOR = { cabecera: 'FFD9D9D9', semana: 'FF000000', venta: 'FFFFFF00', transito: 'FFDA70D6', despacho: 'FF92D050' };

const relleno = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const borde: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
};

/** Columnas antes del calendario: OPL y T. de servicio */
const FIJAS = 2;
const FILAS_EN_BLANCO = 140;

function letra(n: number) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

export async function crearPlantillaMalla(opls: OplMalla[] = []): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Ripley Track';
  const hoja = libro.addWorksheet('Malla', { views: [{ state: 'frozen', xSplit: FIJAS, ySplit: 2 }] });

  // Las semanas que hagan falta para el despacho más lejano; tres como mínimo
  const ultimo = Math.max(0, ...opls.flatMap((o) => o.dias.map((d, i) => (d ? i + d.despacho : 0))));
  const semanas = Math.max(3, Math.ceil((ultimo + 1) / 7));
  const dias = semanas * 7;
  const primera = FIJAS + 1;
  const ultimaCol = FIJAS + dias;

  // Fila 1: el nombre de cada semana. Fila 2: el encabezado que lee el backend
  hoja.mergeCells(1, 1, 1, FIJAS);
  for (let s = 0; s < semanas; s++) {
    hoja.mergeCells(1, primera + s * 7, 1, primera + s * 7 + 6);
    const c = hoja.getCell(1, primera + s * 7);
    c.value = `Semana ${s + 1}`;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { horizontal: 'center' };
    c.fill = relleno(COLOR.semana);
  }
  hoja.getRow(2).values = ['OPL', 'T. de servicio', ...Array.from({ length: dias }, (_, i) => NOMBRES[i % 7])];
  hoja.getRow(2).eachCell((c) => {
    c.font = { bold: true };
    c.alignment = { horizontal: 'center' };
    c.border = borde;
    c.fill = relleno(COLOR.cabecera);
  });
  hoja.getColumn(1).width = 10;
  hoja.getColumn(2).width = 15;
  for (let col = primera; col <= ultimaCol; col++) hoja.getColumn(col).width = 11;

  // Las filas guardadas: siete por OPL, cada una con su venta en la primera semana
  const guardadas = opls.flatMap((o) => o.dias.flatMap((d, i) => (d ? [{ o, i, d }] : [])));
  const filas = Math.max(guardadas.length + 21, FILAS_EN_BLANCO);
  const lista = '"Venta,Transito,Despacho"';
  for (let k = 0; k < filas; k++) {
    const fila = hoja.getRow(k + 3);
    const g = guardadas[k];
    if (g) {
      fila.getCell(1).value = g.o.codigo;
      fila.getCell(2).value = g.o.servicio;
      fila.getCell(primera + g.i).value = 'Venta';
      if (g.d.transito !== null) fila.getCell(primera + g.i + g.d.transito).value = 'Transito';
      fila.getCell(primera + g.i + g.d.despacho).value = 'Despacho';
    }
    for (let col = 1; col <= ultimaCol; col++) {
      const c = fila.getCell(col);
      c.border = borde;
      if (col === 1) c.numFmt = '@';
      if (col >= primera) {
        c.alignment = { horizontal: 'center' };
        c.dataValidation = {
          type: 'list', allowBlank: true, formulae: [lista], showErrorMessage: true,
          errorTitle: 'Malla', error: 'Escribe Venta, Transito o Despacho.',
        };
      }
    }
  }

  // Los colores de la malla, solos al escribir
  const calendario = `${letra(primera)}3:${letra(ultimaCol)}${filas + 2}`;
  const regla = (texto: string, argb: string, priority: number): ExcelJS.ConditionalFormattingRule => ({
    type: 'containsText', operator: 'containsText', text: texto, priority,
    style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb } } },
  });
  hoja.addConditionalFormatting({
    ref: calendario,
    rules: [regla('Venta', COLOR.venta, 1), regla('Transito', COLOR.transito, 2), regla('Despacho', COLOR.despacho, 3)],
  });

  const ayuda = libro.addWorksheet('Instrucciones');
  ayuda.getColumn(1).width = 110;
  const lineas = [
    ['Cómo rellenar las mallas de un grupo', true],
    ['', false],
    ['Una fila por OPL y día de venta (siete por OPL). Caben todas las OPLs del grupo en un solo archivo.', false],
    ['En cada fila, escribe en la columna de su día: "Venta", "Transito" (si pasa por tránsito) y "Despacho".', false],
    ['La venta va en la primera semana; el tránsito y el despacho, en los días que tocan, aunque sean de la semana siguiente.', false],
    ['', false],
    ['Columnas (no las muevas; no cambies las filas 1 y 2):', true],
    ['A OPL (código) · B T. de servicio · C en adelante: el calendario, de lunes a domingo, semana tras semana', false],
    ['También se puede cargar el Excel de la operación tal cual, con sus fechas encima: se lee el encabezado de los días.', false],
    ['', false],
    ['Reglas:', true],
    ['· Cada fila lleva una Venta, una Despacho y como mucho una Transito, en ese orden y en días distintos.', false],
    ['· Una OPL no puede tener dos ventas el mismo día de la semana, ni dos tipos de servicio en el mismo grupo.', false],
    ['· Si a una OPL le falta un día de venta, lo vendido ese día va con el siguiente día que sí tenga.', false],
    ['', false],
    ['Ejemplo (OPL 4014, servicio S): venta el lunes, tránsito el miércoles y despacho el jueves → 3 días;', false],
    ['venta el viernes, tránsito el lunes y despacho el martes de la semana siguiente → 4 días.', false],
    ['', false],
    ['Si algo no cumple estas reglas, la carga se rechaza entera y el panel dice qué fila corregir.', false],
  ] as const;
  lineas.forEach(([texto, negrita], i) => {
    const c = ayuda.getCell(`A${i + 1}`);
    c.value = texto;
    if (negrita) c.font = { bold: true };
  });

  return Buffer.from(await libro.xlsx.writeBuffer());
}
