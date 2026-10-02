/**
 * Filtra por nombre, y **lo exacto gana sobre lo parecido**.
 *
 * Con `includes` a secas, un nombre que es prefijo de otro no se puede apuntar:
 * pedir la zona "Zona 1401 - Suc. Aldea 6 Lima/Metropolitana" traía también la
 * "…Lima/Metropolitana BT", y la respuesta mezclaba las dos como si se hubieran
 * pedido las dos. Lo mismo pasaba con la jornada "S" en un almacén que también
 * tiene "ST" y "SD".
 *
 * Primero se busca la coincidencia exacta; solo si no hay ninguna se cae al
 * parecido, que es lo que permite escribir "Chorrillos" y dar con "CT
 * Chorrillos - 99 Min".
 *
 * Vive aquí porque la regla la aprendió la edición y la consulta no se enteró:
 * estaba escrita una sola vez, dentro de un método privado, y el otro lado
 * seguía con el `includes`. Ahora es una y la usan los dos.
 */
export function filtrarPorNombre<T>(
  lista: T[],
  buscado: string | undefined,
  de: (item: T) => string | null | undefined,
): T[] {
  const termino = buscado?.trim().toLowerCase();
  if (!termino) return lista;

  const valor = (item: T) => (de(item) ?? '').toLowerCase();

  const exactas = lista.filter((item) => valor(item) === termino);
  if (exactas.length) return exactas;

  return lista.filter((item) => valor(item).includes(termino));
}
