/**
 * Fechas de calendario en YYYY-MM-DD, sin hora ni zona: así las guarda y las
 * compara todo el backend. Los formatos de la API de Ripley (DD-MM-YYYY, con
 * barras, el día en inglés) viven aparte, en ripley/utils/date.util.ts.
 */

/** Zona horaria de cada país, para que "hoy" no dependa del servidor */
const ZONAS: Record<string, string> = {
  PE: 'America/Lima',
  CL: 'America/Santiago',
};

/** "2026-09-14T05:00:00.000Z" -> "2026-09-14" */
export function soloFecha(isoDate: string): string {
  return isoDate.split('T')[0];
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

/** Días de `desde` a `hasta` (negativo si `hasta` es antes). Solo mira los 10 primeros caracteres. */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10));
  const b = Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** El día y el mes para enseñar: "2026-11-05" → "05/11"; "05/11/2026" → "05/11"; lo demás, tal cual */
export function ddmm(fecha: unknown): string {
  const f = String(fecha ?? '');
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(f);
  if (iso) return `${iso[3]}/${iso[2]}`;
  const dmy = /^(\d{2})\/(\d{2})/.exec(f);
  return dmy ? `${dmy[1]}/${dmy[2]}` : f;
}
