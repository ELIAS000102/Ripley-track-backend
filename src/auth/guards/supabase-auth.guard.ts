import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import { CacheSesiones } from '../cache-sesiones.service.js';
import { ES_PUBLICO } from '../decorators/publico.decorator.js';
import type {
  RequestConUsuario,
  UsuarioAutenticado,
} from '../interfaces/auth.interface.js';

/**
 * Guard global: exige un "Authorization: Bearer <accessToken>" válido en todas
 * las rutas, salvo las marcadas con @Publico().
 *
 * El token se valida contra Supabase y el resultado se recuerda unos segundos
 * en CacheSesiones, porque esa validación cuesta una llamada de red y el agente
 * de IA encadena varias peticiones seguidas con el mismo token.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
    private readonly cache: CacheSesiones,
    private readonly contexto: ContextoAuditoria,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (esPublico) return true;

    const request = context.switchToHttp().getRequest<RequestConUsuario>();
    const token = this.extraerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException(
        'Falta el token de sesión: envía el header "Authorization: Bearer <token>"',
      );
    }

    // El interceptor de auditoría lee de aquí para saber quién hizo la petición.
    // El rol no se resuelve aquí: vive en la tabla profiles, y duplicarlo en el
    // token acabaría en dos fuentes de verdad que se desincronizan.
    const usuario = this.cache.obtener(token) ?? (await this.validar(token));

    request.usuario = usuario;

    // También al contexto de la petición: de ahí lo lee el cliente de Ripley
    // para saber de quién es el token corporativo que debe usar.
    this.contexto.identificarUsuario(usuario.id, usuario.email);

    return true;
  }

  private async validar(token: string): Promise<UsuarioAutenticado> {
    const { data, error } = await this.supabase.anon.auth.getUser(token);

    if (error || !data?.user) {
      throw new UnauthorizedException('Sesión inválida o expirada');
    }

    const usuario: UsuarioAutenticado = {
      id: data.user.id,
      email: data.user.email ?? '',
    };

    this.cache.guardar(token, usuario);

    return usuario;
  }

  private extraerToken(authorization?: string): string | null {
    const [esquema, token] = authorization?.split(' ') ?? [];
    return esquema?.toLowerCase() === 'bearer' && token ? token : null;
  }
}
