import { BadGatewayException, type Logger } from '@nestjs/common';

/**
 * Cómo leer un error de Supabase (de PostgREST o del propio Postgres) y cómo
 * contarlo. Antes cada service tenía su copia, cada una con su lista de códigos.
 */

/** Lo que trae un error de Supabase: el código y el mensaje */
export interface ErrorSupabase {
  code?: string;
  message?: string;
}

/** 42P01: la tabla no existe (Postgres); PGRST205: PostgREST no la encuentra */
const SIN_TABLA = ['42P01', 'PGRST205'];
/** 42703: la columna no existe (Postgres); PGRST204: PostgREST no la encuentra */
const SIN_COLUMNA = ['42703', 'PGRST204'];

/** Falta la tabla: no se ha ejecutado su SQL */
export const faltaTabla = (e: ErrorSupabase | null | undefined): boolean =>
  Boolean(e) && (SIN_TABLA.includes(e!.code ?? '') || /relation .* does not exist/i.test(e!.message ?? ''));

/** Falta una columna: la base es de antes (docs/sql/supabase/actualizar-base-existente.sql) */
export const faltaColumna = (e: ErrorSupabase | null | undefined): boolean =>
  Boolean(e) &&
  (SIN_COLUMNA.includes(e!.code ?? '') ||
    /column .* does not exist|could not find the .* column/i.test(e!.message ?? ''));

/** Falta la tabla o una columna */
export const faltaEsquema = (e: ErrorSupabase | null | undefined): boolean => faltaTabla(e) || faltaColumna(e);

/** Choca con un índice único (23505): ese nombre, o esa ejecución, ya existe */
export const esDuplicado = (e: ErrorSupabase | null | undefined): boolean =>
  Boolean(e) && (e!.code === '23505' || /duplicate key|unique/i.test(e!.message ?? ''));

/**
 * Corta la petición con un 502 que dice qué no se pudo hacer, sin el detalle
 * de la base, que va al log. Con `siFaltaSql`, si lo que falla es que falta la
 * tabla o una columna, responde ese mensaje (qué SQL ejecutar) en su lugar.
 */
export function falloSupabase(
  logger: Logger,
  error: ErrorSupabase | null | undefined,
  accion: string,
  siFaltaSql?: string,
): never {
  if (siFaltaSql && faltaEsquema(error)) throw new BadGatewayException(siFaltaSql);
  logger.error(`No se pudo ${accion}: ${error?.message ?? 'sin respuesta'}`);
  throw new BadGatewayException(`No se pudo ${accion}.`);
}
