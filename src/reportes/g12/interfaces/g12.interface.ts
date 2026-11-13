/**
 * El G12: un tablero de Perú con la primera fecha disponible de cada flujo de
 * entrega y cuánto se lleva ocupado ese día.
 *
 * Se arma igual que un atajo, pero no es uno ni comparte nada con ellos:
 *
 *   la plantilla → sus componentes (los cuadros) → bloques por tipo → ítems
 *
 * Cada ítem dice a qué fila del cuadro pertenece y se escribe con códigos y
 * nombres —el operador 1111, el distrito Breña, la agenda "Agenda Picking RT"—,
 * nunca con identificadores internos de Ripley: si un operador cambia de
 * dirección, se cambia el distrito y nada más.
 */

/** Los cuadros de la plantilla. Cuáles hay y cómo se calcula cada uno lo fija el código */
export type ClaveComponente =
  | 'dd_lima'
  | 'sfs'
  | 'store_to_store'
  | 'pickup_lima'
  | 'pickup_provincia'
  | 'sts_lima'
  | 'sts_provincia'
  | 'dd_troncal'
  | 'retiro_cercano'
  | 'se_express';

/**
 * Qué hace un bloque:
 * - `simulacion`: la primera fecha de entrega que da el simulador;
 * - `picking`, `recepcion`, `despacho`: lo ocupado y lo asignado de una agenda;
 * - `capacidad`: un cupo escrito a mano por día de la semana, para lo que no
 *   tiene agenda en Ripley (Paquetería Lima, Big Ticket, Same Day…).
 */
export type TipoBloqueG12 = 'simulacion' | 'picking' | 'recepcion' | 'despacho' | 'capacidad';

/**
 * Cómo se calcula un cuadro:
 * - `simulada`: la fecha sale del simulador y la capacidad de ese día;
 * - `primer_dia`: la fecha es el primer día de la agenda activo y con cupo.
 */
export type RecetaG12 = 'simulada' | 'primer_dia';

export interface ItemG12 {
  /** La fila del cuadro a la que pertenece: el nombre que se ve en la plantilla */
  fila: string;
  nota?: string;
  /** Los campos de su tipo de bloque, por código o nombre */
  campos: Record<string, string | number>;
}

export interface BloqueG12 {
  tipo: TipoBloqueG12;
  nota?: string;
  /**
   * Solo en simulación: se simula primero un ítem y, si no da fecha, el resto
   * no se pide (quedan "omitidos"). Ahorra decenas de llamadas cuando un
   * servicio —RE, SE— no está habilitado en ninguna tienda. Como la "muestra"
   * del Excel.
   */
  muestra?: boolean;
  items: ItemG12[];
}

export interface FilaG12 {
  nombre: string;
  /** Si es una fila de total: las filas que suma (Paquetería Lima Total) */
  suma?: string[];
}

export interface ComponenteG12 {
  clave: ClaveComponente;
  filas: FilaG12[];
  bloques: BloqueG12[];
}

export interface ParteResumenG12 {
  componente: ClaveComponente;
  /** Una fila concreta; sin ella, el total del componente */
  fila?: string;
}

export interface LineaResumenG12 {
  nombre: string;
  partes: ParteResumenG12[];
}

export interface ConfiguracionG12 {
  componentes: ComponenteG12[];
  resumen: LineaResumenG12[];
}

// ───────────────────────── Lo que se lee de Ripley ─────────────────────────

/** Un día de una agenda, ya normalizado */
export interface DiaG12 {
  fecha: string;
  activo: boolean;
  asignado: number;
  ocupado: number;
  disponible: number;
}

export interface AgendaLeidaG12 {
  agenda: string;
  servicio: string | null;
  zona?: string;
  dias: DiaG12[];
}

/** Cómo fue una petición a Ripley: cuándo, cuánto tardó y cuántas veces se intentó */
export interface MetaPeticionG12 {
  inicio: string;
  ms: number;
  intentos: number;
  /** Por qué falló cada intento que se repitió (429, API caída…) */
  reintentos: string[];
  /**
   * Las llamadas que salieron de verdad a Ripley para esta petición, reintentos
   * incluidos: una fila del Excel son varias (operador → zonas → agendas →
   * capacidad). 0 si todo salió de lo ya leído en la actualización. Falta en
   * las actualizaciones de antes de contarlas.
   */
  llamadas?: number;
  /**
   * Lo que esperó a que se abriera la ventana del cupo de Ripley (110 llamadas
   * cada 60 s por token). Va dentro de \`ms\`. Falta en las de antes de medirlo.
   */
  esperaMs?: number;
}

