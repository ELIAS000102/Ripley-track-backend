import { Global, Module } from '@nestjs/common';
import { TokenRipleyController } from './token-ripley.controller.js';
import { TokenRipleyService } from './token-ripley.service.js';

/**
 * Feature de credenciales de Ripley.
 *
 * Global porque RipleyHttpService (ripley/), que usan todos los módulos,
 * necesita resolver el token del usuario en cada llamada. La ruta HTTP sigue
 * siendo /configuracion/token-ripley: el panel la llama así.
 */
@Global()
@Module({
  controllers: [TokenRipleyController],
  providers: [TokenRipleyService],
  exports: [TokenRipleyService],
})
export class TokenRipleyModule {}
