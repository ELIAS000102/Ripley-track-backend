// Respuestas de Ripley que comparten varios módulos
export type {
  CapacitiesResponse,
  CapacityByDay,
  OfficeRow,
  RipleyListResponse,
  ScheduleRow,
  ServiceRow,
} from '../../../common/ripley/interfaces/ripley.interface.js';

/**
 * Un centro de distribución, tal como lo configura la operación en el panel.
 *
 * No hay ninguno escrito en el código: viven en la tabla `reportes` (tipo
 * "cd"), por país. De aquí salen el reporte de los CDs y lo que la agente sabe
 * de cada uno: cómo se llama, qué jornadas tiene y entre cuáles puede mover
 * capacidad.
 */
export interface Cd {
  code: string;
  nombre: string;
  /**
   * Jornadas de picking que forman el reporte de este CD.
   *
   * Ripley devuelve más de las que la operación considera suyas —agendas de
   * prueba, restos de configuraciones viejas—, y sumarlas todas infla el
   * porcentaje de uso. Las demás no se consultan, y se informan en vez de
   * descartarse en silencio.
   */
  jornadas: string[];
  /** Otras formas de nombrarlo en el chat: "villa", "ves", "aldeas" */
  alias: string[];
  /** Entre estas jornadas la agente reasigna capacidad sin pedir autorización */
  libres: string[];
  /** Estas jornadas pueden reasignarse entre fechas distintas */
  cruzanFecha: string[];
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
  /** Por CD, las jornadas que tiene en Ripley y no forman su reporte: no se consultan */
  excluidas: Record<string, string[]>;
  cobertura: {
    agendas: number;
    exitosas: number;
    /** Agendas que existen pero no tienen capacidades creadas */
    vacias: number;
    fallidas: FalloReporte[];
  };
}
