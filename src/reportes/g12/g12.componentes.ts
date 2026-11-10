import type {
  ClaveComponente,
  LineaResumenG12,
  RecetaG12,
  TipoBloqueG12,
} from './interfaces/g12.interface.js';

/**
 * La forma de la plantilla del G12: qué cuadros tiene, cómo se calcula cada
 * uno y qué tipos de bloque admite. Es código y no configuración a propósito:
 * es la plantilla, igual que en el Excel. Lo que se configura son las filas y
 * los ítems de cada cuadro.
 */

export interface DefinicionComponente {
  clave: ClaveComponente;
  titulo: string;
  receta: RecetaG12;
  /** Los tipos de bloque que admite */
  tipos: TipoBloqueG12[];
  /**
   * Con varios servicios simulados en una fila, cuál manda: el primero que dé
   * fecha. Pickup prueba RE antes que RT; Site to Store, SE antes que ST.
   */
  prioridad?: string[];
  /**
   * Servicios cuya capacidad se mira el día ANTES de la fecha: en un retiro RT
   * lo que se entrega un día se pickea el anterior.
   */
  diaAnterior?: string[];
  /** Solo de lunes a viernes (SE express); el fin de semana sale OFF */
  soloLaborables?: boolean;
}

export const COMPONENTES_G12: DefinicionComponente[] = [
  { clave: 'dd_lima', titulo: 'Despacho domicilio', receta: 'simulada', tipos: ['simulacion', 'capacidad', 'despacho', 'picking'] },
  { clave: 'sfs', titulo: 'Ship from store', receta: 'simulada', tipos: ['simulacion', 'despacho', 'capacidad'] },
  { clave: 'store_to_store', titulo: 'Store to store', receta: 'primer_dia', tipos: ['picking'] },
  {
    clave: 'pickup_lima', titulo: 'Pickup in store - Lima', receta: 'simulada',
    tipos: ['simulacion', 'picking'], prioridad: ['RE', 'RT'], diaAnterior: ['RT'],
  },
  {
    clave: 'pickup_provincia', titulo: 'Pickup in store - Provincia', receta: 'simulada',
    tipos: ['simulacion', 'picking'], prioridad: ['RE', 'RT'], diaAnterior: ['RT'],
  },
  {
    clave: 'sts_lima', titulo: 'Site to store - Lima', receta: 'simulada',
    tipos: ['simulacion', 'recepcion'], prioridad: ['SE', 'ST'],
  },
  {
    clave: 'sts_provincia', titulo: 'Site to store - Provincia', receta: 'simulada',
    tipos: ['simulacion', 'recepcion'], prioridad: ['SE', 'ST'],
  },
  { clave: 'dd_troncal', titulo: 'DD Flota exclusiva', receta: 'simulada', tipos: ['simulacion', 'despacho', 'capacidad'] },
  { clave: 'retiro_cercano', titulo: 'Retiro cercano CD', receta: 'primer_dia', tipos: ['picking'] },
  { clave: 'se_express', titulo: 'Site to store express', receta: 'primer_dia', tipos: ['picking'], soloLaborables: true },
];

export const CLAVES_COMPONENTES = COMPONENTES_G12.map((c) => c.clave);

export const definicionDe = (clave: ClaveComponente) =>
  COMPONENTES_G12.find((c) => c.clave === clave)!;

/** Cómo se agrupan los cuadros en la plantilla, y cuáles llevan un total conjunto */
export const GRUPOS_G12: Array<{ clave: string; titulo: string; componentes: ClaveComponente[]; totalConjunto?: boolean }> = [
  { clave: 'domicilio_lima', titulo: 'Despacho a domicilio Lima - DD', componentes: ['dd_lima', 'sfs', 'store_to_store'] },
  { clave: 'pickup', titulo: 'Pickup in store - Despacho', componentes: ['pickup_lima', 'pickup_provincia'], totalConjunto: true },
  { clave: 'sts', titulo: 'Site to store - Recepción', componentes: ['sts_lima', 'sts_provincia'], totalConjunto: true },
  { clave: 'troncal', titulo: 'Domicilio provincia troncal - DD', componentes: ['dd_troncal'] },
  { clave: 'rc_se', titulo: 'Agenda de picking RC / SE', componentes: ['retiro_cercano', 'se_express'] },
];

