import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestConUsuario } from '../../auth/interfaces/auth.interface.js';
import {
  PERMITIDO_AGENTE,
  PERMITIDO_AGENTE_EDITOR,
} from './permitido-agente.decorator.js';
import { ModoAgenteService } from './modo.service.js';

/**
 * Rutas que el agente no puede tocar bajo ningún concepto.
 *
 * Es una lista negra que gana sobre las dos marcas. Puede parecer redundante
 * —hoy ninguna de estas rutas está marcada—, pero justamente por eso existe: la
 * lista blanca protege mientras nadie se equivoque, y basta un @PermitidoAgente()
 * puesto sin pensar para abrir la gestión del token corporativo. Con esto ese
 * descuido no llega a producción, y hay tests que lo comprueban.
 *
 * `/agente/modo` está aquí por la razón más importante de todas: **el agente no
 * puede concederse permisos a sí mismo**. Si pudiera llamar a esa ruta, una
 * instrucción colada en un dato que lea bastaría para que se pusiera en modo
 * editor y a continuación escribiera. El interruptor lo mueve una persona desde
 * el panel, y nadie más.
 */
const PROHIBIDO_SIEMPRE = ['/configuracion/token-ripley', '/agente/modo'];

/**
 * Restringe lo que puede hacer el agente de IA.
 *
 * Las peticiones que llegan con "X-Origen: agente" pasan por tres filtros, en
 * este orden:
 *
 * 1. **Lista negra.** No hay marca que la levante.
 * 2. **¿Escribe?** Las rutas con @PermitidoAgenteEditor() exigen además que el
 *    usuario tenga el modo editor activo. Sin él, 403 —y el mensaje dice cómo
 *    activarlo, porque si no el agente se inventa por qué falló—.
 * 3. **¿Consulta?** Las rutas con @PermitidoAgente() pasan. El resto, 403.
 *
 * El modo se pregunta al servidor, nunca a la petición. Es lo que hace que el
 * interruptor sea un control y no un adorno: una petición puede mentir sobre en
 * qué modo cree estar, pero no sobre lo que el backend tiene guardado.
 *
 * Importante sobre su alcance: la cabecera la declara el cliente, así que esto
 * acota al agente, no a una persona malintencionada —quien tenga el token puede
 * omitir la cabecera, pero entonces ya podría usar el panel igualmente—. El
 * objetivo es contener al agente: que no modifique nada si se le cuelan
 * instrucciones en un dato que lea, o si se configura mal una herramienta en
 * n8n. Para eso sirve.
 */
@Injectable()
export class AgenteGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly modo: ModoAgenteService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestConUsuario>();

    if (request.get('x-origen')?.toLowerCase() !== 'agente') return true;

    // 1. Lista negra
    const ruta = request.path ?? request.url ?? '';
    if (PROHIBIDO_SIEMPRE.some((prefijo) => ruta.startsWith(prefijo))) {
      throw new ForbiddenException(
        ruta.startsWith('/agente/modo')
          ? 'El modo del agente solo lo cambia una persona desde el panel.'
          : 'El agente no tiene acceso a la gestión del token de Ripley.',
      );
    }

    const [escribe, consulta] = [PERMITIDO_AGENTE_EDITOR, PERMITIDO_AGENTE].map(
      (marca) =>
        this.reflector.getAllAndOverride<boolean>(marca, [
          context.getHandler(),
          context.getClass(),
        ]),
    );

    // 2. Escrituras: hace falta el interruptor puesto
    if (escribe) {
      if (!this.modo.puedeEscribir(request.usuario?.id)) {
        throw new ForbiddenException(
          'El agente está en modo consultor y esta operación modifica datos. ' +
            'Activa el modo editor con el interruptor del chat y vuelve a pedirlo.',
        );
      }
      return true;
    }

    // 3. Consultas
    if (!consulta) {
      throw new ForbiddenException(
        'El agente no puede usar esta ruta. Modifica datos o maneja credenciales.',
      );
    }

    return true;
  }
}
