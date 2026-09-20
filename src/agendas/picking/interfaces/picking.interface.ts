// Respuestas de Ripley que comparten varios módulos
export type {
  CapacitiesResponse,
  CapacityByDay,
  OfficeRow,
  RipleyListResponse,
  ScheduleRow,
  ScheduleType,
  ServiceRow,
} from '../../../common/ripley/interfaces/ripley.interface.js';

/** El objeto "schedules" que exige el PUT de picking */
export interface ScheduleConfig {
  country: string;
  idOffice: string;
  type: string;
  typeOfService: string;
  unitMeasure: string;
}
