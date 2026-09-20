/** Respuesta paginada genérica de los catálogos de Ripley */
export interface RipleyListResponse<T> {
  count: number;
  rows: T[];
}

/**
 * Una oficina del catálogo /offices.
 * El mismo endpoint sirve almacenes (isStoreOffice) y OPL (isOPLOffice).
 */
export interface OfficeRow {
  id: string;
  code: string;
  name?: string;
  storeCode?: string;
  isActive?: boolean;
  stockSourceType?: string;
  type?: Record<string, boolean>;
}

/**
 * Respuesta de /catalogs?q={identificador}&takeFirst=1
 * Ojo: algunos catálogos traen "code" y otros solo "id" y "label".
 */
export interface CatalogoResponse {
  id: string;
  identifier: string;
  description: string;
  parameters: { id: number; code?: string; label: string }[];
}

/**
 * Un servicio del catálogo /services.
 *
 * La descripción no siempre viene: hay servicios que solo traen su código.
 */
export interface ServiceRow {
  id: string;
  code: string;
  description?: string;
}

/** Banderas que definen qué tipo de agenda es */
export interface ScheduleType {
  isDispatchSchedule: boolean;
  isPickingSchedule: boolean;
  isPickingSupplierSchedule: boolean;
  isReceptionSchedule: boolean;
  isStockSchedule: boolean;
  isTransferSchedule: boolean;
}

/**
 * Una agenda de /schedules/picking?warehouse={id}.
 *
 * La declaraban por su cuenta picking y el reporte de CDs, cada uno con los
 * campos que usaba. Es una sola respuesta de Ripley, así que se declara una
 * vez y entera: quien no use un campo, no lo lee.
 */
export interface ScheduleRow {
  id: string;
  name: string;
  active: boolean;
  unitMeasure: string;
  type: ScheduleType;
  capacities: {
    capacityId: string;
    warehouseId: string;
    lastDayOccupied?: string;
  }[];
  services: string[];
  warehouses: string[];
}

/** Un día dentro de la agenda de capacidades */
export interface CapacityByDay {
  day: string;
  active: boolean;
  assigned: number;
  occupied: number;
}

/**
 * Respuesta de GET /capacities/picking/{scheduleId}.
 *
 * `capacityByDayArray` es opcional porque Ripley responde 200 sin él cuando la
 * agenda existe pero no tiene capacidades creadas.
 */
export interface CapacitiesResponse {
  _id?: string;
  schedule?: string;
  warehouse: string;
  services?: string[];
  capacityByDayArray?: CapacityByDay[];
}

/**
 * Una zona de cobertura de un OPL — GET /mainzones?courier={officeId}
 *
 * La declaraban igual despacho y tipo-servicio: es el mismo endpoint.
 */
export interface MainZoneRow {
  id: string;
  name: string;
  courier: string;
  mainWizard: string;
}

/** La agenda de una zona — GET /mainschedules?mainZone={zoneId} */
export interface MainScheduleRow {
  id: string;
  name: string;
  mainZone: string;
  courier: string;
  mainWizard: string;
}
