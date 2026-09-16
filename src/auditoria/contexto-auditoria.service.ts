import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

interface CambioRegistrado {
  antes?: unknown;
  despues?: unknown;
  /** Solo lo usa el login, que al ser público no pasa por el guard */
  usuario?: { id: string; email: string };
}

/**
 * Permite que un service reporte qué había antes y qué queda después de un
 * cambio, para que el interceptor lo guarde junto con la petición.
 *
 * Usa AsyncLocalStorage porque el interceptor y el service no se conocen: el
 * almacén viaja solo por toda la cadena de promesas de una misma petición, sin
 * tener que pasar el request de mano en mano ni hacer los services request-scoped.
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
   * Identifica al usuario en una ruta pública.
   * El login es el único caso: el guard no corre, así que sin esto el registro
   * del inicio de sesión quedaría sin saber quién entró.
   */
  identificarUsuario(id: string, email: string): void {
    const actual = this.almacen.getStore();

    if (actual) actual.usuario = { id, email };
  }

  /** Lo lee el interceptor al terminar la petición */
  obtenerCambio(): CambioRegistrado {
    return this.almacen.getStore() ?? {};
  }
}
