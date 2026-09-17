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
 * Rutas que el agente no puede tocar bajo ningún concepto.
 *
 * Es una lista negra que gana sobre @PermitidoAgente(). Puede parecer redundante
 * —hoy ninguna de estas rutas está marcada—, pero justamente por eso existe: la
 * lista blanca protege mientras nadie se equivoque, y basta un @PermitidoAgente()
 * puesto sin pensar para abrir la gestión del token corporativo. Con esto ese
 * descuido no llega a producción, y hay un test que lo comprueba.
 */
const PROHIBIDO_SIEMPRE = ['/configuracion/token-ripley'];

/**
 * Restringe lo que puede hacer el agente de IA.
 *
 * Las peticiones que llegan con "X-Origen: agente" solo pasan si el endpoint
 * está marcado con @PermitidoAgente(); el resto recibe 403, aunque el token del
 * usuario tenga permisos de sobra. Eso evita que el agente modifique nada si se
 * le cuelan instrucciones en un dato que lea, o si se configura mal una
 * herramienta en n8n.
 *
 * Marcadas están las consultas de los módulos de negocio (picking, despacho,
 * reportes, configuración de tipos de servicio, transferencias y simulación).
 * Fuera quedan las escrituras, las rutas del token corporativo y el perfil del
 * usuario: nada de eso necesita llegar al modelo para responder una consulta.
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

    // Primero la lista negra: no hay marca que la levante.
    const ruta = request.path ?? request.url ?? '';
    if (PROHIBIDO_SIEMPRE.some((prefijo) => ruta.startsWith(prefijo))) {
      throw new ForbiddenException(
        'El agente no tiene acceso a la gestión del token de Ripley.',
      );
    }

    const permitido = this.reflector.getAllAndOverride<boolean>(
      PERMITIDO_AGENTE,
      [context.getHandler(), context.getClass()],
    );

    if (!permitido) {
      throw new ForbiddenException(
        'El agente solo puede consultar. Esta ruta modifica datos o maneja credenciales.',
      );
    }

    return true;
  }
}
