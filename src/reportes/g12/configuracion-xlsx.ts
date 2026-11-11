import ExcelJS from 'exceljs';
import { CAMPOS_G12, COMPONENTES_G12, definicionDe } from './g12.componentes.js';
import type {
  BloqueG12,
  ClaveComponente,
  ComponenteG12,
  ConfiguracionG12,
  LineaResumenG12,
  TipoBloqueG12,
} from './interfaces/g12.interface.js';

/**
 * La configuración del G12 en un Excel: para guardarla, revisarla o editarla a
 * mano y volver a importarla (decisión del usuario, 2026-11-11: en .xlsx, no en
 * .json).
 *
 * Una hoja por tipo de bloque, porque cada tipo tiene sus columnas. Cada fila
 * de esas hojas es un ítem; "Bloque" dice a qué bloque del cuadro pertenece
 * (1, 2, 3… en el orden del editor), y lo que es del bloque entero —la muestra,
 * su nota— se lee de su primera fila. Todo va con nombres y códigos, nunca con
 * ids, como en el editor.
 */

/** Cómo se llama cada tipo de bloque en su hoja */
const HOJA_DE: Record<TipoBloqueG12, string> = {
  simulacion: 'Simulación',
  picking: 'Picking',
  recepcion: 'Recepción',
  despacho: 'Despacho',
  capacidad: 'Cupos a mano',
};

/** Cómo se titula cada campo en las columnas */
const ETIQUETA: Record<string, string> = {
  servicio: 'Servicio', metodo: 'Método', operador: 'Operador', almacen: 'Almacén',
  region: 'Región', provincia: 'Provincia', distrito: 'Distrito', sku: 'SKU', cantidad: 'Cantidad',
  canal: 'Canal', hora: 'Hora', codigo: 'Código', agenda: 'Agenda', zona: 'Zona',
  lun: 'Lun', mar: 'Mar', mie: 'Mié', jue: 'Jue', vie: 'Vie', sab: 'Sáb', dom: 'Dom',
};

const NARANJA = 'FFC2410C';

const comparable = (s: unknown) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();

// ───────────────────────── Exportar ─────────────────────────

export async function configuracionAXlsx(config: ConfiguracionG12, pais: string, exportado = new Date()): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Ripley Track';

  const cabecera = (hoja: ExcelJS.Worksheet, columnas: Array<[string, number]>) => {
    hoja.columns = columnas.map(([header, width]) => ({ header, width }));
    const fila = hoja.getRow(1);
    fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NARANJA } };
    hoja.views = [{ state: 'frozen', ySplit: 1 }];
  };

  // ── Léeme ──
  const leeme = libro.addWorksheet('Léeme');
  leeme.columns = [{ width: 24 }, { width: 110 }];
  const lineas: Array<[string, string]> = [
    ['Configuración del G12', ''],
    ['País', pais],
    ['Exportada', exportado.toISOString()],
    ['', ''],
    ['Cómo se importa', 'En el panel: Reporte G12 → Configuración → Importar. Se comprueba entera y entra en el editor; se guarda al pulsar "Guardar".'],
    ['Cuadro', `El título del cuadro, tal cual: ${COMPONENTES_G12.map((c) => c.titulo).join(', ')}.`],
    ['Filas', 'Las filas de cada cuadro, en orden. "Suma" solo en las filas de total: los nombres de las filas que suma, separados por " | ".'],
    ['Bloque', 'Cada ítem dice a qué bloque de su cuadro pertenece (1, 2, 3… en el orden del editor). Un bloque es de un solo tipo: todos sus ítems van en la misma hoja.'],
    ['Muestra', 'Solo en Simulación: "Sí" en la primera fila del bloque para probar un ítem antes de pedir los demás.'],
    ['Nombres, no ids', 'Región, provincia, distrito, operador, almacén, zona y agenda van por su nombre o código, como en el editor.'],
    ['Resumen', 'Cada línea del resumen de consumo y lo que suma: un cuadro entero (Fila vacía) o una fila suya.'],
  ];
  for (const [k, v] of lineas) leeme.addRow([k, v]).getCell(1).font = { bold: true };
  leeme.getRow(1).font = { bold: true, size: 14 };
  leeme.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  // ── Filas ──
  const filas = libro.addWorksheet('Filas');
  cabecera(filas, [['Cuadro', 28], ['Fila', 34], ['Suma (filas de total)', 60]]);
  for (const c of config.componentes) {
    for (const f of c.filas) filas.addRow([definicionDe(c.clave).titulo, f.nombre, (f.suma ?? []).join(' | ')]);
  }

  // ── Una hoja por tipo de bloque ──
  for (const tipo of Object.keys(HOJA_DE) as TipoBloqueG12[]) {
    const campos = CAMPOS_G12[tipo].map((c) => c.clave);
    const hoja = libro.addWorksheet(HOJA_DE[tipo]);
    cabecera(hoja, [
      ['Cuadro', 28], ['Bloque', 8], ...(tipo === 'simulacion' ? [['Muestra', 9] as [string, number]] : []),
      ['Fila', 30], ...campos.map((k) => [ETIQUETA[k] ?? k, tipo === 'capacidad' ? 8 : 14] as [string, number]),
      ['Nota del ítem', 30], ['Nota del bloque', 30],
    ]);
    for (const c of config.componentes) {
      c.bloques.forEach((b, i) => {
        if (b.tipo !== tipo) return;
        b.items.forEach((it, k) => {
          hoja.addRow([
            definicionDe(c.clave).titulo, i + 1, ...(tipo === 'simulacion' ? [k === 0 && b.muestra ? 'Sí' : ''] : []),
            it.fila, ...campos.map((campo) => it.campos[campo] ?? ''),
            it.nota ?? '', k === 0 ? b.nota ?? '' : '',
          ]);
        });
      });
    }
  }

  // ── Resumen ──
  const resumen = libro.addWorksheet('Resumen');
  cabecera(resumen, [['Línea', 30], ['Cuadro', 28], ['Fila (vacía: el cuadro entero)', 34]]);
  for (const l of config.resumen) {
    for (const p of l.partes) resumen.addRow([l.nombre, definicionDe(p.componente).titulo, p.fila ?? '']);
  }

  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** "G12-configuracion-PE-2026-11-11-0831.xlsx", con la hora del país */
