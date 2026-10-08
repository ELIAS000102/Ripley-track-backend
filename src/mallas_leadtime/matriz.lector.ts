import ExcelJS from 'exceljs';
import { claveEtiqueta, leerCeldaRecepcion, paresDeTienda } from './matriz.calculo.js';
import { DIAS, NOMBRE_DIA, type LecturaMatriz, type TiendaMalla } from './interfaces/malla.interface.js';

/**
 * Lee la matriz de valle de un Excel: la plantilla del backend o el Excel
 * original, que tienen las mismas columnas.
 *
 *   A Código · B Tienda · C Desfase · D–J Transferencia · K–Q Intermedio · R–X Recepción
 *
 * La única diferencia es dónde está el encabezado: el original lo tiene en la
 * fila 1 y la plantilla en la 2, debajo de los títulos de cada bloque. Se busca
 * la fila que empieza por "Código" y se lee desde la siguiente.
 *
 * No se guarda nada que no se entienda. Un código raro, un desfase que no es
 * un número, un "+N" fuera de la recepción o una etiqueta repetida en la
 * recepción son **errores**, y con uno solo no se carga la matriz: guardar
 * media matriz es peor que no guardar ninguna. Una transferencia sin pareja
 * en la recepción no es un error —se ignora, es la regla—, pero se avisa.
 */

/** Los encabezados de las 24 columnas, como se esperan */
const ENCABEZADO = ['codigo', 'tienda', 'desfase', ...DIAS, ...DIAS, ...DIAS].map((x) => x.toLowerCase());

/** Cuántos errores se devuelven como mucho: más no ayuda a corregir */
const ERRORES_MAXIMOS = 50;

const LETRA_COLUMNA = (n: number) => String.fromCharCode(64 + n);

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * El texto de una celda, venga como venga: número, texto, texto con formato o
 * fórmula. Un espacio suelto —el original tiene muchos— cuenta como vacío.
 */
export function textoDeCelda(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (typeof valor === 'string') return valor.replace(/ /g, ' ').trim();
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'object') {
    if ('richText' in valor) return valor.richText.map((t) => t.text).join('').trim();
    if ('result' in valor) return textoDeCelda(valor.result as ExcelJS.CellValue);
    if ('text' in valor) return String(valor.text).trim();
  }
  return '';
}

/** La hoja y la fila del encabezado: la primera fila que empieza por "Código" */
function buscarEncabezado(libro: ExcelJS.Workbook): { hoja: ExcelJS.Worksheet; fila: number } | null {
  // La de la plantilla se llama "Matriz"; si no, la primera que lo tenga
  const hojas = [...libro.worksheets].sort((a, b) => Number(b.name === 'Matriz') - Number(a.name === 'Matriz'));
  for (const hoja of hojas) {
    for (let fila = 1; fila <= Math.min(10, hoja.rowCount); fila++) {
      if (normalizar(textoDeCelda(hoja.getRow(fila).getCell(1).value)) === 'codigo') return { hoja, fila };
    }
  }
  return null;
}

