/**
 * Cómo se comparan los textos que escribe una persona (nombres de atajos, CDs,
 * tiendas, servicios, encabezados de Excel) con los que guarda el sistema.
 *
 * Son tres funciones y no una porque cada una deja pasar cosas distintas, y
 * elegir mal cambia qué nombres coinciden: "San  Borja" y "san borja" son lo
 * mismo para `plano`, pero "Paquetería-Lima" y "paqueteria lima" solo lo son
 * para `soloPalabras`. Todas aceptan cualquier valor: null y undefined dan "".
 */

/** Minúsculas y sin tildes ni diéresis. No toca espacios ni signos: "Perú " → "peru " */
export const sinAcentos = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** `sinAcentos`, con los espacios seguidos juntados en uno y sin los de los bordes: " San  Borja " → "san borja" */
export const plano = (s: unknown): string => sinAcentos(s).replace(/\s+/g, ' ').trim();

/**
 * `sinAcentos`, y todo lo que no es letra o dígito pasa a ser un espacio:
 * "Paquetería-Lima (CD)" → "paqueteria lima cd". La ñ ya llega como n: la
 * quita la descomposición de `sinAcentos`.
 */
export const soloPalabras = (s: unknown): string =>
  sinAcentos(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
