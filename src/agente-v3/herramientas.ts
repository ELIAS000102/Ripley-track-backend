import {
  BuscarMasivoDto,
  ConsultarCapacidadDto,
  ConsultarReporteDto,
  ConsultarTipoServicioDto,
  ConsultarTransferenciaDto,
  SimularAgenteDto,
} from '../agente/dto/consultas.dto.js';

/**
 * Las consultas que puede armar la v3 (parte 1b), con lo que acepta cada una.
 *
 * Es la lista cerrada que ve el modelo en el prompt de Armar y la que usa el
 * backend para validar lo que devuelve: una herramienta o un parámetro que no
 * está aquí no vale. Los DTO son los de las rutas del agente: lo que pasa la
 * validación de aquí pasa también la del backend.
 */

export type TipoParam = 'codigos' | 'codigo' | 'servicios' | 'servicio' | 'texto' | 'fecha' | 'numero' | 'booleano' | 'opcion';

export interface ParamDef {
  nombre: string;
  tipo: TipoParam;
  requerido?: boolean;
  opciones?: string[];
  min?: number;
  max?: number;
  /** Qué clase de código espera (para decírselo al modelo) */
  entidades?: Array<'tienda' | 'almacen' | 'opl'>;
  /** Puede ser lo que trae otro paso o el mensaje anterior ({ ref }) */
  ref?: boolean;
  descripcion: string;
}

export interface Herramienta {
  id: string;
  descripcion: string;
  params: ParamDef[];
  dto: new () => object;
  /** El parámetro con la lista que se parte en tandas de 30 */
  lista?: string;
}

