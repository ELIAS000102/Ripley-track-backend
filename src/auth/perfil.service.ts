import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ContextoAuditoria } from '../auditoria/contexto-auditoria.service.js';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { ActualizarPerfilDto } from './dto/perfil.dto.js';
import type { Perfil } from './interfaces/auth.interface.js';

/** Tabla con los datos no sensibles de cada usuario */
const TABLA = 'profiles';

/** Rol que recibe todo usuario recién registrado */
export const ROL_POR_DEFECTO = 'user';

/**
 * Lee y escribe la tabla `profiles`, que complementa a Supabase Auth con los
 * datos que la aplicación necesita mostrar: nombre, apellido, rol y tienda.
 *
 * Trabaja con el cliente admin y filtra siempre por el id que resolvió el guard
 * a partir del token, nunca por un id que venga del cliente. Así un usuario no
 * puede leer ni tocar el perfil de otro aunque lo intente.
 */
@Injectable()
export class PerfilService {
  private readonly logger = new Logger(PerfilService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly contexto: ContextoAuditoria,
  ) {}

  /** Perfil completo de un usuario, listo para enviar al frontend */
  async obtener(id: string, email: string): Promise<Perfil> {
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .select('nombre, apellido, rol, tienda, actualizado_en')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `No se pudo leer el perfil de ${email}: ${error.message}`,
      );
      throw new BadGatewayException('No se pudo obtener el perfil');
    }

    return this.armar(id, email, data);
  }

  /**
   * Actualiza solo los campos que el usuario puede cambiar de sí mismo.
   * El rol queda deliberadamente fuera: si se pudiera editar desde aquí,
   * cualquiera se ascendería a sí mismo.
   */
  async actualizar(
    id: string,
    email: string,
    dto: ActualizarPerfilDto,
  ): Promise<Perfil> {
    // Se relee antes de escribir para poder registrar qué cambió exactamente
    const anterior = await this.obtener(id, email);

    const cambios = {
      ...(dto.nombre !== undefined && { nombre: dto.nombre }),
      ...(dto.apellido !== undefined && { apellido: dto.apellido }),
      ...(dto.tienda !== undefined && { tienda: dto.tienda }),
      actualizado_en: new Date().toISOString(),
    };

    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .update(cambios)
      .eq('id', id)
      .select('nombre, apellido, rol, tienda, actualizado_en')
      .maybeSingle();

    if (error) {
      this.logger.error(
        `No se pudo guardar el perfil de ${email}: ${error.message}`,
      );
      throw new BadGatewayException('No se pudo guardar el perfil');
    }

    const actualizado = this.armar(id, email, data);

    this.contexto.registrarCambio(
      {
        nombre: anterior.nombre,
        apellido: anterior.apellido,
        tienda: anterior.tienda,
      },
      {
        nombre: actualizado.nombre,
        apellido: actualizado.apellido,
        tienda: actualizado.tienda,
      },
    );

    this.logger.log(`Perfil actualizado: ${email}`);

    return actualizado;
  }

  /**
   * Completa el perfil de un usuario recién registrado.
   *
   * El trigger de la base de datos ya crea la fila con nombre y apellido, pero
   * no fija el rol ni la tienda. Se usa upsert para que el registro funcione
   * igual aunque el trigger no esté instalado.
   */
  async inicializar(
    id: string,
    datos: { nombre: string; apellido: string; tienda?: string },
  ): Promise<void> {
    const { error } = await this.supabase.admin.from(TABLA).upsert(
      {
        id,
        nombre: datos.nombre,
        apellido: datos.apellido,
        tienda: datos.tienda ?? null,
        rol: ROL_POR_DEFECTO,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );

    if (error) {
      this.logger.error(
        `No se pudo crear el perfil de ${id}: ${error.message}`,
      );
      throw new BadGatewayException(
        'La cuenta se creó pero no se pudo guardar el perfil',
      );
    }
  }

  private armar(
    id: string,
    email: string,
    fila: {
      nombre?: string | null;
      apellido?: string | null;
      rol?: string | null;
      tienda?: string | null;
      actualizado_en?: string | null;
    } | null,
  ): Perfil {
    return {
      id,
      email,
      nombre: fila?.nombre ?? null,
      apellido: fila?.apellido ?? null,
      // Si la fila aún no existe, se informa el rol mínimo en vez de fallar
      rol: fila?.rol ?? ROL_POR_DEFECTO,
      tienda: fila?.tienda ?? null,
      actualizadoEn: fila?.actualizado_en ?? null,
    };
  }
}
