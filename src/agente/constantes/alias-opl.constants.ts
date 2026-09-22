/**
 * Cómo llama la operación a los operadores logísticos cuando habla.
 *
 * "90 min" no es un código ni un nombre que exista en ningún catálogo de
 * Ripley: es como se conoce internamente al operador 1130. Preguntar por él
 * así es lo normal en el chat, y sin esta tabla la búsqueda no encontraba nada
 * y el agente respondía que ese operador no existe.
 *
 * Vive en el backend y no en el prompt por la misma razón que el método de
 * entrega: es una regla de la operación, y un modelo que la repite de memoria
 * acaba equivocándose sin que se note. Aquí, además, la arregla un solo sitio.
 */

/** Lo que se escribe en el chat → el código real del operador */
const ALIAS_OPL: ReadonlyArray<[patron: RegExp, codigo: string]> = [
  // "90 min", "90min", "90 minutos", "los 90 minutos"
  [/\b90\s*min(utos)?\b/i, '1130'],
];

/**
 * Traduce un alias a su código, o devuelve el término tal cual.
 *
 * **Solo traduce lo que reconoce.** Un término que no está en la tabla sale
 * intacto para que lo resuelvan los catálogos, que es donde tiene que
 * resolverse: adivinar por parecido daría el operador equivocado sin avisar.
 */
export function resolverAliasOpl(termino: string): string {
  const alias = ALIAS_OPL.find(([patron]) => patron.test(termino));
  return alias ? alias[1] : termino;
}

/**
 * Si el término era un alias, cómo se dijo. Para poder decirlo en la
 * respuesta: quien preguntó por "el 90 min" tiene que reconocer de qué
 * operador se le está hablando.
 */
export function aliasUsado(termino: string): string | undefined {
  return ALIAS_OPL.some(([patron]) => patron.test(termino))
    ? termino.trim()
    : undefined;
}
