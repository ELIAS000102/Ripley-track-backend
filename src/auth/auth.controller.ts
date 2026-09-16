import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { Auditar } from '../auditoria/decorators/auditar.decorator.js';
import { AuthService } from './auth.service.js';
import { Publico } from './decorators/publico.decorator.js';
import { Usuario } from './decorators/usuario.decorator.js';
import { LoginDto, RefrescarSesionDto } from './dto/login.dto.js';
import { ActualizarPerfilDto } from './dto/perfil.dto.js';
import { RegistroDto } from './dto/registro.dto.js';
import { PerfilService } from './perfil.service.js';
import type { UsuarioAutenticado } from './interfaces/auth.interface.js';

/**
 * Endpoints de sesión y perfil. Pensados para que los consuma cualquier
 * frontend: el cliente guarda los tokens que devuelve /login y los manda en el
 * header "Authorization: Bearer <accessToken>" en todas las demás llamadas.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly perfiles: PerfilService,
  ) {}

  /** POST /auth/registro — crea una cuenta con el rol mínimo */
  @Publico()
  @Auditar('auth.registro')
  @HttpCode(HttpStatus.CREATED)
  @Post('registro')
  async registrar(@Body() body: RegistroDto) {
    return this.authService.registrar(body);
  }

  /** POST /auth/login */
  @Publico()
  @Auditar('auth.login')
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  /** POST /auth/refresh — renueva el accessToken sin volver a pedir credenciales */
  @Publico()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refrescar(@Body() body: RefrescarSesionDto) {
    return this.authService.refrescar(body);
  }

  /** POST /auth/logout — invalida la sesión actual */
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Headers('authorization') authorization: string) {
    const [, token] = authorization?.split(' ') ?? [];
    return this.authService.cerrarSesion(token);
  }

  /** GET /auth/me — perfil del usuario conectado, para la pantalla de perfil */
  @Get('me')
  async perfil(@Usuario() usuario: UsuarioAutenticado) {
    return this.perfiles.obtener(usuario.id, usuario.email);
  }

  /**
   * PUT /auth/me — el usuario edita sus propios datos.
   * El rol no se puede cambiar por aquí, a propósito.
   */
  @Auditar('perfil.actualizar')
  @Put('me')
  async actualizarPerfil(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: ActualizarPerfilDto,
  ) {
    return this.perfiles.actualizar(usuario.id, usuario.email, body);
  }
}
