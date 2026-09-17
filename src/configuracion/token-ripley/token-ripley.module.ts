import { Global, Module } from '@nestjs/common';
import { TokenRipleyController } from './token-ripley.controller.js';
import { TokenRipleyService } from './token-ripley.service.js';

/**
 * Feature de credenciales de Ripley.
 *
 * Global porque RipleyHttpService, que vive en common y lo usan todos los
 * módulos, necesita resolver el token del usuario en cada llamada.
 */
@Global()
@Module({
  controllers: [TokenRipleyController],
  providers: [TokenRipleyService],
  exports: [TokenRipleyService],
})
export class TokenRipleyModule {}
