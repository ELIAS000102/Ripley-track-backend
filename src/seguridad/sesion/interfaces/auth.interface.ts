/*
 * Lo que devuelven el login y el perfil. El usuario de cada petición
 * (UsuarioAutenticado, RequestConUsuario, PermisoRutina) está en
 * nucleo/contexto/usuario.interface.ts.
 */

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
