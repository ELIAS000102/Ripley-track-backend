import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMITIDO_AGENTE } from '../decorators/permitido-agente.decorator.js';

/**
 * Restringe lo que puede hacer el agente de IA.
 *
 * Las peticiones que llegan con "X-Origen: agente" solo pasan si el endpoint
 * está marcado con @PermitidoAgente(); el resto recibe 403, aunque el token del
 * usuario tenga permisos de sobra. Eso evita que el agente modifique nada si se
 * le cuelan instrucciones en un dato que lea, o si se configura mal una
 * herramienta en n8n.
 *
 * Importante sobre su alcance: la cabecera la declara el cliente, así que esto
 * acota al agente, no a una persona malintencionada —quien tenga el token puede
 * omitir la cabecera, pero entonces ya podría usar el panel igualmente—. El
 * objetivo es contener al agente, y para eso sirve.
 */
@Injectable()
export class AgenteGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (request.get('x-origen')?.toLowerCase() !== 'agente') return true;

    const permitido = this.reflector.getAllAndOverride<boolean>(
      PERMITIDO_AGENTE,
      [context.getHandler(), context.getClass()],
    );

    if (!permitido) {
      throw new ForbiddenException(
        'El agente solo puede consultar capacidades de picking y despacho, no modificarlas',
      );
    }

    return true;
  }
}
