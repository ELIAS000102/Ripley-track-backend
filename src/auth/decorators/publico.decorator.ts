import { SetMetadata } from '@nestjs/common';

export const ES_PUBLICO = 'esPublico';

/**
 * Exime a un endpoint del guard global de autenticación.
 * Solo lo usa el login: sin esto no habría forma de conseguir el primer token.
 */
export const Publico = () => SetMetadata(ES_PUBLICO, true);
