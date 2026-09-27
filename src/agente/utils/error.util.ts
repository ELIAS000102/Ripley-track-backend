import { HttpException } from '@nestjs/common';

/**
 * El motivo de un fallo, para contarlo dentro de una respuesta que sí salió.
 *
 * Cuando una petición pide varias cosas —cinco operadores, tres almacenes, dos
 * destinos— y una falla, las demás siguen valiendo. El fallo no se lanza: se
 * anota en su fila. Para eso hace falta su texto, no la excepción.
 *
 * Los errores del backend ya vienen explicados ("No se encontró ningún
 * operador que coincida con 1017"), así que se relanzan tal cual en vez de
 * envolverlos en otra frase que no añade nada.
 *
 * **Un `Error` cualquiera también conserva su mensaje.** Estaba escrito cinco
 * veces en cinco services, y las cinco copias perdían el texto de todo lo que
 * no fuera una excepción de Nest: un fallo de red se contaba como "no se pudo
 * consultar", que es justo lo que no ayuda a nadie a arreglarlo.
 */
export function motivoDelFallo(error: unknown, porDefecto: string): string {
  if (error instanceof HttpException) {
    const cuerpo = error.getResponse() as { message?: string | string[] };
    const mensaje = cuerpo?.message;

    if (Array.isArray(mensaje)) return mensaje.join('; ');
    if (mensaje) return mensaje;

    return error.message || porDefecto;
  }

  if (error instanceof Error && error.message) return error.message;

  return porDefecto;
}
