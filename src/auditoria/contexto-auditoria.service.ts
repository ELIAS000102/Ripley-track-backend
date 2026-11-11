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
  /** Presente si las llamadas a Ripley de la petición van en fila (el G12) */
  fila?: FilaSecuencial;
}

/** Una petición en fila (el G12): cuántas llamadas a la vez, cuántas lleva y las lecturas que ya tiene */
interface FilaSecuencial {
  /** Cuántas llamadas a Ripley de la petición pueden estar en curso a la vez */
  aLaVez: number;
  activas: number;
  /** Las que esperan sitio, por orden de llegada */
  esperando: Array<() => void>;
  /** Las que salieron de verdad a Ripley, reintentos incluidos */
  llamadas: number;
  /** Lo que se esperó a que se abriera la ventana del cupo de Ripley */
  esperaMs: number;
  /** Lo ya leído (solo lecturas), para no pedirlo dos veces; puede venir de fuera y durar más que la petición */
  lecturas: Map<string, unknown>;
}

/** Lo que gastó una parte de la petición: sus llamadas a Ripley y su espera por cupo */
export interface Medicion {
  llamadas: number;
  esperaMs: number;
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

  /** La medición en curso dentro de la petición (ver `medir`) */
  private readonly mediciones = new AsyncLocalStorage<Medicion>();

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

  // ---------- En serie ----------

  /**
   * Desde aquí, las llamadas a Ripley de esta petición van **en fila**: como
   * mucho `aLaVez` en curso (por defecto una), y las demás esperan su sitio
   * por orden de llegada.
   *
   * Lo usa el G12. Primero iba de una en una (2026-11-10); al medir que Ripley
   * deja unas 120 llamadas por ventana de 60 s por token, el usuario pidió
   * gastar la ventana en ráfaga: de 4 en 4, y el cupo del cliente de Ripley
   * frena al llegar al tope. Va por petición y no en el cliente entero para
   * no tocar el ritmo del resto del backend.
   *
   * Además, una lectura que ya se hizo no se repite: sale de `lecturas`. Por
   * defecto dura lo que la petición; el G12 pasa la de su actualización, para
   * que una tabla aproveche lo que leyó la anterior (el mismo almacén, la
   * misma zona). Es una foto de la actualización, no una caché: la siguiente
   * actualización empieza vacía.
   */
  activarSecuencial(opciones: { lecturas?: Map<string, unknown>; aLaVez?: number } = {}): void {
    const actual = this.almacen.getStore();
    if (actual && !actual.fila) {
      actual.fila = {
        aLaVez: Math.max(1, Math.floor(opciones.aLaVez ?? 1)),
        activas: 0,
        esperando: [],
        llamadas: 0,
        esperaMs: 0,
        lecturas: opciones.lecturas ?? new Map(),
      };
    }
  }

  /** Lo llama el cliente de Ripley cada vez que una llamada sale de verdad */
  contarLlamada(): void {
    const fila = this.almacen.getStore()?.fila;
    if (fila) fila.llamadas++;
    const medicion = this.mediciones.getStore();
    if (medicion) medicion.llamadas++;
  }

  /** Lo llama el cliente de Ripley cuando una llamada esperó a que se abriera la ventana del cupo */
  anotarEspera(ms: number): void {
    const fila = this.almacen.getStore()?.fila;
    if (fila) fila.esperaMs += ms;
    const medicion = this.mediciones.getStore();
    if (medicion) medicion.esperaMs += ms;
  }

  /**
   * Corre `fn` y cuenta lo que gastó **ella sola**: sus llamadas a Ripley y su
   * espera por cupo. Con varias partes de la petición a la vez (el G12, de 4 en
   * 4), restar el contador de la fila antes y después mezclaría las de otras.
   */
  async medir<T>(fn: () => Promise<T>): Promise<{ resultado: T } & Medicion> {
    const medicion: Medicion = { llamadas: 0, esperaMs: 0 };
    const resultado = await this.mediciones.run(medicion, fn);
    return { resultado, ...medicion };
  }

  /** Cuántas llamadas a Ripley lleva la petición en serie (0 si no va en serie) */
  llamadasHechas(): number {
    return this.almacen.getStore()?.fila?.llamadas ?? 0;
  }

  /** Lo ya leído en esta petición en serie; `null` si no va en serie */
  lecturasDeLaFila(): Map<string, unknown> | null {
    return this.almacen.getStore()?.fila?.lecturas ?? null;
  }

  /** Si la petición va en fila, `fn` espera su sitio; si no, sale ya */
  async enFila<T>(fn: () => Promise<T>): Promise<T> {
    const fila = this.almacen.getStore()?.fila;
    if (!fila) return fn();
    if (fila.activas < fila.aLaVez) fila.activas++;
    else await new Promise<void>((entrar) => fila.esperando.push(entrar));
    try {
      return await fn();
    } finally {
      // El sitio pasa al siguiente, haya ido bien o mal
      const siguiente = fila.esperando.shift();
      if (siguiente) siguiente();
      else fila.activas--;
    }
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
