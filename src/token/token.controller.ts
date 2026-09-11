import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { TokenService } from './token.service.js';
import { AuthGuard } from './guards/auth.guard.js';

@Controller('token')
@UseGuards(AuthGuard) // Exige la cabecera Authorization: Bearer <API_SECRET>
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  /**
   * Endpoint invocado por la extensión de Chrome para enviar los tokens cifrados.
   * Recibe el payload cifrado en tránsito (AES-256-GCM) y lo carga en memoria RAM.
   */
  @Post()
  recibirTokenCifrado(@Body() encryptedPayload: { iv: number[]; data: number[] }) {
    return this.tokenService.actualizarTokenEnMemoria(encryptedPayload);
  }

  /**
   * Endpoint consultado desde Postman.
   * Retorna simultáneamente el token e información de ambos países (Perú y Chile).
   */
  @Get()
  obtenerTokensParaPostman() {
    return this.tokenService.obtenerTodosLosTokensMemoria();
  }
}