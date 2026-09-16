import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from './interfaces/auth.interface.js';

/**
 * Cuánto se recuerda un token ya validado.
 *
 * Validar contra Supabase cuesta ~230 ms, y el agente de IA encadena varias
 * llamadas seguidas con el mismo token, así que sin caché se paga ese peaje una
 * y otra vez. Medio minuto es un intercambio razonable para una herramienta
 * interna; conviene bajarlo si algún día importa apurar más la caducidad.
 */
const VIGENCIA_MS = 30_000;

/** Tope de tokens recordados, para que la memoria no crezca sin control */
const MAX_TOKENS = 500;

/**
 * Recuerda por unos segundos qué usuario corresponde a cada token.
 *
 * Vive fuera del guard para que el cierre de sesión pueda olvidar el token en
 * el acto: si no, quien cerrara sesión seguiría entrando durante la vigencia
 * de la caché.
 *
 * Es memoria del proceso: con varias instancias del backend, cada una lleva la
 * suya. No pasa nada, porque solo adelanta trabajo que igual se rehace.
 */
@Injectable()
export class CacheSesiones {
  private readonly entradas = new Map<
    string,
    { usuario: UsuarioAutenticado; expira: number }
  >();

  obtener(token: string): UsuarioAutenticado | null {
    const entrada = this.entradas.get(token);

    if (!entrada) return null;

    if (entrada.expira <= Date.now()) {
      this.entradas.delete(token);
      return null;
    }

    return entrada.usuario;
  }

  guardar(token: string, usuario: UsuarioAutenticado): void {
    if (this.entradas.size >= MAX_TOKENS) this.hacerSitio();

    this.entradas.set(token, { usuario, expira: Date.now() + VIGENCIA_MS });
  }

  /** Lo llama el cierre de sesión para que el token deje de servir de inmediato */
  olvidar(token: string): void {
    this.entradas.delete(token);
  }

  private hacerSitio(): void {
    const ahora = Date.now();

    for (const [clave, entrada] of this.entradas) {
      if (entrada.expira <= ahora) this.entradas.delete(clave);
    }

    // Si seguía lleno de entradas vigentes, cae la más antigua:
    // Map conserva el orden de inserción.
    if (this.entradas.size >= MAX_TOKENS) {
      this.entradas.delete(this.entradas.keys().next().value as string);
    }
  }
}
