/**
 * Consultor lee; editor lee y además escribe.
 *
 * No hay un tercer modo ni un permiso por endpoint: el interruptor es uno solo
 * y se ve en el chat, porque un permiso que no se ve es un permiso que se
 * olvida encendido.
 */
export type ModoAgente = 'consultor' | 'editor';

export interface EstadoModo {
  modo: ModoAgente;
  /** Cuándo vuelve solo a consultor. En consultor, null. */
  expiraEn: string | null;
  minutosRestantes: number;
}
