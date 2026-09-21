import { SetMetadata } from '@nestjs/common';

export const PERMITIDO_AGENTE = 'permitidoAgente';
export const PERMITIDO_AGENTE_EDITOR = 'permitidoAgenteEditor';

/**
 * Autoriza a que el agente de IA **consulte** este endpoint.
 *
 * La lista es cerrada por defecto: lo que no se marca queda prohibido para el
 * agente. Así, cualquier endpoint que se añada en el futuro —sobre todo si
 * escribe— nace bloqueado, en vez de quedar expuesto por olvido.
 *
 * Solo debe marcarse lo que consulta. Una operación que modifica datos lleva
 * @PermitidoAgenteEditor(), que es otra cosa y se lee distinto a propósito.
 */
export const PermitidoAgente = () => SetMetadata(PERMITIDO_AGENTE, true);

/**
 * Autoriza a que el agente **escriba** por este endpoint, y solo cuando el
 * usuario haya puesto el interruptor del chat en modo editor.
 *
 * Es deliberadamente un decorador aparte y no un parámetro de
 * `@PermitidoAgente()`: en una revisión de código, la diferencia entre "el
 * agente puede leer esto" y "el agente puede cambiar esto" tiene que saltar a
 * la vista, no esconderse en un booleano.
 *
 * Marcarlo **no** abre nada por sí solo. El guard exige además que el modo
 * editor esté activo para ese usuario en ese momento, y el modo caduca solo.
 * Antes de marcar un endpoint nuevo con esto conviene preguntarse si el daño
 * de una escritura equivocada es reversible: hoy solo lo llevan las capacidades
 * de picking y despacho, que se corrigen volviendo a escribir el valor viejo.
 */
export const PermitidoAgenteEditor = () =>
  SetMetadata(PERMITIDO_AGENTE_EDITOR, true);
