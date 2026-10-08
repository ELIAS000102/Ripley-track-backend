/** Los días de la semana como los escribe la matriz, de lunes a domingo */
export const DIAS = ['L', 'M', 'W', 'J', 'V', 'S', 'D'] as const;
export type Dia = (typeof DIAS)[number];

export const NOMBRE_DIA: Record<Dia, string> = {
  L: 'lunes', M: 'martes', W: 'miércoles', J: 'jueves', V: 'viernes', S: 'sábado', D: 'domingo',
};

/**
 * Una fila de la matriz: una tienda con sus tres bloques de días.
 *
 * Cada bloque son siete celdas, de lunes a domingo, con su etiqueta tal cual
 * ("B", "P-A-11", "A+7") o `null` si está vacía. Se guardan sin interpretar:
 * la interpretación —qué recepción le toca a cada transferencia— se calcula al
 * leerla, y así una regla que cambie no obliga a volver a cargar la matriz.
 */
export interface TiendaMalla {
  codigo: string;
  tienda: string;
  /** Días entre la recepción y el despacho, naturales */
  desfase: number;
  /** El día de venta y de transferencia */
  transferencia: (string | null)[];
  /** El bloque del medio del Excel: se guarda, pero no entra en el cálculo */
  intermedio: (string | null)[];
  /** El día de recepción; admite "+N" (días que se suman a esa recepción) */
  recepcion: (string | null)[];
}

/** Un día de transferencia con la recepción que le toca */
export interface ParMalla {
  transfiere: Dia;
  etiqueta: string;
  recepciona: Dia;
  /** Lo que suma un "+N" de la recepción, o 0 */
  suma: number;
  /** Días naturales desde la transferencia hasta la recepción, "+N" incluido */
  diasHastaRecepcion: number;
  /** Días naturales desde la transferencia hasta el despacho */
  diasHastaDespacho: number;
  despacha: Dia;
}

/** Lo que pasa con una venta según el día de la semana en que se hace */
export interface VentaMalla {
  venta: Dia;
  /** El mismo día si se puede transferir; si no, el siguiente que sí */
  transfiere: Dia;
  etiqueta: string;
  recepciona: Dia;
  despacha: Dia;
  diasHastaTransferencia: number;
  diasHastaRecepcion: number;
  /** El lead time: días naturales desde la venta hasta el despacho */
  diasHastaDespacho: number;
}

/** Una transferencia cuya etiqueta no está en la recepción: se ignora */
export interface TransferenciaIgnorada {
  dia: Dia;
  etiqueta: string;
}

/** Una tienda ya leída, con lo que se deduce de ella */
export interface TiendaInterpretada extends TiendaMalla {
  pares: ParMalla[];
  ventas: VentaMalla[];
  ignoradas: TransferenciaIgnorada[];
}

/** El resultado de leer un Excel */
export interface LecturaMatriz {
  hoja: string;
  tiendas: TiendaMalla[];
  avisos: string[];
  errores: string[];
}
