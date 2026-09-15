/** Referencia corta que usa la API en los payloads: id, código y etiqueta */
export interface OpcionRef {
  id: string | number;
  code: string;
  label: string;
}

// ---------- GET /delivery ----------

/** Un tipo de servicio dentro de un método de entrega */
export interface ServicioDelivery {
  id: string;
  code: string;
  description?: string;
  isActive?: boolean;
  enabledForCheckout?: boolean;
  /** La API escribe "Ocurrence" con una sola c */
  maxOcurrence?: number;
  slackDays?: number;
}

/** Un método de entrega: DP, RT, V... */
export interface MetodoEntrega {
  id: string;
  code: string;
  description: string;
  typeOfServices: ServicioDelivery[];
}

// ---------- GET /catalogs ----------

export interface CatalogoResponse {
  id: string;
  identifier: string;
  description: string;
  parameters: { id: number; code: string; label: string }[];
}

// ---------- POST /mainroutes/schedules/state ----------

/** Payload de la consulta */
export interface ConsultaStatePayload {
  deliveryMethod: OpcionRef & { typeOfServices: OpcionRef[] };
  typeOfService: OpcionRef;
  typeOfWarehouse: OpcionRef[];
}

/** Una agenda tal como la devuelve la consulta */
export interface AgendaState {
  id: string;
  active: boolean;
  opl: string;
  scheduleName: string;
  zone: string;
  typeOfService: string;
  idService: string;
  enabledForCheckout: boolean;
  mainSchedule: string;
  mainZone: string;
  courier: string;
}

export interface ConsultaStateResponse {
  rows: AgendaState[];
}

// ---------- POST /mainroutes/update/state ----------

/**
 * Una fila del payload de actualización.
 * Ojo: los nombres cambian respecto a la consulta —
 * "id" pasa a "mainRouteId" y "active" pasa a "isActive".
 */
export interface FilaActualizacion {
  mainRouteId: string;
  idService: string;
  courier: string;
  mainSchedule: string;
  mainZone: string;
  opl: string;
  scheduleName: string;
  zone: string;
  typeOfService: string;
  isActive: boolean;
  enabledForCheckout: boolean;
  /** Bandera de UI del frontend original; se envía por compatibilidad */
  changed: boolean;
  /** Índice de la fila en la tabla del frontend original */
  tableData: { id: number };
}

export interface ActualizacionPayload {
  type: string;
  data: FilaActualizacion[];
}

/** Resultado por fila que devuelve Mongo a través de la API */
export interface ResultadoEscritura {
  acknowledged: boolean;
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: string | null;
}

export interface ActualizacionResponse {
  rows: ResultadoEscritura[];
}