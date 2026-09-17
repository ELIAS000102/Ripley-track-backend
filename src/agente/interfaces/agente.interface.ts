/**
 * Formas que devuelve el backend al agente de IA.
 *
 * Todas siguen el mismo criterio: **el modelo paga por token**, así que aquí se
 * devuelve lo mínimo que hace falta para responder, ya resuelto. Nada de
 * identificadores internos, nada de campos que el modelo no vaya a leer, y la
 * aritmética hecha —un modelo de lenguaje se equivoca calculando porcentajes—.
 */

/** Quién pregunta y desde cuándo. Va en la cabecera de toda respuesta. */
export interface ContextoAgente {
  usuario: {
    nombre: string;
    /** Rol en la aplicación, por si el agente debe ajustar el tono */
    rol: string;
    tienda: string | null;
  };
  /** Hoy en la zona horaria del país, para que el modelo no lo deduzca */
  hoy: string;
  pais: string;
}

// ───────────────────────── Capacidad ─────────────────────────

/**
 * Un día de capacidad, ya normalizado.
 *
 * Picking y despacho devuelven formas distintas (fechas ISO contra DD-MM-YYYY,
 * asignado numérico contra texto); aquí se unifican. `disponible` y `uso` se
 * calculan en el backend a propósito.
 */
export interface DiaCapacidad {
  fecha: string;
  activo: boolean;
  asignado: number;
  ocupado: number;
  disponible: number;
  /** Porcentaje de ocupación, entero */
  uso: number;
}

/** Una agenda con sus días */
export interface AgendaCapacidad {
  agenda: string;
  /** Tipo de servicio en picking; lista de servicios en despacho */
  servicio: string | null;
  /** Solo en despacho */
  zona?: string;
  unidad: string | null;
  dias: DiaCapacidad[];
}

export interface CapacidadRespuesta {
  tipo: 'picking' | 'despacho';
  pais: string;
  oficina: string;
  desde: string;
  agendas: AgendaCapacidad[];
  /** Agendas que no se pudieron consultar, para que el agente no invente */
  sinDatos: string[];
}

// ───────────────────────── Reporte de CDs ─────────────────────────

/**
 * El reporte es lo que más contexto consumía: una fila suelta por cada
 * combinación de CD, jornada y fecha, con los nombres de campo repetidos en
 * todas. Aquí va pivotado y en tuplas posicionales `[utilizado, asignado, uso]`,
 * alineadas con el array `fechas`. Una celda pasa de ~148 caracteres a ~15.
 */
export type CeldaReporte = [utilizado: number, asignado: number, uso: number];

export interface JornadaReporte {
  jornada: string;
  /** Una celda por fecha, en el mismo orden que `fechas` */
  dias: CeldaReporte[];
  /** true si la jornada estuvo inactiva todos los días del rango */
  inactiva: boolean;
}

export interface CdReporte {
  cd: string;
  nombre: string;
  jornadas: JornadaReporte[];
  /** Suma de todas las jornadas, por fecha */
  total: CeldaReporte[];
}

export interface ReporteRespuesta {
  contexto: ContextoAgente;
  /** Cabeceras de columna, formato DD/MM */
  fechas: string[];
  cds: CdReporte[];
  /** Leyenda de las tuplas, para que el modelo no tenga que adivinar */
  formato: string;
  sinDatos: string[];
}

// ───────────────────────── Transferencias ─────────────────────────

export interface Transferencia {
  origen: string;
  destino: string;
  habilitada: boolean;
  /** Días de preparación antes de que salga */
  preparacion: number;
  /** Días de tránsito */
  transito: number;
  /** preparacion + transito, resuelto aquí para que el modelo no sume */
  desfase: number;
  /** Días en español, o "todos los días" si están los siete */
  dias: string;
}

export interface TransferenciaRespuesta {
  contexto: ContextoAgente;
  /** La relación pedida, si se preguntó por un destino concreto */
  transferencia?: Transferencia;
  /** Todos los destinos del origen, si no se pidió uno concreto */
  destinos?: Transferencia[];
  /** Explica por qué no hay resultado, en vez de devolver vacío sin más */
  aviso?: string;
}

// ───────────────────────── Tipos de servicio ─────────────────────────

export interface ServicioAgenda {
  code: string;
  descripcion: string;
  activo: boolean;
  enCheckout: boolean;
  /** Horas de corte, ya aplanadas */
  cortes: string[];
}

export interface TipoServicioRespuesta {
  contexto: ContextoAgente;
  opl: string;
  zona: string;
  agenda: string;
  servicios: ServicioAgenda[];
  sinDatos: string[];
}

// ───────────────────────── Simulación ─────────────────────────

export interface SimulacionRespuesta {
  contexto: ContextoAgente;
  /** Lo que se preguntó: cuándo llegaría */
  entrega: string | null;
  /** Con qué datos se calculó, ya resueltos a nombres legibles */
  usado: {
    metodo: string;
    servicio: string;
    almacen: string;
    operador: string;
    destino: string;
    sku: string;
    cantidad: number;
  };
  aviso?: string;
}
