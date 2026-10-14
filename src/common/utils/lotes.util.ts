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
/**
 * Como `enLotes`, pero sin esperar a que acabe la tanda entera: en cuanto
 * termina uno, arranca el siguiente, hasta `aLaVez`. Un ítem lento ya no frena
 * a los de su lote. El resultado va en el orden de la lista.
 *
 * El freno contra la API corporativa ya no depende de esto: lo pone el carril
 * de RipleyHttpService, por país, para todo lo que se le pide a la vez.
 */
export async function enParalelo<T, R>(
  items: T[],
  aLaVez: number,
  fn: (item: T, indice: number) => Promise<R>,
): Promise<R[]> {
  const salida: R[] = Array.from({ length: items.length });
  let siguiente = 0;

  const trabajar = async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      salida[i] = await fn(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(aLaVez, items.length)) }, trabajar));
  return salida;
}

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
