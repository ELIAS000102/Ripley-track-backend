/**
 * Lo que la simulación supone cuando no se lo dicen.
 *
 * Aquí vivían además las dos simulaciones que la operación tiene montadas —los
 * cinco OPL de despacho y las once tiendas de retiro, con su destino cada uno—.
 * Se fueron a Supabase, a la tabla de preconfiguraciones: son datos de la
 * operación y cambian con ella, y una tienda nueva no puede necesitar un
 * despliegue. Lo que queda son valores por defecto, que es otra cosa.
 */

/** A dónde se entrega cuando nadie dice a dónde */
export const DESTINO_POR_DEFECTO = {
  region: 'Lima',
  provincia: 'Lima',
  distrito: 'Lima',
};

/** SKU de referencia para cuando el usuario no aporta uno */
export const SKU_POR_DEFECTO = '2013435160001';

/**
 * Servicios que se consultan SIN filtrar por tipo.
 *
 * Mandar "SD" a Ripley devuelve solo SD. Mandando el tipo vacío devuelve todos
 * los aplicables al destino, que en los OPL de despacho son **SD y S**: las dos
 * juntas son lo que la operación compara, así que pedir solo una pierde la
 * mitad de la respuesta.
 *
 * Esto no es una preconfiguración: es cómo hay que hablarle a Ripley, y se
 * cumple igual la pida quien la pida.
 */
export const SIN_FILTRAR = ['SD'];

/** Qué tipo mandarle a Ripley para un servicio dado */
export function tipoParaRipley(servicio: string | null): string {
  if (!servicio) return '';
  return SIN_FILTRAR.includes(servicio.toUpperCase()) ? '' : servicio;
}

/** Un destino de simulación: quién entrega y a dónde */
export interface OplPorDefecto {
  code: string;
  nombre: string;
  distrito: string;
  provincia: string;
  region: string;
}
