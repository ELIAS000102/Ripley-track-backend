/**
 * Una fila del registro de uso.
 * Los nombres van en snake_case porque se insertan tal cual como columnas
 * en la tabla de Supabase (ver docs/supabase-setup.sql).
 */
export interface RegistroUso {
  usuario_id: string | null;
  usuario_email: string | null;
  /**
   * Rol que tenía el usuario al hacer la operación.
   * Se guarda como copia y no se consulta después a propósito: si alguien
   * cambia de rol, el historial debe seguir diciendo con qué permisos actuó.
   */
  usuario_rol: string | null;
  /** Nombre corto de la operación: "picking.actualizar", "auth.login"… */
  accion: string;
  /**
   * Por dónde entró la petición: "agente" si vino del agente de IA, "directo"
   * si vino del panel o de una llamada normal. Lo declara el cliente con la
   * cabecera X-Origen, así que sirve para trazar, no para autorizar.
   */
  origen: string;
  metodo: string;
  endpoint: string;
  /** Lo que envió el cliente: query, params de ruta y body, ya censurado */
  datos: Record<string, unknown>;
  /** Estado que tenían los campos editables antes del cambio */
  datos_antes: unknown;
  /** Valores que quedaron después del cambio */
  datos_despues: unknown;
  estado: number;
  exitoso: boolean;
  error: string | null;
  duracion_ms: number;
  ip: string | null;
  user_agent: string | null;
}

/** Lo que arma el interceptor: el rol lo resuelve después AuditoriaService */
export type RegistroSinRol = Omit<RegistroUso, 'usuario_rol'>;
