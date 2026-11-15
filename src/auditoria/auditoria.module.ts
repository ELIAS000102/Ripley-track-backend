import { Global, Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service.js';

/**
 * Registro de cambios: quién modificó qué, con qué datos y cuándo.
 *
 * Global porque el interceptor y varios services escriben en el registro. El
 * antes y el después de cada cambio llegan por ContextoPeticion (nucleo/contexto).
 */
@Global()
@Module({
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
