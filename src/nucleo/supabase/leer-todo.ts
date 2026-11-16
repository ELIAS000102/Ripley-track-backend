/**
 * Una consulta de Supabase, entera.
 *
 * PostgREST no devuelve más de 1000 filas por consulta (su `max-rows`), y lo
 * hace sin error: la lista llega cortada. Aquí se piden de 1000 en 1000
 * (`range`) hasta que llega una página vacía. La consulta tiene que ir
 * ordenada por algo estable, o las páginas podrían repetir o saltarse filas.
 */
export const FILAS_POR_PAGINA = 1000;

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>;

export async function leerTodo<T>(
  pagina: (desde: number, hasta: number) => Pagina<T>,
  tamano = FILAS_POR_PAGINA,
): Promise<{ data: T[]; error: { code?: string; message?: string } | null }> {
  const filas: T[] = [];
  // Se avanza por lo que llegó y se para con una página vacía: si el tope del
  // proyecto fuera menor que la página, parar en la primera incompleta cortaría
  for (let desde = 0; ;) {
    const { data, error } = await pagina(desde, desde + tamano - 1);
    if (error) return { data: filas, error };
    if (!data?.length) return { data: filas, error: null };
    filas.push(...data);
    desde += data.length;
  }
}

/** Una lista larga en trozos: un `in(...)` con cientos de valores no cabe en la URL */
export function enTrozos<T>(lista: T[], tamano = 100): T[][] {
  const trozos: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) trozos.push(lista.slice(i, i + tamano));
  return trozos;
}
