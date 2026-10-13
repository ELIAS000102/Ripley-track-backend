/** Un paso: una instrucción que Silvana cumple al pie de la letra */
export interface Paso {
  orden: number;
  instruccion: string;
  /** Los atajos que tiene que usar. Vacío: los deduce ella */
  atajos: { id: string; nombre: string; activa: boolean }[];
  /** Las mallas o matrices con las que se guía */
  guias: { id: string; nombre: string; tipo: 'matriz' | 'malla' }[];
}

/** Una tarea: sus pasos, en orden */
export interface Tarea {
  id: string;
  orden: number;
  nombre: string;
  pasos: Paso[];
}

/** Cuándo corre: unos días, a una hora, con unas tareas */
export interface Horario {
  id: string;
  orden: number;
  /** 1 = lunes … 7 = domingo */
  dias: number[];
  /** "HH:MM", en la hora del país de la rutina */
  hora: string;
  /** Las tareas que hace este horario, por su orden. Vacío = todas */
  tareas: number[];
}

export type EstadoEjecucion = 'en_curso' | 'completada' | 'detenida' | 'omitida' | 'cancelada';

export interface ResumenEjecucion {
  id: string;
  modo: 'prueba' | 'real';
  origen: 'programada' | 'manual';
  estado: EstadoEjecucion;
  version: number;
  programada_para: string | null;
  tarea_detenida: number | null;
  motivo: string | null;
  inicio: string | null;
  fin: string | null;
  creado_en: string;
}

/** El siguiente turno, en la hora del país */
export interface Turno {
  /** YYYY-MM-DD */
  fecha: string;
  hora: string;
  /** 1 = lunes … 7 = domingo */
  dia: number;
  /** El orden del horario al que pertenece */
  horario: number;
}

export interface Rutina {
  id: string;
  nombre: string;
  descripcion: string | null;
  pais: 'PE' | 'CL';
  activa: boolean;
  version: number;
  probada_version: number | null;
  probada_en: string | null;
  creado_por: string | null;
  creado_por_id?: string | null;
  creado_en: string;
  actualizado_en: string;
  tareas?: Tarea[];
  horarios?: Horario[];
}

/** Cómo se enseña una rutina: lo guardado y lo que se deduce de ello */
export interface RutinaVista extends Rutina {
  /** Es de quien pregunta: solo su creador la cambia, la prueba y la activa */
  propia: boolean;
  /** La versión actual tiene una prueba correcta: se puede activar */
  probada: boolean;
  /** Si no se puede activar, por qué */
  noActivable: string | null;
  proxima: Turno | null;
  ultima: ResumenEjecucion | null;
  /** Una ejecución detenida esperando que alguien confirme que puede seguir */
  detenida: ResumenEjecucion | null;
}

// ---------- Lo que hace una ejecución ----------

/** Una herramienta que llamó un paso, tal como la vio el backend */
export interface LlamadaHerramienta {
  herramienta: string;
  /** El código HTTP con que respondió */
  estado: number;
  /** Lo que salió mal: el error de la llamada, o el de las filas que fallaron */
  problemas: string[];
  /** El atajo que ejecutó, si fue un atajo */
  atajo?: string;
  /** Las escrituras que no salieron hacia Ripley porque era una prueba */
  escriturasEvitadas: number;
}

export interface PasoEjecutado {
  orden: number;
  instruccion: string;
  estado: 'completado' | 'fallido';
  /** Por qué falló, en una frase */
  motivo?: string;
  /** Lo que contestó Silvana */
  respuesta: string;
  llamadas: LlamadaHerramienta[];
  inicio: string;
  fin: string;
}

export interface TareaEjecutada {
  orden: number;
  nombre: string;
  /** 1 la primera vez; al reanudar, la tarea que falló se reintenta con el siguiente */
  intento: number;
  estado: 'en_curso' | 'completada' | 'fallida' | 'cancelada';
  pasos: PasoEjecutado[];
}

/** Una ejecución entera, con lo que hizo cada tarea y cada paso */
export interface EjecucionDetalle extends ResumenEjecucion {
  rutina_id: string;
  tareas: number[];
  resultado: TareaEjecutada[];
  disparada_por: string | null;
}

/** Lo que devuelve el flujo de n8n en un paso de una rutina */
export interface RespuestaAgente {
  respuesta?: string;
  motivo?: string | null;
  seguro?: boolean;
  /** Solo lo trae el flujo que entiende las rutinas */
  rutina?: {
    /** El tipo del plan: "pasos", "libre", "faltan", "aclarar"… */
    tipo?: string;
    faltan?: string[];
    descartados?: string[];
    /** Las herramientas que llamó, según el flujo */
    herramientas?: string[];
    /** Un agente contestó sin hacer sus llamadas, o le faltaron después del reintento */
    sinTerminar?: boolean;
    /** Lo que quedó sin llamar: los códigos, o el nombre de la herramienta */
    faltaron?: string[];
    error?: boolean;
  } | null;
}
