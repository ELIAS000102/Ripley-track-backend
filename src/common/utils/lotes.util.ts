/**
 * Recorre una lista en lotes, con los de cada lote en paralelo.
 *
 * Es el freno de mano contra la API corporativa: once destinos de simulación o
 * cincuenta agendas de capacidad lanzados a la vez la saturan, y lo que vuelve
 * entonces no son datos sino 429 y timeouts. En serie tardaría de más, así que
 * se va por tandas del tamaño que cada operación aguanta —cuatro agendas, tres
 * simulaciones, seis CDs—, y por eso el tamaño es un parámetro y no una
 * constante de aquí.
 *
 * Estaba escrito tres veces, una por servicio, con la misma forma y tres
 * valores distintos de concurrencia. Las tres eran este bucle.
 */
export async function enLotes<T, R>(
  items: T[],
  tamano: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const salida: R[] = [];

  for (let i = 0; i < items.length; i += tamano) {
    const lote = items.slice(i, i + tamano);
    salida.push(...(await Promise.all(lote.map(fn))));
  }

  return salida;
}
