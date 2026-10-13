import type { Request } from 'express';

/**
 * El usuario ya validado que el guard adjunta a cada request.
 * Solo lleva lo que viene en el token: el rol y los datos personales viven en
 * la tabla `profiles` y se leen aparte, para no tener dos fuentes de verdad.
 */
export interface UsuarioAutenticado {
  id: string;
  email: string;
}

/**
 * Lo que autoriza un token de rutina: un paso de una ejecución, en nombre de
 * quien creó la rutina. Lo firma el backend; fuera de él nadie puede hacerlo.
 */
export interface PermisoRutina {
  /** El id del token: con él se recogen las llamadas que hizo ese paso */
  id: string;
  ejecucion: string;
  rutina: string;
  /** Quien creó la rutina: la ejecución corre con su cuenta y su token de Ripley */
  usuario: UsuarioAutenticado;
  /** Una prueba no escribe nada: la petición va en simulacro */
  modo: 'prueba' | 'real';
  tarea: number;
  paso: number;
  /** Cuándo caduca, en milisegundos desde 1970 */
  exp: number;
}

/** Request de Express con el usuario que resolvió el guard */
export interface RequestConUsuario extends Request {
  usuario?: UsuarioAutenticado;
  /** Si la hace un paso de una rutina, cuál */
  rutina?: PermisoRutina;
}

/**
 * Datos no sensibles del usuario, pensados para alimentar la pantalla de
 * perfil de cualquier frontend. Nunca incluye contraseñas ni tokens.
 */
export interface Perfil {
  id: string;
  email: string;
  nombre: string | null;
  apellido: string | null;
  rol: string;
  tienda: string | null;
  actualizadoEn: string | null;
}

/** Sesión que se devuelve al cliente tras un login o un refresh */
export interface SesionRespuesta {
  usuario: Perfil;
  accessToken: string;
  refreshToken: string;
  /** Marca de tiempo UNIX en segundos en que expira el accessToken */
  expiraEn: number | null;
  tipoToken: string;
}
