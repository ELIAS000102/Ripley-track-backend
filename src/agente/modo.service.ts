import { Injectable, Logger } from '@nestjs/common';
import type { EstadoModo } from './interfaces/agente.interface.js';

/**
 * Cuánto dura el modo editor antes de volver solo a consultor.
 *
 * Que caduque no es una comodidad: es la regla. Un permiso de escritura que se
 * queda abierto porque alguien olvidó apagarlo es exactamente el escenario que
 * este interruptor existe para evitar. Media hora cubre de sobra una sesión de
 * ajustes y no cubre una tarde entera.
 */
const VIGENCIA_MS = 30 * 60 * 1000;

/** Tope de usuarios recordados, para que la memoria no crezca sin control */
const MAX_USUARIOS = 500;

/**
 * En qué modo está el agente para cada usuario.
 *
 * Es la única fuente de verdad sobre si el agente puede escribir. Deliberadamente
 * **no** viaja en la petición: si el modo llegara en una cabecera o en el cuerpo
 * del webhook, cualquiera que hablara con el backend podría declararse en modo
 * editor, y el interruptor sería decorativo. Aquí lo pregunta el guard al
 * servidor, y lo único que puede cambiarlo es `PUT /agente/modo`, que el agente
 * no alcanza.
 *
 * Vive en memoria del proceso a propósito. Un reinicio devuelve a todo el mundo
 * a modo consultor, que es el lado seguro en el que equivocarse; guardarlo en
 * Supabase haría que el permiso sobreviviera a caídas y despliegues, que es
 * justo lo que no se quiere de un permiso temporal.
 *
 * La contrapartida: con varias instancias del backend, cada una lleva su propio
 * registro, y el modo activado en una no vale en la otra. Eso deniega escrituras
 * que deberían pasar —molesto, pero del lado seguro— y se resolvería moviendo
 * esto a Supabase con su `expira_en` si algún día se escala horizontalmente.
 */
@Injectable()
export class ModoAgenteService {
  private readonly logger = new Logger(ModoAgenteService.name);

  /** usuarioId -> cuándo deja de poder escribir */
  private readonly editores = new Map<string, number>();

  /** Pasa a modo editor, o renueva el tiempo si ya lo estaba */
  activar(usuarioId: string): EstadoModo {
    if (this.editores.size >= MAX_USUARIOS) this.limpiar();

    const expira = Date.now() + VIGENCIA_MS;
    this.editores.set(usuarioId, expira);

    this.logger.warn(
      `Modo EDITOR activado para ${usuarioId} hasta ${new Date(expira).toISOString()}`,
    );

    return this.estadoDe(expira);
  }

  /** Vuelve a consultor en el acto */
  desactivar(usuarioId: string): EstadoModo {
    if (this.editores.delete(usuarioId)) {
      this.logger.log(`Modo consultor restablecido para ${usuarioId}`);
    }

    return { modo: 'consultor', expiraEn: null, minutosRestantes: 0 };
  }

  /** En qué modo está ahora mismo, ya descontada la caducidad */
  estado(usuarioId: string): EstadoModo {
    const expira = this.editores.get(usuarioId);

    if (!expira)
      return { modo: 'consultor', expiraEn: null, minutosRestantes: 0 };

    if (expira <= Date.now()) {
      this.editores.delete(usuarioId);
      this.logger.log(`El modo editor de ${usuarioId} caducó`);
      return { modo: 'consultor', expiraEn: null, minutosRestantes: 0 };
    }

    return this.estadoDe(expira);
  }

  /**
   * Lo que pregunta el guard antes de dejar pasar una escritura.
   *
   * Sin usuario devuelve false, no lanza: un fallo aquí tiene que denegar,
   * nunca permitir.
   */
  puedeEscribir(usuarioId?: string): boolean {
    return !!usuarioId && this.estado(usuarioId).modo === 'editor';
  }

  private estadoDe(expira: number): EstadoModo {
    return {
      modo: 'editor',
      expiraEn: new Date(expira).toISOString(),
      minutosRestantes: Math.max(0, Math.ceil((expira - Date.now()) / 60000)),
    };
  }

  /** Quita los caducados; si aún está lleno, cae el más antiguo */
  private limpiar(): void {
    const ahora = Date.now();

    for (const [usuario, expira] of this.editores) {
      if (expira <= ahora) this.editores.delete(usuario);
    }

    if (this.editores.size >= MAX_USUARIOS) {
      this.editores.delete(this.editores.keys().next().value as string);
    }
  }
}
