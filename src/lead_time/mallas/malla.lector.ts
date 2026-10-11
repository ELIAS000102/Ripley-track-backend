import ExcelJS from 'exceljs';
import { DIAS, NOMBRE_DIA, type Dia } from '../matrices/interfaces/matriz.interface.js';
import { textoDeCelda } from '../matrices/matriz.lector.js';
import type { Lectura } from '../versionado.service.js';
import type { DiaMalla, OplMalla } from './interfaces/malla.interface.js';

/**
 * Lee mallas con el formato de la operación: una fila por OPL y día de venta,
 * y a la derecha una columna por día del calendario con "Venta", "Transito" y
 * "Despacho" en su día.
 *
 *   OPL · T. de servicio · Lunes · Martes · Miércoles · … (dos o tres semanas)
 *
 * Se busca la fila del encabezado —la que empieza por "OPL"— y en ella las
 * columnas: las que dicen un día de la semana son el calendario; "T. de
 * servicio", el tipo de servicio; "OPL_NAME" o "Nombre", el nombre (opcional);
 * "Día", el día de venta (opcional: si está, se comprueba contra la celda
 * "Venta"). Vale la plantilla del backend y también el Excel de la operación
 * tal cual, con sus fechas encima del encabezado.
 *
 * Varias OPLs en un solo archivo. Como en las matrices, no se guarda nada que
 * no se entienda: con un solo error no se carga.
 */

const ERRORES_MAXIMOS = 50;

const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_.]+/g, ' ').trim();

const DIA_DE: Record<string, Dia> = {
  lunes: 'L', lun: 'L', martes: 'M', mar: 'M', miercoles: 'W', mie: 'W', jueves: 'J', jue: 'J',
  viernes: 'V', vie: 'V', sabado: 'S', sab: 'S', domingo: 'D', dom: 'D',
};

type Marca = 'venta' | 'transito' | 'despacho';
const MARCA: Record<string, Marca> = { venta: 'venta', transito: 'transito', despacho: 'despacho' };

function letra(n: number) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function buscarEncabezado(libro: ExcelJS.Workbook): { hoja: ExcelJS.Worksheet; fila: number } | null {
  const hojas = [...libro.worksheets].sort((a, b) => Number(b.name === 'Malla') - Number(a.name === 'Malla'));
  for (const hoja of hojas) {
    for (let fila = 1; fila <= Math.min(10, hoja.rowCount); fila++) {
      if (normalizar(textoDeCelda(hoja.getRow(fila).getCell(1).value)) === 'opl') return { hoja, fila };
    }
  }
  return null;
}

