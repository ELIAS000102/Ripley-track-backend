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

/** Request de Express con el usuario que resolvió el guard */
export interface RequestConUsuario extends Request {
  usuario?: UsuarioAutenticado;
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
