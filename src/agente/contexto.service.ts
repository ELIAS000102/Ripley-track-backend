import { Injectable, Logger } from '@nestjs/common';
import { PerfilService } from '../auth/perfil.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { hoyEnPais } from '../common/ripley/utils/date.util.js';
import type {
  ContextoAgente,
  ContextoUsuarioAgente,
} from './interfaces/agente.interface.js';

/**
 * La cabecera común de toda respuesta al agente.
 *
 * Llevaba el nombre de quien pregunta, su rol, su tienda y la fecha de hoy. Ya
 * no: **todo eso viaja en el prompt de sistema**, puesto por el flujo desde el
 * cuerpo del webhook, así que repetirlo aquí era mandar el mismo dato dos
 * veces por petición y arrastrarlo doce turnos en la memoria del chat.
 *
 * Quitarlo ahorra además una consulta a Supabase **en cada petición del
 * agente**: leer el perfil para un nombre que el modelo ya tenía delante.
 *
 * Queda el país, que es lo único que el prompt no sabe y que confirma cuál se
 * usó cuando no se indicó ninguno.
 */
@Injectable()
export class ContextoAgenteService {
  private readonly logger = new Logger(ContextoAgenteService.name);

  constructor(private readonly perfiles: PerfilService) {}

  /**
   * La cabecera de una consulta cualquiera. No toca la base de datos.
   *
   * Sigue recibiendo el usuario porque quien llama ya lo tiene y mañana puede
   * volver a hacer falta; hoy no se usa para armar la respuesta.
   */
  armar(_usuario: UsuarioAutenticado, pais?: string): ContextoAgente {
    return { pais: this.normalizar(pais) };
  }

  /**
   * La cabecera completa, solo para la ruta que existe para esto.
   *
   * Es la única que lee el perfil, y por eso es la única que paga esa lectura.
   */
  async armarConUsuario(
    usuario: UsuarioAutenticado,
    pais?: string,
  ): Promise<ContextoUsuarioAgente> {
    const normalizado = this.normalizar(pais);

    return {
      usuario: await this.datosDeUsuario(usuario),
      // La fecha es la del país consultado, no la del servidor
      hoy: hoyEnPais(normalizado),
      pais: normalizado,
    };
  }

  private normalizar(pais?: string): string {
    return (pais ?? 'PE').toUpperCase().trim();
  }

  /**
   * Un fallo leyendo el perfil no puede tumbar la consulta: el nombre es un
   * detalle de cortesía y la capacidad es el dato que se vino a buscar.
   */
  private async datosDeUsuario(
    usuario: UsuarioAutenticado,
  ): Promise<ContextoUsuarioAgente['usuario']> {
    try {
      const perfil = await this.perfiles.obtener(usuario.id, usuario.email);
      const nombre = [perfil.nombre, perfil.apellido]
        .filter(Boolean)
        .join(' ')
        .trim();

      return {
        nombre: nombre || 'usuario',
        rol: perfil.rol ?? 'user',
        tienda: perfil.tienda ?? null,
      };
    } catch (e) {
      this.logger.warn(
        `No se pudo leer el perfil para el contexto del agente: ${(e as Error).message}`,
      );
      return { nombre: 'usuario', rol: 'user', tienda: null };
    }
  }
}
