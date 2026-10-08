import type { Dia, ParMalla } from '../../../mallas_leadtime/interfaces/malla.interface.js';

/** Las dos agendas que se cruzan por cada tienda */
export type Vista = 'recepcion' | 'transferencia';

/** Una punta de la transferencia, como se lee en pantalla */
export interface LadoSt {
  code: string | null;
  nombre: string;
}

/** La agenda de recepción de la tienda: la oficina es la propia tienda */
export interface AgendaRecepcionSt {
  scheduleId: string;
  /** El de su capacidad: con él se leen los días sin volver a resolver la agenda */
  capacityId: string;
  nombre: string;
  servicio: string | null;
}

/** La agenda de transferencia que llega a la tienda */
export interface AgendaTransferenciaSt extends AgendaRecepcionSt {
  origen: LadoSt | null;
  destino: LadoSt;
  /** Cómo se encontró en el panel: por la sucursal de stock o por el clúster de destino */
  buscadaPor: 'origen' | 'destino';
}

/** Una tienda del reporte, con sus dos agendas ya elegidas */
export interface TiendaSt {
  /** El código de la tienda: el de su oficina de recepción y el de la matriz de valle */
  codigo: string;
  nombre: string;
  recepcion: AgendaRecepcionSt;
  transferencia: AgendaTransferenciaSt;
}

export interface GrupoSt {
  nombre: string;
  tiendas: TiendaSt[];
}

/** Lo que dice la matriz de valle de una tienda */
export interface MallaDeTienda {
  tienda: string;
  desfase: number;
  /** Los días que transfiere con recepción: los que valen */
  transfiere: Dia[];
  pares: ParMalla[];
  /** Etiquetas de transferencia sin pareja, que se ignoran */
  ignoradas: string[];
}

/** Un día de una agenda, como se enseña */
export interface DiaSt {
  fecha: string;
  activa: boolean;
  asignado: number;
  utilizado: number;
  /** Asignado menos utilizado: negativo si se pasó */
  disponible: number;
  /** Utilizado sobre asignado; sin asignado no hay porcentaje */
  porcentaje: number | null;
}

/** El día de la otra agenda al que lleva la matriz */
export interface VinculoSt {
  fecha: string;
  etiqueta: string;
  /** `null` si la agenda no tiene ese día */
  dia: DiaSt | null;
}

/** Un día de recepción con las transferencias que lo alimentan */
export interface DiaRecepcionSt extends DiaSt {
  transferencias: VinculoSt[];
}

/** Un día de transferencia con la recepción que le toca */
export interface DiaTransferenciaSt extends DiaSt {
  recepcion: VinculoSt | null;
}

/** Una agenda dentro del reporte: alineada con las fechas, `null` donde no hay día */
export interface AgendaReporte<D> {
  nombre: string;
  servicio: string | null;
  dias: (D | null)[];
  error?: string;
}

export interface TiendaReporte {
  codigo: string;
  nombre: string;
  /** `null` si la tienda no está en la matriz vigente */
  malla: MallaDeTienda | null;
  origen: LadoSt | null;
  destino: LadoSt;
  recepcion: AgendaReporte<DiaRecepcionSt>;
  transferencia: AgendaReporte<DiaTransferenciaSt>;
}

/** La suma de un día, contando solo los días abiertos */
export interface TotalDia {
  fecha: string;
  asignado: number;
  utilizado: number;
  disponible: number;
  porcentaje: number | null;
  /** Tiendas con ese día abierto */
  abiertas: number;
}

export type TotalesSt = Record<Vista, TotalDia[]>;

export interface ReporteSt {
  parametros: { pais: string; desde: string; semanas: number; fechas: string[] };
  malla: { cargada: boolean; archivo?: string | null; cargadaEn?: string; aviso?: string };
  grupos: Array<{ nombre: string; tiendas: TiendaReporte[]; totales: TotalesSt }>;
  totales: TotalesSt;
  cobertura: {
    tiendas: number;
    fallidas: Array<{ codigo: string; agenda: Vista; error: string }>;
    /** La API corporativa dejó de responder y no se preguntó por el resto */
    caida: boolean;
  };
}
