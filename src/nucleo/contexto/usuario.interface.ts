import type { Request } from 'express';

/**
 * Quién hace la petición, tal como lo resuelve el guard de sesión
 * (seguridad/sesion). Vive aquí, en el núcleo, porque lo lee casi todo el
 * backend —la auditoría, el cliente de Ripley, cada service que actúa en
 * nombre de alguien— y nadie de eso debería depender de cómo se inicia sesión.
 */

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
