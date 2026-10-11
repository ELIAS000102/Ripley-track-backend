import ExcelJS from 'exceljs';
import { DIAS } from '../mallas_leadtime/interfaces/malla.interface.js';
import { leerDia } from './malla-despacho.calculo.js';
import type { OplMalla } from './interfaces/malla-despacho.interface.js';

/**
 * La plantilla semanal de una malla de despacho: una fila por OPL y día de
 * venta, con el día en tránsito y el de despacho.
 *
 * Los colores son los de la malla de la operación: amarillo la venta, morado
 * el tránsito, verde el despacho. La hoja "Instrucciones" lleva un ejemplo.
 *
 * Con `opls` sale rellena: es la malla guardada, lista para corregirla y
 * volver a cargarla.
 */

const COLOR = {
  cabecera: 'FFD9D9D9',
  venta: 'FFFFFF00', ventaSuave: 'FFFFFFCC',
  transito: 'FFDA70D6', transitoSuave: 'FFF5DDF3',
  despacho: 'FF92D050', despachoSuave: 'FFE2EFDA',
};

const NOMBRES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** "J+7" → "Jueves+7", para que la plantilla rellena se lea como se escribe */
function aNombre(guardado: string | null): string | undefined {
  const d = leerDia(guardado);
  if (!d) return undefined;
  const nombre = NOMBRES[DIAS.indexOf(d.dia)];
  return d.suma ? `${nombre}+${d.suma}` : nombre;
}

const relleno = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const borde: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
};

const FILAS_EN_BLANCO = 140;

export async function crearPlantillaDespacho(opls: OplMalla[] = []): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Ripley Track';

  const hoja = libro.addWorksheet('Malla', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });

  hoja.mergeCells('A1:B1');
  const titulos: Array<[string, string, string]> = [
    ['A1', 'OPERADOR LOGÍSTICO', COLOR.cabecera],
    ['C1', 'VENTA', COLOR.venta],
    ['D1', 'TRÁNSITO — opcional, admite +N', COLOR.transito],
    ['E1', 'DESPACHO — admite +N', COLOR.despacho],
  ];
  for (const [celda, texto, color] of titulos) {
    const c = hoja.getCell(celda);
    c.value = texto;
    c.font = { bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.fill = relleno(color);
  }

  hoja.getRow(2).values = ['OPL', 'OPL_NAME', 'Día venta', 'Día tránsito', 'Día despacho'];
  const colorCol = [COLOR.cabecera, COLOR.cabecera, COLOR.venta, COLOR.transito, COLOR.despacho];
  hoja.getRow(2).eachCell((c, col) => {
    c.font = { bold: true };
    c.alignment = { horizontal: 'center' };
    c.border = borde;
    c.fill = relleno(colorCol[col - 1]);
  });

  [10, 28, 14, 16, 16].forEach((w, i) => { hoja.getColumn(i + 1).width = w; });

  const filasGuardadas = opls.flatMap((o) => o.dias.flatMap((d, i) => (d ? [[o.codigo, o.nombre, NOMBRES[i], aNombre(d.transito), aNombre(d.despacho)]] : [])));
  const lista = `"${NOMBRES.join(',')}"`;
  const suave = [undefined, undefined, COLOR.ventaSuave, COLOR.transitoSuave, COLOR.despachoSuave];

  const filas = Math.max(filasGuardadas.length + 21, FILAS_EN_BLANCO);
  for (let i = 0; i < filas; i++) {
    const fila = hoja.getRow(i + 3);
    if (filasGuardadas[i]) fila.values = filasGuardadas[i] as ExcelJS.CellValue[];
    for (let col = 1; col <= 5; col++) {
      const c = fila.getCell(col);
      c.border = borde;
      if (col === 1) c.numFmt = '@';
      if (col >= 3) c.alignment = { horizontal: 'center' };
      if (suave[col - 1]) c.fill = relleno(suave[col - 1]!);
    }
    // El día de venta, de la lista; tránsito y despacho también, pero admiten "+N": solo avisa
    fila.getCell(3).dataValidation = {
      type: 'list', allowBlank: true, formulae: [lista], showErrorMessage: true,
      errorTitle: 'Día de venta', error: 'Elige un día de la semana: Lunes … Domingo.',
    };
    for (const col of [4, 5]) {
      fila.getCell(col).dataValidation = {
        type: 'list', allowBlank: true, formulae: [lista], showErrorMessage: true, errorStyle: 'warning',
        errorTitle: 'Día', error: 'Un día de la semana; para sumar días escribe "+N", por ejemplo "Lunes+7".',
      };
    }
  }

  const ayuda = libro.addWorksheet('Instrucciones');
  ayuda.getColumn(1).width = 110;
  const lineas = [
    ['Cómo rellenar una malla de despacho', true],
    ['', false],
    ['Una fila por OPL y día de venta: qué día va en tránsito lo vendido ese día y qué día se despacha.', false],
    ['Pégala desde la celda A3 de la hoja "Malla" y súbela en el apartado "Mallas de despacho" del panel.', false],
    ['', false],
    ['Columnas (no las muevas ni borres; no cambies las filas 1 y 2):', true],
    ['A OPL (código) · B OPL_NAME · C Día venta · D Día tránsito · E Día despacho', false],
    ['', false],
    ['Reglas:', true],
    ['· Los días se escriben con su nombre (Lunes, Miércoles…), abreviados (Lun, Mié) o con su letra (L M W J V S D).', false],
    ['· El tránsito es el primer día con ese nombre desde la venta; el despacho, el primero desde el tránsito.', false],
    ['· El mismo día de la semana es el mismo día. Para la semana siguiente suma 7: "Lunes+7".', false],
    ['· "+N" suma N días a ese paso (hasta 30). El tránsito puede quedar vacío; el despacho no.', false],
    ['· Una OPL no puede tener el mismo día de venta dos veces. Si le falta un día, lo vendido ese día va con el siguiente.', false],
    ['', false],
    ['Ejemplo (OPL 4014 SD_PIURA_FE):', true],
    ['4014 | SD_PIURA_FE | Lunes     | Miércoles | Jueves   → 3 días', false],
    ['4014 | SD_PIURA_FE | Viernes   | Lunes     | Martes   → 4 días', false],
    ['4014 | SD_PIURA_FE | Domingo   | Miércoles | Jueves   → 4 días', false],
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
