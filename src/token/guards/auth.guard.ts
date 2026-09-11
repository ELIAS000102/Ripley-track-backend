import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    
    // PERMITIR EL PREFLIGHT DE CORS: Las peticiones OPTIONS no llevan token de autorización
    if (request.method === 'OPTIONS') {
      return true;
    }

    const authHeader = request.headers['authorization'];
    const apiSecret = this.configService.get<string>('API_SECRET');

    if (authHeader && authHeader === `Bearer ${apiSecret}`) {
      return true;
    }

    throw new UnauthorizedException({ error: "No autorizado" });
  }
}