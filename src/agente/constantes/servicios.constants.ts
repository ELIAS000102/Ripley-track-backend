/**
 * Qué método de entrega corresponde a cada tipo de servicio.
 *
 * Vive aparte de las constantes de simulación porque ya no es solo suya: la
 * búsqueda masiva de agendas necesita la misma regla, y tenerla duplicada era
 * garantía de que una de las dos copias se quedara vieja.
 */

/**
 * El método de entrega lo determina el tipo de servicio, siempre.
 *
 * No es una preferencia ni un valor razonable por defecto: es la regla de
 * negocio, y por eso el agente no tiene que mandar el método nunca. Se retira
 * en tienda (RT) o se despacha a domicilio (DP), y el servicio decide cuál.
 */
export const METODO_POR_SERVICIO: Record<string, string> = {
  // Retiro en tienda
  ST: 'RT',
  SS: 'RT',
  SG: 'RT',
  SE: 'RT',
  RT: 'RT',
  RE: 'RT',

  // Despacho a domicilio
  DT: 'DP',
  SD: 'DP',
  S: 'DP',
  EX: 'DP',
  AT: 'DP',
  OP: 'DP',
};

/**
 * El método que corresponde a un servicio, o undefined si no se conoce.
 *
 * Un servicio nuevo que no esté en la tabla no se adivina: se deja que quien
 * llame decida, porque acertar por parecido daría resultados silenciosamente
 * equivocados.
 */
export function metodoDeServicio(servicio?: string | null): string | undefined {
  return servicio
    ? METODO_POR_SERVICIO[servicio.trim().toUpperCase()]
    : undefined;
}
