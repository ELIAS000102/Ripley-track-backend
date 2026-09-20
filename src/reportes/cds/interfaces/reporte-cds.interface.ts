// Respuestas de Ripley que comparten varios módulos
export type {
  CapacitiesResponse,
  CapacityByDay,
  OfficeRow,
  RipleyListResponse,
  ScheduleRow,
  ServiceRow,
} from '../../../common/ripley/interfaces/ripley.interface.js';

/** Un centro de distribución */
export interface Cd {
  code: string;
  nombre: string;
  /**
   * Jornadas que cuentan para el total de este CD.
   *
   * Ripley devuelve más de las que la operación considera suyas —agendas de
   * prueba, restos de configuraciones viejas—, y sumarlas todas infla el
   * porcentaje de uso. Cada CD tiene su lista, y lo que quede fuera se informa
   * en vez de descartarse en silencio.
   */
  jornadas: string[];
}

/** El grano fino del reporte: un CD, una jornada, un día */
export interface RegistroReporte {
  cd: string;
  jornada: string;
  fecha: string; // YYYY-MM-DD
  asignado: number;
  utilizado: number;
  porcentaje: number; // utilizado / asignado, en entero
  activo: boolean; // el día está activo
  agendaActiva: boolean;
  sinDato: boolean; // la agenda no tiene ese día configurado
}

/** Una agenda que no se pudo consultar */
export interface FalloReporte {
  cd: string;
  jornada: string | null;
  agenda: string | null;
  error: string;
}

export interface ReporteCds {
  parametros: {
    pais: string;
    desde: string;
    dias: number;
    fechas: string[];
  };
  cds: Cd[];
  jornadas: { code: string }[];
  registros: RegistroReporte[];
  cobertura: {
    agendas: number;
    exitosas: number;
    /** Agendas que existen pero no tienen capacidades creadas */
    vacias: number;
    fallidas: FalloReporte[];
  };
}
