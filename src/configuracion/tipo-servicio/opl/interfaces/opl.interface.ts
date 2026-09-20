export type {
  CatalogoResponse,
  MainScheduleRow,
  MainZoneRow,
  OfficeRow,
  RipleyListResponse,
} from '../../../../common/ripley/interfaces/ripley.interface.js';

/** Hora de corte de un día: id 1 = lunes … 7 = domingo */
export interface HoraCorte {
  id: number;
  label: string;
  value: string;
}

/** Canal de venta asignado a un servicio */
export interface CanalVenta {
  id: number;
  label: string;
}

/**
 * Un servicio configurado en la agenda del OPL.
 * Ojo: la API mezcla tipos — maxOcurrence llega como número o string,
 * y escribe "Ocurrence" con una sola c.
 */
export interface TipoServicioOpl {
  id: string;
  code: string;
  label: string;
  description: string;
  cutTime: HoraCorte[];
  channelSale: CanalVenta[];
  isActive: boolean;
  enabledForCheckout: boolean;
  maxOcurrence: number | string;
  slackDays: number | string;
  delivery: string;
  deliveryMethod: string;
  isSyncWithBigticket?: boolean;
  mainRouteId: string;
  mainSchedule: string;
  mainZone: string;
  courier: string;
}

export interface ListaServiciosResponse {
  typeOfServices: TipoServicioOpl[];
}

/** Los tres identificadores que ubican una agenda de OPL */
export interface ContextoAgenda {
  courier: string;
  mainZone: string;
  mainSchedule: string;
}