/** Todo lo que devolvió el simulador, por servicio: lo que el Excel volcaba en sus hojas DC, STS, RT… */
export interface RespuestaSimulacionG12 {
  servicios: Array<{
    servicio: string;
    agenda: string | null;
    zona: string | null;
    opciones: Array<{
      fecha: string | null;
      horaCorte: string | null;
      almacen: string | null;
      operador: string | null;
      tamano: string | null;
    }>;
  }>;
  errores: string[];
  mensaje: string | null;
}

/** Una regla del cálculo de Ripley, con los días que suma a la entrega (como en el apartado Simulación) */
export interface PasoSimulacionG12 {
  /** El nodo: "warehouse" (sucursal de stock) o "courier" (operador logístico) */
  tipo: string;
  funcion: string;
  activo: boolean;
  /** La fecha que arrastra la regla, tal como la manda Ripley */
  fecha: string;
  diasAgregados: number;
  /** La entrega parcial después de la regla, YYYY-MM-DD */
  fechaParcial: string;
}

/** Un tramo del recorrido físico del pedido: de qué nodo a cuál, y cuándo cada cosa */
export interface TramoRecorridoG12 {
  secuencia: number | null;
  origen: string | null;
  origenNombre: string | null;
  destino: string | null;
  destinoNombre: string | null;
  planificacionPicking: string | null;
  picking: string | null;
  transferenciaOpl: string | null;
  transferencia: string | null;
  recepcion: string | null;
  despacho: string | null;
}

/**
 * Por qué sale esa fecha: de la venta a la entrega, la opción del simulador que
 * da la fecha de la fila. Solo de esa opción, no de todas: son ~160 simulaciones
 * por actualización y el resto no se mira.
 */
export interface TrazaSimulacionG12 {
  fechaVenta: string | null;
  fechaEntrega: string | null;
  horaCorte: string | null;
  almacen: string | null;
  operador: string | null;
  tamano: string | null;
  bultos: number | null;
  /** La suma de los días que agregan los pasos: de la venta a la entrega */
  diasTotales: number;
  pasos: PasoSimulacionG12[];
  recorrido: TramoRecorridoG12[];
}

/** Lo que devolvió un ítem de simulación */
export interface SimulacionG12 {
  servicio: string;
  /** Primera fecha de entrega, YYYY-MM-DD; null si Ripley no dio ninguna */
  fecha: string | null;
  /** Lo que se mandó, por nombre, para enseñarlo en el detalle */
  pedido: Record<string, string | number | null>;
  agenda?: string | null;
  zona?: string | null;
  /** Por qué no hay fecha, si Ripley lo dijo */
  mensaje?: string | null;
  /** La simulación no se pudo hacer: el operador no existe, la API falló… */
  error?: string | null;
  /** No se pidió: la muestra del bloque no dio fecha */
  omitida?: boolean;
  meta?: MetaPeticionG12;
  /** De la venta a la entrega, la opción que da la fecha: los pasos del cálculo y el recorrido. Falta en las de antes */
  traza?: TrazaSimulacionG12 | null;
  /** Todo lo que devolvió Ripley; solo va en el registro de peticiones, no en las filas */
  respuesta?: RespuestaSimulacionG12 | null;
}

/** Lo que devolvió un ítem de agenda (picking, recepción o despacho) */
export interface AgendaG12 {
  tipo: 'picking' | 'recepcion' | 'despacho';
  pedido: Record<string, string | number | null>;
  agendas: AgendaLeidaG12[];
  error?: string | null;
  /** Se encontró, pero no como se pidió (la zona del Excel no existe y el operador tiene una sola) */
  aviso?: string | null;
  meta?: MetaPeticionG12;
}

/** Una petición del G12 a Ripley, para el registro: qué se pidió, qué volvió y cómo fue */
export interface PeticionG12 {
  componente: ClaveComponente;
  cuadro: string;
  fila: string;
  /** El número del bloque en el cuadro, desde 1 */
  bloque: number;
  tipo: TipoBloqueG12;
  pedido: Record<string, string | number | null>;
  /** ok: con fecha o con agenda · sin_fecha: Ripley respondió sin fecha · omitida: por la muestra · error */
  estado: 'ok' | 'sin_fecha' | 'omitida' | 'error';
  mensaje: string | null;
  meta: MetaPeticionG12 | null;
  /** Lo que volvió: la respuesta del simulador o las agendas con sus días */
  datos: RespuestaSimulacionG12 | AgendaLeidaG12[] | null;
}

