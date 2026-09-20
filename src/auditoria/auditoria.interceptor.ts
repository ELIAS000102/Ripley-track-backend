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

/**
 * Métodos que por definición no cambian nada.
 *
 * Un `@Auditar` sobre uno de estos se ignora, y no es paranoia: las seis
 * consultas del agente lo llevaban y llenaron la tabla de filas que solo decían
 * "alguien preguntó algo". La convención sola no aguantó; la regla tiene que
 * estar en el código.
 *
 * Al revés no se puede automatizar: hay varios POST que en realidad consultan
 * —listar servicios de un OPL, consultar agendas, simular—, así que marcar
 * sigue siendo una decisión manual. Esto solo impide equivocarse en la
 * dirección que ensucia el historial.
 */
const METODOS_DE_LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Lo que se sabe de la petición antes de que termine */
type DatosPeticion = Pick<
  RegistroUso,
  'accion' | 'origen' | 'metodo' | 'endpoint' | 'datos' | 'ip' | 'user_agent'
>;

/**
 * Guarda en Supabase **solo lo que cambia algo**: las operaciones marcadas con
 * @Auditar que además usan un método de escritura, y los inicios de sesión y
 * registros, que crean una sesión y son el rastro de quién entró.
 *
 * Las consultas no se registran, vengan del panel o del agente. Son la enorme
 * mayoría del tráfico —solo abrir el panel dispara media docena de catálogos— y
 * llenaban la tabla sin decir nada que no se sepa ya. Lo que se le preguntó al
 * agente no se pierde por esto: las conversaciones se guardan enteras en la
 * tabla de chats.
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

  /**
   * El nombre de la acción, si esta petición debe registrarse.
   *
   * Hacen falta las dos cosas: la marca @Auditar y un método que escriba. Una
   * marca sobre un GET se ignora en silencio —no es un error del que avisar,
   * es una decisión: ese endpoint consulta, así que no va al historial—.
   */
  private resolverAccion(context: ExecutionContext): string | undefined {
    const metodo = context
      .switchToHttp()
      .getRequest<RequestConUsuario>().method;

    if (METODOS_DE_LECTURA.has(metodo?.toUpperCase())) return undefined;

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
