import type { Cd } from '../../reportes/cds/interfaces/reporte-cds.interface.js';

/**
 * Cómo se nombra a los centros de distribución cuando se habla de ellos, y qué
 * se puede reasignar dentro de cada uno.
 *
 * Ningún CD está escrito aquí. Los configura la operación en el panel —código,
 * nombre, jornadas, alias, entre qué jornadas se reasigna sin permiso y cuáles
 * cruzan fechas— y llegan de `ConfiguracionCdsService`. Estas funciones solo
 * aplican las reglas sobre la lista que se les pasa: así se prueban sin base
 * de datos y no hay dos sitios que puedan decir cosas distintas de un CD.
 */

/** Los CDs de cada país, como los devuelve la configuración */
export type CdsPorPais = Record<string, Cd[]>;

const normalizar = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();

/**
 * El país de la petición, corregido por el código del CD.
 *
 * El código de un CD no se repite entre países: la configuración no deja
 * guardar el mismo en dos. Si llega con el país equivocado —el agente se olvidó
 * de mandar pais="CL" y valió el PE por defecto—, contestar "no encontré el
 * 10095 en Perú" no ayuda a nadie: se usa el país del CD. Solo con el código
 * exacto; un nombre o un alias no corrige nada.
 */
export function paisDelCd(termino: string | undefined, pais: string | undefined, todos: CdsPorPais): string | undefined {
  const codigo = termino?.trim();
  if (!codigo || !/^\d+$/.test(codigo)) return pais;
  const actual = (pais ?? 'PE').toUpperCase().trim();
  if (todos[actual]?.some((c) => c.code === codigo)) return pais;
  const otro = Object.entries(todos).find(([, lista]) => lista.some((c) => c.code === codigo));
  return otro ? otro[0] : pais;
}

/**
 * El CD que nombra un término, o undefined si no nombra ninguno.
 *
 * Busca por código exacto primero, después por alias —el más largo gana:
 * "fulfillment gv" es más específico que "fulfillment"— y por último por
 * nombre. Si el término no nombra a ninguno **no se adivina**: quien llame
 * decide qué hacer, porque elegir un CD por parecido es cortar el picking del
 * sitio equivocado.
 */
export function resolverCd(termino: string, cds: Cd[]): Cd | undefined {
  const buscado = termino.trim();

  const porCodigo = cds.find((c) => c.code === buscado);
  if (porCodigo) return porCodigo;

  const texto = ` ${normalizar(buscado)} `;
  const alias = cds
    .flatMap((cd) => cd.alias.map((a) => ({ cd, a: normalizar(a) })))
    .filter(({ a }) => a)
    .sort((x, y) => y.a.length - x.a.length);
  const porAlias = alias.find(({ a }) => texto.includes(` ${a} `));
  if (porAlias) return porAlias.cd;

  return cds.find((c) => c.nombre && normalizar(c.nombre).includes(normalizar(buscado)) && normalizar(buscado).length > 0);
}

/**
 * ¿El término se refiere al país entero en vez de a un CD?
 *
 * "Corta el CD de Perú" son todos sus CDs; "corta Villa El Salvador" es uno. La
 * diferencia cambia cuántas agendas se tocan, así que se decide aquí y no por
 * omisión.
 */
export function esTodoElPais(termino: string, pais: string): boolean {
  const limpio = termino.trim().toLowerCase();

  const paises: Record<string, RegExp> = {
    PE: /^(pe|per[uú]|todos?|ambos|los dos)$/i,
    CL: /^(cl|chile|todos?|ambos|los dos)$/i,
  };

  return paises[pais.toUpperCase().trim()]?.test(limpio) ?? false;
}

/** "20026 (CD Villa El Salvador), 20096 (CD Aldea 6)", para decir cuáles hay */
export function listaDeCds(cds: Cd[], pais: string): string {
  return cds.length
    ? cds.map((c) => `${c.code} (${c.nombre})`).join(', ')
    : `ninguno: configura los CDs de ${pais} en el apartado Reporte CDs del panel`;
}

// ───────────────────────── Reasignar capacidad ─────────────────────────

/**
 * ¿Mover capacidad entre estas dos jornadas necesita autorización?
 *
 * Solo si **las dos** están entre las libres del CD se hace sin preguntar.
 * Basta que una sea de las condicionadas para que haga falta el permiso: lo que
 * se vigila es a dónde va a parar la capacidad tanto como de dónde sale. Un CD
 * sin jornadas libres exige autorización para todo, que es el lado seguro en el
 * que equivocarse.
 *
 * Lo que no es libre no está prohibido: está condicionado a que quien lo pide
 * diga que tiene permiso. Bloquearlo del todo obligaría a salir del chat para
 * una operación legítima, y permitirlo sin más convierte una frase mal
 * entendida en capacidad movida a una jornada que nadie revisa.
 */
export function necesitaAutorizacion(cd: Cd, origen: string, destino: string): boolean {
  const dentro = (j: string) => cd.libres.includes(j.trim().toUpperCase());
  return !(dentro(origen) && dentro(destino));
}

/**
 * ¿Esta pareja puede cruzar fechas en este CD?
 *
 * La regla general es que una reasignación ocurre dentro del mismo día: mover
 * capacidad de mañana a hoy es otra operación y con otras consecuencias. Las
 * jornadas que "cruzan fecha" en la configuración son la excepción acordada
 * (ND y DX en Chile).
 */
export function permiteOtraFecha(cd: Cd, origen: string, destino: string): boolean {
  const dentro = (j: string) => cd.cruzanFecha.includes(j.trim().toUpperCase());
  return dentro(origen) || dentro(destino);
}
