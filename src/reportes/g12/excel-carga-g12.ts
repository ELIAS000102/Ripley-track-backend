import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * El Excel de carga del Oracle de una persona, hecho a partir de la plantilla.
 *
 * La plantilla (`assets/g12/G12-carga-oracle.xlsx`) la arma Excel con
 * `docs/g12-carga-oracle/crear-excel.ps1`: lleva las consultas de Power Query,
 * el estilo y cinco marcadores en sus textos —{{URL}}, {{ANON}}, {{CLAVE}},
 * {{PAIS}} y {{EMAIL}}—. Aquí se cambian por los de la persona tocando solo el
 * XML de los textos compartidos: abrirla con una librería de Excel y volver a
 * guardarla perdería las consultas (el DataMashup de Power Query).
 */

/** Desde `src/reportes/g12/` y desde `dist/reportes/g12/`: la carpeta `assets` está en la raíz */
export const RUTA_PLANTILLA_EXCEL_CARGA = fileURLToPath(new URL('../../../assets/g12/G12-carga-oracle.xlsx', import.meta.url));

export interface DatosExcelCarga {
  url: string;
  anon: string;
  clave: string;
  pais: string;
  email: string;
}

const MARCADORES: Array<[keyof DatosExcelCarga, string]> = [
  ['url', '{{URL}}'],
  ['anon', '{{ANON}}'],
  ['clave', '{{CLAVE}}'],
  ['pais', '{{PAIS}}'],
  ['email', '{{EMAIL}}'],
];

const escaparXml = (texto: string) =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

let plantilla: Promise<Buffer> | null = null;

/** La plantilla, leída una vez */
export function leerPlantillaExcelCarga(ruta = RUTA_PLANTILLA_EXCEL_CARGA): Promise<Buffer> {
  if (!plantilla) {
    plantilla = readFile(ruta);
    plantilla.catch(() => { plantilla = null; });
  }
  return plantilla;
}

/** La plantilla con los datos de la persona en vez de los marcadores */
export async function excelDeCarga(plantillaXlsx: Buffer, datos: DatosExcelCarga): Promise<Buffer> {
  const zip = await JSZip.loadAsync(plantillaXlsx);

  const textos = zip.file('xl/sharedStrings.xml');
  if (!textos) throw new Error('La plantilla del Excel de carga no tiene textos compartidos');
  let xml = await textos.async('string');
  for (const [campo, marcador] of MARCADORES) {
    if (!xml.includes(marcador)) throw new Error(`A la plantilla del Excel de carga le falta el marcador ${marcador}`);
    xml = xml.split(marcador).join(escaparXml(String(datos[campo])));
  }
  zip.file('xl/sharedStrings.xml', xml);

  // Que Excel recalcule al abrir: las fórmulas de estado ("✓ Guardada") miran las claves
  const libro = zip.file('xl/workbook.xml');
  if (libro) {
    const wb = await libro.async('string');
    zip.file('xl/workbook.xml', wb.includes('fullCalcOnLoad')
      ? wb
      : wb.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"'));
  }

  // Sin el nombre de quien armó la plantilla
  const propiedades = zip.file('docProps/core.xml');
  if (propiedades) {
    const core = (await propiedades.async('string'))
      .replace(/<dc:creator>[^<]*<\/dc:creator>/, '<dc:creator>Ripley Track</dc:creator>')
      .replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy>Ripley Track</cp:lastModifiedBy>');
    zip.file('docProps/core.xml', core);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** "G12-carga-oracle-ana.perez@ripley.com.pe.xlsx": el correo de la persona, sin lo que no vale en un nombre de archivo */
export function nombreExcelDeCarga(email: string): string {
  const limpio = email.trim().toLowerCase().replace(/[^a-z0-9@._+-]/g, '_');
  return `G12-carga-oracle-${limpio || 'usuario'}.xlsx`;
}
