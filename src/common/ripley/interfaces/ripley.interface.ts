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
 * Lo mismo pasa con `serviceGroup`, que solo llevan los de despacho
 * prioritario. El bloque de horas de corte y canales no se declara porque
 * ninguna feature lo lee: quien lo necesite, que lo añada aquí.
 */
export interface ServiceRow {
  id: string;
  code: string;
  description?: string;
  isActive?: boolean;
  enabledForCheckout?: boolean;
  serviceGroup?: string;
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
  /**
   * Hasta cuándo vale la agenda, en ISO.
   *
   * Distingue las que están en uso de las que quedaron atrás: en el 20026, las
   * cuatro agendas rotuladas "NO FUNCIONAL" vencieron el 31-12-2025 y las que
   * se usan llegan a 2030.
   */
  validityEnd?: string;
  validityStart?: string;
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

/** Los siete días, tal como los nombra Ripley en la configuración semanal */
export type DiaSemana =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/** Unidades por defecto de cada día: `{ monday: 50, ... }` */
export type CapacidadSemanal = Partial<Record<DiaSemana, number>>;

/** Hora de corte por defecto de cada día: `{ monday: "23:59", ... }` */
export type CortesSemanales = Partial<Record<DiaSemana, string>>;

/**
 * Una agenda de /schedules/reception?oplOffice={id}
 *
 * Se parece a la de picking, con **una diferencia que cambia cómo se consulta**:
 * los días vienen dentro de la propia fila, en `capacitiesSelected`, en vez de
 * pedirse aparte por su identificador. Una sola llamada trae las agendas de la
 * oficina y sus capacidades, así que aquí no hay un segundo GET que hacer.
 *
 * La otra diferencia es de quién cuelga: picking lo hace de `warehouses`, y
 * recepción de `oplOffices`, que además llega con la oficina entera dentro y no
 * solo con su id.
 */
export interface ReceptionScheduleRow {
  id: string;
  name: string;
  active: boolean;
  /** Si Ripley crea sola la capacidad de los días nuevos */
  autogenerate?: boolean;
  unitMeasure: string;
  type: ScheduleType;
  services: string[];
  /** La oficina que recepciona, ya expandida */
  oplOffices?: OfficeRow[];
  warehouses?: string[];
  /**
   * La capacidad de la agenda.
   *
   * `capacityId` llega **a veces como una cadena y a veces como el documento
   * entero ya expandido**, con sus dos mil días dentro. Por eso se declara con
   * las dos formas: leerlo como si siempre fuera un id es lo que mandaba el
   * documento completo a la query y hacía que la API rechazara la URL.
   */
  capacities?: {
    capacityId: string | { id?: string; _id?: string };
    oplOfficeId?: string;
  }[];
  /** Los días de la agenda: la misma forma que en picking */
  capacitiesSelected?: CapacityByDay[];
  weekBaseCapacity?: CapacidadSemanal;
  weekCutTime?: CortesSemanales;
  validityStart?: string;
  validityEnd?: string;
}

/**
 * Respuesta de GET /capacities?id={capacityId}&date={DD/MM/YYYY}
 *
 * Los días de una agenda de recepción, ya filtrados desde la fecha pedida.
 * Es la misma información que `capacitiesSelected` trae incrustada en la
 * agenda, pero es la que manda: es la que lee y escribe el PUT.
 */
export interface ReceptionCapacitiesResponse {
  id?: string;
  _id?: string;
  capacityByDayArray?: CapacityByDay[];
}

/**
 * Lo que devuelve Ripley al guardar una capacidad de recepción.
 *
 * Es el resultado crudo de la escritura en su base de datos. `matchedCount: 0`
 * significa que no encontró el día y **no** es un error HTTP: responde 200
 * igual, así que hay que mirarlo.
 */
export interface ResultadoEscritura {
  acknowledged?: boolean;
  matchedCount?: number;
  modifiedCount?: number;
  upsertedId?: string | null;
  upsertedCount?: number;
}

/**
 * Un día tal como lo espera el PUT de recepción.
 *
 * Además del día en sí lleva dos campos derivados de `day` que manda el panel
 * corporativo: la misma fecha en `DD-MM-YYYY` y el nombre del día en inglés.
 * Son redundantes —salen de `day`—, pero se envían igual porque no hay forma de
 * comprobar si el servidor los usa, y sobrar es más barato que faltar.
 */
export interface ReceptionCapacityDay extends CapacityByDay {
  /** "2026-10-02T00:00:00.000Z" -> "02-10-2026" */
  parsedDate: string;
  /** "2026-10-02T00:00:00.000Z" -> "Friday" */
  parsedDay: string;
}

/**
 * El objeto "schedules" que exige el PUT de recepción.
 *
 * Misma forma que el de picking, pero de otro endpoint: se declara aparte para
 * que uno pueda cambiar sin arrastrar al otro. `idOffice` es el **código
 * visible** de la oficina ("20021"), no su id interno.
 */
export interface ReceptionScheduleConfig {
  country: string;
  idOffice: string;
  type: string;
  typeOfService: string;
  unitMeasure: string;
}
