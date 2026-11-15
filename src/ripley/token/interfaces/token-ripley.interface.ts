/**
 * Lo único que se le cuenta al cliente sobre sus tokens.
 * El valor nunca sale del backend, ni siquiera hacia su dueño.
 */
export interface EstadoToken {
  pais: string;
  configurado: boolean;
  actualizadoEn: string | null;
}
