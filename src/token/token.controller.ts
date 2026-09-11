import { Controller, Get, Post, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { TokenService } from './token.service.js';
import { AuthGuard } from './guards/auth.guard.js';

@Controller('token')
@UseGuards(AuthGuard) // Exige la cabecera Authorization: Bearer <API_SECRET>
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  /**
   * Endpoint invocado por la extensión de Chrome para enviar los tokens cifrados.
   * Recibe el payload cifrado en tránsito (AES-256-GCM) y lo guarda en memoria RAM por usuario.
   */
  @Post()
  recibirTokenCifrado(@Body() encryptedPayload: { iv: number[]; data: number[] }) {
    return this.tokenService.actualizarTokenEnMemoria(encryptedPayload);
  }

  /**
   * Endpoint para consultar tokens desde Postman.
   * Requiere de manera obligatoria el correo del usuario como parámetro de consulta.
   * Ejemplo de uso: GET /token?email=usuario@ripley.com
   */
  @Get()
  obtenerTokensParaPostman(@Query('email') email: string) {
    if (!email) {
      throw new BadRequestException('Debe proporcionar un correo electrónico en la consulta. Ej: /token?email=correo@ripley.com');
    }
    return this.tokenService.obtenerTokensPorCorreo(email);
  }
}