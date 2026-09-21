import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, catchError, map, throwError } from 'rxjs';

/** Lo que se pone en lugar de una dirección */
const OCULTO = '[dirección interna]';

/**
 * Lo que no puede salir hacia el modelo.
 *
 * 1. URLs completas, que es como se coló: el mensaje de un 404 llevaba el
 *    endpoint entero de la API corporativa y el agente lo imprimió en el chat.
 * 2. Hosts sueltos, porque media dirección delata lo mismo que la entera.
 */
const DIRECCIONES = [
  /\bhttps?:\/\/\S+/gi,
  /\b(?:[\w-]+\.)+(?:com|net|org|io|dev|app|cloud|pe|cl)(?:\.[a-z]{2})?(?:\/\S*)?/gi,
];

/**
 * Borra direcciones de todo lo que el agente devuelve.
 *
 * El agente reenvía al modelo lo que le llega, y el modelo lo imprime en el
 * chat. Así que cualquier cosa que aparezca en una respuesta de `/agente` es,
 * en la práctica, pública para quien esté conversando: no vale con que el
 * cliente "no debería mostrarlo".
 *
 * El origen se arregló donde estaba —el cliente HTTP ya no pone la URL en el
 * mensaje de error—, pero esto se queda como segunda capa: por una respuesta de
 * `/agente` pasan también los mensajes de error que devuelve la propia API
 * corporativa, y ahí no se controla qué escriben. Un `JSON.stringify` de su
 * payload de errores puede traer cualquier cosa.
 *
 * **Solo actúa sobre las peticiones del agente.** El panel es la vista de
 * administración de quien ya tiene la sesión y sí necesita ver direcciones
 * —`/agente/configuracion` devuelve la del webhook de n8n para poder
 * mostrarla—, así que recortarle a él sería romper algo por proteger a otro.
 */
@Injectable()
export class SinRastroInterceptor implements NestInterceptor {
  intercept(
    contexto: ExecutionContext,
    siguiente: CallHandler,
  ): Observable<unknown> {
    const peticion = contexto.switchToHttp().getRequest<Request>();

    if (peticion.get('x-origen')?.toLowerCase() !== 'agente') {
      return siguiente.handle();
    }

    return siguiente.handle().pipe(
      map((respuesta) => this.limpiar(respuesta)),
      // Los errores viajan igual de lejos que las respuestas
      catchError((e: { message?: unknown }) => {
        if (typeof e?.message === 'string') e.message = this.texto(e.message);

        const cuerpo = (e as { response?: { message?: unknown } }).response;
        if (cuerpo) cuerpo.message = this.limpiar(cuerpo.message);

        return throwError(() => e);
      }),
    );
  }

  /** Recorre la respuesta entera: objetos, listas y textos */
  private limpiar(valor: unknown): unknown {
    if (typeof valor === 'string') return this.texto(valor);

    if (Array.isArray(valor)) return valor.map((v) => this.limpiar(v));

    if (valor && typeof valor === 'object') {
      return Object.fromEntries(
        Object.entries(valor as Record<string, unknown>).map(([k, v]) => [
          k,
          this.limpiar(v),
        ]),
      );
    }

    return valor;
  }

  private texto(valor: string): string {
    return DIRECCIONES.reduce(
      (limpio, patron) => limpio.replace(patron, OCULTO),
      valor,
    );
  }
}
