// Compartidas con las demás agendas
export type {
  OfficeRow,
  RipleyListResponse,
} from '../../../common/ripley/interfaces/ripley.interface.js';

/** Un día dentro de la agenda de capacidades */
export interface CapacityByDay {
  day: string;
  active: boolean;
  assigned: number;
  occupied: number;
}

/** Respuesta de GET /capacities/picking/{scheduleId} */
export interface CapacitiesResponse {
  _id: string;
  schedule: string;
  warehouse: string;
  services: string[];
  capacityByDayArray: CapacityByDay[];
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

/** Una agenda dentro de GET /schedules/picking?warehouse={id} */
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

/** Un servicio del catálogo GET /services */
export interface ServiceRow {
  id: string;
  code: string;
  description?: string;
}

/** El objeto "schedules" que exige el PUT de picking */
export interface ScheduleConfig {
  country: string;
  idOffice: string;
  type: string;
  typeOfService: string;
  unitMeasure: string;
}
