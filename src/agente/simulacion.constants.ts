/**
 * Valores por defecto de la simulación.
 *
 * Están aquí y no en el prompt del agente por dos razones: no gastan contexto
 * en cada petición —eran más de 400 tokens de tablas—, y no pueden quedarse
 * desfasados respecto al código que los usa.
 *
 * Todo esto es conocimiento de la operación, no del modelo: qué método de
 * entrega corresponde a cada tipo de servicio, qué OPL se simulan por defecto y
 * dónde está cada uno. El agente solo tiene que saber que puede omitirlos.
 */

/**
 * El método de entrega lo determina el tipo de servicio, siempre.
 *
 * No es una preferencia ni un valor razonable por defecto: es la regla de
 * negocio. Un SD se despacha a domicilio (DP) y un SE se retira en tienda (RT).
 */
export const METODO_POR_SERVICIO: Record<string, string> = {
  SD: 'DP',
  SE: 'RT',
};

/** Un OPL con su destino habitual */
export interface OplPorDefecto {
  code: string;
  distrito: string;
  provincia: string;
  region: string;
}

const LIMA = { provincia: 'Lima', region: 'Lima' };

/**
 * OPL de despacho a domicilio (SD → DP).
 *
 * Cuando se pide una simulación de SD sin decir qué OPL, se simulan estos
 * cinco: son los que la operación revisa.
 */
export const OPLS_SD: OplPorDefecto[] = [
  { code: '1111', distrito: 'San Borja', ...LIMA },
  { code: '1110', distrito: 'Chorrillos', ...LIMA },
  { code: '1112', distrito: 'La Molina', ...LIMA },
  { code: '1113', distrito: 'San Miguel', ...LIMA },
  { code: '1114', distrito: 'Miraflores', ...LIMA },
];

/**
 * Tiendas de retiro (SE → RT).
 *
 * Aquí el distrito no es una preferencia: es dónde está físicamente la tienda,
 * así que simular el retiro en otro distrito no tendría sentido.
 */
export const OPLS_SE: OplPorDefecto[] = [
  { code: '20066', distrito: 'Plaza Lima Norte', ...LIMA },
  { code: '20073', distrito: 'Santa Anita', ...LIMA },
  { code: '20028', distrito: 'San Miguel', ...LIMA },
  { code: '20023', distrito: 'Primavera', ...LIMA },
  { code: '20030', distrito: 'Miraflores', ...LIMA },
  { code: '20048', distrito: 'Breña', ...LIMA },
  { code: '20027', distrito: 'San Isidro', ...LIMA },
  { code: '20089', distrito: 'Comas', ...LIMA },
  { code: '20057', distrito: 'San Juan de Lurigancho', ...LIMA },
  { code: '20058', distrito: 'Atocongo', ...LIMA },
  { code: '20021', distrito: 'Chorrillos', ...LIMA },
];

/** SKU de referencia para cuando el usuario no aporta uno */
export const SKU_POR_DEFECTO = '2013435160001';

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
