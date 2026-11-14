import ExcelJS from 'exceljs';
import { cuandoEnPais, hojaConEstilo, type Columna } from './configuracion-xlsx.js';
import type { FilaSolicitudG12, SolicitudesG12, TipoSolicitudG12 } from './interfaces/g12.interface.js';
import { NOMBRE_TIPO_SOLICITUD, TIPOS_SOLICITUD } from './solicitudes-g12.js';

/**
 * Las Solicitudes en un Excel con el formato de la hoja "RS_SOLICITUDES (PLT)"
 * del G12: para pedir la ampliación de capacidad. Una hoja por tipo, una fila
 * por día a solicitar, con el id de su agenda. Sin las fechas de transferencia
 * o picking de la PLT: salían de la malla teórica, que no se usa (decisión del usuario).
 */

const COLOR_TIPO: Record<TipoSolicitudG12, string> = { picking: 'FF0D9488', recepcion: 'FF7030A0', despacho: 'FFC2410C' };

const fecha = (iso: string) => {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
};

export async function solicitudesAXlsx(s: SolicitudesG12, opciones: { soloLlenos?: boolean } = {}): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Ripley Track';
  const pasa = (estado: string, rango: string) => estado === 'solicitar' && (!opciones.soloLlenos || rango === '4. 100%+');

  // Léeme: de cuándo es, con qué umbrales y qué filtro
  const porTipo = (t: TipoSolicitudG12) => s.filas.filter((f) => f.tipo === t).reduce((n, f) => n + f.dias.filter((d) => pasa(d.estado, d.rango)).length, 0);
  const sinLeer = s.filas.filter((f) => f.error);
  const leeme: unknown[][] = [
    ['Generadas', `${cuandoEnPais(s.generado, s.pais)}${s.usuarioEmail ? ` por ${s.usuarioEmail}` : ''}`],
    ['País', s.pais],
    ['Qué días', opciones.soloLlenos ? 'Solo los llenos (100 %+) que pasan su umbral' : 'Todos los que pasan su umbral (como la hoja PLT)'],
    ...TIPOS_SOLICITUD.map((t) => [`Umbral ${NOMBRE_TIPO_SOLICITUD[t].toLowerCase()}`, `Más de ${Math.round((s.umbrales?.[t] ?? 0) * 100)} % de ocupación (utilizado / asignado)`]),
    ...TIPOS_SOLICITUD.map((t) => [`Días de ${NOMBRE_TIPO_SOLICITUD[t].toLowerCase()}`, porTipo(t)]),
    ['Agendas sin leer', sinLeer.length ? sinLeer.map((f) => `${f.nombre}: ${f.error}`).join(' · ') : 'Ninguna'],
  ];
  hojaConEstilo(libro, 'Léeme', [{ titulo: 'Dato', ancho: 22 }, { titulo: 'Valor', ancho: 100, partir: true }], leeme, { color: 'FFE36C09' });

  const filasDe = (t: TipoSolicitudG12) => s.filas
    .filter((f) => f.tipo === t)
    .flatMap((f: FilaSolicitudG12) => f.dias.filter((d) => pasa(d.estado, d.rango)).map((d) => [
      f.cluster, f.servicio ?? '', f.nombre, f.codigo, ...(t === 'despacho' ? [f.zona ?? ''] : []), f.agenda ?? '', f.agendaId ?? '',
      fecha(d.fecha), d.utilizado, d.asignado, d.disponible, d.porcentaje === null ? '' : d.porcentaje / 100, d.rango,
    ]))
    .sort((x, y) => String(x[0]).localeCompare(String(y[0])) || String(x[1]).localeCompare(String(y[1])) || String(x[2]).localeCompare(String(y[2])));

  for (const t of TIPOS_SOLICITUD) {
    const columnas: Columna[] = [
      { titulo: 'Clúster', ancho: 12 }, { titulo: 'Jornada', ancho: 10, centrar: true },
      { titulo: t === 'despacho' ? 'OPL' : 'Tienda', ancho: 26 }, { titulo: 'Código', ancho: 10, centrar: true },
      ...(t === 'despacho' ? [{ titulo: 'Zona', ancho: 30 }] : []),
      { titulo: 'Agenda', ancho: 34 }, { titulo: 'Id agenda', ancho: 27, ids: true },
      { titulo: 'Fecha', ancho: 12, centrar: true }, { titulo: 'Utilizado', ancho: 11, centrar: true }, { titulo: 'Asignado', ancho: 11, centrar: true },
      { titulo: 'Disponible', ancho: 11, centrar: true }, { titulo: '%', ancho: 9, centrar: true }, { titulo: 'Rango', ancho: 12, centrar: true },
    ];
    const hoja = hojaConEstilo(libro, NOMBRE_TIPO_SOLICITUD[t], columnas, filasDe(t), { fijas: 3, color: COLOR_TIPO[t] });
    hoja.getColumn(columnas.findIndex((c) => c.titulo === '%') + 1).numFmt = '0%';
  }

  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** "G12-solicitudes-PE-2026-11-14-1830.xlsx", con la hora del país */
export function nombreXlsxSolicitudes(pais: string, cuando = new Date()): string {
  const zona = pais === 'CL' ? 'America/Santiago' : 'America/Lima';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(cuando).map((x) => [x.type, x.value]));
  return `G12-solicitudes-${pais}-${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}.xlsx`;
}