export async function leerMatriz(contenido: Buffer): Promise<LecturaMatriz> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(contenido as unknown as ArrayBuffer);
  } catch {
    return { hoja: '', tiendas: [], avisos: [], errores: ['El archivo no es un Excel .xlsx que se pueda abrir.'] };
  }

  const encontrado = buscarEncabezado(libro);
  if (!encontrado) {
    return {
      hoja: '', tiendas: [], avisos: [],
      errores: ['No encontré la fila de encabezado: la columna A tiene que empezar por "Código", como en la plantilla.'],
    };
  }

  const { hoja, fila: filaEncabezado } = encontrado;
  const errores: string[] = [];
  const avisos: string[] = [];
  const anotar = (texto: string) => { if (errores.length < ERRORES_MAXIMOS) errores.push(texto); };

  // Las 24 columnas, en su sitio: si una se movió, todo lo demás se leería corrido
  const encabezado = hoja.getRow(filaEncabezado);
  ENCABEZADO.forEach((esperado, i) => {
    const visto = normalizar(textoDeCelda(encabezado.getCell(i + 1).value));
    if (visto !== esperado) {
      anotar(`El encabezado de la columna ${LETRA_COLUMNA(i + 1)} dice "${visto || '(vacío)'}" y debería decir "${esperado.toUpperCase()}". No muevas ni borres columnas de la plantilla.`);
    }
  });
  if (errores.length) return { hoja: hoja.name, tiendas: [], avisos, errores };

  const tiendas: TiendaMalla[] = [];
  const vistos = new Map<string, number>();

  for (let n = filaEncabezado + 1; n <= hoja.rowCount; n++) {
    const fila = hoja.getRow(n);
    const celdas = Array.from({ length: 24 }, (_, i) => textoDeCelda(fila.getCell(i + 1).value));
    if (celdas.every((c) => !c)) continue;

    const [codigoCrudo, tienda, desfaseCrudo] = celdas;
    const codigo = codigoCrudo.replace(/\.0+$/, '');
    const donde = `Fila ${n}${codigo ? ` (${codigo}${tienda ? ` ${tienda}` : ''})` : ''}`;
    let bien = true;

    if (!/^\d{3,6}$/.test(codigo)) {
      anotar(`${donde}: el código "${codigoCrudo || '(vacío)'}" no es válido; son de 3 a 6 cifras.`);
      bien = false;
    } else if (vistos.has(codigo)) {
      anotar(`${donde}: el código ${codigo} ya está en la fila ${vistos.get(codigo)}.`);
      bien = false;
    } else {
      vistos.set(codigo, n);
    }

    const desfase = Number(desfaseCrudo);
    if (desfaseCrudo === '' || !Number.isInteger(desfase) || desfase < 0 || desfase > 30) {
      anotar(`${donde}: el desfase "${desfaseCrudo || '(vacío)'}" tiene que ser un número entero de 0 a 30.`);
      bien = false;
    }

    const bloque = (desde: number) => celdas.slice(desde, desde + 7).map((c) => c || null);
    const transferencia = bloque(3);
    const intermedio = bloque(10);
    const recepcion = bloque(17);

    // "+N" solo en la recepción
    for (const [nombre, celdasBloque, desde] of [['transferencia', transferencia, 4], ['intermedio', intermedio, 11]] as const) {
      celdasBloque.forEach((c, i) => {
        if (c && /\+/.test(c)) {
          anotar(`${donde}: "${c}" en la columna ${LETRA_COLUMNA(desde + i)} (${nombre}): el "+N" solo va en la recepción.`);
          bien = false;
        }
      });
    }

    // Una etiqueta dos veces en la recepción: no se sabría cuál le toca
    const enRecepcion = new Map<string, number>();
    recepcion.forEach((c, i) => {
      if (!c) return;
      if (/\+/.test(c) && !/^.+?\s*\+\s*\d+$/.test(c)) {
        anotar(`${donde}: "${c}" en la columna ${LETRA_COLUMNA(18 + i)}: un "+N" se escribe como "A+7".`);
        bien = false;
        return;
      }
      const clave = claveEtiqueta(leerCeldaRecepcion(c)!.etiqueta);
      if (enRecepcion.has(clave)) {
        anotar(`${donde}: la etiqueta "${clave}" está dos veces en la recepción (${NOMBRE_DIA[DIAS[enRecepcion.get(clave)!]]} y ${NOMBRE_DIA[DIAS[i]]}): no se sabe cuál toca.`);
        bien = false;
      }
      enRecepcion.set(clave, i);
    });

    if (!bien) continue;

    const leida: TiendaMalla = { codigo, tienda, desfase, transferencia, intermedio, recepcion };
    const { pares, ignoradas } = paresDeTienda(leida);
    for (const ig of ignoradas) {
      avisos.push(`${codigo} ${tienda}: el ${NOMBRE_DIA[ig.dia]} (${ig.etiqueta}) no tiene recepción y se ignora.`);
    }
    if (!pares.length) avisos.push(`${codigo} ${tienda}: no tiene ningún día de transferencia con recepción.`);

    tiendas.push(leida);
  }

  if (!tiendas.length && !errores.length) errores.push('La matriz no tiene ninguna tienda.');

  return { hoja: hoja.name, tiendas: errores.length ? [] : tiendas, avisos, errores };
}