export function nombreXlsxConfiguracion(pais: string, cuando = new Date()): string {
  const zona = pais === 'CL' ? 'America/Santiago' : 'America/Lima';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(cuando).map((x) => [x.type, x.value]));
  return `G12-configuracion-${pais}-${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}.xlsx`;
}

// ───────────────────────── Importar ─────────────────────────

/**
 * Lee el Excel y arma la configuración. Lo que no se entiende (un cuadro que no
 * existe, un bloque con ítems en dos hojas) va a `errores` con su hoja y su
 * fila; el resto —que la fila exista, que el tipo valga en el cuadro, que no
 * falten campos— lo comprueba después `normalizarConfiguracion`, como al guardar.
 */
export async function xlsxAConfiguracion(contenido: Buffer): Promise<{ configuracion: ConfiguracionG12; errores: string[] }> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(contenido as unknown as ArrayBuffer);
  } catch {
    return { configuracion: { componentes: [], resumen: [] }, errores: ['El archivo no es un Excel .xlsx que se pueda leer.'] };
  }

  const errores: string[] = [];
  const porCuadro = new Map<ClaveComponente, ComponenteG12>();
  const cuadro = (texto: unknown, donde: string): ComponenteG12 | null => {
    const buscado = comparable(texto);
    const def = COMPONENTES_G12.find((c) => comparable(c.titulo) === buscado || comparable(c.clave) === buscado);
    if (!def) {
      if (buscado) errores.push(`${donde}: "${texto}" no es un cuadro del G12.`);
      else errores.push(`${donde}: falta el cuadro.`);
      return null;
    }
    if (!porCuadro.has(def.clave)) porCuadro.set(def.clave, { clave: def.clave, filas: [], bloques: [] });
    return porCuadro.get(def.clave)!;
  };

  const filasDe = (nombre: string) => {
    const hoja = libro.worksheets.find((h) => comparable(h.name) === comparable(nombre));
    if (!hoja) return null;
    const titulos = (hoja.getRow(1).values as unknown[]).map((v) => comparable(textoDe(v)));
    const filas: Array<{ n: number; valor: (titulo: string) => string }> = [];
    hoja.eachRow((fila, n) => {
      if (n === 1) return;
      const valores = fila.values as unknown[];
      if (!valores.some((v) => textoDe(v) !== '')) return;
      filas.push({ n, valor: (titulo) => textoDe(valores[titulos.indexOf(comparable(titulo))]) });
    });
    return filas;
  };

  // ── Filas ──
  const hojaFilas = filasDe('Filas');
  if (!hojaFilas) errores.push('Falta la hoja "Filas".');
  for (const f of hojaFilas ?? []) {
    const c = cuadro(f.valor('Cuadro'), `Filas, fila ${f.n}`);
    const nombre = f.valor('Fila');
    if (!c) continue;
    if (!nombre) { errores.push(`Filas, fila ${f.n}: falta el nombre de la fila.`); continue; }
    const suma = f.valor('Suma (filas de total)').split('|').map((x) => x.trim()).filter(Boolean);
    c.filas.push({ nombre, ...(suma.length ? { suma } : {}) });
  }

  // ── Ítems, hoja por hoja ──
  const bloques = new Map<string, { tipo: TipoBloqueG12; hoja: string; bloque: BloqueG12; numero: number; clave: ClaveComponente }>();
  for (const tipo of Object.keys(HOJA_DE) as TipoBloqueG12[]) {
    const filas = filasDe(HOJA_DE[tipo]);
    if (!filas) continue;
    for (const f of filas) {
      const donde = `${HOJA_DE[tipo]}, fila ${f.n}`;
      const c = cuadro(f.valor('Cuadro'), donde);
      if (!c) continue;
      const numero = Number(f.valor('Bloque'));
      if (!Number.isInteger(numero) || numero < 1) { errores.push(`${donde}: "Bloque" debe ser 1, 2, 3…`); continue; }
      const fila = f.valor('Fila');
      if (!fila) { errores.push(`${donde}: falta la fila del cuadro a la que pertenece.`); continue; }

      const id = `${c.clave}|${numero}`;
      let b = bloques.get(id);
      if (b && b.tipo !== tipo) {
        errores.push(`${donde}: el bloque ${numero} de ${definicionDe(c.clave).titulo} ya tiene ítems en la hoja "${b.hoja}"; un bloque es de un solo tipo.`);
        continue;
      }
      if (!b) {
        const nota = f.valor('Nota del bloque');
        const muestra = tipo === 'simulacion' && /^(s[ií]|x|1|true|verdadero)$/i.test(f.valor('Muestra'));
        b = { tipo, hoja: HOJA_DE[tipo], numero, clave: c.clave, bloque: { tipo, ...(nota ? { nota } : {}), ...(muestra ? { muestra: true } : {}), items: [] } };
        bloques.set(id, b);
      }

      const campos: Record<string, string | number> = {};
      for (const campo of CAMPOS_G12[tipo]) {
        const crudo = f.valor(ETIQUETA[campo.clave] ?? campo.clave);
        if (crudo === '') continue;
        campos[campo.clave] = campo.tipo === 'entero' && /^-?\d+(\.0+)?$/.test(crudo) ? Number(crudo) : crudo;
      }
      const nota = f.valor('Nota del ítem');
      b.bloque.items.push({ fila, ...(nota ? { nota } : {}), campos });
    }
  }

  // Los bloques de cada cuadro, por su número
  for (const b of [...bloques.values()].sort((x, y) => x.numero - y.numero)) {
    porCuadro.get(b.clave)!.bloques.push(b.bloque);
  }

  // ── Resumen ──
  const lineas = new Map<string, LineaResumenG12>();
  for (const f of filasDe('Resumen') ?? []) {
    const donde = `Resumen, fila ${f.n}`;
    const nombre = f.valor('Línea');
    if (!nombre) { errores.push(`${donde}: falta el nombre de la línea.`); continue; }
    const buscado = comparable(f.valor('Cuadro'));
    const def = COMPONENTES_G12.find((c) => comparable(c.titulo) === buscado || comparable(c.clave) === buscado);
    if (!def) { errores.push(`${donde}: "${f.valor('Cuadro')}" no es un cuadro del G12.`); continue; }
    if (!lineas.has(nombre)) lineas.set(nombre, { nombre, partes: [] });
    const fila = f.valor('Fila (vacía: el cuadro entero)');
    lineas.get(nombre)!.partes.push({ componente: def.clave, ...(fila ? { fila } : {}) });
  }

  return {
    configuracion: { componentes: COMPONENTES_G12.map((d) => porCuadro.get(d.clave)).filter((c): c is ComponenteG12 => !!c), resumen: [...lineas.values()] },
    errores,
  };
}

/** El texto de una celda, sea lo que sea lo que Excel guardó en ella */
function textoDe(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // Una hora escrita en Excel ("21:00") llega como fecha del 30/12/1899
    return v.getUTCFullYear() < 1901
      ? `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`
      : v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: Array<{ text: string }> };
    if (o.richText) return o.richText.map((r) => r.text).join('').trim();
    if (o.text !== undefined) return textoDe(o.text);
    if (o.result !== undefined) return textoDe(o.result);
    return '';
  }
  return String(v).trim();
}
