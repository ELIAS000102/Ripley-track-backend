/**
 * Los tipos de la v3 del agente.
 *
 * Un mensaje del chat es un **turno**: una fila de `agente_turnos` que crean y
 * van llenando las rutas de `/agente/v3/turnos`. n8n une las etapas y llama a
 * los modelos; todo lo que decide el código vive aquí.
 */

import type { EntidadMencion } from '../entidades.js';
import type { Comprobacion, Condicion } from '../filas.js';

export type Pais = 'PE' | 'CL';

/** El tipo de petición que dice el clasificador */
export type TipoPeticion = 'atajo' | 'consulta' | 'calculo' | 'saber' | 'repetir' | 'charla' | 'cambio' | 'enseñar';
export const TIPOS_PETICION: TipoPeticion[] = ['atajo', 'consulta', 'calculo', 'saber', 'repetir', 'charla', 'cambio', 'enseñar'];

/** Lo que le dice cada ruta a n8n que haga después ("fin": nada, nadie espera respuesta) */
export type Camino =
  | 'clasificar'
  | 'armar'
  | 'calcular'
  | 'aprender'
  | 'presentar'
  | 'ejecutar'
  | 'avisar'
  | 'redactar'
  | 'preguntar'
  | 'responder'
  | 'fin';

/** Para qué se llama a un modelo */
export type RolModelo = 'clasificar' | 'armar' | 'calcular' | 'aprender' | 'presentar' | 'redactar';

/** Cómo se enseña un resultado (lo elige Presentar; si no, el código) */
export type Vista = 'totales' | 'detalle' | 'uso' | 'frase' | 'plegado';

/** Lo que decidió Presentar, ya validado */
export interface Presentacion {
  /** La vista de cada paso, por su número */
  vistas: Record<string, Vista>;
  /** El orden en que se enseñan los pasos */
  orden: number[];
  /** La frase en lenguaje natural (con cada cifra comprobada en los datos); null: la del código */
  frase: string | null;
}

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
  /** saturado (503) · cuota (429) · respuesta (contestó algo que no vale) · otro */
  clase?: 'saturado' | 'cuota' | 'respuesta' | 'otro';
  /** La ronda de preguntas en que se hizo: tras una respuesta, cada rol vuelve a tener sus intentos */
  ronda?: number;
}

/** Un atajo, como lo ve el clasificador */
export interface AtajoDelContexto {
  nombre: string;
  descripcion: string | null;
  tipos: string[];
  pais: Pais;
}

/** Un resultado de un mensaje guardado: con sus datos solo en los 5 más recientes del chat */
export interface ResultadoAnterior {
  herramienta: string;
  titulo: string;
  datos: unknown;
  /** Los códigos que cumplieron su condición (o todos) */
  cumplen?: string[];
}

/** El mensaje anterior: el elegido con "Responder" o el último del chat */
export interface MensajeAnterior {
  id: string;
  persona: string | null;
  frase: string | null;
  herramientas: string[];
  plan: PlanV3 | null;
  resultados: ResultadoAnterior[];
  /** Lo guardó la v3 (con su plan) o la v2 */
  version: 2 | 3;
  elegido: boolean;
  /** Falló o quedó en una pregunta: este mensaje puede retomarlo ("es de Perú") */
  fallido?: boolean;
}

/** Una agenda que se conoce en el turno (del mensaje anterior o buscada): el modelo elige entre ellas */
export interface AgendaConocida {
  codigo: string;
  /** picking · despacho · recepcion · opl */
  tipo: string | null;
  zona: string | null;
  agenda: string;
  servicio: string | null;
}

/** Algo que se aprende (lo deja limpio el rol «aprender» y se guarda con un "sí") */
export interface Hecho {
  tipo: 'servicio' | 'entidad' | 'termino';
  pais: Pais;
  /** El código; en un término, la palabra ("flujo de picking") */
  codigo: string;
  /** término: lo que quiere decir en la operación */
  significa?: string | null;
  nombre?: string | null;
  /** servicio */
  metodo_entrega?: 'RT' | 'DP' | null;
  fase?: string | null;
  origen?: string | null;
  descripcion?: string | null;
  /** entidad */
  clase?: 'tienda' | 'almacen' | 'opl' | null;
  es_cd?: boolean | null;
  alias?: string[] | null;
}

