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
