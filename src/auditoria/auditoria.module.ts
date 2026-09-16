import { Global, Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service.js';
import { ContextoAuditoria } from './contexto-auditoria.service.js';

/**
 * Registro de cambios: quién modificó qué, con qué datos y cuándo.
 *
 * Global porque los cinco services que escriben en Ripley reportan su cambio
 * por ContextoAuditoria, y no tiene sentido importarlo en cada módulo.
 */
@Global()
@Module({
  providers: [AuditoriaService, ContextoAuditoria],
  exports: [AuditoriaService, ContextoAuditoria],
})
export class AuditoriaModule {}
