import { SetMetadata } from '@nestjs/common';

export const ACCION_AUDITADA = 'accionAuditada';

/**
 * Marca un endpoint como "modifica datos" para que quede en el registro de uso.
 *
 * Se marca a mano y no se deduce del método HTTP a propósito: en esta API hay
 * varios POST que en realidad solo consultan (listar servicios de un OPL,
 * consultar agendas, simular), y registrarlos ahogaría el historial de cambios.
 *
 * @param accion Nombre corto de la operación, tal como se guarda en la columna `accion`.
 */
export const Auditar = (accion: string) => SetMetadata(ACCION_AUDITADA, accion);
