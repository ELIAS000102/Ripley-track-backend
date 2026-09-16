import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';
import type { RequestConUsuario } from '../auth/interfaces/auth.interface.js';
import { AuditoriaService } from './auditoria.service.js';
import { ContextoAuditoria } from './contexto-auditoria.service.js';
import { ACCION_AUDITADA } from './decorators/auditar.decorator.js';
import type { RegistroUso } from './interfaces/auditoria.interface.js';

/** Lo que se sabe de la petición antes de que termine */
type DatosPeticion = Pick<
  RegistroUso,
  'accion' | 'origen' | 'metodo' | 'endpoint' | 'datos' | 'ip' | 'user_agent'
>;

/**
 * Guarda en Supabase las operaciones que vale la pena conservar: las que
 * modifican datos en Ripley (marcadas con @Auditar) y los inicios de sesión.
 *
 * Las consultas no se registran. Son la enorme mayoría del tráfico —solo abrir
 * el panel dispara media docena de catálogos— y llenaban la tabla sin decir nada
 * que no se sepa ya.
 *
 * En los cambios, además de lo que envió el cliente, se guarda el estado previo
 * y el resultante: el service los reporta por ContextoAuditoria mientras atiende
 * la petición.
 */
@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  constructor(
    private readonly auditoria: AuditoriaService,
    private readonly contexto: ContextoAuditoria,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const accion = this.resolverAccion(context);

    if (!accion) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<RequestConUsuario>();
    const response = http.getResponse<Response>();
    const inicio = Date.now();

    const base = {
      accion,
      // Lo declara el cliente: n8n manda "agente", el panel no manda nada
      origen:
        request.get('x-origen')?.toLowerCase() === 'agente'
          ? 'agente'
          : 'directo',
      metodo: request.method,
      endpoint: request.path,
      datos: this.auditoria.censurar({
        query: request.query,
        params: request.params,
        body: request.body,
      }) as Record<string, unknown>,
      ip: request.ip ?? null,
      user_agent: request.get('user-agent') ?? null,
    };

    // El contexto lo abre AuditoriaMiddleware, así que aquí ya se puede leer
    // lo que el service haya reportado con registrarCambio().
    return next.handle().pipe(
      tap({
        next: () =>
          this.guardar(base, request, response.statusCode, null, inicio),
        error: (e: { status?: number; message?: string }) =>
          this.guardar(
            base,
            request,
            e?.status ?? 500,
            e?.message ?? 'Error desconocido',
            inicio,
          ),
      }),
    );
  }

  /** Solo se registran los endpoints marcados con @Auditar */
  private resolverAccion(context: ExecutionContext): string | undefined {
    return this.reflector.getAllAndOverride<string>(ACCION_AUDITADA, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  private guardar(
    base: DatosPeticion,
    request: RequestConUsuario,
    estado: number,
    error: string | null,
    inicio: number,
  ): void {
    const { antes, despues, usuario } = this.contexto.obtenerCambio();

    this.auditoria.registrar({
      ...base,
      // Normalmente lo resuelve el guard; en el login, que es público,
      // lo reporta el propio AuthService una vez validadas las credenciales.
      usuario_id: request.usuario?.id ?? usuario?.id ?? null,
      usuario_email: request.usuario?.email ?? usuario?.email ?? null,
      datos_antes: this.auditoria.censurar(antes ?? null),
      datos_despues: this.auditoria.censurar(despues ?? null),
      estado,
      exitoso: error === null,
      error,
      duracion_ms: Date.now() - inicio,
    });
  }
}
