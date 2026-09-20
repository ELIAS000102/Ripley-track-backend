import { SetMetadata } from '@nestjs/common';

export const ACCION_AUDITADA = 'accionAuditada';

/**
 * Marca un endpoint como "modifica datos" para que quede en el registro de uso.
 *
 * Marcar es una decisión manual y no se deduce del método HTTP, porque en esta
 * API hay varios POST que en realidad solo consultan —listar servicios de un
 * OPL, consultar agendas, simular— y registrarlos ahogaría el historial.
 *
 * Al revés sí se comprueba: **sobre un GET esta marca no hace nada**. El
 * interceptor la ignora, porque una consulta no genera un cambio y no tiene
 * nada que hacer en un historial de cambios. Si lo que quieres es saber qué se
 * consultó, eso vive en otro sitio: las conversaciones con el agente se guardan
 * enteras en la tabla de chats.
 *
 * @param accion Nombre corto de la operación, tal como se guarda en la columna `accion`.
 */
export const Auditar = (accion: string) => SetMetadata(ACCION_AUDITADA, accion);
