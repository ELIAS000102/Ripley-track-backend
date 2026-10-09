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

/** El día de la otra agenda al que lleva la malla */
export interface VinculoSt {
  fecha: string;
  etiqueta: string;
  /** Con qué malla se unió: "Valle" o el nombre del evento */
  malla: string;
  /** `null` si la agenda no tiene ese día */
  dia: DiaSt | null;
}

/** Un día de recepción con las transferencias que lo alimentan */
export interface DiaRecepcionSt extends DiaSt {
  /** La malla que toca a la tienda ese día: "Valle", un evento, o null sin ninguna */
  malla: string | null;
  transferencias: VinculoSt[];
}

/** Un día de transferencia con la recepción que le toca */
export interface DiaTransferenciaSt extends DiaSt {
  /** La malla con la que se cruza ese día */
  malla: string | null;
  recepcion: VinculoSt | null;
}

/** Un evento que la tienda tiene, con su vigencia en ella */
export interface EventoDeTienda {
  nombre: string;
  desde: string;
  hasta: string;
}

/**
 * Qué malla usa el reporte:
 * - "auto": la de un evento los días de su vigencia en cada tienda, y la de valle el resto;
 * - "valle": la de valle siempre, aunque haya eventos;
 * - el nombre de un evento: ese evento todos los días en sus tiendas, y la de valle en las demás.
 */
export type ModoMalla = string;

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
  /** La de valle; `null` si la tienda no está en la matriz de valle vigente */
  malla: MallaDeTienda | null;
  /** Los eventos en los que está la tienda, con su vigencia en ella */
  eventos: EventoDeTienda[];
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
  malla: {
    cargada: boolean;
    archivo?: string | null;
    cargadaEn?: string;
    aviso?: string;
    /** Con qué se calculó: "auto", "valle" o el nombre de un evento */
    modo: ModoMalla;
    /** Los eventos del país, para poder elegir uno */
    eventos: Array<{ nombre: string; cargadaEn: string; tiendas: number }>;
  };
  grupos: Array<{ nombre: string; tiendas: TiendaReporte[]; totales: TotalesSt }>;
  totales: TotalesSt;
  cobertura: {
    tiendas: number;
    fallidas: Array<{ codigo: string; agenda: Vista; error: string }>;
    /** La API corporativa dejó de responder y no se preguntó por el resto */
    caida: boolean;
  };
}
