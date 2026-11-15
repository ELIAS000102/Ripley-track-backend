import { NotFoundException } from '@nestjs/common';

/**
 * La API corporativa respondió que el recurso no existe.
 *
 * Extiende `NotFoundException` y no `Error` a secas por una razón práctica: un
 * error que Nest no reconoce como suyo acaba en el manejador de excepciones,
 * que lo imprime con su traza y responde un `500`. Y esto no es un fallo del
 * servidor —una agenda sin capacidades creadas devuelve 404, que es un estado
 * normal—, así que ensuciaba la consola con una traza por cada agenda vacía y
 * le contaba al cliente un error que no había.
 *
 * **No guarda la URL.** El objeto de error termina impreso en el log con todas
 * sus propiedades, y ahí es por donde se colaba la dirección de la API
 * corporativa.
 */
export class RipleyApiError extends NotFoundException {
  constructor(message: string) {
    super(message);
    this.name = 'RipleyApiError';
  }

  /**
   * El recurso no existe: suele significar "sin datos", no un fallo.
   *
   * Se conserva como propiedad con nombre porque es lo que se lee en quien
   * captura, y ahí `esNoEncontrado` dice mucho más que comparar un número.
   */
  get esNoEncontrado(): boolean {
    return this.getStatus() === 404;
  }
}
