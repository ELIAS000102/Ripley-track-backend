export type {
  MainScheduleRow,
  MainZoneRow,
  OfficeRow,
  RipleyListResponse,
} from '../../../common/ripley/interfaces/ripley.interface.js';

/** Tipo de servicio ya resuelto por la API */
export interface ServiceTypeRef {
  id: string;
  code: string; // "EX", "DT"...
  label: string;
}

/** Configuración general de la agenda — GET /capacities/base?id={mainScheduleId} */
export interface CapacityBaseResponse {
  frecuency: number[];
  unitMeasure: string;
  /** En algunas respuestas viene también en la raíz */
  serviceType?: ServiceTypeRef[];
  schedule: {
    serviceType: ServiceTypeRef[];
    capacity: { id: number; label: string; value: string }[];
    init: string;
    end: string;
  };
}

/**
 * Un día de la agenda de despacho.
 * Ojo: "date" viene en DD-MM-YYYY y "assigned" como string.
 */
export interface CapacityDay {
  date: string;
  assigned: string;
  occupied: number;
  active: boolean;
}

/** Detalle día a día — GET /capacities/schedule?id={mainScheduleId}&date={DD-MM-YYYY} */
export interface CapacityScheduleResponse {
  wizard: string;
  schedule: string;
  capacity: CapacityDay[];
}

/** Cada entrada del "schedules" que exige el PUT (una por tipo de servicio) */
export interface DespachoScheduleConfig {
  country: string;
  idOffice: string;
  zoneId: string;
  type: string; // "despacho"
  typeOfService: string; // "EX", "DT"...
  unitMeasure: string;
}
