/** Error de la API corporativa que conserva el código HTTP original */
export class RipleyApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = 'RipleyApiError';
  }

  /** El recurso no existe: suele significar "sin datos", no un fallo */
  get esNoEncontrado(): boolean {
    return this.status === 404;
  }
}