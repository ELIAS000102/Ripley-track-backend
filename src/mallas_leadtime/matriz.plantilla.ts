import ExcelJS from 'exceljs';
import { DIAS, type TiendaMalla } from './interfaces/malla.interface.js';

/**
 * La plantilla de la matriz de valle.
 *
 * Tiene **las mismas columnas que el Excel de la operación** (A–X), en el mismo
 * orden: se copia el rango entero del original —desde el primer código hasta
 * la última celda de la recepción— y se pega en A3. Una plantilla con otro
 * orden obligaría a pegar bloque por bloque, y ahí es donde se cometen errores.
 *
 * Encima de los encabezados va una fila con el nombre de cada bloque y su
 * color: naranja la transferencia, gris el intermedio, verde la recepción.
 * La hoja "Instrucciones" dice cómo rellenarla.
 *
 * Con `tiendas` sale rellena: es la matriz guardada, lista para corregirla y
 * volver a cargarla.
 */

const COLOR = {
  transferencia: 'FFF8CBAD', transferenciaSuave: 'FFFCE4D6',
  intermedio: 'FFBFBFBF', intermedioSuave: 'FFEDEDED',
  recepcion: 'FF92D050', recepcionSuave: 'FFE2EFDA',
  cabecera: 'FFD9D9D9',
};

const relleno = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const borde: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
};

/** Filas vacías preparadas, con su formato, para pegar encima */
const FILAS_EN_BLANCO = 120;

export async function crearPlantilla(tiendas: TiendaMalla[] = []): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Ripley Track';

  const hoja = libro.addWorksheet('Matriz', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }],
  });

  // Fila 1: el nombre de cada bloque
  hoja.mergeCells('A1:C1');
  hoja.mergeCells('D1:J1');
  hoja.mergeCells('K1:Q1');
  hoja.mergeCells('R1:X1');
  const titulos: Array<[string, string, string]> = [
    ['A1', 'TIENDA', COLOR.cabecera],
    ['D1', 'TRANSFERENCIA — día de venta', COLOR.transferencia],
    ['K1', 'INTERMEDIO — se guarda, no entra en el cálculo', COLOR.intermedio],
    ['R1', 'RECEPCIÓN — admite +N (ej. A+7)', COLOR.recepcion],
  ];
  for (const [celda, texto, color] of titulos) {
    const c = hoja.getCell(celda);
    c.value = texto;
    c.font = { bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.fill = relleno(color);
  }

  // Fila 2: los encabezados que lee el backend. No se tocan
  hoja.getRow(2).values = ['Código', 'Tienda', 'Desfase', ...DIAS, ...DIAS, ...DIAS];
  hoja.getRow(2).eachCell((c, col) => {
    c.font = { bold: true };
    c.alignment = { horizontal: 'center' };
    c.border = borde;
    c.fill = relleno(col <= 3 ? COLOR.cabecera : col <= 10 ? COLOR.transferencia : col <= 17 ? COLOR.intermedio : COLOR.recepcion);
  });

  hoja.getColumn(1).width = 10;
  hoja.getColumn(2).width = 24;
  hoja.getColumn(3).width = 9;
  for (let col = 4; col <= 24; col++) hoja.getColumn(col).width = 9;

  // Las filas de datos: las guardadas, y después en blanco para pegar
  const filas = Math.max(tiendas.length + 20, FILAS_EN_BLANCO);
  for (let i = 0; i < filas; i++) {
    const n = i + 3;
    const fila = hoja.getRow(n);
    const t = tiendas[i];
    if (t) {
      fila.values = [t.codigo, t.tienda, t.desfase, ...t.transferencia, ...t.intermedio, ...t.recepcion]
        .map((v) => (v === null ? undefined : v)) as ExcelJS.CellValue[];
    }
    for (let col = 1; col <= 24; col++) {
      const c = fila.getCell(col);
      c.border = borde;
      if (col === 1 || col >= 4) c.numFmt = '@';
      if (col >= 4) c.alignment = { horizontal: 'center' };
      if (col >= 4 && col <= 10) c.fill = relleno(COLOR.transferenciaSuave);
      else if (col >= 11 && col <= 17) c.fill = relleno(COLOR.intermedioSuave);
      else if (col >= 18) c.fill = relleno(COLOR.recepcionSuave);
    }
    // El desfase, entero de 0 a 30: Excel avisa al escribirlo mal
    fila.getCell(3).dataValidation = {
      type: 'whole', operator: 'between', formulae: [0, 30], allowBlank: true, showErrorMessage: true,
      errorTitle: 'Desfase', error: 'El desfase es un número entero de 0 a 30.',
    };
  }

  const ayuda = libro.addWorksheet('Instrucciones');
  ayuda.getColumn(1).width = 110;
  const lineas = [
    ['Cómo rellenar la matriz de valle (Regular)', true],
    ['', false],
    ['1. Abre el Excel de la matriz que os pasan cada periodo.', false],
    ['2. Copia desde el primer código (columna A) hasta la última celda de la recepción (columna X), todas las tiendas.', false],
    ['3. En la hoja "Matriz" de esta plantilla, pégalo en la celda A3 (mejor como valores: Pegado especial → Valores).', false],
    ['4. Guarda y súbela en el apartado "Mallas Lead Time" del panel.', false],
    ['', false],
    ['Columnas (no las muevas ni borres; no cambies las filas 1 y 2):', true],
    ['A Código · B Tienda · C Desfase · D–J Transferencia (L M W J V S D) · K–Q Intermedio · R–X Recepción', false],
    ['', false],
    ['Reglas:', true],
    ['· Una celda de transferencia vacía es un día sin transferencia.', false],
    ['· Cada etiqueta de transferencia ("B", "P-A-11") se busca en la recepción: la columna donde aparece es el día de recepción.', false],
    ['· Una etiqueta de transferencia que no está en la recepción se ignora (el panel lo avisa).', false],
    ['· Una etiqueta no puede estar dos veces en la recepción de una misma tienda.', false],
    ['· "+N" (ej. "A+7") solo en la recepción: suma N días a esa recepción.', false],
    ['· El desfase es un número entero: los días entre la recepción y el despacho.', false],
    ['· El bloque intermedio se guarda tal cual, pero no entra en el cálculo.', false],
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
