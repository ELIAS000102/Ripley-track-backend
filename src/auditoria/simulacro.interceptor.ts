import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { map, Observable } from 'rxjs';
import { ContextoAuditoria } from './contexto-auditoria.service.js';

const SIN_MARCA_SIMULACRO = 'sinMarcaSimulacro';

/**
 * Una ruta cuya respuesta no habla de Ripley —el aviso de un paso de una
 * rutina—: no se marca. Diría "esta petición no intentó escribir nada" de sí
 * misma, y quien la lee lo tomaría por el paso entero.
 */
export const SinMarcaSimulacro = () => SetMetadata(SIN_MARCA_SIMULACRO, true);

/** Lo que se añade a la respuesta de una petición en simulacro */
export interface MarcaSimulacro {
  escriturasEvitadas: number;
  aviso: string;
}

/**
 * Lo que dice una respuesta en simulacro, para quien la lea.
 *
 * El "después" de un simulacro es lo que quedaría, no lo que quedó, y eso
 * tiene que decirlo la respuesta misma: un agente que lee "después: activo"
 * informa de un cambio hecho si nadie le dice que no se hizo.
 */
export function marcaSimulacro(evitadas: number): MarcaSimulacro {
  return {
    escriturasEvitadas: evitadas,
    aviso: evitadas
      ? `Simulacro: no se cambió nada en Ripley. Se evitaron ${evitadas} escritura(s), y lo que dice "después" es lo que quedaría si se hiciera de verdad.`
      : 'Simulacro: esta petición no intentó escribir nada en Ripley.',
  };
}

/**
 * Marca las respuestas de una petición en simulacro.
 *
 * Siempre con la cabecera `X-Simulacro: si`. Y, si la respuesta es un objeto
 * plano, con un campo `simulacro` que dice cuántas escrituras no salieron. Una
 * lista o un archivo (el Excel de una plantilla) se dejan como están: meterles
 * un campo los rompería. Las rutas con `@SinMarcaSimulacro()`, tampoco.
 */
@Injectable()
export class SimulacroInterceptor implements NestInterceptor {
  constructor(
    private readonly contexto: ContextoAuditoria,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((cuerpo) => {
        if (!this.contexto.enSimulacro()) return cuerpo;
        if (this.reflector.getAllAndOverride<boolean>(SIN_MARCA_SIMULACRO, [context.getHandler(), context.getClass()])) {
          return cuerpo;
        }

        context.switchToHttp().getResponse<Response>().setHeader?.('X-Simulacro', 'si');

        const plano =
          cuerpo !== null &&
          typeof cuerpo === 'object' &&
          Object.getPrototypeOf(cuerpo) === Object.prototype;

        if (!plano) return cuerpo;

        return {
          ...(cuerpo as Record<string, unknown>),
          simulacro: marcaSimulacro(this.contexto.escriturasEvitadas().length),
        };
      }),
    );
  }
}