/**
 * El resumen de consumo de siempre, con el total de SFS bien sumado: el Excel
 * sumaba solo la fila de SFS Huancayo. Big Ticket y 90 min no entraban; se
 * pueden añadir en la configuración.
 */
export const RESUMEN_POR_DEFECTO: LineaResumenG12[] = [
  {
    nombre: 'Despacho a domicilio',
    partes: [
      { componente: 'dd_lima', fila: 'Paquetería Lima Total' },
      { componente: 'dd_lima', fila: 'SAME DAY' },
      { componente: 'sfs' },
      { componente: 'dd_troncal' },
    ],
  },
  {
    nombre: 'Retiro en tienda',
    partes: [
      { componente: 'pickup_lima' },
      { componente: 'pickup_provincia' },
      { componente: 'sts_lima' },
      { componente: 'sts_provincia' },
      { componente: 'store_to_store' },
    ],
  },
  { nombre: 'Retiro cercano', partes: [{ componente: 'retiro_cercano' }] },
];

// ───────────────────────── Los campos de cada tipo de ítem ─────────────────────────

export interface CampoG12 {
  clave: string;
  tipo: 'texto' | 'entero';
  req?: boolean;
  /** Se guarda en mayúsculas: servicios, métodos, canales */
  mayus?: boolean;
}

const DIAS_SEMANA = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
export { DIAS_SEMANA };

/**
 * Los mismos campos que el apartado de cada operación, por código o nombre.
 * Nada de ids: la zona es su nombre, el distrito también.
 */
export const CAMPOS_G12: Record<TipoBloqueG12, CampoG12[]> = {
  simulacion: [
    { clave: 'servicio', tipo: 'texto', req: true, mayus: true },
    { clave: 'metodo', tipo: 'texto', mayus: true },
    { clave: 'operador', tipo: 'texto', req: true },
    { clave: 'almacen', tipo: 'texto' },
    { clave: 'region', tipo: 'texto', req: true },
    { clave: 'provincia', tipo: 'texto' },
    { clave: 'distrito', tipo: 'texto', req: true },
    { clave: 'sku', tipo: 'texto' },
    { clave: 'cantidad', tipo: 'entero' },
    { clave: 'canal', tipo: 'texto', mayus: true },
    { clave: 'hora', tipo: 'texto' },
  ],
  picking: [
    { clave: 'codigo', tipo: 'texto', req: true },
    { clave: 'servicio', tipo: 'texto', mayus: true },
    { clave: 'agenda', tipo: 'texto' },
  ],
  recepcion: [
    { clave: 'codigo', tipo: 'texto', req: true },
    { clave: 'servicio', tipo: 'texto', mayus: true },
    { clave: 'agenda', tipo: 'texto' },
  ],
  despacho: [
    { clave: 'codigo', tipo: 'texto', req: true },
    { clave: 'zona', tipo: 'texto' },
    { clave: 'agenda', tipo: 'texto' },
  ],
  capacidad: DIAS_SEMANA.map((clave) => ({ clave, tipo: 'entero' as const })),
};

export const TIPOS_BLOQUE_G12 = Object.keys(CAMPOS_G12) as TipoBloqueG12[];

/** Topes, para que nadie arme una plantilla que tarde minutos en leerse */
export const LIMITES_G12 = {
  filasPorComponente: 40,
  bloquesPorComponente: 8,
  itemsPorBloque: 60,
  lineasResumen: 10,
  texto: 120,
};

/** Cuántos días se buscan hacia delante el primer día disponible */
export const DIAS_PRIMER_DIA = 10;

/** Cuántos días de cada agenda se leen: de ayer (por el RT) a seis semanas */
export const DIAS_LECTURA_AGENDAS = 45;

/**
 * Lo que vive cada cuadro generado antes de volver a pedirlo a Ripley. Quince
 * minutos y no cinco: en serie, una petición a la vez, las diez tablas tardan
 * varios minutos, y con cinco las primeras ya habrían caducado al terminar.
 */
export const VIDA_REPORTE_MS = 15 * 60 * 1000;
