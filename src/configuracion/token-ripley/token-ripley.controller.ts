import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { EliminarTokenDto, GuardarTokenDto } from './interfaces/dto/token-ripley.dto.js';
import { TokenRipleyService } from './token-ripley.service.js';

/**
 * Gestión del token con el que cada usuario consulta las APIs de Ripley.
 *
 * El token entra por aquí y no vuelve a salir: no hay ningún endpoint que lo
 * devuelva. Solo se puede saber si está configurado y cuándo se actualizó.
 *
 * El agente de IA no tiene acceso a estas rutas —ninguna lleva
 * @PermitidoAgente()—, así que no puede leer ni cambiar credenciales.
 */
@Controller('configuracion/token-ripley')
export class TokenRipleyController {
  constructor(private readonly tokens: TokenRipleyService) {}

  /** GET .../estado — qué países tienen token, sin revelar su valor */
  @Get('estado')
  async estado(@Usuario() usuario: UsuarioAutenticado) {
    return this.tokens.estado(usuario.id);
  }

  /** POST .../ — guarda o reemplaza el token de un país */
  @Auditar('tokenRipley.guardar')
  @Post()
  async guardar(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: GuardarTokenDto,
  ) {
    return this.tokens.guardar(usuario.id, body.pais, body.token);
  }

  /** DELETE .../?pais=PE */
  @Auditar('tokenRipley.eliminar')
  @Delete()
  async eliminar(
    @Usuario() usuario: UsuarioAutenticado,
    @Query() query: EliminarTokenDto,
  ) {
    return this.tokens.eliminar(usuario.id, query.pais);
  }
}
