/**
 * Cómo se escribe una lista en el chat.
 *
 * Casi todos los campos del agente admiten varios valores, y la gente los
 * escribe como le sale: `"1110, 1111"` con comas, o `"1110 1111 1112"`
 * seguidos. La segunda forma llegaba entera como un único término y el backend
 * respondía que no encontraba ningún operador que se llamara así — literal y
 * completamente inútil.
 *
 * **Los espacios solo separan cuando todo el valor son cifras.** Es la guarda
 * que hace esto seguro: un nombre lleva espacios —"Plaza Lima Norte"— y
 * partirlo sería buscar tres cosas que no existen. Las comas mandan siempre,
 * así que `"Plaza Lima Norte, 1110"` sigue siendo dos elementos.
 *
 * Vive aquí y no copiada en cada service porque son once sitios que parten
 * listas, y once copias de una regla son once oportunidades de que una se
 * quede vieja.
 */

/**
 * Solo cifras, espacios y comas.
 *
 * Ningún nombre de operador, almacén o jornada lo es, así que si el valor
 * entero encaja aquí, los espacios separan sin riesgo. La coma cuenta para que
 * "1110, 1111 1112" —mezclando las dos formas, que es como se escribe de
 * verdad— siga siendo tres elementos y no dos.
 */
const SOLO_CIFRAS = /^[\d\s,]+$/;

/**
 * Parte un valor en sus elementos, ya recortados y sin vacíos.
 *
 * No quita repetidos ni aplica topes: eso lo decide quien llama, porque el
 * máximo razonable depende de lo que cueste cada elemento.
 */
export function partirLista(valor: string | undefined): string[] {
  if (!valor?.trim()) return [];

  const separador = SOLO_CIFRAS.test(valor.trim()) ? /[\s,]+/ : ',';

  return valor
    .split(separador)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Lo mismo, sin repetidos y sin distinguir mayúsculas */
export function partirListaUnica(valor: string | undefined): string[] {
  const lista = partirLista(valor);

  return lista.filter(
    (x, i) => lista.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i,
  );
}
