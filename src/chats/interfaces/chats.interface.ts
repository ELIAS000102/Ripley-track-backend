/**
 * De qué es un chat: una conversación con Silvana, o el chat «Notificaciones»,
 * donde ella cuenta lo que hicieron las rutinas y nadie escribe.
 */
export type TipoChat = 'conversacion' | 'notificaciones';

/** Una conversación con el agente */
export interface Chat {
  id: string;
  titulo: string;
  /** Sin decirlo, es una conversación */
  tipo?: TipoChat;
  creado_en: string;
  actualizado_en: string;
  /** Solo se lee internamente, para comprobar la pertenencia */
  usuario_id?: string;
}

/** Un turno de la conversación */
export interface Mensaje {
  id: number;
  rol: 'usuario' | 'agente';
  texto: string;
  creado_en: string;
  /** En «Notificaciones»: la ejecución de la rutina que cuenta el mensaje */
  ejecucion_id?: string | null;
}
