import { SetMetadata } from '@nestjs/common';

export const PERMITIDO_AGENTE = 'permitidoAgente';

/**
 * Autoriza a que el agente de IA use este endpoint.
 *
 * La lista es cerrada por defecto: lo que no se marca queda prohibido para el
 * agente. Así, cualquier endpoint que se añada en el futuro —sobre todo si
 * escribe— nace bloqueado, en vez de quedar expuesto por olvido.
 *
 * Solo debe marcarse lo que consulta. Nunca una operación que modifique datos.
 */
export const PermitidoAgente = () => SetMetadata(PERMITIDO_AGENTE, true);