/** Lo que se está aprendiendo en este turno: se pregunta y se guarda al final */
export interface Ensenanza {
  /** Lo que dijo la persona que enseña algo */
  texto: string;
  hechos: Hecho[];
  /** Lo que el modelo no tuvo claro */
  dudas: string[];
  /** Lo que ya había y cambiaría ("Tenía la SG como F2") */
  choques: string[];
  /** Lo que no se puede tocar desde el chat (puesto a mano por el administrador) */
  intocables: string[];
  /** Cómo terminó: guardado, rechazado («No ahora») o sin entender */
  final?: 'guardado' | 'rechazado' | 'sin_entender';
}

/** Una pregunta a la persona (1d): con opciones, con texto libre, o con las dos */
export interface Pregunta {
  id: string;
  /** La etapa que preguntó: ahí sigue el turno con la respuesta */
  etapa: 'entidades' | 'armar' | 'calcular' | 'aprender' | 'zona';
  texto: string;
  opciones: Array<{ id: string; texto: string }>;
  libre: string | null;
  /** Para "entidades": el nombre que se aclara */
  nombre?: string;
  /** Para "zona": el paso que espera la elección */
  paso?: number;
  /** Varias dudas a la vez (una por oficina): el panel manda la respuesta cuando están todas */
  dudas?: Array<{ id: string; texto: string; opciones: Array<{ id: string; texto: string }> }>;
}

export interface ContextoTurno {
  hoy: string;
  pais: Pais;
  motivo_pais: string;
  atajos: AtajoDelContexto[];
  anterior: MensajeAnterior | null;
  /** Los códigos y nombres del mensaje, buscados en el directorio */
  entidades: EntidadMencion[];
  /** Los servicios del país, con su método, su fase y lo aprendido (agente_servicios) */
  servicios: Array<{ codigo: string; nombre: string | null; metodo_entrega: string | null; fase: string | null; fuente?: string | null; origen?: string | null; descripcion?: string | null }>;
  /** Lo que la persona contestó a las preguntas de este turno */
  aclaraciones: string[];
  /** La pregunta que espera respuesta */
  pregunta: Pregunta | null;
  rondas: number;
  /** Lo que se le dice además de la respuesta (un cambio de país…) */
  avisos?: string[];
  /** Al retomar un mensaje que falló: aquella petición con lo que se aclara ahora */
  mensaje_efectivo?: string | null;
  /** Lo que se está aprendiendo: se pregunta al final */
  ensenanza?: Ensenanza | null;
  /** Las palabras de la operación que enseñó el equipo (agente_vocabulario): van en los prompts */
  vocabulario?: Array<{ termino: string; significa: string }>;
  /** Se preguntó qué quería decir una palabra y la persona lo explicó: al final se ofrece aprenderlo */
  aprender_aclaracion?: boolean;
  /** Los CDs y almacenes del país, con sus alias: el modelo elige cuál nombra la persona ("el cd villa" → 20026) */
  almacenes?: Array<{ codigo: string; nombre: string | null; es_cd: boolean; alias: string[] }>;
  /** Los códigos cuyo nombre o apodo se parece al mensaje ("90 min+" → 1130 «90 minutos»): el modelo elige */
  parecidos?: Array<{ codigo: string; nombre: string | null; tipo: string; es_cd: boolean; alias: string[] }>;
  /** Las agendas que buscó el backend porque el plan nombraba una que no conocía (las del anterior se leen de él) */
  agendas?: AgendaConocida[];
  /** Las oficinas cuyas agendas ya se buscaron ("tipo:código"): no se vuelven a buscar */
  buscadas?: string[];
  /** Las zonas que eligió la persona, por paso: { "2": { "1401": "Zona 1401 - …", "*": "todas" } } */
  zonas_elegidas?: Record<string, Record<string, string>>;
  /** Lo que decidió Presentar (o null si no hizo falta o no se pudo); `presentado`: ya se pasó por ahí */
  presentacion?: Presentacion | null;
  presentado?: boolean;
  /** Ya se avisó a la persona del plan antes de su primer paso */
  anunciado?: boolean;
}

