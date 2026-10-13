import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/** Una escritura a Ripley que no salió porque la petición iba en simulacro */
export interface EscrituraEvitada {
  metodo: 'put' | 'post';
  /** El verbo del mensaje: "actualizar", "enviar". Nunca la ruta */
  accion: string;
}

interface CambioRegistrado {
  antes?: unknown;
  despues?: unknown;
  /** Quién hace la petición: lo pone el guard, o el login si es ruta pública */
  usuario?: { id: string; email: string };
  /** Presente si la petición va en simulacro: lo que no se escribió */
  simulacro?: { escrituras: EscrituraEvitada[] };
}

/**
 * Contexto de la petición en curso: quién la hace, qué está cambiando y si va
 * en simulacro.
 *
 * Usa AsyncLocalStorage porque quienes lo escriben y quien lo lee no se
 * conocen: el almacén viaja solo por toda la cadena de promesas de una misma
 * petición, sin pasar el request de mano en mano ni hacer request-scoped a los
 * services.
 *
 * Lo usan tres cosas: el interceptor, para registrar el antes y el después de un
 * cambio; el cliente HTTP de Ripley, para saber de quién es el token
 * corporativo que debe usar; y ese mismo cliente, para saber si puede escribir.
 */
@Injectable()
export class ContextoAuditoria {
  private readonly almacen = new AsyncLocalStorage<CambioRegistrado>();

  /**
   * El middleware envuelve aquí el manejo de la petición.
   *
   * `simulacro` la abre ya en simulacro: así lo está desde el primer momento,
   * antes de que corra ningún guard ni ningún service.
   */
  ejecutar<T>(fn: () => T, opciones: { simulacro?: boolean } = {}): T {
    return this.almacen.run(
      opciones.simulacro ? { simulacro: { escrituras: [] } } : {},
      fn,
    );
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

  // ---------- Simulacro ----------

  /**
   * Pone la petición en curso en simulacro: desde aquí, nada se escribe en
   * Ripley.
   *
   * **No tiene vuelta atrás**, y a propósito no hay un `desactivarSimulacro()`:
   * una prueba que a mitad de camino pudiera volver a escribir de verdad no
   * sería una prueba. Llamarlo dos veces no hace nada.
   */
  activarSimulacro(): void {
    const actual = this.almacen.getStore();

    if (actual && !actual.simulacro) actual.simulacro = { escrituras: [] };
  }

  /** Si la petición en curso va en simulacro */
  enSimulacro(): boolean {
    return Boolean(this.almacen.getStore()?.simulacro);
  }

  /** Lo llama el cliente de Ripley en vez de escribir */
  anotarEscrituraEvitada(escritura: EscrituraEvitada): void {
    this.almacen.getStore()?.simulacro?.escrituras.push(escritura);
  }

  /** Las escrituras que no salieron, en orden */
  escriturasEvitadas(): EscrituraEvitada[] {
    return [...(this.almacen.getStore()?.simulacro?.escrituras ?? [])];
  }
}
