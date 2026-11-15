import ExcelJS from 'exceljs';

/** Lo que comparten los lectores de matrices y de mallas al abrir un Excel */

/**
 * El texto de una celda, venga como venga: número, texto, texto con formato o
 * fórmula. Un espacio suelto —el original tiene muchos— cuenta como vacío.
 */
export function textoDeCelda(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (typeof valor === 'string') return valor.replace(/ /g, ' ').trim();
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'object') {
    if ('richText' in valor)
      return valor.richText
        .map((t) => t.text)
        .join('')
        .trim();
    if ('result' in valor) return textoDeCelda(valor.result as ExcelJS.CellValue);
    if ('text' in valor) return String(valor.text).trim();
  }
  return '';
}

/**
 * La hoja y la fila del encabezado: en las 10 primeras filas, la primera cuya
 * columna A es el encabezado. Primero se mira la hoja que lleva el nombre de la
 * plantilla ("Matriz", "Malla"); si no, la primera hoja que lo tenga.
 */
export function buscarEncabezado(
  libro: ExcelJS.Workbook,
  hojaDeLaPlantilla: string,
  esEncabezado: (textoColumnaA: string) => boolean,
): { hoja: ExcelJS.Worksheet; fila: number } | null {
  const hojas = [...libro.worksheets].sort(
    (a, b) => Number(b.name === hojaDeLaPlantilla) - Number(a.name === hojaDeLaPlantilla),
  );
  for (const hoja of hojas) {
    for (let fila = 1; fila <= Math.min(10, hoja.rowCount); fila++) {
      if (esEncabezado(textoDeCelda(hoja.getRow(fila).getCell(1).value))) return { hoja, fila };
    }
  }
  return null;
}
