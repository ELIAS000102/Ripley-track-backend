import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

interface CambioRegistrado {
  antes?: unknown;
  despues?: unknown;
  /** Quién hace la petición: lo pone el guard, o el login si es ruta pública */
  usuario?: { id: string; email: string };
}

/**
 * Contexto de la petición en curso: quién la hace y qué está cambiando.
 *
 * Usa AsyncLocalStorage porque quienes lo escriben y quien lo lee no se
 * conocen: el almacén viaja solo por toda la cadena de promesas de una misma
 * petición, sin pasar el request de mano en mano ni hacer request-scoped a los
 * services.
 *
 * Lo usan dos cosas: el interceptor, para registrar el antes y el después de un
 * cambio; y el cliente HTTP de Ripley, para saber de quién es el token
 * corporativo que debe usar.
 */
@Injectable()
export class ContextoAuditoria {
  private readonly almacen = new AsyncLocalStorage<CambioRegistrado>();

  /** El interceptor envuelve aquí el manejo de la petición */
  ejecutar<T>(fn: () => T): T {
    return this.almacen.run({}, fn);
  }

  /**
   * Lo llama el service justo antes de escribir en Ripley.
   * `antes` es el estado actual que acaba de leer; `despues`, lo que va a quedar.
   */
  registrarCambio(antes: unknown, despues: unknown): void {
    const actual = this.almacen.getStore();

    if (actual) {
      actual.antes = antes;
      actual.despues = despues;
    }
  }

  /**
   * Deja anotado quién hace la petición.
   *
   * Normalmente lo llama el guard al validar el token. El login también lo
   * llama porque es ruta pública y el guard no corre: sin eso, el registro del
   * inicio de sesión quedaría sin saber quién entró.
   */
  identificarUsuario(id: string, email: string): void {
    const actual = this.almacen.getStore();

    if (actual) actual.usuario = { id, email };
  }

  /** Quién hace la petición en curso, si ya se identificó */
  usuarioActual(): { id: string; email: string } | null {
    return this.almacen.getStore()?.usuario ?? null;
  }

  /** Lo lee el interceptor al terminar la petición */
  obtenerCambio(): CambioRegistrado {
    return this.almacen.getStore() ?? {};
  }
}
