export type {
  OfficeRow,
  RipleyListResponse,
} from '../../../common/ripley/interfaces/ripley.interface.js';

/** Días hábiles de la relación. La API usa los nombres en inglés como claves. */
export interface DiasDisponibles {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
}

/** Una relación de transferencia entre el almacén origen y un destino */
export interface Relacion {
  _id: string;
  courier: string;
  label: string;
  transferPeriod: number;
  preTransferPeriod: number;
  canTransfer: boolean;
  availableDays: DiasDisponibles;
}

/**
 * GET /officerelationship/by-warehouse devuelve un único documento
 * con todas las relaciones, no el envoltorio { count, rows }.
 */
export interface RelacionesResponse {
  id?: string;
  _id?: string;
  warehouse: string;
  relationships: Relacion[];
}

/**
 * Payload del PUT: una relación a la vez.
 * Incluye campos que no vienen en la lectura y que hay que reconstruir.
 */
export interface RelacionPayload extends Relacion {
  stockOfficeId: string;
  relationshipType: string;
  /** Espejo numérico de canTransfer que espera la API */
  canTransferValue: number;
}
