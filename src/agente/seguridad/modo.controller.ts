import { Body, Controller, Get, Put } from '@nestjs/common';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { CambiarModoDto } from '../dto/edicion.dto.js';
import { ModoAgenteService } from './modo.service.js';

/**
 * El interruptor que decide si el agente puede escribir.
 *
 * Las dos rutas están en la **lista negra** de `AgenteGuard`, así que responden
 * `403` a una petición del agente aunque alguien las marque por error. Es la
 * garantía de la que dependen todas las demás: un permiso que el permitido
 * puede concederse a sí mismo no es un permiso.
 *
 * Tampoco llevan `SinRastroInterceptor`: como el agente no las alcanza, no hay
 * nada que recortarle, y quien las usa es el panel.
 */
@Controller('agente/modo')
export class ModoAgenteController {
  constructor(private readonly modo: ModoAgenteService) {}

  /**
   * GET /agente/modo
   *
   * En qué modo está el agente para este usuario. Lo consulta el panel al abrir
   * el chat, para que el interruptor no mienta si el modo caducó mientras tanto.
   */
  @Get()
  estado(@Usuario() usuario: UsuarioAutenticado) {
    return this.modo.estado(usuario.id);
  }

  /**
   * PUT /agente/modo  { "modo": "editor" }
   *
   * Lo mueve una persona desde el panel, nunca el agente. Volver a "editor"
   * estando ya en editor renueva el tiempo.
   */
  @Auditar('agente.cambiarModo')
  @Put()
  cambiar(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: CambiarModoDto,
  ) {
    return body.modo === 'editor'
      ? this.modo.activar(usuario.id)
      : this.modo.desactivar(usuario.id);
  }
}
