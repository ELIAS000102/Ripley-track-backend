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
 *
 * Los nombres se comparan **sin lo que no se ve**: mayúsculas, tildes, espacios
 * de más (dobles, al final, el no separable), comillas y puntuación. Ripley
 * guarda nombres como "Agenda RT Santa Anita " o "Zona1" junto a "Zona 4", y el
 * chat pinta los espacios dobles como uno: "No encontré la agenda… Las opciones
 * son: Zona 4" no se podía contestar, porque lo que se veía era lo que se había
 * pedido. Si aun así no hay una igual, se prueba sin espacios ("Zona 1" es
 * "Zona1") y solo después el parecido.
 */
const comparable = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();

export function filtrarPorNombre<T>(
  lista: T[],
  buscado: string | undefined,
  de: (item: T) => string | null | undefined,
): T[] {
  const termino = comparable(buscado ?? '');
  if (!termino) return lista;

  const valor = (item: T) => comparable(de(item) ?? '');

  const exactas = lista.filter((item) => valor(item) === termino);
  if (exactas.length) return exactas;

  const junto = termino.replace(/ /g, '');
  const juntas = lista.filter((item) => valor(item).replace(/ /g, '') === junto);
  if (juntas.length) return juntas;

  return lista.filter((item) => valor(item).includes(termino));
}
