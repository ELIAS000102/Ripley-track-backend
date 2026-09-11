import { Controller, Get, Post, Body, UseGuards, NotFoundException, BadRequestException } from '@nestjs/common';
import { TokenService } from './token.service.js';
import { AuthGuard } from './guards/auth.guard.js';

@Controller()
@UseGuards(AuthGuard)
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  @Post('save-token')
  saveToken(@Body() body: { country: string; token: string | null }) {
    const { country, token } = body;
    if (country !== 'PE' && country !== 'CL') {
      throw new BadRequestException({ error: "País inválido" });
    }
    return this.tokenService.saveToken(country, token);
  }

  @Get('get-token')
  getAllTokens() {
    const result = this.tokenService.getAllTokens();
    if (!result.found) {
      throw new NotFoundException({ status: "error", message: result.message });
    }
    return { status: "success", tokens: result.tokens };
  }

  @Get('get-token/pe')
  getPeruToken() {
    const data = this.tokenService.getTokenByCountry('PE');
    if (!data) {
      throw new NotFoundException({ status: "error", message: "Token no encontrado para Perú" });
    }
    return { status: "success", ...data };
  }

  @Get('get-token/cl')
  getChileToken() {
    const data = this.tokenService.getTokenByCountry('CL');
    if (!data) {
      throw new NotFoundException({ status: "error", message: "Token no encontrado para Chile" });
    }
    return { status: "success", ...data };
  }
}