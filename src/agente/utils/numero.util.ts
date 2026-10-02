/**
 * Un número de Ripley, o `null` si no lo hay.
 *
 * La API devuelve estos campos —días de holgura, máximo de ocurrencias— unas
 * veces como número y otras como texto, y a veces vacíos. Para el chat, "no hay
 * valor" y "vale 0" no son lo mismo, así que el vacío se vuelve `null` y el 0 se
 * queda.
 *
 * Estaba escrito dos veces, en la consulta y en la edición de tipos de
 * servicio, **y habían divergido**: una descartaba con `Number.isNaN` y la otra
 * con `Number.isFinite`. La diferencia no es de estilo: con `isNaN`, un
 * `Infinity` pasa como número válido. Se queda `isFinite`, que es el que no deja
 * entrar lo que no se puede enseñar ni comparar.
 */
export function numeroONulo(
  valor: number | string | null | undefined,
): number | null {
  if (valor === null || valor === undefined || valor === '') return null;

  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}
