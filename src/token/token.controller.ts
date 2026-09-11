import { Controller, Post, Body, Get, Query, UseGuards } from '@nestjs/common';
import { TokenService } from './token.service.js';
import { AuthGuard } from './guards/auth.guard.js';

@Controller()
@UseGuards(AuthGuard)
export class TokenController {  // <--- Eliminamos 'public' de aquí
  constructor(private readonly tokenService: TokenService) {}

  @Post('save-token')
  saveToken(@Body() body: { deviceId: string; country: 'PE' | 'CL'; token: string | null }) {
    return this.tokenService.saveToken(body.deviceId, body.country, body.token);
  }

  @Get('get-token')
  getToken(@Query('deviceId') deviceId: string, @Query('country') country: 'PE' | 'CL') {
    return this.tokenService.getTokenByDeviceAndCountry(deviceId, country);
  }
}