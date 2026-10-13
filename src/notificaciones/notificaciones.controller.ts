import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Usuario } from '../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { NotificacionesService } from './notificaciones.service.js';

/**
 * Los avisos de quien pregunta. Silvana no los alcanza: ninguna ruta lleva
 * `@PermitidoAgente()`, y son de la persona, no del chat.
 */
@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly avisos: NotificacionesService) {}

  /** GET /notificaciones — los últimos, los sin leer primero */
  @Get()
  async listar(@Usuario() usuario: UsuarioAutenticado) {
    return this.avisos.listar(usuario);
  }

  /** POST /notificaciones/leidas — todos leídos */
  @Post('leidas')
  @HttpCode(200)
  async marcarTodas(@Usuario() usuario: UsuarioAutenticado) {
    return this.avisos.marcarTodas(usuario);
  }

  /** POST /notificaciones/{id}/leida */
  @Post(':id/leida')
  @HttpCode(200)
  async marcarLeida(@Param('id', ParseUUIDPipe) id: string, @Usuario() usuario: UsuarioAutenticado) {
    return this.avisos.marcarLeida(id, usuario);
  }
}
