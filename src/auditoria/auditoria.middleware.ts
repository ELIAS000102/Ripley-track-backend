import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ContextoAuditoria } from './contexto-auditoria.service.js';

/**
 * Abre el contexto de auditoría al principio de cada petición.
 *
 * Tiene que ser un middleware y no el interceptor: el interceptor solo arma la
 * cadena de Observables, y el handler se ejecuta más tarde, cuando Nest se
 * suscribe. Para entonces ya se habría salido del contexto y lo que reportara
 * el service se perdería. El middleware, en cambio, envuelve la petición entera
 * —guard, interceptor, controller y service—, así que todos comparten el mismo
 * almacén.
 */
@Injectable()
export class AuditoriaMiddleware implements NestMiddleware {
  constructor(private readonly contexto: ContextoAuditoria) {}

  use(_req: Request, _res: Response, next: NextFunction) {
    this.contexto.ejecutar(() => next());
  }
}
