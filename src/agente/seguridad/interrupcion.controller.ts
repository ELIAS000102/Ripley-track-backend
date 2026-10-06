import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { InterrumpirDto } from '../dto/edicion.dto.js';
import { InterrupcionAgenteService } from './interrupcion.service.js';

/**
 * El botón "Detener" del chat.
 *
 * No lleva `@PermitidoAgente()`: la usa la persona desde el panel, y el agente
 * no tiene por qué cortar peticiones, ni las suyas ni las de nadie.
 */
@Controller('agente')
export class InterrupcionAgenteController {
  constructor(private readonly interrupcion: InterrupcionAgenteService) {}

  /**
   * POST /agente/interrumpir  { "peticion": "…" }
   *
   * Corta las herramientas de esa petición y, si el backend tiene acceso a la
   * API de n8n, para la ejecución. Responde si n8n confirmó que la paró.
   */
  @Post('interrumpir')
  @HttpCode(200)
  interrumpir(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: InterrumpirDto,
  ) {
    return this.interrupcion.interrumpir(body.peticion, usuario.id);
  }
}