/** Lo que alimenta una fila, ya leído */
export interface EntradasFilaG12 {
  simulaciones: SimulacionG12[];
  agendas: AgendaG12[];
  /** Cupos por día de la semana, de lunes (0) a domingo (6) */
  fijas: Array<Array<number | null>>;
}

// ───────────────────────── El reporte ─────────────────────────

export type EstadoFilaG12 = 'ok' | 'off' | 'apagado' | 'error' | 'sin_configurar';

export interface DetalleAgendaG12 {
  tipo: string;
  pedido: Record<string, string | number | null>;
  agenda: string | null;
  servicio: string | null;
  zona?: string | null;
  /** El día que se miró */
  dia: string | null;
  asignado: number | null;
  ocupado: number | null;
  activo: boolean | null;
  aviso?: string | null;
}

export interface FilaReporteG12 {
  nombre: string;
  /** Una fila que suma otras (Paquetería Lima Total) */
  esTotal: boolean;
  /** El servicio con el que salió la fecha: RT o RE, ST o SE */
  flujo: string | null;
  fecha: string | null;
  leadTime: { dias: number; etiqueta: string } | null;
  /** null: no hay de dónde sacarlo (las unidades de DD Lima vienen del Oracle) */
  unidades: number | null;
  capacidad: number | null;
  /** Utilizado sobre asignado, en entero; null sin capacidad */
  porcentaje: number | null;
  estado: EstadoFilaG12;
  detalle: {
    simulaciones: SimulacionG12[];
    agendas: DetalleAgendaG12[];
    capacidadFija: number | null;
    avisos: string[];
  };
}

export interface TotalG12 {
  unidades: number | null;
  capacidad: number;
  porcentaje: number | null;
}

export interface ComponenteReporteG12 {
  clave: ClaveComponente;
  titulo: string;
  receta: RecetaG12;
  filas: FilaReporteG12[];
  total: TotalG12;
}

export interface GrupoReporteG12 {
  clave: string;
  titulo: string;
  componentes: ClaveComponente[];
  /** Pickup y Site to Store: Lima + Provincia */
  total: TotalG12 | null;
}

export interface LineaResumenReporteG12 extends TotalG12 {
  nombre: string;
  /** Alguna parte no tiene unidades todavía (el Oracle de DD Lima) */
  incompleta: boolean;
}

/** Un cuadro tal como está guardado para todos: cuándo y quién lo generó, y sus peticiones */
export interface CuadroReporteG12 {
  clave: ClaveComponente;
  /** El día (del país) en que se generó */
  hoy: string;
  generado: string;
  usuarioEmail: string | null;
  actualizacionId: string | null;
  componente: ComponenteReporteG12;
  peticiones: PeticionG12[];
}

export interface ReporteG12 {
  /** `generado`: el más reciente de sus cuadros (null si no hay ninguno) */
  parametros: { pais: string; hoy: string; generado: string | null };
  /** Los cuadros guardados, el mismo para todos; los que faltan no están */
  cuadros: CuadroReporteG12[];
  /** La última carga de unidades del Oracle (DD Lima), o null si nunca se cargó */
  oracle: { cargadoEn: string; filas: number; desde: string | null; hasta: string | null; origen: string; usuarioEmail?: string | null; consultadoEn?: string | null } | null;
  /** Los consumos de esa carga, tal como los devolvió la consulta: los enseña "Datos" en Despacho domicilio */
  consumos: Array<{ fecha: string; zona?: string; subFlujo: string; unidades: number }>;
  /** Las filas de cada cuadro según la configuración: las de los que faltan se pintan en espera */
  filas: Record<string, string[]>;
  /** Cada petición a Ripley de este reporte */
  peticiones: PeticionG12[];
  grupos: GrupoReporteG12[];
  componentes: ComponenteReporteG12[];
  resumen: { fecha: string; lineas: LineaResumenReporteG12[]; total: LineaResumenReporteG12 };
  cobertura: {
    simulaciones: { total: number; conFecha: number; omitidas: number; fallidas: number };
    agendas: { total: number; fallidas: number };
    /** Peticiones que hubo que repetir (429, API caída) */
    reintentadas: number;
  };
  avisos: string[];
}
