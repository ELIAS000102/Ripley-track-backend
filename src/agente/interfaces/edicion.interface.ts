import type { ContextoAgente } from './agente.interface.js';

/**
 * Formas de lo que el agente devuelve **después de escribir**.
 *
 * Todas siguen el mismo patrón: el antes y el después, releídos de Ripley. Si
 * el agente informara de lo que creía que iba a pasar en vez de lo que pasó, el
 * usuario se enteraría del desajuste en el peor momento, que es más tarde.
 */

// ───────────────────────── Tipo de servicio ─────────────────────────

/** El estado editable de un servicio dentro de una agenda */
export interface EstadoServicio {
  activo: boolean;
  enCheckout: boolean;
  /** Las horas de corte como se leen: "lunes 23:30, martes 23:30" */
  cortes: string[];
}

/** Un servicio de los pedidos, con lo que le pasó */
export interface ServicioEditado {
  servicio: string;
  antes: EstadoServicio | null;
  despues: EstadoServicio | null;
  /** Por qué este no se tocó, cuando los demás sí */
  error?: string;
}

export interface TipoServicioEditado {
  contexto: ContextoAgente;
  opl: string;
  zona: string;
  agenda: string;
  /**
   * Un elemento por servicio pedido. La lista viene siempre, aunque se haya
   * pedido uno solo: dos formas que interpretar es una de más.
   */
  servicios: ServicioEditado[];
  resumen: {
    pedidos: number;
    cambiados: number;
    sinCambiar: number;
  };
}

// ───────────────────────── Activación masiva ─────────────────────────

/** Una agenda tocada por un cambio en bloque */
export interface AgendaCambiada {
  opl: string;
  agenda: string;
  zona: string;
  antes: { activo: boolean; enCheckout: boolean };
  despues: { activo: boolean; enCheckout: boolean };
}

export interface MasivoEditado {
  contexto: ContextoAgente;
  metodo: string;
  servicio: string;
  /** Los operadores a los que se acotó, o "todos" */
  opls: string;
  /**
   * La lista completa de lo que se cambió.
   *
   * Va entera y no resumida a propósito: un cambio en bloque solo se puede
   * revisar viendo los nombres, y por eso hay un tope de agendas por llamada.
   */
  cambiadas: AgendaCambiada[];
  resumen: {
    /** Las que devolvió la búsqueda, antes de acotar */
    encontradas: number;
    /** Las que quedaron tras filtrar por operador y estado */
    alcanzadas: number;
    cambiadas: number;
    /** Las que ya estaban como se pedía */
    sinCambiar: number;
  };
}

// ───────────────────────── Transferencia ─────────────────────────

/** El estado editable de una relación entre dos almacenes */
export interface EstadoTransferencia {
  habilitada: boolean;
  preparacion: number;
  transito: number;
  /** preparacion + transito, sumado aquí para que el modelo no calcule */
  desfase: number;
  /** Los días en español, o "todos los días" si están los siete */
  dias: string;
}

/**
 * Un destino de los pedidos, con lo que le pasó.
 *
 * `antes` y `despues` van a null cuando el destino no se pudo resolver: se
 * anota el motivo en `error` y los demás siguen. Cambiar el desfase de cinco
 * tiendas y que la tercera no exista no puede dejar las otras cuatro sin tocar
 * y sin explicación.
 */
export interface DestinoEditado {
  destino: string;
  antes: EstadoTransferencia | null;
  despues: EstadoTransferencia | null;
  error?: string;
}

export interface TransferenciaEditada {
  contexto: ContextoAgente;
  /** De dónde SALE el stock */
  origen: string;
  /**
   * Un elemento por destino pedido, en el orden en que se pidieron.
   *
   * La lista viene siempre, aunque se haya pedido un solo destino: así el
   * agente no tiene dos formas que interpretar según cuántos vinieran.
   */
  destinos: DestinoEditado[];
  resumen: {
    pedidos: number;
    cambiados: number;
    sinCambiar: number;
  };
}

// ───────────────────────── Cortar un CD ─────────────────────────

/** Una jornada de un CD en una fecha, con lo que le pasó */
export interface JornadaCerrada {
  cd: string;
  jornada: string;
  agenda: string;
  fecha: string;
  antes: boolean | null;
  despues: boolean | null;
  /** Por qué esta no se tocó, cuando las demás sí */
  error?: string;
}

export interface CdEditado {
  contexto: ContextoAgente;
  /** Uno, o los dos del país si se pidió el país entero */
  cds: string[];
  fechas: string[];
  activa: boolean;
  /**
   * Una entrada por jornada y fecha. Va entera y no resumida: cortar un CD
   * toca muchas agendas de golpe y la única forma de revisarlo es viendo
   * cuáles.
   */
  jornadas: JornadaCerrada[];
  resumen: {
    pedidas: number;
    cambiadas: number;
    sinCambiar: number;
  };
}

// ───────────────────────── Reasignar capacidad ─────────────────────────

/** Una jornada antes y después de moverle capacidad */
export interface JornadaReasignada {
  jornada: string;
  agenda: string;
  fecha: string;
  asignadoAntes: number;
  asignadoDespues: number;
  ocupado: number;
  disponible: number;
}

export interface CapacidadReasignada {
  contexto: ContextoAgente;
  cd: string;
  unidades: number;
  origen: JornadaReasignada;
  destino: JornadaReasignada;
  /** Se dice cuando la pareja exigía permiso y se declaró tenerlo */
  conAutorizacion?: boolean;
}
