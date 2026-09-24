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

// ───────────────────────── Modo del agente ─────────────────────────

/**
 * Consultor lee; editor lee y además escribe.
 *
 * No hay un tercer modo ni un permiso por endpoint: el interruptor es uno solo
 * y se ve en el chat, porque un permiso que no se ve es un permiso que se
 * olvida encendido.
 */
export type ModoAgente = 'consultor' | 'editor';

export interface EstadoModo {
  modo: ModoAgente;
  /** Cuándo vuelve solo a consultor. En consultor, null. */
  expiraEn: string | null;
  minutosRestantes: number;
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
  /** Solo las jornadas propias del CD */
  jornadas: JornadaReporte[];
  /** Suma de las jornadas propias, por fecha */
  total: CeldaReporte[];
  /** Jornadas que Ripley devolvió y no cuentan para este CD */
  excluidas: string[];
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
  /**
   * Las relaciones encontradas.
   *
   * Si no se pidió ningún destino, son todos los del origen. Si se pidieron
   * uno o varios, son los que se resolvieron: **una sola forma que
   * interpretar**, vengan uno o veinte.
   */
  destinos: Transferencia[];
  /**
   * Los destinos pedidos que no dieron una relación, con su motivo.
   *
   * Van aparte y no como un aviso suelto porque preguntar por once destinos y
   * que fallen dos no puede leerse igual que si hubieran fallado los once.
   */
  noEncontrados?: Array<{ destino: string; motivo: string }>;
  /** Explica por qué no hay resultado, en vez de devolver vacío sin más */
  aviso?: string;
}

// ───────────────────────── Tipos de servicio ─────────────────────────

export interface ServicioAgenda {
  code: string;
  descripcion: string;
  activo: boolean;
  enCheckout: boolean;
  /**
   * Máximo de ocurrencias, tal como se llama en el panel.
   *
   * Estaba en la respuesta de Ripley y se descartaba al compactar. No es un
   * campo interno ni un identificador: es parte de la configuración por la que
   * se pregunta, y faltaba en la respuesta del agente sin que nada lo dijera.
   */
  maxOcurrencia: number | null;
  /** Días de holgura */
  diasHolgura: number | null;
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

/** Una combinación OPL × tipo de servicio, con su fecha de entrega */
export interface ResultadoSimulacion {
  opl: string;
  destino: string;
  /** Tipo de servicio que devolvió Ripley: con servicio vacío vienen varios */
  servicio: string;
  entrega: string | null;
  /** Solo si esa combinación falló; las demás siguen valiendo */
  error?: string;
}

export interface SimulacionRespuesta {
  contexto: ContextoAgente;
  parametros: {
    /** null significa que se pidieron todos los tipos aplicables */
    servicio: string | null;
    metodo: string;
    /** null si no se fijó fuente de stock: la eligió Ripley */
    almacen: string | null;
    sku: string;
    cantidad: number;
    /** true si se simularon los OPL predeterminados por no indicarse ninguno */
    usoPredeterminados: boolean;
  };
  resultados: ResultadoSimulacion[];
  aviso?: string;
}

// ───────────────────────── Búsqueda masiva ─────────────────────────

/** Una agenda encontrada por servicio, sin identificadores internos */
export interface AgendaMasiva {
  opl: string;
  agenda: string;
  zona: string;
  servicio: string;
  activa: boolean;
  enCheckout: boolean;
}

export interface BusquedaMasivaRespuesta {
  contexto: ContextoAgente;
  /** Códigos ya resueltos, por si el usuario los dio por su nombre */
  metodo: string;
  servicio: string;
  origenes: string[];
  /** Cuenta TODAS las agendas, aunque la lista venga recortada */
  resumen: {
    total: number;
    activas: number;
    enCheckout: number;
  };
  agendas: AgendaMasiva[];
  aviso?: string;
}

// ───────────────────────── Edición ─────────────────────────

/** El estado de un día, antes o después de tocarlo */
export interface EstadoDia {
  fecha: string;
  activo: boolean;
  asignado: number;
  ocupado: number;
  disponible: number;
  uso: number;
}

/**
 * Un día del rango, con lo que se le hizo.
 *
 * `error` no aborta el resto: un día que no existe en la agenda se anota y se
 * sigue con los demás. Cuando lo lleva, `despues` viene en null.
 */
export interface DiaEditado {
  fecha: string;
  antes: EstadoDia | null;
  despues: EstadoDia | null;
  error?: string;
}

/**
 * Lo que se devuelve tras escribir.
 *
 * Lleva el antes y el después **releídos de Ripley**, no lo que se pidió: si el
 * agente informa de lo que creía que iba a pasar en vez de lo que pasó, el
 * usuario se entera del desajuste en el peor momento, que es más tarde.
 *
 * Siempre es una lista, aunque se haya pedido un solo día: así el agente no
 * tiene dos formas que interpretar según cuántos días vinieran.
 */
/** Una agenda con lo que le pasó a cada día pedido */
export interface AgendaEditada {
  agenda: string;
  zona?: string;
  dias: DiaEditado[];
  /** Por qué esta agenda no se tocó, cuando las demás sí */
  error?: string;
}

export interface EdicionRespuesta {
  contexto: ContextoAgente;
  tipo: 'picking' | 'despacho';
  oficina: string;
  /**
   * Una entrada por agenda pedida.
   *
   * Viene siempre, aunque se haya pedido una sola: dos formas que interpretar
   * según cuántas vinieran es una de más.
   */
  agendas: AgendaEditada[];
  resumen: {
    pedidos: number;
    cambiados: number;
    sinCambiar: number;
  };
}
