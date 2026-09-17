/** Una conversación con el agente */
export interface Chat {
  id: string;
  titulo: string;
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
}
