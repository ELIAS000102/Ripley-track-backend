export type {
  OfficeRow,
  RipleyListResponse,
} from '../../common/ripley/interfaces/ripley.interface.js';

// ---------- Geografía ----------

export interface Comuna {
  id: string;
  name: string;
  code: string;
  identifier: string;
  province: string;
  region: string;
}

export interface Provincia {
  id: string;
  name: string;
  code: string;
  communes: Comuna[];
}

/** GET /regions/{id} devuelve el árbol completo en una sola llamada */
export interface RegionDetalle {
  id: string;
  name: string;
  code: string;
  provinces: Provincia[];
}

/** GET /regions devuelve la lista sin anidar */
export interface RegionRow {
  id: string;
  name: string;
  code: string;
}

// ---------- Productos ----------

export interface SkuRow {
  id: string;
  code: number;
  name: string;
  description: string;
  type: {
    isStoreProduct: boolean;
    isCargoProduct: boolean;
    isMarketplaceProduct: boolean;
  };
}

/** GET /sku devuelve { rows } sin count */
export interface SkuResponse {
  rows: SkuRow[];
}

// ---------- Simulación ----------

/** Cada paso del cálculo, con la fecha que arrastra */
export interface PasoLog {
  type: string;
  isActive: boolean;
  functionName: string;
  date: number;
  isoDate: string;
}

/** El recorrido físico del pedido */
export interface PasoFulfillment {
  sequence: number;
  warehouse: string;
  warehouseName: string;
  destinationNode: string;
  destinationName: string;
  planningPickingDate: string;
  transferToOPLDate: string;
  pickingDate: string;
  transferDate: string;
  receptionDate: string;
  dispatchDay: string;
}

export interface OpcionSimulada {
  courier: string;
  warehouse: string;
  cutTime: string;
  saleDate: string;
  date: string;
  cargo: number;
  cargoOrigin: string;
  countCargo: number;
  sizeCargo: string;
  log: PasoLog[];
  fulfillment: PasoFulfillment[];
}

export interface ResultadoServicio {
  simulator: OpcionSimulada[];
  scheduleName: string;
  zoneName: string;
  freightSimulate: unknown;
}

export interface MatrizSimulacion {
  typeOfServices: Record<string, ResultadoServicio>;
  products: {
    sku: number;
    description: string;
    sizeName: string;
    department: string;
  }[];
  deliveryMethod: string;
  error: unknown[];
}

export interface SimulacionResponse {
  matrix: MatrizSimulacion[];
  message: string;
  skusInBlacklist: unknown[];
}

/** Payload que espera la API: el cliente no lo arma, lo reconstruye el backend */
export interface SimulacionPayload {
  products: {
    sku: number;
    quantity: string;
    type: SkuRow['type'];
  }[];
  channelSales: string;
  stock: number;
  isCheckout: boolean;
  useFreightEngineSimulation: boolean;
  commune: string;
  localityCode: string;
  country: string;
  courier: string;
  warehouse: string;
  pickupStoreCode: string;
  deliveryMethod: string;
  /**
   * null pide TODOS los tipos aplicables al destino.
   *
   * No es lo mismo que la cadena vacía: con "" Ripley devuelve una matriz
   * vacía, con null devuelve la matriz completa. El panel manda null.
   */
  typeOfServiceCode: string | null;
  date: string;
  hour: string;
  region: RegionDetalle;
}