export interface Clasificacion {
  tipo: TipoPeticion;
  dep: boolean;
  atajo: string | null;
  motivo: string;
  /** En "charla": lo que contesta el modelo (revisado por el código) */
  respuesta?: string | null;
  /** Completa o corrige el mensaje anterior, que falló ("es de Perú") */
  retoma?: boolean;
  /** Además de lo que pide, enseña algo (se aprende al final) */
  ensena?: boolean;
}

/** Un paso del plan, con el formato que se mide en la fase 0 (`fase0/detalle.mjs`) */
export interface PasoPlan {
  herramienta: string;
  param: Record<string, unknown>;
  condicion?: Condicion;
  comprobar?: Comprobacion;
}

/** Lo que devuelve «Qué calcular» (1c): la operación; el número lo saca el código */
export interface Calculo {
  operacion: 'suma' | 'maximo' | 'minimo' | 'contar' | 'porcentaje' | 'filtrar' | 'ordenar' | 'explicar';
  campo: string | null;
  filtro: { agenda?: string; codigo?: string[]; fecha?: string; servicio?: string[]; activa?: boolean; nombre?: string; fase?: string; tipo?: string };
  agrupar: string[];
  orden?: 'asc' | 'desc';
  distintos?: boolean;
  /** Agrupado por servicio porque los datos traían varios: con una fila más del total */
  conTotal?: boolean;
}

export interface PlanV3 {
  pasos: PasoPlan[];
  /** De dónde salió */
  origen: 'atajo' | 'repetir' | 'saber' | 'armar' | 'calcular' | 'charla' | 'cambio' | 'aprender';
  calculo?: Calculo;
  /** Cómo se pidió enseñarlo: "totales", "cuadro", "uso" */
  ver?: string | null;
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
  /** Con condición: los códigos que la cumplen, y de cuántos */
  cumplen?: string[];
  total?: number;
  condicion?: Condicion;
  /** Lo que se comprobó, con su respuesta */
  comprobacion?: { pregunta: Comprobacion; si: boolean; total: number; cumplen: string[]; noCumplen: string[] };
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
  /** Con condición: cuántos había antes de quedarse con los que la cumplen */
  total?: number;
  /** Cómo se enseña: totales, detalle, uso, solo la frase o plegado */
  vista?: Vista;
}

/** Una duda, como la entiende el panel (el mismo formato que la v2) */
export interface DudaPanel {
  id: string;
  pregunta: string;
  opciones: Array<{ id: string; texto: string }>;
  libre: string | null;
}

/** La respuesta al panel (la forma nueva de la v3) */
export interface RespuestaPanel {
  v: 3;
  tipo: 'resultado' | 'progreso' | 'pregunta' | 'error' | 'cancelada';
  turno_id: string;
  mensaje_id: string | null;
  pais: Pais;
  hora: string;
  frase: string;
  resultados: ResultadoPanel[];
  markdown: string;
  notas: string[];
  avisos: string[];
  /** En el progreso también los que van (`en_curso`) y los que faltan (`pendiente`), con `descripcion` para el panel */
  pasos: Array<Pick<PasoEjecutado, 'n' | 'que' | 'resumen' | 'ms'> & { estado: PasoEjecutado['estado'] | 'en_curso' | 'pendiente'; descripcion?: string }>;
  /** En el progreso: el país, para el chip del "Pensando…" */
  contexto?: { pais: Pais; motivo_pais: string | null };
  detalles: {
    clasificacion: Clasificacion | null;
    modelos: IntentoModelo[];
    ms: number;
  };
  /** En una pregunta: lo que hay que contestar (como la v2) */
  dudas?: DudaPanel[];
  /** Cómo pidió verlo la persona: "totales" (un cuadro de totales), "cuadro" o "uso" */
  ver?: string | null;
}

/** Lo que contestan todas las rutas: n8n solo mira `camino` */
export interface SalidaRuta {
  turno_id: string;
  camino: Camino;
  modelo: ModeloElegido | null;
  prompt: { sistema: string; mensaje: string } | null;
  progreso: RespuestaPanel | null;
  pregunta: RespuestaPanel | null;
  respuesta: RespuestaPanel | null;
}
