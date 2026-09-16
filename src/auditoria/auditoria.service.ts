import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import type { RegistroSinRol } from './interfaces/auditoria.interface.js';

/** Campos que nunca deben quedar guardados en claro */
const CAMPOS_SENSIBLES =
  /password|contrasena|contraseña|token|secret|authorization|apikey/i;

/** Tope de tamaño de los datos guardados por petición */
const MAX_CARACTERES_DATOS = 10_000;

/**
 * Escribe el registro de uso en Supabase.
 *
 * Es deliberadamente "a prueba de fallos": si la escritura falla, se anota en el
 * log del servidor y nada más. Auditar no puede llegar a romper una petición que
 * el usuario ya dio por buena.
 */
@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Inserta la fila sin bloquear la respuesta */
  registrar(registro: RegistroSinRol): void {
    void this.insertar(registro);
  }

  private async insertar(registro: RegistroSinRol): Promise<void> {
    const { error } = await this.supabase.admin
      .from(this.supabase.tablaAuditoria)
      .insert({
        ...registro,
        usuario_rol: await this.rolDe(registro.usuario_id),
      });

    if (error) {
      this.logger.error(
        `No se pudo guardar el registro de uso (${registro.metodo} ${registro.endpoint}): ${error.message}`,
      );
    }
  }

  /**
   * Rol del usuario en el momento de la operación.
   *
   * Consulta `profiles` por su cuenta en vez de reutilizar PerfilService para no
   * acoplar el módulo de auditoría al de sesión. Solo cuesta una consulta extra
   * en las operaciones que se registran, que son pocas.
   */
  private async rolDe(usuarioId: string | null): Promise<string | null> {
    if (!usuarioId) return null;

    const { data, error } = await this.supabase.admin
      .from('profiles')
      .select('rol')
      .eq('id', usuarioId)
      .maybeSingle();

    if (error) {
      this.logger.warn(
        `No se pudo leer el rol de ${usuarioId}: ${error.message}`,
      );
      return null;
    }

    return (data?.rol as string) ?? null;
  }

  /**
   * Censura recursivamente las claves sensibles y recorta lo que sea
   * demasiado grande para guardarlo entero.
   */
  censurar(datos: unknown): unknown {
    if (Array.isArray(datos)) {
      return datos.map((item) => this.censurar(item));
    }

    if (datos && typeof datos === 'object') {
      return Object.fromEntries(
        Object.entries(datos as Record<string, unknown>).map(
          ([clave, valor]) => [
            clave,
            CAMPOS_SENSIBLES.test(clave) ? '[CENSURADO]' : this.censurar(valor),
          ],
        ),
      );
    }

    if (typeof datos === 'string' && datos.length > MAX_CARACTERES_DATOS) {
      return `${datos.slice(0, MAX_CARACTERES_DATOS)}… [recortado]`;
    }

    return datos;
  }
}