export const HERRAMIENTAS: Herramienta[] = [
  {
    id: 'consultar_capacidad',
    descripcion: 'Capacidad por día de agendas de picking (tiendas, almacenes, CDs), recepción (tiendas) o despacho (OPL): asignado, ocupado, disponible, si está abierta. También el consumo o la ocupación de tiendas y almacenes concretos.',
    dto: ConsultarCapacidadDto,
    lista: 'codigo',
    params: [
      { nombre: 'tipo', tipo: 'opcion', requerido: true, opciones: ['picking', 'despacho', 'recepcion'], descripcion: '"picking" (tiendas, almacenes, CDs), "recepcion" (tiendas) o "despacho" (OPL)' },
      { nombre: 'codigo', tipo: 'codigos', requerido: true, ref: true, entidades: ['tienda', 'almacen', 'opl'], descripcion: 'las oficinas' },
      { nombre: 'servicio', tipo: 'servicios', descripcion: 'tipo(s) de servicio o jornada' },
      { nombre: 'zona', tipo: 'texto', descripcion: 'en despacho, el nombre de la zona' },
      { nombre: 'agenda', tipo: 'texto', descripcion: 'el nombre (o parte) de la agenda: "centralizado"' },
      { nombre: 'desde', tipo: 'fecha', descripcion: 'primer día; por defecto hoy' },
      { nombre: 'dias', tipo: 'numero', min: 1, max: 30, descripcion: 'cuántos días; por defecto 7' },
    ],
  },
  {
    id: 'consultar_reporte_cds',
    descripcion: 'Ocupación de los CDs por jornada y día. SOLO para CDs ("cómo va el CD Villa"); para tiendas o almacenes concretos es consultar_capacidad.',
    dto: ConsultarReporteDto,
    params: [
      { nombre: 'cd', tipo: 'codigo', entidades: ['almacen'], descripcion: 'un CD; sin él, todos los del país' },
      { nombre: 'desde', tipo: 'fecha', descripcion: 'primer día; por defecto hoy' },
      { nombre: 'dias', tipo: 'numero', min: 1, max: 14, descripcion: 'cuántos días' },
    ],
  },
  {
    id: 'consultar_transferencia',
    descripcion: 'Desfase, preparación, tránsito, días y si está habilitada la transferencia de un origen (la fuente de stock) a sucursales destino.',
    dto: ConsultarTransferenciaDto,
    lista: 'destino',
    params: [
      { nombre: 'origen', tipo: 'codigo', entidades: ['almacen', 'tienda'], descripcion: 'de dónde sale el stock; en Perú, por defecto el 20026' },
      { nombre: 'destino', tipo: 'codigos', ref: true, entidades: ['tienda', 'almacen'], descripcion: 'las tiendas que reciben' },
    ],
  },
  {
    id: 'consultar_servicios_opl',
    descripcion: 'Los tipos de servicio configurados en las agendas de un OPL: activo, en checkout, hora de corte, holgura, ocurrencias.',
    dto: ConsultarTipoServicioDto,
    lista: 'opl',
    params: [
      { nombre: 'opl', tipo: 'codigos', requerido: true, ref: true, entidades: ['opl'], descripcion: 'los OPL' },
      { nombre: 'zona', tipo: 'texto', descripcion: 'el nombre de la zona' },
      { nombre: 'agenda', tipo: 'texto', descripcion: 'el nombre de la agenda' },
    ],
  },
  {
    id: 'busqueda_masiva',
    descripcion: 'Qué tiendas u OPL tienen configurado un tipo de servicio, de forma masiva, y si su agenda está activa y en checkout. Para ver o contar activos e inactivos basta con ella.',
    dto: BuscarMasivoDto,
    lista: 'origenes',
    params: [
      { nombre: 'servicio', tipo: 'servicios', requerido: true, descripcion: 'el o los tipos de servicio' },
      { nombre: 'origenes', tipo: 'codigos', ref: true, entidades: ['tienda', 'almacen'], descripcion: 'limitar a estas tiendas o almacenes' },
      { nombre: 'soloActivas', tipo: 'booleano', descripcion: 'solo las activas (solo si se dice)' },
    ],
  },
  {
    id: 'simular_entrega',
    descripcion: 'Simula cuándo llegaría un pedido.',
    dto: SimularAgenteDto,
    lista: 'operador',
    params: [
      { nombre: 'servicio', tipo: 'servicio', descripcion: 'el tipo de servicio' },
      { nombre: 'operador', tipo: 'codigos', requerido: true, ref: true, entidades: ['opl', 'tienda'], descripcion: 'QUIÉN ENTREGA: en despacho a domicilio (SD, DT, S…) el OPL; en retiro en tienda (ST, SE, RT…) la TIENDA donde se recoge' },
      { nombre: 'almacen', tipo: 'codigo', entidades: ['almacen', 'tienda'], descripcion: 'DE DÓNDE SALE EL STOCK; en Perú, por defecto el 20026. No es la tienda donde se recoge' },
      { nombre: 'region', tipo: 'texto', descripcion: 'región de destino' },
      { nombre: 'provincia', tipo: 'texto', descripcion: 'provincia de destino' },
      { nombre: 'distrito', tipo: 'texto', descripcion: 'distrito de destino' },
      { nombre: 'fecha', tipo: 'fecha', descripcion: 'fecha de compra' },
      { nombre: 'hora', tipo: 'texto', descripcion: 'hora de compra, HH:mm' },
      { nombre: 'sku', tipo: 'texto', descripcion: 'el producto' },
      { nombre: 'cantidad', tipo: 'numero', min: 1, max: 999, descripcion: 'unidades' },
    ],
  },
  {
    id: 'ejecutar_atajo',
    descripcion: 'Ejecuta un atajo guardado por su nombre exacto.',
    dto: Object as unknown as new () => object,
    params: [{ nombre: 'nombre', tipo: 'texto', requerido: true, descripcion: 'el nombre exacto del atajo' }],
  },
];

export const herramienta = (id: string) => HERRAMIENTAS.find((h) => h.id === id) ?? null;

/** Las fuentes de stock por defecto: se pueden usar aunque no se digan */
export const FUENTE_POR_DEFECTO: Record<string, string> = { PE: '20026' };

/** El catálogo para el prompt de Armar */
export function catalogoParaPrompt(): string {
  return HERRAMIENTAS.map((h) => {
    const ps = h.params.map((p) => {
      const tipo = p.tipo === 'opcion' ? p.opciones!.map((o) => `"${o}"`).join(' | ') : p.tipo;
      return `    - ${p.nombre}${p.requerido ? '*' : ''} (${tipo}${p.ref ? ', o {"ref": …}' : ''}): ${p.descripcion}`;
    });
    return `- ${h.id}: ${h.descripcion}\n${ps.join('\n')}`;
  }).join('\n');
}
