import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CacheSesiones } from './cache-sesiones.service.js';
import { PerfilService } from './perfil.service.js';
import { TokenRutinaService } from './token-rutina.service.js';

/**
 * Feature de sesión y perfil: registro, login, refresh, logout y los datos no
 * sensibles del usuario, contra Supabase Auth y la tabla `profiles`.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, PerfilService, CacheSesiones, TokenRutinaService],
  // CacheSesiones sale de aquí para que el guard global —que lo instancia
  // AppModule— comparta exactamente la misma caché que el cierre de sesión.
  // TokenRutinaService, para que lo use el guard y lo emita el ejecutor.
  exports: [PerfilService, CacheSesiones, TokenRutinaService],
})
export class AuthModule {}
