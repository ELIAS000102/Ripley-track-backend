/**
 * Un día de capacidad, ya normalizado.
 *
 * Picking y despacho devuelven formas distintas (fechas ISO contra DD-MM-YYYY,
 * asignado numérico contra texto); aquí se unifican. Además se calculan
 * `disponible` y `uso` en el backend: un modelo de lenguaje se equivoca haciendo
 * aritmética, así que conviene dárselo resuelto.
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

/** Lo que devuelve la consulta consolidada del agente */
export interface CapacidadRespuesta {
  tipo: 'picking' | 'despacho';
  pais: string;
  oficina: string;
  desde: string;
  agendas: AgendaCapacidad[];
  /** Agendas que no se pudieron consultar, para que el agente no invente */
  sinDatos: string[];
}
