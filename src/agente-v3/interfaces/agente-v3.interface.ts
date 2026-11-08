/**
 * Los tipos de la v3 del agente.
 *
 * Un mensaje del chat es un **turno**: una fila de `agente_turnos` que crean y
 * van llenando las rutas de `/agente/v3/turnos`. n8n une las etapas y llama a
 * los modelos; todo lo que decide el código vive aquí.
 */

export type Pais = 'PE' | 'CL';

/** El tipo de petición que dice el clasificador */
export type TipoPeticion = 'atajo' | 'consulta' | 'calculo' | 'saber' | 'repetir';
export const TIPOS_PETICION: TipoPeticion[] = ['atajo', 'consulta', 'calculo', 'saber', 'repetir'];

/** Lo que le dice cada ruta a n8n que haga después */
export type Camino =
  | 'clasificar'
  | 'armar'
  | 'calcular'
  | 'ejecutar'
  | 'avisar'
  | 'redactar'
  | 'preguntar'
  | 'responder';

/** Para qué se llama a un modelo */
export type RolModelo = 'clasificar' | 'armar' | 'calcular' | 'redactar';

/** Uno de los nodos Gemini del flujo: un modelo de una cuenta */
export interface ModeloElegido {
  rol: RolModelo;
  cuenta: number;
  nombre: string;
  /** El nombre del nodo en n8n, para que el Switch sepa a cuál ir */
  nodo: string;
}

/** Una llamada a un modelo, tal como quedó anotada en el turno */
export interface IntentoModelo {
  rol: RolModelo;
  cuenta: number;
  nombre: string;
  ok: boolean;
  /** Por qué no sirvió: el error del nodo o lo que no valía de su respuesta */
  motivo?: string;
  /** saturado (503) · cuota (429) · otro */
  clase?: 'saturado' | 'cuota' | 'otro';
}

/** Un atajo, como lo ve el clasificador */
export interface AtajoDelContexto {
  nombre: string;
  descripcion: string | null;
  tipos: string[];
  pais: Pais;
}

/** El mensaje anterior: el elegido con "Responder" o el último del chat */
export interface MensajeAnterior {
  id: string;
  persona: string | null;
  frase: string | null;
  herramientas: string[];
  plan: PlanV3 | null;
  /** Lo guardó la v3 (con su plan) o la v2 */
  version: 2 | 3;
  elegido: boolean;
}

export interface ContextoTurno {
  hoy: string;
  pais: Pais;
  motivo_pais: string;
  atajos: AtajoDelContexto[];
  anterior: MensajeAnterior | null;
}

export interface Clasificacion {
  tipo: TipoPeticion;
  dep: boolean;
  atajo: string | null;
  motivo: string;
}

/** Un paso del plan, con el formato que se mide en la fase 0 (`fase0/detalle.mjs`) */
export interface PasoPlan {
  herramienta: string;
  param: Record<string, unknown>;
  condicion?: { campo: string; op: string; valor: unknown };
}

export interface PlanV3 {
  pasos: PasoPlan[];
  /** De dónde salió: el clasificador (un atajo), repetir el anterior, o una pregunta a lo guardado */
  origen: 'atajo' | 'repetir' | 'saber';
}

/** Un paso ya ejecutado */
export interface PasoEjecutado {
  n: number;
  que: string;
  herramienta: string;
  estado: 'ok' | 'vacio' | 'error';
  resumen: string;
  ms: number;
  datos?: unknown;
  error?: string;
}

export interface Turno {
  id: string;
  chat_id: string;
  usuario_id: string;
  peticion_id: string | null;
  mensaje: string;
  responde_a: string | null;
  etapa: string;
  estado: 'en_curso' | 'pregunta' | 'terminado' | 'error' | 'cancelado';
  contexto: ContextoTurno | null;
  clasificacion: Clasificacion | null;
  plan: PlanV3 | null;
  pasos: PasoEjecutado[];
  modelos: IntentoModelo[];
  respuesta: RespuestaPanel | null;
  mensaje_id: string | null;
  creado_en: string;
}

/** Un resultado, como lo recibe el panel: los datos tal cual, y él decide cómo se dibujan */
export interface ResultadoPanel {
  n: number;
  herramienta: string;
  atajo?: string;
  titulo: string;
  principal: boolean;
  datos: unknown;
}

/** La respuesta al panel (la forma nueva de la v3) */
export interface RespuestaPanel {
  v: 3;
  tipo: 'resultado' | 'progreso' | 'error' | 'cancelada';
  turno_id: string;
  mensaje_id: string | null;
  pais: Pais;
  hora: string;
  frase: string;
  resultados: ResultadoPanel[];
  markdown: string;
  notas: string[];
  avisos: string[];
  pasos: Array<Pick<PasoEjecutado, 'n' | 'que' | 'estado' | 'resumen' | 'ms'>>;
  detalles: {
    clasificacion: Clasificacion | null;
    modelos: IntentoModelo[];
    ms: number;
  };
}

/** Lo que contestan todas las rutas: n8n solo mira `camino` */
export interface SalidaRuta {
  turno_id: string;
  camino: Camino;
  modelo: ModeloElegido | null;
  prompt: { sistema: string; mensaje: string } | null;
  progreso: RespuestaPanel | null;
  pregunta: null;
  respuesta: RespuestaPanel | null;
}