export async function leerMalla(contenido: Buffer): Promise<Lectura<OplMalla>> {
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

  // Las columnas, por lo que dice su encabezado
  const encabezado = hoja.getRow(filaEncabezado);
  const calendario: Array<{ col: number; dia: Dia }> = [];
  let colServicio = 0;
  let colNombre = 0;
  let colDia = 0;
  for (let col = 2; col <= Math.max(hoja.columnCount, encabezado.cellCount); col++) {
    const h = normalizar(textoDeCelda(encabezado.getCell(col).value));
    if (!h) continue;
    if (DIA_DE[h]) calendario.push({ col, dia: DIA_DE[h] });
    else if (h.includes('servicio')) colServicio ||= col;
    else if (h.includes('name') || h.includes('nombre')) colNombre ||= col;
    else if (h === 'dia' || h.startsWith('dia ')) colDia ||= col;
  }

  if (calendario.length < 7) {
    return { items: [], avisos: [], errores: [`El encabezado (fila ${filaEncabezado}) tiene que llevar los días del calendario: Lunes, Martes, Miércoles… al menos una semana entera.`] };
  }
  for (let i = 1; i < calendario.length; i++) {
    const [a, b] = [calendario[i - 1], calendario[i]];
    if (b.col !== a.col + 1 || DIAS.indexOf(b.dia) !== (DIAS.indexOf(a.dia) + 1) % 7) {
      return { items: [], avisos: [], errores: [`Los días del calendario tienen que ir seguidos y en orden: después del ${NOMBRE_DIA[a.dia]} (columna ${letra(a.col)}) va el ${NOMBRE_DIA[DIAS[(DIAS.indexOf(a.dia) + 1) % 7]]} en la columna ${letra(a.col + 1)}.`] };
    }
  }
  if (!colServicio) {
    return { items: [], avisos: [], errores: ['Falta la columna "T. de servicio" en el encabezado, junto a "OPL".'] };
  }

  const errores: string[] = [];
  const avisos: string[] = [];
  const anotar = (texto: string) => { if (errores.length < ERRORES_MAXIMOS) errores.push(texto); };
  const opls = new Map<string, OplMalla>();
  const filaDe = new Map<string, number>();

  for (let n = filaEncabezado + 1; n <= hoja.rowCount; n++) {
    const fila = hoja.getRow(n);
    const codigoCrudo = textoDeCelda(fila.getCell(1).value);
    const marcas = calendario.map((c, i) => ({ i, texto: textoDeCelda(fila.getCell(c.col).value) })).filter((m) => m.texto);
    if (!codigoCrudo && !marcas.length) continue;

    const codigo = codigoCrudo.replace(/\.0+$/, '');
    const servicio = textoDeCelda(fila.getCell(colServicio).value);
    const nombre = colNombre ? textoDeCelda(fila.getCell(colNombre).value) : '';
    const donde = `Fila ${n}${codigo ? ` (OPL ${codigo})` : ''}`;

    if (!/^[A-Za-z0-9._-]{1,20}$/.test(codigo)) {
      anotar(`${donde}: el código de OPL "${codigoCrudo || '(vacío)'}" no es válido; son letras, números, punto, guion o guion bajo, hasta 20.`);
      continue;
    }
    if (!servicio) {
      anotar(`${donde}: falta el tipo de servicio.`);
      continue;
    }

    const posiciones: Record<Marca, number[]> = { venta: [], transito: [], despacho: [] };
    for (const m of marcas) {
      const marca = MARCA[normalizar(m.texto)];
      if (marca) posiciones[marca].push(m.i);
      else avisos.push(`${donde}: "${m.texto}" en la columna ${letra(calendario[m.i].col)} no es Venta, Transito ni Despacho; se ignora.`);
    }
    const [venta, transito, despacho] = [posiciones.venta, posiciones.transito, posiciones.despacho];
    if (venta.length !== 1 || despacho.length !== 1 || transito.length > 1) {
      anotar(`${donde}: tiene que llevar una "Venta", una "Despacho" y como mucho una "Transito"; lleva ${venta.length}, ${despacho.length} y ${transito.length}.`);
      continue;
    }
    const [v, d, t] = [venta[0], despacho[0], transito[0] ?? null];
    if (d <= v || (t !== null && (t <= v || t >= d))) {
      anotar(`${donde}: el orden tiene que ser Venta, Transito y Despacho, cada una en un día posterior a la anterior.`);
      continue;
    }

    const diaVenta = calendario[v].dia;
    if (colDia) {
      const dicho = DIA_DE[normalizar(textoDeCelda(fila.getCell(colDia).value))];
      if (dicho && dicho !== diaVenta) {
        anotar(`${donde}: la columna Día dice ${NOMBRE_DIA[dicho]}, pero la "Venta" está en un ${NOMBRE_DIA[diaVenta]}.`);
        continue;
      }
    }

    const opl = opls.get(codigo) ?? { codigo, nombre, servicio, dias: Array<DiaMalla | null>(7).fill(null) };
    if (!opls.has(codigo)) opls.set(codigo, opl);
    else if (servicio !== opl.servicio) {
      anotar(`${donde}: la OPL ${codigo} ya tiene el tipo de servicio "${opl.servicio}" en otra fila. Una OPL tiene una sola malla por grupo: otro tipo de servicio va en su propio grupo.`);
      continue;
    }
    if (!opl.nombre && nombre) opl.nombre = nombre;

    const i = DIAS.indexOf(diaVenta);
    const clave = `${codigo}|${i}`;
    if (filaDe.has(clave)) {
      anotar(`${donde}: la OPL ${codigo} ya tiene una venta el ${NOMBRE_DIA[diaVenta]} en la fila ${filaDe.get(clave)}.`);
      continue;
    }
    filaDe.set(clave, n);
    opl.dias[i] = { transito: t === null ? null : t - v, despacho: d - v };
  }

  const items = [...opls.values()];
  for (const o of items) {
    const faltan = DIAS.filter((_, i) => !o.dias[i]).map((d) => NOMBRE_DIA[d]);
    if (faltan.length) avisos.push(`OPL ${o.codigo}: no tiene venta el ${faltan.join(', ')}; lo vendido esos días va con el siguiente día que sí.`);
  }
  if (!items.length && !errores.length) errores.push('La malla no tiene ninguna OPL.');

  return { items: errores.length ? [] : items, avisos, errores };
}
