import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Crea y expone los dos clientes de Supabase que necesita el backend.
 *
 * Se separan a propósito por permisos: el cliente `anon` usa la anon key y solo
 * sirve para iniciar sesión y validar tokens; el cliente `admin` usa la service
 * role key, se salta las políticas RLS y es el único que escribe el registro de
 * uso. La service role key nunca sale del backend.
 *
 * Ambos van con la sesión desactivada: el servidor es stateless y cada request
 * trae su propio token, así que no debe existir una "sesión actual" compartida.
 */
@Injectable()
export class SupabaseService {
  /** Anon key: login y validación de tokens */
  readonly anon: SupabaseClient;
  /** Service role key: escritura del registro de uso */
  readonly admin: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const anonKey = this.config.get<string>('supabase.anonKey');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');

    // Se falla al arrancar, no en la primera petición: sin estas claves no hay
    // forma de autenticar a nadie, así que levantar el servidor sería engañoso.
    const faltantes = [
      ['SUPABASE_URL', url],
      ['SUPABASE_ANON_KEY', anonKey],
      ['SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey],
    ]
      .filter(([, valor]) => !valor)
      .map(([nombre]) => nombre);

    if (faltantes.length) {
      throw new Error(
        `Faltan variables de Supabase en el .env: ${faltantes.join(', ')}. ` +
          'Ver .env.example y docs/auth-supabase.md',
      );
    }

    this.validarUrl(url!);

    const sinSesion = {
      auth: { persistSession: false, autoRefreshToken: false },
    };

    this.anon = createClient(url!, anonKey!, sinSesion);
    this.admin = createClient(url!, serviceRoleKey!, sinSesion);
  }

  /**
   * SUPABASE_URL debe ser solo el origen del proyecto.
   * Pegar la URL de PostgREST (…/rest/v1) es un error fácil de cometer y el SDK
   * le añade su propia ruta encima, así que falla con un "Invalid path specified
   * in request URL" que no dice nada. Mejor avisar aquí, al arrancar.
   */
  private validarUrl(url: string): void {
    let ruta: string;

    try {
      ruta = new URL(url).pathname;
    } catch {
      throw new Error(`SUPABASE_URL no es una URL válida: "${url}"`);
    }

    if (ruta !== '/' && ruta !== '') {
      const origen = new URL(url).origin;
      throw new Error(
        `SUPABASE_URL debe ser solo el origen del proyecto, sin ninguna ruta. ` +
          `Recibido "${url}"; debería ser "${origen}".`,
      );
    }
  }

  /** Nombre de la tabla donde se guarda el registro de peticiones */
  get tablaAuditoria(): string {
    return this.config.get<string>('supabase.tablaAuditoria') ?? 'registro_uso';
  }
}
