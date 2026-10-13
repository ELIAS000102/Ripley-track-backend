import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ContextoAuditoria } from './contexto-auditoria.service.js';

/**
 * Si la cabecera `X-Simulacro` pide un simulacro.
 *
 * Cualquier valor lo pide salvo los que dicen claramente que no. Equivocarse
 * hacia el simulacro solo cuesta una escritura que no se hace; equivocarse
 * hacia el otro lado es escribir en una prueba.
 */
export function pideSimulacro(valor: string | undefined): boolean {
  const v = valor?.trim().toLowerCase();
  return Boolean(v) && !['no', '0', 'false'].includes(v!);
}

/**
 * Abre el contexto de auditoría al principio de cada petición.
 *
 * Tiene que ser un middleware y no el interceptor: el interceptor solo arma la
 * cadena de Observables, y el handler se ejecuta más tarde, cuando Nest se
 * suscribe. Para entonces ya se habría salido del contexto y lo que reportara
 * el service se perdería. El middleware, en cambio, envuelve la petición entera
 * —guard, interceptor, controller y service—, así que todos comparten el mismo
 * almacén.
 *
 * Aquí se decide también si la petición va en simulacro. Que lo pida cualquiera
 * no es un riesgo: un simulacro solo quita la posibilidad de escribir.
 */
@Injectable()
export class AuditoriaMiddleware implements NestMiddleware {
  constructor(private readonly contexto: ContextoAuditoria) {}

  use(req: Request, _res: Response, next: NextFunction) {
    this.contexto.ejecutar(() => next(), {
      simulacro: pideSimulacro(req.get?.('x-simulacro')),
    });
  }
}
