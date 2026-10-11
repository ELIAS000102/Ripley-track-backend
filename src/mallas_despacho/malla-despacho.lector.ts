import ExcelJS from 'exceljs';
import { DIAS, NOMBRE_DIA } from '../mallas_leadtime/interfaces/malla.interface.js';
import { textoDeCelda } from '../mallas_leadtime/matriz.lector.js';
import type { Lectura } from '../mallas_leadtime/versionado.service.js';
import { escribirDia, leerDia, SUMA_MAXIMA } from './malla-despacho.calculo.js';
import type { OplMalla } from './interfaces/malla-despacho.interface.js';

/**
 * Lee una malla de despacho de la plantilla semanal:
 *
 *   A OPL · B OPL_NAME · C Día venta · D Día tránsito · E Día despacho
 *
 * Una fila por OPL y día de venta. Se busca la fila del encabezado —la que
 * empieza por "OPL"— y se lee desde la siguiente.
 *
 * Como la matriz, no se guarda nada que no se entienda: un código raro, un día
 * que no es un día o una OPL con el mismo día de venta dos veces son
 * **errores**, y con uno solo no se carga. Que a una OPL le falte un día de
 * venta no es un error —lo vendido ese día va con el siguiente—, pero se avisa.
 */

const ERRORES_MAXIMOS = 50;

const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_]+/g, ' ').trim();

/** Qué tiene que decir cada columna del encabezado: basta con que lo contenga */
const ENCABEZADO: Array<[string, (s: string) => boolean]> = [
  ['OPL', (s) => s === 'opl'],
  ['OPL_NAME', (s) => s === 'opl name' || s.includes('nombre')],
  ['Día venta', (s) => s.includes('venta')],
  ['Día tránsito', (s) => s.includes('transito')],
  ['Día despacho', (s) => s.includes('despacho')],
];

const LETRA = 'ABCDE';

function buscarEncabezado(libro: ExcelJS.Workbook): { hoja: ExcelJS.Worksheet; fila: number } | null {
  const hojas = [...libro.worksheets].sort((a, b) => Number(b.name === 'Malla') - Number(a.name === 'Malla'));
  for (const hoja of hojas) {
    for (let fila = 1; fila <= Math.min(10, hoja.rowCount); fila++) {
      if (normalizar(textoDeCelda(hoja.getRow(fila).getCell(1).value)) === 'opl') return { hoja, fila };
    }
  }
  return null;
}

export async function leerMallaDespacho(contenido: Buffer): Promise<Lectura<OplMalla>> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(contenido as unknown as ArrayBuffer);
  } catch {
    return { items: [], avisos: [], errores: ['El archivo no es un Excel .xlsx que se pueda abrir.'] };
  }

  const encontrado = buscarEncabezado(libro);
  if (!encontrado) {
    return { items: [], avisos: [], errores: ['No encontré la fila de encabezado: la columna A tiene que empezar por "OPL", como en la plantilla.'] };
  }

  const { hoja, fila: filaEncabezado } = encontrado;
  const errores: string[] = [];
  const avisos: string[] = [];
  const anotar = (texto: string) => { if (errores.length < ERRORES_MAXIMOS) errores.push(texto); };

  const encabezado = hoja.getRow(filaEncabezado);
  ENCABEZADO.forEach(([esperado, vale], i) => {
    const visto = normalizar(textoDeCelda(encabezado.getCell(i + 1).value));
    if (!vale(visto)) anotar(`El encabezado de la columna ${LETRA[i]} dice "${visto || '(vacío)'}" y debería decir "${esperado}". No muevas ni borres columnas de la plantilla.`);
  });
  if (errores.length) return { items: [], avisos, errores };

  const opls = new Map<string, OplMalla>();
  const filaDe = new Map<string, number>();

  for (let n = filaEncabezado + 1; n <= hoja.rowCount; n++) {
    const fila = hoja.getRow(n);
    const [codigoCrudo, nombre, venta, transito, despacho] = Array.from({ length: 5 }, (_, i) => textoDeCelda(fila.getCell(i + 1).value));
    if (![codigoCrudo, nombre, venta, transito, despacho].some(Boolean)) continue;

    const codigo = codigoCrudo.replace(/\.0+$/, '');
    const donde = `Fila ${n}${codigo ? ` (${codigo}${nombre ? ` ${nombre}` : ''})` : ''}`;
    let bien = true;

    if (!/^[A-Za-z0-9._-]{1,20}$/.test(codigo)) {
      anotar(`${donde}: el código de OPL "${codigoCrudo || '(vacío)'}" no es válido; son letras, números, punto, guion o guion bajo, hasta 20.`);
      bien = false;
    }

    const diaVenta = leerDia(venta);
    if (!diaVenta || diaVenta.suma) {
      anotar(`${donde}: el día de venta "${venta || '(vacío)'}" no es un día de la semana (Lunes … Domingo), sin "+N".`);
      bien = false;
    }
    const diaTransito = leerDia(transito);
    if (diaTransito === undefined) {
      anotar(`${donde}: el día de tránsito "${transito}" no es un día de la semana; puede llevar "+N" hasta ${SUMA_MAXIMA} o quedar vacío.`);
      bien = false;
    }
    const diaDespacho = leerDia(despacho);
    if (!diaDespacho) {
      anotar(`${donde}: el día de despacho "${despacho || '(vacío)'}" no es un día de la semana; puede llevar "+N" hasta ${SUMA_MAXIMA}.`);
      bien = false;
    }
    if (!bien) continue;

    const opl = opls.get(codigo) ?? { codigo, nombre, dias: Array<null>(7).fill(null) };
    if (!opls.has(codigo)) opls.set(codigo, opl);
    else if (nombre && opl.nombre && nombre !== opl.nombre) {
      avisos.push(`${donde}: la OPL ${codigo} se llama "${opl.nombre}" en otra fila; se queda ese nombre.`);
    }
    if (!opl.nombre && nombre) opl.nombre = nombre;

    const i = DIAS.indexOf(diaVenta!.dia);
    const clave = `${codigo}|${i}`;
    if (filaDe.has(clave)) {
      anotar(`${donde}: la OPL ${codigo} ya tiene el ${NOMBRE_DIA[DIAS[i]]} como día de venta en la fila ${filaDe.get(clave)}.`);
      continue;
    }
    filaDe.set(clave, n);
    opl.dias[i] = { transito: diaTransito ? escribirDia(diaTransito) : null, despacho: escribirDia(diaDespacho!) };
  }

  const items = [...opls.values()];
  for (const o of items) {
    const faltan = DIAS.filter((_, i) => !o.dias[i]).map((d) => NOMBRE_DIA[d]);
    if (faltan.length) avisos.push(`${o.codigo} ${o.nombre}: no tiene fila para ${faltan.join(', ')}; lo vendido esos días va con el siguiente día que sí.`);
  }
  if (!items.length && !errores.length) errores.push('La malla no tiene ninguna OPL.');

  return { items: errores.length ? [] : items, avisos, errores };
}
