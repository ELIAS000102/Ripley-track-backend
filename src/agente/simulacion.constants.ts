/**
 * Valores por defecto de la simulación.
 *
 * Están aquí y no en el prompt del agente por dos razones: no gastan contexto
 * en cada petición —eran más de 400 tokens de tablas—, y no pueden quedarse
 * desfasados respecto al código que los usa.
 *
 * Todo esto es conocimiento de la operación, no del modelo: qué método de
 * entrega corresponde a cada tipo de servicio, qué OPL se simulan por defecto y
 * a qué destino. El agente solo tiene que saber que puede omitirlos.
 */

/**
 * El método de entrega lo determina el tipo de servicio, siempre.
 *
 * No es una preferencia ni un valor razonable por defecto: es la regla de
 * negocio, y por eso el agente no tiene que mandar el método nunca. Se retira
 * en tienda (RT) o se despacha a domicilio (DP), y el servicio decide cuál.
 */
export const METODO_POR_SERVICIO: Record<string, string> = {
  // Retiro en tienda
  ST: 'RT',
  SS: 'RT',
  SG: 'RT',
  SE: 'RT',
  RT: 'RT',
  RE: 'RT',

  // Despacho a domicilio
  DT: 'DP',
  SD: 'DP',
  S: 'DP',
  EX: 'DP',
  AT: 'DP',
  OP: 'DP',
};

/**
 * El método que corresponde a un servicio, o undefined si no se conoce.
 *
 * Un servicio nuevo que no esté en la tabla no se adivina: se deja que quien
 * llame decida, porque acertar por parecido daría simulaciones silenciosamente
 * equivocadas.
 */
export function metodoDeServicio(servicio?: string | null): string | undefined {
  return servicio ? METODO_POR_SERVICIO[servicio.trim().toUpperCase()] : undefined;
}

/**
 * Un OPL con su destino de simulación.
 *
 * `nombre` y `distrito` son cosas distintas y conviene no confundirlas: el
 * nombre identifica la tienda —"Atocongo", "Plaza Lima Norte"— y el distrito es
 * geografía real. Tenerlos en un solo campo hizo que se simulara contra el
 * distrito equivocado en los casos donde la tienda se llama como un distrito
 * (Breña, Comas, San Isidro): la consulta devolvía fecha, pero de otro destino.
 */
export interface OplPorDefecto {
  code: string;
  /** Cómo se conoce la tienda, para mostrarlo */
  nombre: string;
  /** Dónde se simula la entrega */
  distrito: string;
  provincia: string;
  region: string;
}

const LIMA = { provincia: 'Lima', region: 'Lima' };

/**
 * OPL de despacho a domicilio (SD → DP).
 *
 * Aquí el distrito sí varía: es a dónde se despacha, y cada uno cubre el suyo.
 */
export const OPLS_SD: OplPorDefecto[] = [
  { code: '1111', nombre: 'San Borja', distrito: 'San Borja', ...LIMA },
  { code: '1110', nombre: 'Chorrillos', distrito: 'Chorrillos', ...LIMA },
  { code: '1112', nombre: 'La Molina', distrito: 'La Molina', ...LIMA },
  { code: '1113', nombre: 'San Miguel', distrito: 'San Miguel', ...LIMA },
  { code: '1114', nombre: 'Miraflores', distrito: 'Miraflores', ...LIMA },
];

/**
 * Tiendas de retiro (SE → RT).
 *
 * **Las once simulan contra Lima - Lima - Lima.** El nombre de la tienda no es
 * su destino: lo que se simula es si el pedido llega a tiempo para recogerlo,
 * y esa consulta se hace siempre contra el mismo distrito.
 */
export const OPLS_SE: OplPorDefecto[] = [
  { code: '20066', nombre: 'Plaza Lima Norte', distrito: 'Lima', ...LIMA },
  { code: '20073', nombre: 'Santa Anita', distrito: 'Lima', ...LIMA },
  { code: '20028', nombre: 'San Miguel', distrito: 'Lima', ...LIMA },
  { code: '20023', nombre: 'Primavera', distrito: 'Lima', ...LIMA },
  { code: '20030', nombre: 'Miraflores', distrito: 'Lima', ...LIMA },
  { code: '20048', nombre: 'Breña', distrito: 'Lima', ...LIMA },
  { code: '20027', nombre: 'San Isidro', distrito: 'Lima', ...LIMA },
  { code: '20089', nombre: 'Comas', distrito: 'Lima', ...LIMA },
  {
    code: '20057',
    nombre: 'San Juan de Lurigancho',
    distrito: 'Lima',
    ...LIMA,
  },
  { code: '20058', nombre: 'Atocongo', distrito: 'Lima', ...LIMA },
  { code: '20021', nombre: 'Chorrillos', distrito: 'Lima', ...LIMA },
];

/**
 * Punto de entrega por defecto.
 *
 * Es el que usa la operación cuando no simula un destino concreto. Se aplica
 * solo si tampoco se pidió una simulación preconfigurada, que ya trae el suyo.
 */
export const DESTINO_POR_DEFECTO = {
  region: 'Lima',
  provincia: 'Lima',
  distrito: 'Lima',
};

/** SKU de referencia para cuando el usuario no aporta uno */
export const SKU_POR_DEFECTO = '2013435160001';

/**
 * Servicios que se consultan SIN filtrar por tipo.
 *
 * Mandar "SD" a Ripley devuelve solo SD. Mandando el tipo vacío devuelve todos
 * los aplicables al destino, que en los OPL de despacho son **SD y S**: las dos
 * juntas son lo que la operación compara, así que pedir solo una pierde la
 * mitad de la respuesta.
 */
export const SIN_FILTRAR = ['SD'];

/** Qué tipo mandarle a Ripley para un servicio dado */
export function tipoParaRipley(servicio: string | null): string {
  if (!servicio) return '';
  return SIN_FILTRAR.includes(servicio.toUpperCase()) ? '' : servicio;
}

/**
 * Qué OPL simular.
 *
 * Con un servicio concreto, los suyos. Sin servicio —que es una consulta
 * válida: Ripley devuelve entonces todos los tipos aplicables, SD y S en estos
 * OPL— se usan los de despacho, que es el caso que se revisa a diario.
 */
export function oplsDe(servicio?: string): OplPorDefecto[] {
  return servicio?.toUpperCase() === 'SE' ? OPLS_SE : OPLS_SD;
}

/** El método que corresponde a un OPL, por la lista en la que esté */
export function metodoDeOpl(code: string): string | undefined {
  if (OPLS_SD.some((o) => o.code === code)) return 'DP';
  if (OPLS_SE.some((o) => o.code === code)) return 'RT';
  return undefined;
}

/** Los datos por defecto de un OPL conocido */
export function oplConocido(code: string): OplPorDefecto | undefined {
  return [...OPLS_SD, ...OPLS_SE].find((o) => o.code === code.trim());
}
