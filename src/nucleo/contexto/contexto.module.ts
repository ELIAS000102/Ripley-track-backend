import { Global, Module } from '@nestjs/common';
import { ContextoPeticion } from './contexto-peticion.service.js';

/**
 * El contexto de cada petición (quién la hace, qué cambia, si va en
 * simulacro). Global porque lo leen y escriben casi todos: el guard de sesión,
 * el cliente de Ripley, la auditoría y los services que reportan un cambio.
 * El middleware que lo abre se aplica en AppModule.
 */
@Global()
@Module({
  providers: [ContextoPeticion],
  exports: [ContextoPeticion],
})
export class ContextoModule {}
