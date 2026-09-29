import { BadGatewayException, BadRequestException } from '@nestjs/common';
import type { ScheduleType } from '../interfaces/ripley.interface.js';

/**
 * La agenda de un servicio dentro de una oficina, siempre que no haya más de una.
 *
 * **El tipo de servicio no identifica una agenda.** Una oficina puede tener
 * varias con el mismo: el 20026 tiene cinco de servicio RC. Quedarse con la
 * primera es enseñar —y guardar— los datos de una agenda que nadie eligió, que
 * es justo el fallo por el que el panel mostraba cinco agendas idénticas. Si hay
 * empate se dice cuáles son y que hace falta el identificador para deshacerlo.
 *
 * Lo usan picking y recepción. Vive aquí porque es la misma regla: en cuanto
 * estuvo escrita dos veces, arreglar una dejaba la otra como estaba.
 */
export function unicaPorServicio<
  T extends { typeOfService: string; nombre: string },
>(
  agendas: T[],
  typeOfService: string | undefined,
  officeCode: string,
): T | undefined {
  if (!typeOfService?.trim()) {
    throw new BadRequestException(
      'Indica el tipo de servicio o el identificador de la agenda',
    );
  }

  const buscado = typeOfService.trim().toUpperCase();
  const candidatas = agendas.filter(
    (a) => a.typeOfService.toUpperCase() === buscado,
  );

  if (candidatas.length > 1) {
    throw new BadRequestException(
      `La oficina ${officeCode} tiene ${candidatas.length} agendas con servicio ${buscado}: ` +
        `${candidatas.map((a) => a.nombre).join(', ')}. Indica cuál con su identificador.`,
    );
  }

  return candidatas[0];
}

/** Cada bandera del objeto "type" corresponde a un valor de "type" en el PUT */
const TIPOS_DE_AGENDA: Record<keyof ScheduleType, string> = {
  isPickingSchedule: 'picking',
  isPickingSupplierSchedule: 'pickingSupplier',
  isDispatchSchedule: 'dispatch',
  isReceptionSchedule: 'reception',
  isStockSchedule: 'stock',
  isTransferSchedule: 'transfer',
};

/**
 * Traduce las banderas al string que exige el PUT:
 * `{ isReceptionSchedule: true }` -> `"reception"`.
 *
 * Se lee de la agenda y no se escribe a mano aunque en cada módulo se sepa cuál
 * es: así una agenda que resulte no ser del tipo esperado falla al resolverla,
 * en vez de guardarse como si lo fuera.
 */
export function resolverTipoDeAgenda(type: ScheduleType): string {
  const activa = (Object.keys(TIPOS_DE_AGENDA) as (keyof ScheduleType)[]).find(
    (flag) => type?.[flag] === true,
  );

  if (!activa) {
    throw new BadGatewayException('La agenda no tiene un tipo definido');
  }

  return TIPOS_DE_AGENDA[activa];
}
