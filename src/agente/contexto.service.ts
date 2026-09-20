import { Injectable, Logger } from '@nestjs/common';
import { PerfilService } from '../auth/perfil.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { hoyEnPais } from '../common/ripley/utils/date.util.js';
import type { ContextoAgente } from './interfaces/agente.interface.js';

/**
 * Cabecera común de toda respuesta al agente: quién pregunta y qué día es.
 *
 * El nombre viaja para que el agente pueda dirigirse a la persona en vez de
 * hablar al vacío. Va solo lo que no es sensible —nombre, rol y tienda—; ni el
 * correo ni el id salen de aquí, porque acaban en el prompt de un proveedor
 * externo y no hacen falta para responder nada.
 *
 * La fecha se resuelve aquí a propósito: es la del país consultado, no la del
 * servidor, y un modelo que la deduzca solo se equivoca en la zona horaria.
 */
@Injectable()
export class ContextoAgenteService {
  private readonly logger = new Logger(ContextoAgenteService.name);

  constructor(private readonly perfiles: PerfilService) {}

  async armar(
    usuario: UsuarioAutenticado,
    pais?: string,
  ): Promise<ContextoAgente> {
    const normalizado = (pais ?? 'PE').toUpperCase().trim();

    return {
      usuario: await this.datosDeUsuario(usuario),
      hoy: hoyEnPais(normalizado),
      pais: normalizado,
    };
  }

  /**
   * Un fallo leyendo el perfil no puede tumbar la consulta: el nombre es un
   * detalle de cortesía y la capacidad es el dato que se vino a buscar.
   */
  private async datosDeUsuario(
    usuario: UsuarioAutenticado,
  ): Promise<ContextoAgente['usuario']> {
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
