/** Zona horaria de cada país, para que "hoy" no dependa del servidor */
const ZONAS: Record<string, string> = {
  PE: 'America/Lima',
  CL: 'America/Santiago',
};

/**
 * Convierte una fecha ISO al formato que espera Ripley en el query.
 * "2026-09-14T00:00:00.000Z" -> "14-09-2026"
 * "2026-09-14"               -> "14-09-2026"
 */
export function isoToRipleyDate(isoDate: string): string {
  const [datePart] = isoDate.split('T');
  const [year, month, day] = datePart.split('-');
  return `${day}-${month}-${year}`;
}

/** "2026-09-14T05:00:00.000Z" -> "2026-09-14" */
export function soloFecha(isoDate: string): string {
  return isoDate.split('T')[0];
}

/** "14-09-2026" -> "2026-09-14". El inverso de isoToRipleyDate. */
export function ripleyDateToIso(fecha: string): string {
  const [day, month, year] = fecha.split('-');
  return `${year}-${month}-${day}`;
}

/**
 * Fecha de hoy en la zona horaria del país, no la del servidor.
 * A las 00:00 de Lima el reporte ya arranca en el día nuevo.
 */
export function hoyEnPais(pais: string): string {
  const zona = ZONAS[pais.toUpperCase().trim()] ?? ZONAS.PE;

  // "en-CA" produce directamente el formato YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Los primeros `dias` días de una agenda, contados desde la fecha pedida.
 *
 * Ripley entrega la agenda **completa** aunque se le pase "from": arranca más
 * de un año atrás y llega a 2028. Por eso hay que filtrar por fecha antes de
 * cortar; cortar sin filtrar devuelve los primeros días de la agenda, que son
 * historia vieja y se leen como si fueran los próximos.
 *
 * Picking y despacho tenían cada uno su copia de esto, con el mismo comentario
 * y distinto nombre de campo —`day` en ISO, `date` en DD-MM-YYYY—. La forma de
 * leer la fecha la pone quien llama; la regla, que es lo que importa, vive aquí.
 */
export function recortarDesde<T>(
  todos: T[],
  desde: string | undefined,
  pais: string,
  dias: number,
  fechaIso: (dia: T) => string,
): T[] {
  const limite = desde ? ripleyDateToIso(desde) : hoyEnPais(pais);

  return todos
    .map((dia) => ({ dia, iso: fechaIso(dia) }))
    .filter(({ iso }) => iso >= limite)
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .slice(0, dias)
    .map(({ dia }) => dia);
}

/** Suma días a una fecha YYYY-MM-DD. El mediodía evita saltos por horario de verano. */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** ["2026-09-14", "2026-09-15", "2026-09-16"] */
export function ventanaFechas(desde: string, dias: number): string[] {
  return Array.from({ length: dias }, (_, i) => sumarDias(desde, i));
}
