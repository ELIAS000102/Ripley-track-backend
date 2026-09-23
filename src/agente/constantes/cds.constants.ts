import { CDS } from '../../reportes/cds/cds.constants.js';
import type { Cd } from '../../reportes/cds/interfaces/reporte-cds.interface.js';

/**
 * Cómo se nombra a los centros de distribución cuando se habla de ellos, y qué
 * se puede reasignar dentro de cada uno.
 *
 * Los CDs y sus jornadas viven en `reportes/cds/cds.constants.ts`, que es de
 * donde salen para el reporte. Aquí solo se añade lo que hace falta para
 * entender una frase —"el CD de Aldeas", "fulfillment GV"— y las reglas de a
 * qué jornada se puede mover capacidad sin pedir permiso.
 */

/** Los nombres por los que se pide un CD, además de su código y su nombre */
const ALIAS: Record<string, RegExp> = {
  '20026': /villa\s*el\s*salvador|\bves\b|\bvilla\b/i,
  '20096': /\baldeas?\b/i,
  // El GV va primero al resolver: "fulfillment gv" también contiene "fulfillment"
  '10082': /fulfillment\s*gv|\bgv\b/i,
  '10095': /fulfillment/i,
};

/** Se prueban en este orden: el más específico gana */
const ORDEN = ['20026', '20096', '10082', '10095'];

/**
 * El CD que nombra un término, o undefined si no nombra ninguno.
 *
 * Busca por código exacto primero y solo después por nombre o alias. Si el
 * término no nombra a ninguno **no se adivina**: quien llame decide qué hacer,
 * porque elegir un CD por parecido es cortar el picking del sitio equivocado.
 */
export function resolverCd(termino: string, pais: string): Cd | undefined {
  const cds = CDS[pais.toUpperCase().trim()] ?? [];
  const buscado = termino.trim();

  const porCodigo = cds.find((c) => c.code === buscado);
  if (porCodigo) return porCodigo;

  for (const code of ORDEN) {
    const cd = cds.find((c) => c.code === code);
    if (cd && ALIAS[code].test(buscado)) return cd;
  }

  return cds.find((c) =>
    c.nombre.toLowerCase().includes(buscado.toLowerCase()),
  );
}

/**
 * ¿El término se refiere al país entero en vez de a un CD?
 *
 * "Corta el CD de Perú" son los dos CDs; "corta Villa El Salvador" es uno. La
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

/** Los CDs de un país */
export function cdsDelPais(pais: string): Cd[] {
  return CDS[pais.toUpperCase().trim()] ?? [];
}

// ───────────────────────── Reasignar capacidad ─────────────────────────

/**
 * Entre qué jornadas se puede mover capacidad **sin pedir autorización**.
 *
 * Lo que no está aquí no está prohibido: está condicionado a que quien lo pide
 * diga que tiene permiso. La diferencia importa — bloquearlo del todo obligaría
 * a salir del chat para una operación legítima, y permitirlo sin más convierte
 * una frase mal entendida en capacidad movida a una jornada que nadie revisa.
 *
 * Un CD que no esté en la tabla exige autorización para todo, que es el lado
 * seguro en el que equivocarse.
 */
const LIBRES: Record<string, string[]> = {
  // Villa El Salvador: las tres de siempre. AT, OP, SD y SE piden permiso.
  '20026': ['ST', 'S', 'RC'],
  // Aldea 6 solo tiene estas dos, y entre ellas se mueve sin pedir nada
  '20096': ['S', 'SG'],
  // Chile no tiene pares libres: se puede mover entre todas sus jornadas, pero
  // siempre preguntando primero
};

/**
 * ¿Mover capacidad entre estas dos jornadas necesita autorización?
 *
 * Solo si **las dos** están en la lista libre del CD se hace sin preguntar.
 * Basta que una sea de las condicionadas para que haga falta el permiso: lo que
 * se vigila es a dónde va a parar la capacidad tanto como de dónde sale.
 */
export function necesitaAutorizacion(
  cd: string,
  origen: string,
  destino: string,
): boolean {
  const libres = LIBRES[cd.trim()];
  if (!libres) return true;

  const dentro = (j: string) => libres.includes(j.trim().toUpperCase());

  return !(dentro(origen) && dentro(destino));
}

/**
 * Las jornadas que pueden mover capacidad entre sí sin permiso, para poder
 * decirlo en el mensaje cuando se pide autorización.
 */
export function jornadasLibres(cd: string): string[] {
  return LIBRES[cd.trim()] ?? [];
}

/**
 * Jornadas que pueden reasignarse **entre fechas distintas**.
 *
 * La regla general es que una reasignación ocurre dentro del mismo día: mover
 * capacidad de mañana a hoy es otra operación y con otras consecuencias. En
 * Chile, ND y DX son la excepción acordada.
 */
const ENTRE_FECHAS: Record<string, string[]> = {
  CL: ['ND', 'DX'],
};

/** ¿Esta pareja puede cruzar fechas en este país? */
export function permiteOtraFecha(
  pais: string,
  origen: string,
  destino: string,
): boolean {
  const permitidas = ENTRE_FECHAS[pais.toUpperCase().trim()] ?? [];

  const dentro = (j: string) => permitidas.includes(j.trim().toUpperCase());

  return dentro(origen) || dentro(destino);
}
