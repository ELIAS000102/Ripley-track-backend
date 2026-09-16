import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Session, User } from '@supabase/supabase-js';
import { ContextoAuditoria } from '../auditoria/contexto-auditoria.service.js';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { CacheSesiones } from './cache-sesiones.service.js';
import { LoginDto, RefrescarSesionDto } from './dto/login.dto.js';
import { RegistroDto } from './dto/registro.dto.js';
import { PerfilService } from './perfil.service.js';
import type { Perfil, SesionRespuesta } from './interfaces/auth.interface.js';

/**
 * Autenticación contra Supabase Auth. El backend no guarda sesiones ni
 * contraseñas: delega en Supabase y se limita a devolver los tokens al cliente,
 * que los reenvía en el header Authorization de cada petición.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly contexto: ContextoAuditoria,
    private readonly perfiles: PerfilService,
    private readonly cache: CacheSesiones,
  ) {}

  /**
   * Da de alta un usuario nuevo con el rol mínimo.
   *
   * El rol nunca sale de lo que envíe el cliente: lo fija el backend. Si se
   * aceptara del body, cualquiera se registraría como administrador.
   */
  async registrar(
    dto: RegistroDto,
  ): Promise<SesionRespuesta | { mensaje: string }> {
    const { data, error } = await this.supabase.anon.auth.signUp({
      email: dto.email,
      password: dto.password,
      // El trigger de la base de datos los copia a la tabla profiles
      options: { data: { nombre: dto.nombre, apellido: dto.apellido } },
    });

    if (error || !data?.user) {
      this.logger.warn(`Registro fallido para ${dto.email}: ${error?.message}`);

      if (error?.message?.toLowerCase().includes('already')) {
        throw new ConflictException('Ya existe una cuenta con ese correo');
      }

      throw new ConflictException(
        error?.message ?? 'No se pudo crear la cuenta',
      );
    }

    // El trigger crea la fila con nombre y apellido, pero no fija rol ni tienda
    await this.perfiles.inicializar(data.user.id, {
      nombre: dto.nombre,
      apellido: dto.apellido,
      tienda: dto.tienda,
    });

    this.contexto.identificarUsuario(data.user.id, data.user.email ?? '');
    this.logger.log(`Cuenta creada: ${data.user.email}`);

    // Si el proyecto exige confirmar el correo, Supabase no devuelve sesión
    if (!data.session) {
      return {
        mensaje:
          'Cuenta creada. Revisa tu correo para confirmarla antes de iniciar sesión.',
      };
    }

    return this.armarSesion(data.session, data.user);
  }

  /** Inicia sesión con email y contraseña */
  async login(dto: LoginDto): Promise<SesionRespuesta> {
    const { data, error } = await this.supabase.anon.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data?.session || !data?.user) {
      // No se distingue "usuario inexistente" de "contraseña incorrecta":
      // decirlo permitiría averiguar qué correos están registrados.
      this.logger.warn(`Login fallido para ${dto.email}: ${error?.message}`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // El login es público, así que el guard no identificó a nadie:
    // se lo decimos al registro para que la fila no quede anónima.
    this.contexto.identificarUsuario(data.user.id, data.user.email ?? '');

    this.logger.log(`Sesión iniciada: ${data.user.email}`);

    return await this.armarSesion(data.session, data.user);
  }

  /** Renueva el accessToken a partir del refreshToken */
  async refrescar(dto: RefrescarSesionDto): Promise<SesionRespuesta> {
    const { data, error } = await this.supabase.anon.auth.refreshSession({
      refresh_token: dto.refreshToken,
    });

    if (error || !data?.session || !data?.user) {
      throw new UnauthorizedException(
        'El refreshToken no es válido o ya expiró',
      );
    }

    return await this.armarSesion(data.session, data.user);
  }

  /**
   * Cierra la sesión asociada a ese accessToken.
   * Se hace con el cliente admin porque el servidor no tiene sesión propia:
   * hay que decirle a Supabase explícitamente qué token invalidar.
   */
  async cerrarSesion(accessToken: string): Promise<{ mensaje: string }> {
    // Primero se olvida aquí: si no, la caché seguiría dando por buena la
    // sesión durante su vigencia aunque Supabase ya la haya invalidado.
    this.cache.olvidar(accessToken);

    const { error } = await this.supabase.admin.auth.admin.signOut(accessToken);

    if (error) {
      this.logger.warn(`No se pudo cerrar la sesión: ${error.message}`);
    }

    return { mensaje: 'Sesión cerrada' };
  }

  /**
   * La sesión viaja con el perfil completo para que el frontend pueda pintar
   * la pantalla de usuario sin una segunda llamada nada más entrar.
   */
  private async armarSesion(
    sesion: Session,
    usuario: User,
  ): Promise<SesionRespuesta> {
    const perfil: Perfil = await this.perfiles.obtener(
      usuario.id,
      usuario.email ?? '',
    );

    return {
      usuario: perfil,
      accessToken: sesion.access_token,
      refreshToken: sesion.refresh_token,
      expiraEn: sesion.expires_at ?? null,
      tipoToken: sesion.token_type,
    };
  }
}
